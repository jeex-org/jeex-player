/**
 * The material a window or door part is drawn in, from the finish id its
 * opening variant names: a frame finish (`frame-finishes.ts`) draws its
 * library material flat, since frame parts have per-face UVs and no maps fit
 * them; any other id draws the room finish of that id, else the white wall
 * paint. Answers the finish id the light bake records for the part.
 */

import type * as THREE from 'three';
import { finishMaterial, findFinish } from './finishes.js';
import { frameFinish } from './frame-finishes.js';
import { createLibraryMaterial } from './library-material.js';
import { FINISH } from './finish-ids.js';

/** The part's material and the finish id it is drawn in. */
export function openingFinishMaterial(finishId: string): { readonly material: THREE.MeshStandardMaterial; readonly finish: string } {
  const frame = frameFinish(finishId);
  if (frame !== undefined) {
    const material = createLibraryMaterial({ id: frame.id, material: frame.material, colour: frame.colour, rotation: 0 });
    return { material, finish: frame.id };
  }
  const finish = findFinish(finishId) ?? findFinish(FINISH.white)!;
  return { material: finishMaterial(finish, 1, 1), finish: finish.id };
}
