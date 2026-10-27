/**
 * When the walk and tour post-processing chain exists, loads, is attached to
 * the runtime and goes away.
 *
 * The chain's code is not part of the boot bundle: the first frame in `walk`
 * or `tour` asks the injected `build` for it (an `import()` of
 * `render/walk-post.ts` in production, a separate chunk in the ES and demo
 * builds) and the view renders directly until it is ready. A finished build
 * is attached only if the viewer is still in `walk` or `tour`, not disposed
 * and on the same GPU context it was started on; a build that finished for a
 * lost context or a disposed viewer is disposed at once. A failed build
 * reports one error and is not retried until the next entry into `walk` or
 * `tour`.
 *
 * Lifetime: the chain is kept between visits (detached, not disposed, in the
 * editing modes), disposed on viewer disposal and on context loss, and built
 * again on the first eligible frame after a restore. One chain serves the
 * live view and the captures taken in `walk` and `tour` (`forCapture`), so a
 * captured frame has the same occlusion noise as the screen.
 *
 * Shaders: a finished chain is attached only once the scene's programs were
 * compiled for its scene pass (`prepare`, asynchronously; three keys a program
 * by the target it draws into, so the direct frames' programs do not serve
 * the chain), or the first-draw bound passed (`render/first-draw.ts`); the
 * view renders directly meanwhile, so the first frame through the chain does
 * not wait for links. A `prepare` that throws or rejects attaches at once.
 */

import type * as THREE from 'three';
import { isPostProcessed, type PostProcessor } from '../render/post-processor.js';
import { FirstDrawGate } from '../render/first-draw.js';
import type { ViewerMode } from '../scene/types.js';
import type { BalanceSource } from '../render/walk-post.js';

/**
 * The production `build`: imports the chain's module on demand and builds it
 * on the runtime's renderer. The dynamic import is what keeps the chain out of
 * the boot bundle of the ES and demo builds (a `lazy-` chunk of its own).
 */
export async function loadWalkPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  balance?: BalanceSource,
): Promise<PostProcessor> {
  const { createWalkPost } = await import('../render/walk-post.js');
  return createWalkPost(renderer, scene, camera, { balance });
}

export type WalkPostDeps = {
  /** Loads the chain's module and builds a chain on the runtime's renderer; resolves once it can draw. */
  build: () => Promise<PostProcessor>;
  /** Hands the chain to the runtime, or takes it away (`RenderRuntime.setPostProcessor`). */
  attach: (chain: PostProcessor | null) => void;
  /** A build failed; reported once per entry through the viewer's error channel. */
  report: (error: unknown) => void;
  /** Compiles the scene for a finished chain before it attaches (`PostProcessor.compile`); absent: attach at once. */
  prepare?: ((chain: PostProcessor) => Promise<unknown>) | undefined;
};

/** What the chain is doing, for the debug surface. */
export type WalkPostState = 'off' | 'loading' | 'on' | 'failed';

export class WalkPostController {
  private readonly deps: WalkPostDeps;
  private chain: PostProcessor | null = null;
  private attached: PostProcessor | null = null;
  private pending: Promise<PostProcessor | null> | null = null;
  /** Bumped on every context loss; a build started under an older value is stale. */
  private generation = 0;
  private contextGone = false;
  private failed = false;
  private eligible = false;
  private disposed = false;
  /** Closed while the current chain's scene programs compile. */
  private readonly compiled = new FirstDrawGate({
    setTimeout: (run, ms) => setTimeout(run, ms) as unknown as number,
    clearTimeout: (handle) => clearTimeout(handle),
  });

  constructor(deps: WalkPostDeps) {
    this.deps = deps;
  }

  /** Called once per frame, after the camera and the tour moved, with the mode about to be drawn. */
  update(mode: ViewerMode | undefined): void {
    const eligible = isPostProcessed(mode);
    // A new entry into walk or tour forgets a failure of the previous one.
    if (eligible && !this.eligible) this.failed = false;
    this.eligible = eligible;
    if (!eligible || this.disposed) {
      this.setAttached(null);
      return;
    }
    if (!this.chain) void this.load();
    else if (this.compiled.open) this.setAttached(this.chain);
  }

  /**
   * The chain a capture in `mode` renders through: the live one, waiting for
   * its load (started here if need be); `null` outside walk and tour, or when
   * the chain cannot be had, and the capture then takes the direct path.
   */
  forCapture(mode: ViewerMode | undefined): Promise<PostProcessor | null> {
    if (!isPostProcessed(mode) || this.disposed) return Promise.resolve(null);
    if (this.chain) return Promise.resolve(this.chain);
    return this.load();
  }

  state(): WalkPostState {
    if (this.attached) return 'on';
    if (this.pending || (this.chain && !this.compiled.open)) return 'loading';
    return this.failed ? 'failed' : 'off';
  }

  /** The GPU context is gone: every resource of the chain went with it. */
  contextLost(): void {
    this.generation += 1;
    this.contextGone = true;
    this.drop();
  }

  /** The context is back; the next eligible frame builds a new chain. */
  contextRestored(): void {
    this.contextGone = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.drop();
  }

  /** Starts a build unless one is pending, the last one failed or there is no context; answers its chain. */
  private load(): Promise<PostProcessor | null> {
    if (this.pending) return this.pending;
    if (this.failed || this.contextGone) return Promise.resolve(null);
    const generation = this.generation;
    const pending = this.deps.build().then(
      (chain) => this.adopt(chain, generation),
      (error: unknown) => {
        this.pending = null;
        if (this.disposed || generation !== this.generation) return null;
        this.failed = true;
        this.deps.report(error);
        return null;
      },
    );
    this.pending = pending;
    return pending;
  }

  /** A finished build: kept and attached when still wanted, disposed when stale. */
  private adopt(chain: PostProcessor, generation: number): PostProcessor | null {
    this.pending = null;
    if (this.disposed || generation !== this.generation) {
      chain.dispose();
      return null;
    }
    this.chain = chain;
    const prepare = this.deps.prepare;
    this.compiled.arm(prepare ? () => prepare(chain) : null);
    if (this.eligible && this.compiled.open) this.setAttached(chain);
    return chain;
  }

  private setAttached(chain: PostProcessor | null): void {
    if (this.attached === chain) return;
    this.attached = chain;
    this.deps.attach(chain);
  }

  /** Detaches and disposes the chain (context loss, viewer disposal). */
  private drop(): void {
    this.setAttached(null);
    this.chain?.dispose();
    this.chain = null;
  }
}
