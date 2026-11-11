/**
 * What the 2D plan draws for a host's selection: the wall, the opening, the
 * room or the placement it names, in plan metres.
 */

import { describe, expect, test } from 'bun:test';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { selectionMark } from './plan-selection.js';
import { solvePlan } from './plan-solver.js';

const plan = solvePlan(lShapePlan);

describe('selectionMark', () => {
  test('a wall is its centreline at its own thickness', () => {
    expect(selectionMark(plan, lShapePlan, { kind: 'wall', id: L_SHAPE.wall.wSB })).toEqual({
      lines: [
        {
          points: [
            { x: 6, z: 0 },
            { x: 10, z: 0 },
          ],
          width: 0.3,
        },
      ],
      areas: [],
      points: [],
    });
  });

  test('an opening is the stretch of its wall it spans', () => {
    // The east window: centre 2.5 m, 1.6 m wide, on the wall from (10, 0) to (10, 5).
    const mark = selectionMark(plan, lShapePlan, { kind: 'opening', id: L_SHAPE.opening.windowBEast });
    expect(mark?.lines).toHaveLength(1);
    const [from, to] = [mark!.lines[0]!.points[0]!, mark!.lines[0]!.points.at(-1)!];
    expect(from.x).toBeCloseTo(10, 9);
    expect(from.z).toBeCloseTo(1.7, 9);
    expect(to.z).toBeCloseTo(3.3, 9);
  });

  test('a room is the floor it owns, and a placement the point it stands on', () => {
    const room = selectionMark(plan, lShapePlan, { kind: 'room', id: L_SHAPE.room.b });
    expect(room?.areas).toEqual([plan.rooms.find((candidate) => candidate.roomId === L_SHAPE.room.b)!.polygon]);
    expect(selectionMark(plan, lShapePlan, { kind: 'furniture', id: L_SHAPE.asset.sofa })?.points).toEqual([{ x: 2, z: 6 }]);
  });

  test('a target the document does not carry marks nothing', () => {
    expect(selectionMark(plan, lShapePlan, { kind: 'wall', id: L_SHAPE.room.a })).toBeNull();
  });
});
