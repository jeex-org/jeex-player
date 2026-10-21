/**
 * `test:component` entry point — a preflight guard plus a hard watchdog
 * around `vitest run --config vitest.config.ts`.
 *
 * It guards two hazards an abandoned earlier run (killed by a timeout,
 * Ctrl-C or a closed terminal) can leave behind in the SAME checkout:
 *
 *   (a) its own Vitest process still holding Vitest's coverage
 *       `ReportsDirectoryLock`: the next run would fail a few seconds into
 *       browser launch with an opaque `ReportsDirectoryLock.inUseError` that
 *       names a pid but no remedy;
 *   (b) orphaned `chrome-headless-shell` children, reparented to pid 1,
 *       holding the machine's software GPU rasteriser: the next run's browser
 *       launch then never completes its handshake, and Vitest prints its two
 *       boot lines and nothing after, because the hang is BEFORE any per-test
 *       timeout is armed.
 *
 * Two different checkouts never collide: `coverage.reportsDirectory` resolves
 * against each checkout's own root, and the lock file is named after the
 * resolved path.
 *
 * What this script does, in order:
 *
 *   1. Computes the exact lock file `ReportsDirectoryLock` will check for
 *      THIS worktree's `coverage-component` directory. If it is held by a
 *      DIFFERENT, still-alive process, fail immediately (well under a
 *      second) with that pid, its command line and how long it has run —
 *      before Vitest spends any time on browser launch, and instead of a
 *      silent hang if that owner turns out to be the orphaned kind. A lock
 *      left by a process that is no longer running is not an error here:
 *      `ReportsDirectoryLock.acquire()` already reclaims it itself.
 *   2. Reaps `chrome-headless-shell` processes reparented to pid 1 — a
 *      process can only get pid 1 as its parent once its OWN parent died, so
 *      this can never be a live run's browser; killing it is always safe,
 *      and removes hazard (b) before it can block the launch below.
 *   3. Runs Vitest as its own process GROUP (`detached: true`) under a hard
 *      wall-clock ceiling (`JEEX_COMPONENT_TIMEOUT_MS`, default
 *      `DEFAULT_COMPONENT_TIMEOUT_MS` = 10 minutes against a tier that costs
 *      385 s on an idle machine, see that constant). On timeout it
 *      kills the WHOLE group in one signal (negative pid) rather than only the
 *      top process, so a future timeout cannot itself create the orphans this
 *      script exists to clean up, and exits 1 with a message that reports the
 *      ceiling, the live browser count and the tier's known cost — and
 *      diagnoses nothing — instead of hanging "indefinitely" the way the
 *      standalone command did.
 *
 * `check.sh` and `.github/workflows/browser.yml` both still just run
 * `bun run test:component` — this script IS that npm script now (was
 * `vitest run --config vitest.config.ts` directly), so both the gate and CI
 * get the same protection with no change to either file, and the standalone
 * command terminates on its own rather than depending on a wrapper around
 * `check.sh` to do it.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/** Mirrors `ReportsDirectoryLock`'s own hashing exactly (16 hex chars of a sha256 of the resolved directory). */
export function lockPathFor(reportsDirectoryAbs: string, tmpBase: string = tmpdir()): string {
  const hash = createHash('sha256').update(reportsDirectoryAbs).digest('hex').slice(0, 16);
  return resolve(tmpBase.replace(/\/+$/, ''), `vitest-coverage-${hash}.lock`);
}

export type LockOwner = { readonly pid: number; readonly reportsDirectory: string };

/** Parses the JSON payload `ReportsDirectoryLock.tryWrite` writes; `undefined` for anything else (stale format, corrupt file). */
export function parseLockOwner(raw: string): LockOwner | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'pid' in parsed &&
      'reportsDirectory' in parsed &&
      typeof (parsed as { pid: unknown }).pid === 'number' &&
      typeof (parsed as { reportsDirectory: unknown }).reportsDirectory === 'string'
    ) {
      return { pid: (parsed as LockOwner).pid, reportsDirectory: (parsed as LockOwner).reportsDirectory };
    }
  } catch {
    // Not a lock file this script understands; treat as absent rather than fail the guard on it.
  }
  return undefined;
}

/** The message printed (and the process exited on) when a live, foreign process already owns the coverage directory. */
export function foreignLockMessage(owner: LockOwner, detail: string): string {
  return [
    `test:component: coverage directory "${owner.reportsDirectory}" is already locked by pid ${owner.pid}${detail ? ` (${detail})` : ''}.`,
    `Refusing to start rather than wait or hang: wait for pid ${owner.pid} to finish, or if it is a stale run from an earlier session, stop it (kill ${owner.pid}) and retry.`,
  ].join('\n');
}

export type OrphanCandidate = { readonly pid: number; readonly ppid: number; readonly command: string };

/** Parses `ps -Ao pid,ppid,command` (or an equivalent fixture) down to the `chrome-headless-shell` rows. */
export function parseOrphanCandidates(psOutput: string): OrphanCandidate[] {
  const candidates: OrphanCandidate[] = [];
  for (const line of psOutput.split('\n').slice(1)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const command = match[3] ?? '';
    if (!command.includes('chrome-headless-shell')) continue;
    candidates.push({ pid: Number(match[1]), ppid: Number(match[2]), command });
  }
  return candidates;
}

/** Only the candidates reparented to pid 1 — no live Vitest/Playwright run is ever a direct child of init, so these are always safe to kill. */
export function reparentedOrphans(candidates: readonly OrphanCandidate[]): OrphanCandidate[] {
  return candidates.filter((candidate) => candidate.ppid === 1);
}

/**
 * The watchdog's default ceiling.
 *
 * On an idle developer machine (nothing else running, port 3702 free) the
 * full tier costs about **385 s** at the `maxWorkers: 4` this repository pins,
 * so ten minutes leaves real headroom. A ceiling below the tier's own cost
 * kills every run, and because the kill lands on whichever test happens to be
 * slowest it reads as a flake.
 *
 * When the tier grows past this, the ceiling moves only after the same
 * measurement is repeated on an idle machine and written down here. It is
 * never raised to turn a red run green.
 */
export const DEFAULT_COMPONENT_TIMEOUT_MS = 600_000;

/**
 * What a full tier is known to cost, so the watchdog can print the comparison
 * that decides what its own firing means. Same measurement as
 * `DEFAULT_COMPONENT_TIMEOUT_MS`.
 */
export const MEASURED_TIER_COST_MS = 385_000;

/** A browser count of `-1` means `ps` could not be read: "unknown", never "none". */
export const BROWSER_COUNT_UNAVAILABLE = -1;

/**
 * What the watchdog prints when it fires.
 *
 * It reports what it measured — the ceiling it hit, how many
 * `chrome-headless-shell` processes were alive at that moment, and what the
 * tier last cost on an idle machine — and leaves the diagnosis to the reader.
 *
 * It asserts no cause: a run killed because the ceiling sat below the tier's
 * cost looks, from inside the watchdog, exactly like a run stuck behind
 * orphaned browsers. A watchdog cannot know why it fired; printing the two
 * numbers that separate "outgrew the ceiling" from "stuck before the first
 * test" is the most it can honestly do.
 */
export function watchdogTimeoutMessage(
  timeoutMs: number,
  liveBrowsers: number,
  measuredCostMs = MEASURED_TIER_COST_MS,
  shard?: string,
): string {
  const minutes = (timeoutMs / 60_000).toFixed(1);
  const measuredSeconds = (measuredCostMs / 1000).toFixed(0);
  const browsers =
    liveBrowsers === BROWSER_COUNT_UNAVAILABLE
      ? 'live chrome-headless-shell processes: count unavailable (ps could not be read)'
      : `live chrome-headless-shell processes: ${liveBrowsers}`;
  // A shard's ceiling is set by whoever split the tier (CI's workflow), and
  // the whole tier's cost on a developer machine says nothing about one part
  // of it on another machine: the comparison below would mislead.
  const comparison =
    shard === undefined
      ? `If the elapsed time is near that ${measuredSeconds} s, the tier has outgrown the ceiling: re-measure on an idle machine and raise the default in this file.`
      : `This run is shard ${shard} of the tier, so that number does not apply: if the shard has outgrown its ceiling, re-measure the shard on the machine that runs it and raise the JEEX_COMPONENT_TIMEOUT_MS the caller sets.`;
  return [
    `test:component: killed after ${minutes} min, its JEEX_COMPONENT_TIMEOUT_MS ceiling. The whole process group went with it, so this kill leaves no orphan behind.`,
    `Measured at the kill: ${browsers}. The full tier last cost ${measuredSeconds} s on an idle machine.`,
    `${comparison} If it is far below and the browser count is 0, the browser launch never completed; above 0 with no test finished, look for a foreign hold on the software rasteriser.`,
    'If only the two boot lines (API started at …, Coverage enabled with v8) appear above this kill, re-run with --reporter=verbose to see each test as it lands.',
  ].join('\n');
}

/** The `<index>/<count>` of a `--shard` among Vitest's arguments, either spelling; `undefined` when the run is not sharded. */
export function shardOf(args: readonly string[]): string | undefined {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg.startsWith('--shard=')) return arg.slice('--shard='.length);
    if (arg === '--shard') return args[at + 1];
  }
  return undefined;
}

/**
 * The ceiling `JEEX_COMPONENT_TIMEOUT_MS` asks for, or the default when it asks
 * for nothing usable.
 *
 * `Number(raw ?? DEFAULT)` was not enough, and the failure mode was the exact
 * one this file exists to prevent: `??` only catches `undefined`, so
 * `JEEX_COMPONENT_TIMEOUT_MS=` (a valueless entry in a CI config or a shell
 * export) gives `Number('') === 0`, a non-numeric value gives `NaN`, and
 * `setTimeout` rounds both up to 1 ms — every component run would be killed at
 * launch and report itself as a timeout. Anything not finite and positive
 * therefore falls back to the default rather than to zero.
 */
export function resolveTimeoutMs(raw: string | undefined, fallbackMs: number = DEFAULT_COMPONENT_TIMEOUT_MS): number {
  if (raw === undefined) return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

// ---------------------------------------------------------------------------
// I/O shell — everything above is pure and unit-tested in
// `run-component-tests.test.ts`; everything below is real process/filesystem
// access, exercised by hand against real child processes.
// ---------------------------------------------------------------------------

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process — genuinely dead, safe to reclaim.
    // EPERM: the process exists but is owned by someone else (a stray pid-1
    // reuse, or a test's own scan hitting a root-owned pid) — it is alive,
    // just not ours to signal; treating that as "dead" is exactly the bug a
    // manual reproduction caught here (a fabricated lock naming pid 1 was let
    // through instead of blocked).
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function psDetail(pid: number): string {
  try {
    const out = execFileSync('ps', ['-o', 'etime=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return out ? `etime ${out}` : 'process still running';
  } catch {
    return 'process still running';
  }
}

function guardAgainstForeignLock(): void {
  const reportsDirectory = resolve(process.cwd(), 'coverage-component');
  const lockFile = lockPathFor(reportsDirectory);
  if (!existsSync(lockFile)) return;
  const owner = parseLockOwner(readFileSync(lockFile, 'utf8'));
  if (!owner || owner.pid === process.pid) return;
  if (!isProcessAlive(owner.pid)) return; // Vitest's own ReportsDirectoryLock.acquire() reclaims a dead owner's lock.
  console.error(foreignLockMessage(owner, psDetail(owner.pid)));
  process.exit(1);
}

/**
 * The process table, or `undefined` when `ps` cannot be read.
 *
 * One place for the invocation, because the two callers want opposite things
 * from a failure — the reaper skips its work, the diagnostic count reports
 * "unknown" — and a flag changed for one of them must not silently skew the
 * other.
 */
function readProcessTable(): string | undefined {
  try {
    return execFileSync('ps', ['-Ao', 'pid,ppid,command'], { encoding: 'utf8' });
  } catch {
    return undefined;
  }
}

function reapOrphanedBrowsers(): void {
  const psOutput = readProcessTable();
  if (psOutput === undefined) return; // Best-effort: a `ps` failure never blocks the run.
  for (const orphan of reparentedOrphans(parseOrphanCandidates(psOutput))) {
    try {
      process.kill(orphan.pid, 'SIGKILL');
      console.error(`test:component: reaped orphaned chrome-headless-shell pid ${orphan.pid} (reparented to init) before launch.`);
    } catch {
      // Already gone between the scan and the kill — fine.
    }
  }
}

/** How many `chrome-headless-shell` processes are alive right now, for the watchdog's message. */
function liveBrowserCount(): number {
  const psOutput = readProcessTable();
  // Never report 0 for "ps failed": 0 is a diagnosis in that message.
  if (psOutput === undefined) return BROWSER_COUNT_UNAVAILABLE;
  return parseOrphanCandidates(psOutput).length;
}

function runVitestUnderWatchdog(): void {
  const timeoutMs = resolveTimeoutMs(process.env['JEEX_COMPONENT_TIMEOUT_MS']);
  const extraArgs = process.argv.slice(2);
  const child = spawn('bunx', ['vitest', 'run', '--config', 'vitest.config.ts', ...extraArgs], {
    stdio: 'inherit',
    detached: true,
  });

  const timer = setTimeout(() => {
    console.error(watchdogTimeoutMessage(timeoutMs, liveBrowserCount(), MEASURED_TIER_COST_MS, shardOf(extraArgs)));
    if (typeof child.pid === 'number') {
      try {
        process.kill(-child.pid, 'SIGKILL'); // Negative pid: the whole process group, browser children included.
      } catch {
        // Already gone.
      }
    }
    process.exit(1);
  }, timeoutMs);
  timer.unref();

  child.on('error', (error) => {
    clearTimeout(timer);
    console.error(`test:component: failed to start Vitest: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    if (signal) {
      console.error(`test:component: Vitest exited on signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

if (import.meta.main) {
  guardAgainstForeignLock();
  reapOrphanedBrowsers();
  runVitestUnderWatchdog();
}
