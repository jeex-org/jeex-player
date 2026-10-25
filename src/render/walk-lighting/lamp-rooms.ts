/**
 * Which room a lamp belongs to in walk and tour, and a signature of the
 * scene's lamps that changes exactly when a lamp does.
 *
 * Source room: the first room, in the given order, whose polygon contains the
 * lamp's emitter in plan, edges included (within `EDGE_M`). The polygon is the
 * room's own, never a grid's inset sampling box or a selection box. A lamp
 * outside every polygon has no room (-1): it lights nothing inside the rooms
 * and is never treated as a global lamp; there is no nearest-room fallback.
 *
 * Pure module: no `three`, no DOM.
 */

import type { VolumeRoom } from './room-volumes.js';

/** How far from an edge a point still counts as on it, metres. */
const EDGE_M = 1e-6;

type Vec2 = { readonly x: number; readonly z: number };

/** Distance from `p` to the segment `a`–`b`. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = dx * dx + dz * dz;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Whether `p` lies inside `polygon` or on one of its edges. */
function contains(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (segmentDistance(p, a, b) <= EDGE_M) return true;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** The index in `order` of the room whose polygon holds `position`, the first one listed when several do; -1 when none does. */
export function assignLampRoom(position: Vec2, rooms: readonly VolumeRoom[], order: readonly string[]): number {
  const byId = new Map(rooms.map((room) => [room.roomId, room]));
  for (let i = 0; i < order.length; i += 1) {
    const room = byId.get(order[i]!);
    if (room && contains(position, room.polygon)) return i;
  }
  return -1;
}

/** One lamp of the scene as its signature reads it: identity, world position, linear colour, intensity, distance, decay. */
export type LampEntry = {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly colour: readonly [number, number, number];
  readonly intensity: number;
  readonly distance: number;
  readonly decay: number;
};

const mm = (v: number): string => (Math.round(v * 1000) / 1000).toFixed(3);
const fine = (v: number): string => (Math.round(v * 1e4) / 1e4).toFixed(4);

/** A string that changes when a lamp moves by a millimetre or more, changes colour or strength, appears or goes. */
export function lampSignature(entries: readonly LampEntry[]): string {
  return entries
    .map((e) => [e.id, ...e.position.map(mm), ...e.colour.map(fine), fine(e.intensity), fine(e.distance), fine(e.decay)].join(','))
    .join(';');
}
