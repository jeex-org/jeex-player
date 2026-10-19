/**
 * The frame's side of the transport, against fake windows.
 *
 * Two properties carry the whole iframe form and both are checkable here:
 * WHO is answered (the one window, the one origin, the one viewer, this
 * protocol — everything else dropped in silence) and WHAT each method does
 * (exactly one call on the handle, with its parameters proved first). The
 * browser check adds the one thing a fake window cannot: that the two sides
 * really do talk across a document boundary.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { installFrameBridge } from './frame-bridge.js';
import { CHANNEL, PROTOCOL_VERSION, type JeexMessage } from './protocol.js';
import { MAX_SCENE_BYTES } from '../shared/limits.js';
import type { TourProgress } from '../camera/tour-player.js';
import type { ViewerError } from '../app/viewer-events.js';
import type { ViewerHandle } from '../app/viewer-handle.js';
import { DEMO } from '../demo/demo-ids.js';

const HOST_ORIGIN = 'https://host.example';
const VIEWER_ID = 'v1';

type Posted = { message: JeexMessage; origin: string };

/** A window with just the surface the bridge touches. */
class FakeWindow {
  readonly posted: Posted[] = [];
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  /** Honours `{ signal }` exactly as the platform does: aborting unbinds. */
  addEventListener(type: string, callback: (event: MessageEvent) => void, options?: { signal?: AbortSignal }): void {
    if (type !== 'message') return;
    this.listeners.add(callback);
    options?.signal?.addEventListener('abort', () => this.listeners.delete(callback), { once: true });
  }

  removeEventListener(type: string, callback: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.delete(callback);
  }

  postMessage(message: unknown, origin: string): void {
    this.posted.push({ message: message as JeexMessage, origin });
  }

  /** Delivers one message event to whoever is listening on this window. */
  receive(event: { data: unknown; origin: string; source: unknown }): void {
    for (const listener of [...this.listeners]) listener(event as unknown as MessageEvent);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

type Calls = {
  tour: string[];
  modes: string[];
  locales: string[];
  rooms: string[];
  furniture: boolean[];
  scenes: unknown[];
  disposals: number;
  exports: unknown[];
  usdzExports: unknown[];
  /** The `CaptureStillRequest`/`CapturePanoramaRequest` each capture command was built from. */
  captures: unknown[];
};

type Fired = {
  ready: (info: unknown) => void;
  error: (error: ViewerError) => void;
  scene: (info: unknown) => void;
  mode: (mode: string) => void;
  progress: (progress: TourProgress) => void;
  state: (state: string) => void;
  ended: () => void;
};

/** The viewer window the bridge installs itself on. */
let frameWindow: FakeWindow;
/** The host page's window: the only `source` and `origin` the bridge answers. */
let hostWindow: FakeWindow;

beforeEach(() => {
  frameWindow = new FakeWindow();
  hostWindow = new FakeWindow();
  (globalThis as { window?: unknown }).window = frameWindow;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function fakeHandle(
  overrides: Partial<{
    loadScene: (source: unknown) => Promise<void>;
    progress: TourProgress | null;
    mode: string;
    focusRoom: boolean;
    scene: unknown;
  }> = {},
): {
  handle: ViewerHandle;
  calls: Calls;
  fire: Fired;
} {
  const calls: Calls = {
    tour: [],
    modes: [],
    locales: [],
    rooms: [],
    furniture: [],
    scenes: [],
    disposals: 0,
    exports: [],
    usdzExports: [],
    captures: [],
  };
  const sinks = new Map<string, (payload: never) => void>();
  const subscribe =
    (event: string) =>
    (callback: (payload: never) => void): (() => void) => {
      sinks.set(event, callback);
      return () => {
        sinks.delete(event);
      };
    };
  const fireOne =
    (event: string) =>
    (payload?: unknown): void => {
      (sinks.get(event) as ((value: unknown) => void) | undefined)?.(payload);
    };

  const handle = {
    ready: Promise.resolve(),
    tour: {
      play: () => calls.tour.push('play'),
      pause: () => calls.tour.push('pause'),
      toggle: () => calls.tour.push('toggle'),
      stop: () => calls.tour.push('stop'),
      seek: (fraction: number) => calls.tour.push(`seek:${fraction}`),
      seekDistance: (metres: number) => calls.tour.push(`seekDistance:${metres}`),
      seekTime: (seconds: number) => calls.tour.push(`seekTime:${seconds}`),
      setSpeed: (speed: number) => calls.tour.push(`setSpeed:${speed}`),
      progress: () => overrides.progress ?? null,
      on: (event: string, callback: (payload: never) => void) => subscribe(`tour:${event}`)(callback),
    },
    loadScene:
      overrides.loadScene ??
      (async (source: unknown) => {
        calls.scenes.push(source);
      }),
    setMode: (mode: string) => calls.modes.push(mode),
    getMode: () => overrides.mode ?? 'orbit',
    getScene: () => overrides.scene ?? null,
    focusRoom: (roomId: string) => {
      calls.rooms.push(roomId);
      return overrides.focusRoom ?? true;
    },
    setFurnitureVisible: (visible: boolean) => calls.furniture.push(visible),
    setLocale: (locale: string) => calls.locales.push(locale),
    resize: () => undefined,
    capture: {
      // No renderer here: a fake capture records the request it was handed and
      // answers the smallest artefact the bridge can post on. What the real
      // renderer does with the request is `tests/component/frame-bridge`'s
      // question; what the BRIDGE built is this file's.
      still: (request: unknown) => {
        calls.captures.push(request);
        return Promise.resolve({ blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]), provenance: { kind: 'still' } });
      },
      panorama: (request: unknown) => {
        calls.captures.push(request);
        return Promise.resolve({ blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]), provenance: { kind: 'panorama' } });
      },
    },
    exportGlb: (options: unknown) => {
      calls.exports.push(options);
      return Promise.resolve(new Blob([new Uint8Array([0x67, 0x6c, 0x54, 0x46])], { type: 'model/gltf-binary' }));
    },
    exportUsdz: (options: unknown) => {
      calls.usdzExports.push(options);
      return Promise.resolve(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: 'model/vnd.usdz+zip' }));
    },
    on: (event: string, callback: (payload: never) => void) => subscribe(event)(callback),
    dispose: () => {
      calls.disposals += 1;
    },
  } as unknown as ViewerHandle;

  return {
    handle,
    calls,
    fire: {
      ready: fireOne('ready'),
      error: fireOne('error'),
      scene: fireOne('scene'),
      mode: fireOne('mode'),
      progress: fireOne('tour:progress'),
      state: fireOne('tour:state'),
      ended: fireOne('tour:ended'),
    },
  };
}

/**
 * Lets every reply land. `installFrameBridge` answers a command through an
 * async function, so the reply is posted a few microtasks after the message
 * arrives; one macrotask drains all of them however many there are.
 */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Sends one well-formed command from the host window. */
function sendCommand(
  method: string,
  params?: Record<string, unknown>,
  over: Partial<{ origin: string; source: unknown; viewerId: string; channel: string; version: number }> = {},
): void {
  frameWindow.receive({
    origin: over.origin ?? HOST_ORIGIN,
    source: over.source ?? hostWindow,
    data: {
      channel: over.channel ?? CHANNEL,
      version: over.version ?? PROTOCOL_VERSION,
      viewerId: over.viewerId ?? VIEWER_ID,
      kind: 'command',
      id: 'c1',
      method,
      ...(params ? { params } : {}),
    },
  });
}

/** Everything the bridge posted back, replies and events alike. */
function replies(): Array<{ ok: boolean; result?: unknown; error?: { code: string; message: string }; origin: string }> {
  return hostWindow.posted
    .filter((entry) => entry.message.kind === 'reply')
    .map((entry) => ({ ...(entry.message as { ok: boolean }), origin: entry.origin }) as never);
}

function events(): Array<{ event: string; payload: unknown; origin: string }> {
  return hostWindow.posted
    .filter((entry) => entry.message.kind === 'event')
    .map((entry) => ({ ...(entry.message as { event: string; payload: unknown }), origin: entry.origin }));
}

/** Installs a bridge whose viewer has already reported its first scene. */
function bridge(overrides?: Parameters<typeof fakeHandle>[0]): ReturnType<typeof fakeHandle> & { uninstall: () => void } {
  const built = fakeHandle(overrides);
  const uninstall = installFrameBridge(built.handle, {
    hostOrigin: HOST_ORIGIN,
    target: hostWindow as unknown as Window,
    viewerId: VIEWER_ID,
  });
  built.fire.ready({ sceneId: DEMO.scene });
  hostWindow.posted.length = 0;
  return { ...built, uninstall };
}

describe('the origin it is pointed at', () => {
  test('an install with a wildcard, a null or a malformed origin throws', () => {
    for (const origin of ['*', 'null', 'notanorigin', 'https://example.com/', '']) {
      // `postMessage` with a malformed target throws from inside a tour
      // listener, on every frame; `'*'` broadcasts every event to whatever
      // framed the page. Both are refused here.
      const built = fakeHandle();
      expect(() => installFrameBridge(built.handle, { hostOrigin: origin, target: hostWindow as unknown as Window })).toThrow();
    }
  });

  test('an exact http(s) origin installs', () => {
    const built = fakeHandle();
    expect(() =>
      installFrameBridge(built.handle, { hostOrigin: 'http://localhost:5190', target: hostWindow as unknown as Window }),
    ).not.toThrow();
  });
});

describe('who the bridge answers', () => {
  test('a command from the right window and origin is answered', async () => {
    const { calls } = bridge();
    sendCommand('play');
    await settled();
    expect(calls.tour).toEqual(['play']);
    expect(replies()).toHaveLength(1);
  });

  test('a command from another origin is dropped in silence', async () => {
    const { calls } = bridge();
    sendCommand('play', undefined, { origin: 'https://attacker.example' });
    await settled();
    expect(calls.tour).toEqual([]);
    expect(hostWindow.posted).toEqual([]);
  });

  test('a command from another window is dropped, even on the right origin', async () => {
    const { calls } = bridge();
    sendCommand('play', undefined, { source: new FakeWindow() });
    await settled();
    expect(calls.tour).toEqual([]);
    expect(hostWindow.posted).toEqual([]);
  });

  test('other postMessage traffic on the page is not ours', async () => {
    const { calls } = bridge();
    sendCommand('play', undefined, { channel: 'some-other-widget' });
    sendCommand('play', undefined, { version: 2 });
    frameWindow.receive({ origin: HOST_ORIGIN, source: hostWindow, data: 'hello' });
    frameWindow.receive({ origin: HOST_ORIGIN, source: hostWindow, data: null });
    await settled();
    expect(calls.tour).toEqual([]);
    expect(hostWindow.posted).toEqual([]);
  });

  test('a command addressed to another viewer of the same page is not ours', async () => {
    const { calls } = bridge();
    sendCommand('play', undefined, { viewerId: 'v2' });
    await settled();
    expect(calls.tour).toEqual([]);
    expect(hostWindow.posted).toEqual([]);
  });

  test('every reply and event goes to the host origin, never to `*`', async () => {
    const { fire } = bridge();
    sendCommand('play');
    fire.mode('walk');
    await settled();
    for (const entry of hostWindow.posted) expect(entry.origin).toBe(HOST_ORIGIN);
    expect(hostWindow.posted.some((entry) => entry.origin === '*')).toBe(false);
  });
});

/**
 * A page can post the frame anything, as often as it likes: another widget's
 * chatter, a hostile sibling frame, a flood. The drop must stay the cheapest thing the bridge does: a stranger's
 * payload is never even READ (the window and the origin are decided on the
 * event itself), nothing is queued, nothing is answered — an answer per piece
 * of garbage would turn the frame into an amplifier — and the bridge is as
 * responsive afterwards as before.
 */
describe('a flood of foreign traffic', () => {
  /** An event whose `data` counts how often the bridge looked at it. */
  function watchedEvent(
    origin: string,
    source: unknown,
    payload: unknown,
  ): { event: { data: unknown; origin: string; source: unknown }; reads: () => number } {
    let reads = 0;
    const event = {
      origin,
      source,
      get data(): unknown {
        reads += 1;
        return payload;
      },
    };
    return { event, reads: () => reads };
  }

  test('ten thousand strangers: none is read, queued or answered, and the bridge still answers its host', async () => {
    const { calls } = bridge();
    // 9 MB: over the scene cap, so a bridge that weighed or cloned a
    // stranger's payload would pay for it ten thousand times.
    const oversized = 'x'.repeat(MAX_SCENE_BYTES + 1024 * 1024);
    const strangerWindow = new FakeWindow();
    const origins = ['https://attacker.example', 'null', HOST_ORIGIN.replace('https:', 'http:'), `${HOST_ORIGIN}.evil.example`];
    let reads = 0;
    for (let index = 0; index < 10_000; index += 1) {
      // Right origin from the wrong window, and the wrong origin from the right one.
      const fromStranger = index % 2 === 0;
      const watched = watchedEvent(
        fromStranger ? HOST_ORIGIN : origins[index % origins.length]!,
        fromStranger ? strangerWindow : hostWindow,
        {
          channel: CHANNEL,
          version: PROTOCOL_VERSION,
          viewerId: VIEWER_ID,
          kind: 'command',
          id: `x${index}`,
          method: 'play',
          blob: oversized,
        },
      );
      frameWindow.receive(watched.event);
      reads += watched.reads();
    }
    await settled();
    expect(reads).toBe(0);
    expect(calls.tour).toEqual([]);
    expect(hostWindow.posted).toEqual([]);
    expect(strangerWindow.posted).toEqual([]);
    expect(frameWindow.listenerCount).toBe(1);

    sendCommand('play');
    await settled();
    expect(calls.tour).toEqual(['play']);
    expect(replies()).toHaveLength(1);
  });

  test('garbage from the host itself — every wrong shape, thousands of times — is dropped without an answer', async () => {
    const { calls } = bridge();
    const envelope = { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId: VIEWER_ID };
    const shapes: unknown[] = [
      undefined,
      null,
      0,
      'play',
      [],
      ['command'],
      new ArrayBuffer(64),
      { ...envelope },
      { ...envelope, kind: 'command' },
      { ...envelope, kind: 'command', id: 1, method: 'play' },
      { ...envelope, kind: 'command', id: 'c', method: 7 },
      { ...envelope, kind: 'reply', id: 'c', ok: true },
      { ...envelope, kind: 'event', event: 'ready' },
      { ...envelope, kind: 'mystery', id: 'c', method: 'play' },
      { ...envelope, viewerId: 'v2', kind: 'command', id: 'c', method: 'play' },
      { ...envelope, version: PROTOCOL_VERSION + 1, kind: 'command', id: 'c', method: 'play' },
      { ...envelope, channel: 'other', kind: 'command', id: 'c', method: 'play' },
      {
        ...envelope,
        viewerId: 'v2',
        kind: 'command',
        id: 'c',
        method: 'loadScene',
        params: { document: { blob: 'x'.repeat(1024 * 1024) } },
      },
    ];
    for (let index = 0; index < 5_000; index += 1) {
      frameWindow.receive({ origin: HOST_ORIGIN, source: hostWindow, data: shapes[index % shapes.length] });
    }
    await settled();
    expect(calls.tour).toEqual([]);
    expect(calls.scenes).toEqual([]);
    expect(hostWindow.posted).toEqual([]);
    expect(frameWindow.listenerCount).toBe(1);

    sendCommand('pause');
    await settled();
    expect(calls.tour).toEqual(['pause']);
    expect(replies()).toHaveLength(1);
  });
});

describe('the methods', () => {
  test('each tour command is one call on the handle', async () => {
    const { calls } = bridge();
    for (const method of ['play', 'pause', 'toggle', 'stop']) sendCommand(method);
    sendCommand('seek', { fraction: 0.25 });
    sendCommand('seekDistance', { metres: 12 });
    sendCommand('seekTime', { seconds: 3 });
    sendCommand('setTourSpeed', { speed: 0.5 });
    await settled();
    expect(calls.tour).toEqual(['play', 'pause', 'toggle', 'stop', 'seek:0.25', 'seekDistance:12', 'seekTime:3', 'setSpeed:0.5']);
  });

  test('each viewer command is one call on the handle', async () => {
    const { calls } = bridge();
    sendCommand('setMode', { mode: 'walk' });
    sendCommand('focusRoom', { roomId: DEMO.room.kitchen });
    sendCommand('setFurnitureVisible', { visible: false });
    sendCommand('setLocale', { locale: 'ru' });
    sendCommand('loadScene', { url: '/scenes/b.json' });
    await settled();
    expect(calls.modes).toEqual(['walk']);
    expect(calls.rooms).toEqual([DEMO.room.kitchen]);
    expect(calls.furniture).toEqual([false]);
    expect(calls.locales).toEqual(['ru']);
    expect(calls.scenes).toEqual([{ url: '/scenes/b.json' }]);
  });

  test('a query answers with its value', async () => {
    const progress = { state: 'paused', fraction: 0.5, distance: 10, length: 20, elapsed: 5, duration: 10, speed: 1 } as TourProgress;
    const scene = { schemaVersion: '2.0', id: DEMO.scene };
    const built = bridge({ progress, mode: 'tour', scene });
    sendCommand('progress');
    await settled();
    expect(replies()[0]!.result).toEqual(progress);
    hostWindow.posted.length = 0;
    sendCommand('getMode');
    await settled();
    expect(replies()[0]!.result).toBe('tour');
    hostWindow.posted.length = 0;
    sendCommand('getScene');
    await settled();
    expect(replies()[0]!.result).toEqual(scene);
    hostWindow.posted.length = 0;
    sendCommand('focusRoom', { roomId: DEMO.room.kitchen });
    await settled();
    expect(replies()[0]!.result).toBe(true);
    expect(built.calls.rooms).toEqual([DEMO.room.kitchen]);
  });

  test('`exportGlb` crosses the boundary as an ArrayBuffer, with its options forwarded', async () => {
    const { calls } = bridge();
    sendCommand('exportGlb', { includeFurniture: false, state: 'default', embedDocument: false });
    await settled();
    expect(calls.exports).toEqual([{ includeFurniture: false, state: 'default', embedDocument: false }]);
    const result = replies()[0]!.result;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result as ArrayBuffer)).toEqual(new Uint8Array([0x67, 0x6c, 0x54, 0x46]));
  });

  test('`exportGlb` with no params asks for the exporter’s own defaults', async () => {
    const { calls } = bridge();
    sendCommand('exportGlb');
    await settled();
    expect(calls.exports).toEqual([{}]);
    expect(replies()[0]!.ok).toBe(true);
  });

  test('`exportUsdz` crosses the boundary as an ArrayBuffer, with its options forwarded', async () => {
    const { calls } = bridge();
    sendCommand('exportUsdz', { includeFurniture: false });
    await settled();
    expect(calls.usdzExports).toEqual([{ includeFurniture: false }]);
    const result = replies()[0]!.result;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result as ArrayBuffer)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  });

  test('`exportUsdz` with no params asks for the exporter’s own defaults', async () => {
    const { calls } = bridge();
    sendCommand('exportUsdz');
    await settled();
    expect(calls.usdzExports).toEqual([{}]);
    expect(replies()[0]!.ok).toBe(true);
  });

  test('a seek past the end is still a legal command: the tour clamps it, the schema does not', async () => {
    // `TourPlayer.seek` clamps to 0..1 and the wire has always let a host say
    // 1.5 and mean "the end". Narrowing it in the schema would be a NEW
    // refusal, not a translation of an old one.
    const { calls } = bridge();
    sendCommand('seek', { fraction: 1.5 });
    sendCommand('seek', { fraction: -2 });
    await settled();
    expect(replies().map((reply) => reply.ok)).toEqual([true, true]);
    expect(calls.tour).toEqual(['seek:1.5', 'seek:-2']);
  });

  test('a scene the host already holds travels as a document, not a url', async () => {
    const { calls } = bridge();
    sendCommand('loadScene', { document: { id: DEMO.scene } });
    await settled();
    expect(calls.scenes).toEqual([{ document: { id: DEMO.scene } }]);
  });

  test('the alias spellings playTour and pauseTour still drive the tour', async () => {
    const { calls } = bridge();
    sendCommand('playTour');
    sendCommand('pauseTour');
    await settled();
    expect(calls.tour).toEqual(['play', 'pause']);
  });

  test('`destroy` is `dispose`', async () => {
    const { calls } = bridge();
    sendCommand('destroy');
    await settled();
    expect(calls.disposals).toBe(1);
  });
});

describe('the failures', () => {
  test('a method this version does not have', async () => {
    bridge();
    sendCommand('getSnapshot');
    await settled();
    expect(replies()[0]).toMatchObject({ ok: false, error: { code: 'unknown-method' } });
  });

  test('a parameter of the wrong type, or missing', async () => {
    const { calls } = bridge();
    sendCommand('seek', { fraction: 'half' });
    sendCommand('seek');
    sendCommand('setMode', { mode: 'sideways' });
    // 'zz' has no catalogue and never will; 'de' ships with the viewer.
    sendCommand('setLocale', { locale: 'zz' });
    sendCommand('setFurnitureVisible', { visible: 'yes' });
    sendCommand('focusRoom', {});
    // A room, a selection and a panorama are named by UUID; a name is refused on the wire.
    sendCommand('focusRoom', { roomId: 'kitchen' });
    sendCommand('setSelection', { target: { kind: 'room', id: 'kitchen' } });
    sendCommand('capturePanorama', { width: 128, roomId: 'kitchen' });
    sendCommand('loadScene', {});
    sendCommand('exportGlb', { state: 'sideways' });
    sendCommand('exportGlb', { includeFurniture: 'yes' });
    sendCommand('exportUsdz', { includeFurniture: 'yes' });
    await settled();
    expect(replies().map((reply) => reply.error?.code)).toEqual(Array.from<string>({ length: 13 }).fill('bad-params'));
    // Nothing was half-applied on the way to the complaint.
    expect(calls.rooms).toEqual([]);
    expect(calls.captures).toEqual([]);
    expect(calls.tour).toEqual([]);
    expect(calls.modes).toEqual([]);
    expect(calls.locales).toEqual([]);
  });

  test('the refusal names the field and says what it should have been', async () => {
    // `bad-params` carries a sentence derived from the schema —
    // `<method>: <path> <what>` — rather than one written out by hand. The CODE
    // is what every other test here asserts on.
    bridge();
    sendCommand('seek', { fraction: 'half' });
    await settled();
    expect(replies()[0]?.error).toEqual({ code: 'bad-params', message: 'seek: params.fraction must be a finite number' });
  });

  test('a params object that is missing altogether is refused by the object, not by its first field', async () => {
    bridge();
    sendCommand('captureStill');
    await settled();
    expect(replies()[0]?.error).toEqual({
      code: 'bad-params',
      message: 'captureStill: params must be an object naming `width` and `height`',
    });
  });

  test('a command before the first scene is `not-ready`', async () => {
    const built = fakeHandle();
    installFrameBridge(built.handle, { hostOrigin: HOST_ORIGIN, target: hostWindow as unknown as Window, viewerId: VIEWER_ID });
    sendCommand('play');
    await settled();
    expect(replies()[0]).toMatchObject({ ok: false, error: { code: 'not-ready' } });
    expect(built.calls.tour).toEqual([]);
  });

  test('`dispose` is answered before the first scene, because teardown always works', async () => {
    const built = fakeHandle();
    installFrameBridge(built.handle, { hostOrigin: HOST_ORIGIN, target: hostWindow as unknown as Window, viewerId: VIEWER_ID });
    sendCommand('dispose');
    await settled();
    expect(built.calls.disposals).toBe(1);
    expect(replies()[0]!.ok).toBe(true);
  });

  test('`getScene` is answered before the first scene, with `null`', async () => {
    const built = fakeHandle();
    installFrameBridge(built.handle, { hostOrigin: HOST_ORIGIN, target: hostWindow as unknown as Window, viewerId: VIEWER_ID });
    sendCommand('getScene');
    await settled();
    expect(replies()[0]).toMatchObject({ ok: true, result: null });
  });

  test('`exportGlb` is `not-ready` before the first scene, unlike `getScene`', async () => {
    const built = fakeHandle();
    installFrameBridge(built.handle, { hostOrigin: HOST_ORIGIN, target: hostWindow as unknown as Window, viewerId: VIEWER_ID });
    sendCommand('exportGlb');
    await settled();
    expect(replies()[0]).toMatchObject({ ok: false, error: { code: 'not-ready' } });
    expect(built.calls.exports).toEqual([]);
  });

  test('`exportUsdz` is `not-ready` before the first scene, unlike `getScene`', async () => {
    const built = fakeHandle();
    installFrameBridge(built.handle, { hostOrigin: HOST_ORIGIN, target: hostWindow as unknown as Window, viewerId: VIEWER_ID });
    sendCommand('exportUsdz');
    await settled();
    expect(replies()[0]).toMatchObject({ ok: false, error: { code: 'not-ready' } });
    expect(built.calls.usdzExports).toEqual([]);
  });

  test('a rejected loadScene carries the code the viewer reported, not a flat `internal`', async () => {
    const thrown = new Error('Scene validation failed: room kitchen has no polygon');
    const built = bridge({ loadScene: () => Promise.reject(thrown) });
    // This is the order the viewer really uses: the `error` event first, then
    // the rejection with the SAME throw as its cause.
    built.fire.error({ code: 'scene-invalid', message: thrown.message, cause: thrown });
    sendCommand('loadScene', { url: '/bad.json' });
    await settled();
    expect(replies().at(-1)).toMatchObject({ ok: false, error: { code: 'scene-invalid', message: thrown.message } });
  });

  test('a failure the viewer never reported is `internal`, not a guess', async () => {
    const thrown = new Error('something else entirely');
    bridge({ loadScene: () => Promise.reject(thrown) });
    sendCommand('loadScene', { url: '/x.json' });
    await settled();
    expect(replies().at(-1)).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});

describe('the events', () => {
  test('every handle and tour event becomes one message', () => {
    const { fire } = bridge();
    fire.ready({ sceneId: DEMO.scene });
    fire.error({ code: 'scene-load', message: '404', cause: undefined });
    fire.scene({ sceneId: DEMO.scene, rev: 2 });
    fire.mode('walk');
    fire.progress({ fraction: 0.25 } as TourProgress);
    fire.state('playing');
    fire.ended();
    expect(events().map((entry) => entry.event)).toEqual(['ready', 'error', 'scene', 'mode', 'progress', 'state', 'ended']);
  });

  test('an error event carries the code and the message, never the cause', () => {
    const { fire } = bridge();
    fire.error({ code: 'scene-load', message: '404', cause: new Error('secret internals') });
    expect(events()[0]!.payload).toEqual({ code: 'scene-load', message: '404' });
  });

  test('the tour state is wrapped, so a host reads `payload.state`', () => {
    const { fire } = bridge();
    fire.state('paused');
    expect(events()[0]!.payload).toEqual({ state: 'paused' });
  });

  test('a frame page that hands in its sizes gets each one out as `size`, until uninstalled', () => {
    const { handle } = fakeHandle();
    let report: ((size: { width: number; height: number }) => void) | null = null;
    let unsubscribed = 0;
    const uninstall = installFrameBridge(handle, {
      hostOrigin: HOST_ORIGIN,
      target: hostWindow as unknown as Window,
      viewerId: VIEWER_ID,
      sizes: (listener) => {
        report = listener;
        return () => {
          unsubscribed += 1;
        };
      },
    });
    report!({ width: 800, height: 450 });
    expect(events().map(({ event, payload, origin }) => ({ event, payload, origin }))).toEqual([
      { event: 'size', payload: { width: 800, height: 450 }, origin: HOST_ORIGIN },
    ]);
    uninstall();
    expect(unsubscribed).toBe(1);
  });

  test('without a size source the bridge raises no `size` at all', () => {
    const { fire } = bridge();
    fire.ended();
    expect(events().map((entry) => entry.event)).toEqual(['ended']);
  });
});

describe('teardown', () => {
  test('`dispose` disposes, says `disposed`, and stops listening', async () => {
    const { calls } = bridge();
    sendCommand('dispose');
    await settled();
    expect(calls.disposals).toBe(1);
    expect(events().map((entry) => entry.event)).toEqual(['disposed']);
    // The reply to `dispose` itself still got out.
    expect(replies()).toHaveLength(1);
    hostWindow.posted.length = 0;
    sendCommand('play');
    await settled();
    expect(hostWindow.posted).toEqual([]);
    expect(calls.tour).toEqual([]);
  });

  test('the returned uninstall removes the listener and every subscription', async () => {
    const { uninstall, fire, calls } = bridge();
    expect(frameWindow.listenerCount).toBe(1);
    uninstall();
    expect(frameWindow.listenerCount).toBe(0);
    fire.mode('walk');
    sendCommand('play');
    await settled();
    expect(hostWindow.posted).toEqual([]);
    expect(calls.tour).toEqual([]);
  });

  test('uninstalling twice is harmless', () => {
    const { uninstall } = bridge();
    uninstall();
    expect(() => uninstall()).not.toThrow();
  });
});

/**
 * The frame's negative paths.
 *
 * Every case here is one a host page can produce — by accident or on purpose —
 * and each one either has a defined answer or is documented as a gap for the
 * package that owns the code.
 */
describe('the capture commands', () => {
  test('a still names its camera by word, by room or by pose, and the bridge passes it on whole', async () => {
    const { calls } = bridge();
    sendCommand('captureStill', { width: 96, height: 64, camera: 'live' });
    sendCommand('captureStill', { width: 96, height: 64, camera: { roomId: DEMO.room.kitchen } });
    sendCommand('captureStill', {
      width: 96,
      height: 64,
      camera: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } },
    });
    await settled();
    expect(replies().map((reply) => reply.ok)).toEqual([true, true, true]);
    expect(calls.captures.map((request) => (request as { camera: unknown }).camera)).toEqual([
      'live',
      { roomId: DEMO.room.kitchen },
      { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } },
    ]);
  });

  test('the optional fields stay absent when the host did not name them', async () => {
    const { calls } = bridge();
    sendCommand('capturePanorama', { width: 128, roomId: DEMO.room.living });
    await settled();
    expect(replies()[0]?.ok).toBe(true);
    expect(calls.captures[0]).toEqual({ width: 128, roomId: DEMO.room.living, state: undefined, caption: undefined });
  });

  test('a camera that is neither a word, a room nor a pose is `bad-params`, and nothing is rendered', async () => {
    const { calls } = bridge();
    sendCommand('captureStill', { width: 96, height: 64, camera: { position: { x: 1, y: 2 } } });
    await settled();
    expect(replies()[0]?.error).toEqual({
      code: 'bad-params',
      message: 'captureStill: params.camera must be `presentation`, `live`, a room or a pose',
    });
    expect(calls.captures).toEqual([]);
  });
});

describe('negative paths', () => {
  test('a method named after something on Object.prototype is unknown-method', async () => {
    const { calls } = bridge();
    for (const method of ['__proto__', 'constructor', 'toString']) {
      sendCommand(method);
      await settled();
    }
    expect(replies().map((reply) => reply.error?.code)).toEqual(['unknown-method', 'unknown-method', 'unknown-method']);
    // Nothing was performed, and nothing on the prototype was called.
    expect(calls.tour).toEqual([]);
    expect(calls.modes).toEqual([]);
  });

  test('params carrying __proto__ neither pollutes nor stops the honest field being read', async () => {
    const { calls } = bridge();
    sendCommand('seek', JSON.parse('{"__proto__": {"polluted": true}, "fraction": 0.25}') as Record<string, unknown>);
    await settled();
    expect(calls.tour).toEqual(['seek:0.25']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  test('a params object with a null prototype is read normally', async () => {
    const { calls } = bridge();
    const params = Object.assign(Object.create(null) as Record<string, unknown>, { mode: 'walk' });
    sendCommand('setMode', params);
    await settled();
    expect(calls.modes).toEqual(['walk']);
  });

  test('two commands sharing one id are both answered: de-duplication is the HOST’s job', async () => {
    // The frame is stateless about ids — it echoes what it was given. A host
    // that reuses one gets two replies for it, which is why `host.ts` settles
    // a pending id exactly once and drops the rest.
    const { calls } = bridge();
    sendCommand('play');
    sendCommand('pause');
    await settled();
    expect(calls.tour).toEqual(['play', 'pause']);
    expect(replies().map((reply) => reply.ok)).toEqual([true, true]);
  });

  test('a command after dispose is not answered at all: the bridge went with the viewer', async () => {
    const { calls } = bridge();
    sendCommand('dispose');
    await settled();
    expect(calls.disposals).toBe(1);
    expect(events().map((entry) => entry.event)).toContain('disposed');

    hostWindow.posted.length = 0;
    sendCommand('play');
    await settled();
    // Silence, not `not-ready`: `dispose` uninstalls the listener, so there is
    // nothing left to answer with.
    expect(hostWindow.posted).toEqual([]);
    expect(calls.tour).toEqual([]);
  });

  test('loadScene with a document over the byte cap is refused before the viewer is asked', async () => {
    // ~8 MB of scene plus the wrapper. The fetch path's cap (`shared/limits.ts`)
    // says an inline document refused there must not cross the frame boundary —
    // and a HAND-WRITTEN host can skip the helper's own check, so the frame
    // re-measures what actually arrived. The answer is `bad-params`, not the
    // viewer's `internal`: the refusal is the bridge's own.
    const big = { schemaVersion: '2.0', id: DEMO.scene, padding: 'x'.repeat(MAX_SCENE_BYTES) };
    const { calls } = bridge();
    sendCommand('loadScene', { document: big });
    await settled();
    expect(replies()[0]?.error?.code).toBe('bad-params');
    expect(replies()[0]?.error?.message).toContain(`over the ${MAX_SCENE_BYTES} byte cap`);
    expect(calls.scenes).toEqual([]);
  });

  test('the cap is BYTES, not the UTF-16 units a length check sees', async () => {
    // Non-BMP characters: four UTF-8 bytes against two UTF-16 units each, so
    // this document's JSON length in UTF-16 units is under the cap while its
    // byte size is over it — a hand-written host's own length check passes
    // it, and the frame's re-measure refuses it.
    const chars = MAX_SCENE_BYTES / 4 + 1;
    const big = { schemaVersion: '2.0', id: DEMO.scene, padding: '𝐀'.repeat(chars) };
    const utf16 = JSON.stringify(big).length;
    expect(utf16).toBeLessThan(MAX_SCENE_BYTES);
    const { calls } = bridge();
    sendCommand('loadScene', { document: big });
    await settled();
    expect(replies()[0]?.error).toMatchObject({ code: 'bad-params' });
    expect(calls.scenes).toEqual([]);
  });

  test('a document the bridge cannot weigh is forwarded, and the clone or validator refuses it', async () => {
    // `null` means "no opinion", exactly as on the host side: a cyclic object
    // has no JSON length, and `JSON.stringify` throwing must not invent one.
    const cyclic: Record<string, unknown> = { schemaVersion: '2.0' };
    cyclic['self'] = cyclic;
    const { calls } = bridge();
    sendCommand('loadScene', { document: cyclic });
    await settled();
    expect(replies().map((reply) => reply.ok)).toEqual([true]);
    expect(calls.scenes).toHaveLength(1);
  });

  test('a loadScene the viewer rejects reports the viewer’s own code, not a flat internal', async () => {
    const failure = new Error('Scene validation failed: rooms[0].id');
    const { fire } = bridge({
      loadScene: async () => {
        fire.error({ code: 'scene-invalid', message: failure.message, cause: failure });
        throw failure;
      },
    });
    sendCommand('loadScene', { document: {} });
    await settled();
    expect(replies()[0]?.error).toEqual({ code: 'scene-invalid', message: 'Scene validation failed: rooms[0].id' });
  });

  test('an unparsable hostOrigin is refused at install, before anything can post to it', () => {
    // Guards against accepting it and blowing up at the first post: a real
    // `window.postMessage` throws `SyntaxError` on a targetOrigin that is not a
    // URL, and the bridge posts from inside `ViewerEvents` and `TourEvents`
    // listeners — so a frame given `?host=garbage` would die on its first event
    // with no card, no reply and nothing in the host's hands. The install is
    // where it is caught.
    const strictHost = {
      posted: [] as unknown[],
      addEventListener(): void {
        /* the bridge listens on `window`, not here */
      },
      removeEventListener(): void {
        /* idem */
      },
      postMessage(message: unknown, origin: string): void {
        if (origin !== '*' && origin !== '/' && !URL.canParse(origin)) {
          throw new SyntaxError(`Invalid target origin '${origin}' in a call to 'postMessage'.`);
        }
        this.posted.push(message);
      },
    };
    const built = fakeHandle();
    expect(() =>
      installFrameBridge(built.handle, { hostOrigin: 'garbage', target: strictHost as unknown as Window, viewerId: VIEWER_ID }),
    ).toThrow(/hostOrigin/);
    // Nothing was subscribed, so the viewer's own events reach nobody and throw
    // nothing: a refused bridge leaves the frame an ordinary viewer.
    expect(() => built.fire.ready({ sceneId: DEMO.scene })).not.toThrow();
    expect(strictHost.posted).toEqual([]);
  });
});
