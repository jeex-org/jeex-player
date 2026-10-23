/**
 * The scene's programs, compiled asynchronously before its first picture
 * (`first-draw.ts`).
 *
 * three keys a program by the target it is drawn into: straight to the
 * screen it carries the display transform (tone mapping, sRGB), into any
 * render target it is linear. A direct frame draws both kinds: the screen's,
 * and the linear ones a mirror's reflection and the transmission pass render
 * the scene with (measured on the demo apartment: half the programs linked at
 * the first draw were the linear set). So the scene is compiled twice, once
 * with no target bound and once with a throwaway linear target bound. The
 * shadow pass's own depth programs are not reached by `compileAsync` and still
 * link at the first draw.
 */

import * as THREE from 'three';

/** Starts both compilations; `null` for a renderer without `compileAsync`. */
export function compileScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<unknown> | null {
  const compile = (renderer as Partial<THREE.WebGLRenderer>).compileAsync?.bind(renderer);
  if (!compile) return null;
  const previous = renderer.getRenderTarget();
  const linear = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  try {
    renderer.setRenderTarget(null);
    const screen = compile(scene, camera);
    // `compileAsync` creates every program before its first await: the bound target is read here.
    renderer.setRenderTarget(linear);
    const offscreen = compile(scene, camera);
    return Promise.all([screen, offscreen]);
  } finally {
    renderer.setRenderTarget(previous);
    linear.dispose();
  }
}
