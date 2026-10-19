/**
 * One frame of a scene as a PNG, rendered beside the live view rather than out
 * of it.
 *
 * The viewer's canvas has no `preserveDrawingBuffer` (`render-runtime.ts`), so
 * there is nothing to read back off it, and resizing it to an export size
 * would be visible to the visitor. A capture therefore renders into a
 * `WebGLRenderTarget` of its own with a camera of its own and reads the pixels
 * back — the `swatch-preview.ts` pattern, at export sizes.
 *
 * Colour invariant, and it is the reason for the second pass: rendering into a
 * plain render target keeps the WORKING colour space and applies NO tone
 * mapping. `WebGLRenderer` picks both from the render target and only an XR
 * one carries the display settings (r185, `WebGLRenderer.js`: `colorSpace =
 * _currentRenderTarget === null ? outputColorSpace : … workingColorSpace`).
 * So the scene goes into a half-float target, and a full-screen quad applies
 * the renderer's own tone mapping and the sRGB transfer — three's own shader
 * chunks, not a second implementation of either — on the way to the 8-bit
 * target the pixels are read from.
 *
 * Borrow invariant: the renderer's render target and clear colour are put back
 * in a `finally`, and a root that had a parent is returned to it, so the very
 * next frame of the live scene draws exactly as it would have.
 */

import * as THREE from 'three';
import { ViewerLibError } from '../shared/errors.js';
import type { CameraPose } from '../scene/types.js';

/** Vertical field of view of a capture that names none, degrees. */
const DEFAULT_FOV_DEG = 55;
/** Camera frustum of a capture, metres; the stage's own numbers (`viewer-stage.ts`). */
const NEAR_PLANE_M = 0.1;
const FAR_PLANE_M = 160;
/** Largest edge a capture may ask for, pixels: four times a 4K side, and a real GPU limit besides. */
const MAX_EDGE_PX = 8192;

export type StillSpec = {
  /** Picture width in CSS pixels; the PNG is `width * pixelRatio` wide. */
  width: number;
  height: number;
  /** Where the capture camera stands and what it looks at. */
  pose: CameraPose;
  /** Vertical field of view in degrees; default `DEFAULT_FOV_DEG`. */
  fov?: number | undefined;
  /** Device pixels per CSS pixel; default 1. */
  pixelRatio?: number | undefined;
};

/** A captured picture and the size it actually came out at, in device pixels. */
export type StillResult = { blob: Blob; width: number; height: number };

/**
 * How the renderer's tone-mapping constant is spelled in three's own shader
 * chunk. A constant this table does not know maps to no tone mapping at all,
 * which is what the renderer does with one too.
 */
const TONE_MAPPING_NAMES = new Map<THREE.ToneMapping, string>([
  [THREE.LinearToneMapping, 'LinearToneMapping'],
  [THREE.ReinhardToneMapping, 'ReinhardToneMapping'],
  [THREE.CineonToneMapping, 'CineonToneMapping'],
  [THREE.ACESFilmicToneMapping, 'ACESFilmicToneMapping'],
  [THREE.AgXToneMapping, 'AgXToneMapping'],
  [THREE.NeutralToneMapping, 'NeutralToneMapping'],
]);

/** The full-screen quad's vertex shader: clip space straight from the plane, UVs untouched. */
const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * The fragment shader of a display pass.
 *
 * `declarations` are the sampler and any helper the caller needs;
 * `sample` is the GLSL expression that reads one LINEAR texel. Everything
 * after it — the renderer's tone mapping and the sRGB transfer — comes from
 * three's own chunks, so a capture and the canvas cannot drift apart.
 *
 * Only the tone-mapping chunk is pasted in. `WebGLProgram` puts three's
 * colour-transfer chunk in EVERY fragment prefix, so `sRGBTransferOETF` is
 * already declared and a second copy fails to compile; the tone-mapping chunk
 * is in the prefix only when tone mapping is on, which — rendering into a
 * render target — it never is.
 */
export function displayFragment(renderer: THREE.WebGLRenderer, declarations: string, sample: string): string {
  const toneMapping = TONE_MAPPING_NAMES.get(renderer.toneMapping);
  return /* glsl */ `
varying vec2 vUv;
${declarations}
${THREE.ShaderChunk.tonemapping_pars_fragment}
void main() {
  vec4 texel = ${sample};
  ${toneMapping === undefined ? '' : `texel = vec4(${toneMapping}(texel.rgb), texel.a);`}
  gl_FragColor = sRGBTransferOETF(texel);
}
`;
}

/** The material of a display pass, carrying the renderer's exposure. */
export function displayMaterial(
  renderer: THREE.WebGLRenderer,
  uniforms: Record<string, THREE.IUniform>,
  declarations: string,
  sample: string,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, toneMappingExposure: { value: renderer.toneMappingExposure } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: displayFragment(renderer, declarations, sample),
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * Draws one full-screen quad with `material` into `target`, then disposes both
 * the quad and the material: a display pass owns nothing past its own call.
 */
export function renderDisplayPass(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  } finally {
    geometry.dispose();
    material.dispose();
  }
}

/** An edge length that a render target can actually be made of, or a coded refusal. */
export function captureEdge(name: string, value: number, ratio: number): number {
  const pixels = Math.round(value * ratio);
  if (!Number.isFinite(pixels) || pixels < 1 || pixels > MAX_EDGE_PX) {
    throw new ViewerLibError('bad-params', `capture ${name} must be between 1 and ${MAX_EDGE_PX} pixels, got ${String(pixels)}`, {
      detail: { name, value, ratio },
    });
  }
  return pixels;
}

/** The pixel ratio a capture is actually taken at; anything unusable is 1. */
export function captureRatio(pixelRatio: number | undefined): number {
  return pixelRatio !== undefined && Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
}

/**
 * The 8-bit target a display pass writes into, and the pixels read back out of
 * it. The target is disposed here, whatever happens: a capture that failed
 * still must not leave a framebuffer on the GPU.
 *
 * SYNCHRONOUS on purpose, and so is every caller's GL work. The frame loop is
 * still running: an `await` between `setRenderTarget(target)` and the restore
 * would let the live frame draw the apartment into the capture's target and
 * leave the canvas blank for a frame. Everything that touches the renderer
 * happens in one task; only the PNG encode is allowed to yield.
 */
export function drawDisplayPass(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, width: number, height: number): Uint8Array {
  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false });
  const previous = renderer.getRenderTarget();
  try {
    renderDisplayPass(renderer, material, target);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    return pixels;
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
  }
}

/**
 * Renders `root` once and answers the picture.
 *
 * A `THREE.Scene` is rendered as it stands — that is how the LIVE document is
 * captured, background, fog, environment and lights included, without moving
 * a single object. Anything else is borrowed into a scene of this call's own,
 * together with `lights`, and put back in the `finally`.
 */
export async function captureStill(
  renderer: THREE.WebGLRenderer,
  root: THREE.Object3D,
  spec: StillSpec,
  lights?: THREE.Object3D,
): Promise<StillResult> {
  const ratio = captureRatio(spec.pixelRatio);
  const width = captureEdge('width', spec.width, ratio);
  const height = captureEdge('height', spec.height, ratio);
  const camera = new THREE.PerspectiveCamera(spec.fov ?? DEFAULT_FOV_DEG, width / height, NEAR_PLANE_M, FAR_PLANE_M);
  camera.position.set(spec.pose.position.x, spec.pose.position.y, spec.pose.position.z);
  camera.lookAt(spec.pose.target.x, spec.pose.target.y, spec.pose.target.z);
  camera.updateProjectionMatrix();

  const pixels = drawStill(renderer, root, camera, width, height, lights);
  return { blob: await encodePng(renderer, pixels, width, height), width, height };
}

/** Everything the still does to the renderer, in one task (see `drawDisplayPass`). */
function drawStill(
  renderer: THREE.WebGLRenderer,
  root: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  lights: THREE.Object3D | undefined,
): Uint8Array {
  const borrowed = root instanceof THREE.Scene ? null : borrow(root, lights);
  const scene = borrowed?.scene ?? (root as THREE.Scene);
  // Half float, because tone mapping happens AFTER this pass: an 8-bit linear
  // target would clip every highlight the operator is there to roll off.
  const hdr = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: true });
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(hdr);
    renderer.render(scene, camera);
    const material = displayMaterial(renderer, { map: { value: hdr.texture } }, 'uniform sampler2D map;', 'texture2D(map, vUv)');
    return drawDisplayPass(renderer, material, width, height);
  } finally {
    renderer.setRenderTarget(previous);
    hdr.dispose();
    borrowed?.restore();
  }
}

/** A scene holding `root` and `lights`, and the undo that puts both back. */
function borrow(root: THREE.Object3D, lights: THREE.Object3D | undefined): { scene: THREE.Scene; restore: () => void } {
  const parent = root.parent;
  const lightParent = lights?.parent ?? null;
  const scene = new THREE.Scene();
  scene.add(root);
  if (lights) scene.add(lights);
  return {
    scene,
    restore: () => {
      scene.remove(root);
      parent?.add(root);
      if (lights) {
        scene.remove(lights);
        lightParent?.add(lights);
      }
      scene.clear();
    },
  };
}

/**
 * Read-back pixels as a PNG blob.
 *
 * WebGL reads bottom-up and `ImageData` is top-down, so the rows are copied in
 * reverse — the same flip `swatch-preview.ts` does. The canvas comes from the
 * RENDERER's own document, never the global one: a viewer mounted in an iframe
 * must not reach for the host page's.
 */
export function encodePng(renderer: THREE.WebGLRenderer, pixels: Uint8Array, width: number, height: number): Promise<Blob> {
  const ownerDocument = renderer.domElement?.ownerDocument;
  const context = ownerDocument?.createElement('canvas').getContext('2d');
  if (!context) throw new ViewerLibError('internal', 'capture: no 2D context to encode the PNG with');
  context.canvas.width = width;
  context.canvas.height = height;
  const image = context.createImageData(width, height);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row += 1) {
    const from = (height - 1 - row) * rowBytes;
    image.data.set(pixels.subarray(from, from + rowBytes), row * rowBytes);
  }
  context.putImageData(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    context.canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new ViewerLibError('internal', 'capture: the canvas produced no PNG'));
    }, 'image/png');
  });
}
