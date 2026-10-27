import { describe, expect, test } from 'bun:test';
import polygonClipping from 'polygon-clipping';

import { ZONED, ZONE_OUTLINES, box, zone, zonedLivingPlan } from '../fixtures/plan-zoned-living.js';
import { solvePlan, type SolvedPlan } from './plan-solver.js';
import type { Room, Vec2 } from '../scene/types.js';

/** The room's inner face, before any zone is cut out of it: 9.8 x 7.8. */
const FACE_AREA = 76.44;

function shoelace(polygon: readonly Vec2[]): number {
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    twice += a.x * b.z - b.x * a.z;
  }
  return Math.abs(twice) / 2;
}

function polygonOf(plan: SolvedPlan, roomId: string): readonly Vec2[] {
  return plan.rooms.find((room) => room.roomId === roomId)!.polygon;
}

/** The floor two solved rooms both claim, m². */
function sharedArea(plan: SolvedPlan, a: string, b: string): number {
  const ring = (id: string): [number, number][][] => [polygonOf(plan, id).map((p) => [p.x, p.z] as [number, number])];
  const overlap = polygonClipping.intersection(ring(a), ring(b));
  return overlap.reduce((sum, polygon) => sum + shoelace(polygon[0]!.map(([x, z]) => ({ x, z }))), 0);
}

const dining = (): Room => zone(ZONED.room.dining, 'Dining', ZONE_OUTLINES.dining);
const kitchen = (): Room => zone(ZONED.room.kitchen, 'Kitchen', ZONE_OUTLINES.kitchen);
const hall = (): Room => zone(ZONED.room.hall, 'Hall', ZONE_OUTLINES.hall);

describe('a wall-bounded room owns its face minus the zones lying in it', () => {
  test('the living room, a dining corner, a kitchen run and a hall: no floor is claimed twice', () => {
    const plan = solvePlan(zonedLivingPlan([dining(), kitchen(), hall()]));

    for (const zoneId of [ZONED.room.dining, ZONED.room.kitchen, ZONED.room.hall]) {
      expect({ zoneId, shared: sharedArea(plan, ZONED.room.living, zoneId) }).toEqual({ zoneId, shared: expect.closeTo(0, 6) });
    }
    // 76.44 less the dining corner (14), the kitchen run (8.4) and the hall's part in the room (2 x 0.9).
    expect(shoelace(polygonOf(plan, ZONED.room.living))).toBeCloseTo(FACE_AREA - 14 - 8.4 - 1.8, 6);
    // The zones keep their own outlines.
    expect(polygonOf(plan, ZONED.room.dining)).toEqual(ZONE_OUTLINES.dining);
    expect(plan.caveats).toEqual([]);
  });

  test('a zone with less than half of its area in the room is not cut out of it', () => {
    // 0.4 of its 1.0 m width lies inside the east face.
    const mostlyOutside = zone(ZONED.room.other, 'Balcony', box(9.5, 6, 10.5, 7));
    const plan = solvePlan(zonedLivingPlan([mostlyOutside]));
    expect(shoelace(polygonOf(plan, ZONED.room.living))).toBeCloseTo(FACE_AREA, 6);
  });

  test('a remainder in pieces: the largest stays the room, a smaller one goes to the zone it shares the longest boundary with', () => {
    // A strip right across the room cuts off its west 2.9 x 7.8; the dining
    // corner touches that piece along 1.8 m, the strip along 7.8 m.
    const strip = zone(ZONED.room.other, 'Passage', box(3, 0.1, 4, 7.9));
    const corner = zone(ZONED.room.dining, 'Dining', box(0.1, 0.1, 1, 1));
    const plan = solvePlan(zonedLivingPlan([strip, corner]));

    expect(shoelace(polygonOf(plan, ZONED.room.living))).toBeCloseTo(5.9 * 7.8, 6);
    expect(shoelace(polygonOf(plan, ZONED.room.other))).toBeCloseTo(1 * 7.8 + 2.9 * 7.8 - 0.9 * 0.9, 6);
    expect(shoelace(polygonOf(plan, ZONED.room.dining))).toBeCloseTo(0.81, 6);
    expect(sharedArea(plan, ZONED.room.living, ZONED.room.other)).toBeCloseTo(0, 6);
    expect(sharedArea(plan, ZONED.room.other, ZONED.room.dining)).toBeCloseTo(0, 6);
  });

  test('a zone that would leave a ring is left as it is, with a caveat', () => {
    const island = zone(ZONED.room.other, 'Island', box(4, 3, 6, 5));
    const plan = solvePlan(zonedLivingPlan([island]));

    expect(shoelace(polygonOf(plan, ZONED.room.living))).toBeCloseTo(FACE_AREA, 6);
    expect(plan.caveats).toEqual([{ code: 'zone-ring', roomId: ZONED.room.living, zoneIds: [ZONED.room.other] }]);
  });

  test('zones that cover the whole room leave it as drawn, with a caveat of their own', () => {
    const west = zone(ZONED.room.dining, 'Dining', box(0.1, 0.1, 5, 7.9));
    const east = zone(ZONED.room.kitchen, 'Kitchen', box(5, 0.1, 9.9, 7.9));
    const plan = solvePlan(zonedLivingPlan([west, east]));

    expect(shoelace(polygonOf(plan, ZONED.room.living))).toBeCloseTo(FACE_AREA, 6);
    expect(plan.caveats).toEqual([
      { code: 'zones-cover-room', roomId: ZONED.room.living, zoneIds: [ZONED.room.dining, ZONED.room.kitchen] },
    ]);
  });

  test('the room keeps its anchor even where a zone took that floor: no anchor error', () => {
    // The living room's anchor (2, 2) lies in the dining corner.
    expect(() => solvePlan(zonedLivingPlan([dining()]))).not.toThrow();
  });
});
