/**
 * The runtime's lighting across a lost and restored WebGL context, against a
 * REAL context.
 *
 * The prefiltered environment is rendered into a target, so it does not
 * survive a context loss the way an uploaded texture does: three re-creates
 * its GL state on restore, and a target nobody renders into again comes back
 * black. The runtime therefore builds a new lighting context and apartment rig
 * on restore; this proves the scene's environment after a simulated loss and
 * restore lights a surface, which a stale target would not.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { createRenderRuntime, type RenderRuntime } from '../../src/render/render-runtime.js';
import { closeContainers, openContainer } from './support.js';

const runtimes: RenderRuntime[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  closeContainers();
});

/** Resolves on the next `type` event of `canvas`. */
function next(canvas: HTMLCanvasElement, type: string): Promise<void> {
  return new Promise((resolve) => {
    canvas.addEventListener(type, () => resolve(), { once: true });
  });
}

/** The mean of the central pixel of a white rough plane lit ONLY by `environment`. */
function environmentLit(renderer: THREE.WebGLRenderer, environment: THREE.Texture | null): number {
  const scene = new THREE.Scene();
  scene.environment = environment;
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
  scene.add(plane);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  plane.geometry.dispose();
  material.dispose();
  return (pixel[0]! + pixel[1]! + pixel[2]!) / 3;
}

describe('RenderRuntime lighting after a context restore', () => {
  test('a surface lit only by the environment is not black after a loss and restore', async () => {
    const container = openContainer(64, 64);
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const runtime = createRenderRuntime({
      canvas,
      viewport: { clientWidth: 64, clientHeight: 64, element: container },
      scheduleFrame: () => 0,
      cancelFrame: () => undefined,
    });
    runtimes.push(runtime);
    const before = environmentLit(runtime.renderer, runtime.scene.environment);
    expect(before).toBeGreaterThan(40);
    const firstContext = runtime.lighting;

    const extension = runtime.renderer.getContext().getExtension('WEBGL_lose_context')!;
    const lost = next(canvas, 'webglcontextlost');
    extension.loseContext();
    await lost;
    // A task later, not a microtask: the browser allows a restore only once
    // the loss event has been dispatched and found `preventDefault`-ed, and a
    // continuation of `lost` runs inside that dispatch.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const restored = next(canvas, 'webglcontextrestored');
    extension.restoreContext();
    await restored;

    expect(firstContext.disposed).toBe(true);
    expect(runtime.lighting).not.toBe(firstContext);
    const after = environmentLit(runtime.renderer, runtime.scene.environment);
    expect(after).toBeGreaterThan(40);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });
});
