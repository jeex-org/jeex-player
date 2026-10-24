/**
 * An apartment light bake end to end in the browser: the demo apartment's
 * shell is exported, given UV1 by the stand-in unwrap and served with a
 * sidecar over the calibration page; `applyBakedShell` loads the pages,
 * adopts the shipped shell and binds it. Rendered from above, the adopted
 * shell without its lightmap is the live shell pixel for pixel (same
 * surfaces at the same places), the lightmap visibly lights it, and
 * disposing gives the live shell back.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { apartmentScene } from '../../src/demo/scene-data.js';
import { SceneBuilder } from '../../src/geometry/scene-builder.js';
import { solvePlan } from '../../src/plan/plan-solver.js';
import { standInSidecar, standInUnwrap } from '../../src/fixtures/shell-unwrap.js';
import type { LightBake } from '../../src/lightmap/light-bake.js';
import { applyBakedShell, liveShellEntries } from '../../src/lightmap/baked-shell.js';
import { exportShellForBake } from '../../src/lightmap/shell-export.js';
import { shellInputsHash } from '../../src/lightmap/shell-inputs.js';
import CALIBRATION from '../fixtures/lightmap-calibration/sidecar.json' with { type: 'json' };
import { FIXTURE, closeRenderers, renderLinear, renderer } from './lightmap-support.js';

afterEach(closeRenderers);

const SIZE = 160;

function view(root: THREE.Object3D): { scene: THREE.Scene; camera: THREE.OrthographicCamera } {
  const scene = new THREE.Scene();
  scene.add(root);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(3, 10, 4);
  scene.add(sun);
  const box = new THREE.Box3().setFromObject(root.getObjectByName('parametric-shell')!);
  const centre = box.getCenter(new THREE.Vector3());
  const half = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 0.5;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
  camera.position.set(centre.x + 4, 20, centre.z + 6);
  camera.lookAt(centre);
  return { scene, camera };
}

/** Largest per-channel difference between two RGBA float renders. */
function worst(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
  return max;
}

/** The demo apartment's stand-in bake, `edit` applied to its sidecar, served from memory and the calibration fixture. */
async function standInBake(edit: (bake: LightBake) => LightBake = (bake) => bake) {
  let n = 0;
  const exported = await exportShellForBake(apartmentScene, {
    mintId: () => `01a1f000-0000-7000-8000-${(n++).toString(16).padStart(12, '0')}`,
  });
  const unwrapped = await standInUnwrap(exported.glb);
  const bake = edit(
    await standInSidecar(unwrapped, CALIBRATION as unknown as LightBake, apartmentScene.id, await shellInputsHash(apartmentScene)),
  );
  const fetchBytes = async (url: URL): Promise<Blob> => {
    const name = url.pathname.split('/').at(-1)!;
    if (name === 'sidecar.json') return new Blob([JSON.stringify(bake)]);
    if (name === 'shell.glb') return new Blob([unwrapped.glb]);
    return (await fetch(new URL(name, FIXTURE))).blob();
  };
  return {
    sidecarUrl: new URL('https://bake.test/a/sidecar.json'),
    shellUrl: new URL('https://bake.test/a/shell.glb'),
    scene: apartmentScene,
    fetchBytes,
  };
}

/** What adoption and binding may change on each live shell mesh. */
function state(root: THREE.Object3D): unknown[] {
  return liveShellEntries(root, apartmentScene).map(({ mesh }) => [
    mesh.geometry,
    mesh.material,
    mesh.position.toArray(),
    mesh.quaternion.toArray(),
  ]);
}

describe('applyBakedShell', () => {
  test('adopts the shipped shell at the live positions and lights it, then gives the live shell back', async () => {
    const root = new SceneBuilder(apartmentScene, solvePlan(apartmentScene)).build().root;
    const gl = renderer();
    const { scene, camera } = view(root);
    const live = renderLinear(gl, scene, camera, SIZE, SIZE);
    const before = state(root);

    const outcome = await applyBakedShell({ ...(await standInBake()), root });
    if (!outcome.applied) throw outcome.error;
    const baked = renderLinear(gl, scene, camera, SIZE, SIZE);
    expect(worst(baked, live)).toBeGreaterThan(0.05);

    outcome.bound.unbind();
    const adopted = renderLinear(gl, scene, camera, SIZE, SIZE);
    expect(worst(adopted, live)).toBeLessThan(1e-3);

    outcome.dispose();
    expect(state(root)).toEqual(before);
    expect(worst(renderLinear(gl, scene, camera, SIZE, SIZE), live)).toBeLessThan(1e-6);
  });

  test('dispose while bound gives the live shell back', async () => {
    const root = new SceneBuilder(apartmentScene, solvePlan(apartmentScene)).build().root;
    const gl = renderer();
    const { scene, camera } = view(root);
    const live = renderLinear(gl, scene, camera, SIZE, SIZE);
    const before = state(root);
    const outcome = await applyBakedShell({ ...(await standInBake()), root });
    if (!outcome.applied) throw outcome.error;
    outcome.dispose();
    expect(state(root)).toEqual(before);
    expect(worst(renderLinear(gl, scene, camera, SIZE, SIZE), live)).toBeLessThan(1e-6);
  });

  test('a binding refused after the pages loaded leaves the live shell exactly as built', async () => {
    const root = new SceneBuilder(apartmentScene, solvePlan(apartmentScene)).build().root;
    const before = state(root);
    const moved = (bake: LightBake): LightBake => ({
      ...bake,
      bindings: bake.bindings.map((binding, i) => (i === 0 ? { ...binding, rect: { ...binding.rect, x: binding.rect.x + 64 } } : binding)),
    });
    const outcome = await applyBakedShell({ ...(await standInBake(moved)), root });
    expect(outcome.applied ? 'applied' : outcome.error.message).toContain('UV1 leaves the chart rect');
    expect(state(root)).toEqual(before);
  });
});
