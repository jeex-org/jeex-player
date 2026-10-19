/**
 * Where THIS object fits: the field of
 * legal places a drag draws on the object's surfaces.
 *
 * A floor or ceiling cell is green when it lies under the footprint of at
 * least one legal pose of the dragged object at its current yaw, red when no
 * legal pose covers it. One pose is judged per lattice point, through the
 * drag's own pose function (`asset-pose.ts` `probePose`, so the wall snap and
 * the rise onto a top are included), and the footprint of every legal pose is
 * rasterised onto the grid of the surface it stands on: a room's floor, a
 * ceiling, or a host's top for an object that may stand on one. The
 * field therefore reads as the floor the object may occupy, not the points its
 * centre may take, and differs from object to object.
 *
 * The wall field keeps its meaning: spans along the faces at the
 * object's height, green where the object centred on the span is legal.
 *
 * Costs, measured on the demo flat in `asset-mask.test.ts` against a 20 ms
 * budget for a floor mask.
 *
 * Pure module: no `three`, no DOM.
 */

import { obbQuad, pointInPolygon, signedArea } from '../plan/plan-geometry.js';
import { WALL_SNAP_M, probePose } from './asset-pose.js';
import { faceFrame, narrowDrag, reachableRooms, type DragContext } from './asset-legality.js';
import { topHeight } from './rules/surfaces.js';
import { effectiveRoom, type SceneData, type Vec2 } from '../scene/types.js';
import type { LintItem } from './rules/context.js';
import type { RoomFace } from '../plan/plan-solver.js';

/** A mask cell count above which the floor grid coarsens (keeps a floor mask within its 20 ms budget). */
export const MASK_MAX_CELLS = 10_000;
/** Default mask step, metres. */
export const MASK_STEP_M = 0.2;
/** Cell size of the field on a host's top: tops are small, and a lamp fits a nightstand only near its middle. */
export const TOP_STEP_M = 0.05;
/** The poses judged on a top: a lattice this fine, through the top's centre (where a small top holds anything at all). */
const TOP_PROBE_M = 0.1;
/**
 * Floor and ceiling poses judged per cell along each axis (2: a 0.1 m lattice
 * under 0.2 m cells). Measured on the demo flat: a 0.2 m
 * lattice showed the sofa 274 green cells where a 0.05 m one finds 361; 0.1 m
 * finds 351.
 */
const PROBES_PER_CELL = 2;
/** Slack added to an object's reach when a mask narrows the scene around a room, metres. */
const TOUCH_PAD_M = 0.1;
/** How far the mask is lifted off its surface so it never z-fights it, metres. */
const MASK_LIFT_M = 0.005;

export type MaskSurface = 'floor' | 'wall' | 'ceiling';

/**
 * A legality field as quads: four corners per cell (`positions`, xyz, in
 * winding order, the first corner the cell's lowest x and z on a floor or
 * ceiling) and one verdict per cell (`ok`, 1 legal / 0 not). `step` is the
 * floor or ceiling grid's.
 */
export type LegalityMask = { readonly positions: Float32Array; readonly ok: Uint8Array; readonly count: number; readonly step: number };

/**
 * One surface's cells: a rectangle of `nu × nv` cells of `step` metres from
 * `origin` along the unit axes `u` and `v`, at height `y`. `inside` marks the
 * cells that belong to the surface (a room polygon's); `ok` collects the
 * legal footprints.
 */
type Grid = {
  readonly key: string;
  readonly origin: Vec2;
  readonly u: Vec2;
  readonly v: Vec2;
  readonly step: number;
  readonly nu: number;
  readonly nv: number;
  readonly y: number;
  readonly inside: Uint8Array;
  readonly ok: Uint8Array;
  /** The plan points judged, row by row (the cell centres on a floor, a coarser lattice on a top). */
  readonly rows: readonly (readonly Vec2[])[];
};

function centreOf(grid: Grid, i: number, j: number): Vec2 {
  const a = (i + 0.5) * grid.step;
  const b = (j + 0.5) * grid.step;
  return { x: grid.origin.x + grid.u.x * a + grid.v.x * b, z: grid.origin.z + grid.u.z * a + grid.v.z * b };
}

/** A room grid's fixed part: which cells lie in the room, and the probe lattice. */
type RoomLattice = { readonly nu: number; readonly nv: number; readonly inside: Uint8Array; readonly rows: readonly (readonly Vec2[])[] };

/** Room lattices per room face and step: the plan does not change under a drag, and every redraw asks again. */
const lattices = new WeakMap<RoomFace, Map<number, RoomLattice>>();

function roomLattice(room: RoomFace, step: number): RoomLattice {
  let byStep = lattices.get(room);
  if (!byStep) {
    byStep = new Map();
    lattices.set(room, byStep);
  }
  const known = byStep.get(step);
  if (known) return known;
  const { bbox, polygon } = room;
  const nu = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / step - 1e-9));
  const nv = Math.max(1, Math.ceil((bbox.maxZ - bbox.minZ) / step - 1e-9));
  const inside = new Uint8Array(nu * nv);
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      inside[j * nu + i] = pointInPolygon({ x: bbox.minX + (i + 0.5) * step, z: bbox.minZ + (j + 0.5) * step }, polygon) ? 1 : 0;
    }
  }
  // The poses judged: a lattice PROBES_PER_CELL times finer than the cells, so a
  // place an object only just fits (a sofa between a wardrobe and a door zone)
  // is not missed between two probes; their footprints paint the cells.
  const probe = step / PROBES_PER_CELL;
  const rows: Vec2[][] = [];
  for (let b = 0; b < nv * PROBES_PER_CELL; b += 1) {
    const row: Vec2[] = [];
    for (let a = 0; a < nu * PROBES_PER_CELL; a += 1) {
      const point = { x: bbox.minX + (a + 0.5) * probe, z: bbox.minZ + (b + 0.5) * probe };
      if (pointInPolygon(point, polygon)) row.push(point);
    }
    if (row.length > 0) rows.push(row);
  }
  const lattice = { nu, nv, inside, rows };
  byStep.set(step, lattice);
  return lattice;
}

/** An axis-aligned grid over a room's bounding box; `inside` is the room polygon. */
function roomGrid(room: RoomFace, y: number, step: number): Grid {
  const { nu, nv, inside, rows } = roomLattice(room, step);
  return {
    key: `room:${room.roomId}`,
    origin: { x: room.bbox.minX, z: room.bbox.minZ },
    u: { x: 1, z: 0 },
    v: { x: 0, z: 1 },
    step,
    nu,
    nv,
    y,
    inside,
    ok: new Uint8Array(nu * nv),
    rows,
  };
}

/** A grid over a host's top, in the host's own frame, at its top height. */
function topGrid(host: LintItem, y: number): Grid | null {
  const box = host.box;
  if (!box) return null;
  const u = { x: Math.cos(box.angle), z: Math.sin(box.angle) };
  const v = { x: -Math.sin(box.angle), z: Math.cos(box.angle) };
  const nu = Math.max(1, Math.round((2 * box.hx) / TOP_STEP_M));
  const nv = Math.max(1, Math.round((2 * box.hz) / TOP_STEP_M));
  const step = Math.min((2 * box.hx) / nu, (2 * box.hz) / nv);
  // Square cells, centred on the top: the few millimetres a rounding leaves stay uncovered at the rim.
  const origin = {
    x: box.x - u.x * ((nu * step) / 2) - v.x * ((nv * step) / 2),
    z: box.z - u.z * ((nu * step) / 2) - v.z * ((nv * step) / 2),
  };
  const rows: Vec2[][] = [];
  const reachU = Math.floor(box.hx / TOP_PROBE_M);
  const reachV = Math.floor(box.hz / TOP_PROBE_M);
  for (let b = -reachV; b <= reachV; b += 1) {
    const row: Vec2[] = [];
    for (let a = -reachU; a <= reachU; a += 1) {
      row.push({ x: box.x + (u.x * a + v.x * b) * TOP_PROBE_M, z: box.z + (u.z * a + v.z * b) * TOP_PROBE_M });
    }
    rows.push(row);
  }
  return {
    key: host.placement.id,
    origin,
    u,
    v,
    step,
    nu,
    nv,
    y,
    inside: new Uint8Array(nu * nv).fill(1),
    ok: new Uint8Array(nu * nv),
    rows,
  };
}

/** Whether `point` lies in the convex `quad` (either winding). */
function inConvex(quad: readonly Vec2[], point: Vec2): boolean {
  let sign = 0;
  for (let k = 0; k < quad.length; k += 1) {
    const a = quad[k]!;
    const b = quad[(k + 1) % quad.length]!;
    const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
    if (Math.abs(cross) < 1e-12) continue;
    const side = cross > 0 ? 1 : -1;
    if (sign === 0) sign = side;
    else if (side !== sign) return false;
  }
  return true;
}

/** Marks every cell of `grid` whose centre lies under `quad`. */
function rasterise(grid: Grid, quad: readonly Vec2[]): void {
  let lowU = Infinity;
  let highU = -Infinity;
  let lowV = Infinity;
  let highV = -Infinity;
  for (const corner of quad) {
    const dx = corner.x - grid.origin.x;
    const dz = corner.z - grid.origin.z;
    const a = (dx * grid.u.x + dz * grid.u.z) / grid.step;
    const b = (dx * grid.v.x + dz * grid.v.z) / grid.step;
    lowU = Math.min(lowU, a);
    highU = Math.max(highU, a);
    lowV = Math.min(lowV, b);
    highV = Math.max(highV, b);
  }
  const i0 = Math.max(0, Math.floor(lowU - 0.5));
  const i1 = Math.min(grid.nu - 1, Math.ceil(highU - 0.5));
  const j0 = Math.max(0, Math.floor(lowV - 0.5));
  const j1 = Math.min(grid.nv - 1, Math.ceil(highV - 0.5));
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const cell = j * grid.nu + i;
      if (grid.inside[cell] === 1 && grid.ok[cell] === 0 && inConvex(quad, centreOf(grid, i, j))) grid.ok[cell] = 1;
    }
  }
}

/** The step that keeps `area` square metres under `MASK_MAX_CELLS` cells. */
function stepFor(area: number, step: number): number {
  return Math.max(step, Math.sqrt(area / MASK_MAX_CELLS));
}

function hasCeiling(scene: SceneData, roomId: string): boolean {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  return room !== undefined && effectiveRoom(room).kind !== 'loggia';
}

/**
 * The quad an object covers on the surface it stands on: its footprint, its
 * body for a ceiling piece, and its plan outline for a floor object that has
 * no footprint (a rug or a mat is walked over, yet it covers floor).
 */
function coverOf(item: LintItem): readonly Vec2[] {
  if (item.quad) return item.quad;
  if (item.mount) return item.mount.quad;
  const { x, z } = item.placement.position;
  return obbQuad({ x, z, hx: item.dims[0] / 2, hz: item.dims[2] / 2, angle: item.angle });
}

/**
 * Judges one pose per lattice point of every grid (narrowed per grid and per
 * row), and rasterises each legal footprint onto the grid of the surface it
 * stands on.
 */
function fill(drag: DragContext, item: LintItem, grids: readonly Grid[], floorY: number): void {
  const byKey = new Map(grids.map((grid) => [grid.key, grid]));
  const floors = grids.filter((grid) => grid.y === floorY);
  // A wall snap pulls a pose up to `WALL_SNAP_M` onto its face: inside the slack, so only a snap that turned it re-judges.
  const reach = Math.hypot(item.dims[0], item.dims[2]) / 2 + TOUCH_PAD_M + (drag.facts.wallSnap ? WALL_SNAP_M : 0);
  for (const grid of grids) {
    for (const rowCentres of grid.rows) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const centre of rowCentres) {
        minX = Math.min(minX, centre.x);
        maxX = Math.max(maxX, centre.x);
        minZ = Math.min(minZ, centre.z);
        maxZ = Math.max(maxZ, centre.z);
      }
      // A row of cells meets a fraction of the room's neighbours: narrow once per row
      // (`probePose` judges a pose the wall snap carried out of the box against its own surroundings).
      const row = narrowDrag(drag, { minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: maxZ + reach });
      for (const point of rowCentres) {
        const {
          placed,
          ok,
          item: moved,
        } = probePose(row, {
          kind: 'plan',
          point,
          rotationY: item.angle,
          y: item.placement.position.y,
          snap: true,
        });
        if (!ok) continue;
        const legal = coverOf(moved);
        const target = placed.host === null ? floors : [byKey.get(placed.host)].filter((found): found is Grid => found !== undefined);
        for (const surface of target) rasterise(surface, legal);
      }
    }
  }
}

/** Every inside cell of every grid, as quads. */
function write(grids: readonly Grid[], step: number): LegalityMask {
  let count = 0;
  for (const grid of grids) for (const inside of grid.inside) count += inside;
  const positions = new Float32Array(count * 12);
  const ok = new Uint8Array(count);
  let cell = 0;
  for (const grid of grids) {
    const du = { x: grid.u.x * grid.step, z: grid.u.z * grid.step };
    const dv = { x: grid.v.x * grid.step, z: grid.v.z * grid.step };
    for (let j = 0; j < grid.nv; j += 1) {
      for (let i = 0; i < grid.nu; i += 1) {
        const index = j * grid.nu + i;
        if (grid.inside[index] === 0) continue;
        const x = grid.origin.x + du.x * i + dv.x * j;
        const z = grid.origin.z + du.z * i + dv.z * j;
        const corners = [
          [x, z],
          [x + du.x, z + du.z],
          [x + du.x + dv.x, z + du.z + dv.z],
          [x + dv.x, z + dv.z],
        ];
        for (let k = 0; k < 4; k += 1) {
          positions[cell * 12 + k * 3] = corners[k]![0]!;
          positions[cell * 12 + k * 3 + 1] = grid.y;
          positions[cell * 12 + k * 3 + 2] = corners[k]![1]!;
        }
        ok[cell] = grid.ok[index]!;
        cell += 1;
      }
    }
  }
  return { positions, ok, count, step };
}

/** Floor or ceiling (and, for an object that may stand on one, every top in the scene). */
function planeMask(drag: DragContext, item: LintItem, surface: 'floor' | 'ceiling', step: number): LegalityMask {
  const plan = drag.ctx.plan;
  const rooms = surface === 'ceiling' ? plan.rooms.filter((room) => hasCeiling(drag.ctx.scene, room.roomId)) : plan.rooms;
  const y = surface === 'ceiling' ? drag.ctx.scene.ceilingHeight - MASK_LIFT_M : MASK_LIFT_M;
  const area = rooms.reduce((sum, room) => sum + Math.abs(signedArea(room.polygon)), 0);
  const size = stepFor(area, step);
  const grids: Grid[] = rooms.map((room) => roomGrid(room, y, size));
  if (surface === 'floor' && drag.facts.surfaces?.onSurface) {
    for (const host of drag.ctx.items) {
      const height = topHeight(host);
      const grid = height === null ? null : topGrid(host, height + MASK_LIFT_M);
      if (grid) grids.push(grid);
    }
  }
  fill(drag, item, grids, y);
  return write(grids, size);
}

/** Spans along every reachable face at the item's height, judged through the drag's pose function. */
function wallMask(drag: DragContext, item: LintItem, step: number): LegalityMask {
  const rooms = reachableRooms(drag.ctx, item.roomId);
  const low = item.y - item.dims[1] / 2;
  const high = item.y + item.dims[1] / 2;
  const positions: number[] = [];
  const ok: number[] = [];
  for (const face of drag.ctx.plan.faces.values()) {
    if (face.roomId === null || !rooms.has(face.roomId)) continue;
    const cells = Math.max(1, Math.floor(face.length / step));
    const size = face.length / cells;
    for (let index = 0; index < cells; index += 1) {
      const t0 = index * size;
      const t1 = t0 + size;
      const { ok: legal } = probePose(drag, { kind: 'face', face, t: (t0 + t1) / 2, y: item.y });
      const a = faceFrame(face, t0);
      const b = faceFrame(face, t1);
      for (const [frame, height] of [
        [a, low],
        [b, low],
        [b, high],
        [a, high],
      ] as const) {
        positions.push(frame.point.x + frame.normal.x * MASK_LIFT_M, height, frame.point.z + frame.normal.z * MASK_LIFT_M);
      }
      ok.push(legal ? 1 : 0);
    }
  }
  return { positions: new Float32Array(positions), ok: Uint8Array.from(ok), count: ok.length, step };
}

/**
 * Where on `surface` the dragged object, at its current yaw (and, on a wall,
 * its current height), may stand: floor, ceiling, a host's top or a wall.
 */
export function mask(drag: DragContext, item: LintItem, surface: MaskSurface, step: number = MASK_STEP_M): LegalityMask {
  if (surface === 'wall') return wallMask(drag, item, step);
  return planeMask(drag, item, surface, step);
}
