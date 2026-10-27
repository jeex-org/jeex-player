/**
 * The protocol's schemas: that they cover the method list, that they agree with
 * the hand-written envelope types, and that a refusal says which field it is
 * about in a sentence a host can read.
 *
 * The whole file is about the UNTRUSTED half of the wire — what a host page
 * may send and what the frame may push back — so most of it is refusals.
 */

import { describe, expect, test } from 'bun:test';
import { z } from 'zod/mini';
import {
  CHANNEL,
  METHOD_LIST,
  PROTOCOL_VERSION,
  commandMessage,
  commandReply,
  eventMessage,
  isJeexMessage,
  type CommandMethod,
  type EmbedEventMap,
  type ErrorCode,
  type EventName,
} from './protocol.js';
import {
  isJeexEnvelope,
  commandSchema,
  errorCodeSchema,
  eventSchema,
  readCommand,
  readyPayloadSchema,
  viewerErrorCodeSchema,
  type EmbedEvent,
  type ParamsOf,
  type PayloadOf,
} from './protocol.schema.js';
import { MESSAGE_KEYS, locales, registerLocale, type MessageKey } from '../ui/messages.js';
import { OPTION_SCHEMA } from '../app/viewer-options.js';
import type { ViewerErrorCode } from '../shared/errors.js';
import { DEMO } from '../demo/demo-ids.js';

// ------------------------------------------------- compile-time agreement ---

/**
 * Every event the frame can push has a branch, and the branch's payload admits
 * everything `EmbedEventMap` declares for it. A ninth event added to the map
 * without a branch here fails to COMPILE — which is the point of writing it as
 * a type rather than as a loop.
 *
 * One direction only, deliberately: the schema is allowed to be WIDER than the
 * map (the `ready` payload's `options`, see `readyPayloadSchema`'s note), never
 * narrower, or a legal event would be refused.
 */
type _EventPayloadsCovered = {
  [E in EventName]: EmbedEventMap[E] extends PayloadOf<E> ? true : ['payload not covered', E];
};
const _eventPayloadsCovered: _EventPayloadsCovered = {
  lightTemperature: true,
  ready: true,
  error: true,
  scene: true,
  mode: true,
  select: true,
  progress: true,
  state: true,
  ended: true,
  size: true,
  disposed: true,
};
void _eventPayloadsCovered;

/** Every event the protocol declares has a branch… */
type _MissingEventBranch = Exclude<EventName, EmbedEvent['event']>;
((): _MissingEventBranch extends never ? true : ['eventSchema missing', _MissingEventBranch] => true)();
/** …and no branch invents an event name the protocol does not have. */
type _ExtraEventBranch = Exclude<EmbedEvent['event'], EventName>;
((): _ExtraEventBranch extends never ? true : ['eventSchema invented', _ExtraEventBranch] => true)();

// --------------------------------------------------------- the method list ---

describe('the command union', () => {
  /** Whether the union refused the DISCRIMINATOR — the one failure that means "no such branch". */
  function discriminatorRefused(method: string): boolean {
    const result = z.safeParse(commandSchema, { method });
    return !result.success && result.error.issues.some((issue) => issue.path.length === 1 && issue.path[0] === 'method');
  }

  test('every method in METHOD_LIST has a branch of its own', () => {
    expect(METHOD_LIST.filter((method) => discriminatorRefused(method))).toEqual([]);
  });

  // Teeth: the probe above really does report a missing branch, so the empty
  // list is a fact about the union rather than about the predicate.
  test('a method the protocol does not have is refused on its discriminator', () => {
    expect(discriminatorRefused('teleport')).toBe(true);
  });

  test('the parameterless methods ignore whatever a host sent alongside', () => {
    expect(readCommand('play', { junk: 1 }).ok).toBe(true);
    expect(readCommand('dispose', undefined).ok).toBe(true);
    expect(readCommand('getScene', 'nonsense').ok).toBe(true);
  });
});

// ------------------------------------------------------------ readCommand ---

/** The issues one refusal carries, as `path`/`message` pairs. */
function refusal(method: CommandMethod, params: unknown): { path: string; message: string }[] {
  const read = readCommand(method, params);
  if (read.ok) throw new Error(`${method} was accepted, not refused`);
  return read.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

describe('readCommand', () => {
  test('names the field that was wrong, and says what it should have been', () => {
    expect(refusal('seek', { fraction: 'half' })).toEqual([{ path: 'params.fraction', message: 'must be a finite number' }]);
    expect(refusal('seekDistance', { metres: Number.NaN })).toEqual([{ path: 'params.metres', message: 'must be a finite number' }]);
    expect(refusal('seekTime', { seconds: Number.POSITIVE_INFINITY })).toEqual([
      { path: 'params.seconds', message: 'must be a finite number' },
    ]);
    // A speed is one of the three settings, never any other factor.
    expect(refusal('setTourSpeed', { speed: 3 })).toEqual([{ path: 'params.speed', message: 'must be one of 1, 2, 0.5' }]);
    expect(refusal('setTourSpeed', { speed: '2' })).toEqual([{ path: 'params.speed', message: 'must be one of 1, 2, 0.5' }]);
    expect(refusal('focusRoom', {})).toEqual([{ path: 'params.roomId', message: 'must be a string' }]);
    expect(refusal('focusRoom', { roomId: 'kitchen' })).toEqual([{ path: 'params.roomId', message: 'must be a UUID v7' }]);
    expect(refusal('setFurnitureVisible', { visible: 'yes' })).toEqual([{ path: 'params.visible', message: 'must be a boolean' }]);
  });

  test('a missing params object is refused by the object, not by its first field', () => {
    expect(refusal('seek', undefined)).toEqual([{ path: 'params', message: 'must be an object naming a `fraction`' }]);
    expect(refusal('captureStill', undefined)).toEqual([{ path: 'params', message: 'must be an object naming `width` and `height`' }]);
  });

  test('`setMode` names the modes the option schema knows', () => {
    expect(refusal('setMode', { mode: 'sideways' })).toEqual([
      { path: 'params.mode', message: `must be one of ${OPTION_SCHEMA['view.mode'].values.join(', ')}` },
    ]);
    expect(readCommand('setMode', { mode: 'walk' }).ok).toBe(true);
  });

  test("`loadScene` carries the host's revision of the document, a whole number of 0 or more", () => {
    expect(readCommand('loadScene', { document: {}, revision: 12 }).ok).toBe(true);
    expect(readCommand('loadScene', { url: '/scenes/b.json', revision: 0 }).ok).toBe(true);
    for (const revision of [-1, 1.5, '3']) {
      expect(readCommand('loadScene', { document: {}, revision }).ok).toBe(false);
    }
  });

  test('`loadScene` decides on the PRESENCE of `document`, not on its value', () => {
    expect(readCommand('loadScene', { document: null }).ok).toBe(true);
    expect(readCommand('loadScene', { document: {} }).ok).toBe(true);
    expect(readCommand('loadScene', { url: '/scenes/b.json' }).ok).toBe(true);
    expect(refusal('loadScene', {})).toEqual([{ path: 'params', message: 'must name `url` (a string) or `document`' }]);
    expect(refusal('loadScene', { url: 7 })).toEqual([{ path: 'params', message: 'must name `url` (a string) or `document`' }]);
  });

  test('a still names its camera by word, by room or by pose', () => {
    expect(readCommand('captureStill', { width: 96, height: 64, camera: 'live' }).ok).toBe(true);
    expect(readCommand('captureStill', { width: 96, height: 64, camera: { roomId: DEMO.room.kitchen } }).ok).toBe(true);
    // A room camera is named by the room's UUID; a name is no room at all.
    expect(refusal('captureStill', { width: 96, height: 64, camera: { roomId: 'kitchen' } })).toEqual([
      { path: 'params.camera.roomId', message: 'must be a UUID v7' },
    ]);
    expect(
      readCommand('captureStill', {
        width: 96,
        height: 64,
        camera: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } },
      }).ok,
    ).toBe(true);
    expect(refusal('captureStill', { width: 96, height: 64, camera: { position: { x: 1, y: 2 } } })).toEqual([
      { path: 'params.camera', message: 'must be `presentation`, `live`, a room or a pose' },
    ]);
  });

  test('the export commands take no params at all, or an object of options', () => {
    expect(readCommand('exportGlb', undefined).ok).toBe(true);
    expect(readCommand('exportUsdz', undefined).ok).toBe(true);
    expect(readCommand('exportGlb', { includeFurniture: false, state: 'default', embedDocument: false }).ok).toBe(true);
    expect(refusal('exportGlb', { state: 'sideways' })).toEqual([{ path: 'params.state', message: 'must be one of current, default' }]);
    expect(refusal('exportUsdz', { includeFurniture: 'yes' })).toEqual([{ path: 'params.includeFurniture', message: 'must be a boolean' }]);
  });

  test('`ParamsOf` names one branch’s params and no other', () => {
    // A compile-time claim with a runtime witness: the annotations are the
    // assertion, and the two calls prove the values they admit are the values
    // the union accepts.
    const still: ParamsOf<'captureStill'> = { width: 96, height: 64 };
    const glb: ParamsOf<'exportGlb'> = undefined;
    expect(readCommand('captureStill', still).ok).toBe(true);
    expect(readCommand('exportGlb', glb).ok).toBe(true);
  });

  test('a seek past the end is still a legal command: the tour clamps it, the schema does not', () => {
    // `TourPlayer.seek` clamps to 0..1, and the wire has always let a host say
    // 1.5 and mean "the end". Narrowing it here would be a new refusal, not a
    // translation of an old one.
    expect(readCommand('seek', { fraction: 1.5 }).ok).toBe(true);
    expect(readCommand('seek', { fraction: -2 }).ok).toBe(true);
  });

  test('what travels on is the object the host sent, never the schema’s copy', () => {
    // `z.object` strips the keys it was not told about, and `loadScene`’s
    // document is a whole scene: the value must cross the boundary as it
    // arrived.
    const document = { schemaVersion: '2.0', id: DEMO.scene };
    const read = readCommand('loadScene', { document });
    expect(read.ok).toBe(true);
    if (!read.ok || read.value.method !== 'loadScene' || !('document' in read.value.params)) throw new Error('unreachable');
    expect(read.value.params.document).toBe(document);
  });

  test('a panorama is taken in a room named by its UUID', () => {
    expect(readCommand('capturePanorama', { width: 512, roomId: DEMO.room.living }).ok).toBe(true);
    expect(refusal('capturePanorama', { width: 512, roomId: 'living' })).toEqual([{ path: 'params.roomId', message: 'must be a UUID v7' }]);
    // Uppercase is not the canonical form the scene's ids are written in.
    expect(readCommand('capturePanorama', { width: 512, roomId: DEMO.room.living.toUpperCase() }).ok).toBe(false);
  });

  test('setLightTemperature takes a whole step of kelvin in the range, or null', () => {
    expect(readCommand('setLightTemperature', { temperature: 2700 }).ok).toBe(true);
    expect(readCommand('setLightTemperature', { temperature: null }).ok).toBe(true);
    for (const temperature of [2600, 6600, 3050, '3000', undefined])
      expect(readCommand('setLightTemperature', { temperature }).ok).toBe(false);
    expect(readCommand('setLightTemperature', {}).ok).toBe(false);
    // One message for every refusal, a number off the steps included.
    for (const temperature of [2750, '3000'])
      expect(refusal('setLightTemperature', { temperature })).toEqual([
        { path: 'params.temperature', message: 'must be null or a whole multiple of 100 from 2700 to 6500' },
      ]);
  });

  test('setSelection takes a target or null and nothing else', () => {
    expect(readCommand('setSelection', { target: { kind: 'wall', id: DEMO.wall.spineKitchen } }).ok).toBe(true);
    expect(refusal('setSelection', { target: { kind: 'wall', id: 'w1' } })).toEqual([
      { path: 'params.target.id', message: 'must be a UUID v7' },
    ]);
    expect(readCommand('setSelection', { target: null }).ok).toBe(true);
    expect(readCommand('setSelection', { target: { kind: 'wall' } }).ok).toBe(false);
    expect(readCommand('setSelection', {}).ok).toBe(false);
  });
});

describe('the locale set is read when the command is parsed, not when this module loaded', () => {
  // ISO 639-3 reserves `qaa`–`qtz` for local use, and the rest of this suite
  // already spends `qaa`/`qab`/`qac`: a process-wide registry a test writes to
  // is written for the WHOLE run, so it must never be a real language another
  // test could be asserting on, nor one another test has claimed.
  const CODE = 'qad';

  test('a locale nobody registered is refused, and the same locale is accepted once it exists', () => {
    expect(locales()).not.toContain(CODE);
    expect(refusal('setLocale', { locale: CODE })).toEqual([{ path: 'params.locale', message: `must be one of ${locales().join(', ')}` }]);

    registerLocale(CODE, Object.fromEntries(MESSAGE_KEYS.map((key) => [key, key])) as Record<MessageKey, string>);
    expect(readCommand('setLocale', { locale: CODE }).ok).toBe(true);
    // …and the sentence grew with the registry, because it is built at parse time.
    // 'zz' has no catalogue and never will; 'de' ships with the viewer.
    expect(refusal('setLocale', { locale: 'zz' })[0]?.message).toContain(CODE);
  });
});

describe('setLocale takes a tag, not only a catalogue name', () => {
  test('the alias `sr` is accepted, `sr-Cyrl` is refused', () => {
    expect(readCommand('setLocale', { locale: 'sr' }).ok).toBe(true);
    expect(readCommand('setLocale', { locale: 'sr-Latn' }).ok).toBe(true);
    expect(refusal('setLocale', { locale: 'sr-Cyrl' })).toEqual([
      { path: 'params.locale', message: `must be one of ${locales().join(', ')}` },
    ]);
  });
});

// ------------------------------------------------------------ error codes ---

describe('the error vocabulary is composed, never merged', () => {
  const VIEWER_CODES: readonly ViewerErrorCode[] = [
    'webgl-unavailable',
    'scene-load',
    'model-external-resource',
    'scene-invalid',
    'project-invalid',
    'no-scene-source',
    'bad-params',
    'not-ready',
    'disposed',
    'context-lost',
    'internal',
  ];
  const FRAME_ONLY: readonly ErrorCode[] = ['unknown-method', 'timeout'];

  test('the two frame-only codes do NOT pass the viewer’s own set', () => {
    for (const code of FRAME_ONLY) expect(z.safeParse(viewerErrorCodeSchema, code).success).toBe(false);
  });

  test('the viewer’s eleven all pass their own set', () => {
    for (const code of VIEWER_CODES) expect(z.safeParse(viewerErrorCodeSchema, code).success).toBe(true);
  });

  test('the protocol’s set accepts all thirteen and nothing else', () => {
    for (const code of [...VIEWER_CODES, ...FRAME_ONLY]) expect(z.safeParse(errorCodeSchema, code).success).toBe(true);
    expect(z.safeParse(errorCodeSchema, 'bad-format').success).toBe(false);
    expect(z.safeParse(errorCodeSchema, 'internal ').success).toBe(false);
  });
});

// ---------------------------------------------------------------- events ----

describe('the event union', () => {
  /** One legal payload per event name, spelled the way the frame emits it. */
  const PAYLOADS: { [E in EventName]: EmbedEventMap[E] } = {
    ready: { options: { locale: 'en' }, sceneId: DEMO.scene },
    error: { code: 'scene-invalid', message: 'the document is not a scene' },
    scene: { sceneId: DEMO.scene, rev: 3 },
    mode: 'walk',
    lightTemperature: { temperature: 3000, source: 'panel' },
    select: {
      kind: 'wall',
      id: DEMO.wall.spineKitchen,
      wallId: DEMO.wall.spineKitchen,
      roomId: DEMO.room.kitchen,
      face: { room: DEMO.room.kitchen, wallId: DEMO.wall.spineKitchen, side: 'R' },
      point: { x: 1, z: 2 },
      mode: 'plan2d',
    },
    progress: { state: 'playing', fraction: 0.25, distance: 4, length: 16, elapsed: 5, duration: 20, speed: 2 },
    state: { state: 'paused' },
    ended: {},
    size: { width: 800, height: 450 },
    disposed: undefined,
  };

  test('accepts every event the frame emits', () => {
    for (const [event, payload] of Object.entries(PAYLOADS)) {
      expect({ event, ok: z.safeParse(eventSchema, { event, payload }).success }).toEqual({ event, ok: true });
    }
  });

  test('refuses an event name the protocol does not have', () => {
    expect(z.safeParse(eventSchema, { event: 'exploded', payload: {} }).success).toBe(false);
  });

  test('an error event carries a code from the protocol’s own set', () => {
    expect(z.safeParse(eventSchema, { event: 'error', payload: { code: 'timeout', message: 'no reply' } }).success).toBe(true);
    expect(z.safeParse(eventSchema, { event: 'error', payload: { code: 'bad-format', message: 'x' } }).success).toBe(false);
  });

  test('a select event with no id (a click on nothing) is still a select', () => {
    expect(z.safeParse(eventSchema, { event: 'select', payload: { kind: 'none', mode: 'orbit' } }).success).toBe(true);
  });

  test('a select event names its face as a FaceKey, never as a joined string', () => {
    const select = (face: unknown) => z.safeParse(eventSchema, { event: 'select', payload: { kind: 'wall', face, mode: 'orbit' } }).success;
    expect(select({ wallId: DEMO.wall.bayLiving, side: 'R' })).toBe(true);
    expect(select(`${DEMO.room.kitchen}:${DEMO.wall.spineKitchen}:L`)).toBe(false);
    expect(select({ wallId: DEMO.wall.bayLiving, side: 'up' })).toBe(false);
    expect(select({ wallId: DEMO.wall.bayLiving, side: 'R', faceId: 'x' })).toBe(false);
  });

  test('a select event with an unknown kind is refused', () => {
    expect(z.safeParse(eventSchema, { event: 'select', payload: { kind: 'ceiling', mode: 'orbit' } }).success).toBe(false);
  });
});

describe('readyPayloadSchema', () => {
  test('needs a sceneId and nothing else', () => {
    expect(z.safeParse(readyPayloadSchema, { sceneId: DEMO.scene }).success).toBe(true);
    expect(z.safeParse(readyPayloadSchema, { sceneId: DEMO.scene, options: { locale: 'en' } }).success).toBe(true);
    expect(z.safeParse(readyPayloadSchema, { sceneId: 7 }).success).toBe(false);
    expect(z.safeParse(readyPayloadSchema, {}).success).toBe(false);
    expect(z.safeParse(readyPayloadSchema, null).success).toBe(false);
    expect(z.safeParse(readyPayloadSchema, 'ready').success).toBe(false);
  });
});

describe('isJeexEnvelope, the frame side of isJeexMessage', () => {
  const command = { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId: 'v1', kind: 'command', id: 'c1', method: 'play' };
  const event = { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId: 'v1', kind: 'event', event: 'ready' };
  const bare = Object.assign(Object.create(null) as Record<string, unknown>, event);

  /** Every message the hand-written host guard is tested against, ours and not. */
  const FIXTURES: ReadonlyArray<readonly [string, unknown, boolean]> = [
    ['a command', command, true],
    ['a reply', { ...command, kind: 'reply', ok: true }, true],
    ['an event', event, true],
    ['a built command', commandMessage('v1', 'c1', 'play'), true],
    ['a built reply', commandReply('v1', 'c1', { ok: true }), true],
    ['a built event', eventMessage('v1', 'ready', {}), true],
    ['a null-prototype event', bare, true],
    ['another channel', { ...command, channel: 'other-widget' }, false],
    ['another version', { ...command, version: 2 }, false],
    ['a string version', { ...command, version: '1' }, false],
    ['a NaN version', { ...command, version: Number.NaN }, false],
    ['no viewer', { ...command, viewerId: undefined }, false],
    ['a numeric viewer', { ...command, viewerId: 1 }, false],
    ['an unknown kind', { ...command, kind: 'shout' }, false],
    ['no kind', { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId: 'v1' }, false],
    ['a numeric id', { ...command, id: 7 }, false],
    ['no id', { ...command, id: undefined }, false],
    ['a numeric method', { ...command, method: 7 }, false],
    ['a reply whose ok is a string', { ...command, kind: 'reply', ok: 'yes' }, false],
    ['a reply with no id', { ...command, kind: 'reply', ok: true, id: undefined }, false],
    ['an event with no event name', { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId: 'v1', kind: 'event' }, false],
    ['null', null, false],
    ['undefined', undefined, false],
    ['a bare string', 'jeex-embed', false],
    ['a number', 7, false],
    ['an array', [], false],
    ['a function', () => undefined, false],
  ];

  test.each(FIXTURES)('%s: the schema and the hand-written guard agree', (_name, value, expected) => {
    expect([isJeexEnvelope(value), isJeexMessage(value)]).toEqual([expected, expected]);
  });
});
