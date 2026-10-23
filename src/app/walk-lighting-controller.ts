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
 * Lifetime, as the walk chain's (`walk-post-controller.ts`): disposed on
 * context loss and viewer disposal, a build finished for a lost context or a
 * disposed viewer is disposed at once, and the restore builds it again.
 */

import type * as THREE from 'three';
import { isPostProcessed } from '../render/post-processor.js';
import type { ViewerMode } from '../scene/types.js';
import { mergeScopes, type LightingScope } from './walk-lighting-scope.js';
import type { WalkDocument, WalkLightingStats } from '../render/walk-lighting/walk-lighting.js';
import { WALK_LIGHTING_TUNING } from '../render/walk-lighting/walk-lighting-tuning.js';

/** What the controller drives: `render/walk-lighting/walk-lighting.ts`'s `WalkLighting`. */
export type WalkLightingHandle<Doc = WalkDocument> = {
  readonly phase: 'baking' | 'probes' | 'live';
  readonly stats: WalkLightingStats | null;
  load(doc: Doc): void;
  frame(eligible: boolean): void;
  refresh(scope: LightingScope): void;
  dispose(): void;
};

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
};

/** What the lighting is doing, for the debug surface. */
export type WalkLightingState = 'off' | 'loading' | 'baking' | 'probes' | 'live' | 'failed';

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

  constructor(deps: WalkLightingDeps<Doc>) {
    this.deps = deps;
  }

  /** Called once per frame with the mode about to be drawn. */
  update(mode: ViewerMode | undefined): void {
    if (this.disposed || this.contextGone) return;
    const eligible = isPostProcessed(mode) && this.deps.chainReady();
    const lighting = this.lighting;
    if (!lighting) {
      if (eligible) this.load();
      return;
    }
    if (this.stale) this.adopt(lighting);
    if (this.scope && !this.failed && this.deps.now() - this.lastEdit >= WALK_LIGHTING_TUNING.refreshDebounceMs) {
      const scope = this.scope;
      this.scope = null;
      lighting.refresh(scope);
    }
    lighting.frame(eligible && !this.failed);
  }

  /** A new or rebuilt document is on screen. */
  documentChanged(): void {
    this.stale = true;
    this.failed = false;
    this.scope = null;
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
    this.lighting?.dispose();
    this.lighting = null;
    this.stale = true;
  }
}
