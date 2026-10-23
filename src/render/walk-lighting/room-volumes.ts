/**
 * The rooms as volumes for walk and tour lighting: each room split into
 * axis-aligned boxes, each box with the three boxes its grid and its
 * reflections need, one reflection probe point per room, and the order the
 * grids are listed in.
 *
 * Boxes per room box:
 * - projection: the room box from the floor to the ceiling, what a reflection
 *   is box-projected onto;
 * - sampling: the projection box inset by `samplingInsetM`, the grid's own
 *   volume (three puts its probes ON that box's surface, so an uninset grid
 *   would bake probes inside the walls);
 * - selection: the room box grown to the wall centreline and past the floor
 *   and the ceiling, the box an object's origin is tested against.
 *
 * Order invariant: three gives an object the FIRST grid whose box contains
 * its origin, so an origin on a shared centreline (a door frame, a door leaf
 * on its hinge) goes to the room listed first. `roomOrder` lists the room a
 * door leaf swings into before the room on the other side.
 *
 * Pure module: no `three`, no DOM.
 */

import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';

type Vec2 = { readonly x: number; readonly z: number };
export type Vec3 = { x: number; y: number; z: number };
export type Box = { min: Vec3; max: Vec3 };
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/** One room as the volumes see it: its polygon and half the thickness of its walls. */
export type VolumeRoom = { roomId: string; polygon: readonly Vec2[]; halfWall: number };
/** A door: the room its leaf swings into, and the room on the other side (`null` outside). */
export type VolumeDoor = { into: string; other: string | null };

export type VolumeInput = {
  rooms: readonly VolumeRoom[];
  ceilingHeight: number;
  doors: readonly VolumeDoor[];
  /** Furniture footprints in plan, which a probe point steps off. */
  furniture: readonly Rect[];
};

export type RoomBox = {
  roomId: string;
  projection: Box;
  sampling: Box;
  selection: Box;
  /** Probes along each axis of the sampling box. */
  resolution: Vec3;
};

export type RoomProbe = { roomId: string; position: Vec3 };

export type RoomVolumes = {
  /** Every room box, in grid order. */
  boxes: RoomBox[];
  /** One probe per room, in grid order. */
  probes: RoomProbe[];
  /** The rooms' bounds from the floor to the ceiling. */
  bounds: Box;
};

export type VolumesResult = { ok: true; volumes: RoomVolumes } | { ok: false; error: string };

/** Coordinates closer than this are one coordinate, metres. */
const SNAP_M = 1e-6;
/** Grid step of the probe point search, metres. */
const PROBE_SEARCH_STEP_M = 0.1;

/** Whether `p` lies inside `polygon` (even-odd). */
function inside(p: Vec2, polygon: readonly Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** Distance from `p` to the nearest edge of `polygon`. */
function edgeDistance(p: Vec2, polygon: readonly Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)));
  }
  return best;
}

/** Sorted distinct values. */
function distinct(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.filter((value, i) => i === 0 || value - sorted[i - 1]! > SNAP_M);
}

/** Whether the edge from `a` to `b` is neither vertical nor horizontal in plan. */
function slanted(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) > SNAP_M && Math.abs(a.z - b.z) > SNAP_M;
}

/** The maximal runs of consecutive slanted edges, as their points. */
function slantedChains(polygon: readonly Vec2[]): Vec2[][] {
  const n = polygon.length;
  const isSlanted = (i: number): boolean => slanted(polygon[i % n]!, polygon[(i + 1) % n]!);
  // Start after a straight edge so no chain wraps around the start.
  const start = Array.from({ length: n }, (_, i) => i).find((i) => !isSlanted(i));
  if (start === undefined) return [[...polygon]];
  const chains: Vec2[][] = [];
  let chain: Vec2[] | null = null;
  for (let k = 1; k <= n; k += 1) {
    const i = (start + k) % n;
    if (isSlanted(i)) {
      chain ??= [polygon[i]!];
      chain.push(polygon[(i + 1) % n]!);
    } else if (chain) {
      chains.push(chain);
      chain = null;
    }
  }
  if (chain) chains.push(chain);
  return chains;
}

/**
 * The polygon as axis-aligned boxes. The cuts are the coordinates of its
 * axis-aligned edges and its bounding rectangle, so a curved run (a bay) is
 * covered by the rectangle around it; cells whose centre is inside are kept,
 * merged into runs along x and runs of equal span along z.
 */
export function rectilinearBoxes(polygon: readonly Vec2[]): Rect[] {
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const vertical = Math.abs(a.x - b.x) <= SNAP_M;
    const horizontal = Math.abs(a.z - b.z) <= SNAP_M;
    if (vertical) xs.push(a.x);
    if (horizontal) zs.push(a.z);
  }
  // A slanted or curved run cuts at its extents only, so the rectangle around it is one cell.
  for (const chain of slantedChains(polygon)) {
    xs.push(Math.min(...chain.map((p) => p.x)), Math.max(...chain.map((p) => p.x)));
    zs.push(Math.min(...chain.map((p) => p.z)), Math.max(...chain.map((p) => p.z)));
  }
  xs.push(Math.min(...polygon.map((p) => p.x)), Math.max(...polygon.map((p) => p.x)));
  zs.push(Math.min(...polygon.map((p) => p.z)), Math.max(...polygon.map((p) => p.z)));
  const cutX = distinct(xs);
  const cutZ = distinct(zs);
  const rows: Rect[][] = [];
  for (let j = 0; j + 1 < cutZ.length; j += 1) {
    const runs: Rect[] = [];
    for (let i = 0; i + 1 < cutX.length; i += 1) {
      const centre = { x: (cutX[i]! + cutX[i + 1]!) / 2, z: (cutZ[j]! + cutZ[j + 1]!) / 2 };
      if (!inside(centre, polygon)) continue;
      const last = runs.at(-1);
      if (last && Math.abs(last.maxX - cutX[i]!) <= SNAP_M) last.maxX = cutX[i + 1]!;
      else runs.push({ minX: cutX[i]!, maxX: cutX[i + 1]!, minZ: cutZ[j]!, maxZ: cutZ[j + 1]! });
    }
    rows.push(runs);
  }
  const boxes: Rect[] = [];
  let open: Rect[] = [];
  for (const runs of rows) {
    const next: Rect[] = [];
    for (const run of runs) {
      const above = open.find(
        (box) =>
          Math.abs(box.minX - run.minX) <= SNAP_M && Math.abs(box.maxX - run.maxX) <= SNAP_M && Math.abs(box.maxZ - run.minZ) <= SNAP_M,
      );
      if (above) {
        above.maxZ = run.maxZ;
        next.push(above);
      } else {
        boxes.push(run);
        next.push(run);
      }
    }
    open = next;
  }
  return boxes;
}

/**
 * The room's reflection probe: the interior point farthest from the room's
 * edges, at the probe height, preferring points outside every furniture
 * footprint.
 */
export function probePoint(polygon: readonly Vec2[], furniture: readonly Rect[]): Vec3 {
  const minX = Math.min(...polygon.map((p) => p.x));
  const maxX = Math.max(...polygon.map((p) => p.x));
  const minZ = Math.min(...polygon.map((p) => p.z));
  const maxZ = Math.max(...polygon.map((p) => p.z));
  let best: { point: Vec2; score: number; free: boolean } | null = null;
  for (let x = minX + PROBE_SEARCH_STEP_M / 2; x < maxX; x += PROBE_SEARCH_STEP_M) {
    for (let z = minZ + PROBE_SEARCH_STEP_M / 2; z < maxZ; z += PROBE_SEARCH_STEP_M) {
      const point = { x, z };
      if (!inside(point, polygon)) continue;
      const free = !furniture.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
      // Ties (a long room's centre line) go to the point nearest the middle of the room.
      const score = edgeDistance(point, polygon) - 1e-3 * Math.hypot(x - (minX + maxX) / 2, z - (minZ + maxZ) / 2);
      if (!best || (free && !best.free) || (free === best.free && score > best.score)) best = { point, score, free };
    }
  }
  const point = best?.point ?? polygon[0] ?? { x: 0, z: 0 };
  return { x: point.x, y: T.probeHeightM, z: point.z };
}

/**
 * The rooms in grid order: every room a door leaf swings into before the room
 * on the other side, otherwise in the order given. A cycle is broken by the
 * order given.
 */
export function roomOrder(roomIds: readonly string[], doors: readonly VolumeDoor[]): string[] {
  const before = new Map<string, Set<string>>(roomIds.map((id) => [id, new Set<string>()]));
  for (const door of doors) {
    if (door.other !== null && before.has(door.into) && before.has(door.other)) before.get(door.other)!.add(door.into);
  }
  const placed: string[] = [];
  const left = [...roomIds];
  while (left.length > 0) {
    const index = left.findIndex((id) => [...before.get(id)!].every((need) => placed.includes(need) || !left.includes(need)));
    const [next] = left.splice(index === -1 ? 0 : index, 1);
    placed.push(next!);
  }
  return placed;
}

const box = (rect: Rect, y0: number, y1: number, grow: number): Box => ({
  min: { x: rect.minX - grow, y: y0, z: rect.minZ - grow },
  max: { x: rect.maxX + grow, y: y1, z: rect.maxZ + grow },
});

/** Probes along a sampling extent: about one per `gridSpacingM`, at least two. */
const probesAlong = (extent: number): number => Math.max(2, Math.round(extent / T.gridSpacingM) + 1);

/** Every room box with its three boxes, the probes and the bounds; refused past `maxBoxes`. */
export function roomVolumes(input: VolumeInput): VolumesResult {
  const order = roomOrder(
    input.rooms.map((room) => room.roomId),
    input.doors,
  );
  const byId = new Map(input.rooms.map((room) => [room.roomId, room]));
  const height = input.ceilingHeight;
  const inset = T.samplingInsetM;
  const boxes: RoomBox[] = [];
  const probes: RoomProbe[] = [];
  for (const roomId of order) {
    const room = byId.get(roomId)!;
    for (const rect of rectilinearBoxes(room.polygon)) {
      const sampling = box(
        { minX: rect.minX + inset, maxX: rect.maxX - inset, minZ: rect.minZ + inset, maxZ: rect.maxZ - inset },
        inset,
        height - inset,
        0,
      );
      boxes.push({
        roomId,
        projection: box(rect, 0, height, 0),
        sampling,
        selection: box(rect, -T.selectionPadM, height + T.selectionPadM, room.halfWall),
        resolution: { x: probesAlong(sampling.max.x - sampling.min.x), y: T.gridLayers, z: probesAlong(sampling.max.z - sampling.min.z) },
      });
    }
    probes.push({ roomId, position: probePoint(room.polygon, input.furniture) });
  }
  if (boxes.length > T.maxBoxes) {
    return { ok: false, error: `the plan has ${boxes.length} room boxes; room lighting takes at most ${T.maxBoxes}` };
  }
  const all = input.rooms.flatMap((room) => room.polygon);
  const bounds: Box = {
    min: { x: Math.min(...all.map((p) => p.x)), y: 0, z: Math.min(...all.map((p) => p.z)) },
    max: { x: Math.max(...all.map((p) => p.x)), y: height, z: Math.max(...all.map((p) => p.z)) },
  };
  return { ok: true, volumes: { boxes, probes, bounds } };
}
