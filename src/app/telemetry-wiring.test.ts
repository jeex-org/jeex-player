import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { telemetryWiring, type TelemetryWiringDeps } from './telemetry-wiring.js';
import { ViewerEvents } from './viewer-events.js';
import { FrameSite } from '../embed/frame-site.js';
import { TourEvents } from '../camera/tour-controls.js';
import { resolveViewerOptions, type ViewerOptionsInput } from './viewer-options.js';
import type { FrameHook } from '../render/render-runtime.js';
import type { ViewerStage } from './viewer-stage.js';
import type { ViewerMode } from '../scene/types.js';
import type { ProjectInfo } from './project-wiring.js';
import type { UpgradeResult } from '../geometry/scene-builder.js';
import type { SceneModel } from '../scene/scene-model.js';
import { solvePlan, type SolvedPlan } from '../plan/plan-solver.js';
import { roomOf } from '../plan/plan-rooms.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';

const SCENE_A = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e5a';
const SCENE_B = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e5b';
const PROJECT = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e51';
const BAKE = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e52';
const ASSET = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e53';

type Listener = () => void;

/** A window with the surface telemetry touches; `leave()` plays a tab switch. */
function fakeWindow(gpc = false) {
  const leave = new Set<Listener>();
  /** Every listener bound on the window or the document, by type, live ones only; and every live timer. */
  const bound = new Map<string, number>();
  const timers = new Set<number>();
  let nextTimer = 0;
  const bind = (type: string, options?: { signal?: AbortSignal }) => {
    bound.set(type, (bound.get(type) ?? 0) + 1);
    options?.signal?.addEventListener('abort', () => bound.set(type, (bound.get(type) ?? 1) - 1), { once: true });
  };
  let clock = 1000;
  const win = {
    navigator: { globalPrivacyControl: gpc, userAgent: 'Mozilla/5.0 Firefox/144.0' },
    location: { origin: 'https://agency.example', pathname: '/flats/sea-view' },
    performance: { now: () => clock },
    addEventListener: (type: string, callback: Listener, options?: { signal?: AbortSignal }) => {
      bind(type, options);
      if (type !== 'pagehide') return;
      leave.add(callback);
      options?.signal?.addEventListener('abort', () => leave.delete(callback), { once: true });
    },
    setInterval: () => {
      timers.add((nextTimer += 1));
      return nextTimer;
    },
    clearInterval: (handle: number) => timers.delete(handle),
    setTimeout: () => {
      timers.add((nextTimer += 1));
      return nextTimer;
    },
    clearTimeout: (handle: number) => timers.delete(handle),
    matchMedia: () => ({ matches: false }),
  };
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type: string, _callback: Listener, options?: { signal?: AbortSignal }) => bind(type, options),
    defaultView: win,
  };
  return {
    container: { ownerDocument: doc, clientWidth: 1200 } as unknown as HTMLElement,
    leave: () => {
      for (const listener of [...leave]) listener();
    },
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    /** Live listeners of any type plus live timers. */
    listeners: () => [...bound.values()].reduce((sum, count) => sum + count, 0) + timers.size,
  };
}

/** A stage whose runtime draws when told. */
function fakeStage(page: ReturnType<typeof fakeWindow>) {
  const hooks = new Set<FrameHook>();
  let lastDrawnAt = Number.NEGATIVE_INFINITY;
  const stage = {
    mode: 'orbit' as ViewerMode,
    camera: { position: { x: 0, z: 0 } },
    runtime: {
      get lastDrawnAt() {
        return lastDrawnAt;
      },
      renderer: { getContext: () => null },
      addPostRenderHook: (hook: FrameHook) => hooks.add(hook),
      removePostRenderHook: (hook: FrameHook) => hooks.delete(hook),
    },
  };
  return {
    stage: stage as unknown as ViewerStage,
    setMode(mode: ViewerMode) {
      stage.mode = mode;
    },
    /** One frame of `ms`; `drawn: false` is a frame the plan heartbeat skipped. */
    frame(ms = 16, drawn = true) {
      page.advance(ms);
      if (drawn) lastDrawnAt = page.now();
      for (const hook of [...hooks]) hook(ms / 1000, page.now());
    },
    hooks: () => hooks.size,
  };
}

const original = globalThis.fetch;
let bodies: Array<Record<string, unknown>> = [];
beforeEach(() => {
  bodies = [];
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

function rig(options: ViewerOptionsInput = {}, gpc = false, site?: TelemetryWiringDeps['site'], plan?: SolvedPlan) {
  const page = fakeWindow(gpc);
  const events = new ViewerEvents();
  const tourEvents = new TourEvents();
  let project: ProjectInfo | null = null;
  const deps: TelemetryWiringDeps = {
    options: resolveViewerOptions({ scene: { url: 'scene.json' }, ...options }),
    embed: site ? 'iframe' : 'element',
    site,
    container: page.container,
    events,
    tourEvents,
    project: () => project,
    plan: () => plan,
    fullscreen: () => false,
  };
  const wiring = telemetryWiring(deps);
  const stage = fakeStage(page);
  return {
    page,
    events,
    tourEvents,
    wiring,
    stage,
    setProject: (next: ProjectInfo | null) => {
      project = next;
    },
    ready: (sceneId: string) => events.emit('ready', { options: deps.options, sceneId }),
  };
}

const projectInfo = {
  manifest: { projectId: PROJECT, bakeId: BAKE, library: { objects: [{ id: ASSET }] } },
  baseUrl: '',
} as unknown as ProjectInfo;
const model = (sceneId: string) => ({ scene: { id: sceneId } }) as unknown as SceneModel;
const result = (over: Partial<UpgradeResult> = {}): UpgradeResult => ({
  upgraded: 1,
  failed: 0,
  budget: false,
  failures: [],
  ...over,
});

describe('telemetry wiring', () => {
  test('off and GPC: nothing is sent and nothing is listened to, through a whole session', () => {
    for (const subject of [
      rig({ analytics: { mode: 'off' } }),
      rig({}, true),
      rig({ analytics: { endpoint: '' }, onLog: () => undefined }),
    ]) {
      subject.wiring.attach(subject.stage.stage);
      subject.ready(SCENE_A);
      subject.stage.frame();
      subject.wiring.usage('door');
      subject.page.leave();
      // Nothing is listened to, hooked or timed WHILE the viewer is mounted.
      expect([subject.page.listeners(), subject.stage.hooks()]).toEqual([0, 0]);
      subject.wiring.dispose();
    }
    expect(bodies).toEqual([]);
  });

  test('view at once with a null subject; ready on the first DRAWN frame, with the ids', () => {
    const subject = rig();
    expect(bodies.map((body) => [body['event'], body['subject']])).toEqual([['view', { project: null, bake: null, scene: null }]]);
    subject.wiring.attach(subject.stage.stage);
    subject.setProject(projectInfo);
    subject.page.advance(2400);
    subject.ready(SCENE_A);
    subject.stage.frame(16, false);
    expect(bodies).toHaveLength(1);
    subject.stage.frame(16, true);
    expect(bodies[1]).toMatchObject({
      event: 'ready',
      load: '1-3s',
      subject: { project: PROJECT, bake: BAKE, scene: SCENE_A },
      page: '/flats/sea-view',
    });
    // A context restore announces `ready` again: it is not a second load.
    subject.ready(SCENE_A);
    subject.stage.frame();
    expect(bodies.filter((body) => body['event'] === 'ready')).toHaveLength(1);
    subject.wiring.dispose();
  });

  test('modes: the start view does not count, a real change does, the same mode does not', () => {
    const subject = rig();
    subject.events.emit('mode', 'walk');
    subject.ready(SCENE_A);
    subject.events.emit('mode', 'walk');
    subject.events.emit('mode', 'plan2d');
    subject.events.emit('mode', 'plan2d');
    subject.page.leave();
    expect(bodies.find((body) => body['group'] === 'actions')?.['counts']).toMatchObject({ mode: 1 });
    subject.wiring.dispose();
  });

  test('tour start and the usage sink count; selections count by kind', () => {
    const subject = rig();
    subject.tourEvents.emitState('playing');
    subject.tourEvents.emitState('paused');
    subject.tourEvents.emitState('playing');
    subject.wiring.usage('tour_complete');
    subject.events.emit('select', { kind: 'furniture', id: ASSET, mode: 'orbit' } as never);
    subject.events.emit('select', { kind: 'none', mode: 'orbit' } as never);
    subject.page.leave();
    expect(bodies.find((body) => body['group'] === 'actions')?.['counts']).toMatchObject({
      tour_start: 1,
      tour_complete: 1,
      select_furniture: 1,
    });
    subject.wiring.dispose();
  });

  test('frames count only in 3D modes and leave as a device send', () => {
    const subject = rig();
    subject.wiring.attach(subject.stage.stage);
    subject.stage.setMode('plan2d');
    for (let index = 0; index < 10; index += 1) subject.stage.frame(500);
    subject.page.leave();
    expect(bodies.some((body) => body['group'] === 'device')).toBe(false);
    subject.stage.setMode('orbit');
    for (let index = 0; index < 10; index += 1) subject.stage.frame(16);
    subject.page.leave();
    expect(bodies.find((body) => body['group'] === 'device')).toMatchObject({
      fps: { '>50': 100 },
      gpu: 'none',
      width: '1024-1600',
      input: 'pointer',
    });
    subject.wiring.dispose();
  });

  test('a scene replacement sends the old data with the old subject first', () => {
    const subject = rig();
    subject.wiring.attach(subject.stage.stage);
    subject.ready(SCENE_A);
    subject.stage.frame();
    subject.wiring.modelsSettled(model(SCENE_A), result({ failed: 1, failures: [new TypeError('Failed to fetch')] }));
    subject.wiring.usage('door');
    subject.wiring.loadStarted();
    subject.page.advance(500);
    subject.wiring.beforePresent(SCENE_B);
    const flushed = bodies.slice(2);
    expect(flushed.map((body) => [body['group'], (body['subject'] as { scene: string }).scene])).toEqual([
      ['lifecycle', SCENE_A],
      ['actions', SCENE_A],
      ['error', SCENE_A],
    ]);
    expect(flushed[0]).toMatchObject({ event: 'models_loaded', outcome: 'partial', failed: 1, assets: [] });
    expect(flushed[2]).toMatchObject({ code: 'network', stage: 'model_load', name: 'TypeError', frames: [] });
    subject.ready(SCENE_B);
    subject.stage.frame();
    expect(bodies.at(-1)).toMatchObject({ event: 'ready', load: '<1s', subject: { scene: SCENE_B } });
    subject.wiring.dispose();
  });

  test('a first load that fails is reported with a null subject; a host mistake is not reported', () => {
    const subject = rig();
    subject.events.emit('error', { code: 'scene-load', message: 'Scene fetch failed: 404 https://x/?token=1', cause: new TypeError('x') });
    subject.events.emit('error', { code: 'no-scene-source', message: 'no scene' });
    subject.page.leave();
    const errors = bodies.filter((body) => body['group'] === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'network', stage: 'scene_load', subject: { project: null, bake: null, scene: null } });
    expect(JSON.stringify(bodies)).not.toContain('token');
    subject.wiring.dispose();
  });

  test('models_loaded carries the project library and an outcome of none when nothing had a model', () => {
    const subject = rig();
    subject.setProject(projectInfo);
    subject.ready(SCENE_A);
    subject.wiring.modelsSettled(model(SCENE_A), result({ upgraded: 0 }));
    subject.page.leave();
    expect(bodies.find((body) => body['event'] === 'models_loaded')).toMatchObject({ outcome: 'none', assets: [ASSET] });
    subject.wiring.dispose();
  });
});

describe('telemetry wiring: what is not a new load', () => {
  test('models that settle before ready carry their own scene', () => {
    const subject = rig();
    subject.wiring.modelsSettled(model(SCENE_A), result({ upgraded: 0 }));
    subject.page.leave();
    expect(bodies.find((body) => body['event'] === 'models_loaded')?.['subject']).toMatchObject({ scene: SCENE_A });
    subject.wiring.dispose();
  });

  test('a new revision of the scene on screen flushes nothing and sends no second ready', () => {
    const subject = rig();
    subject.wiring.attach(subject.stage.stage);
    subject.ready(SCENE_A);
    subject.stage.frame();
    subject.wiring.usage('door');
    const before = bodies.length;
    subject.wiring.loadStarted();
    subject.wiring.beforePresent(SCENE_A);
    subject.ready(SCENE_A);
    subject.stage.frame();
    expect(bodies.length).toBe(before);
    subject.wiring.dispose();
  });

  test('a pause and the plan heartbeat add no frame time and no room time', () => {
    const subject = rig();
    subject.wiring.attach(subject.stage.stage);
    subject.stage.frame(16);
    subject.stage.frame(16);
    subject.stage.frame(5000);
    subject.stage.setMode('plan2d');
    subject.stage.frame(500);
    subject.stage.setMode('orbit');
    subject.stage.frame(400);
    subject.stage.frame(16);
    subject.page.leave();
    // Two 16 ms frames count; the pause and the gap after the heartbeat do not.
    expect(bodies.find((body) => body['group'] === 'device')).toMatchObject({ fps: { '>50': 100, '<20': 0 } });
    subject.wiring.dispose();
  });
});

describe('telemetry wiring: the iframe page', () => {
  test('a live mount listens to page leave and errors and keeps one timer, and dispose ends all of it', () => {
    const subject = rig();
    subject.wiring.attach(subject.stage.stage);
    expect(subject.page.listeners()).toBeGreaterThanOrEqual(4);
    subject.wiring.dispose();
    expect(subject.page.listeners()).toBe(0);
  });

  test('view and ready wait for the host context, then carry its page and the verified site, without ancestor origins', () => {
    const frameWindow = { location: {} } as unknown as Window;
    const site = new FrameSite(frameWindow);
    const subject = rig({}, false, site);
    subject.wiring.attach(subject.stage.stage);
    subject.ready(SCENE_A);
    subject.stage.frame();
    expect(bodies).toEqual([]);
    // The bridge saw a verified message from the host, then its context.
    site.verified('https://agency.example');
    site.context('/listing/1234567?utm=x');
    expect(bodies.map((body) => [body['event'], body['embed'], body['site'], body['page']])).toEqual([
      ['view', 'iframe', 'https://agency.example', '/listing/:id'],
      ['ready', 'iframe', 'https://agency.example', '/listing/:id'],
    ]);
    subject.wiring.dispose();
  });
});

describe('telemetry wiring under drawing on demand (walk and tour skip draws while resting)', () => {
  test('a resting gap between two draws is not a slow frame', () => {
    const subject = rig();
    subject.wiring.attach(subject.stage.stage);
    subject.stage.setMode('walk');
    for (let index = 0; index < 5; index += 1) subject.stage.frame(16);
    // Half a second of ticks that drew nothing, then the camera moves.
    for (let index = 0; index < 30; index += 1) subject.stage.frame(16, false);
    for (let index = 0; index < 5; index += 1) subject.stage.frame(16);
    subject.page.leave();
    expect(bodies.find((body) => body['group'] === 'device')).toMatchObject({ fps: { '>50': 100, '<20': 0 } });
    subject.wiring.dispose();
  });

  test('dwell grows while the visitor stands still in a room, and a pause adds nothing', () => {
    const plan = solvePlan(lShapePlan);
    const subject = rig({}, false, undefined, plan);
    const room = plan.rooms.find((candidate) => {
      const box = candidate.bbox;
      return roomOf(plan, { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 }) === candidate.roomId;
    })!;
    const position = subject.stage.stage.camera.position;
    position.x = (room.bbox.minX + room.bbox.maxX) / 2;
    position.z = (room.bbox.minZ + room.bbox.maxZ) / 2;
    subject.wiring.attach(subject.stage.stage);
    subject.stage.setMode('walk');
    subject.stage.frame(16);
    // Ten seconds at rest: ticks that drew nothing.
    for (let index = 0; index < 625; index += 1) subject.stage.frame(16, false);
    // A hidden tab: the loop stopped, the next tick comes a minute later.
    subject.stage.frame(60_000, false);
    subject.page.leave();
    expect(bodies.find((body) => body['group'] === 'rooms')).toMatchObject({ rooms: [{ room: room.roomId, dwell: '5-30s' }] });
    subject.wiring.dispose();
  });
});

describe('telemetry wiring: ready follows the first picture', () => {
  test('a resting walk that drew before `ready` reports the load at the next tick, timed by that draw', () => {
    const subject = rig();
    subject.wiring.attach(subject.stage.stage);
    subject.stage.setMode('walk');
    subject.page.advance(800);
    // The first picture, then `ready` (it now follows the draw), then ticks that draw nothing.
    subject.stage.frame(16, true);
    subject.page.advance(3000);
    subject.ready(SCENE_A);
    subject.stage.frame(16, false);
    expect(bodies.at(-1)).toMatchObject({ event: 'ready', load: '<1s' });
    subject.wiring.dispose();
  });
});
