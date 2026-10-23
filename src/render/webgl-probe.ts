/**
 * The WebGL support probe, apart from the render runtime: it decides, once
 * per page, whether the viewer can have a WebGL 2 context, and it does so on
 * the viewer's own canvas so the renderer takes over the context it made
 * instead of creating a second one.
 *
 * `RENDERER_CONTEXT_ATTRIBUTES` must stay the attributes `defaultRenderer`
 * (`render-runtime.ts`) ends up requesting; `tests/component/webgl-probe.test.ts`
 * compares the two contexts' attributes and fails when they drift.
 */

/**
 * The context attributes `defaultRenderer` ends up asking for: three r186
 * always requests `alpha: true` and fills the rest from its defaults. A canvas
 * ignores the attributes of every `getContext` after the first, so the probe
 * asks with exactly these and the renderer gets the context it would have made.
 */
export const RENDERER_CONTEXT_ATTRIBUTES: Readonly<WebGLContextAttributes> = {
  alpha: true,
  depth: true,
  stencil: false,
  antialias: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false,
};

/**
 * Whether this browser gives the viewer a WebGL 2 context (three r186 has no
 * WebGL 1 path), decided once per process. The probe takes the context on the
 * viewer's OWN canvas and keeps it: the renderer then finds it there instead
 * of making a second one. Later viewers and every Retry skip the probe. The
 * no-`document` case is not memoised: it is about the caller, not the browser.
 */
let webglSupport: boolean | null = null;

export function hasWebGL(canvas: HTMLCanvasElement): boolean {
  if (webglSupport !== null) return webglSupport;
  if (typeof document === 'undefined') return false;
  webglSupport = canvas.getContext('webgl2', RENDERER_CONTEXT_ATTRIBUTES) !== null;
  return webglSupport;
}
