/**
 * The host page's side of the transport, against a fake iframe.
 *
 * Three properties matter and all three are checkable here: the frame is BUILT
 * right (permissions, sandbox, and the host's origin and options in its
 * query), commands are ORDERED right (queued until the frame says `ready`, one
 * reply each, a timeout when there is none), and the host trusts nothing —
 * only this frame, only its origin, only this viewer.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_FRAME_TITLE,
  EmbedError,
  HOST_PARAM,
  QUEUE_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  VIEWER_ID_PARAM,
  embedViewer,
  type EmbedExportGlbOptions,
  type EmbedExportUsdzOptions,
  type EmbedLogEntry,
  type JeexEmbed,
} from './host.js';
import { CHANNEL, DEFAULT_VIEWER_ID, PROTOCOL_VERSION, type ErrorCode, type JeexMessage } from './protocol.js';
import { readyPayloadSchema } from './protocol.schema.js';
import { z } from 'zod/mini';
import type { LogEntry } from '../shared/logger.js';
import type { ExportGlbOptions } from '../app/export-gltf.js';
import type { ExportUsdzOptions } from '../app/export-usdz.js';
import { MAX_SCENE_BYTES } from '../shared/limits.js';
import { DEMO } from '../demo/demo-ids.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';

const HOST_ORIGIN = 'https://host.example';
const FRAME_ORIGIN = 'https://viewer.example';
const FRAME_SRC = `${FRAME_ORIGIN}/embed.html`;

type Posted = { message: JeexMessage; origin: string };

/** The window inside the iframe: it receives commands and posts back. */
class FakeFrameWindow {
  readonly posted: Posted[] = [];

  postMessage(message: unknown, origin: string): void {
    this.posted.push({ message: message as JeexMessage, origin });
  }

  /** The commands it has been sent, in order. */
  get commands(): Array<{ id: string; method: string; params?: Record<string, unknown> }> {
    return this.posted
      .map((entry) => entry.message)
      .filter((message): message is Extract<JeexMessage, { kind: 'command' }> => message.kind === 'command');
  }
}

/** An iframe with just the surface `embedViewer` touches. */
class FakeIframe {
  readonly attributes = new Map<string, string>();
  readonly contentWindow = new FakeFrameWindow();
  src = '';
  removed = false;
  /** Set as properties, not attributes, exactly as `embedViewer` writes them. */
  title = '';
  referrerPolicy = '';
  loading = '';
  /** The CSSOM box, which is how the helper sizes the frame under a strict CSP. */
  readonly declarations = new Map<string, string>();
  readonly style = {
    setProperty: (property: string, value: string): void => {
      this.declarations.set(property, value);
    },
  };

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  remove(): void {
    this.removed = true;
  }
  /** The frame's `load` listeners; `fireLoad` plays the browser finishing the frame page. */
  private readonly loads = new Set<() => void>();
  addEventListener(type: string, callback: () => void, options?: { signal?: AbortSignal }): void {
    if (type !== 'load') return;
    this.loads.add(callback);
    options?.signal?.addEventListener('abort', () => this.loads.delete(callback), { once: true });
  }
  fireLoad(): void {
    for (const callback of [...this.loads]) callback();
  }
}

let iframe: FakeIframe;
let hostListeners: Set<(event: MessageEvent) => void>;
let container: { children: unknown[]; appendChild: (child: unknown) => void };
/**
 * Every embed a test made, disposed after it.
 *
 * `embedViewer` claims its `viewerId` for the page and refuses a second frame
 * under the same one, so a test that leaks a handle would poison the next.
 */
let made: JeexEmbed[] = [];

/** `embedViewer`, tracked. Every test builds its frames through this. */
function make(options: Record<string, unknown> = {}): JeexEmbed {
  const embed = embedViewer(container as unknown as HTMLElement, { src: FRAME_SRC, ...options });
  made.push(embed);
  return embed;
}

/** The id of the most recent embed: what a frame would put on its messages. */
function currentId(): string {
  return made.at(-1)?.viewerId ?? DEFAULT_VIEWER_ID;
}

beforeEach(() => {
  iframe = new FakeIframe();
  hostListeners = new Set();
  container = {
    children: [],
    appendChild(child: unknown) {
      this.children.push(child);
    },
  };
  (globalThis as { window?: unknown }).window = {
    location: { origin: HOST_ORIGIN, href: `${HOST_ORIGIN}/listing/1234567?utm=x`, pathname: '/listing/1234567' },
    // Honours `{ signal }` exactly as the platform does: aborting unbinds.
    addEventListener: (type: string, callback: (event: MessageEvent) => void, options?: { signal?: AbortSignal }) => {
      if (type !== 'message') return;
      hostListeners.add(callback);
      options?.signal?.addEventListener('abort', () => hostListeners.delete(callback), { once: true });
    },
    removeEventListener: (_type: string, callback: (event: MessageEvent) => void) => {
      hostListeners.delete(callback);
    },
  };
  (globalThis as { document?: unknown }).document = { createElement: () => iframe };
});

afterEach(() => {
  for (const embed of made.splice(0)) embed.dispose();
  made = [];
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

/** Delivers one message to the host page, as the frame would. */
function fromFrame(message: unknown, over: { origin?: string; source?: unknown } = {}): void {
  const event = { data: message, origin: over.origin ?? FRAME_ORIGIN, source: 'source' in over ? over.source : iframe.contentWindow };
  for (const listener of [...hostListeners]) listener(event as unknown as MessageEvent);
}

function frameEvent(event: string, payload: unknown, viewerId = currentId()): unknown {
  return { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId, kind: 'event', event, payload };
}

function frameReply(id: string, body: Record<string, unknown>, viewerId = currentId()): unknown {
  return { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId, kind: 'reply', id, ...body };
}

/** Lets the queue flush and any promise settle. */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('the frame it builds', () => {
  test('carries the host origin, the viewer id and the options in query spelling', () => {
    make({
      viewerId: 'left',
      scene: '/scenes/flat-a.json',
      view: 'walk',
      minimap: '0',
      tourStart: 0.25,
    });
    const url = new URL(iframe.src);
    expect(url.origin + url.pathname).toBe(FRAME_SRC);
    expect(url.searchParams.get(HOST_PARAM)).toBe(HOST_ORIGIN);
    expect(url.searchParams.get(VIEWER_ID_PARAM)).toBe('left');
    expect(url.searchParams.get('scene')).toBe('/scenes/flat-a.json');
    expect(url.searchParams.get('view')).toBe('walk');
    expect(url.searchParams.get('minimap')).toBe('0');
    expect(url.searchParams.get('tourStart')).toBe('0.25');
  });

  test("keeps the embed's own keys out of the viewer's query", () => {
    make({ allowFullscreen: false, view: 'orbit' });
    const url = new URL(iframe.src);
    expect(url.searchParams.get('src')).toBeNull();
    expect(url.searchParams.get('allowFullscreen')).toBeNull();
    expect(url.searchParams.get('view')).toBe('orbit');
  });

  test('asks for fullscreen by default and sandboxes the frame', () => {
    const embed = make();
    expect(iframe.attributes.get('allow')).toBe('fullscreen');
    expect(iframe.attributes.get('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(iframe.declarations.get('border')).toBe('0');
    expect(iframe.declarations.get('width')).toBe('100%');
    // Declarations, never a `style` attribute: that would need
    // `style-src-attr 'unsafe-inline'` from the host's policy.
    expect(iframe.attributes.has('style')).toBe(false);
    expect(container.children).toEqual([embed.iframe]);
  });

  test('carries an accessible name, no referrer and lazy loading', () => {
    make();
    // Every iframe needs a name (WCAG 4.1.2 / axe `frame-title`); without one
    // the helper would inject a violation into every host page that uses it.
    expect(iframe.title).toBe(DEFAULT_FRAME_TITLE);
    expect(iframe.referrerPolicy).toBe('no-referrer');
    expect(iframe.loading).toBe('lazy');
  });

  test('a host may name the frame in its own language', () => {
    make({ title: 'Wohnungs-Rundgang' });
    expect(iframe.title).toBe('Wohnungs-Rundgang');
    // A `title` given as an embed key never reaches the frame's query.
    expect(new URL(iframe.src).searchParams.get('title')).toBeNull();
  });

  test('a host may override the sandbox, including with the strictest one', () => {
    make({ sandbox: '' });
    expect(iframe.attributes.get('sandbox')).toBe('');
    expect(new URL(iframe.src).searchParams.get('sandbox')).toBeNull();
  });

  test('allowFullscreen: false leaves the permission off', () => {
    make({ allowFullscreen: false });
    expect(iframe.attributes.has('allow')).toBe(false);
  });

  test('a relative src is resolved against the host page', () => {
    embedViewer(container as unknown as HTMLElement, { src: '/embed.html' });
    expect(new URL(iframe.src).origin).toBe(HOST_ORIGIN);
  });
});

describe('autoHeight', () => {
  test('off by default: the frame fills its container and ignores `size`', () => {
    make();
    expect(iframe.declarations.get('height')).toBe('100%');
    fromFrame(frameEvent('size', { width: 800, height: 450 }));
    expect(iframe.declarations.get('height')).toBe('100%');
  });

  test('on: the frame’s own ratio at once, then the height the frame reports, never in the query', () => {
    make({ autoHeight: true, ratio: '4:3' });
    expect(iframe.declarations.get('aspect-ratio')).toBe('4 / 3');
    expect(iframe.declarations.get('height')).toBe('auto');
    expect(new URL(iframe.src).searchParams.get('autoHeight')).toBeNull();
    // The ratio itself is the FRAME's option and travels in its query.
    expect(new URL(iframe.src).searchParams.get('ratio')).toBe('4:3');
    fromFrame(frameEvent('size', { width: 800, height: 600 }));
    expect(iframe.declarations.get('height')).toBe('600px');
    expect(iframe.declarations.get('aspect-ratio')).toBe('auto');
  });

  test('with no ratio, or one that is no ratio, the first box is 16:9', () => {
    make({ autoHeight: true });
    expect(iframe.declarations.get('aspect-ratio')).toBe('16 / 9');
    for (const embed of made.splice(0)) embed.dispose();
    make({ autoHeight: true, ratio: '0:9' });
    expect(iframe.declarations.get('aspect-ratio')).toBe('16 / 9');
  });

  test('a size that is not a positive number changes nothing', () => {
    make({ autoHeight: true });
    for (const payload of [null, {}, { height: 'tall' }, { height: -1 }, { height: Number.NaN }]) {
      fromFrame(frameEvent('size', payload));
    }
    expect(iframe.declarations.get('height')).toBe('auto');
  });

  test('a `size` from another origin is not trusted', () => {
    make({ autoHeight: true });
    fromFrame(frameEvent('size', { width: 800, height: 9000 }), { origin: 'https://evil.example' });
    expect(iframe.declarations.get('height')).toBe('auto');
  });
});

describe('the same-origin guardrail', () => {
  test('a frame on the host page’s own origin logs the sandbox warning, exactly once', () => {
    // The default sandbox is a no-op for a same-origin frame (`FRAME_SANDBOX`),
    // so the helper names that misconfiguration rather than letting it pass in
    // silence, and still builds the frame: it is the host's decision, made
    // informed.
    const logged: EmbedLogEntry[] = [];
    make({ src: '/embed.html', onLog: (entry: EmbedLogEntry) => logged.push(entry) });
    expect(logged.map((entry) => entry.code)).toEqual(['same-origin-frame']);
    expect(logged[0]?.level).toBe('warn');
    expect(logged[0]?.message).toContain('sandbox');
    expect(logged[0]?.detail).toMatchObject({ frameOrigin: HOST_ORIGIN });
  });

  test('a frame on its own origin stays silent', () => {
    const logged: EmbedLogEntry[] = [];
    make({ onLog: (entry: EmbedLogEntry) => logged.push(entry) });
    expect(logged).toEqual([]);
  });
});

describe('the queue', () => {
  test('nothing is sent before the frame reports ready', async () => {
    const embed = make();
    void embed.play().catch(() => undefined);
    void embed.seek(0.5).catch(() => undefined);
    await settled();
    expect(iframe.contentWindow.commands).toEqual([]);
  });

  test('the held commands go out in order the moment it does', async () => {
    const embed = make();
    void embed.play().catch(() => undefined);
    void embed.seek(0.5).catch(() => undefined);
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene }));
    await settled();
    expect(iframe.contentWindow.commands.map((command) => command.method)).toEqual(['play', 'seek']);
    expect(iframe.contentWindow.commands[1]!.params).toEqual({ fraction: 0.5 });
  });

  test('`ready` resolves with what the frame reported', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: { locale: 'en' } }));
    expect(await embed.ready).toEqual({ sceneId: DEMO.scene, options: { locale: 'en' } });
  });

  test('a second `ready` (a later scene) does not re-flush the queue', async () => {
    const embed = make();
    void embed.play().catch(() => undefined);
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene }));
    await settled();
    fromFrame(frameEvent('ready', { sceneId: L_SHAPE.scene }));
    await settled();
    expect(iframe.contentWindow.commands.map((command) => command.method)).toEqual(['play']);
  });
});

/**
 * The one payload the host proves for itself.
 *
 * `host.ts` carries no Zod — one `zod/mini` is 4.39 KB gzip against the
 * helper's whole 4 KB budget — so its `ready` check is written out by hand.
 * The last test here is what stops the two drifting: the hand check's verdict,
 * read through the real message path, against `readyPayloadSchema`'s, over one
 * set of fixtures.
 */
describe('a ready the frame cannot back up', () => {
  /** What the host did with one `ready`: whether it became ready, and what it logged. */
  async function offer(payload: unknown): Promise<{ ready: boolean; codes: string[]; heard: number }> {
    const logged: EmbedLogEntry[] = [];
    const heard: unknown[] = [];
    const embed = make({ onLog: (entry: EmbedLogEntry) => logged.push(entry) });
    embed.on('ready', (info) => heard.push(info));
    void embed.play().catch(() => undefined);
    // The fake `document.createElement` hands out ONE iframe for the whole
    // test, so several offers share its record: what this offer flushed is the
    // difference, never the total.
    const before = iframe.contentWindow.commands.length;
    fromFrame(frameEvent('ready', payload));
    await settled();
    // The queue is the observable half of "became ready": a held command only
    // goes out once the frame is believed.
    const flushed = iframe.contentWindow.commands.length > before;
    return { ready: flushed, codes: logged.map((entry) => entry.code), heard: heard.length };
  }

  test('a payload that is not an object leaves the handle un-ready and logs `ready-invalid`', async () => {
    expect(await offer(null)).toEqual({ ready: false, codes: ['ready-invalid'], heard: 0 });
    expect(await offer('ready')).toEqual({ ready: false, codes: ['ready-invalid'], heard: 0 });
  });

  test('a payload whose sceneId is not a string is refused the same way', async () => {
    expect(await offer({ sceneId: 7 })).toEqual({ ready: false, codes: ['ready-invalid'], heard: 0 });
    expect(await offer({ options: {} })).toEqual({ ready: false, codes: ['ready-invalid'], heard: 0 });
  });

  test('the next honest `ready` is still accepted: one bad payload is not a broken frame', async () => {
    const logged: EmbedLogEntry[] = [];
    const embed = make({ onLog: (entry: EmbedLogEntry) => logged.push(entry) });
    void embed.play().catch(() => undefined);
    fromFrame(frameEvent('ready', { sceneId: 7 }));
    await settled();
    expect(iframe.contentWindow.commands).toEqual([]);

    fromFrame(frameEvent('ready', { sceneId: DEMO.scene }));
    await settled();
    expect(iframe.contentWindow.commands.map((command) => command.method)).toEqual(['play']);
    expect((await embed.ready).sceneId).toBe(DEMO.scene);
    expect(logged.map((entry) => entry.code)).toEqual(['ready-invalid']);
  });

  test('the hand check and `readyPayloadSchema` give the same verdict on the same fixtures', async () => {
    const FIXTURES: { payload: unknown; valid: boolean }[] = [
      { payload: { sceneId: DEMO.scene, options: { locale: 'en' } }, valid: true },
      { payload: { sceneId: DEMO.scene }, valid: true },
      { payload: { sceneId: '' }, valid: true },
      { payload: null, valid: false },
      { payload: { sceneId: 7 }, valid: false },
      { payload: 'ready', valid: false },
    ];
    for (const { payload, valid } of FIXTURES) {
      const byHand = await offer(payload);
      expect({ payload, byHand: byHand.ready }).toEqual({ payload, byHand: valid });
      expect({ payload, bySchema: z.safeParse(readyPayloadSchema, payload).success }).toEqual({ payload, bySchema: valid });
    }
  });
});

describe('commands and replies', () => {
  async function readyEmbed(): Promise<ReturnType<typeof embedViewer>> {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene }));
    await embed.ready;
    return embed;
  }

  test('a reply resolves the command that asked for it, by id', async () => {
    const embed = await readyEmbed();
    const progress = embed.progress();
    await settled();
    const id = iframe.contentWindow.commands.at(-1)!.id;
    const reported = { fraction: 0.5, distance: 6, length: 12, elapsed: 4, duration: 8, state: 'playing' as const, speed: 1 as const };
    fromFrame(frameReply(id, { ok: true, result: reported }));
    expect(await progress).toEqual(reported);
  });

  test('a reply for another command is ignored, and the right one still lands', async () => {
    const embed = await readyEmbed();
    const mode = embed.getMode();
    await settled();
    fromFrame(frameReply('someone-else', { ok: true, result: 'walk' }));
    fromFrame(frameReply(iframe.contentWindow.commands.at(-1)!.id, { ok: true, result: 'tour' }));
    expect(await mode).toBe('tour');
  });

  test('a failed reply rejects with the code the frame gave', async () => {
    const embed = await readyEmbed();
    const load = embed.loadScene({ url: '/bad.json' });
    await settled();
    fromFrame(
      frameReply(iframe.contentWindow.commands.at(-1)!.id, {
        ok: false,
        error: { code: 'scene-invalid', message: 'room kitchen has no polygon' },
      }),
    );
    await expect(load).rejects.toThrow(/no polygon/);
    await load.catch((error: unknown) => {
      expect(error).toBeInstanceOf(EmbedError);
      expect((error as EmbedError).code).toBe('scene-invalid');
    });
  });

  test('every method reaches the frame under its documented name', async () => {
    const embed = await readyEmbed();
    void embed.play().catch(() => undefined);
    void embed.pause().catch(() => undefined);
    void embed.toggle().catch(() => undefined);
    void embed.stop().catch(() => undefined);
    void embed.seek(0.1).catch(() => undefined);
    void embed.seekDistance(2).catch(() => undefined);
    void embed.seekTime(3).catch(() => undefined);
    void embed.setTourSpeed(2).catch(() => undefined);
    void embed.progress().catch(() => undefined);
    void embed.getMode().catch(() => undefined);
    void embed.setMode('walk').catch(() => undefined);
    void embed.focusRoom(DEMO.room.kitchen).catch(() => undefined);
    void embed.getState().catch(() => undefined);
    void embed.getScene().catch(() => undefined);
    void embed.setFurnitureVisible(false).catch(() => undefined);
    void embed.setLocale('ru').catch(() => undefined);
    void embed.setLightTemperature(2700).catch(() => undefined);
    void embed.resize().catch(() => undefined);
    void embed.exportGlb({ includeFurniture: false }).catch(() => undefined);
    void embed.exportUsdz({ includeFurniture: false }).catch(() => undefined);
    void embed.loadScene({ document: { id: DEMO.scene } }).catch(() => undefined);
    void embed.captureStill({ width: 320, height: 180 }).catch(() => undefined);
    void embed.capturePanorama({ width: 512, roomId: DEMO.room.living }).catch(() => undefined);
    await settled();
    expect(iframe.contentWindow.commands.map((command) => command.method)).toEqual([
      'play',
      'pause',
      'toggle',
      'stop',
      'seek',
      'seekDistance',
      'seekTime',
      'setTourSpeed',
      'progress',
      'getMode',
      'setMode',
      'focusRoom',
      'getState',
      'getScene',
      'setFurnitureVisible',
      'setLocale',
      'setLightTemperature',
      'resize',
      'exportGlb',
      'exportUsdz',
      'loadScene',
      'captureStill',
      'capturePanorama',
    ]);
    expect(iframe.contentWindow.commands.find((command) => command.method === 'setLightTemperature')?.params).toEqual({
      temperature: 2700,
    });
    expect(iframe.contentWindow.commands.find((command) => command.method === 'exportGlb')?.params).toEqual({
      includeFurniture: false,
    });
    expect(iframe.contentWindow.commands.find((command) => command.method === 'exportUsdz')?.params).toEqual({
      includeFurniture: false,
    });
  });

  test('`exportGlb` resolves with the ArrayBuffer the frame replies with', async () => {
    const embed = await readyEmbed();
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer;
    const pending = embed.exportGlb();
    await settled();
    const id = iframe.contentWindow.commands.at(-1)!.id;
    fromFrame(frameReply(id, { ok: true, result: bytes }));
    const result = await pending;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result)).toEqual(new Uint8Array(bytes));
  });

  test('`exportGlb` called with no options still sends a command', async () => {
    const embed = await readyEmbed();
    void embed.exportGlb().catch(() => undefined);
    await settled();
    expect(iframe.contentWindow.commands.at(-1)).toMatchObject({ method: 'exportGlb', params: {} });
  });

  test('`exportUsdz` resolves with the ArrayBuffer the frame replies with', async () => {
    const embed = await readyEmbed();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const pending = embed.exportUsdz();
    await settled();
    const id = iframe.contentWindow.commands.at(-1)!.id;
    fromFrame(frameReply(id, { ok: true, result: bytes }));
    const result = await pending;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result)).toEqual(new Uint8Array(bytes));
  });

  test('`exportUsdz` called with no options still sends a command', async () => {
    const embed = await readyEmbed();
    void embed.exportUsdz().catch(() => undefined);
    await settled();
    expect(iframe.contentWindow.commands.at(-1)).toMatchObject({ method: 'exportUsdz', params: {} });
  });

  test('the two windows are the documented ones, and the boot one is longer', () => {
    expect(REPLY_TIMEOUT_MS).toBe(5000);
    expect(QUEUE_TIMEOUT_MS).toBeGreaterThan(REPLY_TIMEOUT_MS);
  });

  test('a queued command is not posted until the frame is ready', async () => {
    // The two clocks themselves are asserted where fake timers exist
    // (`tests/component/frame-bridge.test.ts`); what belongs here is that the
    // queue holds the command rather than sending it into a frame that is not
    // listening yet.
    const embed = make();
    const pending = embed.getMode();
    await settled();
    expect(iframe.contentWindow.commands).toEqual([]);
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: {} }));
    await settled();
    const id = iframe.contentWindow.commands[0]!.id;
    fromFrame(frameReply(id, { ok: true, result: 'orbit' }));
    await expect(pending).resolves.toBe('orbit');
  });
});

describe('an inline document the host should not post', () => {
  test('one over the fetch cap is refused here, before it is cloned across', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: {} }));
    await embed.ready;
    // The cap is the fetch path's own (`shared/limits.ts`): a document the
    // frame would refuse must not be copied byte by byte across the boundary
    // first.
    const huge = { schemaVersion: '2.0', padding: 'x'.repeat(MAX_SCENE_BYTES + 1) };
    const failure = await embed.loadScene({ document: huge }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmbedError);
    expect((failure as EmbedError).code).toBe('bad-params');
    expect((failure as EmbedError).message).toContain(String(MAX_SCENE_BYTES));
    expect(iframe.contentWindow.commands).toEqual([]);
  });

  test('the cap is counted in bytes, the same measure the frame applies', async () => {
    // Non-BMP characters: two UTF-16 units but four UTF-8 bytes each, so a
    // `length` check would post this and leave the frame to refuse it after
    // the clone had already copied it across.
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: {} }));
    await embed.ready;
    const wide = { schemaVersion: '2.0', padding: '𝐀'.repeat(MAX_SCENE_BYTES / 4 + 1) };
    expect(JSON.stringify(wide).length).toBeLessThan(MAX_SCENE_BYTES);
    const failure = await embed.loadScene({ document: wide }).catch((error: unknown) => error);
    expect((failure as EmbedError).code).toBe('bad-params');
    expect(iframe.contentWindow.commands).toEqual([]);
  });

  test('one within the cap is posted as usual', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: {} }));
    await embed.ready;
    void embed.loadScene({ document: { schemaVersion: '2.0' } }).catch(() => undefined);
    await settled();
    expect(iframe.contentWindow.commands.map((command) => command.method)).toEqual(['loadScene']);
  });

  test('one that cannot be weighed at all is posted rather than guessed at', async () => {
    // A cyclic document has no JSON length. The cap has no opinion; the clone
    // is what refuses it, and that path is asserted below.
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: {} }));
    await embed.ready;
    const cyclic: Record<string, unknown> = { schemaVersion: '2.0' };
    cyclic['self'] = cyclic;
    void embed.loadScene({ document: cyclic }).catch(() => undefined);
    await settled();
    expect(iframe.contentWindow.commands.map((command) => command.method)).toEqual(['loadScene']);
  });
});

describe('what the host refuses to trust', () => {
  test('a message from another origin is not a reply', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene }), { origin: 'https://attacker.example' });
    let resolved = false;
    // `.catch` because the shared `afterEach` disposes every embed, and a
    // disposed handle rejects the `ready` it never resolved.
    void embed.ready
      .then(() => {
        resolved = true;
      })
      .catch(() => undefined);
    await settled();
    expect(resolved).toBe(false);
  });

  test('a message from another window is not a reply', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene }), { source: new FakeFrameWindow() });
    let resolved = false;
    // `.catch` because the shared `afterEach` disposes every embed, and a
    // disposed handle rejects the `ready` it never resolved.
    void embed.ready
      .then(() => {
        resolved = true;
      })
      .catch(() => undefined);
    await settled();
    expect(resolved).toBe(false);
  });

  test('a message for another viewer of the same page is not ours', async () => {
    const embed = make({ viewerId: 'left' });
    fromFrame(frameEvent('ready', { sceneId: 'a' }, 'right'));
    let resolved = false;
    // `.catch` because the shared `afterEach` disposes every embed, and a
    // disposed handle rejects the `ready` it never resolved.
    void embed.ready
      .then(() => {
        resolved = true;
      })
      .catch(() => undefined);
    await settled();
    expect(resolved).toBe(false);
  });

  test('other postMessage traffic on the page is not the protocol', async () => {
    const embed = make();
    fromFrame({ channel: 'some-other-widget', kind: 'event', event: 'ready' });
    fromFrame('ready');
    fromFrame(null);
    let resolved = false;
    // `.catch` because the shared `afterEach` disposes every embed, and a
    // disposed handle rejects the `ready` it never resolved.
    void embed.ready
      .then(() => {
        resolved = true;
      })
      .catch(() => undefined);
    await settled();
    expect(resolved).toBe(false);
  });
});

describe('events', () => {
  test("`on` delivers the frame's events and hands back an unsubscribe", async () => {
    const embed = make();
    const seen: unknown[] = [];
    const off = embed.on('progress', (payload) => {
      seen.push(payload);
    });
    const first = { fraction: 0.25, distance: 3, length: 12, elapsed: 2, duration: 8, state: 'playing' };
    fromFrame(frameEvent('progress', first));
    off();
    fromFrame(frameEvent('progress', { ...first, fraction: 0.5 }));
    await settled();
    expect(seen).toEqual([first]);
  });

  test('a subscriber that throws is reported and the others still run', async () => {
    const logged: Array<{ code: string }> = [];
    const embed = make({
      onLog: (entry: { code: string }) => logged.push(entry),
    });
    const seen: unknown[] = [];
    embed.on('mode', () => {
      throw new Error('bad listener');
    });
    embed.on('mode', (mode) => {
      seen.push(mode);
    });
    fromFrame(frameEvent('mode', 'walk'));
    expect(seen).toEqual(['walk']);
    expect(logged.map((entry) => entry.code)).toEqual(['listener-failed']);
  });
});

describe('dispose', () => {
  test('tells the frame, removes it and stops listening', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene }));
    await embed.ready;
    embed.dispose();
    await settled();
    expect(iframe.contentWindow.commands.map((command) => command.method)).toContain('dispose');
    expect(iframe.removed).toBe(true);
    expect(hostListeners.size).toBe(0);
  });

  test('reaches a frame that never became ready, instead of sitting in the queue', async () => {
    const embed = make();
    embed.dispose();
    await settled();
    expect(iframe.contentWindow.commands.map((command) => command.method)).toEqual(['dispose']);
  });

  test('rejects everything still in flight rather than leaving it pending', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene }));
    await embed.ready;
    const pending = embed.progress();
    embed.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
  });

  test('a command after dispose rejects instead of reaching a frame that is gone', async () => {
    const embed = make();
    embed.dispose();
    await expect(embed.play()).rejects.toThrow(/disposed/);
  });

  test('disposing twice is harmless', () => {
    const embed = make();
    embed.dispose();
    expect(() => embed.dispose()).not.toThrow();
  });

  test('tells its own subscribers it disposed, exactly once', () => {
    const embed = make();
    let calls = 0;
    embed.on('disposed', () => {
      calls += 1;
    });
    embed.dispose();
    expect(calls).toBe(1);
    embed.dispose();
    expect(calls).toBe(1);
  });

  test('a second dispose() posts nothing and emits nothing', () => {
    const embed = make();
    embed.dispose();
    const commandsAfterFirst = iframe.contentWindow.commands.length;
    let calls = 0;
    embed.on('disposed', () => {
      calls += 1;
    });
    embed.dispose();
    expect(iframe.contentWindow.commands.length).toBe(commandsAfterFirst);
    expect(calls).toBe(0);
  });
});

/**
 * The host page's negative paths.
 *
 * A host holds a promise per command and a frame per viewer; every case here
 * is a way those two bookkeeping jobs can be attacked or confused.
 */
describe('negative paths', () => {
  test('a second reply for an id already settled is ignored', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: {} }));
    const pending = embed.getMode();
    const id = iframe.contentWindow.commands[0]!.id;

    fromFrame(frameReply(id, { ok: true, result: 'orbit' }));
    // The pending entry is deleted on the first settle, so the second reply
    // finds nothing — a promise can only settle once, and a frame that
    // answers twice must not be able to turn a success into a failure.
    fromFrame(frameReply(id, { ok: false, error: { code: 'internal', message: 'second thoughts' } }));
    await expect(pending).resolves.toBe('orbit');
  });

  test('a reply for an id that was never sent settles nothing', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: {} }));
    const pending = embed.getMode();
    const marker = Symbol('still pending');
    expect(() => fromFrame(frameReply('never-sent', { ok: true, result: 'walk' }))).not.toThrow();
    // The command it did send is still waiting; the stray reply did not
    // resolve it and did not throw on the way past.
    const outcome = await Promise.race([pending.catch(() => 'rejected'), Promise.resolve(marker)]);
    expect(outcome).toBe(marker);
    // Settled by the teardown rather than by the 5 s reply timeout, so the
    // suite does not pay for the clock.
    embed.dispose();
    await expect(pending).rejects.toBeInstanceOf(EmbedError);
  });

  test('a second frame under an id already in use is refused', () => {
    // A silent collision is the worst outcome: both handles filter on
    // `viewerId`, so each would settle the other's commands and deliver the
    // other's events. The second call says so instead.
    make({ viewerId: 'left' });
    expect(() => make({ viewerId: 'left' })).toThrow(EmbedError);
    try {
      make({ viewerId: 'left' });
    } catch (error) {
      expect((error as EmbedError).code).toBe('bad-params');
    }
  });

  test('an id a disposed frame gave back may be claimed again', () => {
    const first = make({ viewerId: 'reused' });
    first.dispose();
    expect(() => make({ viewerId: 'reused' })).not.toThrow();
  });

  test('a host that names no frames still gets two different ids', () => {
    const left = make();
    iframe = new FakeIframe();
    const right = make();
    expect(left.viewerId).not.toBe(right.viewerId);
    expect(new URL(left.iframe.src).searchParams.get(VIEWER_ID_PARAM)).toBe(left.viewerId);
  });

  test('two frames still cannot answer for each other, even under one id', async () => {
    // The `event.source` check, not the `viewerId` one, is what keeps two
    // frames apart — so it is asserted against a forged reply that carries the
    // RIGHT viewerId and comes from the wrong window.
    const left = make({ viewerId: 'left' });
    const leftFrame = iframe;
    iframe = new FakeIframe();
    const right = make({ viewerId: 'right' });
    const rightFrame = iframe;

    fromFrame(frameEvent('ready', { sceneId: 'a', options: {} }, 'left'), { source: leftFrame.contentWindow });
    fromFrame(frameEvent('ready', { sceneId: 'b', options: {} }, 'right'), { source: rightFrame.contentWindow });

    const pending = left.getMode();
    const id = leftFrame.contentWindow.commands[0]!.id;
    fromFrame(frameReply(id, { ok: true, result: 'impostor' }, 'left'), { source: rightFrame.contentWindow });
    fromFrame(frameReply(id, { ok: true, result: 'orbit' }, 'left'), { source: leftFrame.contentWindow });
    await expect(pending).resolves.toBe('orbit');
    void right;
  });

  test('an event from the wrong frame is not delivered to this host’s listeners', () => {
    const left = make({ viewerId: 'left' });
    const leftFrame = iframe;
    iframe = new FakeIframe();
    const rightFrame = iframe;
    make({ viewerId: 'right' });

    const seen: unknown[] = [];
    left.on('mode', (mode) => seen.push(mode));
    fromFrame(frameEvent('mode', 'walk', 'left'), { source: rightFrame.contentWindow });
    expect(seen).toEqual([]);
    fromFrame(frameEvent('mode', 'walk', 'left'), { source: leftFrame.contentWindow });
    expect(seen).toEqual(['walk']);
  });

  test('every command after dispose is refused rather than left pending', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: {} }));
    embed.dispose();
    for (const call of [() => embed.getMode(), () => embed.play(), () => embed.progress(), () => embed.setMode('walk')]) {
      await expect(call()).rejects.toBeInstanceOf(EmbedError);
    }
  });

  test('a command in flight when dispose lands is rejected, not abandoned', async () => {
    const embed = make();
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: {} }));
    const pending = embed.getMode();
    embed.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'EmbedError', code: 'disposed' });
  });

  test('a document the browser cannot clone rejects the command instead of hanging', async () => {
    // A cyclic object is the everyday case: a host that holds its scene as a
    // graph with parent links hands one over without meaning to. A real
    // `postMessage` throws `DataCloneError` synchronously, out of the middle of
    // `send`; the handle turns it into a `bad-params` rejection, because the
    // parameter really is unusable and the frame never saw it.
    const embed = make();
    const cyclic: Record<string, unknown> = { schemaVersion: '2.0' };
    cyclic['self'] = cyclic;
    iframe.contentWindow.postMessage = (): void => {
      throw new DOMException('could not be cloned', 'DataCloneError');
    };
    fromFrame(frameEvent('ready', { sceneId: DEMO.scene, options: {} }));
    const failure = await embed.loadScene({ document: cyclic }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmbedError);
    expect((failure as EmbedError).code).toBe('bad-params');
    expect((failure as EmbedError).message).toMatch(/cloned/);
  });

  test('an option that is not a scalar is dropped rather than reaching the frame as [object Object]', () => {
    make({
      view: 'walk',
      // Only a scalar has a query spelling; anything else would silently
      // mis-configure the frame.
      scene: { url: '/scenes/flat-a.json' },
      onReady: () => undefined,
    });
    const url = new URL(iframe.src);
    expect(url.searchParams.get('view')).toBe('walk');
    expect(url.searchParams.get('scene')).toBeNull();
    expect(url.searchParams.get('onReady')).toBeNull();
  });
});

describe('EmbedError', () => {
  test('carries the protocol’s own code and nothing outside it', () => {
    // It cannot extend `ViewerLibError` — that would import viewer code into
    // the 4 KB helper — so the CONTRACT is asserted here instead: same field,
    // same union, and `errors.test.ts` allowlists the file for that reason.
    const codes: ErrorCode[] = ['timeout', 'bad-params', 'not-ready', 'disposed', 'unknown-method', 'internal'];
    for (const code of codes) {
      const error = new EmbedError(code, 'nope');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('EmbedError');
      expect(error.code).toBe(code);
    }
  });

  test('`no-reply` and `bad-message` are gone from the union', () => {
    // `no-reply` became `timeout`, which is IN the union; `bad-message` was
    // dropped because an unaddressed message is ignored, never answered.
    // @ts-expect-error neither is a code any more
    const gone: ErrorCode[] = ['no-reply', 'bad-message'];
    expect(gone).toHaveLength(2);
  });
});

describe('the log entry the handle raises', () => {
  test('has the same shape as the viewer’s own, field for field', () => {
    // The two are declared apart on purpose (`host.ts` may import no viewer
    // code); this is what stops them drifting.
    const asEmbed: EmbedLogEntry = { level: 'warn', code: 'x', message: 'y', detail: { a: 1 } };
    const asViewer: LogEntry = asEmbed;
    const backAgain: EmbedLogEntry = asViewer;
    expect(backAgain).toEqual(asEmbed);
  });
});

describe('the export options the handle sends', () => {
  test('has the same shape as `ExportGlbOptions`, field for field', () => {
    // Declared apart on purpose (`host.ts` may import no viewer code); this
    // is what stops them drifting.
    const asEmbed: EmbedExportGlbOptions = { includeFurniture: false, state: 'default', embedDocument: false };
    const asViewer: ExportGlbOptions = asEmbed;
    const backAgain: EmbedExportGlbOptions = asViewer;
    expect(backAgain).toEqual(asEmbed);
  });

  test('`EmbedExportUsdzOptions` has the same shape as `ExportUsdzOptions`, field for field', () => {
    const asEmbed: EmbedExportUsdzOptions = { includeFurniture: false };
    const asViewer: ExportUsdzOptions = asEmbed;
    const backAgain: EmbedExportUsdzOptions = asViewer;
    expect(backAgain).toEqual(asEmbed);
  });
});

describe('the telemetry context', () => {
  test('the host page path goes to the frame by postMessage after it loads, never in its URL', () => {
    make();
    expect(iframe.src).not.toContain('listing');
    expect(iframe.contentWindow.commands).toEqual([]);
    iframe.fireLoad();
    expect(iframe.contentWindow.commands).toEqual([
      { ...iframe.contentWindow.commands[0]!, method: 'context', params: { page: '/listing/1234567' } },
    ]);
    expect(iframe.contentWindow.posted[0]?.origin).toBe(FRAME_ORIGIN);
  });

  test('every spelling of off reaches the frame as analytics=off, and the host hands over nothing', () => {
    for (const analytics of ['off', false, null, 'OFF', 'none', 'false', 0, { mode: 'off' }, { mode: 'OFF' }, { mode: false }]) {
      for (const embed of made.splice(0)) embed.dispose();
      iframe = new FakeIframe();
      make({ analytics });
      iframe.fireLoad();
      expect({ analytics, commands: iframe.contentWindow.commands }).toEqual({ analytics, commands: [] });
      expect({ analytics, query: new URL(iframe.src).searchParams.get('analytics') }).toEqual({ analytics, query: 'off' });
    }
  });

  test('on, absent, or an object without a mode stays on; an endpoint inside the object is forwarded', () => {
    make({ analytics: { endpoint: 'https://stats.agency.example/p' } });
    expect(new URL(iframe.src).searchParams.get('analytics')).toBeNull();
    expect(new URL(iframe.src).searchParams.get('analyticsEndpoint')).toBe('https://stats.agency.example/p');
    iframe.fireLoad();
    expect(iframe.contentWindow.commands.map((command) => command.method)).toEqual(['context']);
  });

  test('the context listener goes with dispose', () => {
    const embed = make();
    embed.dispose();
    made.pop();
    iframe.fireLoad();
    expect(iframe.contentWindow.commands.filter((command) => command.method === 'context')).toEqual([]);
  });
});
