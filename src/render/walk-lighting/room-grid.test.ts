import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { createExteriorGrid, RoomGrid, SelectionBox } from './room-grid.js';
import type { RoomBox } from './room-volumes.js';
import { LIGHTING_STANDARD } from '../../lighting/lighting-standard.js';

const ROOM: RoomBox = {
  roomId: 'bath',
  projection: { min: { x: 0, y: 0, z: 0 }, max: { x: 3, y: 2.6, z: 3 } },
  sampling: { min: { x: 0.12, y: 0.12, z: 0.12 }, max: { x: 2.88, y: 2.48, z: 2.88 } },
  selection: { min: { x: -0.05, y: -0.2, z: -0.05 }, max: { x: 3.05, y: 2.8, z: 3.05 } },
  resolution: { x: 4, y: 2, z: 4 },
};

describe('SelectionBox', () => {
  test('answers containsPoint from the selection box while min and max stay the sampling box', () => {
    const box = new SelectionBox(new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)));
    box.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.5, 0.5, 0.5));
    expect(box.containsPoint(new THREE.Vector3(0.9, 0.9, 0.9))).toBe(true);
    expect(box.containsPoint(new THREE.Vector3(1.1, 0, 0))).toBe(false);
    expect(box.max.x).toBe(0.5);
  });

  test('without a selection box it contains every point', () => {
    expect(new SelectionBox(null).containsPoint(new THREE.Vector3(1e6, -1e6, 3))).toBe(true);
  });
});

describe('RoomGrid', () => {
  test('samples the inset box with the room resolution and selects by the grown box', () => {
    const grid = new RoomGrid(ROOM);
    expect(grid.boundingBox.min.toArray().map((v) => Number(v.toFixed(9)))).toEqual([0.12, 0.12, 0.12]);
    expect(grid.boundingBox.max.toArray().map((v) => Number(v.toFixed(9)))).toEqual([2.88, 2.48, 2.88]);
    expect(grid.resolution.toArray()).toEqual([4, 2, 4]);
    // A cabinet against the wall: its origin on the floor, outside the sampling box.
    expect(grid.boundingBox.containsPoint(new THREE.Vector3(2.95, 0, 1.5))).toBe(true);
    expect(grid.boundingBox.containsPoint(new THREE.Vector3(3.2, 1, 1.5))).toBe(false);
    expect(grid.roomId).toBe('bath');
    // `bake` refreshes the box from position and size; the selection must survive it.
    grid.updateBoundingBox();
    expect(grid.boundingBox.containsPoint(new THREE.Vector3(2.95, 0, 1.5))).toBe(true);
  });
});

describe('createExteriorGrid', () => {
  test('selects every point and carries the hemisphere and fill as a ready texture', () => {
    const grid = createExteriorGrid(LIGHTING_STANDARD.apartment, { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 3, z: 8 } });
    expect(grid.boundingBox.containsPoint(new THREE.Vector3(-500, 20, 900))).toBe(true);
    expect(grid.texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(grid.texture!.type).toBe(THREE.HalfFloatType);
    expect(grid.resolution.toArray()).toEqual([2, 2, 2]);
    grid.dispose();
    expect(grid.texture).toBeNull();
  });

  test('refuses to bake', () => {
    const grid = createExteriorGrid(LIGHTING_STANDARD.apartment, { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } });
    expect(() => grid.bake({} as THREE.WebGLRenderer, new THREE.Scene())).toThrow();
  });
});
