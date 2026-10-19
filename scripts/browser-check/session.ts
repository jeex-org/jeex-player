/**
 * The `agent-browser` session every area of the check drives the page through:
 * the CLI wrapper, the JSON-decoding `eval`, the assertion and the run summary.
 *
 * Invariant: no area module spawns the CLI itself. One session means one
 * browser, one `close` in the runner's `finally`, and one place that knows how
 * `agent-browser eval` encodes its result.
 */

export type BrowserResult = { output: string; code: number };

/**
 * JSON literal of a value, safe to paste into page code. Free-standing because
 * building a page snippet needs no browser — only `eval`ing one does.
 */
export function literal(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/**
 * The page the check drives: `VIEWER_URL` when set, otherwise the default dev
 * server (`npm run dev`, port 3700). The check clicks, paints and reloads that
 * page, so point it at a server started for the check when the default one is
 * in use, for example `npm run dev -- --port 3703 --strictPort` and
 * `VIEWER_URL=http://localhost:3703/`.
 */
export function resolveViewerUrl(): string {
  return process.env['VIEWER_URL'] ?? 'http://127.0.0.1:3700/';
}

/**
 * The viewer URL with extra query options, whatever `VIEWER_URL` already had.
 *
 * `resolveViewerUrl` returns something the operator typed, and the documented
 * examples carry no query (`http://localhost:3703/`) — but a run that wants the
 * debug surface passes `http://127.0.0.1:3708/?debug=1`, and a check that needs
 * `view=tour&motion=reduced` has to add to it rather than assume.
 *
 * Template-appending a bare `?` did assume, and the check then blamed the
 * viewer for a URL the check itself had built: `…/?debug=1?view=tour&motion=reduced`
 * parses as `debug="1?view=tour"` and `motion="reduced"`, so `view` is silently
 * gone, no tour is engaged, and `motion=reduced should open an engaged tour
 * paused, got ready` — which is exactly what the viewer SHOULD report when no
 * tour is engaged (README «`reduced` opens an engaged tour paused»): red with
 * `?debug=1`, green without it, on the same commit and the same dev server.
 *
 * `URL.searchParams.set` also means an option overrides the same option already
 * in the URL instead of appearing twice, which is what a check asking for a
 * specific state wants.
 *
 * MERGES. Its sibling `Session.withQuery` REPLACES the whole query string, and
 * that difference is load-bearing: `withQuery` is for the thirty-odd mount-option
 * scenarios that assert an exact option set (`chrome=0&chromeStatus=1&…`), where
 * inheriting whatever the operator put in `VIEWER_URL` would change what is being
 * asserted. Use this one when the URL the check was given must survive; use
 * `withQuery` when the scenario owns the whole query. Choosing wrong is a silent
 * drop, which is the failure class this function exists to end — so pick
 * deliberately.
 */
export function withViewerOptions(url: string, options: Readonly<Record<string, string>>): string {
  let composed: URL;
  try {
    composed = new URL(url);
  } catch {
    // The module's convention for bad operator input: one actionable line, not
    // a raw `TypeError: Invalid URL` from the middle of an area check.
    throw new Error(`browser-check: VIEWER_URL is not a usable URL: ${JSON.stringify(url)}`);
  }
  for (const [name, value] of Object.entries(options)) composed.searchParams.set(name, value);
  return composed.href;
}

/**
 * Fails with one clear line when the CLI is missing, instead of an ENOENT from
 * the first `run` a hundred lines into the check.
 */
export async function requireAgentBrowser(): Promise<void> {
  try {
    const probe = Bun.spawn(['agent-browser', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    if ((await probe.exited) === 0) return;
  } catch {
    // Falls through to the same message: not installed, or not on PATH.
  }
  console.error(
    'browser-check needs the `agent-browser` CLI on PATH (https://agent-browser.dev). ' +
      'Install it, then re-run with VIEWER_URL pointing at a running dev server.',
  );
  process.exit(1);
}

/**
 * Failures of the TRANSPORT rather than of the page: the CDP socket timed out,
 * or the single-tenant daemon was busy. They say nothing about the viewer, and
 * on a loaded machine they land on whichever command happened to be next.
 */
const TRANSPORT_FAILURES = ['Resource temporarily unavailable', 'CDP command timed out', 'daemon may be busy'];

/** Pause before a retry, milliseconds: long enough for a busy daemon to answer. */
const RETRY_PAUSE_MS = 4000;
/** How many times a transport failure is retried before it is a real failure. */
const TRANSPORT_RETRIES = 2;

/** How often a parked eval job is polled, milliseconds (`evalValue`). */
const JOB_POLL_MS = 250;
/**
 * How long the STARTING eval waits for the code to settle before it parks the
 * job and returns, milliseconds: short code answers in one call (a sampling
 * loop between frames must not pay a second round trip), and ten seconds is a
 * third of the CDP command timeout.
 */
const JOB_INLINE_MS = 10_000;
/**
 * The longest one eval job may run on the wall clock before it is a failure:
 * the frame-clock cap `step.ts` uses (`WALL_CAP_MS`), repeated here because
 * `step.ts` imports this module.
 */
const JOB_WALL_CAP_MS = 600_000;

function isTransportFailure(message: string): boolean {
  return TRANSPORT_FAILURES.some((needle) => message.includes(needle));
}

export type Session = {
  /** The demo page under check. */
  url: string;
  run: (args: string[]) => Promise<BrowserResult>;
  evalValue: <T>(expression: string) => Promise<T>;
  assert: (condition: boolean, message: string) => void;
  /** JSON literal of a value, safe to paste into page code. */
  literal: (value: unknown) => string;
  /**
   * The demo URL with a fresh query string, for the mount-option scenarios.
   *
   * REPLACES the whole query, deliberately: a scenario that asserts an exact
   * option set must not inherit whatever the operator put in `VIEWER_URL`. When
   * that query has to survive instead, use `withViewerOptions`, which merges.
   */
  withQuery: (search: string) => string;
  /** What the run actually picked at runtime; printed on success. */
  summary: string[];
};

export function createSession(url: string): Session {
  const name = `jeex-browser-check-${Date.now()}`;

  const once = async (args: string[]): Promise<BrowserResult> => {
    const child = Bun.spawn(['agent-browser', '--session', name, ...args], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    const code = await child.exited;
    if (code !== 0) throw new Error(`${args.join(' ')}\n${output}${error}`);
    return { output: `${output}${error}`, code };
  };

  /**
   * One command, retried on a TRANSPORT failure.
   *
   * `agent-browser` already retries internally, which is exactly why every
   * mutating step of this check has to be idempotent or guarded against
   * re-entry: a step that may run twice must leave the page as one run would.
   * These retries rely
   * on the same rule and add no new class of risk — and without them a long run
   * on a loaded machine fails on a busy single-tenant daemon rather than on the
   * viewer, which is a red result that says nothing about the code.
   *
   * A failure that is NOT transport-shaped is raised at once: a genuine
   * assertion or a page error must never be retried into a pass.
   */
  const run = async (args: string[]): Promise<BrowserResult> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await once(args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isTransportFailure(message) || attempt >= TRANSPORT_RETRIES) throw error;
        console.warn(`  (transport failure ${attempt + 1}/${TRANSPORT_RETRIES}, retrying) ${args[0] ?? ''}`);
        await Bun.sleep(RETRY_PAUSE_MS);
      }
    }
  };

  /** The page's answer, which is itself usually `JSON.stringify(...)` of the real value. */
  const decode = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      // A plain string result (a finish id, a variant id): keep it as it is.
      return value;
    }
  };

  let jobs = 0;
  /** Jobs whose answer reached the runner; the next starting eval drops them from the page. */
  let received: string[] = [];

  /**
   * Evaluates page code and returns its value, however many frames it waits.
   *
   * The code is STARTED by one `eval` that answers inline when the code settles
   * within `JOB_INLINE_MS`; otherwise its promise stays parked on the page
   * (`window.__jeexJobs`) and the runner polls for the settled value with
   * further short evals. No single `Runtime.evaluate` therefore lasts much
   * longer than the inline window, whatever the page awaits: a probe that waits
   * thirty rendered frames plus a settle takes a minute on a renderer that draws
   * one frame a second (a software renderer under `swiftshader-webgl`),
   * and as one call it outlived the CDP command timeout, which the transport
   * retry then answered by dispatching the same gesture again. Every wait and
   * every threshold inside the page code is unchanged; only the transport is.
   *
   * Both evals are safe to retry: a start whose job already exists on the page
   * reports that job instead of running the code a second time, and neither the
   * start nor a poll removes a settled job, so a reply lost in transport is
   * answered again. A job leaves the page with the NEXT start, once its answer
   * is known to have arrived.
   *
   * Synchronous code still runs synchronously inside the starting eval, so a
   * `performance.now()` bracket around a click measures what it always did.
   * An exception is raised as an `Evaluation error`, as `agent-browser eval`
   * reported one; a page that navigated away mid-job loses it and says so.
   */
  const evalValue = async <T>(expression: string): Promise<T> => {
    jobs += 1;
    const key = `job-${jobs}`;
    const id = literal(key);
    const dropping = received;
    const drop = literal(dropping);
    const started = await run([
      'eval',
      `(async () => {
        const jobs = (window.__jeexJobs ??= {});
        for (const key of ${drop}) delete jobs[key];
        // A transport retry of this same start: report the job, never run it twice.
        if (jobs[${id}]) return JSON.stringify(jobs[${id}]);
        const settle = (entry) => { jobs[${id}] = { done: true, ...entry }; };
        jobs[${id}] = { done: false };
        let pending;
        try {
          pending = Promise.resolve(${expression});
        } catch (error) {
          pending = Promise.reject(error);
        }
        pending.then(
          (value) => settle({ value: value === undefined ? null : value }),
          (error) => settle({ error: String((error && error.stack) || error) }),
        );
        // Most code settles at once or within a few frames: answer it in this
        // same call, and park only what is still running at the deadline.
        await Promise.race([pending.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ${JOB_INLINE_MS}))]);
        await Promise.resolve();
        return JSON.stringify(jobs[${id}]);
      })()`,
    ]);
    // Dropped on the page only now that the start has answered; a start that failed leaves them for the next one.
    received = received.filter((sent) => !dropping.includes(sent));
    const answer = (output: string): { done?: boolean; lost?: boolean; value?: unknown; error?: string } | null =>
      decode(decode(output.trim().split('\n').pop() ?? 'null')) as {
        done?: boolean;
        lost?: boolean;
        value?: unknown;
        error?: string;
      } | null;
    const settled = (job: ReturnType<typeof answer>): job is { done: true; value?: unknown; error?: string } => job?.done === true;
    const first = answer(started.output);
    if (settled(first)) {
      received.push(key);
      if (first.error !== undefined) throw new Error(`eval ${expression}\n✗ Evaluation error: ${first.error}`);
      return decode(first.value) as T;
    }
    const deadline = Date.now() + JOB_WALL_CAP_MS;
    for (;;) {
      const { output } = await run([
        'eval',
        `(() => {
          const job = window.__jeexJobs?.[${id}];
          if (!job) return JSON.stringify({ lost: true });
          return JSON.stringify(job.done ? job : { done: false });
        })()`,
      ]);
      const job = answer(output);
      if (job?.lost) throw new Error(`eval ${expression}\nthe page lost the job (it navigated or reloaded before the code settled)`);
      if (job?.done) {
        received.push(key);
        if (job.error !== undefined) throw new Error(`eval ${expression}\n✗ Evaluation error: ${job.error}`);
        return decode(job.value) as T;
      }
      if (Date.now() > deadline) throw new Error(`eval ${expression}\nstill running after ${JOB_WALL_CAP_MS} ms of wall clock`);
      await Bun.sleep(JOB_POLL_MS);
    }
  };

  return {
    url,
    run,
    evalValue,
    assert: (condition, message) => {
      if (!condition) throw new Error(`Browser check failed: ${message}`);
    },
    literal,
    withQuery: (search) => {
      const target = new URL(url);
      target.search = search;
      return target.href;
    },
    summary: [],
  };
}
