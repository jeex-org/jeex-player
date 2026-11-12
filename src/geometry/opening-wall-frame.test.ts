import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { fromWall, wallFrame, type OpeningPlacement } from './opening-wall-frame.js';
import type { Vec2 } from '../scene/types.js';

const S = Math.SQRT1_2;
const H = Math.sqrt(3) / 2;

/**
 * Tangents at the turns where the half-turn reduction ties or lands on an
 * axis, with the turn it must give; 30° and −120° (a 60° wall drawn the other
 * way) are off every tie, so a frame turned the wrong way would leave the line.
 */
const CASES: { name: string; tangent: Vec2; angle: number }[] = [
  { name: '0°', tangent: { x: 1, z: 0 }, angle: 0 },
  { name: '45°', tangent: { x: S, z: S }, angle: -Math.PI / 2 },
  { name: '-45°', tangent: { x: S, z: -S }, angle: -Math.PI / 2 },
  { name: '90°', tangent: { x: 0, z: 1 }, angle: 0 },
  { name: '-90°', tangent: { x: 0, z: -1 }, angle: 0 },
  { name: '180°', tangent: { x: -1, z: 0 }, angle: 0 },
  { name: '30°', tangent: { x: H, z: 0.5 }, angle: -Math.PI / 3 },
  { name: '-120°', tangent: { x: -0.5, z: -H }, angle: Math.PI / 3 },
];

function placementOf(tangent: Vec2): OpeningPlacement {
  return { point: { x: 0, z: 0 }, angleY: Math.atan2(tangent.z, tangent.x), normal: { x: -tangent.z, z: tangent.x }, sill: 0, head: 2 };
}

describe('wallFrame', () => {
  for (const { name, tangent, angle } of CASES) {
    test(`a tangent at ${name}: the turn is ${angle === 0 ? 'exactly zero' : angle.toFixed(4)}, and the frame's x lies on the wall line`, () => {
      const placement = placementOf(tangent);
      const frame = wallFrame(placement);
      if (angle === 0) {
        // An axis wall builds the numbers it always has: no turn at all.
        expect(Object.is(frame.angle, 0)).toBe(true);
        expect(frame.cos).toBe(1);
        expect(frame.sin).toBe(0);
      } else {
        expect(frame.angle).toBeCloseTo(angle, 12);
      }
      expect(frame.angle).toBeGreaterThanOrEqual(-Math.PI / 2);
      expect(frame.angle).toBeLessThan(Math.PI / 2);
      // The group stands at the origin turned by `angleY`; a wall-frame point
      // `±x` along the wall must land on the wall line, a whole unit from the centre.
      const group = new THREE.Object3D();
      group.rotation.y = placement.angleY;
      group.updateMatrixWorld(true);
      for (const x of [1, -1]) {
        const at = fromWall(frame, x, 0);
        const world = group.localToWorld(new THREE.Vector3(at.x, 0, at.z));
        expect(Math.abs(world.x * tangent.z - world.z * tangent.x)).toBeLessThan(1e-12);
        expect(Math.abs(world.x * tangent.x + world.z * tangent.z)).toBeCloseTo(1, 12);
      }
    });
  }
});
