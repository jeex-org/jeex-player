import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { applyLibraryTransform, floorEdgeDegrees, libraryAngle, libraryTextureMatrix } from './library-uv.js';
import type { LibraryFacts } from './finish-types.js';

/** Where a metre point lands in texture space under `matrix`. */
function at(matrix: THREE.Matrix3, u: number, v: number): [number, number] {
  const point = new THREE.Vector2(u, v).applyMatrix3(matrix);
  return [Number(point.x.toFixed(6)) + 0, Number(point.y.toFixed(6)) + 0];
}

/** A 6 m by 3 m room outline, long side along x. */
const LONG_X = [
  { x: 0, z: 0 },
  { x: 6, z: 0 },
  { x: 6, z: 3 },
  { x: 0, z: 3 },
];

/** The same room turned a quarter: long side along z. */
const LONG_Z = [
  { x: 0, z: 0 },
  { x: 3, z: 0 },
  { x: 3, z: 6 },
  { x: 0, z: 6 },
];

const facts = (grain: LibraryFacts['grain']): Pick<LibraryFacts, 'grain'> => ({ grain });

describe('libraryTextureMatrix', () => {
  test('metres divide by tileM per axis: two tiles along 4 m of a [2, 1] scan, one per metre of height', () => {
    const matrix = libraryTextureMatrix([2, 1], 0);
    expect(at(matrix, 4, 0)).toEqual([2, 0]);
    expect(at(matrix, 0, 1)).toEqual([0, 1]);
  });

  test('a rotation turns the tiles counter-clockwise and the tile size still holds', () => {
    const matrix = libraryTextureMatrix([2, 1], 90);
    // The texture's u axis now runs along +v of the surface: 2 m of it is one tile.
    expect(at(matrix, 0, 2)).toEqual([1, 0]);
    expect(at(matrix, 1, 0)).toEqual([0, -1]);
  });
});

describe('the grain angle', () => {
  test('the floor edge angle is the direction of the longest outline edge', () => {
    expect(floorEdgeDegrees(LONG_X)).toBe(0);
    expect(floorEdgeDegrees(LONG_Z)).toBe(90);
  });

  test('a tie between edges goes to the lower edge index', () => {
    const square = [
      { x: 0, z: 0 },
      { x: 0, z: 4 },
      { x: 4, z: 4 },
      { x: 4, z: 0 },
    ];
    expect(floorEdgeDegrees(square)).toBe(90);
  });

  test('along_u turns the u axis along the longest edge on a floor, along_v adds 90°, the finish rotation adds on top', () => {
    expect(libraryAngle(facts('along_u'), 'floor', LONG_Z, 0)).toBe(90);
    expect(libraryAngle(facts('along_v'), 'floor', LONG_Z, 0)).toBe(180);
    expect(libraryAngle(facts('along_u'), 'floor', LONG_Z, 15)).toBe(105);
  });

  test('none and unknown are not turned, and no surface but a floor is', () => {
    expect(libraryAngle(facts('none'), 'floor', LONG_Z, 0)).toBe(0);
    expect(libraryAngle(facts('unknown'), 'floor', LONG_Z, 30)).toBe(30);
    for (const surface of ['wall', 'ceiling', 'trim', 'facade'] as const)
      expect(libraryAngle(facts('along_u'), surface, LONG_Z, 0)).toBe(0);
  });

  test('planks of a 6 m by 3 m room run along its 6 m side', () => {
    const matrix = libraryTextureMatrix([1, 1], libraryAngle(facts('along_u'), 'floor', LONG_Z, 0));
    // Walking 6 m along z crosses six tiles of u and no v.
    expect(at(matrix, 0, 6)).toEqual([6, 0]);
  });
});

describe('applyLibraryTransform', () => {
  test('every map of the material gets the same matrix, with automatic update off', () => {
    const material = new THREE.MeshStandardMaterial();
    material.map = new THREE.Texture();
    material.normalMap = new THREE.Texture();
    const arm = new THREE.Texture();
    material.aoMap = arm;
    material.roughnessMap = arm;
    material.metalnessMap = arm;
    const matrix = libraryTextureMatrix([0.5, 0.25], 30);
    applyLibraryTransform(material, matrix);
    for (const texture of [material.map, material.normalMap, arm]) {
      expect(texture.matrixAutoUpdate).toBe(false);
      expect(texture.matrix.equals(matrix)).toBe(true);
    }
  });
});
