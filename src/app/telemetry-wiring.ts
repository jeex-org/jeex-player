/**
 * Where a mounted viewer meets its anonymous telemetry (`TELEMETRY.md`): the
 * one module that knows the viewer's events, its stage and its documents, and
 * turns them into the plain calls `telemetry/telemetry.ts` takes.
 *
 * Off invariant: when `createTelemetry` answers `null` (the option says off,
 * the endpoint override was refused, or the browser reports Global Privacy
 * Control) this module subscribes to nothing, adds no frame hook and returns
 * a wiring whose every method does nothing.
 *
 * Measurement invariants: `ready` is timed by the last frame the renderer
 * actually DREW once a document was announced (`RenderRuntime.lastDrawnAt`;
 * the announcement follows the first picture), once per load; frame time counts only intervals between consecutive drawn 3D frames;
 * room time counts the frame loop's ticks, drawn or not, while the camera is
 * inside the apartment (walk and tour); engaged time counts the same ticks
 * in every mode, so a pause (a hidden tab, a detached or hidden canvas) is left out of
 * both; a mode change counts only after the first `ready` and only when the
 * mode really changed from the one the viewer booted in or last switched to.
 *
 * View invariant: `view` names the first document: the one loaded, or the
 * manifest's project and bake when the first load failed or the view ended
 * before it loaded. Engaged time belongs to the scene it was gathered on: a
 * replacement ends the view of the old one, and a tick that spans a hidden
 * tab adds nothing.
 */

import { createTelemetry, type Telemetry } from '../telemetry/telemetry.js';
import { browserHost, documentSite, type SiteSource } from '../telemetry/browser-host.js';
import { codeOfViewerError } from '../telemetry/error-report.js';
import { gpuClass } from '../telemetry/device.js';
import { MAX_FRAME_INTERVAL_MS } from '../telemetry/collector.js';
import { widthBucket } from '../telemetry/buckets.js';
import type { EmbedForm, ErrorStage, ModelOutcome, TelemetryErrorCode } from '../telemetry/vocabulary.js';
import { ViewerLibError, type ViewerErrorCode } from '../shared/errors.js';
import { VIEWER_VERSION } from '../shared/version.js';
import type { UsageAction, UsageSink } from '../shared/usage.js';
import { roomOf } from '../plan/plan-rooms.js';
import type { FrameHook } from '../render/render-runtime.js';
import type { TourEvents } from '../camera/tour-controls.js';
import type { UpgradeResult } from '../geometry/scene-builder.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { ViewerMode } from '../scene/types.js';
import type { ViewerEvents } from './viewer-events.js';
import type { ViewerOptions } from './viewer-options.js';
import type { ViewerStage } from './viewer-stage.js';
import type { ProjectInfo } from './project-wiring.js';

/** How often the camera's room is looked up, in ms of frame-loop time (drawn or not). */
const ROOM_SAMPLE_MS = 1000;

const ROOM_MODES: ReadonlySet<ViewerMode> = new Set<ViewerMode>(['walk', 'tour']);

/**
 * How a viewer was embedded: the form, and for the iframe page where its host
 * page is learnt from (`embed/frame-site.ts`). Not an option: a host cannot
 * claim another form.
 */
export type Embedding = { embed: EmbedForm; site?: SiteSource | undefined };

/** What the wiring reads of the viewer; all of it late-bound. */
export type TelemetryWiringDeps = {
  options: ViewerOptions;
  embed: EmbedForm;
  /** Where `site` and `page` come from; the executing document when absent. */
  site?: SiteSource | undefined;
  container: HTMLElement;
  events: ViewerEvents;
  tourEvents: TourEvents;
  project: () => ProjectInfo | null;
  /** The ids of the manifest the boot read, judged, even before or without its scene; `null` for a bare scene. */
  manifestRead: () => { projectId: string; bakeId: string } | null;
  plan: () => SceneModel['plan'] | undefined;
  fullscreen: () => boolean;
};

/** What the composition root calls. */
export type TelemetryWiring = {
  /** For the collaborators that accept a user action. */
  readonly usage: UsageSink;
  /** A new stage was built (a boot or a Retry): measure its frames. */
  attach(stage: ViewerStage): void;
  /** `loadScene` was called: its load time starts now. */
  loadStarted(): void;
  /** The boot loaded its document (before any geometry): `view` can name it. */
  documentLoaded(sceneId: string): void;
  /** `handle.setLocale` switched the chrome's language. */
  localeChanged(locale: string): void;
  /**
   * A loaded document is about to replace the one on screen: send what belongs
   * to the old one. A new revision of the SAME scene (an editor host answering
   * an edit with the whole document) is not a new load and changes nothing.
   */
  beforePresent(sceneId: string): void;
  /** The first model pass of a document ended (`SceneMount.onModelsSettled`). */
  modelsSettled(model: SceneModel, result: UpgradeResult): void;
  dispose(): void;
};

const NOTHING: TelemetryWiring = {
  usage: () => undefined,
  attach: () => undefined,
  loadStarted: () => undefined,
  documentLoaded: () => undefined,
  localeChanged: () => undefined,
  beforePresent: () => undefined,
  modelsSettled: () => undefined,
  dispose: () => undefined,
};

/** The stage of a viewer error, by the code it was raised with. */
function stageOf(code: ViewerErrorCode): ErrorStage {
  if (code === 'model-external-resource') return 'model_load';
  if (code === 'scene-load' || code === 'scene-invalid' || code === 'project-invalid') return 'scene_load';
  return 'runtime';
}

/** The code of a model that could not load. */
function modelCode(error: unknown): TelemetryErrorCode {
  if (error instanceof ViewerLibError) return codeOfViewerError(error.code, error) ?? 'model_format';
  return error instanceof TypeError ? 'network' : 'model_format';
}

function outcomeOf(result: UpgradeResult): ModelOutcome {
  if (result.budget) return 'budget';
  if (result.upgraded + result.failed === 0) return 'none';
  return result.failed > 0 ? 'partial' : 'complete';
}

export function telemetryWiring(deps: TelemetryWiringDeps): TelemetryWiring {
  const doc = deps.container.ownerDocument;
  const win = doc.defaultView;
  if (win === null) return NOTHING;
  const telemetry = createTelemetry({
    mode: deps.options.analytics.mode,
    endpoint: deps.options.analytics.endpoint,
    embed: deps.embed,
    player: VIEWER_VERSION,
    host: browserHost(win, doc, deps.site ?? documentSite(win)),
    // The iframe page holds `view`/`ready` until its host's context names the page.
    hold: deps.site?.settled === undefined ? undefined : (release) => deps.site?.settled?.(release),
  });
  if (telemetry === null) return NOTHING;
  return live(telemetry, deps, win);
}

function live(telemetry: Telemetry, deps: TelemetryWiringDeps, win: Window): TelemetryWiring {
  const clock = (): number => win.performance.now();
  telemetry.setLang(deps.options.locale);
  /** The subject a manifest names before its scene is known, or `null`. */
  const manifestSubject = () => {
    const read = deps.manifestRead();
    return read === null ? null : { project: read.projectId, bake: read.bakeId, scene: null };
  };
  telemetry.viewed(manifestSubject);

  let loadOrigin = clock();
  let nextOrigin = loadOrigin;
  /** A `ready` event arms the next drawn frame, once per load (a context restore re-announces it). */
  let readyArmed = true;
  let awaitingDraw = false;
  let booted = false;
  let lastMode: ViewerMode | null = null;
  let tourState = 'ready';
  let stage: ViewerStage | undefined;
  let detach: (() => void) | undefined;
  let shownScene: string | null = null;

  const subjectFromDocument = (sceneId: string): void => {
    shownScene = sceneId;
    const manifest = deps.project()?.manifest;
    telemetry.setSubject({ project: manifest?.projectId ?? null, bake: manifest?.bakeId ?? null, scene: sceneId });
  };
  /** Whether the first document settled, loaded or failed. */
  let settled = false;
  const documentSettled = (sceneId: string | null): void => {
    if (settled) return;
    settled = true;
    if (sceneId === null) telemetry.setSubject(manifestSubject() ?? { project: null, bake: null, scene: null });
    else subjectFromDocument(sceneId);
    telemetry.documentSettled();
  };

  const subscriptions = [
    deps.events.on('ready', (info) => {
      // The boot is not a switch: the mode on screen now is where switching starts.
      if (!booted) lastMode = stage?.mode ?? lastMode ?? deps.options.view.mode;
      booted = true;
      documentSettled(info.sceneId);
      if (!readyArmed) return;
      readyArmed = false;
      subjectFromDocument(info.sceneId);
      awaitingDraw = true;
    }),
    deps.events.on('mode', (mode) => {
      if (booted && lastMode !== null && mode !== lastMode) telemetry.count('mode');
      lastMode = mode;
    }),
    deps.events.on('select', (selection) => {
      if (selection.kind !== 'none') telemetry.count(`select_${selection.kind}`);
    }),
    deps.events.on('error', (error) => {
      // A fatal error before any document is the first load failing.
      if (error.fatal === true) documentSettled(null);
      const code = codeOfViewerError(error.code, error.cause);
      if (code !== null) telemetry.error(code, stageOf(error.code), error.cause);
    }),
    deps.tourEvents.on('state', (state) => {
      if (state === 'playing' && (tourState === 'ready' || tourState === 'ended')) telemetry.count('tour_start');
      tourState = state;
    }),
  ];

  let previousDrawn: number | null = null;
  let previousTick: number | null = null;
  let roomTime = 0;
  // A hide or a show starts the tick measurement over: a tick that spans a
  // hidden tab, however short, is no engaged time and no time in a room.
  const lifetime = new AbortController();
  deps.container.ownerDocument.addEventListener(
    'visibilitychange',
    () => {
      previousTick = null;
    },
    { signal: lifetime.signal },
  );
  /**
   * Every tick of the frame loop, drawn or not: every mode but `plan2d` draws
   * only on demand (`render/render-demand.ts`), so a visitor standing still makes
   * ticks that draw nothing. Frame intervals are measured between two
   * CONSECUTIVE display draws, and a skipped draw starts the measurement
   * over; room time runs on the ticks, so it grows while the view rests.
   */
  const onFrame: FrameHook = (_delta, now) => {
    const current = stage;
    if (!current) return;
    const tick = previousTick === null ? 0 : now - previousTick;
    previousTick = now;
    const mode = current.mode;
    // A pause (a hidden tab, an off-screen canvas) is no engaged time and no time in a room.
    if (mode !== undefined && tick > 0 && tick <= MAX_FRAME_INTERVAL_MS) {
      telemetry.engage(tick);
      if (ROOM_MODES.has(mode)) dwellFor(current, tick);
    }
    // `ready` follows the first picture (`render/first-draw.ts`), and a resting
    // walk may draw nothing after it: the load is timed by the last draw.
    const drawnAt = current.runtime.lastDrawnAt;
    if (awaitingDraw && drawnAt >= loadOrigin) {
      awaitingDraw = false;
      telemetry.ready((drawnAt - loadOrigin) / 1000);
    }
    if (drawnAt !== now) {
      previousDrawn = null;
      return;
    }
    // The plan view draws the scene only as a heartbeat: neither its frames nor
    // the gap to the first 3D frame after it are frame times.
    if (mode === undefined || mode === 'plan2d') {
      previousDrawn = null;
      return;
    }
    const interval = previousDrawn === null ? 0 : now - previousDrawn;
    previousDrawn = now;
    // A pause (a hidden tab, an off-screen canvas) is not a frame.
    if (interval <= 0 || interval > MAX_FRAME_INTERVAL_MS) return;
    telemetry.frame(interval, deps.fullscreen());
  };

  /** `ms` more in the room the camera stands in, sampled once a second. */
  const dwellFor = (current: ViewerStage, ms: number): void => {
    roomTime += ms;
    if (roomTime < ROOM_SAMPLE_MS) return;
    const plan = deps.plan();
    const position = current.camera.position;
    const room = plan ? roomOf(plan, { x: position.x, z: position.z }) : null;
    if (room !== null) telemetry.dwell(room, roomTime);
    roomTime = 0;
  };

  const deviceFacts = (current: ViewerStage): void => {
    const gl = current.runtime.renderer.getContext();
    const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    telemetry.setDevice({
      gpu: gpuClass(gl, webgl2),
      width: widthBucket(deps.container.clientWidth),
      input: typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer',
    });
  };

  return {
    // Typed by `UsageAction`: a usage action that is not a counter key does not compile.
    usage: (action: UsageAction) => telemetry.count(action),
    attach(next) {
      detach?.();
      stage = next;
      previousDrawn = null;
      previousTick = null;
      deviceFacts(next);
      next.runtime.addPostRenderHook(onFrame);
      detach = () => next.runtime.removePostRenderHook(onFrame);
    },
    loadStarted() {
      nextOrigin = clock();
    },
    documentLoaded(sceneId) {
      documentSettled(sceneId);
    },
    localeChanged(locale) {
      telemetry.setLang(locale);
    },
    beforePresent(sceneId) {
      if (sceneId === shownScene) return;
      // The old scene's view ends here: its data and its engaged time keep its subject.
      telemetry.endView();
      loadOrigin = nextOrigin;
      readyArmed = true;
    },
    modelsSettled(model, result) {
      // The pass can settle before `ready` names the scene: it describes THIS document.
      subjectFromDocument(model.scene.id);
      const assets = deps.project()?.manifest.library.objects.map((object) => object.id) ?? [];
      telemetry.modelsLoaded((clock() - loadOrigin) / 1000, outcomeOf(result), result.failed, assets);
      for (const error of result.failures) telemetry.error(modelCode(error), 'model_load', error);
    },
    dispose() {
      detach?.();
      for (const unsubscribe of subscriptions) unsubscribe();
      lifetime.abort();
      telemetry.dispose();
    },
  };
}
