/**
 * The shell operations: the ceiling, and the centreline GRAPH — nodes, walls
 * and what follows them (the openings that keep their share of a stretched
 * wall, the finishes painted on a removed wall's faces).
 *
 * `set_ceiling` moved here verbatim from `scene-ops.test.ts` when the appliers
 * were split out of it; `scene-ops.test.ts`'s vocabulary snapshot proves the
 * move changed no summary and no touched id, and now carries one row per graph
 * operation as well.
 */

import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { describe, expect, test } from 'bun:test';
import { draftOf, type Draft } from '../../shared/committed.js';
import { bayPlan, lShapePlan } from '../../fixtures/plan-l-shape.js';
import { apartmentScene } from '../../demo/scene-data.js';
import { opDraft, openingOf, rejectsOp } from '../../fixtures/op-drafts.js';
import { countIssues, describeIssues, lintLayout } from '../../layout/layout-lint.js';
import { solvePlan } from '../../plan/plan-solver.js';
import { resolveDoorSwing } from '../../plan/door-swing.js';
import { OPENING_EDGE_MARGIN } from '../../plan/plan-openings.js';
import { isApplyOk, SceneModel } from '../scene-model.js';
import { validateScene } from '../scene-validator.js';
import { WALL_LIMITS, faceKey } from '../types.js';
import { BAY, L_SHAPE } from '../../fixtures/plan-l-shape-ids.js';
import { DEMO } from '../../demo/demo-ids.js';
import { FINISH } from '../../materials/finish-ids.js';

/** Ids of the nodes and walls these tests create (and of nothing at all), minted offline. */
const NEW = {
  nMid: '01a12ff3-0a51-7b61-9487-2ab39ac44052',
  wL: '01a12ff3-0a52-7c8e-b4be-e3d9291e4f4a',
  wR: '01a12ff3-0a53-7182-a933-16c5ed5c4db9',
  wSBW: '01a12ff3-0a54-7f33-b486-0e5ee3f998fa',
  wSBE: '01a12ff3-0a55-7db7-ba24-41c9042a724c',
  nSMid: '01a12ff3-0a56-72c3-b8c9-b25392500c5e',
  wSAW: '01a12ff3-0a57-7cb6-bf9c-1d0bef1a3a73',
  wSAE: '01a12ff3-0a58-7965-85c2-bc61382d42a0',
  wWHalf: '01a12ff3-0a59-70da-ae70-42ae924e9119',
  wEHalf: '01a12ff3-0a5a-7ccb-8a8a-c8585e4774bd',
  bMid: '01a12ff3-0a5b-7074-93fb-72eeab5ea589',
  bayW: '01a12ff3-0a5c-7ac9-87f0-d05bf95eca6b',
  bayE: '01a12ff3-0a5d-7b43-94cd-9dae49050a53',
  spare: '01a12ff3-0a5e-7575-bc06-4500f3d7633a',
  diagonal: '01a12ff3-0a5f-7632-a61a-14acf81856af',
  thin: '01a12ff3-0a60-770b-914d-ccfd90acfdb6',
  nodeSplitMid: '01a12ff3-0a61-7a90-80b4-a2c20ff9e63b',
  wallSplitW: '01a12ff3-0a62-705a-97dd-bff6f88fad89',
  wallSplitE: '01a12ff3-0a63-7ccd-8da5-6bb1fe46cda5',
  wSame: '01a12ff3-0a64-7a74-8eb4-d0be5a372c46',
  ghost: '01a12ff3-0a65-73dd-9b26-69b7125099ff',
  node: '01a12ff3-0a66-7d3d-b658-c03073154263',
} as const;

/** Ids the `merge_wall` and preset tests create, minted offline like `NEW`. */
const MERGE = {
  merged: '01a172f5-2a54-714b-aadf-c8fb114e5c33',
  door: '01a172f5-2a54-714c-80cb-590ddb22f8d1',
  preset: '01a172f5-2a54-714d-bc93-46a36ae27d6c',
  presetGone: '01a172f5-2a54-714e-9975-28f5e1c45ead',
} as const;

/** A well-formed UUID of version 4: the right shape, the wrong version. */
const UUID_V4 = '3b241101-e2bb-4255-8caf-4136c566a962';

const { a: ROOM_A } = L_SHAPE.room;
const W = L_SHAPE.wall;
const N = L_SHAPE.node;

import type { SceneData, SceneOp, Wall } from '../types.js';
import { MIN_SPLIT_HALF, WALL_THICKNESS } from './limits.js';
import {
  MAX_CEILING_HEIGHT,
  OpError,
  TOUCHED_SHELL,
  applyOp,
  faceFinishOf,
  touchedFace,
  touchedOpening,
  wallCentrelineLength,
} from '../scene-ops.js';

/** Applies `op` expecting an `OpError`, and answers with the error itself. */
function refusalOf(scene: Draft<SceneData>, op: SceneOp): OpError {
  try {
    applyOp(scene, op, CATALOGUE_REGISTRIES);
  } catch (error) {
    if (error instanceof OpError) return error;
    throw error;
  }
  throw new Error(`operation ${String((op as { op?: unknown }).op)} was expected to be rejected`);
}

/** The structured payload a split refusal carries (`OpError.detail`). */
function splitDetail(error: OpError): Record<string, unknown> {
  expect(error.detail?.['op']).toBe('split_wall');
  return error.detail as Record<string, unknown>;
}

describe('set_ceiling', () => {
  test('lowering the ceiling re-clamps every opening under it', () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'set_ceiling', height: 2.3 }, CATALOGUE_REGISTRIES);
    expect(scene.ceilingHeight).toBe(2.3);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
    for (const wall of scene.walls) {
      for (const opening of wall.openings ?? []) expect(opening.head!).toBeLessThanOrEqual(2.3);
    }
    // A window keeps a sill below its lowered head.
    const window = openingOf(scene, L_SHAPE.opening.windowASouth);
    expect(window.sill!).toBeLessThan(window.head!);
  });

  test('rejects a height outside the 2.2..4.5 m range', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'set_ceiling', height: 1.9 })).toContain('outside');
    expect(rejectsOp(scene, { op: 'set_ceiling', height: MAX_CEILING_HEIGHT + 0.1 })).toContain('outside');
    expect(scene.ceilingHeight).toBe(lShapePlan.ceilingHeight);
  });

  test('rejects a height that is not a finite number', () => {
    expect(rejectsOp(opDraft(), { op: 'set_ceiling', height: Number.NaN })).toContain('finite');
  });
});

/* ------------------------------------------------------ the graph itself --- */

describe('add_node', () => {
  test("adds a node under the caller's id and reports where it landed", () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'add_node', id: NEW.node, p: { x: 3, z: 9.5 } }, CATALOGUE_REGISTRIES);
    expect(outcome.summary).toBe(`Node ${NEW.node}: added at (3, 9.5)`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
    expect(scene.nodes.at(-1)).toEqual({ id: NEW.node, p: { x: 3, z: 9.5 } });
  });

  test('a missing id or one that is not a UUID v7 is invalid_id: the viewer mints none', () => {
    const missing = refusalOf(opDraft(), { op: 'add_node', p: { x: 1, z: 1 } } as unknown as SceneOp);
    expect(missing.detail).toEqual({ reason: 'invalid_id', field: 'id', id: null, op: 'add_node' });
    const v4 = refusalOf(opDraft(), { op: 'add_node', id: UUID_V4, p: { x: 1, z: 1 } });
    expect(v4.detail).toEqual({ reason: 'invalid_id', field: 'id', id: UUID_V4, op: 'add_node' });
  });

  test('rejects an id another entity already holds as duplicate_id, and a point that is not finite', () => {
    const scene = opDraft();
    // Ids are unique across the whole document, not per entity kind: the
    // partition is a WALL, and a node borrowing its UUID would be refused at commit.
    expect(refusalOf(scene, { op: 'add_node', id: W.wPart, p: { x: 1, z: 1 } }).detail).toEqual({
      reason: 'duplicate_id',
      field: 'id',
      id: W.wPart,
      op: 'add_node',
    });
    expect(rejectsOp(scene, { op: 'add_node', id: N.n1, p: { x: 1, z: 1 } })).toContain('already taken');
    expect(rejectsOp(scene, { op: 'add_node', id: NEW.node, p: { x: Number.NaN, z: 1 } })).toContain('finite');
    expect(scene.nodes).toHaveLength(lShapePlan.nodes.length);
  });
});

describe('move_node', () => {
  test('an absolute point moves the node and every wall on it follows', () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'move_node', nodeId: N.n2, p: { x: 7, z: 0 } }, CATALOGUE_REGISTRIES);
    expect(outcome.summary).toBe(`Node ${N.n2}: moved to (7, 0)`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
    expect(scene.nodes.find((node) => node.id === N.n2)!.p).toEqual({ x: 7, z: 0 });
  });

  test('a delta is added to the current point', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'move_node', nodeId: N.n2, dp: { x: 0.5, z: 0 } }, CATALOGUE_REGISTRIES);
    expect(scene.nodes.find((node) => node.id === N.n2)!.p).toEqual({ x: 6.5, z: 0 });
  });

  test('openings on a stretched wall keep their share of it', () => {
    const scene = opDraft();
    const wall = scene.walls.find((candidate) => candidate.id === W.wSA)!;
    const before = wallCentrelineLength(scene, wall);
    const shares = (wall.openings ?? []).map((opening) => opening.center / before);

    applyOp(scene, { op: 'move_node', nodeId: N.n2, p: { x: 7, z: 0 } }, CATALOGUE_REGISTRIES);

    const after = wallCentrelineLength(scene, wall);
    expect(after).toBeCloseTo(7, 9);
    for (const [index, opening] of (wall.openings ?? []).entries()) {
      expect(opening.center / after).toBeCloseTo(shares[index]!, 9);
    }
  });

  test('an opening that no longer fits the shortened wall is clamped back onto it', () => {
    const scene = opDraft();
    // 6.00 -> 3.00 m: the 2.00 m window cannot keep its share (4.15/6 * 3 =
    // 2.08) AND its edge margin, so the clamp wins over the share.
    applyOp(scene, { op: 'move_node', nodeId: N.n2, p: { x: 3, z: 0 } }, CATALOGUE_REGISTRIES);
    const window = openingOf(scene, L_SHAPE.opening.windowASouth);
    expect(window.center + window.width / 2).toBeLessThanOrEqual(3 - OPENING_EDGE_MARGIN + 1e-9);
  });

  test('refuses to leave a wall shorter than the schema accepts, and moves nothing', () => {
    const scene = opDraft();
    const message = rejectsOp(scene, { op: 'move_node', nodeId: N.n2, p: { x: 0.3, z: 0 } });
    expect(message).toContain(W.wSA);
    expect(message).toContain(String(WALL_LIMITS.minCentrelineLength));
    expect(scene.nodes.find((node) => node.id === N.n2)!.p).toEqual({ x: 6, z: 0 });
  });

  test('refuses a chord its wall arc can no longer span', () => {
    const scene = draftOf(bayPlan);
    // The bay is a semicircle: chord 4.00 m on radius 2.00 m is the diameter,
    // so any wider chord has no circle through both ends.
    expect(rejectsOp(scene, { op: 'move_node', nodeId: BAY.node.b2, p: { x: 5, z: 0 } })).toContain('arc');
    expect(scene.nodes.find((node) => node.id === BAY.node.b2)!.p).toEqual({ x: 4, z: 0 });
  });

  test('rejects both forms at once, neither form, an unknown node and a non-finite point', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'move_node', nodeId: N.n2, p: { x: 1, z: 1 }, dp: { x: 1, z: 1 } })).toContain('not both');
    expect(rejectsOp(scene, { op: 'move_node', nodeId: N.n2 })).toContain('needs p or dp');
    expect(rejectsOp(scene, { op: 'move_node', nodeId: NEW.ghost, p: { x: 1, z: 1 } })).toContain('Unknown node');
    expect(rejectsOp(scene, { op: 'move_node', nodeId: N.n2, dp: { x: Number.POSITIVE_INFINITY, z: 0 } })).toContain('finite');
  });
});

describe('remove_node', () => {
  test('removes a node nothing is attached to', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'add_node', id: NEW.spare, p: { x: 3, z: 9.5 } }, CATALOGUE_REGISTRIES);
    const outcome = applyOp(scene, { op: 'remove_node', nodeId: NEW.spare }, CATALOGUE_REGISTRIES);
    expect(outcome.summary).toBe(`Node ${NEW.spare}: removed`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
    expect(scene.nodes.some((node) => node.id === NEW.spare)).toBe(false);
  });

  test('refuses a node a wall still hangs on, naming the walls', () => {
    const scene = opDraft();
    const message = rejectsOp(scene, { op: 'remove_node', nodeId: N.n2 });
    expect(message).toContain(W.wSA);
    expect(message).toContain(W.wPart);
    expect(scene.nodes.some((node) => node.id === N.n2)).toBe(true);
  });

  test('rejects an unknown node', () => {
    expect(rejectsOp(opDraft(), { op: 'remove_node', nodeId: NEW.ghost })).toContain('Unknown node');
  });
});

describe('add_wall', () => {
  test("joins two nodes under the caller's id", () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'add_wall', id: NEW.diagonal, a: N.n1, b: N.n5, thickness: 0.12 }, CATALOGUE_REGISTRIES);
    expect(outcome.summary).toBe(`Wall ${NEW.diagonal}: added between ${N.n1} and ${N.n5}, thickness 0.12 m`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
    expect(scene.walls.at(-1)).toEqual({ id: NEW.diagonal, a: N.n1, b: N.n5, thickness: 0.12 });
  });

  test('carries a role and an arc through, and clamps the thickness into the schema range', () => {
    const scene = opDraft();
    applyOp(
      scene,
      { op: 'add_wall', id: NEW.diagonal, a: N.n1, b: N.n5, thickness: 9, role: 'bearing', arc: { radius: 6, ccw: true } },
      CATALOGUE_REGISTRIES,
    );
    const wall = scene.walls.find((candidate) => candidate.id === NEW.diagonal)!;
    expect(wall.thickness).toBe(WALL_THICKNESS[1]);
    expect(wall.role).toBe('bearing');
    expect(wall.arc).toEqual({ radius: 6, ccw: true });
    applyOp(scene, { op: 'add_wall', id: NEW.thin, a: N.n1, b: N.n4, thickness: 0.001 }, CATALOGUE_REGISTRIES);
    expect(scene.walls.find((candidate) => candidate.id === NEW.thin)!.thickness).toBe(WALL_THICKNESS[0]);
  });

  test('rejects a self-loop, an unknown node, a duplicate edge in either direction and a bad arc', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'add_wall', id: NEW.diagonal, a: N.n1, b: N.n1, thickness: 0.1 })).toContain('two different nodes');
    expect(rejectsOp(scene, { op: 'add_wall', id: NEW.diagonal, a: N.n1, b: NEW.ghost, thickness: 0.1 })).toContain(
      `Unknown node ${NEW.ghost}`,
    );
    expect(rejectsOp(scene, { op: 'add_wall', id: NEW.diagonal, a: N.n1, b: N.n2, thickness: 0.1 })).toContain(W.wSA);
    expect(rejectsOp(scene, { op: 'add_wall', id: NEW.diagonal, a: N.n2, b: N.n1, thickness: 0.1 })).toContain(W.wSA);
    expect(
      rejectsOp(scene, { op: 'add_wall', id: NEW.diagonal, a: N.n1, b: N.n5, thickness: 0.1, arc: { radius: 1, ccw: true } }),
    ).toContain('arc');
    expect(rejectsOp(scene, { op: 'add_wall', id: NEW.diagonal, a: N.n1, b: N.n5, thickness: Number.NaN })).toContain('finite');
    expect(rejectsOp(scene, { op: 'add_wall', id: W.wPart, a: N.n1, b: N.n5, thickness: 0.1 })).toContain('already taken');
    expect(refusalOf(scene, { op: 'add_wall', id: N.n1, a: N.n1, b: N.n5, thickness: 0.1 }).detail).toEqual({
      reason: 'duplicate_id',
      field: 'id',
      id: N.n1,
      op: 'add_wall',
    });
    const missing = refusalOf(scene, { op: 'add_wall', a: N.n1, b: N.n5, thickness: 0.1 } as unknown as SceneOp);
    expect(missing.detail).toEqual({ reason: 'invalid_id', field: 'id', id: null, op: 'add_wall' });
    expect(refusalOf(scene, { op: 'add_wall', id: UUID_V4, a: N.n1, b: N.n5, thickness: 0.1 }).detail).toEqual({
      reason: 'invalid_id',
      field: 'id',
      id: UUID_V4,
      op: 'add_wall',
    });
    expect(scene.walls).toHaveLength(lShapePlan.walls.length);
  });
});

describe('set_wall', () => {
  test('edits thickness and role, and reports only what changed', () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'set_wall', wallId: W.wPart, thickness: 0.15, role: 'bearing' }, CATALOGUE_REGISTRIES);
    expect(outcome.summary).toBe(`Wall ${W.wPart}: thickness 0.15 m, role bearing`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
    const wall = scene.walls.find((candidate) => candidate.id === W.wPart)!;
    expect(wall.thickness).toBe(0.15);
    expect(wall.role).toBe('bearing');
  });

  test('clamps the thickness the same way add_wall does', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_wall', wallId: W.wPart, thickness: 3 }, CATALOGUE_REGISTRIES);
    expect(scene.walls.find((candidate) => candidate.id === W.wPart)!.thickness).toBe(WALL_THICKNESS[1]);
  });

  test('arc: null straightens the wall and re-fits its openings on the shorter centreline', () => {
    const scene = draftOf(bayPlan);
    const outcome = applyOp(scene, { op: 'set_wall', wallId: BAY.wall.bay, arc: null }, CATALOGUE_REGISTRIES);
    expect(outcome.summary).toBe(`Wall ${BAY.wall.bay}: arc removed`);
    const wall = scene.walls.find((candidate) => candidate.id === BAY.wall.bay)!;
    expect(wall.arc).toBeUndefined();
    // The semicircle was pi * 2 = 6.28 m long; the chord is 4.00 m.
    const window = openingOf(scene, BAY.opening.windowBay);
    expect(window.center + window.width / 2).toBeLessThanOrEqual(4 - OPENING_EDGE_MARGIN + 1e-9);
  });

  test('rejects an unknown wall, an empty edit and an arc the chord cannot take', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'set_wall', wallId: NEW.ghost, thickness: 0.1 })).toContain('Unknown wall');
    expect(rejectsOp(scene, { op: 'set_wall', wallId: W.wPart })).toContain('at least one');
    expect(rejectsOp(scene, { op: 'set_wall', wallId: W.wSA, arc: { radius: 1, ccw: false } })).toContain('arc');
  });
});

describe('remove_wall', () => {
  test('takes the wall, its openings and the finishes painted on its faces', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_material', target: faceKey(ROOM_A, W.wPart, 'L'), material: FINISH.graphite }, CATALOGUE_REGISTRIES);

    const outcome = applyOp(scene, { op: 'remove_wall', wallId: W.wPart }, CATALOGUE_REGISTRIES);

    expect(outcome.summary).toBe(`Wall ${W.wPart}: removed with opening ${L_SHAPE.opening.doorAb}`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL, touchedOpening(L_SHAPE.opening.doorAb), touchedFace(faceKey(ROOM_A, W.wPart, 'L'))]);
    expect(scene.walls.some((wall) => wall.id === W.wPart)).toBe(false);
    expect(scene.finishes?.faces).toEqual([]);
  });

  test('a wall with no openings says so plainly', () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'remove_wall', wallId: W.wNA }, CATALOGUE_REGISTRIES);
    expect(outcome.summary).toBe(`Wall ${W.wNA}: removed`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
  });

  test('refuses the wall that carries the entrance, as remove_opening does', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'remove_wall', wallId: W.wSA })).toContain('entrance');
    expect(scene.walls.some((wall) => wall.id === W.wSA)).toBe(true);
  });

  test('rejects an unknown wall', () => {
    expect(rejectsOp(opDraft(), { op: 'remove_wall', wallId: NEW.ghost })).toContain('Unknown wall');
  });

  test('forgets every preset instruction naming the removed wall, and a preset left with nothing to do', () => {
    const scene = opDraft();
    const keep: SceneOp = { op: 'set_material', target: ROOM_A, material: FINISH.walnut };
    scene.interiors = [
      {
        id: MERGE.preset,
        name: 'Warm walnut',
        swatch: [FINISH.walnut, FINISH.terra],
        ops: [
          { op: 'set_material', target: faceKey(ROOM_A, W.wPart, 'L'), material: FINISH.terra },
          keep,
          { op: 'set_material', surface: 'wall', face: faceKey(L_SHAPE.room.b, W.wPart, 'R'), material: FINISH.terra },
        ],
      },
      {
        id: MERGE.presetGone,
        name: 'Thin partition',
        swatch: [FINISH.walnut, FINISH.terra],
        ops: [{ op: 'set_wall', wallId: W.wPart, thickness: 0.08 }],
      },
    ];

    applyOp(scene, { op: 'remove_wall', wallId: W.wPart }, CATALOGUE_REGISTRIES);

    expect(scene.interiors).toEqual([{ id: MERGE.preset, name: 'Warm walnut', swatch: [FINISH.walnut, FINISH.terra], ops: [keep] }]);
  });
});

describe('split_wall', () => {
  test('a mid-wall cut makes two edges and one node, lengths summing to the original', () => {
    const scene = opDraft();
    const outcome = applyOp(
      scene,
      { op: 'split_wall', wallId: W.wSB, at: 2, nodeId: NEW.nMid, ids: [NEW.wSBW, NEW.wSBE] },
      CATALOGUE_REGISTRIES,
    );

    expect(outcome.summary).toBe(`Wall ${W.wSB}: split at 2 m into ${NEW.wSBW} (2 m) and ${NEW.wSBE} (2 m)`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
    expect(scene.walls.filter((wall) => wall.id === NEW.wSBW || wall.id === NEW.wSBE)).toHaveLength(2);
    expect(scene.nodes.some((node) => node.id === NEW.nMid)).toBe(true);
    // N.n2 is at (6, 0) and N.n3 at (10, 0): the midpoint is (8, 0), to 1e-9.
    expect(scene.nodes.find((node) => node.id === NEW.nMid)!.p.x).toBeCloseTo(8, 9);
    expect(scene.nodes.find((node) => node.id === NEW.nMid)!.p.z).toBeCloseTo(0, 9);
    const west = scene.walls.find((wall) => wall.id === NEW.wSBW)!;
    const east = scene.walls.find((wall) => wall.id === NEW.wSBE)!;
    expect(west).toMatchObject({ a: N.n2, b: NEW.nMid, thickness: 0.3, role: 'facade' });
    expect(east).toMatchObject({ a: NEW.nMid, b: N.n3, thickness: 0.3, role: 'facade' });
    expect(wallCentrelineLength(scene, west)).toBeCloseTo(2, 9);
    expect(wallCentrelineLength(scene, east)).toBeCloseTo(2, 9);
    // The halves replaced the wall where it stood, so the order stays readable.
    expect(scene.walls.map((wall) => wall.id)).toEqual([W.wSA, NEW.wSBW, NEW.wSBE, W.wE, W.wNB, W.wStep, W.wNA, W.wW, W.wPart]);
  });

  test('openings distribute to their halves: before the cut untouched, after it shifted by at', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'split_wall', wallId: W.wSA, at: 2.5, nodeId: NEW.nSMid, ids: [NEW.wSAW, NEW.wSAE] }, CATALOGUE_REGISTRIES);

    const west = scene.walls.find((wall) => wall.id === NEW.wSAW)!;
    const east = scene.walls.find((wall) => wall.id === NEW.wSAE)!;
    const door = openingOf(scene, L_SHAPE.opening.doorEntry);
    const window = openingOf(scene, L_SHAPE.opening.windowASouth);
    expect(west.openings).toEqual([door]);
    expect(door.center).toBeCloseTo(1.25, 9);
    expect(door.width).toBe(1.0);
    expect(east.openings).toEqual([window]);
    // 4.15 - 2.5 in float arithmetic; the metre is exact, the dust is not.
    expect(window.center).toBeCloseTo(1.65, 9);
    expect(window.width).toBe(2.0);
    expect(window.sill).toBe(0.82);
    expect(window.head).toBe(2.35);
    // The entrance flag, hinge and all other authored fields ride along.
    expect(door.entrance).toBe(true);
  });

  test('a cut through an opening is refused with the two nearest legal at values', () => {
    const scene = opDraft();
    const error = refusalOf(scene, { op: 'split_wall', wallId: W.wPart, at: 2.5, nodeId: NEW.nMid, ids: [NEW.wL, NEW.wR] });
    const detail = splitDetail(error);

    expect(detail['kind']).toBe('split_wall_through_opening');
    expect(detail['openingId']).toBe(L_SHAPE.opening.doorAb);
    // The opening spans 2.05..2.95; the reveal the schema demands widens the
    // blocked zone to 1.95..3.05, and those edges are what the editor gets.
    expect(detail['before']).toBeCloseTo(1.95, 9);
    expect(detail['after']).toBeCloseTo(3.05, 9);
    expect(scene.walls.some((wall) => wall.id === W.wPart)).toBe(true);
    expect(scene.walls).toHaveLength(lShapePlan.walls.length);
  });

  test('a cut exactly at the widened zone edge applies and leaves the opening legal', () => {
    const scene = opDraft();
    const at = 2.5 - 0.9 / 2 - OPENING_EDGE_MARGIN;
    applyOp(scene, { op: 'split_wall', wallId: W.wPart, at, nodeId: NEW.nMid, ids: [NEW.wL, NEW.wR] }, CATALOGUE_REGISTRIES);
    const door = openingOf(scene, L_SHAPE.opening.doorAb);
    const right = scene.walls.find((wall) => wall.id === NEW.wR)!;
    expect(right.openings).toEqual([door]);
    expect(door.center - door.width / 2).toBeGreaterThanOrEqual(OPENING_EDGE_MARGIN);
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('cuts too close to either end are refused with the length; the boundary value itself applies', () => {
    const scene = opDraft();
    const short = refusalOf(scene, {
      op: 'split_wall',
      wallId: W.wPart,
      at: MIN_SPLIT_HALF - 0.01,
      nodeId: NEW.nMid,
      ids: [NEW.wL, NEW.wR],
    });
    expect(splitDetail(short)['kind']).toBe('split_wall_out_of_range');
    expect(splitDetail(short)['length']).toBeCloseTo(5, 9);
    const long = refusalOf(scene, {
      op: 'split_wall',
      wallId: W.wPart,
      at: 5 - MIN_SPLIT_HALF + 0.01,
      nodeId: NEW.nMid,
      ids: [NEW.wL, NEW.wR],
    });
    expect(splitDetail(long)['kind']).toBe('split_wall_out_of_range');

    const boundary = opDraft();
    applyOp(
      boundary,
      { op: 'split_wall', wallId: W.wPart, at: MIN_SPLIT_HALF, nodeId: NEW.nMid, ids: [NEW.wL, NEW.wR] },
      CATALOGUE_REGISTRIES,
    );
    expect(
      wallCentrelineLength(
        boundary,
        boundary.walls.find((wall) => wall.id === NEW.wL)!,
      ),
    ).toBeCloseTo(MIN_SPLIT_HALF, 9);
    // The refusal floor and `validateScene`'s own floor are the SAME constant
    // (`WALL_LIMITS.minCentrelineLength`, re-exported as `MIN_SPLIT_HALF`), so
    // the shortest half the op ever allows is never the shortest half the
    // validator refuses — a legal split cannot apply and then lose its batch
    // at commit (resolved the same way as `MIN_WALL_LENGTH`).
    expect(() => validateScene(boundary, CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('an arc wall is refused outright', () => {
    const scene = draftOf(bayPlan);
    const error = refusalOf(scene, { op: 'split_wall', wallId: BAY.wall.bay, at: 2, nodeId: NEW.bMid, ids: [NEW.bayW, NEW.bayE] });
    expect(splitDetail(error)['kind']).toBe('split_wall_arc_unsupported');
    expect(scene.walls).toHaveLength(bayPlan.walls.length);
  });

  test('a duplicate id — a node, another wall, the wall itself, or the other half — is duplicate_id', () => {
    const scene = opDraft();
    const split = (nodeId: string, ids: readonly [string, string]): OpError =>
      refusalOf(scene, { op: 'split_wall', wallId: W.wPart, at: 1.9, nodeId, ids: [ids[0], ids[1]] });
    expect(split(N.n1, [NEW.wL, NEW.wR]).detail).toEqual({ reason: 'duplicate_id', field: 'nodeId', id: N.n1, op: 'split_wall' });
    expect(split(NEW.nMid, [W.wE, NEW.wR]).detail).toEqual({ reason: 'duplicate_id', field: 'ids[0]', id: W.wE, op: 'split_wall' });
    expect(split(NEW.nMid, [W.wPart, NEW.wR]).detail).toEqual({ reason: 'duplicate_id', field: 'ids[0]', id: W.wPart, op: 'split_wall' });
    expect(split(NEW.nMid, [NEW.wSame, NEW.wSame]).detail).toEqual({
      reason: 'duplicate_id',
      field: 'ids[1]',
      id: NEW.wSame,
      op: 'split_wall',
    });
    // The node and a half may not share one either: the set grows as each is checked.
    expect(split(NEW.nMid, [NEW.wL, NEW.nMid]).detail).toEqual({ reason: 'duplicate_id', field: 'ids[1]', id: NEW.nMid, op: 'split_wall' });
    expect(scene.walls).toHaveLength(lShapePlan.walls.length);
    expect(scene.nodes).toHaveLength(lShapePlan.nodes.length);
  });

  test('a node or half id that is not a UUID v7 is invalid_id', () => {
    const scene = opDraft();
    const split = (nodeId: string, ids: readonly [string, string]): OpError =>
      refusalOf(scene, { op: 'split_wall', wallId: W.wPart, at: 1.9, nodeId, ids: [ids[0], ids[1]] });
    expect(split(UUID_V4, [NEW.wL, NEW.wR]).detail).toEqual({ reason: 'invalid_id', field: 'nodeId', id: UUID_V4, op: 'split_wall' });
    expect(split(NEW.nMid, [UUID_V4, NEW.wR]).detail).toEqual({ reason: 'invalid_id', field: 'ids[0]', id: UUID_V4, op: 'split_wall' });
    expect(split(NEW.nMid, [NEW.wL, 'w-r']).detail).toEqual({ reason: 'invalid_id', field: 'ids[1]', id: 'w-r', op: 'split_wall' });
    expect(scene.walls).toHaveLength(lShapePlan.walls.length);
  });

  test('rejects an unknown wall and a non-finite at', () => {
    expect(rejectsOp(opDraft(), { op: 'split_wall', wallId: NEW.ghost, at: 1, nodeId: NEW.nMid, ids: [NEW.wL, NEW.wR] })).toContain(
      'Unknown wall',
    );
    expect(rejectsOp(opDraft(), { op: 'split_wall', wallId: W.wPart, at: Number.NaN, nodeId: NEW.nMid, ids: [NEW.wL, NEW.wR] })).toContain(
      'finite',
    );
  });

  test('painted faces survive on both halves, in place; primary names the longer half', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_material', target: faceKey(ROOM_A, W.wPart, 'L'), material: FINISH.graphite }, CATALOGUE_REGISTRIES);
    applyOp(scene, { op: 'set_material', target: faceKey(null, W.wW, 'R'), material: FINISH.sage }, CATALOGUE_REGISTRIES);

    const outcome = applyOp(
      scene,
      { op: 'split_wall', wallId: W.wPart, at: 1.9, nodeId: NEW.nMid, ids: [NEW.wL, NEW.wR] },
      CATALOGUE_REGISTRIES,
    );

    // 1.9 vs 3.1: the east half is the longer one, so it carries `primary`.
    expect(outcome.remap).toEqual({
      faces: [
        {
          from: faceKey(ROOM_A, W.wPart, 'L'),
          to: [faceKey(ROOM_A, NEW.wL, 'L'), faceKey(ROOM_A, NEW.wR, 'L')],
          primary: faceKey(ROOM_A, NEW.wR, 'L'),
          status: 'split',
        },
      ],
      created: [],
    });
    expect(outcome.touched).toEqual([
      TOUCHED_SHELL,
      touchedFace(faceKey(ROOM_A, W.wPart, 'L')),
      touchedFace(faceKey(ROOM_A, NEW.wL, 'L')),
      touchedFace(faceKey(ROOM_A, NEW.wR, 'L')),
    ]);
    // Both halves wear what the old wall wore, where its entry stood; the other
    // wall's face is untouched and keeps its place after them.
    expect(scene.finishes?.faces).toEqual([
      { room: ROOM_A, wallId: NEW.wL, side: 'L', finish: FINISH.graphite },
      { room: ROOM_A, wallId: NEW.wR, side: 'L', finish: FINISH.graphite },
      { wallId: W.wW, side: 'R', finish: FINISH.sage },
    ]);
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('a painted face gives the same finish through solvePlan before and after the cut', () => {
    const before = opDraft();
    applyOp(before, { op: 'set_material', target: faceKey(null, W.wSA, 'R'), material: FINISH.graphite }, CATALOGUE_REGISTRIES);
    const beforePlan = solvePlan(before);
    expect(beforePlan.faces.has(faceKey(null, W.wSA, 'R'))).toBe(true);

    applyOp(before, { op: 'split_wall', wallId: W.wSA, at: 2.5, nodeId: NEW.nMid, ids: [NEW.wWHalf, NEW.wEHalf] }, CATALOGUE_REGISTRIES);
    const afterPlan = solvePlan(before);

    expect(afterPlan.faces.has(faceKey(null, W.wSA, 'R'))).toBe(false);
    expect(afterPlan.faces.has(faceKey(null, NEW.wWHalf, 'R'))).toBe(true);
    expect(afterPlan.faces.has(faceKey(null, NEW.wEHalf, 'R'))).toBe(true);
    expect(faceFinishOf(before, faceKey(null, NEW.wWHalf, 'R'))).toBe(FINISH.graphite);
    expect(faceFinishOf(before, faceKey(null, NEW.wEHalf, 'R'))).toBe(FINISH.graphite);
  });

  test('the same document and the same op give a byte-identical result', () => {
    const op: SceneOp = { op: 'split_wall', wallId: W.wPart, at: 1.9, nodeId: NEW.nMid, ids: [NEW.wL, NEW.wR] };
    const one = opDraft();
    const two = opDraft();
    applyOp(one, { op: 'set_material', target: faceKey(ROOM_A, W.wPart, 'L'), material: FINISH.graphite }, CATALOGUE_REGISTRIES);
    applyOp(two, { op: 'set_material', target: faceKey(ROOM_A, W.wPart, 'L'), material: FINISH.graphite }, CATALOGUE_REGISTRIES);
    applyOp(one, op, CATALOGUE_REGISTRIES);
    applyOp(two, op, CATALOGUE_REGISTRIES);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  test('nothing but walls and finish faces references the wall: cameras, navigation and the tour are untouched', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'split_wall', wallId: W.wSB, at: 2, nodeId: NEW.nMid, ids: [NEW.wSBW, NEW.wSBE] }, CATALOGUE_REGISTRIES);

    expect(scene.presentationCamera).toEqual(lShapePlan.presentationCamera);
    expect(scene.roomCameras).toEqual(lShapePlan.roomCameras);
    expect(scene.walkSpawn).toEqual(lShapePlan.walkSpawn);
    // Readonly collections the matcher will not take directly: compared as data.
    expect(JSON.stringify(scene.navigation)).toBe(JSON.stringify(lShapePlan.navigation));
    expect(JSON.stringify(scene.autotour)).toBe(JSON.stringify(lShapePlan.autotour));
    // The old wall id is gone from the document entirely — the only ids that
    // ever named it were its openings (now on the halves) and finish faces
    // (now remapped), so no dangling reference can survive.
    expect(JSON.stringify(scene)).not.toContain(W.wSB);
  });

  test('demo apartment: the door stays on its half, the candidate validates and the lint stays at 0/0', () => {
    const model = new SceneModel(apartmentScene, CATALOGUE_REGISTRIES, { lint: lintLayout });
    const result = model.apply({
      baseRev: model.rev,
      ops: [
        { op: 'split_wall', wallId: DEMO.wall.wallBedroomHall, at: 2.5, nodeId: NEW.nodeSplitMid, ids: [NEW.wallSplitW, NEW.wallSplitE] },
      ],
      lint: 'strict',
    });

    if (!isApplyOk(result)) throw new Error(`expected the split to commit, got ${result.error}: ${result.message}`);
    expect(model.scene.walls.some((wall) => wall.id === NEW.wallSplitW)).toBe(true);
    expect(model.scene.walls.some((wall) => wall.id === NEW.wallSplitE)).toBe(true);
    const door = model.scene.walls
      .find((wall) => wall.id === NEW.wallSplitW)!
      .openings!.find((opening) => opening.id === DEMO.opening.doorBedroom)!;
    expect(door.center).toBeCloseTo(0.7, 9);
    expect(validateScene(model.scene, CATALOGUE_REGISTRIES)).toBe(model.scene);
    expect(describeIssues(lintLayout(model.scene, model.plan))).toBe('0 error(s), 0 warning(s)');
    expect(countIssues(lintLayout(model.scene, model.plan))).toEqual({ errors: 0, warnings: 0, byRule: {} });
  });

  test('demo apartment: a cut through the door is refused with two legal at values', () => {
    const scene = draftOf(apartmentScene);
    const error = refusalOf(scene, {
      op: 'split_wall',
      wallId: DEMO.wall.wallBedroomHall,
      at: 0.7,
      nodeId: NEW.nodeSplitMid,
      ids: [NEW.wallSplitW, NEW.wallSplitE],
    });
    const detail = splitDetail(error);

    expect(detail['kind']).toBe('split_wall_through_opening');
    expect(detail['openingId']).toBe(DEMO.opening.doorBedroom);
    // The bedroom door spans 0.30..1.10; with the 0.1 m reveal the blocked
    // zone is 0.20..1.20 and those are the two cuts the editor is offered.
    expect(detail['before']).toBeCloseTo(0.2, 9);
    expect(detail['after']).toBeCloseTo(1.2, 9);
  });
});

/* ------------------------------------------------------------- merging --- */

/** The structured payload a merge refusal carries (`OpError.detail`). */
function mergeDetail(error: OpError): Record<string, unknown> {
  expect(error.detail?.['op']).toBe('merge_wall');
  return error.detail as Record<string, unknown>;
}

function wallById(scene: Draft<SceneData>, id: string): Draft<Wall> {
  const found = scene.walls.find((wall) => wall.id === id);
  if (!found) throw new Error(`draft has no wall ${id}`);
  return found;
}

/** The L-shape with `wallId` cut at `at` metres into `NEW.wL` (from node `a`) and `NEW.wR`, at node `NEW.nMid`. */
function splitDraft(wallId: string = W.wSA, at = 3): Draft<SceneData> {
  const scene = opDraft();
  applyOp(scene, { op: 'split_wall', wallId, at, nodeId: NEW.nMid, ids: [NEW.wL, NEW.wR] }, CATALOGUE_REGISTRIES);
  return scene;
}

/**
 * Turns a wall round on its own line: `a` and `b` swap, and every opening
 * stays where it stands — its centre is measured from the other end and an
 * explicit hinge names the same jamb by its other node. A swing is left as
 * written; the tests that care set it themselves.
 */
function reverseWall(scene: Draft<SceneData>, wallId: string): void {
  const wall = wallById(scene, wallId);
  const length = wallCentrelineLength(scene, wall);
  [wall.a, wall.b] = [wall.b, wall.a];
  for (const opening of wall.openings ?? []) {
    opening.center = length - opening.center;
    if (opening.hinge !== undefined) opening.hinge = opening.hinge === 'a' ? 'b' : 'a';
  }
}

function merge(wallIds: readonly [string, string], id: string = MERGE.merged): SceneOp {
  return { op: 'merge_wall', wallIds: [wallIds[0], wallIds[1]], id };
}

/** Where a door's leaf hangs and which way it opens, in plan coordinates: what a merge must not move. */
function leafOf(scene: Draft<SceneData>, openingId: string): { pivot: { x: number; z: number }; open: { x: number; z: number } } {
  const wall = scene.walls.find((candidate) => (candidate.openings ?? []).some((opening) => opening.id === openingId))!;
  const swing = resolveDoorSwing(scene, solvePlan(scene), wall, openingOf(scene, openingId), () => 0.05);
  return { pivot: swing.pivot, open: swing.open };
}

function expectSameLeaf(after: ReturnType<typeof leafOf>, before: ReturnType<typeof leafOf>): void {
  expect(after.pivot.x).toBeCloseTo(before.pivot.x, 9);
  expect(after.pivot.z).toBeCloseTo(before.pivot.z, 9);
  expect(after.open.x).toBeCloseTo(before.open.x, 9);
  expect(after.open.z).toBeCloseTo(before.open.z, 9);
}

describe('merge_wall', () => {
  test('undoes a split under the original id: the document is the one the split started from, with the remap', () => {
    const before = opDraft();
    before.finishes = {
      faces: [
        { room: ROOM_A, wallId: W.wSA, side: 'L', finish: FINISH.graphite },
        { wallId: W.wSA, side: 'R', finish: FINISH.sage },
      ],
    };
    const scene = draftOf(before);
    applyOp(scene, { op: 'split_wall', wallId: W.wSA, at: 3, nodeId: NEW.nMid, ids: [NEW.wL, NEW.wR] }, CATALOGUE_REGISTRIES);

    const outcome = applyOp(scene, merge([NEW.wL, NEW.wR], W.wSA), CATALOGUE_REGISTRIES);

    expect(scene).toEqual(before);
    // 3 m and 3 m: a tie, so the primary ancestor is `wallIds[0]`.
    expect(outcome.remap).toEqual({
      faces: [
        { from: faceKey(ROOM_A, NEW.wL, 'L'), to: [faceKey(ROOM_A, W.wSA, 'L')], primary: faceKey(ROOM_A, NEW.wL, 'L'), status: 'merged' },
        { from: faceKey(ROOM_A, NEW.wR, 'L'), to: [faceKey(ROOM_A, W.wSA, 'L')], primary: faceKey(ROOM_A, NEW.wL, 'L'), status: 'merged' },
        { from: faceKey(null, NEW.wL, 'R'), to: [faceKey(null, W.wSA, 'R')], primary: faceKey(null, NEW.wL, 'R'), status: 'merged' },
        { from: faceKey(null, NEW.wR, 'R'), to: [faceKey(null, W.wSA, 'R')], primary: faceKey(null, NEW.wL, 'R'), status: 'merged' },
      ],
      created: [],
    });
    expect(outcome.summary).toBe(`Wall ${W.wSA}: merged from ${NEW.wL} and ${NEW.wR} (6 m)`);
    expect(outcome.touched).toEqual([
      TOUCHED_SHELL,
      touchedFace(faceKey(ROOM_A, NEW.wL, 'L')),
      touchedFace(faceKey(ROOM_A, NEW.wR, 'L')),
      touchedFace(faceKey(null, NEW.wL, 'R')),
      touchedFace(faceKey(null, NEW.wR, 'R')),
      touchedFace(faceKey(ROOM_A, W.wSA, 'L')),
      touchedFace(faceKey(null, W.wSA, 'R')),
    ]);
  });

  test('runs from the first wall’s outer node to the second’s, whichever way each ran, and drops the joint node', () => {
    for (const [first, second] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const scene = splitDraft();
      if (first) reverseWall(scene, NEW.wL);
      if (second) reverseWall(scene, NEW.wR);

      applyOp(scene, merge([NEW.wL, NEW.wR]), CATALOGUE_REGISTRIES);

      const wall = wallById(scene, MERGE.merged);
      expect({ a: wall.a, b: wall.b, thickness: wall.thickness, role: wall.role }).toEqual({
        a: N.n1,
        b: N.n2,
        thickness: 0.3,
        role: 'facade',
      });
      expect(scene.nodes.some((node) => node.id === NEW.nMid)).toBe(false);
      expect(scene.walls.some((candidate) => candidate.id === NEW.wL || candidate.id === NEW.wR)).toBe(false);
      // The entrance door and the window stand where they stood, measured from n1.
      const [door, window] = wall.openings!;
      expect(door!.id).toBe(L_SHAPE.opening.doorEntry);
      expect(door!.center).toBeCloseTo(1.25, 9);
      expect(window!.id).toBe(L_SHAPE.opening.windowASouth);
      expect(window!.center).toBeCloseTo(4.15, 9);
      expect(window!.width).toBe(2.0);
    }
  });

  test('the pair taken the other way round runs the other way, openings re-measured from its start', () => {
    const scene = splitDraft();
    applyOp(scene, merge([NEW.wR, NEW.wL]), CATALOGUE_REGISTRIES);

    const wall = wallById(scene, MERGE.merged);
    expect({ a: wall.a, b: wall.b }).toEqual({ a: N.n2, b: N.n1 });
    // Listed by their new centres: the window (6 - 4.15) now comes first.
    expect(wall.openings!.map((opening) => opening.id)).toEqual([L_SHAPE.opening.windowASouth, L_SHAPE.opening.doorEntry]);
    expect(wall.openings![0]!.center).toBeCloseTo(1.85, 9);
    expect(wall.openings![1]!.center).toBeCloseTo(4.75, 9);
  });

  test('takes the earlier index of the two in the wall list', () => {
    const scene = splitDraft();
    const index = scene.walls.findIndex((wall) => wall.id === NEW.wL);
    applyOp(scene, merge([NEW.wR, NEW.wL]), CATALOGUE_REGISTRIES);
    expect(scene.walls.findIndex((wall) => wall.id === MERGE.merged)).toBe(index);
    expect(scene.walls).toHaveLength(lShapePlan.walls.length);
  });

  test('a reversed exterior wall keeps its explicit hinge on the same jamb and its swing as written', () => {
    const scene = splitDraft(W.wSB, 2);
    reverseWall(scene, NEW.wR);
    // The door stands 0.9 m from n3 on the reversed second half, hinged on the n3 jamb.
    wallById(scene, NEW.wR).openings = [
      { id: MERGE.door, type: 'door', center: 0.9, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'in' },
    ];
    const before = leafOf(scene, MERGE.door);

    applyOp(scene, merge([NEW.wL, NEW.wR]), CATALOGUE_REGISTRIES);

    const door = openingOf(scene, MERGE.door);
    expect(door.center).toBeCloseTo(3.1, 9);
    expect(door.hinge).toBe('b');
    // One side of the wall is the facade, so `in` is the room side whichever way the wall runs.
    expect(door.swing).toBe('in');
    expectSameLeaf(leafOf(scene, MERGE.door), before);
  });

  test('a reversed wall between two rooms flips its explicit swing, so the leaf opens to the same side', () => {
    const scene = splitDraft(W.wPart, 1.5);
    reverseWall(scene, NEW.wR);
    const door = openingOf(scene, L_SHAPE.opening.doorAb);
    door.hinge = 'a';
    door.swing = 'in';
    const before = leafOf(scene, L_SHAPE.opening.doorAb);

    applyOp(scene, merge([NEW.wL, NEW.wR]), CATALOGUE_REGISTRIES);

    const merged = openingOf(scene, L_SHAPE.opening.doorAb);
    expect(merged.center).toBeCloseTo(2.5, 9);
    expect(merged.hinge).toBe('b');
    // With rooms on both sides `in` is the left of a -> b, and the merged wall runs the other way.
    expect(merged.swing).toBe('out');
    expectSameLeaf(leafOf(scene, L_SHAPE.opening.doorAb), before);
  });

  test('an explicit swing on a reversed wall is refused while the plan cannot be solved; without one the merge applies', () => {
    const unresolved = splitDraft(W.wSB, 2);
    reverseWall(unresolved, NEW.wR);
    wallById(unresolved, NEW.wR).openings = [{ id: MERGE.door, type: 'door', center: 0.9, width: 0.8, sill: 0, head: 2.1, swing: 'in' }];
    // Mid-batch the plan may be open: here n4 and n5 lose a wall each.
    unresolved.walls.splice(
      unresolved.walls.findIndex((wall) => wall.id === W.wNB),
      1,
    );
    const snapshot = JSON.stringify(unresolved);

    expect(mergeDetail(refusalOf(unresolved, merge([NEW.wL, NEW.wR])))['kind']).toBe('merge_wall_swing_unresolved');
    expect(JSON.stringify(unresolved)).toBe(snapshot);

    delete openingOf(unresolved, MERGE.door).swing;
    applyOp(unresolved, merge([NEW.wL, NEW.wR]), CATALOGUE_REGISTRIES);
    expect(openingOf(unresolved, MERGE.door).center).toBeCloseTo(3.1, 9);
  });

  test('carries paint per side: left and right through a reversal, the longer ancestor’s finish wins', () => {
    // 5.3 m and 0.7 m: the reversed first half is the primary.
    const scene = splitDraft(W.wSA, 5.3);
    reverseWall(scene, NEW.wL);
    scene.finishes = {
      faces: [
        { room: ROOM_A, wallId: NEW.wL, side: 'R', finish: FINISH.graphite },
        { room: ROOM_A, wallId: NEW.wR, side: 'L', finish: FINISH.sage },
        { wallId: NEW.wL, side: 'L', finish: FINISH.terra },
        { wallId: NEW.wR, side: 'R', finish: FINISH.walnut },
      ],
    };

    applyOp(scene, merge([NEW.wL, NEW.wR]), CATALOGUE_REGISTRIES);

    expect(scene.finishes.faces).toEqual([
      { room: ROOM_A, wallId: MERGE.merged, side: 'L', finish: FINISH.graphite },
      { wallId: MERGE.merged, side: 'R', finish: FINISH.terra },
    ]);
  });

  test('an unpainted primary leaves the merged face without an override', () => {
    const scene = splitDraft(W.wSA, 5.3);
    scene.finishes = { faces: [{ room: ROOM_A, wallId: NEW.wR, side: 'L', finish: FINISH.sage }] };

    const outcome = applyOp(scene, merge([NEW.wL, NEW.wR]), CATALOGUE_REGISTRIES);

    expect(scene.finishes.faces).toEqual([]);
    expect(outcome.remap?.faces).toEqual([
      {
        from: faceKey(ROOM_A, NEW.wR, 'L'),
        to: [faceKey(ROOM_A, MERGE.merged, 'L')],
        primary: faceKey(ROOM_A, NEW.wL, 'L'),
        status: 'merged',
      },
    ]);
  });

  test('forgets every preset instruction naming either wall, and a preset left with nothing to do', () => {
    const scene = splitDraft();
    const keep: SceneOp = { op: 'set_material', target: ROOM_A, material: FINISH.walnut };
    scene.interiors = [
      {
        id: MERGE.preset,
        name: 'Warm walnut',
        swatch: [FINISH.walnut, FINISH.terra],
        ops: [
          { op: 'set_material', target: faceKey(ROOM_A, NEW.wL, 'L'), material: FINISH.terra },
          keep,
          { op: 'set_material', surface: 'facade', face: faceKey(null, NEW.wR, 'R'), material: FINISH.terra },
          { op: 'set_opening', openingId: L_SHAPE.opening.doorAb, wallId: NEW.wR, center: 1 },
        ],
      },
      {
        id: MERGE.presetGone,
        name: 'Thick',
        swatch: [FINISH.walnut, FINISH.terra],
        ops: [{ op: 'set_wall', wallId: NEW.wL, thickness: 0.35 }],
      },
    ];

    applyOp(scene, merge([NEW.wL, NEW.wR]), CATALOGUE_REGISTRIES);

    expect(scene.interiors).toEqual([{ id: MERGE.preset, name: 'Warm walnut', swatch: [FINISH.walnut, FINISH.terra], ops: [keep] }]);
  });

  test('every refusal names its kind and leaves the plan exactly as it was', () => {
    const cases: { name: string; scene: () => Draft<SceneData>; op: SceneOp; kind: string; field?: string }[] = [
      { name: 'same wall', scene: opDraft, op: merge([W.wSA, W.wSA]), kind: 'merge_wall_same_wall' },
      { name: 'unknown wall', scene: opDraft, op: merge([W.wSA, NEW.ghost]), kind: 'merge_wall_unknown_wall' },
      { name: 'not adjacent', scene: opDraft, op: merge([W.wSA, W.wE]), kind: 'merge_wall_not_adjacent' },
      // n2 also carries the partition: a T-junction.
      { name: 'junction', scene: opDraft, op: merge([W.wSA, W.wSB]), kind: 'merge_wall_junction' },
      // n1 is a corner of the plan.
      { name: 'corner', scene: opDraft, op: merge([W.wW, W.wSA]), kind: 'merge_wall_not_collinear' },
      {
        name: 'folded back',
        scene: () => {
          const scene = withoutPartition();
          // n3 pulled back onto wSA's line: the joint n2 is on the line but outside n1..n3.
          scene.nodes.find((node) => node.id === N.n3)!.p = { x: 2, z: 0 };
          return scene;
        },
        op: merge([W.wSA, W.wSB]),
        kind: 'merge_wall_not_between',
      },
      { name: 'arc', scene: () => draftOf(bayPlan), op: merge([BAY.wall.bay, BAY.wall.bayE]), kind: 'merge_wall_arc_unsupported' },
      {
        name: 'thickness',
        scene: () => {
          const scene = withoutPartition();
          wallById(scene, W.wSB).thickness = 0.2;
          return scene;
        },
        op: merge([W.wSA, W.wSB]),
        kind: 'merge_wall_mismatch',
        field: 'thickness',
      },
      {
        name: 'role',
        scene: () => {
          const scene = withoutPartition();
          wallById(scene, W.wSB).role = 'bearing';
          return scene;
        },
        op: merge([W.wSA, W.wSB]),
        kind: 'merge_wall_mismatch',
        field: 'role',
      },
    ];
    for (const entry of cases) {
      const scene = entry.scene();
      const snapshot = JSON.stringify(scene);
      const detail = mergeDetail(refusalOf(scene, entry.op));
      expect({ name: entry.name, kind: detail['kind'], field: detail['field'] }).toEqual({
        name: entry.name,
        kind: entry.kind,
        field: entry.field,
      });
      expect(JSON.stringify(scene)).toBe(snapshot);
    }
  });

  test('the new id is checked like every caller-minted id; one of the two source walls is duplicate_id', () => {
    const refuse = (id: string): unknown => {
      const scene = splitDraft();
      const snapshot = JSON.stringify(scene);
      const error = refusalOf(scene, merge([NEW.wL, NEW.wR], id));
      expect(JSON.stringify(scene)).toBe(snapshot);
      return error.detail;
    };
    expect(refuse(UUID_V4)).toEqual({ reason: 'invalid_id', field: 'id', id: UUID_V4, op: 'merge_wall' });
    expect(refuse(W.wE)).toEqual({ reason: 'duplicate_id', field: 'id', id: W.wE, op: 'merge_wall' });
    expect(refuse(NEW.wL)).toEqual({ reason: 'duplicate_id', field: 'id', id: NEW.wL, op: 'merge_wall' });
    expect(refuse(NEW.wR)).toEqual({ reason: 'duplicate_id', field: 'id', id: NEW.wR, op: 'merge_wall' });
    expect(refuse(NEW.nMid)).toEqual({ reason: 'duplicate_id', field: 'id', id: NEW.nMid, op: 'merge_wall' });
  });
});

/** The L-shape with its partition gone, so n2 and n5 carry two walls each. */
function withoutPartition(): Draft<SceneData> {
  const scene = opDraft();
  applyOp(scene, { op: 'remove_wall', wallId: W.wPart }, CATALOGUE_REGISTRIES);
  return scene;
}
