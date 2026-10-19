/**
 * The opening-kind table: one entry per `OpeningType`, and what each entry
 * must produce.
 *
 * The shapes are asserted through the real `SceneBuilder` over the L-shape
 * fixture, because the point of the table is that the builder does not know
 * what a window or a door is — if a kind stops building its own leaf or its
 * own pick proxies, nothing else in the pipeline would notice.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SceneBuilder } from './scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { effectiveOpening } from '../plan/plan-openings.js';
import { OPENING_BUILDERS } from './opening-kinds.js';
import type { Opening, OpeningType, SceneData } from '../scene/types.js';

/** Every `OpeningType`, as a value. A new member of the union breaks this line. */
const EVERY_TYPE: Readonly<Record<OpeningType, true>> = { window: true, door: true, passage: true };
const OPENING_TYPES = Object.keys(EVERY_TYPE) as OpeningType[];

/** The fixture with one opening replaced, so a kind can be exercised in isolation. */
function sceneWithOpening(wallId: string, openingId: string, patch: Partial<Opening>): SceneData {
  return {
    ...lShapePlan,
    walls: lShapePlan.walls.map((wall) =>
      wall.id === wallId
        ? {
            ...wall,
            openings: (wall.openings ?? []).map((opening) => (opening.id === openingId ? { ...opening, ...patch } : opening)),
          }
        : wall,
    ),
  };
}

function build(scene: SceneData): SceneBuilder {
  const builder = new SceneBuilder(scene, solvePlan(scene));
  builder.build();
  return builder;
}

/** Direct children of an opening group that are door leaves. */
function leavesOf(group: THREE.Object3D): THREE.Object3D[] {
  return group.children.filter((child) => child.userData['isDoorLeaf'] === true);
}

function pickProxies(group: THREE.Object3D, openingId: string): THREE.Mesh[] {
  return group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.name === `${openingId}-pick`);
}

describe('the opening-kind table', () => {
  test('every opening type has a kind that can build, pick and point', () => {
    expect(OPENING_TYPES.length).toBe(3);
    for (const type of OPENING_TYPES) {
      const kind = OPENING_BUILDERS[type];
      expect({ type, kind: typeof kind }).toEqual({ type, kind: 'object' });
      for (const method of ['build', 'pickBoxes', 'pickLocal'] as const) {
        expect({ type, method, is: typeof kind[method] }).toEqual({ type, method, is: 'function' });
      }
    }
  });

  test('the table has no entry beyond the union', () => {
    expect(Object.keys(OPENING_BUILDERS).sort()).toEqual([...OPENING_TYPES].sort());
  });
});

describe('doors and passages', () => {
  test('a door builds a leaf that records how it moves', () => {
    const builder = build(lShapePlan);
    const leaves = leavesOf(builder.getOpeningGroup(L_SHAPE.opening.doorAb)!);
    expect(leaves.length).toBe(1);
    const leaf = leaves[0]!;
    expect(leaf.userData['isDoorLeaf']).toBe(true);
    expect(typeof leaf.userData['restAngle']).toBe('number');
    expect(Math.abs(leaf.userData['hingeSign'] as number)).toBe(1);
    expect(Math.abs(leaf.userData['openSign'] as number)).toBe(1);
    // Built OPEN: the recorded rest angle is the pose on screen.
    expect(leaf.rotation.y).toBeCloseTo(leaf.userData['restAngle'] as number, 10);
  });

  test('a passage is the same doorway with no leaf at all', () => {
    const scene = sceneWithOpening(L_SHAPE.wall.wPart, L_SHAPE.opening.doorAb, { type: 'passage' });
    const builder = build(scene);
    const group = builder.getOpeningGroup(L_SHAPE.opening.doorAb)!;
    expect(group.userData['openingType']).toBe('passage');
    expect(leavesOf(group)).toEqual([]);
    let leafParts = 0;
    group.traverse((object) => {
      if (object.userData['isDoorLeaf']) leafParts += 1;
    });
    expect(leafParts).toBe(0);
  });

  test('a doorway is picked on its jambs and head, never across the void', () => {
    for (const type of ['door', 'passage'] as const) {
      const builder = build(sceneWithOpening(L_SHAPE.wall.wPart, L_SHAPE.opening.doorAb, { type }));
      const proxies = pickProxies(builder.getOpeningGroup(L_SHAPE.opening.doorAb)!, L_SHAPE.opening.doorAb);
      expect({ type, proxies: proxies.length }).toEqual({ type, proxies: 3 });
      // None of the three spans the whole opening at mid height: that is what
      // lets a click travel through an open doorway.
      const opening = lShapePlan.walls.find((wall) => wall.id === L_SHAPE.wall.wPart)!.openings![0]!;
      const spanning = proxies.filter((proxy) => {
        proxy.geometry.computeBoundingBox();
        const box = proxy.geometry.boundingBox!;
        return box.max.x - box.min.x > opening.width - 0.01 && box.max.y - box.min.y > 1;
      });
      expect({ type, spanning: spanning.length }).toEqual({ type, spanning: 0 });
    }
  });

  test('the recorded pick point lies inside one of the proxies', () => {
    const builder = build(lShapePlan);
    const entry = builder.openingsList().find((item) => item.id === L_SHAPE.opening.doorAb)!;
    const proxies = pickProxies(builder.getOpeningGroup(L_SHAPE.opening.doorAb)!, L_SHAPE.opening.doorAb);
    const point = new THREE.Vector3(entry.pick.x, entry.pick.y, entry.pick.z);
    const inside = proxies.some((proxy) => {
      proxy.updateMatrixWorld(true);
      proxy.geometry.computeBoundingBox();
      const box = proxy.geometry.boundingBox!.clone().applyMatrix4(proxy.matrixWorld);
      return box.expandByScalar(1e-6).containsPoint(point);
    });
    expect(inside).toBe(true);
  });
});

describe('windows', () => {
  test('a window is picked over its whole pane', () => {
    const builder = build(lShapePlan);
    const proxies = pickProxies(builder.getOpeningGroup(L_SHAPE.opening.windowASouth)!, L_SHAPE.opening.windowASouth);
    expect(proxies.length).toBe(1);
  });

  test('an authored window with no sill or head keeps the effectiveOpening defaults', () => {
    const scene = sceneWithOpening(L_SHAPE.wall.wSA, L_SHAPE.opening.windowASouth, { sill: undefined, head: undefined });
    const opening = scene.walls
      .find((wall) => wall.id === L_SHAPE.wall.wSA)!
      .openings!.find((candidate) => candidate.id === L_SHAPE.opening.windowASouth)!;
    const expected = effectiveOpening(opening, scene.ceilingHeight);
    expect({ sill: expected.sill, head: expected.head }).toEqual({ sill: 0.9, head: 2.2 });

    const builder = build(scene);
    const entry = builder.openingsList().find((item) => item.id === L_SHAPE.opening.windowASouth)!;
    // `center.y` is the middle of the opening rectangle, so it is the one
    // number that shows the builder used the shared projection and not a
    // default of its own.
    expect(entry.center.y).toBeCloseTo((expected.sill + expected.head) / 2, 10);
  });
});
