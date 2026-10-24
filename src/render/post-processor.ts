/**
 * The seam between the render runtime and a post-processing chain, and the
 * rule for when the walk and tour chain is in use.
 *
 * Contract only: no three.js addon is imported here, so the runtime and the
 * application can name a chain without pulling its code into the boot bundle.
 * The chain itself (`walk-post.ts`) is loaded on demand by the application
 * (`app/walk-post-controller.ts`).
 *
 * Invariant: a chain renders the lit scene in linear high dynamic range and
 * applies the lighting standard's display transform (tone mapping, exposure,
 * sRGB encoding) exactly once, in its last pass, both to the screen and into a
 * capture target.
 */

import type * as THREE from 'three';
import type { ViewerMode } from '../scene/types.js';

/** A post-processing chain the runtime renders its frame through. */
export type PostProcessor = {
  /** Draws one frame of `scene` seen by `camera` to the screen; `delta` in seconds. */
  render(scene: THREE.Scene, camera: THREE.Camera, delta: number): void;
  /**
   * Draws one display-referred picture of `scene` into the caller's 8-bit
   * `target` at `width` x `height` device pixels and puts the renderer's
   * bound target back. The chain keeps the capture's size until the next
   * `render`, which takes the live size back, so a clip of many frames
   * resizes once and the next live frame draws as it would have.
   */
  renderTo(target: THREE.WebGLRenderTarget, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): void;
  /**
   * Compiles `scene`'s programs as this chain's scene pass draws them (its
   * colour target bound: three keys a program by the target it is drawn
   * into), asynchronously where the renderer can (`compileAsync`); puts the
   * bound target back before returning.
   */
  compile(scene: THREE.Scene, camera: THREE.Camera): Promise<unknown>;
  /** Follows the renderer: logical size in CSS pixels and the effective pixel ratio. */
  setSize(width: number, height: number, pixelRatio: number): void;
  /** Releases every GPU resource the chain owns. */
  dispose(): void;
  /**
   * The camera white balance the chain applies before its display transform,
   * nine numbers row-major; a panorama's display pass applies the same one.
   */
  readonly whiteBalance?: readonly number[] | undefined;
};

/** The camera modes where nothing is edited and the chain is in use. */
const POST_PROCESSED_MODES: ReadonlySet<ViewerMode> = new Set<ViewerMode>(['walk', 'tour']);

/**
 * Whether a frame in `mode` renders through the walk and tour chain. A
 * function of the camera mode alone: the shell state does not matter, so a
 * tour's dollhouse overview is processed like the rest of the tour.
 */
export function isPostProcessed(mode: ViewerMode | undefined): boolean {
  return mode !== undefined && POST_PROCESSED_MODES.has(mode);
}
