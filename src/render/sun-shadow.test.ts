/**
 * The player's sun shadow over one built root, with a recording rig: which
 * boxes the fit is made of, when the frustum changes, when the cached map is
 * marked dirty, and what a preview does to the fit.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { solvePlan } from '../plan/plan-solver.js';
import { CEILING_CASTERS_NAME } from '../geometry/ceiling-casters.js';
import { LEGACY_SUN_DIRECTION, sunDirection } from '../lighting/sun-direction.js';
import type { ApartmentRig } from '../lighting/lighting-context.js';
import type { ShadowFit } from '../lighting/shadow-fit.js';
import type { Triple } from '../lighting/lighting-standard.js';
import type { SceneData } from '../scene/types.js';
import { groundFootprint, prepareSunShadow } from './sun-shadow.js';

const plan = solvePlan(lShapePlan);

type Recorder = { rig: ApartmentRig; fits: ShadowFit[]; directions: Triple[]; dirty: () => number };

function recordingRig(): Recorder {
  const fits: ShadowFit[] = [];
  const directions: Triple[] = [];
  let dirty = 0;
  const rig = {
    kind: 'apartment',
    scene: null,
    shadowMapSize: 2048,
    shadowDraws: 0,
    attach: () => undefined,
    detach: () => undefined,
    dispose: () => undefined,
    setSunDirection: (direction: Triple) => {
      directions.push(direction);
      dirty += 1;
    },
    setShadowFrustum: (fit: ShadowFit) => {
      fits.push(fit);
      dirty += 1;
    },
    markShadowDirty: () => {
      dirty += 1;
    },
  } satisfies ApartmentRig;
  return { rig, fits, directions, dirty: () => dirty };
}

function box(name: string, min: Triple, max: Triple, options: { cast?: boolean; receive?: boolean } = {}): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const mesh = new THREE.Mesh(geometry);
  mesh.name = name;
  mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  mesh.castShadow = options.cast ?? true;
  mesh.receiveShadow = options.receive ?? true;
  return mesh;
}

/** A small apartment root: a floor, a wall, a sofa and the site ground disk (`groundRadius` 0: none). */
function apartment(groundRadius = 36): THREE.Group {
  const root = new THREE.Group();
  root.add(box('floor', [0, -0.1, 0], [6, 0, 6], { cast: false }));
  root.add(box('wall', [0, 0, -0.1], [6, 2.7, 0.1]));
  const furniture = new THREE.Group();
  furniture.name = 'furniture';
  furniture.add(box('sofa', [1, 0, 1], [3, 0.8, 2]));
  root.add(furniture);
  if (groundRadius > 0) {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(groundRadius, 48));
    ground.name = 'site-ground';
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(3, -0.462, 3);
    ground.receiveShadow = true;
    root.add(ground);
  }
  return root;
}

function extent(fit: ShadowFit): number {
  return Math.max(fit.right - fit.left, fit.top - fit.bottom);
}

const scene = (site?: SceneData['site']): SceneData => ({ ...lShapePlan, ...(site === undefined ? {} : { schemaVersion: '2.3', site }) });

describe('prepareSunShadow', () => {
  test('adds the closed ceiling slabs beside the shell and takes them away on dispose', () => {
    const root = apartment();
    const sun = prepareSunShadow(root, scene(), plan, recordingRig().rig);
    expect(root.getObjectByName(CEILING_CASTERS_NAME)).toBeDefined();
    sun.dispose();
    expect(root.getObjectByName(CEILING_CASTERS_NAME)).toBeUndefined();
  });

  test('aims the sun by the site, and at the legacy direction without one', () => {
    const legacy = recordingRig();
    prepareSunShadow(apartment(), scene(), plan, legacy.rig);
    expect(legacy.directions.at(-1)).toEqual(LEGACY_SUN_DIRECTION);
    const evening = recordingRig();
    prepareSunShadow(apartment(), scene({ northDeg: 0, sun: 'evening' }), plan, evening.rig);
    expect(evening.directions.at(-1)).toEqual(sunDirection({ northDeg: 0, sun: 'evening' }).direction);
  });

  test('the site ground disk does not widen the fit: a 36 m and a 360 m disk fit the same', () => {
    for (const site of [undefined, { sun: 'evening' as const }, { sun: 'noon' as const }]) {
      const small = recordingRig();
      const large = recordingRig();
      prepareSunShadow(apartment(36), scene(site), plan, small.rig);
      prepareSunShadow(apartment(360), scene(site), plan, large.rig);
      expect(small.fits.at(-1)).toEqual(large.fits.at(-1));
    }
  });

  test('a low sun keeps the long shadow of the building on the ground inside the fit', () => {
    const recorder = recordingRig();
    const sun = prepareSunShadow(apartment(36), scene({ northDeg: 0, sun: 'evening' }), plan, recorder.rig);
    // Evening: the sun is towards -X at 20 degrees, the shadow falls towards +X.
    const tallest = lShapePlan.ceilingHeight + 0.1;
    expect(sun.bounds().max[0]).toBeGreaterThan(6 + (tallest + 0.462) / Math.tan((20 * Math.PI) / 180) - 0.3);
  });

  test('the fit covers the slabs above the ceiling', () => {
    const recorder = recordingRig();
    const sun = prepareSunShadow(apartment(), scene(), plan, recorder.rig);
    const bounds = sun.bounds();
    expect(bounds.max[1]).toBeGreaterThanOrEqual(lShapePlan.ceilingHeight + 0.1 - 1e-6);
  });

  test('a door leaf reserves its swept space', () => {
    const root = apartment();
    const leaf = box('leaf', [10, 0, 0], [10.9, 2.1, 0.04]);
    leaf.userData['isDoorLeaf'] = true;
    root.add(leaf);
    const sun = prepareSunShadow(root, scene(), plan, recordingRig().rig);
    const bounds = sun.bounds();
    expect(bounds.max[0]).toBeGreaterThanOrEqual(10.9 + 0.89);
    expect(bounds.min[2]).toBeLessThanOrEqual(-0.85);
  });

  test('a refit with nothing changed draws nothing; a moved caster draws once', () => {
    const recorder = recordingRig();
    const root = apartment();
    const sun = prepareSunShadow(root, scene(), plan, recorder.rig);
    const before = recorder.dirty();
    sun.refit();
    expect(recorder.dirty()).toBe(before);
    root.getObjectByName('sofa')!.position.x += 0.5;
    sun.refit();
    expect(recorder.dirty()).toBe(before + 1);
  });

  test('hiding the furniture is a change, showing it again another', () => {
    const recorder = recordingRig();
    const root = apartment();
    const sun = prepareSunShadow(root, scene(), plan, recorder.rig);
    const before = recorder.dirty();
    root.getObjectByName('furniture')!.visible = false;
    sun.refit();
    root.getObjectByName('furniture')!.visible = true;
    sun.refit();
    expect(recorder.dirty()).toBeGreaterThanOrEqual(before + 2);
  });

  test('include grows the frustum only past the fit, and endPreview fits the apartment again', () => {
    const recorder = recordingRig();
    const root = apartment();
    const sun = prepareSunShadow(root, scene(), plan, recorder.rig);
    const fitted = recorder.fits.at(-1)!;
    const fits = recorder.fits.length;
    const sofa = root.getObjectByName('sofa')!;
    sofa.position.x += 0.1;
    sofa.updateMatrixWorld(true);
    const dirty = recorder.dirty();
    sun.include(sofa);
    expect(recorder.fits.length).toBe(fits);
    expect(recorder.dirty()).toBe(dirty + 1);
    sofa.position.set(40, 0.4, 40);
    sofa.updateMatrixWorld(true);
    sun.include(sofa);
    expect(recorder.fits.length).toBe(fits + 1);
    expect(extent(recorder.fits.at(-1)!)).toBeGreaterThan(extent(fitted));
    sofa.position.set(2, 0.4, 1.5);
    sun.endPreview();
    expect(recorder.fits.at(-1)).toEqual(fitted);
  });

  test('an animation that left the fit grows it, and settling returns it to the apartment fit', () => {
    const recorder = recordingRig();
    const root = apartment();
    const sun = prepareSunShadow(root, scene(), plan, recorder.rig);
    const fitted = recorder.fits.at(-1)!;
    const sofa = root.getObjectByName('sofa')!;
    sofa.position.set(40, 0.4, 40);
    sun.include(sofa);
    expect(recorder.fits.at(-1)).not.toEqual(fitted);
    sofa.position.set(2, 0.4, 1.5);
    sofa.updateMatrixWorld(true);
    sun.settle();
    expect(recorder.fits.at(-1)).toEqual(fitted);
  });

  test('a refit drops an animation growth, but keeps a drag preview until endPreview', () => {
    const recorder = recordingRig();
    const root = apartment();
    const sun = prepareSunShadow(root, scene(), plan, recorder.rig);
    const fitted = recorder.fits.at(-1)!;
    const sofa = root.getObjectByName('sofa')!;
    sofa.position.set(40, 0.4, 40);
    sun.include(sofa, 'preview');
    sofa.position.set(2, 0.4, 1.5);
    sun.refit();
    sun.settle();
    expect(recorder.fits.at(-1)).not.toEqual(fitted);
    sun.endPreview();
    expect(recorder.fits.at(-1)).toEqual(fitted);
    sofa.position.set(40, 0.4, 40);
    sun.include(sofa);
    sofa.position.set(2, 0.4, 1.5);
    sun.refit();
    expect(recorder.fits.at(-1)).toEqual(fitted);
  });

  test('state hands out a copy of the fit', () => {
    const recorder = recordingRig();
    const sun = prepareSunShadow(apartment(), scene(), plan, recorder.rig);
    const first = sun.state().fit!;
    (first as { left: number }).left = 999;
    expect(sun.state().fit!.left).not.toBe(999);
    expect(sun.state().fit).toEqual(recorder.fits.at(-1)!);
  });

  test('orient changes the sun only when the site changes', () => {
    const recorder = recordingRig();
    const sun = prepareSunShadow(apartment(), scene({ sun: 'noon' }), plan, recorder.rig);
    const directions = recorder.directions.length;
    expect(sun.orient({ sun: 'noon' })).toBe(false);
    expect(recorder.directions.length).toBe(directions);
    expect(sun.orient({ sun: 'morning' })).toBe(true);
    expect(recorder.directions.length).toBe(directions + 1);
    sun.orient(undefined);
    expect(recorder.directions.at(-1)).toEqual(LEGACY_SUN_DIRECTION);
  });

  test('state reports the direction, its angles, the fit and the draws', () => {
    const recorder = recordingRig();
    const sun = prepareSunShadow(apartment(), scene({ northDeg: 0, sun: 'evening' }), plan, recorder.rig);
    const state = sun.state();
    expect(state.azimuth).toBeCloseTo(270, 9);
    expect(state.elevation).toBeCloseTo(20, 9);
    expect(state.fit).toEqual(recorder.fits.at(-1)!);
    expect(state.draws).toBe(0);
  });
});

describe('groundFootprint', () => {
  const ground = { y: -0.462, centre: [0, 0] as const, radius: 36 };
  const wall = { min: [0, 0, 0], max: [6, 2.7, 0.2] } as const;
  const DEG = Math.PI / 180;

  test('a low sun stretches the footprint by about h / tan(E) on the downwind side', () => {
    const e = 20 * DEG;
    const footprint = groundFootprint([wall], [-Math.cos(e), Math.sin(e), 0], ground)!;
    expect(footprint.max[0]).toBeCloseTo(6 + (2.7 + 0.462) / Math.tan(e), 6);
    expect(footprint.min[0]).toBeCloseTo(0 + 0.462 / Math.tan(e), 6);
    expect(footprint.min[1]).toBe(-0.462);
    expect(footprint.max[1]).toBe(-0.462);
  });

  test('a high sun keeps it short', () => {
    const footprint = groundFootprint([wall], [0, 1, 0], ground)!;
    expect(footprint.min).toEqual([0, -0.462, 0]);
    expect(footprint.max).toEqual([6, -0.462, 0.2]);
  });

  test('the footprint never leaves the ground disk', () => {
    const e = 3 * DEG;
    const footprint = groundFootprint([wall], [-Math.cos(e), Math.sin(e), 0], { ...ground, radius: 10 })!;
    expect(footprint.max[0]).toBeLessThanOrEqual(10 + 1e-9);
  });

  test('no casters, or a sun not above the horizon, has no footprint', () => {
    expect(groundFootprint([], [0, 1, 0], ground)).toBeNull();
    expect(groundFootprint([wall], [1, 0, 0], ground)).toBeNull();
  });
});
