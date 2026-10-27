/**
 * Which room owns each piece of floor, once the plan is solved.
 *
 * A wall-bounded room is solved as its whole graph face. A room with its own
 * `polygon` (a zone a source outlined: a dining corner, a kitchen run, a hall)
 * may lie inside such a face, and the two then claim the same floor: its area
 * counted twice, two floor slabs on one spot, a linter that sees the dining
 * table in the living room. So the face's room keeps the face MINUS the zones
 * lying in it, and every piece of floor has one owner:
 *
 * - a zone lies in a face when more than half of its own area does;
 * - the zones keep their own outlines;
 * - a remainder in several pieces stays the room in its largest piece, and
 *   each smaller piece joins the zone it shares the longest boundary with;
 * - a zone that would leave the room as a ring around it (a zone touching no
 *   face boundary), or zones that cover the whole room, are left as they
 *   are, and a caveat says so.
 *
 * Only `polygon` and `bbox` change. The room's anchor, its wall faces (`loop`)
 * and the face matching (`assignRooms`) are the graph's and stay as they were.
 *
 * Pure module: no `three`, no DOM.
 */

import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping';

import { boundsOf, signedArea, type Bounds } from './plan-geometry.js';
import type { Vec2 } from '../scene/types.js';

/** What this module reads and writes of a solved room (`RoomFace`); the rest rides along. */
type Floor = { readonly roomId: string; readonly polygon: readonly Vec2[]; readonly bbox: Bounds };

/** Something about the plan's floors the solver could not settle, and left as the source drew it. */
export type PlanCaveat = {
  /**
   * `zone-ring`: cutting the zones out would leave the room as a ring around them.
   * `zones-cover-room`: the zones cover the whole room, which would keep no floor.
   */
  readonly code: 'zone-ring' | 'zones-cover-room';
  readonly roomId: string;
  readonly zoneIds: readonly string[];
};

/** Pieces of floor smaller than this are numerical slivers of the cut, m². */
const SLIVER_M2 = 1e-6;
/** Two boundary edges closer than this are one shared edge, metres. */
const SHARED_EDGE_TOL_M = 1e-6;

function polygonOf(points: readonly Vec2[]): Polygon {
  return [points.map((p) => [p.x, p.z] as [number, number])];
}

/** A ring back as plan points, without the repeated closing point and wound like `like`. */
function pointsOf(ring: Ring, like: readonly Vec2[]): Vec2[] {
  const points = ring.slice(0, -1).map(([x, z]) => ({ x, z }));
  return Math.sign(signedArea(points)) === Math.sign(signedArea(like)) ? points : points.reverse();
}

function ringArea(ring: Ring): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % ring.length]!;
    twice += ax * bz - bx * az;
  }
  return Math.abs(twice) / 2;
}

function areaOf(shape: MultiPolygon): number {
  let total = 0;
  for (const [outer, ...holes] of shape) {
    total += ringArea(outer!);
    for (const hole of holes) total -= ringArea(hole);
  }
  return total;
}

/** The ring with its first point repeated at the end, as the clipper hands its own back. */
function closed(ring: Ring): Ring {
  const [first] = ring;
  const last = ring.at(-1);
  return first && last && (first[0] !== last[0] || first[1] !== last[1]) ? [...ring, first] : ring;
}

/** Length of boundary two closed outlines share: collinear, overlapping edges. */
function sharedBoundary(a: Ring, b: Ring): number {
  let total = 0;
  for (let i = 0; i + 1 < a.length; i += 1) {
    const [ax, az] = a[i]!;
    const [bx, bz] = a[i + 1]!;
    const length = Math.hypot(bx - ax, bz - az);
    if (length === 0) continue;
    const ux = (bx - ax) / length;
    const uz = (bz - az) / length;
    for (let j = 0; j + 1 < b.length; j += 1) {
      const [cx, cz] = b[j]!;
      const [dx, dz] = b[j + 1]!;
      // Both ends of the other edge on this edge's line.
      const off = (px: number, pz: number): number => Math.abs((px - ax) * uz - (pz - az) * ux);
      if (off(cx, cz) > SHARED_EDGE_TOL_M || off(dx, dz) > SHARED_EDGE_TOL_M) continue;
      const t0 = (cx - ax) * ux + (cz - az) * uz;
      const t1 = (dx - ax) * ux + (dz - az) * uz;
      total += Math.max(0, Math.min(length, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)));
    }
  }
  return total;
}

function withPolygon<R extends Floor>(room: R, polygon: Vec2[]): R {
  return { ...room, polygon, bbox: boundsOf(polygon) };
}

/**
 * `rooms` with every face room cut down to the floor no zone in it claims, and
 * the caveats of the cuts it declined. `zoneIds` are the rooms solved from
 * their own `polygon`.
 */
export function ownFloors<R extends Floor>(rooms: readonly R[], zoneIds: ReadonlySet<string>): { rooms: R[]; caveats: PlanCaveat[] } {
  const solved = new Map(rooms.map((room) => [room.roomId, room]));
  const caveats: PlanCaveat[] = [];
  for (const room of rooms) {
    if (zoneIds.has(room.roomId)) continue;
    const face = polygonOf(room.polygon);
    const inside = rooms.filter((candidate) => {
      if (!zoneIds.has(candidate.roomId)) return false;
      const own = polygonOf(candidate.polygon);
      return areaOf(polygonClipping.intersection(face, own)) > areaOf([own]) / 2;
    });
    if (inside.length === 0) continue;
    const remainder = polygonClipping
      .difference(face, ...inside.map((zone) => polygonOf(zone.polygon)))
      .filter((piece) => areaOf([piece]) > SLIVER_M2)
      .sort((a, b) => areaOf([b]) - areaOf([a]));
    const [largest, ...smaller] = remainder;
    if (!largest || remainder.some((piece) => piece.length > 1)) {
      const code = largest ? 'zone-ring' : 'zones-cover-room';
      caveats.push({ code, roomId: room.roomId, zoneIds: inside.map((zone) => zone.roomId) });
      continue;
    }
    solved.set(room.roomId, withPolygon(room, pointsOf(largest[0]!, room.polygon)));
    for (const piece of smaller) {
      // Read the zones as they stand now: an earlier piece may have grown one.
      let heir = inside[0]!;
      let longest = -1;
      for (const zone of inside) {
        const shared = sharedBoundary(piece[0]!, closed(polygonOf(solved.get(zone.roomId)!.polygon)[0]!));
        if (shared > longest) {
          longest = shared;
          heir = zone;
        }
      }
      const current = solved.get(heir.roomId)!;
      const [grown] = polygonClipping.union(polygonOf(current.polygon), piece).sort((a, b) => areaOf([b]) - areaOf([a]));
      if (grown) solved.set(heir.roomId, withPolygon(current, pointsOf(grown[0]!, current.polygon)));
    }
  }
  return { rooms: rooms.map((room) => solved.get(room.roomId)!), caveats };
}
