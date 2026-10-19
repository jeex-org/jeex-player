/**
 * Where the walk floor ring may stand: only where a click would walk.
 * The controller-level cases (a real picker, a wall in front, the pointer
 * leaving) live in `walk-rig.test.ts`; this is the decision on its own.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { FLOOR_RING_LAYER, FLOOR_RING_NAME, FloorRing, floorRingPoint } from './floor-ring.js';

const FLOOR = new THREE.Vector3(2, 0, 3);
const yes = (): boolean => true;
const no = (): boolean => false;

describe('floorRingPoint', () => {
  test('a reachable floor with the floor itself nearest: the ring goes there', () => {
    expect(floorRingPoint({ surface: 'floor' }, FLOOR, yes)).toBe(FLOOR);
    expect(floorRingPoint(null, FLOOR, yes)).toBe(FLOOR);
  });

  test('no navigable floor under the pointer: hidden', () => {
    expect(floorRingPoint({ surface: 'floor' }, null, yes)).toBeNull();
  });

  test('a wall, a door leaf or furniture in front of the floor: hidden', () => {
    for (const surface of ['wall', 'opening', 'furniture'] as const) expect(floorRingPoint({ surface }, FLOOR, yes)).toBeNull();
  });

  test('a floor the walker cannot reach in a straight line (a closed route): hidden', () => {
    expect(floorRingPoint({ surface: 'floor' }, FLOOR, no)).toBeNull();
  });
});

describe('FloorRing', () => {
  test('starts hidden, follows show(), sits just above the floor, and hides on null', () => {
    const ring = new FloorRing();
    expect(ring.visible).toBe(false);
    expect(ring.object.name).toBe(FLOOR_RING_NAME);
    ring.show(FLOOR);
    expect(ring.visible).toBe(true);
    expect(ring.object.position.x).toBe(2);
    expect(ring.object.position.z).toBe(3);
    expect(ring.object.position.y).toBeGreaterThan(0);
    ring.show(null);
    expect(ring.visible).toBe(false);
  });

  test('it lives on its own layer, so a capture camera on layer 0 never draws it', () => {
    const ring = new FloorRing();
    const capture = new THREE.PerspectiveCamera();
    expect(ring.object.layers.test(capture.layers)).toBe(false);
    capture.layers.enable(FLOOR_RING_LAYER);
    expect(ring.object.layers.test(capture.layers)).toBe(true);
  });

  test('dispose takes it out of the scene', () => {
    const ring = new FloorRing();
    const scene = new THREE.Scene();
    scene.add(ring.object);
    ring.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
