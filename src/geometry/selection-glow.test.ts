/**
 * What the selection aura wraps, on a really built opening: the door's own
 * frame and leaf, never the invisible pick proxies its group also carries.
 * The shader and its maths are proved in `selection-glow-math.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { createSelectionGlow, disposeSelectionGlow } from './selection-glow.js';
import { SceneBuilder } from './scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { TWO_ROOM_ENTRANCE, twoRoomEntrancePlan } from '../fixtures/plan-two-room-entrance.js';

describe('the aura of a selected door', () => {
  test('tops out at the door, below the wall top over it', () => {
    const builder = new SceneBuilder(twoRoomEntrancePlan, solvePlan(twoRoomEntrancePlan));
    builder.build().root.updateMatrixWorld(true);
    const group = builder.getOpeningGroup(TWO_ROOM_ENTRANCE.opening.entrance)!;
    const glow = createSelectionGlow(group);
    const uniforms = glow.material.uniforms;
    const count = uniforms['uSolidCount']!.value as number;
    const centres = uniforms['uSolidCenter']!.value as THREE.Vector3[];
    const halves = uniforms['uSolidHalf']!.value as THREE.Vector3[];
    let top = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const corner = centres[i]!.clone()
        .add(new THREE.Vector3(0, halves[i]!.y, 0))
        .applyMatrix4(group.matrixWorld);
      top = Math.max(top, corner.y);
    }
    // The entrance's head is 2.1 and the wall top (the ceiling) 2.7.
    expect(count).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(2.1);
    expect(top).toBeLessThan(twoRoomEntrancePlan.ceilingHeight);
    disposeSelectionGlow(glow);
    builder.dispose();
  });
});
