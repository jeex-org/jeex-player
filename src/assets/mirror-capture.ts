/**
 * One reflection capture per rendered frame.
 *
 * A `Reflector` captures its mirror image from `onBeforeRender`, and three
 * calls that hook once per object per PASS - not per frame. This scene always
 * holds transmissive materials (clear glass at 0.92, lampshades at 0.05), so
 * `WebGLRenderer.render` runs `renderTransmissionPass` BEFORE the main pass:
 * it binds its own render target, renders the whole opaque list into it - and
 * calls `onBeforeRender` on every object on the way. A mirror therefore
 * re-rendered the entire scene TWICE per frame, which is what dropped the demo
 * page to a few frames per second with mirrors armed.
 *
 * `mainPassOnly` gates the capture on the frame's BEAUTY PASS, which whoever
 * draws it names for the duration of the draw (`shared/scene-pass.ts`): the
 * runtime around its direct render to the screen, the walk and tour chain
 * around its scene pass into the composer's buffer, a still capture around its
 * render into the capture target. The capture runs only when a scope is set
 * and the bound target, the scene and the camera all match it. Every other
 * pass fails that test: the transmission pass and the walk chain's occlusion
 * input bind targets of their own, a checkpoint inset preview draws to the
 * screen with a camera of its own after the frame's render (no scope at all),
 * a swatch draws its own scene. So the capture happens exactly once per frame,
 * in the frame's own render state, and every other pass reuses the texture
 * the last capture left.
 *
 * Why the gate and not a frame hook: `onBeforeRender` runs INSIDE
 * `renderer.render`, after it has updated the world matrices of the scene and
 * the camera. A hook that fired before `renderer.render` would capture the
 * reflection from a camera whose `matrixWorld` still belongs to the previous
 * frame - a mirror lagging the walk by one frame - unless it re-did the matrix
 * update itself. The layer order forbids the shorter road to one anyway:
 * `assets/` may not import `render/` (`.dependency-cruiser.cjs`).
 *
 * The assumption this rests on, written down because it is invisible at the
 * call site: **every drawer of a frame's picture sets the scope.** A new path
 * that draws the live scene for people to see (another post-processing chain,
 * another capture) sets it too, or its mirrors show the last frame's
 * reflection.
 *
 * The swatch preview, `render/swatch-preview.ts`, sets no scope. It previews one
 * borrowed group into a 112 px target - and a mirror VARIANT preview does carry
 * a reflector. Skipping the capture there is deliberate: the preview scene holds
 * the previewed group and the reference rig on a transparent clear, so the reflection
 * it could capture is black anyway, and capturing it would overwrite the live
 * mirror's texture with an empty room for a frame.
 *
 * No `three` import: the gate reads one renderer method and the scope, so it
 * is testable with a fake and carries no dependency. The gate is a plain decorator - it
 * forwards receiver and arguments untouched - so a caller wrapping a method
 * reference may bind it or not; the mirror binds, because three's
 * `onBeforeRender` is an own method whose receiver is that reflector for good.
 */

import { scenePassOf } from '../shared/scene-pass.js';

/** The only renderer state the gate reads. */
type BoundTarget = { getRenderTarget(): unknown };

/**
 * Wraps a per-object render pass so it runs in the frame's beauty pass only.
 * Arguments and receiver are forwarded untouched - hence the receiver type
 * `T`: `Reflector`'s pass reads `this` for its reflection camera and for the
 * `forceUpdate` flag it clears when the capture is done.
 */
export function mainPassOnly<R extends BoundTarget, S, C, A extends readonly unknown[], T = unknown>(
  pass: (this: T, renderer: R, scene: S, camera: C, ...rest: A) => void,
): (this: T, renderer: R, scene: S, camera: C, ...rest: A) => void {
  return function capture(this: T, renderer: R, scene: S, camera: C, ...rest: A): void {
    const scope = scenePassOf(renderer);
    if (scope === undefined || renderer.getRenderTarget() !== scope.target) return;
    if (scene !== scope.scene || camera !== scope.camera) return;
    pass.call(this, renderer, scene, camera, ...rest);
  };
}
