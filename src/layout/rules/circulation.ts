/**
 * Rule 6 (hard): every room has a 0.80 m path from each of its doors to the
 * others and into its main zone.
 *
 * The test is a flood fill over a free-space grid: cells at least half a
 * corridor from the walls and from every footprint. A door is entered at a
 * POINT, not at a grid cell, so the free cells within half its clear zone are
 * its seeds — snapping the approach onto the lattice could otherwise invent a
 * blocked door.
 *
 * Pure module: no `three`, no DOM.
 */

import { add, dist, distanceToPolygon, mul, pointInPolygon } from '../../plan/plan-geometry.js';
import { roomCentroid } from '../layout-geometry.js';
import type { Obb } from '../../plan/plan-geometry.js';
import { DOOR_CLEAR_M, pointToBox, type LayoutIssue, type LayoutRuleModule, type LintContext } from './context.js';
import type { SolvedPlan } from '../../plan/plan-solver.js';
import type { Vec2 } from '../../scene/types.js';

/** Half-width of the circulation corridor, metres: a 0.8 m path. */
const CORRIDOR_HALF_M = 0.4;
/** Grid step of the circulation search, metres. */
const CORRIDOR_STEP_M = 0.1;
/**
 * How far into the room a door is approached from, beyond the wall face: the
 * middle of its `DOOR_CLEAR_M` clear zone. Rule 3 already owns the threshold
 * itself, so rule 6 measures the ROOM's circulation and is not a second,
 * harsher test of the doorway's own width.
 */
const DOOR_APPROACH_M = DOOR_CLEAR_M / 2;
/** A free cell this close to the room centroid counts as reaching the main zone. */
const CENTRE_REACH_M = 1.0;

type Grid = {
  free: boolean[];
  cols: number;
  rows: number;
  at: (i: number) => Vec2;
  near: (p: Vec2, radius: number) => number[];
};

/** Free-space grid of one room: cells at least `CORRIDOR_HALF_M` from walls and furniture. */
function corridorGrid(room: SolvedPlan['rooms'][number], boxes: Obb[]): Grid {
  const { minX, maxX, minZ, maxZ } = room.bbox;
  const cols = Math.max(1, Math.ceil((maxX - minX) / CORRIDOR_STEP_M) + 1);
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / CORRIDOR_STEP_M) + 1);
  const at = (i: number): Vec2 => ({ x: minX + (i % cols) * CORRIDOR_STEP_M, z: minZ + Math.floor(i / cols) * CORRIDOR_STEP_M });
  const free = Array.from<boolean>({ length: cols * rows }).fill(false);
  for (let i = 0; i < free.length; i += 1) {
    const p = at(i);
    if (!pointInPolygon(p, room.polygon)) continue;
    if (distanceToPolygon(p, room.polygon).distance < CORRIDOR_HALF_M) continue;
    let blocked = false;
    for (const box of boxes) {
      if (pointToBox(box, p) < CORRIDOR_HALF_M) {
        blocked = true;
        break;
      }
    }
    free[i] = !blocked;
  }
  /** Every free cell within `radius` of a plan point, nearest first. */
  const near = (p: Vec2, radius: number): number[] => {
    const found: Array<{ cell: number; d: number }> = [];
    const span = Math.ceil(radius / CORRIDOR_STEP_M);
    const cx = Math.round((p.x - minX) / CORRIDOR_STEP_M);
    const cz = Math.round((p.z - minZ) / CORRIDOR_STEP_M);
    for (let iz = cz - span; iz <= cz + span; iz += 1) {
      for (let ix = cx - span; ix <= cx + span; ix += 1) {
        if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) continue;
        const cell = iz * cols + ix;
        if (!free[cell]) continue;
        const d = Math.hypot(at(cell).x - p.x, at(cell).z - p.z);
        if (d <= radius) found.push({ cell, d });
      }
    }
    return found.sort((a, b) => a.d - b.d).map((entry) => entry.cell);
  };
  return { free, cols, rows, at, near };
}

/** Cells reachable from `seeds` over the free grid, four-connected. */
function flood(grid: Grid, seeds: readonly number[]): Uint8Array {
  const seen = new Uint8Array(grid.free.length);
  const queue = [...seeds];
  for (const seed of queue) seen[seed] = 1;
  while (queue.length > 0) {
    const cell = queue.pop()!;
    const cx = cell % grid.cols;
    const cz = Math.floor(cell / grid.cols);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows) continue;
      const next = nz * grid.cols + nx;
      if (seen[next] || !grid.free[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return seen;
}

function ruleCirculation(ctx: LintContext, out: LayoutIssue[]): void {
  const boxes = ctx.items.filter((item) => item.box).map((item) => item.box!);
  for (const room of ctx.plan.rooms) {
    const grid = corridorGrid(room, boxes);
    const approaches: Array<{ openingId: string; point: Vec2 }> = [];
    for (const door of ctx.doors) {
      for (const side of door.sides) {
        if (side.roomId !== room.roomId) continue;
        approaches.push({
          openingId: door.openingId,
          point: add(door.centre, mul(side.normal, door.thickness / 2 + DOOR_APPROACH_M)),
        });
      }
    }
    if (approaches.length === 0) continue;

    const reachable: Array<{ openingId: string; seeds: number[]; point: Vec2 }> = [];
    for (const approach of approaches) {
      const seeds = grid.near(approach.point, DOOR_APPROACH_M);
      if (seeds.length === 0) {
        out.push({
          rule: 'circulation',
          severity: 'error',
          ids: [approach.openingId, room.roomId],
          message: `${approach.openingId} has no 0.80 m of free floor in front of it inside ${room.roomId}`,
          at: approach.point,
        });
        continue;
      }
      reachable.push({ openingId: approach.openingId, seeds, point: approach.point });
    }
    const first = reachable[0];
    if (!first) continue;

    // Flood the free cells from the first door and see what else it reaches.
    const seen = flood(grid, first.seeds);
    for (const target of reachable.slice(1)) {
      if (target.seeds.some((cell) => seen[cell])) continue;
      out.push({
        rule: 'circulation',
        severity: 'error',
        ids: [first.openingId, target.openingId, room.roomId],
        message: `no 0.80 m path from ${first.openingId} to ${target.openingId} across ${room.roomId}`,
        at: target.point,
      });
    }
    const centre = roomCentroid(room.polygon);
    let reachesCentre = false;
    for (let i = 0; i < seen.length; i += 1) {
      if (!seen[i]) continue;
      if (dist(grid.at(i), centre) <= CENTRE_REACH_M) {
        reachesCentre = true;
        break;
      }
    }
    if (!reachesCentre) {
      out.push({
        rule: 'circulation',
        severity: 'error',
        ids: [room.roomId, first.openingId],
        message: `the main zone of ${room.roomId} is not reachable on a 0.80 m path from ${first.openingId}`,
        at: centre,
      });
    }
  }
}

export const CIRCULATION: LayoutRuleModule = { id: 'circulation', severity: 'error', run: ruleCirculation };
