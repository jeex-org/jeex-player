import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FLUSH_INTERVAL_MS, createTelemetry, type TelemetryConfig, type TelemetryHost } from './telemetry.js';
import { COUNTER_KEYS, DEFAULT_TELEMETRY_ENDPOINT, ERROR_CODES, ERROR_NAMES, ERROR_STAGES, EMBED_FORMS } from './vocabulary.js';
import { DWELL_BUCKETS, LOAD_BUCKETS, WIDTH_BUCKETS } from './buckets.js';

const PROJECT = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e51';
const BAKE = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e52';
const SCENE = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e53';
const ROOM = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e54';
const OWN = 'https://cdn.example/jeex/jeex-viewer.iife.js';

type FakeHost = TelemetryHost & {
  leave(): void;
  tick(): void;
  pageError(code: 'exception' | 'rejection', error: unknown): void;
  listeners: { leave: number; pageError: number; timers: number; timeouts: number };
  /** Runs every pending one-shot timer, as if its time had come. */
  elapse(): void;
  gpcValue: boolean;
};

function fakeHost(): FakeHost {
  const leave = new Set<() => void>();
  const pageErrors = new Set<(code: 'exception' | 'rejection', error: unknown) => void>();
  const timers = new Set<() => void>();
  const timeouts = new Set<() => void>();
  const host: FakeHost = {
    gpcValue: false,
    gpc: () => host.gpcValue,
    site: () => 'https://agency.example',
    page: () => '/flats/1234567?email=a@b.example#x',
    browser: () => 'chromium-13x',
    onLeave(listener, signal) {
      leave.add(listener);
      signal.addEventListener('abort', () => leave.delete(listener), { once: true });
    },
    onPageError(listener, signal) {
      pageErrors.add(listener);
      signal.addEventListener('abort', () => pageErrors.delete(listener), { once: true });
    },
    every(ms, run) {
      expect(ms).toBe(FLUSH_INTERVAL_MS);
      timers.add(run);
      return () => timers.delete(run);
    },
    after(_ms, run) {
      timeouts.add(run);
      return () => timeouts.delete(run);
    },
    elapse: () => {
      for (const run of [...timeouts]) {
        timeouts.delete(run);
        run();
      }
    },
    leave: () => {
      for (const listener of [...leave]) listener();
    },
    tick: () => {
      for (const run of [...timers]) run();
    },
    pageError: (code, error) => {
      for (const listener of [...pageErrors]) listener(code, error);
    },
    get listeners() {
      return { leave: leave.size, pageError: pageErrors.size, timers: timers.size, timeouts: timeouts.size };
    },
  };
  return host;
}

const original = globalThis.fetch;
let requests: Array<{ url: string; body: Record<string, unknown> }> = [];
beforeEach(() => {
  requests = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(init?.body as string) as Record<string, unknown> });
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

const ownError = (name = 'TypeError', line = 7): Error => {
  const error = new Error('secret message with someone@example.org');
  error.name = name;
  error.stack = `${name}: secret message with someone@example.org\n    at f (${OWN}:${line}:3)`;
  return error;
};

function config(host: TelemetryHost, overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  return { mode: 'on', endpoint: undefined, embed: 'element', player: '0.1.0', host, isOwn: (url) => url === OWN, ...overrides };
}

/** Uses the player the way a visitor does: every kind of data, then every trigger; `beforeDispose` sees the live state. */
function session(host: FakeHost, overrides: Partial<TelemetryConfig> = {}, beforeDispose: () => void = () => undefined): void {
  const telemetry = createTelemetry(config(host, overrides));
  telemetry?.viewed();
  telemetry?.setLang('de');
  telemetry?.setSubject({ project: PROJECT, bake: BAKE, scene: SCENE });
  telemetry?.ready(2.4);
  telemetry?.setDevice({ gpu: 'mid', width: '1024-1600', input: 'pointer' });
  for (const key of COUNTER_KEYS) telemetry?.count(key);
  for (let index = 0; index < 120; index += 1) telemetry?.frame(1000 / 60, index % 2 === 0);
  telemetry?.dwell(ROOM, 40_000);
  telemetry?.modelsLoaded(4, 'partial', 1, [SCENE, PROJECT, 'not-a-uuid']);
  telemetry?.error('network', 'scene_load', new TypeError('Failed to fetch https://site.example/?token=1'));
  telemetry?.error('exception', 'tour', ownError());
  host.pageError('rejection', ownError('RangeError', 9));
  host.tick();
  telemetry?.count('mode');
  host.leave();
  telemetry?.count('door');
  host.elapse();
  beforeDispose();
  telemetry?.dispose();
}

describe('createTelemetry: off means nothing at all', () => {
  test('off, GPC and a refused endpoint create nothing and send nothing through a whole session', () => {
    const none = { leave: 0, pageError: 0, timers: 0, timeouts: 0 };
    for (const overrides of [{ mode: 'off' as const }, { endpoint: 'ftp://stats.example/' }, { endpoint: '' }]) {
      const host = fakeHost();
      // Nothing is listened to or timed WHILE the mount lives, not merely after it.
      session(host, overrides, () => expect(host.listeners).toEqual(none));
    }
    const gpc = fakeHost();
    gpc.gpcValue = true;
    session(gpc, {}, () => expect(gpc.listeners).toEqual(none));
    session(gpc, { hold: () => undefined }, () => expect(gpc.listeners).toEqual(none));
    expect(requests).toEqual([]);
  });

  test('positive control: the same session with telemetry on does send', () => {
    session(fakeHost());
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.url === DEFAULT_TELEMETRY_ENDPOINT)).toBe(true);
  });

  test('GPC turned on after the mount stops every later request', () => {
    const host = fakeHost();
    const telemetry = createTelemetry(config(host))!;
    telemetry.viewed();
    host.gpcValue = true;
    telemetry.count('mode');
    host.leave();
    telemetry.dispose();
    expect(requests.map((request) => request.body['event'])).toEqual(['view']);
  });

  test('an endpoint override is used', () => {
    const telemetry = createTelemetry(config(fakeHost(), { endpoint: 'https://stats.agency.example/p' }))!;
    telemetry.viewed();
    telemetry.dispose();
    expect(requests.map((request) => request.url)).toEqual(['https://stats.agency.example/p']);
  });
});

describe('sends', () => {
  test('view leaves at once with a null subject and a sanitised page', () => {
    const telemetry = createTelemetry(config(fakeHost()))!;
    telemetry.viewed();
    telemetry.viewed();
    expect(requests.map((request) => request.body)).toEqual([
      {
        schema: '1.0.0',
        player: '0.1.0',
        embed: 'element',
        site: 'https://agency.example',
        page: '/flats/:id',
        subject: { project: null, bake: null, scene: null },
        lang: 'other',
        group: 'lifecycle',
        event: 'view',
      },
    ]);
    telemetry.dispose();
  });

  test('a flush makes one request per group and one per error report, models_loaded first', () => {
    const host = fakeHost();
    const telemetry = createTelemetry(config(host))!;
    telemetry.setSubject({ project: PROJECT, bake: BAKE, scene: SCENE });
    telemetry.setDevice({ gpu: 'high', width: '>1600', input: 'touch' });
    telemetry.modelsLoaded(1.5, 'complete', 0, [PROJECT]);
    telemetry.count('mode');
    telemetry.dwell(ROOM, 3000);
    telemetry.frame(20, false);
    telemetry.error('network', 'scene_load', new TypeError('x'));
    telemetry.error('size_limit', 'model_load', new Error('x'));
    host.leave();
    expect(requests.map((request) => [request.body['group'], request.body['event'] ?? request.body['code'] ?? null])).toEqual([
      ['lifecycle', 'models_loaded'],
      ['actions', null],
      ['rooms', null],
      ['device', null],
      ['error', 'network'],
      ['error', 'size_limit'],
    ]);
    telemetry.dispose();
  });

  test('nothing gathered, nothing sent; hidden then pagehide send once', () => {
    const host = fakeHost();
    const telemetry = createTelemetry(config(host))!;
    host.leave();
    expect(requests).toEqual([]);
    telemetry.count('door');
    host.leave();
    host.leave();
    expect(requests.length).toBe(1);
    telemetry.dispose();
  });

  test('the timer flushes and dispose stops it', () => {
    const host = fakeHost();
    const telemetry = createTelemetry(config(host))!;
    telemetry.count('minimap');
    host.tick();
    expect(requests.length).toBe(1);
    telemetry.dispose();
    expect(host.listeners).toEqual({ leave: 0, pageError: 0, timers: 0, timeouts: 0 });
  });

  test('models_loaded keeps the subject of its own scene', () => {
    const host = fakeHost();
    const telemetry = createTelemetry(config(host))!;
    telemetry.setSubject({ project: PROJECT, bake: BAKE, scene: SCENE });
    telemetry.modelsLoaded(2, 'none', 0, []);
    telemetry.setSubject({ project: null, bake: null, scene: null });
    host.leave();
    expect(requests[0]?.body['subject']).toEqual({ project: PROJECT, bake: BAKE, scene: SCENE });
    telemetry.dispose();
  });

  test('ids that are not UUIDs never leave', () => {
    const telemetry = createTelemetry(config(fakeHost()))!;
    telemetry.setSubject({ project: 'acme-tower', bake: BAKE, scene: 'living' });
    telemetry.ready(0.5);
    expect(requests[0]?.body['subject']).toEqual({ project: null, bake: BAKE, scene: null });
    telemetry.dispose();
  });

  test('a send that fails its schema is dropped, not repaired', () => {
    const host = fakeHost();
    const telemetry = createTelemetry(config(host))!;
    telemetry.setDevice({ gpu: 'mid', width: '9000px' as never, input: 'pointer' });
    telemetry.frame(16, false);
    telemetry.count('door');
    host.leave();
    expect(requests.map((request) => request.body['group'])).toEqual(['actions']);
    telemetry.dispose();
  });
});

describe('errors', () => {
  test('a site error from the page-wide listener is not sent; the message never is', () => {
    const host = fakeHost();
    const telemetry = createTelemetry(config(host))!;
    const site = new Error('site');
    site.stack = 'Error: site\n    at g (https://agency.example/app.js:1:1)';
    host.pageError('exception', site);
    host.pageError('exception', ownError());
    host.leave();
    expect(requests.length).toBe(1);
    expect(requests[0]?.body).toMatchObject({ group: 'error', code: 'exception', stage: 'runtime', name: 'TypeError', count: 1 });
    expect(requests[0]?.body['frames']).toEqual([{ file: 'jeex-viewer.iife.js', line: 7, column: 3 }]);
    expect(JSON.stringify(requests)).not.toContain('secret');
    telemetry.dispose();
  });

  test('two players share one page-wide listener, and one error is reported once', () => {
    const host = fakeHost();
    const first = createTelemetry(config(host))!;
    const second = createTelemetry(config(host))!;
    expect(host.listeners.pageError).toBe(1);
    host.pageError('exception', ownError());
    first.flush();
    second.flush();
    expect(requests.filter((request) => request.body['group'] === 'error').length).toBe(1);
    first.dispose();
    expect(host.listeners.pageError).toBe(1);
    second.dispose();
    expect(host.listeners.pageError).toBe(0);
  });
});

describe('the never-list walk', () => {
  test('every send of a full session has closed keys and only vocabulary strings', () => {
    session(fakeHost());
    const allowed = new Set<string>([
      ...EMBED_FORMS,
      ...ERROR_CODES,
      ...ERROR_NAMES,
      ...ERROR_STAGES,
      ...LOAD_BUCKETS,
      ...DWELL_BUCKETS,
      ...WIDTH_BUCKETS,
      'lifecycle',
      'actions',
      'rooms',
      'device',
      'error',
      'view',
      'ready',
      'models_loaded',
      'partial',
      'mid',
      'pointer',
      'de',
      'other',
      '1.0.0',
      '0.1.0',
      'https://agency.example',
      '/flats/:id',
      'chromium-13x',
      'jeex-viewer.iife.js',
      PROJECT,
      BAKE,
      SCENE,
      ROOM,
    ]);
    const forbidden =
      /user.?agent|renderer|visit|visitor|session|timestamp|time$|^at$|message|stack|cookie|storage|ip$|coords|position|camera|order|url|query|referrer/i;
    const strings: string[] = [];
    const walk = (value: unknown, key: string): void => {
      expect({ key, forbidden: forbidden.test(key) && key !== 'camera_step' }).toEqual({ key, forbidden: false });
      if (typeof value === 'string') strings.push(value);
      else if (Array.isArray(value)) for (const item of value) walk(item, key);
      else if (value !== null && typeof value === 'object') for (const [child, inner] of Object.entries(value)) walk(inner, child);
    };
    for (const request of requests) walk(request.body, 'body');
    // The key list of every REAL send, per group and lifecycle event.
    const context = ['embed', 'group', 'lang', 'page', 'player', 'schema', 'site', 'subject'];
    const expected: Record<string, string[]> = {
      'lifecycle/view': [...context, 'event'],
      'lifecycle/ready': [...context, 'event', 'load'],
      'lifecycle/models_loaded': [...context, 'assets', 'event', 'failed', 'load', 'outcome'],
      'actions/': [...context, 'counts'],
      'rooms/': [...context, 'rooms'],
      'device/': [...context, 'fps', 'fullscreen', 'gpu', 'input', 'width'],
      'error/': [...context, 'browser', 'code', 'count', 'frames', 'name', 'stage'],
    };
    const seen = new Set<string>();
    for (const { body } of requests) {
      const kind = `${String(body['group'])}/${typeof body['event'] === 'string' ? body['event'] : ''}`;
      seen.add(kind);
      expect({ kind, keys: Object.keys(body).sort() }).toEqual({ kind, keys: [...(expected[kind] ?? ['unexpected'])].sort() });
      expect(Object.keys(body['subject'] as object).sort()).toEqual(['bake', 'project', 'scene']);
    }
    expect([...seen].sort()).toEqual(Object.keys(expected).sort());
    const counts = requests.find((request) => request.body['group'] === 'actions')?.body['counts'] as object;
    expect(Object.keys(counts).sort()).toEqual([...COUNTER_KEYS].sort());
    expect(requests.length).toBeGreaterThanOrEqual(8);
    expect(strings.filter((value) => !allowed.has(value))).toEqual([]);
    expect(JSON.stringify(requests)).not.toMatch(/someone@example|secret|token|1234567|Failed to fetch/);
  });
});

describe('the iframe hold', () => {
  test('view and ready wait for the host context and then carry the page the host named', () => {
    let page: string | null = null;
    let release: () => void = () => undefined;
    const host = { ...fakeHost(), page: () => page };
    const telemetry = createTelemetry(config(host, { hold: (go) => (release = go) }))!;
    telemetry.viewed();
    telemetry.ready(0.4);
    expect(requests).toEqual([]);
    page = '/listing/1234567';
    release();
    expect(requests.map((request) => [request.body['event'], request.body['page']])).toEqual([
      ['view', '/listing/:id'],
      ['ready', '/listing/:id'],
    ]);
    release();
    expect(requests).toHaveLength(2);
    telemetry.dispose();
  });

  test('a host that never sends the context loses nothing: the cap releases them, as does the first flush', () => {
    const capped = fakeHost();
    const first = createTelemetry(config(capped, { hold: () => undefined }))!;
    first.viewed();
    expect(requests).toEqual([]);
    capped.elapse();
    expect(requests.map((request) => request.body['event'])).toEqual(['view']);
    first.dispose();
    requests = [];
    const flushed = fakeHost();
    const second = createTelemetry(config(flushed, { hold: () => undefined }))!;
    second.viewed();
    flushed.leave();
    expect(requests.map((request) => request.body['event'])).toEqual(['view']);
    second.dispose();
    expect(flushed.listeners.timeouts).toBe(0);
  });
});
