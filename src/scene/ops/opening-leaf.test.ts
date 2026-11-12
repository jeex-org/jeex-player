/**
 * A door's hinge and swing through the opening operations: `add_opening`
 * stores them, `set_opening` sets them and with `null` hands them back to the
 * derivation, only a door may carry them, and an explicit hinge keeps its jamb
 * where the derived one would jump (a slide past the middle of the wall, a
 * merge that turns the wall round).
 */

import { describe, expect, test } from 'bun:test';
import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { opDraft, openingOf, rejectsOp } from '../../fixtures/op-drafts.js';
import { L_SHAPE } from '../../fixtures/plan-l-shape-ids.js';
import { lShapePlan } from '../../fixtures/plan-l-shape.js';
import { resolveDoorSwing, type DoorSwing } from '../../plan/door-swing.js';
import { solvePlan } from '../../plan/plan-solver.js';
import type { Draft } from '../../shared/committed.js';
import { SceneModel, isApplyOk } from '../scene-model.js';
import { applyOp } from '../scene-ops.js';
import type { SceneData, SceneOp } from '../types.js';
import { sceneOpsIssues } from '../types.schema.js';

/** Ids these tests mint, offline like every fixture id. */
const NEW = {
  door: '01a1f7a0-5b10-7c00-8a00-000000000001',
  window: '01a1f7a0-5b10-7c00-8a00-000000000002',
  node: '01a1f7a0-5b10-7c00-8a00-000000000003',
  left: '01a1f7a0-5b10-7c00-8a00-000000000004',
  right: '01a1f7a0-5b10-7c00-8a00-000000000005',
} as const;

const ENTRY = L_SHAPE.opening.doorEntry;

/** The door's resolved leaf on the plan the scene solves to, with no frame rebate. */
function leafOf(data: SceneData, openingId: string): DoorSwing {
  const wall = data.walls.find((candidate) => (candidate.openings ?? []).some((opening) => opening.id === openingId))!;
  const opening = wall.openings!.find((candidate) => candidate.id === openingId)!;
  return resolveDoorSwing(data, solvePlan(data), wall, opening, () => 0);
}

function apply(scene: Draft<SceneData>, op: SceneOp): string {
  return applyOp(scene, op, CATALOGUE_REGISTRIES).summary;
}

describe('add_opening carries a hinge and a swing', () => {
  test('a door added with hinge a and swing out stores both', () => {
    const scene = opDraft();
    apply(scene, {
      op: 'add_opening',
      id: NEW.door,
      wallId: L_SHAPE.wall.wNA,
      type: 'door',
      center: 3,
      width: 0.9,
      hinge: 'a',
      swing: 'out',
    });
    expect(openingOf(scene, NEW.door)).toMatchObject({ hinge: 'a', swing: 'out' });
  });

  test('without them the door is added with neither, as before', () => {
    const scene = opDraft();
    apply(scene, { op: 'add_opening', id: NEW.door, wallId: L_SHAPE.wall.wNA, type: 'door', center: 3, width: 0.9 });
    const door = openingOf(scene, NEW.door);
    expect('hinge' in door).toBe(false);
    expect('swing' in door).toBe(false);
  });

  test('a window or a passage added with a hinge or a swing is refused, as the document refuses one', () => {
    const scene = opDraft();
    const window = { op: 'add_opening', id: NEW.window, wallId: L_SHAPE.wall.wNA, type: 'window', center: 3, width: 1.2 } as const;
    expect(rejectsOp(scene, { ...window, hinge: 'a' })).toContain('is a window and cannot carry a hinge');
    expect(rejectsOp(scene, { ...window, swing: 'in' })).toContain('is a window and cannot carry a swing');
    expect(rejectsOp(scene, { ...window, type: 'passage', hinge: 'b' })).toContain('is a passage and cannot carry a hinge');
    expect(scene.walls.some((wall) => (wall.openings ?? []).some((opening) => opening.id === NEW.window))).toBe(false);
  });
});

describe('set_opening sets and clears a hinge and a swing', () => {
  test('hinge b is written, null removes it and the derived jamb returns', () => {
    const scene = opDraft();
    // At 1.25 m on a 6 m wall the derived hinge is the jamb farther from node a's end: b.
    expect(leafOf(scene, ENTRY).hinge).toBe('b');
    apply(scene, { op: 'set_opening', openingId: ENTRY, hinge: 'a' });
    expect(openingOf(scene, ENTRY).hinge).toBe('a');
    expect(leafOf(scene, ENTRY).hinge).toBe('a');

    apply(scene, { op: 'set_opening', openingId: ENTRY, hinge: 'b' });
    expect(openingOf(scene, ENTRY).hinge).toBe('b');

    apply(scene, { op: 'set_opening', openingId: ENTRY, hinge: null });
    expect('hinge' in openingOf(scene, ENTRY)).toBe(false);
    expect(leafOf(scene, ENTRY).hinge).toBe('b');
  });

  test('swing out is written and null hands the side back to the derivation', () => {
    const scene = opDraft();
    const derived = leafOf(scene, ENTRY).swing;
    const other = derived === 'in' ? 'out' : 'in';
    apply(scene, { op: 'set_opening', openingId: ENTRY, swing: other });
    expect(openingOf(scene, ENTRY).swing).toBe(other);
    expect(leafOf(scene, ENTRY).swing).toBe(other);
    apply(scene, { op: 'set_opening', openingId: ENTRY, swing: null });
    expect('swing' in openingOf(scene, ENTRY)).toBe(false);
    expect(leafOf(scene, ENTRY).swing).toBe(derived);
  });

  test('null on a door with no explicit value is accepted and changes nothing', () => {
    const scene = opDraft();
    // A bare edit first: it settles the door's omitted sill, which every set_opening does.
    apply(scene, { op: 'set_opening', openingId: ENTRY });
    const before = JSON.stringify(scene);
    apply(scene, { op: 'set_opening', openingId: ENTRY, hinge: null, swing: null });
    expect(JSON.stringify(scene)).toBe(before);
  });

  test('the summary names the hinge and the swing it wrote', () => {
    const scene = opDraft();
    const summary = apply(scene, { op: 'set_opening', openingId: ENTRY, hinge: 'a', swing: 'out' });
    expect(summary).toContain('hinge a');
    expect(summary).toContain('swing out');
    expect(apply(scene, { op: 'set_opening', openingId: ENTRY, hinge: null })).toContain('hinge derived');
  });

  test('a hinge or a swing set on a window is refused and the window is left as it was; null is accepted', () => {
    const scene = opDraft();
    const before = JSON.stringify(openingOf(scene, L_SHAPE.opening.windowASouth));
    expect(rejectsOp(scene, { op: 'set_opening', openingId: L_SHAPE.opening.windowASouth, center: 4, hinge: 'a' })).toContain(
      'is a window and cannot carry a hinge',
    );
    expect(rejectsOp(scene, { op: 'set_opening', openingId: L_SHAPE.opening.windowASouth, swing: 'out' })).toContain(
      'is a window and cannot carry a swing',
    );
    expect(JSON.stringify(openingOf(scene, L_SHAPE.opening.windowASouth))).toBe(before);
    apply(scene, { op: 'set_opening', openingId: L_SHAPE.opening.windowASouth, hinge: null, swing: null });
    expect(JSON.stringify(openingOf(scene, L_SHAPE.opening.windowASouth))).toBe(before);
  });
});

describe('an explicit hinge keeps its jamb', () => {
  test('slid past the middle of its wall, a door with an explicit hinge keeps the jamb a derived one would leave', () => {
    const derived = opDraft();
    apply(derived, { op: 'set_opening', openingId: ENTRY, center: 4.75 });
    // Without an explicit hinge the leaf jumps to the other jamb.
    expect(leafOf(derived, ENTRY).hinge).toBe('a');

    const scene = opDraft();
    apply(scene, { op: 'set_opening', openingId: ENTRY, hinge: 'b' });
    apply(scene, { op: 'set_opening', openingId: ENTRY, center: 4.75 });
    const leaf = leafOf(scene, ENTRY);
    expect(leaf.hinge).toBe('b');
    // The pivot is the jamb towards node b: centre plus half the width, along +x from n1.
    expect(leaf.pivot.x).toBeCloseTo(4.75 + 0.5, 9);
    expect(leaf.pivot.z).toBeCloseTo(0, 9);
  });

  test('set in the same batch as a split and a merge that turns the wall round, the hinge stays on the same physical jamb', () => {
    const model = SceneModel.load(lShapePlan, CATALOGUE_REGISTRIES);
    const result = model.apply({
      baseRev: model.rev,
      ops: [
        { op: 'split_wall', wallId: L_SHAPE.wall.wSA, at: 3, nodeId: NEW.node, ids: [NEW.left, NEW.right] },
        { op: 'set_opening', openingId: ENTRY, hinge: 'a' },
        // The pair taken the other way round: the merged wall runs n2 -> n1.
        { op: 'merge_wall', wallIds: [NEW.right, NEW.left], id: L_SHAPE.wall.wSA },
      ],
    });
    expect(isApplyOk(result)).toBe(true);
    const merged = model.scene.walls.find((wall) => wall.id === L_SHAPE.wall.wSA)!;
    expect({ a: merged.a, b: merged.b }).toEqual({ a: L_SHAPE.node.n2, b: L_SHAPE.node.n1 });
    expect(openingOf(model.scene as Draft<SceneData>, ENTRY).hinge).toBe('b');
    // Hinged on the jamb towards n1 before and after: 1.25 - 0.5 from n1.
    const leaf = leafOf(model.scene, ENTRY);
    expect(leaf.pivot.x).toBeCloseTo(0.75, 9);
    expect(leaf.pivot.z).toBeCloseTo(0, 9);
  });
});

describe('a swing set in a batch is carried by the later operations of that batch', () => {
  test('set between a split and a merge that turns the partition round, the word turns and the leaf keeps its side', () => {
    const split: SceneOp = { op: 'split_wall', wallId: L_SHAPE.wall.wPart, at: 1.5, nodeId: NEW.node, ids: [NEW.left, NEW.right] };
    const set: SceneOp = { op: 'set_opening', openingId: L_SHAPE.opening.doorAb, swing: 'in' };
    // The leaf right after the set_opening: the reference the rest of the batch keeps.
    const midway = opDraft();
    apply(midway, split);
    apply(midway, set);
    const wasLeaf = leafOf(midway, L_SHAPE.opening.doorAb);
    expect<string[]>([L_SHAPE.room.a, L_SHAPE.room.b]).toContain(wasLeaf.roomId!);

    const model = SceneModel.load(lShapePlan, CATALOGUE_REGISTRIES);
    const result = model.apply({
      baseRev: model.rev,
      ops: [split, set, { op: 'merge_wall', wallIds: [NEW.right, NEW.left], id: L_SHAPE.wall.wPart }],
    });
    expect(isApplyOk(result)).toBe(true);
    const merged = model.scene.walls.find((wall) => wall.id === L_SHAPE.wall.wPart)!;
    expect({ a: merged.a, b: merged.b }).toEqual({ a: L_SHAPE.node.n5, b: L_SHAPE.node.n2 });
    expect(openingOf(model.scene as Draft<SceneData>, L_SHAPE.opening.doorAb).swing).toBe('out');
    expect(leafOf(model.scene, L_SHAPE.opening.doorAb).roomId).toBe(wasLeaf.roomId);
  });
});

describe('the op schema', () => {
  test('accepts the hinge and swing words and null on set_opening, and only the words on add_opening', () => {
    expect(sceneOpsIssues([{ op: 'set_opening', openingId: ENTRY, hinge: 'a', swing: 'in' }])).toEqual([]);
    expect(sceneOpsIssues([{ op: 'set_opening', openingId: ENTRY, hinge: null, swing: null }])).toEqual([]);
    expect(
      sceneOpsIssues([
        { op: 'add_opening', id: NEW.door, wallId: L_SHAPE.wall.wNA, type: 'door', center: 3, width: 0.9, hinge: 'b', swing: 'out' },
      ]),
    ).toEqual([]);
  });

  test('refuses an unknown hinge or swing, and null on add_opening', () => {
    expect(sceneOpsIssues([{ op: 'set_opening', openingId: ENTRY, hinge: 'left' }]).length).toBeGreaterThan(0);
    expect(sceneOpsIssues([{ op: 'set_opening', openingId: ENTRY, swing: 'both' }]).length).toBeGreaterThan(0);
    const add = { op: 'add_opening', id: NEW.door, wallId: L_SHAPE.wall.wNA, type: 'door', center: 3, width: 0.9 };
    expect(sceneOpsIssues([{ ...add, hinge: 'c' }]).length).toBeGreaterThan(0);
    expect(sceneOpsIssues([{ ...add, hinge: null }]).length).toBeGreaterThan(0);
    expect(sceneOpsIssues([{ ...add, swing: null }]).length).toBeGreaterThan(0);
  });
});
