/**
 * The authoring rig's projection must follow the camera the picture is DRAWN
 * with: in `plan3d` that is the orthographic top view, and a perspective-only
 * projection put every order badge where the hidden 360 camera would see it
 * (up to 150 px from its camera).
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { badgeAt, scaleAt, viewOf } from './checkpoint-view.js';
import type { TourCheckpoint } from '../scene/types.js';

const WIDTH = 800;
const HEIGHT = 600;
const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT }) } as unknown as HTMLCanvasElement;
const CAM: TourCheckpoint = { id: '01a12ffa-7373-7e16-b6d4-d25d58b96eb8', position: { x: 3, y: 1.6, z: 2 }, yaw: 0, pitch: 0 };

/** A top view over (5, 4), 16 × 12 m, north up — `plan-modes.ts`'s fit. */
function topView(): THREE.OrthographicCamera {
  const top = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 100);
  top.up.set(0, 0, -1);
  top.position.set(5, 40, 4);
  top.lookAt(5, 0, 4);
  top.updateProjectionMatrix();
  return top;
}

describe('viewOf over the orthographic top view', () => {
  test('projects a camera where the top view draws it, whatever its height', () => {
    const view = viewOf(topView(), canvas)!;
    // 2 m west and 2 m north of the centre, at 50 px per metre.
    const at = view.project(CAM.position)!;
    expect(at.x).toBeCloseTo(400 - 2 * 50, 6);
    expect(at.y).toBeCloseTo(300 - 2 * 50, 6);
    const floor = view.project({ x: 3, y: 0, z: 2 })!;
    expect(floor.x).toBeCloseTo(at.x, 6);
    expect(floor.y).toBeCloseTo(at.y, 6);
  });

  test('one pixel is the same number of metres at every depth', () => {
    const view = viewOf(topView(), canvas)!;
    expect(view.metresPerPixel(CAM.position)).toBeCloseTo(12 / HEIGHT, 9);
    expect(view.metresPerPixel({ x: 3, y: 0, z: 2 })).toBeCloseTo(12 / HEIGHT, 9);
  });

  test('the zoom of the top view counts', () => {
    const top = topView();
    top.zoom = 2;
    top.updateProjectionMatrix();
    expect(viewOf(top, canvas)!.metresPerPixel(CAM.position)).toBeCloseTo(6 / HEIGHT, 9);
  });

  test('the badge floats straight above its camera on screen', () => {
    const view = viewOf(topView(), canvas)!;
    const at = view.project(CAM.position)!;
    const badge = badgeAt(CAM, view)!;
    expect(badge.x).toBeCloseTo(at.x, 6);
    expect(at.y - badge.y).toBeCloseTo(scaleAt(CAM, view).bodyHalfPx + 16, 6);
  });
});
