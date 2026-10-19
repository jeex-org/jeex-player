/**
 * The four opening operations: the variant swap, the geometry edit (absolute
 * and delta), the add with its clamp and the caller's id, and the removal.
 *
 * Moved here verbatim from `scene-ops.test.ts` when the appliers were split out
 * of it; `scene-ops.test.ts`'s vocabulary snapshot proves the move changed no
 * summary and no touched id.
 */

import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { describe, expect, test } from 'bun:test';
import { opDraft, openingOf, rejectsOp } from '../../fixtures/op-drafts.js';
import { CEILING_OPENING_MARGIN, OPENING_EDGE_MARGIN, effectiveOpening } from '../../plan/plan-openings.js';
import { TOUCHED_SHELL, applyOp, touchedOpening, wallCentrelineLength } from '../scene-ops.js';
import type { Draft } from '../../shared/committed.js';
import type { SceneData, SceneOp, Wall } from '../types.js';
import { L_SHAPE } from '../../fixtures/plan-l-shape-ids.js';
import { OPENING_VARIANT } from '../../assets/catalogue-ids.js';
import { OpError } from './context.js';

/** Ids of the openings these tests create, minted offline like every fixture id. */
const NEW = {
  window: '01a12ff3-0a3f-7500-a4d0-f2ff986c807b',
  passage: '01a12ff3-0a40-7d74-9e8f-0182b9e30b33',
  door: '01a12ff3-0a41-70a5-8b63-d7209288462b',
} as const;

/** A well-formed UUID of version 4: the right shape, the wrong version. */
const UUID_V4 = '3b241101-e2bb-4255-8caf-4136c566a962';

/** The wall with that id; throws rather than letting a typo read as an empty wall. */
function wallOf(scene: Draft<SceneData>, id: string): Draft<Wall> {
  const wall = scene.walls.find((candidate) => candidate.id === id);
  if (!wall) throw new Error(`fixture has no wall ${id}`);
  return wall;
}

describe('replace_opening_variant', () => {
  test('writes the variant of the matching family', () => {
    const scene = opDraft();
    const outcome = applyOp(
      scene,
      { op: 'replace_opening_variant', openingId: L_SHAPE.opening.windowASouth, variant: OPENING_VARIANT.window_oak_vertical },
      CATALOGUE_REGISTRIES,
    );
    expect(openingOf(scene, L_SHAPE.opening.windowASouth).variant).toBe(OPENING_VARIANT.window_oak_vertical);
    expect(outcome.touched).toEqual([touchedOpening(L_SHAPE.opening.windowASouth)]);
  });

  test('rejects a door variant on a window and an unknown variant', () => {
    const scene = opDraft();
    expect(
      rejectsOp(scene, {
        op: 'replace_opening_variant',
        openingId: L_SHAPE.opening.windowASouth,
        variant: OPENING_VARIANT.door_oak_panelled_knob,
      }),
    ).toContain('built for a door');
    expect(rejectsOp(scene, { op: 'replace_opening_variant', openingId: L_SHAPE.opening.windowASouth, variant: 'nope' })).toContain(
      'Unknown opening variant',
    );
  });
});

describe('set_opening', () => {
  test('absolute values move the opening', () => {
    const scene = opDraft();
    applyOp(
      scene,
      { op: 'set_opening', openingId: L_SHAPE.opening.windowASouth, center: 3.5, width: 1.2, sill: 1, head: 2.2 },
      CATALOGUE_REGISTRIES,
    );
    const window = openingOf(scene, L_SHAPE.opening.windowASouth);
    expect(window.center).toBeCloseTo(3.5, 6);
    expect(window.width).toBeCloseTo(1.2, 6);
    expect(window.sill).toBeCloseTo(1, 6);
    expect(window.head).toBeCloseTo(2.2, 6);
  });

  test('deltas apply on top of the current geometry', () => {
    const scene = opDraft();
    const before = { ...openingOf(scene, L_SHAPE.opening.windowASouth) };
    applyOp(scene, { op: 'set_opening', openingId: L_SHAPE.opening.windowASouth, dcenter: -0.5, dwidth: 0.2 }, CATALOGUE_REGISTRIES);
    const after = openingOf(scene, L_SHAPE.opening.windowASouth);
    expect(after.center).toBeCloseTo(before.center - 0.5, 6);
    expect(after.width).toBeCloseTo(before.width + 0.2, 6);
  });

  test('a request past the end of the wall is clamped, not refused', () => {
    const scene = opDraft();
    const wall = scene.walls.find((candidate) => candidate.id === L_SHAPE.wall.wE)!;
    const length = wallCentrelineLength(scene, wall);
    applyOp(
      scene,
      { op: 'set_opening', openingId: L_SHAPE.opening.windowBEast, center: 99, width: 99, head: 99, sill: -5 },
      CATALOGUE_REGISTRIES,
    );
    const window = openingOf(scene, L_SHAPE.opening.windowBEast);
    expect(window.width).toBeCloseTo(length - 2 * OPENING_EDGE_MARGIN, 6);
    expect(window.center - window.width / 2).toBeGreaterThanOrEqual(OPENING_EDGE_MARGIN - 1e-9);
    expect(window.center + window.width / 2).toBeLessThanOrEqual(length - OPENING_EDGE_MARGIN + 1e-9);
    expect(window.head).toBeCloseTo(scene.ceilingHeight - CEILING_OPENING_MARGIN, 6);
    expect(window.sill).toBe(0);
  });

  test('a door keeps its sill on the floor whatever is asked', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_opening', openingId: L_SHAPE.opening.doorEntry, sill: 1.2 }, CATALOGUE_REGISTRIES);
    expect(openingOf(scene, L_SHAPE.opening.doorEntry).sill).toBeUndefined();
  });

  test('rejects an unknown opening and a non-finite request', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'set_opening', openingId: NEW.door, center: 1 })).toContain('Unknown opening');
    expect(rejectsOp(scene, { op: 'set_opening', openingId: L_SHAPE.opening.doorEntry, width: Number.NaN })).toContain('non-finite');
  });
});

describe('add_opening and remove_opening', () => {
  test('adds a clamped opening under the id the caller minted', () => {
    const scene = opDraft();
    const outcome = applyOp(
      scene,
      { op: 'add_opening', wallId: L_SHAPE.wall.wW, type: 'window', center: 4, width: 1.2, id: NEW.window },
      CATALOGUE_REGISTRIES,
    );
    expect(outcome.summary).toBe(`Added window ${NEW.window} to wall ${L_SHAPE.wall.wW}`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
    const added = openingOf(scene, NEW.window);
    expect(added.type).toBe('window');
    expect(added.width).toBeCloseTo(1.2, 6);
    // A default head stays omitted in the document and is read through the
    // one projection, so a later width edit cannot materialise it.
    expect(added.head).toBeUndefined();
    expect(effectiveOpening(added, scene.ceilingHeight).head).toBeCloseTo(2.2, 6);
  });

  test('a passage is added without a sill and keeps its type', () => {
    const scene = opDraft();
    applyOp(
      scene,
      { op: 'add_opening', wallId: L_SHAPE.wall.wNA, type: 'passage', center: 3, width: 1.9, id: NEW.passage },
      CATALOGUE_REGISTRIES,
    );
    const passage = openingOf(scene, NEW.passage);
    expect(passage.type).toBe('passage');
    expect(passage.sill).toBeUndefined();
    expect(passage.head).toBeUndefined();
    expect(effectiveOpening(passage, scene.ceilingHeight).head).toBeCloseTo(2.1, 6);
  });

  test('removes an opening from its wall', () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'remove_opening', openingId: L_SHAPE.opening.doorAb }, CATALOGUE_REGISTRIES);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
    expect(scene.walls.find((wall) => wall.id === L_SHAPE.wall.wPart)!.openings).toEqual([]);
  });

  test('rejects an unknown wall and an unknown removal', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'add_opening', wallId: NEW.door, type: 'door', center: 1, width: 1, id: NEW.window })).toContain(
      'Unknown wall',
    );
    expect(rejectsOp(scene, { op: 'remove_opening', openingId: NEW.door })).toContain('Unknown opening');
  });

  /** The `OpError` an `add_opening` with this id raises, or a test failure. */
  function idRefusal(id: unknown): OpError {
    const op = { op: 'add_opening', wallId: L_SHAPE.wall.wW, type: 'door', center: 1, width: 1, id } as unknown as SceneOp;
    try {
      applyOp(opDraft(), op, CATALOGUE_REGISTRIES);
    } catch (error) {
      if (error instanceof OpError) return error;
      throw error;
    }
    throw new Error('add_opening was expected to refuse its id');
  }

  test('a missing id or one that is not a UUID v7 is invalid_id: the viewer mints none', () => {
    expect(idRefusal(undefined).detail).toEqual({ reason: 'invalid_id', field: 'id', id: null, op: 'add_opening' });
    expect(idRefusal(UUID_V4).detail).toEqual({ reason: 'invalid_id', field: 'id', id: UUID_V4, op: 'add_opening' });
  });

  test('an id any entity of the scene already carries is duplicate_id', () => {
    // A room's UUID, not an opening's: one claimed set across every kind.
    expect(idRefusal(L_SHAPE.room.a).detail).toEqual({ reason: 'duplicate_id', field: 'id', id: L_SHAPE.room.a, op: 'add_opening' });
    expect(idRefusal(L_SHAPE.opening.doorAb).message).toContain('already taken');
  });
});

describe('set_opening onto another wall', () => {
  test('moves the opening to the named wall at the absolute centre it was given', () => {
    const scene = opDraft();
    const outcome = applyOp(
      scene,
      { op: 'set_opening', openingId: L_SHAPE.opening.windowASouth, wallId: L_SHAPE.wall.wSB, center: 2 },
      CATALOGUE_REGISTRIES,
    );

    expect(outcome.summary).toBe(
      `Opening ${L_SHAPE.opening.windowASouth} moved to wall ${L_SHAPE.wall.wSB} and set to centre 2 m, width 2 m, sill 0.82 m, head 2.35 m`,
    );
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
    expect(wallOf(scene, L_SHAPE.wall.wSA).openings!.map((opening) => opening.id)).toEqual([L_SHAPE.opening.doorEntry]);
    expect(wallOf(scene, L_SHAPE.wall.wSB).openings!.map((opening) => opening.id)).toEqual([L_SHAPE.opening.windowASouth]);
    expect(openingOf(scene, L_SHAPE.opening.windowASouth).center).toBe(2);
  });

  test('the new wall clamps the opening exactly as add_opening would', () => {
    const scene = opDraft();
    // `L_SHAPE.wall.wSB` is 4.00 m long; a 2.00 m window cannot have its centre at 3.90.
    applyOp(
      scene,
      { op: 'set_opening', openingId: L_SHAPE.opening.windowASouth, wallId: L_SHAPE.wall.wSB, center: 3.9 },
      CATALOGUE_REGISTRIES,
    );
    const moved = openingOf(scene, L_SHAPE.opening.windowASouth);
    expect(moved.center).toBeCloseTo(4 - OPENING_EDGE_MARGIN - moved.width / 2, 9);
  });

  test('a move onto an occupied stretch of the target wall is refused here, not at commit', () => {
    // `windowBEast` already spans 1.70..3.30 of the 5.00 m `wE`; the 2.00 m
    // `windowASouth` cannot land anywhere on that wall beside it. Before the
    // fit check moved into the applier the batch applied and then died at
    // `validateScene` with `openings-overlap`, one layer away from the operation
    // that caused it.
    const scene = opDraft();

    const message = rejectsOp(scene, { op: 'set_opening', openingId: L_SHAPE.opening.windowASouth, wallId: L_SHAPE.wall.wE, center: 2.5 });

    expect(message).toContain(L_SHAPE.opening.windowBEast);
    expect(message).toContain(L_SHAPE.wall.wE);
    expect(wallOf(scene, L_SHAPE.wall.wSA).openings!.map((opening) => opening.id)).toEqual([
      L_SHAPE.opening.doorEntry,
      L_SHAPE.opening.windowASouth,
    ]);
    expect(wallOf(scene, L_SHAPE.wall.wE).openings!.map((opening) => opening.id)).toEqual([L_SHAPE.opening.windowBEast]);
  });

  test('add_opening runs the same check, so the two paths cannot disagree', () => {
    const scene = opDraft();

    expect(rejectsOp(scene, { op: 'add_opening', wallId: L_SHAPE.wall.wE, type: 'door', center: 2.5, width: 0.9, id: NEW.door })).toContain(
      L_SHAPE.opening.windowBEast,
    );
    // Touching ends is not overlapping: an opening may start exactly where its
    // neighbour ends.
    applyOp(
      scene,
      { op: 'add_opening', wallId: L_SHAPE.wall.wE, type: 'door', center: 1.3, width: 0.8, id: NEW.door },
      CATALOGUE_REGISTRIES,
    );
    expect(openingOf(scene, NEW.door).center).toBeCloseTo(1.3, 9);
  });

  test('naming the wall it already hangs on is an edit, not a move', () => {
    const scene = opDraft();
    const outcome = applyOp(
      scene,
      { op: 'set_opening', openingId: L_SHAPE.opening.doorAb, wallId: L_SHAPE.wall.wPart, dcenter: 0.1 },
      CATALOGUE_REGISTRIES,
    );
    expect(outcome.summary).toContain('set to centre 2.6 m');
    expect(wallOf(scene, L_SHAPE.wall.wPart).openings!.map((opening) => opening.id)).toEqual([L_SHAPE.opening.doorAb]);
  });

  test('a move insists on an absolute centre and refuses a delta', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'set_opening', openingId: L_SHAPE.opening.doorAb, wallId: L_SHAPE.wall.wE })).toContain(
      'absolute center',
    );
    expect(rejectsOp(scene, { op: 'set_opening', openingId: L_SHAPE.opening.doorAb, wallId: L_SHAPE.wall.wE, dcenter: 0.5 })).toContain(
      'not dcenter',
    );
    expect(rejectsOp(scene, { op: 'set_opening', openingId: L_SHAPE.opening.doorAb, wallId: NEW.door, center: 1 })).toContain(
      `Unknown wall ${NEW.door}`,
    );
    expect(wallOf(scene, L_SHAPE.wall.wPart).openings!.map((opening) => opening.id)).toEqual([L_SHAPE.opening.doorAb]);
  });
});
