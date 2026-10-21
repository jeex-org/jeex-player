import { describe, expect, test } from 'bun:test';
import type { z } from 'zod/mini';
import { MAX_ASSETS, isTelemetryEndpoint, isTelemetrySend, telemetrySendSchema } from './telemetry.schema.js';
import { COUNTER_KEYS, type TelemetrySend } from './vocabulary.js';

const UUID = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e5f';
const CONTEXT = {
  schema: '1.0.0',
  player: '0.1.0',
  embed: 'element',
  site: 'https://agency.example',
  page: '/flats/:id',
  subject: { project: UUID, bake: UUID, scene: UUID },
  lang: 'en',
} as const;

const counts = Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));

const VALID: Record<string, TelemetrySend> = {
  view: { ...CONTEXT, group: 'lifecycle', event: 'view' },
  ready: { ...CONTEXT, group: 'lifecycle', event: 'ready', load: '1-3s' },
  models: { ...CONTEXT, group: 'lifecycle', event: 'models_loaded', load: '3-10s', outcome: 'partial', failed: 1, assets: [UUID] },
  actions: { ...CONTEXT, group: 'actions', counts: { ...counts, mode: 3 } as Record<(typeof COUNTER_KEYS)[number], number> },
  rooms: { ...CONTEXT, group: 'rooms', rooms: [{ room: UUID, dwell: '5-30s' }] },
  device: {
    ...CONTEXT,
    group: 'device',
    fps: { '<20': 0, '20-30': 10, '30-50': 30, '>50': 60 },
    gpu: 'mid',
    width: '1024-1600',
    input: 'pointer',
    fullscreen: 0,
  },
  error: {
    ...CONTEXT,
    group: 'error',
    code: 'exception',
    stage: 'tour',
    name: 'TypeError',
    frames: [{ file: 'jeex-viewer.iife.js', line: 12, column: 345 }],
    browser: 'chromium-13x',
    count: 2,
  },
};

describe('telemetry send schema', () => {
  test('every group accepts its documented shape', () => {
    for (const [name, send] of Object.entries(VALID)) expect({ name, ok: isTelemetrySend(send) }).toEqual({ name, ok: true });
  });

  test('an extra key anywhere is refused', () => {
    expect(isTelemetrySend({ ...VALID['view'], visitor: 'x' })).toBe(false);
    expect(isTelemetrySend({ ...VALID['view'], subject: { ...CONTEXT.subject, tour: 'abc' } })).toBe(false);
    expect(isTelemetrySend({ ...VALID['error'], message: 'boom' })).toBe(false);
    expect(isTelemetrySend({ ...VALID['error'], frames: [{ file: 'jeex-viewer.js', line: 1, column: 1, url: 'https://x/' }] })).toBe(false);
    expect(isTelemetrySend({ ...VALID['actions'], counts: { ...counts, scroll: 1 } })).toBe(false);
  });

  test('a value outside its vocabulary is refused', () => {
    expect(isTelemetrySend({ ...VALID['view'], subject: { ...CONTEXT.subject, scene: 'living-room' } })).toBe(false);
    expect(isTelemetrySend({ ...VALID['ready'], load: '2.4s' })).toBe(false);
    expect(isTelemetrySend({ ...VALID['view'], page: '/flat?email=a@b' })).toBe(false);
    expect(isTelemetrySend({ ...VALID['view'], site: 'https://agency.example/path' })).toBe(false);
    expect(isTelemetrySend({ ...VALID['error'], name: 'Something the page wrote' })).toBe(false);
    expect(isTelemetrySend({ ...VALID['error'], frames: [{ file: 'site.js', line: 1, column: 1 }] })).toBe(false);
    expect(isTelemetrySend({ ...VALID['error'], browser: 'Mozilla/5.0' })).toBe(false);
    expect(isTelemetrySend({ ...VALID['device'], fullscreen: 33 })).toBe(false);
    expect(isTelemetrySend({ ...VALID['actions'], counts: { ...counts, mode: 51 } })).toBe(false);
    expect(isTelemetrySend({ ...VALID['view'], lang: 'x-private' })).toBe(false);
  });

  test('arrays are bounded', () => {
    expect(isTelemetrySend({ ...VALID['models'], assets: Array.from({ length: MAX_ASSETS + 1 }, () => UUID) })).toBe(false);
    expect(isTelemetrySend({ ...VALID['rooms'], rooms: [] })).toBe(false);
    const frame = { file: 'jeex-viewer.js', line: 1, column: 1 };
    expect(isTelemetrySend({ ...VALID['error'], frames: Array.from({ length: 6 }, () => frame) })).toBe(false);
  });

  test('null context values are allowed where the spec says so', () => {
    const unknown = { ...VALID['view'], site: null, page: null, subject: { project: null, bake: null, scene: null } };
    expect(isTelemetrySend(unknown)).toBe(true);
  });

  test('the schema and the hand-written types describe the same sends', () => {
    type SchemaShape = z.infer<typeof telemetrySendSchema>;
    type BothWays = SchemaShape extends TelemetrySend ? (TelemetrySend extends SchemaShape ? true : false) : false;
    const agree: BothWays = true;
    expect(agree).toBe(true);
  });
});

describe('endpoint override', () => {
  test('https anywhere, http only on this machine', () => {
    expect(isTelemetryEndpoint('https://stats.agency.example/player')).toBe(true);
    expect(isTelemetryEndpoint('http://localhost:3700/t')).toBe(true);
    expect(isTelemetryEndpoint('http://127.0.0.1/t')).toBe(true);
  });

  test('anything else is refused', () => {
    for (const raw of [
      'http://stats.example/',
      'ftp://stats.example/',
      '/relative',
      '',
      'https://user:pw@stats.example/',
      'javascript:alert(1)',
      42,
    ]) {
      expect({ raw, ok: isTelemetryEndpoint(raw) }).toEqual({ raw, ok: false });
    }
  });
});
