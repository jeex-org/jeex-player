/**
 * The perspective stand-in for a plan mode's top view: the pose a walk or tour
 * entry glides FROM when the view on screen is `plan2d` or `plan3d` (the
 * entry starts wherever the view is).
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { planViewPose } from './plan-view-pose.js';
import { fieldOfViewFor } from './camera-tuning.js';

/** A top view as `plan-modes.ts` fits it: straight down, north up, centred on (cx, cz). */
function topView(cx: number, cz: number, halfX: number, halfZ: number): THREE.OrthographicCamera {
  const top = new THREE.OrthographicCamera(-halfX, halfX, halfZ, -halfZ, 0.1, 100);
  top.up.set(0, 0, -1);
  top.position.set(cx, 40, cz);
  top.lookAt(cx, 0, cz);
  top.updateProjectionMatrix();
  top.updateMatrixWorld();
  return top;
}

/** Normalised device coordinates of a floor point through `camera`. */
function ndc(camera: THREE.Camera, x: number, z: number): THREE.Vector2 {
  const p = new THREE.Vector3(x, 0, z).project(camera);
  return new THREE.Vector2(p.x, p.y);
}

function perspectiveAt(pose: { position: THREE.Vector3; target: THREE.Vector3 }, aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fieldOfViewFor(aspect, pose.position.y), aspect, 0.1, 200);
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

describe('planViewPose', () => {
  test('the floor lands where the top view shows it: centre, corners and edges within 1 % of the frame', () => {
    const aspect = 16 / 9;
    const top = topView(6, 4.5, 8 * aspect, 8);
    const camera = perspectiveAt(planViewPose(top, aspect), aspect);
    for (const [x, z] of [
      [6, 4.5],
      [6 - 8 * aspect * 0.9, 4.5 - 8 * 0.9],
      [6 + 8 * aspect * 0.9, 4.5 + 8 * 0.9],
      [6 + 8 * aspect * 0.5, 4.5 - 8 * 0.3],
      [2, 9],
    ] as const) {
      expect(ndc(camera, x, z).distanceTo(ndc(top, x, z))).toBeLessThan(0.02);
    }
  });

  test('north stays up and east stays right (no roll, no mirror)', () => {
    const aspect = 4 / 3;
    const top = topView(0, 0, 10 * aspect, 10);
    const camera = perspectiveAt(planViewPose(top, aspect), aspect);
    expect(ndc(camera, 0, -5).y).toBeGreaterThan(0.3);
    expect(ndc(camera, 5, 0).x).toBeGreaterThan(0.3);
  });

  test('a portrait viewport uses its own, wider field of view and still matches', () => {
    const aspect = 0.6;
    const top = topView(3, 3, 6, 6 / aspect);
    const pose = planViewPose(top, aspect);
    const camera = perspectiveAt(pose, aspect);
    expect(ndc(camera, 3 + 5, 3 + 5).distanceTo(ndc(top, 3 + 5, 3 + 5))).toBeLessThan(0.02);
  });

  test('a small plan, whose stand-in sits where the field of view widens toward eye level, still matches', () => {
    const top = topView(1, 1, 1.8 * (4 / 3), 1.8);
    const pose = planViewPose(top, 4 / 3);
    // Inside the widening band: the fixed point between height and field of view is what makes it match.
    expect(pose.position.y).toBeLessThan(5.2);
    const camera = perspectiveAt(pose, 4 / 3);
    expect(ndc(camera, 2.8, 2.5).distanceTo(ndc(top, 2.8, 2.5))).toBeLessThan(0.02);
  });
});
