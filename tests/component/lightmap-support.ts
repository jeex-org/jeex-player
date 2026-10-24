/**
 * Shared scaffolding of the light-bake component tests: a renderer, a linear
 * float read-back of a render, a byte-exact read-back of one texture level,
 * the calibration shell loaded and bound, and orthographic views of its
 * floor and plate.
 *
 * Every measurement renders into a `FloatType` target: linear light, no tone
 * mapping and no output colour space (three applies both only to the canvas).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadLightBake, type LoadedLightBake } from '../../src/lightmap/light-bake-load.js';
import { bindLightBake, type BoundLightBake } from '../../src/lightmap/lightmap-binding.js';
import { CALIBRATION_NODES, CALIBRATION_ROOM } from '../fixtures/lightmap-calibration/calibration-facts.js';

export const FIXTURE = new URL('/tests/fixtures/lightmap-calibration/', location.href);

const opened: THREE.WebGLRenderer[] = [];

/** A renderer on its own canvas; closed by `closeRenderers`. */
export function renderer(): THREE.WebGLRenderer {
  const gl = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  gl.setPixelRatio(1);
  gl.setSize(64, 64, false);
  opened.push(gl);
  return gl;
}

export function closeRenderers(): void {
  for (const gl of opened.splice(0)) {
    gl.dispose();
    gl.forceContextLoss();
  }
}

/** Renders `scene` from `camera` into a `width` × `height` float target; rows bottom-up, RGBA. */
export function renderLinear(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
): Float32Array {
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType });
  gl.setRenderTarget(target);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  gl.render(scene, camera);
  const pixels = new Float32Array(width * height * 4);
  gl.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  gl.setRenderTarget(null);
  target.dispose();
  return pixels;
}

const QUAD = new THREE.PlaneGeometry(2, 2);

/** The bytes of `level` of `texture` as uploaded, read texel by texel (`texelFetch`); rows top-down like the image. */
export function readLevel(
  gl: THREE.WebGLRenderer,
  texture: THREE.Texture,
  level: number,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { map: { value: texture }, level: { value: level } },
    vertexShader: 'void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
    fragmentShader:
      'uniform sampler2D map; uniform int level; out vec4 fetched; void main() { fetched = texelFetch( map, ivec2( gl_FragCoord.xy ), level ); }',
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(QUAD, material));
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType });
  gl.setRenderTarget(target);
  gl.render(scene, new THREE.Camera());
  const bytes = new Uint8Array(width * height * 4);
  // Framebuffer row 0 is gl_FragCoord.y = 0, which fetched texel row 0: the image's first row.
  gl.readRenderTargetPixels(target, 0, 0, width, height, bytes);
  gl.setRenderTarget(null);
  target.dispose();
  material.dispose();
  return bytes;
}

/** SHA-256 hex of `bytes`. */
export async function hexDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The calibration bake loaded from the fixture folder. */
export async function loadCalibration(): Promise<LoadedLightBake> {
  return loadLightBake(new URL('sidecar.json', FIXTURE), new URL('shell.glb', FIXTURE));
}

/** The calibration shell parsed from the loaded bake's verified bytes. */
export async function parseShell(loaded: LoadedLightBake): Promise<THREE.Group> {
  return (await new GLTFLoader().parseAsync(loaded.shell.slice(0), '')).scene;
}

/**
 * Gives every shell mesh a zero-specular physical material of the same
 * colour, so its shading is exactly Lambertian (`albedo / π` times the
 * irradiance) and a reading converts to irradiance without a BRDF model.
 */
export function zeroSpecular(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = new THREE.MeshPhysicalMaterial({ color: source.color, metalness: 0, roughness: 1, specularIntensity: 0 });
  });
}

export type Calibration = {
  gl: THREE.WebGLRenderer;
  loaded: LoadedLightBake;
  scene: THREE.Scene;
  shell: THREE.Group;
  bound: BoundLightBake;
};

/**
 * The calibration shell, optionally with zero-specular materials and with
 * `beforeBind` run on it first (to add lamp placements), bound to its bake,
 * in a scene with no light.
 */
export async function boundCalibration(
  options: { zeroSpecular?: boolean; beforeBind?: (shell: THREE.Group) => void } = {},
): Promise<Calibration> {
  const gl = renderer();
  const loaded = await loadCalibration();
  const shell = await parseShell(loaded);
  if (options.zeroSpecular) zeroSpecular(shell);
  options.beforeBind?.(shell);
  const bound = bindLightBake(
    shell,
    loaded.bake,
    loaded.pages.map((page) => page.texture),
  );
  const scene = new THREE.Scene();
  scene.add(shell);
  return { gl, loaded, scene, shell, bound };
}

/** Pixels per metre of the floor view. */
export const FLOOR_PPM = 40;

/** An orthographic camera just under the ceiling looking down at the whole floor: screen right is +x, screen up is -z. */
export function floorCamera(): THREE.OrthographicCamera {
  const [w, , d] = CALIBRATION_ROOM.size;
  const camera = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0.01, 5);
  camera.up.set(0, 0, -1);
  camera.position.set(w / 2, 2.5, d / 2);
  camera.lookAt(w / 2, 0, d / 2);
  camera.updateMatrixWorld();
  return camera;
}

/** The floor point (x, z) at the centre of floor-view pixel (i, j), j counted from the bottom row. */
export function floorPoint(i: number, j: number): [number, number] {
  const [, , d] = CALIBRATION_ROOM.size;
  return [(i + 0.5) / FLOOR_PPM, d - (j + 0.5) / FLOOR_PPM];
}

/** An orthographic camera above the plate looking down at exactly the plate. */
export function plateCamera(): THREE.OrthographicCamera {
  const { x, z, y } = CALIBRATION_ROOM.plate;
  const camera = new THREE.OrthographicCamera(-(x[1] - x[0]) / 2, (x[1] - x[0]) / 2, (z[1] - z[0]) / 2, -(z[1] - z[0]) / 2, 0.01, 5);
  camera.up.set(0, 0, -1);
  camera.position.set((x[0] + x[1]) / 2, y + 1, (z[0] + z[1]) / 2);
  camera.lookAt((x[0] + x[1]) / 2, y, (z[0] + z[1]) / 2);
  camera.updateMatrixWorld();
  return camera;
}

/** Shows only the named meshes of the shell. */
export function showOnly(shell: THREE.Object3D, ...ids: string[]): void {
  shell.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) object.visible = ids.includes(object.name);
  });
}

export const meshOf = (shell: THREE.Object3D, role: keyof typeof CALIBRATION_NODES): THREE.Mesh =>
  shell.getObjectByName(CALIBRATION_NODES[role]) as THREE.Mesh;
