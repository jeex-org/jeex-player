/**
 * Constant light-probe grids for the component tests of the walk patch: a
 * packed grid atlas (`render/walk-lighting/room-grid.ts`) built on the CPU,
 * one block of constant spherical harmonics a room box and the exterior
 * block last, with the patch's grid uniforms written and the grids on; and a
 * constant probe array.
 */

import * as THREE from 'three';
import type { WalkUniforms } from '../../src/render/walk-lighting/box-probe-patch.js';
import { packBlock, type Rgb } from '../../src/render/walk-lighting/exterior-sh.js';
import { gridAtlasLayout } from '../../src/render/walk-lighting/probe-layout.js';
import { EXTERIOR_SIZE, writeGridUniforms } from '../../src/render/walk-lighting/room-grid.js';
import type { RoomBox } from '../../src/render/walk-lighting/room-volumes.js';

/** Coefficients whose irradiance is `colour` in every direction. */
export function constantSH(colour: Rgb): Rgb[] {
  const coefficients: Rgb[] = Array.from({ length: 9 }, () => [0, 0, 0] as Rgb);
  coefficients[0] = colour.map((c) => c / 0.886227) as unknown as Rgb;
  return coefficients;
}

/** Every box lit by its own constant colour and the exterior by `exterior`, through the packed atlas; answers the atlas. */
export function constantGrids(
  uniforms: WalkUniforms,
  boxes: ReadonlyArray<{ box: RoomBox; colour: Rgb }>,
  exterior: Rgb = [0, 0, 0],
): THREE.Data3DTexture {
  const size = { x: EXTERIOR_SIZE, y: EXTERIOR_SIZE, z: EXTERIOR_SIZE };
  const layout = gridAtlasLayout([...boxes.map(() => size), size]);
  const data = new Float32Array(layout.width * layout.height * layout.depth * 4);
  [...boxes.map((entry) => entry.colour), exterior].forEach((colour, i) => {
    const block = packBlock(constantSH(colour), EXTERIOR_SIZE);
    const slot = layout.slots[i]!;
    for (let z = 0; z < block.depth; z += 1)
      for (let y = 0; y < block.height; y += 1) {
        const from = (z * block.height + y) * block.width * 4;
        const to = ((z * layout.height + slot.y + y) * layout.width + slot.x) * 4;
        data.set(block.data.subarray(from, from + block.width * 4), to);
      }
  });
  const texture = new THREE.Data3DTexture(data, layout.width, layout.height, layout.depth);
  texture.type = THREE.FloatType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  writeGridUniforms(
    uniforms,
    layout,
    boxes.map(({ box }) => ({ grid: box.grid, resolution: size })),
  );
  uniforms.jeexGrids.value = texture;
  uniforms.jeexGridOn.value = 1;
  return texture;
}

/** A probe array whose every face of every room holds `value`, for `rooms` rooms. */
export function constantProbes(value: number, rooms = 1): THREE.DataArrayTexture {
  const size = 8;
  const texture = new THREE.DataArrayTexture(new Float32Array(size * size * 6 * rooms * 4).fill(value), size, size, 6 * rooms);
  texture.type = THREE.FloatType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
