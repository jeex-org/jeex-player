/**
 * Where THIS object fits: the field of
 * legal places a drag draws on the object's surfaces.
 *
 * A floor or ceiling cell is green when it lies under the footprint of at
 * least one legal pose of the dragged object at its current yaw, red when no
 * legal pose covers it. Poses are judged through the
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
 * Poses are judged on a lattice of the cell centres, then refined where the
 * field changes: toward the last legal pose at every edge and round its
 * corners, and into the narrow places between two lattice points that fail
 * for different reasons, from which it walks sideways too. A patch of legal
 * poses only a few centimetres across in both directions can still fall
 * between the lattice lines.
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
import type { LayoutIssue, LintItem } from './rules/context.js';
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
 * Halvings of the step from a legal lattice pose toward an illegal neighbour
 * (3: the farthest legal pose found to an eighth of the lattice step, 0.025 m
 * on a 0.2 m floor grid, the step a release settles by). A lattice alone paints the
 * footprints of the poses ON it, so wherever the legal poses end between two
 * lattice points, the floor only the farthest of them covers stays red: up
 * to a whole lattice step at every edge of the field.
 */
const EDGE_HALVINGS = 3;
/**
 * Divisions of the step between two illegal lattice neighbours that run into
 * different things, a different rule, a different object, or the room's edge
 * (8: an eighth of the lattice step, as fine as the edges). A place the
 * object only just fits, narrower than the lattice step, lies between such a
 * pair and never on the lattice.
 */
const SLIVER_SAMPLES = 8;
/** Slack added to an object's reach when a mask narrows the scene around a room, metres. */
const TOUCH_PAD_M = 0.1;
/** How far the mask is lifted off its surface so it never z-fights it, metres. */
const MASK_LIFT_M = 0.005;

export type MaskSurface = 'floor' | 'wall' | 'ceiling';

/**
 * What a pose first runs into, `null` for a legal one: the rule and the
 * objects it names, and for a footprint that crosses its room's outline
 * (which names only the object itself, whichever wall it crosses) the way
 * its corners off the floor lie from its centre.
 */
type Misfit = { readonly key: string; readonly off: Vec2 | null } | null;

function misfitOf(drag: DragContext, issue: LayoutIssue | null, moved: LintItem): Misfit {
  if (issue === null) return null;
  const key = `${issue.rule}:${issue.ids.join(',')}`;
  const room = drag.ctx.plan.rooms.find((candidate) => candidate.roomId === moved.roomId);
  if (issue.rule !== 'on-floor' || !moved.quad || !room) return { key, off: null };
  const centre = moved.placement.position;
  const off = { x: 0, z: 0 };
  for (const corner of moved.quad) {
    if (pointInPolygon(corner, room.polygon)) continue;
    off.x += corner.x - centre.x;
    off.z += corner.z - centre.z;
  }
  return { key, off };
}

/**
 * Whether two illegal neighbours a lattice `step` apart may hold a window
 * between them that both miss: they run into different things, or both
 * cross the outline and the step leads from a pose that pokes out behind
 * it to one that pokes out ahead (in a passage, from over the west wall to
 * over the east one), never along one wall.
 */
function windowBetween(here: NonNullable<Misfit>, next: NonNullable<Misfit>, step: Vec2): boolean {
  if (here.key !== next.key) return true;
  if (!here.off || !next.off) return false;
  return here.off.x * step.x + here.off.z * step.z < 0 && next.off.x * step.x + next.off.z * step.z > 0;
}

/**
 * Whether an illegal pose next to the room's edge (no lattice neighbour that
 * way) may hold a window toward it. Not when it already pokes through the
 * outline on that side: further on only crosses it more.
 */
function towardEdge(here: NonNullable<Misfit>, step: Vec2): boolean {
  return !here.off || here.off.x * step.x + here.off.z * step.z <= 0;
}

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
  /** One point of that lattice and its spacing along `u` and `v`, metres. */
  readonly lattice: { readonly origin: Vec2; readonly probe: number };
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
  // The poses judged: the cell centres in the room. Where the legal poses end
  // between two of them, and the places an object only just fits, are found
  // from there (`fill`).
  const rows: Vec2[][] = [];
  for (let j = 0; j < nv; j += 1) {
    const row: Vec2[] = [];
    for (let i = 0; i < nu; i += 1) {
      if (inside[j * nu + i] === 1) row.push({ x: bbox.minX + (i + 0.5) * step, z: bbox.minZ + (j + 0.5) * step });
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
    lattice: { origin: { x: room.bbox.minX + step / 2, z: room.bbox.minZ + step / 2 }, probe: step },
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
    lattice: { origin: { x: box.x, z: box.z }, probe: TOP_PROBE_M },
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

/** The lattice index of `point` on `grid`'s probe lattice, as a key. */
function latticeKey(grid: Grid, point: Vec2): string {
  const dx = point.x - grid.lattice.origin.x;
  const dz = point.z - grid.lattice.origin.z;
  const a = Math.round((dx * grid.u.x + dz * grid.u.z) / grid.lattice.probe);
  const b = Math.round((dx * grid.v.x + dz * grid.v.z) / grid.lattice.probe);
  return `${a},${b}`;
}

/**
 * Judges one pose per lattice point of every grid (narrowed per grid and per
 * row), and rasterises each legal footprint onto the grid of the surface it
 * stands on. From every legal lattice pose it then walks toward each illegal
 * neighbour by halving the step (`EDGE_HALVINGS`), so the edge of the field
 * is where the legal poses end, not where the lattice last met one; and
 * between two illegal neighbours that fail for different reasons it looks
 * for a place the object only just fits (`SLIVER_SAMPLES`).
 */
function fill(drag: DragContext, item: LintItem, grids: readonly Grid[], floorY: number): void {
  const byKey = new Map(grids.map((grid) => [grid.key, grid]));
  const floors = grids.filter((grid) => grid.y === floorY);
  // A wall snap pulls a pose up to `WALL_SNAP_M` onto its face: inside the slack, so only a snap that turned it re-judges.
  const reach = Math.hypot(item.dims[0], item.dims[2]) / 2 + TOUCH_PAD_M + (drag.facts.wallSnap ? WALL_SNAP_M : 0);
  /** Judges the pose at `point` and paints its footprint when it is legal. */
  const paint = (row: DragContext, point: Vec2): Misfit => {
    const {
      placed,
      misfit,
      item: moved,
    } = probePose(row, {
      kind: 'plan',
      point,
      rotationY: item.angle,
      y: item.placement.position.y,
      snap: true,
    });
    if (misfit !== null) return misfitOf(row, misfit, moved);
    const legal = coverOf(moved);
    const target = placed.host === null ? floors : [byKey.get(placed.host)].filter((found): found is Grid => found !== undefined);
    for (const surface of target) rasterise(surface, legal);
    return null;
  };
  for (const grid of grids) {
    const verdicts = new Map<string, Misfit>();
    const judged: Array<{ row: DragContext; point: Vec2; misfit: Misfit }> = [];
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
      // (`probePose` judges a pose whose body left the box, carried out by the wall snap or by a
      // search toward a neighbour, against its own surroundings).
      const row = narrowDrag(drag, { minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: maxZ + reach });
      for (const point of rowCentres) {
        const misfit = paint(row, point);
        verdicts.set(latticeKey(grid, point), misfit);
        judged.push({ row, point, misfit });
      }
    }
    const { probe } = grid.lattice;
    const at = (point: Vec2, step: Vec2, share: number): Vec2 => ({
      x: point.x + step.x * probe * share,
      z: point.z + step.z * probe * share,
    });
    const steps = [grid.u, { x: -grid.u.x, z: -grid.u.z }, grid.v, { x: -grid.v.x, z: -grid.v.z }];
    const snaps = drag.facts.wallSnap;
    /** Halves from the legal pose at `from` toward one step along `step`, painting every legal pose met; the share of the step reached. */
    const toLastLegal = (row: DragContext, from: Vec2, step: Vec2): number => {
      let low = 0;
      let high = 1;
      for (let halving = 0; halving < EDGE_HALVINGS; halving += 1) {
        const middle = (low + high) / 2;
        if (paint(row, at(from, step, middle)) === null) low = middle;
        else high = middle;
      }
      return low;
    };
    /**
     * Looks at `shares` of the step from `point` along `step`, then walks
     * sideways from the middle legal pose met to the last legal one each way:
     * a window found between two lattice points is narrow along the step and
     * may reach across it, where the lattice never looked.
     */
    const look = (row: DragContext, point: Vec2, step: Vec2, shares: readonly number[]): void => {
      const legal = shares.filter((share) => paint(row, at(point, step, share)) === null);
      if (legal.length === 0) return;
      const middle = at(point, step, legal[Math.floor(legal.length / 2)]!);
      for (const side of steps) if (side.x * step.x + side.z * step.z === 0) toLastLegal(row, middle, side);
    };
    const sliver = Array.from({ length: SLIVER_SAMPLES - 1 }, (_, index) => (index + 1) / SLIVER_SAMPLES);
    for (const { row, point, misfit } of judged) {
      for (const step of steps) {
        const next = verdicts.get(latticeKey(grid, at(point, step, 1)));
        if (misfit === null) {
          if (next === null) continue;
          // Legal at 0, not at 1 (or off the lattice): halve toward the last legal pose.
          const reached = toLastLegal(row, point, step);
          if (reached === 0) continue;
          // A corner of the field cut off both ways (the floor's outline ahead,
          // an object to the side) holds legal poses no straight walk from a
          // lattice point meets: walk sideways from the farthest one as well,
          // wherever the lattice neighbour that way is not legal.
          const farthest = at(point, step, reached);
          for (const side of steps) {
            if (side.x * step.x + side.z * step.z !== 0) continue;
            if (verdicts.get(latticeKey(grid, at(point, side, 1))) === null) continue;
            toLastLegal(row, farthest, side);
          }
        } else if (next === undefined && snaps && !towardEdge(misfit, step)) {
          // Through the outline on this side already, so only the wall snap
          // can still help: a pose whose back comes within `WALL_SNAP_M` of
          // the face is pulled onto it, and that band, on a 0.2 m floor grid
          // narrower than the step but wider than half of it, holds one of
          // these two.
          look(row, point, step, [0.5, 1]);
        } else if (
          next === undefined
            ? towardEdge(misfit, step)
            : next !== null && (step === grid.u || step === grid.v) && windowBetween(misfit, next, step)
        ) {
          // Two neighbours that fail for different reasons (one bumps the
          // nightstand, the next the wardrobe or a door's clear zone, or they
          // cross opposite walls), or a point next to the room's edge where
          // the lattice has no neighbour, may hold a window between them that
          // both miss: look at every eighth of the step, once per pair.
          look(row, point, step, sliver);
        }
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
