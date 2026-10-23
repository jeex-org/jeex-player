/**
 * The texture transform of a library material on a room surface.
 *
 * The geometry carries texture coordinates in METRES on every room surface;
 * the material carries everything else as ONE matrix per texture view: the
 * metre coordinates are turned by the grain angle plus the finish value's
 * rotation (degrees, counter-clockwise), then divided by `tileM` per axis.
 * Every map of one material gets the same matrix, so its colour, normal and
 * ARM stay registered, and two surfaces with different rotations still share
 * one image.
 */

import * as THREE from 'three';
import type { FinishSurface, Vec2 } from '../scene/types.js';
import type { LibraryFacts } from './finish-types.js';
import type { LibraryThreeMaterial } from './library-material.js';

/** Metres → texture space: turn by `degrees` counter-clockwise, then `1 / tileM` per axis. */
export function libraryTextureMatrix(tileM: readonly [number, number], degrees: number): THREE.Matrix3 {
  const turn = (degrees * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const [u, v] = tileM;
  // A point at angle `turn` in metres lands on the texture's u axis: rotate by -turn.
  return new THREE.Matrix3().set(cos / u, sin / u, 0, -sin / v, cos / v, 0, 0, 0, 1);
}

/** The direction of the longest outline edge, degrees counter-clockwise from +u; a tie goes to the lower edge index. */
export function floorEdgeDegrees(outline: readonly Vec2[]): number {
  let best = -1;
  let degrees = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index]!;
    const b = outline[(index + 1) % outline.length]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length > best) {
      best = length;
      degrees = (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI;
    }
  }
  return degrees;
}

/**
 * The angle a material is drawn at on `surface`: on a floor, a grain along u
 * or v follows the room's longest edge (`along_v` adding 90°); `none`,
 * `unknown` and every other surface are not turned. The finish value's own
 * `rotation` is added on top.
 */
export function libraryAngle(
  facts: Pick<LibraryFacts, 'grain'>,
  surface: FinishSurface,
  outline: readonly Vec2[],
  rotation: number,
): number {
  if (surface !== 'floor' || (facts.grain !== 'along_u' && facts.grain !== 'along_v')) return rotation;
  return floorEdgeDegrees(outline) + (facts.grain === 'along_v' ? 90 : 0) + rotation;
}

/** Sets `matrix` on every map of `material`, with the automatic UV transform off. */
export function applyLibraryTransform(material: LibraryThreeMaterial, matrix: THREE.Matrix3): void {
  for (const texture of [material.map, material.normalMap, material.aoMap, material.roughnessMap, material.metalnessMap]) {
    if (texture === null) continue;
    texture.matrixAutoUpdate = false;
    texture.matrix.copy(matrix);
  }
}
