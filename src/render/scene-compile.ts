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
 * with no target bound and once with a throwaway linear target bound.
 *
 * A texture background is drawn by three's own background plane, which
 * `compileAsync` never sees; a stand-in plane built the way three builds it
 * (`WebGLBackground`, three r186) is compiled inside the scene, so its
 * program is linked when the first picture draws the sky. The shadow pass's
 * own depth programs are not reached and still link at the first draw.
 *
 * Linked is not yet usable: three reads a program's link status, its logs
 * and its active uniforms and attributes on its first use, each a
 * synchronous round trip to the GPU (measured on the demo apartment: about
 * 110 ms in the first frame's task with every program already linked). Once
 * compiled, the programs are put to that first use a few per task
 * (`warmPrograms`), before the first picture, so no single task pays for all.
 */

import * as THREE from 'three';

/** Starts both compilations; `null` for a renderer without `compileAsync`. */
export function compileScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<unknown> | null {
  const compile = (renderer as Partial<THREE.WebGLRenderer>).compileAsync?.bind(renderer);
  if (!compile) return null;
  const previous = renderer.getRenderTarget();
  const linear = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  try {
    const sky = backgroundStandIn(scene);
    const pending: Promise<unknown>[] = [];
    // `compileAsync` creates every program before its first await: the bound
    // target and the stand-in (lit and shadowed like the scene it is in) are
    // read there, so both are taken away again right after.
    for (const target of [null, linear]) {
      renderer.setRenderTarget(target);
      if (sky) scene.add(sky);
      pending.push(compile(scene, camera));
      sky?.removeFromParent();
    }
    return Promise.all(pending).then(() => warmPrograms(renderer));
  } finally {
    renderer.setRenderTarget(previous);
    linear.dispose();
  }
}

/**
 * A plane drawn like three's background plane for `scene`'s texture
 * background; `null` otherwise. Its material is never disposed: that would
 * release the program it exists to link.
 */
function backgroundStandIn(scene: THREE.Scene): THREE.Mesh | null {
  const background = scene.background;
  if (!(background instanceof THREE.Texture) || background instanceof THREE.CubeTexture || scene.backgroundBlurriness > 0) return null;
  const material = new THREE.ShaderMaterial({
    name: 'BackgroundMaterial',
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.background.uniforms),
    vertexShader: THREE.ShaderLib.background.vertexShader,
    fragmentShader: THREE.ShaderLib.background.fragmentShader,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  // As three does: a `map` the renderer evaluates like a built-in material's.
  Object.defineProperty(material, 'map', { get: () => material.uniforms['t2D']!.value as THREE.Texture });
  material.uniforms['t2D']!.value = background;
  material.toneMapped = THREE.ColorManagement.getTransfer(background.colorSpace) !== THREE.SRGBTransfer;
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.deleteAttribute('normal');
  const plane = new THREE.Mesh(geometry, material);
  plane.layers.enableAll();
  plane.frustumCulled = false;
  return plane;
}

/** Programs put to their first use per task by `warmPrograms`. */
export const PROGRAMS_PER_TASK = 4;

/** What `warmPrograms` reads of three's program objects (`renderer.info.programs`). */
type WarmableProgram = { getUniforms(): unknown };

/**
 * Puts every program `renderer` holds to its first use (link status, logs,
 * active uniforms and attributes), `PROGRAMS_PER_TASK` per task; resolves
 * when all are done. A program already used costs nothing.
 */
export async function warmPrograms(renderer: THREE.WebGLRenderer): Promise<void> {
  const programs = (renderer.info.programs ?? []) as unknown as readonly WarmableProgram[];
  for (let index = 0; index < programs.length; index += PROGRAMS_PER_TASK) {
    if (index > 0) await nextTask();
    for (const program of programs.slice(index, index + PROGRAMS_PER_TASK)) program.getUniforms();
  }
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
