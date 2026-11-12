/**
 * `doorLeaf`: the hinge and swing a door shows, explicit or derived, read off
 * the same `resolveDoorSwing` the plan drawing and the 3D leaf use.
 */

import { describe, expect, test } from 'bun:test';
import { openingFrameWidth } from '../assets/opening-frame.js';
import { opDraft } from '../fixtures/op-drafts.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { doorSwings } from '../plan/door-swing.js';
import { solvePlan } from '../plan/plan-solver.js';
import { applyOp } from '../scene/scene-ops.js';
import { doorLeaf } from './door-leaf.js';

const ENTRY = L_SHAPE.opening.doorEntry;

describe('doorLeaf', () => {
  test('a door with no explicit hinge or swing answers the derived jamb and side', () => {
    // At 1.25 m on a 6 m wall the derived hinge is the jamb farther from node a's end: b.
    // The entrance sits in an exterior wall, so it opens into its only room.
    expect(doorLeaf(lShapePlan, ENTRY)).toEqual({ hinge: 'b', swing: 'in', explicit: { hinge: false, swing: false } });
  });

  test('explicit values are answered as the document carries them', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_opening', openingId: ENTRY, hinge: 'a', swing: 'out' }, CATALOGUE_REGISTRIES);
    expect(doorLeaf(scene, ENTRY)).toEqual({ hinge: 'a', swing: 'out', explicit: { hinge: true, swing: true } });

    applyOp(scene, { op: 'set_opening', openingId: ENTRY, swing: null }, CATALOGUE_REGISTRIES);
    expect(doorLeaf(scene, ENTRY)).toEqual({ hinge: 'a', swing: 'in', explicit: { hinge: true, swing: false } });
  });

  test('the derived hinge changes jamb when the door slides past the middle of its wall', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_opening', openingId: ENTRY, center: 4.75 }, CATALOGUE_REGISTRIES);
    expect(doorLeaf(scene, ENTRY)?.hinge).toBe('a');
  });

  test('a window or an unknown id answers null', () => {
    expect(doorLeaf(lShapePlan, L_SHAPE.opening.windowASouth)).toBeNull();
    expect(doorLeaf(lShapePlan, '01a1f7a0-5b10-7c00-8a00-0000000000ff')).toBeNull();
  });

  test('a solved plan handed in answers what the drawing resolves for every door', () => {
    const plan = solvePlan(lShapePlan);
    const drawn = doorSwings(lShapePlan, plan, openingFrameWidth);
    expect(drawn.length).toBeGreaterThan(1);
    for (const swing of drawn) {
      const leaf = doorLeaf(lShapePlan, swing.openingId, plan);
      expect(leaf && { hinge: leaf.hinge, swing: leaf.swing }).toEqual({ hinge: swing.hinge, swing: swing.swing });
    }
  });
});
