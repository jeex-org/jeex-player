/**
 * When the walk and tour room lighting exists, loads, bakes, refreshes and
 * goes away.
 *
 * The lighting's code travels in the walk chain's lazy chunk
 * (`render/walk-post.ts` re-exports it). It is built on the first frame in
 * `walk` or `tour` once the chain is attached, so the bake starts only after
 * the chain is ready; until the lighting is live the view keeps the direct
 * look. Every frame afterwards hands it whether the frame is eligible
 * (`WalkLightingHandle.frame`); outside walk and tour that is the editing
 * look, exactly.
 *
 * Documents: a new or rebuilt document (`documentChanged`) is loaded on the
 * next eligible frame, which starts the bake over. Edits (`edited`) are
 * merged and handed over once, `refreshDebounceMs` after the last one.
 * A document the lighting refuses (more room boxes than it takes) keeps the
 * direct look and reports one error until the next document.
 *
 * Relight: a new colour of the artificial light (`relit`) is handed to the
 * lighting (`relight`), which re-bakes the grids and probes with the tinted
 * lamps when they changed. In walk or tour it waits until the value has
 * rested `relightSettleMs`; a change made outside them waits, doing nothing,
 * and is handed over on the first walk or tour frame at once, before that
 * frame is drawn, so the entry never shows the old tint as live.
 *
 * Lifetime, as the walk chain's (`walk-post-controller.ts`): disposed on
 * context loss and viewer disposal, a build finished for a lost context or a
 * disposed viewer is disposed at once, and the restore builds it again.
 *
 * Host sky (`lighting.hdri`, `hdri-wiring.ts`): its files are fetched on the
 * first eligible frame for the target's entry, both at once (only the sky
 * while a light bake is pending or applied), and installed in the lighting
 * when every file the mode needs is ready; the lighting decides when it
 * shows (`render/walk-lighting/walk-lighting.ts`). A failure warns once
 * (`hdri-unavailable`) and keeps the standard look until the next document;
 * a sky over an applied bake warns once (`hdri-bake-daylight`). A new entry
 * releases the old files (a load still in flight is aborted, and disposed if
 * it lands); the files are released with the lighting on context loss and
 * disposal, and loaded again after a restore. A new rotation turns the
 * installed sky without a reload.
 */

import type * as THREE from 'three';
import { isPostProcessed } from '../render/post-processor.js';
import type { ViewerMode } from '../scene/types.js';
import { mergeScopes, type LightingScope } from './walk-lighting-scope.js';
import type { WalkDocument, WalkLightingStats } from '../render/walk-lighting/walk-lighting.js';
import { WALK_LIGHTING_TUNING } from '../render/walk-lighting/walk-lighting-tuning.js';
import type { HdriContent, HdriSkyState, HdriView } from '../render/hdri/hdri-sky.js';
import type { HdriEntry } from '../lighting/hdri-entry.js';
import type { HdriTarget } from './hdri-wiring.js';
import type { Mat3 } from '../render/white-balance.js';

type Vec3 = { x: number; y: number; z: number };

/** What the controller drives: `render/walk-lighting/walk-lighting.ts`'s `WalkLighting`. */
export type WalkLightingHandle<Doc = WalkDocument> = {
  readonly phase: 'baking' | 'probes' | 'live' | 'empty';
  readonly stats: WalkLightingStats | null;
  load(doc: Doc): void;
  frame(eligible: boolean): void;
  /** Refreshes what `scope` names; `doc` is the document on screen now, whose furniture the probe points follow. */
  refresh(scope: LightingScope, doc: Doc | null): void;
  /** The artificial light changed colour: re-bakes grids and probes when the lamps differ from those baked. */
  relight(): void;
  /** Whether a relight still has probes to write. */
  readonly recapturing: boolean;
  /** The host sky (`render/hdri/hdri-sky.ts`); a handle without it shows none. */
  setHdri?(content: HdriContent | null): void;
  setHdriView?(view: HdriView): void;
  setSun?(sun: () => { override(elevationDeg: number | null): void } | null | undefined): void;
  readonly hdriState?: HdriSkyState;
  /** The camera balance (`render/walk-lighting/room-balance.ts`): eased towards the eye's room, live, and any room's at once. */
  followEye?(eye: Vec3, now: number): boolean;
  readonly balance?: Mat3 | null;
  balanceAt?(position: Vec3): Mat3 | null;
  dispose(): void;
};

/** A loaded environment, as `render/hdri/hdri-assets.ts` makes it. */
export type HdriEnvironmentFile = NonNullable<HdriContent['environment']> & { readonly cubeSize: number; dispose(): void };
/** A loaded sky. */
export type HdriSkyFile = HdriContent['sky'] & { dispose(): void };

/** How the files of an entry are fetched and decoded. */
export type HdriLoads = {
  environment: (entry: HdriEntry, signal: AbortSignal) => Promise<HdriEnvironmentFile>;
  sky: (entry: HdriEntry, signal: AbortSignal) => Promise<HdriSkyFile>;
};

/** The production loads: the walk chunk's decoders on the runtime's renderer. */
export function hdriLoads(renderer: THREE.WebGLRenderer): HdriLoads {
  return {
    environment: async (entry, signal) => (await import('../render/walk-post.js')).loadHdriEnvironment(renderer, entry, signal),
    sky: async (entry, signal) => (await import('../render/walk-post.js')).loadHdriSky(entry, signal),
  };
}

export type HdriDeps = {
  /** What the scene on screen asks for (`hdri-wiring.ts`). */
  target: () => HdriTarget | null;
  loads: HdriLoads;
  warn: (code: 'hdri-unavailable' | 'hdri-bake-daylight', message: string) => void;
  /** The live sun's direction authority (`render/sun-shadow.ts`). */
  sun: () => { override(elevationDeg: number | null): void } | null | undefined;
};

/** What the host sky is doing, for the debug surface. */
export type HdriDebug = {
  readonly state: 'off' | 'loading' | 'ready' | 'live' | 'sky-only' | 'failed';
  readonly preset: string | null;
  readonly cubeSize: number | null;
  readonly sunIntensity: number | null;
};

/** One file of the current entry: in flight, or loaded. */
type HdriFile<T> = { controller: AbortController; value: T | null };

/** The production `build`: imports the walk chunk and builds the lighting on the runtime's renderer and scene. */
export async function loadWalkLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Promise<WalkLightingHandle> {
  const { WalkLighting } = await import('../render/walk-post.js');
  return new WalkLighting(renderer, scene);
}

export type WalkLightingDeps<Doc> = {
  build: () => Promise<WalkLightingHandle<Doc>>;
  report: (error: unknown) => void;
  /** Whether the walk chain is attached: the bake starts after it. */
  chainReady: () => boolean;
  /** The document on screen, `null` before the first. */
  document: () => Doc | null;
  now: () => number;
  /** Where the live camera stands, for the camera balance; absent, the chain keeps its tuned balance. */
  eye?: (() => Vec3) | undefined;
  /** The host sky; absent, none is ever shown. */
  hdri?: HdriDeps | undefined;
};

/** What the lighting is doing, for the debug surface. */
export type WalkLightingState = 'off' | 'loading' | 'baking' | 'probes' | 'live' | 'empty' | 'failed';

export class WalkLightingController<Doc = WalkDocument> {
  private readonly deps: WalkLightingDeps<Doc>;
  private lighting: WalkLightingHandle<Doc> | null = null;
  private pending: Promise<void> | null = null;
  private generation = 0;
  private contextGone = false;
  private disposed = false;
  /** The document changed since the lighting last loaded one. */
  private stale = true;
  private failed = false;
  private scope: LightingScope | null = null;
  private lastEdit = 0;
  /** A relight waits for the value to rest; `null` when none is pending. */
  private relitAt: number | null = null;
  /** Whether the last frame showed the room lighting (rather than the direct look). */
  private shown = false;
  /** Whether the last frame was eligible (walk or tour with the chain ready). */
  private wasEligible = false;
  /** The host sky's current entry, its files and what the lighting holds of them. */
  private hdriEntry: HdriEntry | null = null;
  private hdriTarget: HdriTarget | null = null;
  private hdriEnvironment: HdriFile<HdriEnvironmentFile> | null = null;
  private hdriSky: HdriFile<HdriSkyFile> | null = null;
  private hdriInstalled: 'none' | 'full' | 'sky-only' = 'none';
  private hdriView: HdriView | null = null;
  private readonly hdriFailed = new Set<HdriEntry>();
  private hdriBakeWarned = false;
  private hdriShown: HdriSkyState = 'off';

  constructor(deps: WalkLightingDeps<Doc>) {
    this.deps = deps;
  }

  /**
   * Called once per frame with the mode about to be drawn. Answers whether
   * the look changed this frame: the room lighting shown or taken away (live,
   * a mode switch, a failure, a restarted bake) or refreshed. Walk and tour
   * redraw on it (`render/render-demand.ts`).
   */
  update(mode: ViewerMode | undefined): boolean {
    if (this.disposed || this.contextGone) return false;
    const eligible = isPostProcessed(mode) && this.deps.chainReady();
    const lighting = this.lighting;
    if (!lighting) {
      if (eligible) this.load();
      return false;
    }
    if (this.stale) this.adopt(lighting);
    let refreshed = false;
    try {
      // Only on a frame drawn with the room lighting: an edit made in an editing
      // mode waits, pending, for the next entry into walk or tour.
      if (eligible && this.scope && !this.failed && this.deps.now() - this.lastEdit >= WALK_LIGHTING_TUNING.refreshDebounceMs) {
        const scope = this.scope;
        this.scope = null;
        lighting.refresh(scope, this.deps.document());
        refreshed = true;
      }
      const entering = eligible && !this.wasEligible;
      if (
        eligible &&
        this.relitAt !== null &&
        !this.failed &&
        (entering || this.deps.now() - this.relitAt >= WALK_LIGHTING_TUNING.relightSettleMs)
      ) {
        this.relitAt = null;
        lighting.relight();
        refreshed = true;
      }
      // A probe written this frame changes what the room reflects.
      if (eligible && !this.failed && lighting.recapturing) refreshed = true;
      if (this.updateHdri(lighting, eligible && !this.failed)) refreshed = true;
      lighting.frame(eligible && !this.failed);
      // The camera eases into the room it entered: every frame of it is a new picture.
      const eye = this.deps.eye;
      if (eye && lighting.followEye?.(eye(), this.deps.now()) === true && eligible) refreshed = true;
    } catch (error) {
      // A bake or a capture that throws would throw again on every frame: one report, the direct look.
      this.failed = true;
      this.deps.report(error);
      lighting.frame(false);
    }
    this.wasEligible = eligible;
    const shown = eligible && !this.failed && lighting.phase === 'live';
    const sky = lighting.hdriState ?? 'off';
    const changed = refreshed || shown !== this.shown || sky !== this.hdriShown;
    this.shown = shown;
    this.hdriShown = sky;
    return changed;
  }

  /** The host sky's state for the debug surface. */
  hdri(): HdriDebug {
    const environment = this.hdriEnvironment?.value ?? null;
    const preset = this.hdriTarget?.preset ?? null;
    const base = { preset, cubeSize: environment?.cubeSize ?? null, sunIntensity: environment?.sunIntensity ?? null };
    if (this.hdriEntry === null) return { ...base, state: 'off' };
    if (this.hdriFailed.has(this.hdriEntry)) return { ...base, state: 'failed' };
    const shown = this.lighting?.hdriState ?? 'off';
    if (shown === 'display') return { ...base, state: 'live' };
    if (shown === 'sky-only') return { ...base, state: 'sky-only' };
    if (this.hdriInstalled !== 'none') return { ...base, state: 'ready' };
    return { ...base, state: this.hdriEnvironment !== null || this.hdriSky !== null ? 'loading' : 'off' };
  }

  /** Loads, installs, turns and releases the host sky; answers whether the look may have changed. */
  private updateHdri(lighting: WalkLightingHandle<Doc>, eligible: boolean): boolean {
    const deps = this.deps.hdri;
    if (!deps || !lighting.setHdri) return false;
    const target = deps.target();
    let changed = false;
    if ((target?.entry ?? null) !== this.hdriEntry) {
      changed = this.releaseHdri();
      this.hdriEntry = target?.entry ?? null;
    }
    this.hdriTarget = target;
    if (target === null || this.hdriFailed.has(target.entry)) return changed;
    if (eligible) {
      this.hdriSky ??= this.startHdri(
        target,
        (entry, signal) => deps.loads.sky(entry, signal),
        (file) => (this.hdriSky = file),
      );
      if (target.mode === 'full') {
        this.hdriEnvironment ??= this.startHdri(
          target,
          (entry, signal) => deps.loads.environment(entry, signal),
          (file) => (this.hdriEnvironment = file),
        );
      }
    }
    const sky = this.hdriSky?.value ?? null;
    const environment = this.hdriEnvironment?.value ?? null;
    const wanted = target.mode === 'full' && environment && sky ? 'full' : target.mode === 'sky-only' && sky ? 'sky-only' : 'none';
    if (wanted !== this.hdriInstalled) {
      lighting.setSun?.(deps.sun);
      lighting.setHdri(
        wanted === 'none' ? null : { ...(wanted === 'full' ? { environment: environment! } : {}), sky: sky!, view: target.view },
      );
      this.hdriInstalled = wanted;
      this.hdriView = target.view;
      changed = true;
      if (wanted === 'sky-only' && !this.hdriBakeWarned) {
        this.hdriBakeWarned = true;
        deps.warn(
          'hdri-bake-daylight',
          `walk lighting: the ${target.preset} sky is shown, but its lighting is not applied to the light bake`,
        );
      }
    } else if (wanted !== 'none' && this.hdriView !== target.view && !sameView(this.hdriView, target.view)) {
      lighting.setHdriView?.(target.view);
      this.hdriView = target.view;
      changed = true;
    }
    if (target.mode !== 'sky-only') this.hdriBakeWarned = false;
    return changed;
  }

  /** Starts one file of `target`'s entry; it lands in `put` while the entry is still the current one. */
  private startHdri<T extends { dispose(): void }>(
    target: HdriTarget,
    load: (entry: HdriEntry, signal: AbortSignal) => Promise<T>,
    put: (file: HdriFile<T>) => void,
  ): HdriFile<T> {
    const file: HdriFile<T> = { controller: new AbortController(), value: null };
    const entry = target.entry;
    load(entry, file.controller.signal).then(
      (value) => {
        if (file.controller.signal.aborted || this.hdriEntry !== entry) {
          value.dispose();
          return;
        }
        file.value = value;
        put(file);
      },
      (error: unknown) => {
        if (file.controller.signal.aborted || this.hdriEntry !== entry) return;
        this.hdriFailed.add(entry);
        this.releaseHdri();
        this.deps.hdri?.warn(
          'hdri-unavailable',
          `walk lighting: the ${target.preset} sky could not be loaded (${String(error)}); the standard look stays`,
        );
      },
    );
    return file;
  }

  /** Takes the sky off the lighting and releases its files; answers whether anything was shown. */
  private releaseHdri(): boolean {
    const shown = this.hdriInstalled !== 'none';
    if (shown) this.lighting?.setHdri?.(null);
    for (const file of [this.hdriEnvironment, this.hdriSky]) {
      if (!file) continue;
      file.controller.abort();
      file.value?.dispose();
    }
    this.hdriEnvironment = null;
    this.hdriSky = null;
    this.hdriInstalled = 'none';
    this.hdriView = null;
    return shown;
  }

  /** A new or rebuilt document is on screen. */
  documentChanged(): void {
    this.stale = true;
    this.failed = false;
    this.scope = null;
    this.hdriFailed.clear();
  }

  /** The artificial light changed colour: the lighting is relit once it rests, or on the next entry into walk or tour. */
  relit(): void {
    this.relitAt = this.deps.now();
  }

  /** An edit touched what `scope` names. */
  edited(scope: LightingScope): void {
    this.scope = mergeScopes(this.scope, scope);
    this.lastEdit = this.deps.now();
  }

  state(): WalkLightingState {
    if (this.failed) return 'failed';
    if (this.lighting) return this.lighting.phase;
    return this.pending ? 'loading' : 'off';
  }

  /** The live camera balance while the room lighting is shown; `null` keeps the chain's tuned balance. */
  balance(): Mat3 | null {
    return this.shown ? (this.lighting?.balance ?? null) : null;
  }

  /** The camera balance of the room at `position` while the room lighting is shown, for a capture from that point. */
  balanceAt(position: Vec3): Mat3 | null {
    return this.shown ? (this.lighting?.balanceAt?.(position) ?? null) : null;
  }

  stats(): WalkLightingStats | null {
    return this.lighting?.stats ?? null;
  }

  contextLost(): void {
    this.generation += 1;
    this.contextGone = true;
    this.drop();
  }

  contextRestored(): void {
    this.contextGone = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.drop();
  }

  private load(): void {
    if (this.pending) return;
    const generation = this.generation;
    this.pending = this.deps.build().then(
      (lighting) => {
        this.pending = null;
        if (this.disposed || generation !== this.generation) {
          lighting.dispose();
          return;
        }
        this.lighting = lighting;
        this.stale = true;
      },
      (error: unknown) => {
        this.pending = null;
        if (this.disposed || generation !== this.generation) return;
        this.failed = true;
        this.deps.report(error);
      },
    );
  }

  /** Loads the current document into the lighting; a refusal is reported once and keeps the direct look. */
  private adopt(lighting: WalkLightingHandle<Doc>): void {
    const doc = this.deps.document();
    if (doc === null) return;
    this.stale = false;
    try {
      lighting.load(doc);
    } catch (error) {
      this.failed = true;
      this.deps.report(error);
    }
  }

  private drop(): void {
    this.releaseHdri();
    this.hdriEntry = null;
    this.lighting?.dispose();
    this.lighting = null;
    this.stale = true;
    this.shown = false;
    this.wasEligible = false;
  }
}

function sameView(a: HdriView | null, b: HdriView): boolean {
  return (
    a !== null &&
    a.rotationY === b.rotationY &&
    a.elevationDeg === b.elevationDeg &&
    a.colourLinear.every((value, i) => value === b.colourLinear[i])
  );
}
