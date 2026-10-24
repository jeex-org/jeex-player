/**
 * One room as an equirectangular 360 image: what a portal, a social post or a
 * WebXR viewer takes when it cannot take the whole tour.
 *
 * There is no cube-to-equirectangular helper in three's addons (r186), so the
 * projection is written here: a `CubeCamera` renders the six faces into a
 * `WebGLCubeRenderTarget`, and one full-screen quad turns each output pixel's
 * (longitude, latitude) into a direction and samples the cube along it. The
 * same display pass as a still applies the renderer's tone mapping and the
 * sRGB transfer (`still-capture.ts`), and in walk and tour the walk chain's
 * white balance before them, so a panorama and a still of one room are the
 * same picture in two projections.
 *
 * Seam invariant: the left and right edges of the image are the SAME
 * direction (longitude −π and +π), so nothing may make them disagree — the
 * cube target is sampled with linear filtering and no mip bias, and the
 * projection is computed per pixel rather than interpolated across the quad.
 */

import * as THREE from 'three';
import { captureEdge, displayMaterial, drawDisplayPass, encodePng, type StillResult } from './still-capture.js';
import type { Vec3 } from '../scene/types.js';

/** Edge of one cube face when the caller names none, pixels. */
const DEFAULT_FACE_PX = 1024;
/** Cube-camera frustum, metres: inside a room, out to the far side of the site. */
const NEAR_PLANE_M = 0.05;
const FAR_PLANE_M = 100;

export type PanoramaSpec = {
  /** Width of the equirectangular image; the height is always half of it. */
  width: number;
  /** Where the panorama is taken from, in world metres. */
  position: Vec3;
  /** Edge of one cube face; default `DEFAULT_FACE_PX`. */
  faceSize?: number | undefined;
  /**
   * The walk chain's camera white balance (nine numbers, row-major), applied
   * in the display pass only: the cube faces are rendered unbalanced.
   */
  whiteBalance?: readonly number[] | null | undefined;
};

/**
 * The GLSL that turns the quad's UV into a direction on the unit sphere.
 *
 * `vUv.x` runs west to east over a full turn and `vUv.y` runs from straight
 * down to straight up, and the centre of the image looks along −Z — three's
 * own camera-forward, so a panorama and a still framed at yaw 0 agree.
 */
const DIRECTION_GLSL = /* glsl */ `
uniform samplerCube map;
const float PANORAMA_PI = 3.141592653589793;
vec3 panoramaDirection(vec2 uv) {
  float longitude = (uv.x - 0.5) * 2.0 * PANORAMA_PI;
  float latitude = (uv.y - 0.5) * PANORAMA_PI;
  float ring = cos(latitude);
  return vec3(sin(longitude) * ring, sin(latitude), -cos(longitude) * ring);
}
`;

/**
 * Renders the six faces around `spec.position` and answers the 2:1 PNG.
 *
 * A `THREE.Scene` is rendered as it stands — background, fog, environment and
 * lights included — and anything else is put into a scene of this call's own
 * for the duration. Every target this allocates is disposed before it
 * returns, whatever happened.
 */
export async function capturePanorama(renderer: THREE.WebGLRenderer, root: THREE.Object3D, spec: PanoramaSpec): Promise<StillResult> {
  const width = captureEdge('width', spec.width, 1);
  const height = captureEdge('height', spec.width / 2, 1);
  const faceSize = captureEdge('faceSize', spec.faceSize ?? DEFAULT_FACE_PX, 1);

  const borrowedScene = root instanceof THREE.Scene ? null : new THREE.Scene();
  const parent = borrowedScene ? root.parent : null;
  if (borrowedScene) borrowedScene.add(root);
  const scene = borrowedScene ?? (root as THREE.Scene);

  // Half float, because the display pass below tone-maps: an 8-bit linear cube
  // would clip every window before the operator ever saw it.
  const cube = new THREE.WebGLCubeRenderTarget(faceSize, { type: THREE.HalfFloatType });
  cube.texture.minFilter = THREE.LinearFilter;
  cube.texture.magFilter = THREE.LinearFilter;
  cube.texture.generateMipmaps = false;
  const camera = new THREE.CubeCamera(NEAR_PLANE_M, FAR_PLANE_M, cube);
  camera.position.set(spec.position.x, spec.position.y, spec.position.z);
  const previous = renderer.getRenderTarget();
  let pixels: Uint8Array;
  try {
    camera.update(renderer, scene);
    const material = displayMaterial(
      renderer,
      { map: { value: cube.texture } },
      DIRECTION_GLSL,
      'textureCube(map, panoramaDirection(vUv))',
      spec.whiteBalance ?? null,
    );
    // Synchronous to here: the live frame loop must not draw into a target of
    // this call's between the six faces and the read-back (`still-capture.ts`).
    pixels = drawDisplayPass(renderer, material, width, height);
  } finally {
    renderer.setRenderTarget(previous);
    cube.dispose();
    if (borrowedScene) {
      borrowedScene.remove(root);
      parent?.add(root);
      borrowedScene.clear();
    }
  }
  return { blob: await encodePng(renderer, pixels, width, height), width, height };
}
