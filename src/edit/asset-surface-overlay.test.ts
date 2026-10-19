import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { AssetSurfaceOverlay, MASK_BAD_COLOR, MASK_OK_COLOR, MASK_OPACITY } from './asset-surface-overlay.js';
import type { LegalityMask } from '../layout/asset-mask.js';

/** Two floor cells side by side, the first legal and the second not. */
function twoCells(): LegalityMask {
  const quad = (x: number) => [x, 0, 0, x + 0.2, 0, 0, x + 0.2, 0, 0.2, x, 0, 0.2];
  return { positions: new Float32Array([...quad(0), ...quad(0.2)]), ok: Uint8Array.from([1, 0]), count: 2, step: 0.2 };
}

describe('the legality field', () => {
  test('green where legal, red where not, one mesh drawn through everything at 35 %', () => {
    const overlay = new AssetSurfaceOverlay();
    overlay.show(twoCells());
    const meshes = overlay.group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    expect(meshes).toHaveLength(1);
    // Every corner of a cell carries its cell's colour: the first cell green, the second red.
    const colours = meshes[0]!.geometry.getAttribute('color');
    const corner = (index: number) => new THREE.Color(colours.getX(index), colours.getY(index), colours.getZ(index)).getHex();
    expect([0, 1, 2, 3].map((index) => corner(index))).toEqual(Array.from({ length: 4 }, () => MASK_OK_COLOR));
    expect([4, 5, 6, 7].map((index) => corner(index))).toEqual(Array.from({ length: 4 }, () => MASK_BAD_COLOR));
    const material = meshes[0]!.material as THREE.MeshBasicMaterial;
    expect({
      opacity: material.opacity,
      depthTest: material.depthTest,
      transparent: material.transparent,
      vertexColors: material.vertexColors,
    }).toEqual({
      opacity: MASK_OPACITY,
      depthTest: false,
      transparent: true,
      vertexColors: true,
    });
    expect(meshes[0]!.geometry.getIndex()!.count).toBe(12);
  });

  test('a new field replaces the old one, and null hides it', () => {
    const overlay = new AssetSurfaceOverlay();
    overlay.show(twoCells());
    overlay.show(twoCells());
    expect(overlay.group.children).toHaveLength(1);
    overlay.show(null);
    expect(overlay.group.children).toHaveLength(0);
  });
});
