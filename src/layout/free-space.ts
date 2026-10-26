/**
 * Where a new object fits in a room, as a pose a caller turns into
 * `place_object`.
 *
 * This is a QUERY, not an operation: the answer is a room, a position and a
 * yaw, and the caller — a host editor's catalogue dialog — composes the
 * operation itself. Nothing here mutates a
 * document, knows about a shop, or decides whether furniture FITS on its own:
 * the layout linter still owns that judgement, and this module simply ASKS it
 * in advance, over candidate scenes it throws away.
 *
 * Invariant: it never throws, never mutates its inputs, and never answers a
 * position outside the room polygon. With no `rng` the sampler is a fixed-seed
 * mulberry32, so the same request answers the same pose — an undo and a repeat
 * of a catalogue click land the sofa in the same spot.
 *
 * Cost, measured on the demo apartment (59 objects, 2026-10-21): one
 * `lintLayout` is about 21 ms and a call runs at most `LINT_CANDIDATES + 1` of
 * them, so the worst case measured was 60 ms (`stool_bar` into the living
 * room) — a click on a catalogue card, not a frame. The
 * candidate plan is never re-solved: `place_object` touches only
 * `scene.assets`, and a `SolvedPlan` is derived from nodes, walls and rooms,
 * which saves 0.5 ms of `solvePlan` per candidate.
 *
 * Wall and ceiling archetypes are judged
 * by the drag tool's own per-item judge (`asset-legality.ts`): a wall piece
 * takes the first free span of the room's faces, longest first, at its mount
 * height; a ceiling piece the free point nearest the room's interior point.
 *
 * Pure module: no `three`, no DOM.
 */

import { distanceToPolygon, obbQuad, pointInPolygon, signedArea, type Obb } from '../plan/plan-geometry.js';
import { doorSweepQuads } from '../plan/door-swing.js';
import { overlapDepth, roomCentroid } from './layout-geometry.js';
import { lintContext, lintLayout, shippedFacts, type LayoutCatalogue, type LayoutFacts } from './layout-lint.js';
import { TOUCH_TOL_M, boxGap, doorClearZone, nearestFace, type LintContext } from './rules/context.js';
import type { LayoutIssue } from './layout-issue.js';
import { judge, poseItem, wallPose, type DragContext, type DragPose } from './asset-legality.js';
import type { RoomFace, SolvedPlan, WallFace } from '../plan/plan-solver.js';
import type { DemoAsset, SceneData, Vec2, Vec3 } from '../scene/types.js';

/* ------------------------------------------------------------- tunables --- */

/** Free floor a sampled pose keeps beyond its own reach, metres. */
const WALL_MARGIN_M = 0.4;
/** Rejection samples a request that names no budget of its own takes. */
const DEFAULT_TRIES = 64;
/** Hard ceiling on `request.tries`: a query may not order a million samples. */
const MAX_TRIES = 512;
/** Survivors handed to the full linter — the top of a "first three to five" shortlist. */
const LINT_CANDIDATES = 5;
/** Step of the interior-point scan a concave room falls back on, metres. */
const SCAN_STEP_M = 0.1;
/** Golden-ratio seed of the default sampler: any constant would do, this one is the conventional choice. */
const DEFAULT_SEED = 0x9e3779b9;
/** Id the probe placement carries while it is judged; it never reaches the answer. */
const PROBE_ID = '__free-space-probe';

/* ---------------------------------------------------------------- model --- */

/** What the caller asks for: a scene, its solved plan, and the asset it wants somewhere sensible. */
export type PlacementRequest = {
  scene: SceneData;
  plan: SolvedPlan;
  /** Catalogue reference: a bare archetype or variant UUID (`DemoAsset.asset`). */
  asset: string;
  /** UUID of the library `asset` belongs to, as `place_object.library`; absent: the document's `assetLibrary`, then the built-in bank. */
  library?: string | undefined;
  /** Room to place into; absent (or unknown to the plan) means the largest room. */
  roomId?: string | undefined;
  /** Catalogue variant chosen before the placement: a size variant changes the footprint. */
  variant?: string | undefined;
  /** Object bank; absent is the shipped one, a bake passes `projectLayoutCatalogue(library)`. */
  catalogue?: LayoutCatalogue | undefined;
  /** Uniform `[0, 1)` source; absent is a fixed-seed mulberry32, so the answer is reproducible. */
  rng?: (() => number) | undefined;
  /** Rejection-sampling budget, default 64, clamped to `[1, 512]`. */
  tries?: number | undefined;
};

/** Where to put it. A pose, never an operation: the caller composes `place_object`. */
export type PlacementSuggestion = {
  roomId: string;
  position: Vec3;
  rotationY: number;
  /**
   * `sampled` a free floor pose, `wall-span` the first free span of a face,
   * `ceiling` a free point under the room's ceiling, `room-centre` the
   * fallback a `warning` explains.
   */
  how: 'sampled' | 'wall-span' | 'ceiling' | 'room-centre';
  /**
   * Why the answer is a fallback. `unsupported-anchor` is RETIRED (wall and
   * ceiling archetypes are placed now)
   * and never produced; the member stays for one release so a host that still
   * names it compiles.
   */
  warning?: 'no-free-space' | 'unknown-asset' | 'no-rooms' | 'unsupported-anchor';
};

/** A pose that survived the cheap filters and is waiting for the full linter. */
type Candidate = { position: Vec3; rotationY: number };

/** Everything the sampler reads, prepared once per call. */
type Attempt = {
  room: RoomFace;
  plan: SolvedPlan;
  ctx: LintContext;
  facts: LayoutFacts;
  footprint: { hx: number; hz: number };
  /** Door clear zones and leaf sweeps a pose may not touch. */
  zones: readonly Vec2[][];
  /** Longest face of the room, which decides the yaw of a free-standing object. */
  dominant: WallFace | null;
};

/* ------------------------------------------------------------------ rng --- */

/**
 * Mulberry32: a 32-bit seeded PRNG in eight lines, uniform on `[0, 1)`.
 *
 * Not a dependency and not `Math.random`: the whole point of this module is
 * that the same request answers the same pose, so a catalogue click a user undoes
 * and repeats lands the sofa in the same spot.
 */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------ strategies --- */

/**
 * The placement as the object bank sees it.
 *
 * `DemoAssetType` is an open union, so the reference doubles as the `type`; and
 * because `asset` is set, the bank reports no legacy facing compensation
 * (`yaw: 0`) — exactly what `applyPlaceObject` will write, which is why the
 * yaw computed here is the yaw the linter later reads.
 */
function probeOf(request: PlacementRequest, id: string, position: Vec3, rotationY: number): DemoAsset {
  return {
    id,
    type: request.asset,
    asset: request.asset,
    ...(request.library === undefined ? {} : { library: request.library }),
    position,
    rotationY,
    ...(request.variant === undefined ? {} : { variant: request.variant }),
  };
}

/**
 * A probe id no placement of the scene already carries.
 *
 * `PROBE_ID` is not a UUID, so no valid document can carry it; but this
 * module never validates the scene it is handed, and a duplicate id would
 * MASK a real fault: every rule keys its issue by `placement.id`, so an error
 * the probe introduces could collapse onto a baseline key owned by the other
 * object of the same id and read as "nothing new". The probe is never stored
 * or emitted, so suffixing it until it is free mints nothing.
 */
function probeIdOf(scene: SceneData): string {
  const taken = new Set(scene.assets.map((asset) => asset.id));
  let id = PROBE_ID;
  for (let attempt = 0; taken.has(id); attempt += 1) id = `${PROBE_ID}-${attempt}`;
  return id;
}

/** The named room, else the largest one; an id the plan does not carry is "absent". */
function pickRoom(plan: SolvedPlan, roomId: string | undefined): RoomFace | null {
  if (roomId !== undefined) {
    const named = plan.rooms.find((room) => room.roomId === roomId);
    if (named) return named;
  }
  let best: RoomFace | null = null;
  let bestArea = Number.NEGATIVE_INFINITY;
  for (const room of plan.rooms) {
    const area = Math.abs(signedArea(room.polygon));
    if (area <= bestArea) continue;
    bestArea = area;
    best = room;
  }
  return best;
}

/**
 * A point inside the room: its centroid when the polygon contains it, else the
 * deepest cell of a `SCAN_STEP_M` scan (a concave room's centroid lies in its
 * notch).
 *
 * The last resort is the BOUNDARY point nearest the centroid, never the vertex
 * average: a room thinner than the scan lattice has no interior cell at all,
 * and `quadCentre` of a concave polygon lands in the notch — outside the room,
 * which the header promises never to answer. `pointInPolygon` counts the
 * boundary as inside, so a point on it keeps the promise.
 */
function interiorPoint(room: RoomFace): Vec2 {
  const centroid = roomCentroid(room.polygon);
  if (pointInPolygon(centroid, room.polygon)) return centroid;
  let best: Vec2 | null = null;
  let bestDistance = Number.NEGATIVE_INFINITY;
  for (let z = room.bbox.minZ; z <= room.bbox.maxZ; z += SCAN_STEP_M) {
    for (let x = room.bbox.minX; x <= room.bbox.maxX; x += SCAN_STEP_M) {
      const point: Vec2 = { x, z };
      if (!pointInPolygon(point, room.polygon)) continue;
      const { distance } = distanceToPolygon(point, room.polygon);
      if (distance <= bestDistance) continue;
      bestDistance = distance;
      best = point;
    }
  }
  return best ?? distanceToPolygon(centroid, room.polygon).closest;
}

/**
 * The yaw whose front looks the way `normal` points.
 *
 * `itemsOf` reads a placement's front as `(-sin facing, -cos facing)` and a
 * `WallFace.normal` points from the wall INTO its room, so feeding the face
 * normal in turns the object's back on that wall.
 */
function yawFacingAwayFrom(normal: Vec2): number {
  return Math.atan2(-normal.x, -normal.z);
}

/** Longest face of the room's loop — `WallFace.length` is the true length, arc and mitre included. */
function dominantFace(room: RoomFace): WallFace | null {
  let best: WallFace | null = null;
  for (const face of room.loop) if (!best || face.length > best.length) best = face;
  return best;
}

/** Back to the nearest wall for a wall-snap archetype, along the dominant face otherwise. */
function yawAt(attempt: Attempt, point: Vec2): number {
  if (attempt.facts.wallSnap) {
    const near = nearestFace(attempt.plan, attempt.room.roomId, point);
    if (near) return yawFacingAwayFrom(near.face.normal);
  }
  return attempt.dominant === null ? 0 : yawFacingAwayFrom(attempt.dominant.normal);
}

/** Every door zone of this room a pose must stay out of: rule 3's clear zones AND rule 4's leaf sweep. */
function blockedZones(ctx: LintContext, roomId: string): Vec2[][] {
  const zones: Vec2[][] = [];
  for (const door of ctx.doors) {
    const sides = door.sides.filter((side) => side.roomId === roomId);
    if (sides.length === 0) continue;
    for (const side of sides) zones.push(doorClearZone(door, side.normal));
    if (door.swing) for (const quad of doorSweepQuads(door.swing)) zones.push(quad);
  }
  return zones;
}

/** True when the pose sits closer than its archetype's comfort gap to anything already placed. */
function crowdsAnItem(ctx: LintContext, box: Obb, clearance: number): boolean {
  for (const item of ctx.items) {
    if (!item.box) continue;
    if (boxGap(box, item.box) < clearance) return true;
  }
  return false;
}

/**
 * Rejection sampling over the room's bounding box, cheapest test first.
 *
 * The FILTER ORDER IS FIXED: it decides how many `rng` draws each attempt
 * spends and therefore what the answer is. Reordering these lines changes
 * every suggested pose, so the determinism test guards it.
 */
function sampleCandidates(attempt: Attempt, rng: () => number, tries: number): Candidate[] {
  const { hx, hz } = attempt.footprint;
  const reach = Math.max(hx, hz) + WALL_MARGIN_M;
  const { minX, maxX, minZ, maxZ } = attempt.room.bbox;
  const found: Candidate[] = [];
  for (let attemptIndex = 0; attemptIndex < tries && found.length < LINT_CANDIDATES; attemptIndex += 1) {
    const point: Vec2 = { x: minX + rng() * (maxX - minX), z: minZ + rng() * (maxZ - minZ) };
    if (!pointInPolygon(point, attempt.room.polygon)) continue;
    if (distanceToPolygon(point, attempt.room.polygon).distance < reach) continue;
    const rotationY = yawAt(attempt, point);
    const box: Obb = { x: point.x, z: point.z, hx, hz, angle: rotationY };
    if (crowdsAnItem(attempt.ctx, box, attempt.facts.clearance)) continue;
    const quad = obbQuad(box);
    if (attempt.zones.some((zone) => overlapDepth(quad, zone) > TOUCH_TOL_M)) continue;
    found.push({ position: { x: point.x, y: 0, z: point.z }, rotationY });
  }
  return found;
}

/** A layout error identified by what it says and about whom, so two lints can be compared. */
function issueKey(issue: LayoutIssue): string {
  return `${issue.rule}|${[...issue.ids].sort().join(',')}`;
}

function errorKeys(issues: readonly LayoutIssue[]): Set<string> {
  const keys = new Set<string>();
  for (const issue of issues) if (issue.severity === 'error') keys.add(issueKey(issue));
  return keys;
}

/**
 * The first candidate that adds no NEW layout error.
 *
 * Counting errors would not do: a pose that repairs one rule and breaks
 * another reports the same number. The baseline is the scene's OWN errors,
 * computed once, and a candidate is accepted when every error of the candidate
 * scene was already there — which on a clean scene is exactly the batch
 * `SceneModel.apply({ lint: 'strict' })` would commit.
 */
function firstCleanCandidate(request: PlacementRequest, catalogue: LayoutCatalogue, candidates: readonly Candidate[]): Candidate | null {
  const baseline = errorKeys(lintLayout(request.scene, request.plan, catalogue));
  const probeId = probeIdOf(request.scene);
  for (const candidate of candidates) {
    const probe = probeOf(request, probeId, candidate.position, candidate.rotationY);
    const scene: SceneData = { ...request.scene, assets: [...request.scene.assets, probe] };
    const errors = [...errorKeys(lintLayout(scene, request.plan, catalogue))];
    if (errors.every((key) => baseline.has(key))) return candidate;
  }
  return null;
}

/** The fallback answer: the room's own interior point, with the reason it was needed. */
function centreAnswer(
  roomId: string,
  point: Vec2,
  rotationY: number,
  warning: NonNullable<PlacementSuggestion['warning']>,
): PlacementSuggestion {
  return { roomId, position: { x: point.x, y: 0, z: point.z }, rotationY, how: 'room-centre', warning };
}

/** `request.tries` as an integer inside `[1, MAX_TRIES]`; nonsense reads as the default. */
function triesOf(tries: number | undefined): number {
  if (tries === undefined || !Number.isFinite(tries)) return DEFAULT_TRIES;
  return Math.min(MAX_TRIES, Math.max(1, Math.trunc(tries)));
}

/* ------------------------------------------------- wall and ceiling --- */

/** Step along a face, and across a ceiling, between two judged poses, metres. */
const MOUNT_SCAN_STEP_M = 0.1;
/** Centre height of a wall piece whose archetype names no mount, metres (art, layout rule 5 `wall-hung`). */
const DEFAULT_WALL_CENTRE_M = 1.5;

/** The probe as the drag judge reads it (`asset-legality.ts`): the scene without it, and its facts. */
function probeDrag(request: PlacementRequest, ctx: LintContext, facts: LayoutFacts): DragContext {
  return { ctx, facts, carried: [], placement: probeOf(request, probeIdOf(request.scene), { x: 0, y: 0, z: 0 }, 0) };
}

/** The centre height a wall archetype hangs at: its mount's centre, else its bottom plus half its height. */
function wallCentre(facts: LayoutFacts): number {
  const mount = facts.layout?.mount;
  if (mount?.centre !== undefined) return mount.centre;
  if (mount?.bottom !== undefined) return mount.bottom + facts.dims[1] / 2;
  return DEFAULT_WALL_CENTRE_M;
}

/**
 * The first free span on the room's faces, longest face first, facing in at
 * the archetype's mount height; else the middle of the longest face.
 */
function wallAnswer(request: PlacementRequest, ctx: LintContext, room: RoomFace, facts: LayoutFacts): PlacementSuggestion {
  const drag = probeDrag(request, ctx, facts);
  const y = wallCentre(facts);
  const faces = [...room.loop].sort((a, b) => b.length - a.length);
  for (const face of faces) {
    for (let t = facts.dims[0] / 2; t <= face.length - facts.dims[0] / 2; t += MOUNT_SCAN_STEP_M) {
      const pose = wallPose(drag, face, t, y);
      if (judge(ctx, poseItem(drag, pose)).ok)
        return { roomId: room.roomId, position: pose.position, rotationY: pose.rotationY, how: 'wall-span' };
    }
  }
  const longest = faces[0];
  if (!longest) return centreAnswer(room.roomId, interiorPoint(room), 0, 'no-free-space');
  const pose = wallPose(drag, longest, longest.length / 2, y);
  return { roomId: room.roomId, position: pose.position, rotationY: pose.rotationY, how: 'room-centre', warning: 'no-free-space' };
}

/**
 * The room's interior point under the ceiling plane (`y = 0` is «at the
 * ceiling»), or the nearest free point of a `MOUNT_SCAN_STEP_M` scan
 * when something already hangs there; a room without a ceiling (a loggia)
 * has no free ceiling at all.
 */
function ceilingAnswer(request: PlacementRequest, ctx: LintContext, room: RoomFace, facts: LayoutFacts): PlacementSuggestion {
  const drag = probeDrag(request, ctx, facts);
  const centre = interiorPoint(room);
  const at = (point: Vec2): DragPose => ({ position: { x: point.x, y: 0, z: point.z }, rotationY: 0 });
  const candidates: Vec2[] = [centre];
  const { minX, maxX, minZ, maxZ } = room.bbox;
  for (let z = minZ; z <= maxZ; z += MOUNT_SCAN_STEP_M) {
    for (let x = minX; x <= maxX; x += MOUNT_SCAN_STEP_M) if (pointInPolygon({ x, z }, room.polygon)) candidates.push({ x, z });
  }
  candidates.sort((a, b) => Math.hypot(a.x - centre.x, a.z - centre.z) - Math.hypot(b.x - centre.x, b.z - centre.z));
  for (const point of candidates) {
    if (judge(ctx, poseItem(drag, at(point))).ok)
      return { roomId: room.roomId, position: at(point).position, rotationY: 0, how: 'ceiling' };
  }
  return centreAnswer(room.roomId, centre, 0, 'no-free-space');
}

/* ------------------------------------------------------------------ api --- */

/**
 * A pose for `request.asset` in `request.roomId`, or the room's centre with the
 * reason no sample survived.
 *
 * Ordered strategies, cheapest first: the object bank answers what the asset
 * is, the plan answers which room, one `lintContext` prepares the geometry,
 * rejection sampling proposes up to `LINT_CANDIDATES` poses, and the full
 * linter judges them. No step throws; every refusal is a `warning` on an
 * otherwise usable pose.
 */
export function suggestPlacement(request: PlacementRequest): PlacementSuggestion {
  const catalogue = request.catalogue ?? shippedFacts;
  const facts = catalogue(probeOf(request, PROBE_ID, { x: 0, y: 0, z: 0 }, 0));
  const room = pickRoom(request.plan, request.roomId);
  if (room === null) {
    // Nothing to centre on: the plan carries no room at all. An unknown
    // `roomId` reads as absent, so only an empty `plan.rooms` arrives here.
    const { minX, maxX, minZ, maxZ } = request.plan.bounds;
    const centre: Vec2 = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    return centreAnswer(request.roomId ?? '', centre, 0, 'no-rooms');
  }
  if (facts === null) return centreAnswer(room.roomId, interiorPoint(room), 0, 'unknown-asset');
  const ctx = lintContext(request.scene, request.plan, catalogue);
  if (facts.anchor === 'wall') return wallAnswer(request, ctx, room, facts);
  if (facts.anchor === 'ceiling') return ceilingAnswer(request, ctx, room, facts);
  const footprint = facts.footprint;
  if (footprint === null) return centreAnswer(room.roomId, interiorPoint(room), 0, 'unknown-asset');

  const attempt: Attempt = {
    room,
    plan: request.plan,
    ctx,
    facts,
    footprint,
    zones: blockedZones(ctx, room.roomId),
    dominant: dominantFace(room),
  };
  const candidates = sampleCandidates(attempt, request.rng ?? mulberry32(DEFAULT_SEED), triesOf(request.tries));
  const chosen = candidates.length === 0 ? null : firstCleanCandidate(request, catalogue, candidates);
  if (chosen !== null) return { roomId: room.roomId, position: chosen.position, rotationY: chosen.rotationY, how: 'sampled' };
  const centre = interiorPoint(room);
  return centreAnswer(room.roomId, centre, yawAt(attempt, centre), 'no-free-space');
}
