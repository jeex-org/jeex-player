import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { projectToViewport } from './viewport-projection.js';

const VIEWPORT = { width: 800, height: 600 };

function camera(): THREE.PerspectiveCamera {
  const perspective = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 100);
  perspective.position.set(0, 0, 10);
  perspective.lookAt(0, 0, 0);
  perspective.updateMatrixWorld(true);
  return perspective;
}

describe('projectToViewport', () => {
  test('a point straight ahead lands at the viewport centre', () => {
    const point = projectToViewport(camera(), new THREE.Vector3(0, 0, 0), VIEWPORT);
    expect(point).not.toBeNull();
    expect(point!.x).toBeCloseTo(VIEWPORT.width / 2, 0);
    expect(point!.y).toBeCloseTo(VIEWPORT.height / 2, 0);
  });

  test('a point to the right of the camera lands right of centre', () => {
    const point = projectToViewport(camera(), new THREE.Vector3(3, 0, 0), VIEWPORT);
    expect(point!.x).toBeGreaterThan(VIEWPORT.width / 2);
  });

  test('a point above the world lands above the viewport centre (smaller y, pixels are y-down)', () => {
    const point = projectToViewport(camera(), new THREE.Vector3(0, 3, 0), VIEWPORT);
    expect(point!.y).toBeLessThan(VIEWPORT.height / 2);
  });

  test('a point behind the camera is null', () => {
    const point = projectToViewport(camera(), new THREE.Vector3(0, 0, 20), VIEWPORT);
    expect(point).toBeNull();
  });

  test('does not mutate the point it is given', () => {
    const point = new THREE.Vector3(1, 2, 3);
    const clone = point.clone();
    projectToViewport(camera(), point, VIEWPORT);
    expect(point.equals(clone)).toBe(true);
  });
});
