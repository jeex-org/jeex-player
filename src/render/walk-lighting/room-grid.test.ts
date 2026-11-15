import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { exteriorBlock, RoomGrid } from './room-grid.js';
import type { RoomBox } from './room-volumes.js';
import { LIGHTING_STANDARD } from '../../lighting/lighting-standard.js';

// A 3 x 2.6 x 3 room box: sampling inset 0.12, 4 x 2 x 4 probes, so cells of 0.92 x 2.36 x 0.92.
const ROOM: RoomBox = {
  roomId: 'bath',
  projection: { min: { x: 0, y: 0, z: 0 }, max: { x: 3, y: 2.6, z: 3 } },
  sampling: { min: { x: 0.12, y: 0.12, z: 0.12 }, max: { x: 2.88, y: 2.48, z: 2.88 } },
  grid: { min: { x: -0.34, y: -1.06, z: -0.34 }, max: { x: 3.34, y: 3.66, z: 3.34 } },
  selection: { min: { x: -0.05, y: -0.2, z: -0.05 }, max: { x: 3.05, y: 2.8, z: 3.05 } },
  resolution: { x: 4, y: 2, z: 4 },
};

describe('RoomGrid', () => {
  test('puts its cell-centre probes on the sampling box’s lattice, at the room resolution', () => {
    const grid = new RoomGrid(ROOM);
    expect(grid.resolution.toArray()).toEqual([4, 2, 4]);
    const round = (v: THREE.Vector3): number[] => v.toArray().map((c) => Number(c.toFixed(9)));
    expect(round(grid.getProbePosition(0, 0, 0, new THREE.Vector3()))).toEqual([0.12, 0.12, 0.12]);
    expect(round(grid.getProbePosition(3, 1, 3, new THREE.Vector3()))).toEqual([2.88, 2.48, 2.88]);
    expect(round(grid.getProbePosition(1, 0, 2, new THREE.Vector3()))).toEqual([1.04, 0.12, 1.96]);
    expect(grid.roomId).toBe('bath');
  });
});

describe('exteriorBlock', () => {
  test('is the hemisphere and fill as one float block of the packed atlas, borders included', () => {
    const texture = exteriorBlock(LIGHTING_STANDARD.apartment);
    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.type).toBe(THREE.FloatType);
    expect([texture.image.width, texture.image.height, texture.image.depth]).toEqual([4, 28, 4]);
    texture.dispose();
  });
});
