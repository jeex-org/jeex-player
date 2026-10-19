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
 * `mainPassOnly` gates the capture on the one piece of state that tells the
 * passes apart: **the main pass is the pass with no render target bound.** The
 * transmission pass, and any other off-screen pass, has one. The gate lets the
 * capture run in the main pass only, so it happens exactly once per frame, in
 * the runtime's own render state - the default framebuffer, ACES tone mapping -
 * and the transmission pass reuses the texture the last frame captured.
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
 * call site: **the viewer renders its main view to the default framebuffer.**
 * There is no post-processing composer in `render/render-runtime.ts`.
 * Introducing one means the main pass gains a target, and this gate moves with
 * it.
 *
 * The other pass that binds a target, `render/swatch-preview.ts`, previews one
 * borrowed group into a 112 px target - and a mirror VARIANT preview does carry
 * a reflector. Skipping the capture there is deliberate: the preview scene holds
 * the previewed group and two lights on a transparent clear, so the reflection
 * it could capture is black anyway, and capturing it would overwrite the live
 * mirror's texture with an empty room for a frame.
 *
 * No `three` import: the gate reads one renderer method, so it is testable
 * with a fake and carries no dependency. The gate is a plain decorator - it
 * forwards receiver and arguments untouched - so a caller wrapping a method
 * reference may bind it or not; the mirror binds, because three's
 * `onBeforeRender` is an own method whose receiver is that reflector for good.
 */

/** The only renderer state the gate reads. */
type BoundTarget = { getRenderTarget(): unknown };

/**
 * Wraps a per-object render pass so it runs in the main pass only. Arguments
 * and receiver are forwarded untouched - hence the receiver type `T`:
 * `Reflector`'s pass reads `this` for its reflection camera and for the
 * `forceUpdate` flag it clears when the capture is done.
 */
export function mainPassOnly<R extends BoundTarget, A extends readonly unknown[], T = unknown>(
  pass: (this: T, renderer: R, ...rest: A) => void,
): (this: T, renderer: R, ...rest: A) => void {
  return function capture(this: T, renderer: R, ...rest: A): void {
    if (renderer.getRenderTarget() !== null) return;
    pass.call(this, renderer, ...rest);
  };
}
