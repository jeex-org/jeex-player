/**
 * The iframe transport across a REAL document boundary — real `postMessage`,
 * real structured clone, real `event.source` and `event.origin`, real async
 * delivery.
 *
 * `src/embed/host.test.ts` and `src/embed/frame-bridge.test.ts` (bun) test each
 * side against a fake window, thoroughly, and they stay: they can drive
 * timings a browser cannot. What they cannot show is that a message really
 * crosses. Here:
 *
 * - the HOST side (`embedViewer`) drives a real iframe of `frame-stub.html`, a
 *   page that speaks the wire and nothing else;
 * - the FRAME side (`installFrameBridge`) wraps a REAL mounted viewer and is
 *   driven by a real second window posting into this one.
 *
 * Both sides being the real code in one page is the Playwright suite's job
 * (`tests/e2e/embed-iframe.spec.ts`): under Browser Mode the module graph is
 * served instrumented, and `embed.html` in a nested frame cannot run it.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  embedViewer,
  EmbedError,
  HOST_PARAM,
  QUEUE_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  VIEWER_ID_PARAM,
  type JeexEmbed,
} from '../../src/embed/host.js';
import { installFrameBridge } from '../../src/embed/frame-bridge.js';
import { embedPageOptions, hostOriginFrom } from '../../src/embed/frame-page.js';
import { CHANNEL, PROTOCOL_VERSION, commandReply, type JeexMessage } from '../../src/embed/protocol.js';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { closeContainers, delay, demoScene, openContainer, parkForExport, until } from './support.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { L_SHAPE } from '../../src/fixtures/plan-l-shape-ids.js';
import { MAX_SCENE_BYTES } from '../../src/shared/limits.js';
import type { SceneData } from '../../src/scene/types.js';

const STUB = '/tests/component/frame-stub.html';

/** The scene id `frame-stub.html` reports in its `ready` event (the same literal is written there). */
const STUB_SCENE_ID = '01a12ffa-de51-7028-923d-5dd489ef10bf';

/**
 * The scene the protocol tests mount, and why it is NOT the demo apartment.
 *
 * The subject here is the wire, not the content: a command crosses, a reply
 * comes back, the who-check drops a stranger. What the viewer is drawing while
 * that happens is irrelevant to every assertion below, and it must not decide
 * the clock either. The demo apartment costs hundreds of milliseconds per
 * frame on SwiftShader, several times what `lShapePlan` costs, with
 * multi-second spikes after the scene lands; a wait that polls once per
 * animation frame (`until`, `support.ts`) would then expire under parallel
 * load. So the protocol tests mount this light fixture, which keeps their cost
 * independent of how heavy the demo apartment grows, and they wait on the
 * counterparty's `message` event rather than on frames (`arrived` below),
 * which keeps it independent of the frame RATE.
 *
 * The apartment keeps ONE test — «the viewer's ready event crosses» — because
 * the file's claim is that the bridge wraps a REAL viewer, and that is the test
 * which reads the scene's own id off the wire.
 */
const fixtureScene = (): SceneData => lShapePlan;

type StubWindow = Window & { jeexReceived?: Array<{ id: string; method: string; params?: Record<string, unknown>; origin: string }> };

const embeds: JeexEmbed[] = [];
const handles: ViewerHandle[] = [];
const uninstalls: Array<() => void> = [];
const frames: HTMLIFrameElement[] = [];

function embed(options: Record<string, unknown> = {}): JeexEmbed {
  const handle = embedViewer(openContainer(640, 420), { src: STUB, ...options });
  embeds.push(handle);
  return handle;
}

/**
 * What the HOST'S CODE asked of the frame: the stub's record without the
 * telemetry `context` the helper posts on its own when the frame loads (its
 * own test is below).
 */
function hostCommands(stub: StubWindow): NonNullable<StubWindow['jeexReceived']> {
  return (stub.jeexReceived ?? []).filter((entry) => entry.method !== 'context');
}

/** The stub's own record of what it was sent, once it has booted. */
async function stubOf(handle: JeexEmbed): Promise<StubWindow> {
  const stub = (): StubWindow => handle.iframe.contentWindow as StubWindow;
  await until(() => stub().jeexReceived !== undefined, 'the stub frame to boot');
  return stub();
}

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) uninstall();
  for (const handle of embeds.splice(0)) handle.dispose();
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const frame of frames.splice(0)) frame.remove();
  closeContainers();
});

/**
 * What `main-embed.ts` does with its own query string, in a real browser.
 *
 * The page entry is three lines of wiring over these two functions, and both
 * are TRUST decisions the bun suite already pins in detail. What only a
 * document can show is the pair working together the way the page uses them:
 * a refused origin means no bridge is installed AT ALL, and a real
 * `postMessage` is never reached with a target it would throw on.
 */
describe('the embed page’s own query string', () => {
  test('a valid host origin installs a bridge that answers that origin', async () => {
    const handle = mountViewer(openContainer(), {
      scene: { repository: new InlineSceneRepository(fixtureScene()) },
      tour: { mode: 'off' },
      debug: false,
    });
    handles.push(handle);
    const query = new URLSearchParams(`host=${window.location.origin}&viewerId=v-page`);
    const origin = hostOriginFrom(query, HOST_PARAM);
    expect(origin).toBe(window.location.origin);
    const uninstall = installFrameBridge(handle, { hostOrigin: origin!, target: window, viewerId: 'v-page' });
    uninstalls.push(uninstall);
    await handle.ready;
  });

  test('a wildcard or malformed host installs nothing and says which value was refused', () => {
    for (const raw of ['*', 'null', 'notanorigin', `${window.location.origin}/`]) {
      const refused: string[] = [];
      const origin = hostOriginFrom(new URLSearchParams(`host=${encodeURIComponent(raw)}`), HOST_PARAM, (value) => refused.push(value));
      expect(origin).toBeNull();
      expect(refused).toEqual([raw]);
    }
  });

  test('the bridge refuses an origin the page would never have handed it', () => {
    const handle = mountViewer(openContainer(), {
      scene: { repository: new InlineSceneRepository(fixtureScene()) },
      tour: { mode: 'off' },
      debug: false,
    });
    handles.push(handle);
    // Belt and braces: `main-embed.ts` filters, and the bridge refuses anyway.
    expect(() => installFrameBridge(handle, { hostOrigin: '*', target: window })).toThrow(/hostOrigin/);
  });

  test('the embed page never carries the authoring capability off a URL', () => {
    const options = embedPageOptions('?debug=1&view=walk&lang=ru');
    expect('debug' in options).toBe(false);
    expect(options.view?.mode).toBe('walk');
    expect(options.locale).toBe('ru');
  });
});

describe('the host handle’s own logging', () => {
  test('a throwing listener is contained and reported on `onLog`, and the others still run', async () => {
    const entries: Array<{ level: string; code: string }> = [];
    // `ready` is the one event the stub raises unasked, so it is what a
    // throwing subscriber is proven against here.
    const handle = embed({ onLog: (entry: { level: string; code: string }) => entries.push(entry) });
    const seen: unknown[] = [];
    handle.on('ready', () => {
      throw new Error('host page bug');
    });
    handle.on('ready', (info) => seen.push(info));
    await handle.ready;
    await until(() => seen.length > 0, 'the second subscriber');
    // The stub is served from this page's own origin, so the handle's first
    // entry is its build-time `same-origin-frame` warning; the listener's
    // failure is the one after it.
    expect(entries.map((entry) => entry.code)).toEqual(['same-origin-frame', 'listener-failed']);
    expect(entries.map((entry) => entry.level)).toEqual(['warn', 'error']);
  });

  test('and it goes to the console, prefixed, when the host named no sink', async () => {
    // The ONE place the default sink is asserted: everything else injects one.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handle = embed();
    handle.on('ready', () => {
      throw new Error('host page bug');
    });
    await handle.ready;
    await until(() => spy.mock.calls.length > 0, 'the console line');
    expect(String(spy.mock.calls[0]?.[0])).toContain('[jeex-viewer] listener-failed');
    spy.mockRestore();
  });
});

describe('the id a frame answers to', () => {
  test('is generated per call, so a host that names none still gets two frames', () => {
    const left = embed();
    const right = embed();
    expect(left.viewerId).not.toBe(right.viewerId);
    expect(new URL(left.iframe.src).searchParams.get(VIEWER_ID_PARAM)).toBe(left.viewerId);
    expect(new URL(right.iframe.src).searchParams.get(VIEWER_ID_PARAM)).toBe(right.viewerId);
  });

  test('a second frame under an id already in use is refused', () => {
    embed({ viewerId: 'taken' });
    let failure: unknown;
    try {
      embed({ viewerId: 'taken' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(EmbedError);
    expect((failure as EmbedError).code).toBe('bad-params');
  });
});

describe('an inline document across the real boundary', () => {
  test('one over the fetch cap is refused before it is cloned', async () => {
    const handle = embed();
    await handle.ready;
    const huge = { schemaVersion: '2.0', padding: 'x'.repeat(MAX_SCENE_BYTES + 1) };
    const failure = await handle.loadScene({ document: huge }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmbedError);
    expect((failure as EmbedError).code).toBe('bad-params');
    const stub = await stubOf(handle);
    expect(hostCommands(stub).map((entry) => entry.method)).toEqual([]);
  });

  test('one the browser cannot clone rejects with bad-params rather than throwing out of send', async () => {
    // A REAL structured clone, which is the point of testing this here: a
    // function on the document makes `postMessage` throw `DataCloneError`
    // synchronously, and a host expects a rejected promise.
    const handle = embed();
    await handle.ready;
    const unclonable = { schemaVersion: '2.0', hook: () => undefined };
    const failure = await handle.loadScene({ document: unclonable }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmbedError);
    expect((failure as EmbedError).code).toBe('bad-params');
    expect((failure as EmbedError).message).toMatch(/cloned/);
  });

  test('one within the cap really crosses', async () => {
    const handle = embed();
    await handle.ready;
    void handle.loadScene({ document: { schemaVersion: '2.0' } });
    const stub = await stubOf(handle);
    await until(() => stub.jeexReceived!.some((entry) => entry.method === 'loadScene'), 'the loadScene command');
    const sent = stub.jeexReceived!.find((entry) => entry.method === 'loadScene')!;
    expect((sent.params as { document: { schemaVersion: string } }).document.schemaVersion).toBe('2.0');
  });
});

describe('the host side, against a real frame', () => {
  test('builds the frame with the host origin, the viewer id and the options in its query', () => {
    const handle = embed({ viewerId: 'v-query', view: 'walk', minimap: false, tourStart: 0.25 });
    const url = new URL(handle.iframe.src);
    expect(url.searchParams.get(HOST_PARAM)).toBe(window.location.origin);
    expect(url.searchParams.get(VIEWER_ID_PARAM)).toBe('v-query');
    expect(url.searchParams.get('view')).toBe('walk');
    expect(url.searchParams.get('minimap')).toBe('false');
    expect(url.searchParams.get('tourStart')).toBe('0.25');
    // `src`, `viewerId` and `allowFullscreen` configure the EMBED; forwarding
    // them as viewer options would be a second dialect of the option schema.
    expect(url.searchParams.get('src')).toBeNull();
    expect(handle.iframe.getAttribute('allow')).toBe('fullscreen');
    expect(handle.iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(handle.iframe.isConnected).toBe(true);
  });

  test('allowFullscreen:false leaves the permission off', () => {
    expect(embed({ allowFullscreen: false }).iframe.hasAttribute('allow')).toBe(false);
  });

  test('the helper hands the frame its page path once the frame has loaded, and not with analytics off', async () => {
    const on = embed();
    const onStub = await stubOf(on);
    await until(() => (onStub.jeexReceived ?? []).some((entry) => entry.method === 'context'), 'the context command');
    expect(onStub.jeexReceived!.find((entry) => entry.method === 'context')?.params).toEqual({ page: window.location.pathname });
    // The path travels by postMessage alone: the frame URL carries only the bridge's own two parameters.
    expect([...new URL(on.iframe.src).searchParams.keys()].sort()).toEqual(['host', 'viewerId']);
    const off = embed({ viewerId: 'quiet', analytics: 'off' });
    const offStub = await stubOf(off);
    await off.ready;
    expect((offStub.jeexReceived ?? []).some((entry) => entry.method === 'context')).toBe(false);
  });

  test('ready resolves with what the frame reported', async () => {
    const info = await embed().ready;
    expect(info.sceneId).toBe(STUB_SCENE_ID);
    expect(info.options).toEqual({ locale: 'en' });
  });

  test('commands issued before ready are queued and flushed in order', async () => {
    // Called on the line after `embedViewer`, deliberately: the queue is what
    // makes that legal, and a slow boot is when it matters.
    const handle = embed({ readyDelay: 250 });
    const answers = await Promise.all([handle.getMode(), handle.setMode('walk'), handle.progress()]);
    const stub = await stubOf(handle);
    expect(hostCommands(stub).map((entry) => entry.method)).toEqual(['getMode', 'setMode', 'progress']);
    expect(answers[0]).toBe('orbit');
    expect(answers[2]).toEqual({ fraction: 0.25, elapsed: 5, duration: 20, state: 'paused' });
  });

  test('every command reaches the frame with its parameters, addressed to this origin', async () => {
    const handle = embed({ viewerId: 'p1' });
    await handle.ready;
    await handle.seek(0.4);
    await handle.setLocale('ru');
    await handle.setFurnitureVisible(false);
    const stub = await stubOf(handle);
    expect(hostCommands(stub).map((entry) => [entry.method, entry.params])).toEqual([
      ['seek', { fraction: 0.4 }],
      ['setLocale', { locale: 'ru' }],
      ['setFurnitureVisible', { visible: false }],
    ]);
    expect(new Set(hostCommands(stub).map((entry) => entry.origin))).toEqual(new Set([window.location.origin]));
  });

  test('a rejected command rejects with the frame’s own code', async () => {
    const handle = embed();
    await handle.ready;
    // The stub refuses a `focusRoom` with no `roomId`, which is what the real
    // frame's parameter guard does.
    await expect((handle as unknown as { focusRoom(id: unknown): Promise<boolean> }).focusRoom(undefined)).rejects.toMatchObject({
      name: 'EmbedError',
      code: 'bad-params',
    });
  });

  test('a frame that never answers times out rather than leaving the promise pending', async () => {
    // `silent=1` answers nothing at all, `ready` included, so the command never
    // leaves the queue — and the QUEUE has a window of its own, or a frame that
    // never boots would hold the promise for the life of the page.
    vi.useFakeTimers();
    try {
      const handle = embedViewer(openContainer(320, 240), { src: STUB, silent: '1' });
      embeds.push(handle);
      const pending = handle.progress();
      await vi.advanceTimersByTimeAsync(QUEUE_TIMEOUT_MS + 100);
      await expect(pending).rejects.toMatchObject({ name: 'EmbedError', code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  test('the reply clock starts when the command is POSTED, so a slow boot does not fail it', async () => {
    // The bug this pins: `send()` armed the reply timer before it decided to
    // queue, so a frame that took longer than `REPLY_TIMEOUT_MS` to boot failed
    // every command a host issued eagerly — which is exactly what the queue
    // exists to make legal. Two windows now: `QUEUE_TIMEOUT_MS` covers the
    // boot, `REPLY_TIMEOUT_MS` the round trip.
    vi.useFakeTimers();
    try {
      const handle = embedViewer(openContainer(320, 240), { src: STUB, readyDelay: String(REPLY_TIMEOUT_MS * 2) });
      embeds.push(handle);
      const pending = handle.getMode();
      await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS * 2 + 100);
      await expect(pending).resolves.toBe('orbit');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a forged reply from another window does not settle a command in flight', async () => {
    const handle = embed();
    await handle.ready;
    const pending = handle.getMode();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: commandReply('jeex', 'c1', { ok: true, result: 'forged' }),
        origin: 'https://attacker.example',
        source: window,
      }),
    );
    await expect(pending).resolves.toBe('orbit');
  });

  test('a message that is not this protocol leaves the host working', async () => {
    const handle = embed();
    await handle.ready;
    window.dispatchEvent(new MessageEvent('message', { data: { hello: 'world' }, origin: window.location.origin, source: window }));
    window.dispatchEvent(new MessageEvent('message', { data: 'a string', origin: window.location.origin, source: window }));
    await expect(handle.getMode()).resolves.toBe('orbit');
  });

  test('an event for another viewer id is not delivered to this host', async () => {
    const handle = embed({ viewerId: 'mine' });
    await handle.ready;
    const seen: unknown[] = [];
    handle.on('mode', (mode) => seen.push(mode));
    handle.iframe.contentWindow!.postMessage(
      { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId: 'someone-else', kind: 'event', event: 'mode', payload: 'walk' },
      window.location.origin,
    );
    await delay(50);
    expect(seen).toEqual([]);
  });

  test('dispose removes the iframe, tells listeners, and rejects further commands', async () => {
    const handle = embed();
    await handle.ready;
    const disposals: number[] = [];
    handle.on('disposed', () => disposals.push(1));
    const iframe = handle.iframe;
    handle.dispose();
    // Told synchronously, before the listeners are cleared.
    expect(disposals.length).toBe(1);
    expect(iframe.isConnected).toBe(false);
    await expect(handle.getMode()).rejects.toBeInstanceOf(EmbedError);
  });

  test('two frames on one page keep their own ids and their own replies', async () => {
    const left = embed({ viewerId: 'left' });
    const right = embed({ viewerId: 'right' });
    await Promise.all([left.ready, right.ready]);
    await left.setMode('walk');
    const leftStub = await stubOf(left);
    const rightStub = await stubOf(right);
    expect(hostCommands(leftStub).map((entry) => entry.method)).toEqual(['setMode']);
    expect(hostCommands(rightStub)).toEqual([]);
    left.dispose();
    await expect(right.getMode()).resolves.toBe('orbit');
  });
});

/**
 * A second real window on this origin, with a hand to post from inside it.
 *
 * `about:blank` inherits this origin, and the posting function is created in
 * the CHILD's realm, so `event.source` really is the child window — which is
 * exactly what the bridge's who-check reads.
 */
async function counterpartyWindow(): Promise<{ window: Window; post: (message: unknown) => void }> {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });
  // `srcdoc` rather than a served page: an `srcdoc` frame inherits the
  // embedder's origin, which is what makes it a same-origin counterparty, and
  // it needs no file on disk.
  frame.srcdoc = '<script>window.jeexPost = function (message, origin) { parent.postMessage(message, origin); };</script>';
  await loaded;
  const child = frame.contentWindow as Window & { jeexPost(message: unknown, origin: string): void };
  return { window: child, post: (message) => child.jeexPost(message, window.location.origin) };
}

describe('the frame side, wrapping a real viewer', () => {
  const VIEWER_ID = 'framed';
  /** The same 15 s `until` allows, on a timer rather than on frames. */
  const ARRIVAL_TIMEOUT_MS = 15_000;
  /**
   * What a command that really renders is allowed. Everything else here is
   * answered from a listener continuation and owes a reply within a task; a
   * capture owes two render passes and a PNG encode on a rasteriser twelve
   * pages are sharing, and 15 s is not that.
   */
  const CAPTURE_TIMEOUT_MS = 45_000;

  type Bridged = {
    handle: ViewerHandle;
    posted: JeexMessage[];
    post: (message: unknown) => void;
    arrived: (match: (message: JeexMessage) => boolean, what: string, timeoutMs?: number) => Promise<void>;
  };

  /** The two shapes every wait below is for. */
  const isReply =
    (id: string) =>
    (message: JeexMessage): boolean =>
      message.kind === 'reply' && message.id === id;
  const isEvent =
    (event: string) =>
    (message: JeexMessage): boolean =>
      message.kind === 'event' && message.event === event;

  /**
   * A real mounted viewer with the bridge pointed at a real second window.
   *
   * `scene` defaults to the fixture for the reason the table above measures;
   * the one smoke test that needs the demo apartment names it.
   *
   * The counterparty window is opened BEFORE the mount, and the bridge is
   * installed in the same task as `mountViewer`, the order `frame-boot.ts`
   * uses. The other way round loses the `ready` event: a `srcdoc` frame's
   * `load` is dispatched only once the page's main thread is free, and on the
   * software rasteriser that is after the mount's first frame. Measured with
   * the demo apartment: `ready` fired at 2093 ms, the frame's `load` at
   * 2095 ms, so a bridge installed after `load` never saw it and the test
   * waited out its 45 s.
   */
  async function bridged(scene: SceneData = fixtureScene(), options: Record<string, unknown> = {}): Promise<Bridged> {
    const counterparty = await counterpartyWindow();
    const handle = mountViewer(openContainer(), {
      scene: { repository: new InlineSceneRepository(scene) },
      tour: { mode: 'off' },
      debug: false,
      ...options,
    });
    handles.push(handle);
    const posted: JeexMessage[] = [];
    // Everything the bridge posts arrives in the counterparty window; this
    // listener runs there and hands it back. Registered FIRST, so a waiter
    // below always finds the message already in `posted` when it wakes.
    counterparty.window.addEventListener('message', (event: MessageEvent) => posted.push(event.data as JeexMessage));
    uninstalls.push(installFrameBridge(handle, { hostOrigin: window.location.origin, target: counterparty.window, viewerId: VIEWER_ID }));
    /**
     * Waits for a message the counterparty really received, on that window's
     * own `message` event — NOT on `until`.
     *
     * `until` polls once per animation frame (`support.ts:104`), which makes a
     * rendered frame the unit of the wait. That is right for anything the
     * render loop produces and wrong for everything here: the bridge answers
     * from the `message` listener's own promise continuation
     * (`frame-bridge.ts:258`), never from the frame loop, so a reply is owed
     * within a task of the command whatever the renderer is doing.
     *
     * The difference is not academic. All fifteen component files share ONE
     * Chromium GPU process — SwiftShader lives in it, measured at 129 % CPU
     * with every renderer under 8 % — so a frame here costs whatever the other
     * files' viewers owe that process: 39 ms on a quiet page, seconds during
     * the tier. Polling on frames spent the whole 15 s budget in a handful of
     * polls; the four gate timeouts at `support.ts:103` were all of this shape.
     *
     * Same budget, honest clock: a real timer, and the wait ends the moment the
     * message lands.
     */
    const arrived = (match: (message: JeexMessage) => boolean, what: string, timeoutMs = ARRIVAL_TIMEOUT_MS): Promise<void> =>
      new Promise((resolve, reject) => {
        if (posted.some((message) => match(message))) {
          resolve();
          return;
        }
        const listener = new AbortController();
        const timer = setTimeout(() => {
          listener.abort();
          reject(new Error(`timed out after ${String(timeoutMs)} ms waiting for ${what}`));
        }, timeoutMs);
        counterparty.window.addEventListener(
          'message',
          (event: MessageEvent) => {
            if (!match(event.data as JeexMessage)) return;
            clearTimeout(timer);
            listener.abort();
            resolve();
          },
          { signal: listener.signal },
        );
      });
    return { handle, posted, post: counterparty.post, arrived };
  }

  function command(id: string, method: string, params?: Record<string, unknown>, viewerId = VIEWER_ID): Record<string, unknown> {
    const message: Record<string, unknown> = { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId, kind: 'command', id, method };
    if (params) message['params'] = params;
    return message;
  }

  function replyTo(posted: JeexMessage[], id: string): Extract<JeexMessage, { kind: 'reply' }> | undefined {
    return posted.find((message): message is Extract<JeexMessage, { kind: 'reply' }> => message.kind === 'reply' && message.id === id);
  }

  // The file's one smoke test on the real demo apartment: the bridge really
  // wraps the viewer the product ships, and the scene's own id crosses the wire.
  //
  // Its budgets are declared here rather than raised on the file's shared
  // ones because the cost is that apartment boot, not the reply: the test
  // awaits `handle.ready` first, so the event has usually already been
  // posted and the wait resolves straight from the buffer.
  test('the viewer’s ready event crosses to the other window', async () => {
    const { handle, posted, arrived } = await bridged(demoScene());
    await handle.ready;
    await arrived(isEvent('ready'), 'the ready event', 45_000);
    const ready = posted.find((message) => message.kind === 'event' && message.event === 'ready')!;
    expect(ready.viewerId).toBe(VIEWER_ID);
    expect((ready as { payload: { sceneId: string } }).payload.sceneId).toBe(demoScene().id);
  }, 90_000);

  test('a command from the other window is performed and answered', async () => {
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    post(command('a1', 'setMode', { mode: 'walk' }));
    await arrived(isReply('a1'), 'the reply to setMode');
    expect(replyTo(posted, 'a1')!.ok).toBe(true);
    expect(handle.getMode()).toBe('walk');
  });

  test('setSelection reaches the handle, and a select event reaches the host', async () => {
    const { handle, posted, post, arrived } = await bridged(fixtureScene(), { select: true });
    await handle.ready;
    const setSelection = vi.spyOn(handle, 'setSelection');

    post(command('sel1', 'setSelection', { target: { kind: 'wall', id: L_SHAPE.wall.wPart } }));
    await arrived(isReply('sel1'), 'the reply to setSelection with a target');
    expect(replyTo(posted, 'sel1')!.ok).toBe(true);
    expect(setSelection).toHaveBeenCalledWith({ kind: 'wall', id: L_SHAPE.wall.wPart });

    post(command('sel2', 'setSelection', { target: null }));
    await arrived(isReply('sel2'), 'the reply to setSelection with null');
    expect(replyTo(posted, 'sel2')!.ok).toBe(true);
    expect(setSelection).toHaveBeenCalledWith(null);

    // A real click on the canvas raises `select` on the handle, which the
    // bridge forwards as an event message — the same wire `mode`/`scene` use.
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    const box = canvas.getBoundingClientRect();
    const id = 8801;
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        button: 0,
        pointerId: id,
        bubbles: true,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointerup', {
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        button: 0,
        pointerId: id,
        bubbles: true,
      }),
    );
    await arrived(isEvent('select'), 'the select event');
    const event = posted.find((message) => message.kind === 'event' && message.event === 'select')!;
    expect((event as { payload: { mode: string } }).payload.mode).toBe('orbit');
  });

  test('progress round-trips through the real tour controls', async () => {
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    post(command('a2', 'progress'));
    await arrived(isReply('a2'), 'the reply to progress');
    const result = replyTo(posted, 'a2')!.result as { fraction: number; duration: number };
    expect(result.fraction).toBeGreaterThanOrEqual(0);
    expect(result.fraction).toBeLessThanOrEqual(1);
    expect(result.duration).toBeGreaterThan(0);
  });

  test('a command addressed to another viewer is dropped, and the next one is still answered', async () => {
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    post(command('stray', 'getMode', undefined, 'someone-else'));
    post(command('real', 'getMode'));
    await arrived(isReply('real'), 'the reply to the addressed command');
    expect(replyTo(posted, 'stray')).toBeUndefined();
    expect(replyTo(posted, 'real')!.result).toBe('orbit');
  });

  test('a message from this window rather than the counterparty is ignored', async () => {
    const { handle, posted } = await bridged();
    await handle.ready;
    // Same origin, same protocol, same viewer — but the wrong SOURCE, which is
    // the first half of the who-check.
    window.postMessage(command('self', 'getMode'), window.location.origin);
    await delay(100);
    expect(replyTo(posted, 'self')).toBeUndefined();
  });

  /**
   * The three capture commands in ONE mount, on a budget of their own.
   *
   * A capture is the only command here that costs real GPU work — two render
   * passes and a PNG encode — on top of the mount, and the tier's twelve pages
   * share one software rasteriser. Three mounts with a capture each timed the
   * file out; one mount with three commands and a wait sized for the work does
   * not, and it still proves everything the three did.
   */
  test('the capture commands cross the boundary, PNG bytes and provenance in one reply', { timeout: 90_000 }, async () => {
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    post(command('a20', 'captureStill', { width: 96, height: 64, camera: 'presentation' }));
    await arrived(isReply('a20'), 'the reply to captureStill', CAPTURE_TIMEOUT_MS);
    const still = replyTo(posted, 'a20')!;
    expect(still.ok).toBe(true);
    const stillResult = still.result as { png: ArrayBuffer; provenance: { kind: string; sceneId: string; disclosure: string } };
    // A structured clone, not a data URL: the bytes arrive as an ArrayBuffer
    // the host can wrap in a Blob without decoding base64 first. Asserted by
    // SHAPE, never with `instanceof`: the clone is created in the receiving
    // realm, and a cross-realm `instanceof` is false.
    expect(typeof stillResult.png.byteLength).toBe('number');
    expect(new Uint8Array(stillResult.png).subarray(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
    expect(stillResult.provenance.kind).toBe('still');
    expect(stillResult.provenance.sceneId).toBe(fixtureScene().id);
    expect(stillResult.provenance.disclosure).toBe('rendered-3d');

    post(command('a21', 'capturePanorama', { width: 128, roomId: L_SHAPE.room.a, caption: false }));
    await arrived(isReply('a21'), 'the reply to capturePanorama', CAPTURE_TIMEOUT_MS);
    const panorama = replyTo(posted, 'a21')!;
    expect(panorama.ok).toBe(true);
    const panoramaResult = panorama.result as { png: ArrayBuffer; provenance: { kind: string; roomId: string } };
    expect(panoramaResult.png.byteLength).toBeGreaterThan(0);
    expect(panoramaResult.provenance.kind).toBe('panorama');
    expect(panoramaResult.provenance.roomId).toBe(L_SHAPE.room.a);

    // A malformed request never reaches the renderer: it is answered from the
    // parameter check, which is why it shares this test's one mount.
    post(command('a22', 'captureStill', { width: 96 }));
    await arrived(isReply('a22'), 'the reply to the malformed captureStill', CAPTURE_TIMEOUT_MS);
    expect(replyTo(posted, 'a22')!.error?.code).toBe('bad-params');
  });

  test('a method this version does not have is answered unknown-method', async () => {
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    post(command('a3', 'teleport'));
    await arrived(isReply('a3'), 'the reply to the unknown method');
    expect(replyTo(posted, 'a3')!.error).toEqual({ code: 'unknown-method', message: 'no method teleport' });
  });

  test('getState crosses as ONE reply carrying the whole reading', async () => {
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    handle.setMode('walk');
    handle.setFurnitureVisible(false);
    post(command('a8', 'getState'));
    await arrived(isReply('a8'), 'the reply to getState');
    const reply = replyTo(posted, 'a8')!;
    expect(reply.ok).toBe(true);
    expect(reply.result).toMatchObject({
      mode: 'walk',
      furnitureVisible: false,
      locale: 'en',
      sceneId: fixtureScene().id,
      rev: 0,
    });
  });

  test('getScene crosses as ONE reply carrying the committed document', async () => {
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    post(command('a9', 'getScene'));
    await arrived(isReply('a9'), 'the reply to getScene');
    const reply = replyTo(posted, 'a9')!;
    expect(reply.ok).toBe(true);
    expect(reply.result).toMatchObject({ schemaVersion: '2.2', id: fixtureScene().id });
  });

  test('exportGlb crosses the real boundary as an ArrayBuffer', async () => {
    // The one command whose RESULT is binary: real structured clone across a
    // real second window, not the fake `postMessage` the bun-side tests use,
    // is what proves an `ArrayBuffer` (never a `Blob`, which the bridge
    // converts from before posting) really survives the trip.
    //
    // `reply.result` deserialises in the COUNTERPARTY realm's structured-clone
    // deserialiser — the listener that captured it runs on `counterparty.window`
    // — so it is an `ArrayBuffer` of THAT window's global, not this file's; a
    // cross-realm `instanceof ArrayBuffer` is false the same way a cross-realm
    // `instanceof DOMException` is.
    // `Object.prototype.toString` and `Uint8Array`'s constructor both go by the
    // internal slot, not the prototype chain, so they see it correctly either way.
    //
    // The viewer is parked first (`parkForExport`): with the 3D loop running
    // on SwiftShader the export queues behind every frame. Parked, the reply
    // took 6.7 s on four hardware threads; the 45 s wait, kept from before,
    // is for a hosted runner where two workers share those threads.
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    parkForExport(handle);
    post(command('a10', 'exportGlb'));
    await arrived(isReply('a10'), 'the reply to exportGlb', 45_000);
    const reply = replyTo(posted, 'a10')!;
    expect(reply.ok).toBe(true);
    expect(Object.prototype.toString.call(reply.result)).toBe('[object ArrayBuffer]');
    const bytes = new Uint8Array(reply.result as ArrayBuffer);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const magic = new TextDecoder().decode(bytes.slice(0, 4));
    expect(magic).toBe('glTF');
  }, 90_000);

  test('exportUsdz crosses the real boundary as an ArrayBuffer', async () => {
    // Same cross-realm story as `exportGlb`, above, parked and budgeted the
    // same way (5.7 s parked on four hardware threads).
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    parkForExport(handle);
    post(command('a11', 'exportUsdz'));
    await arrived(isReply('a11'), 'the reply to exportUsdz', 45_000);
    const reply = replyTo(posted, 'a11')!;
    expect(reply.ok).toBe(true);
    expect(Object.prototype.toString.call(reply.result)).toBe('[object ArrayBuffer]');
    const bytes = new Uint8Array(reply.result as ArrayBuffer);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 2))).toBe('PK');
  }, 90_000);

  test('resize reaches the viewer, so a host whose layout changed can say so', async () => {
    // The frame's own `ResizeObserver` cannot see a host-side transform or a
    // print stylesheet; `resize` is how a host tells it to re-measure.
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    post(command('a7', 'resize'));
    await arrived(isReply('a7'), 'the reply to resize');
    expect(replyTo(posted, 'a7')!.ok).toBe(true);
    expect(replyTo(posted, 'a7')!.error).toBeUndefined();
  });

  test('a documented alias resolves to the method it stands for', async () => {
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    post(command('a4', 'playTour'));
    await arrived(isReply('a4'), 'the reply to the alias');
    expect(replyTo(posted, 'a4')!.ok).toBe(true);
    expect(handle.tour.progress()?.state).toBe('playing');
    handle.tour.stop();
  });

  test('dispose tears the viewer down, reports it, and stops answering', async () => {
    const { handle, posted, post, arrived } = await bridged();
    await handle.ready;
    post(command('a5', 'dispose'));
    // The event is emitted from inside `perform` and the reply is posted after
    // `answer` resolves, so the reply is strictly the later of the two: waiting
    // on it proves both crossed, in that order. (Waiting on the EVENT wakes one
    // microtask too early — a frame-polled wait hid that by rounding up to a
    // whole frame.)
    await arrived(isReply('a5'), 'the reply to dispose');
    expect(posted.some((message) => isEvent('disposed')(message))).toBe(true);
    expect(replyTo(posted, 'a5')!.ok).toBe(true);
    const before = posted.length;
    post(command('a6', 'getMode'));
    await delay(100);
    // The bridge uninstalled itself with the viewer it was wrapping.
    expect(posted.length).toBe(before);
  });
});
