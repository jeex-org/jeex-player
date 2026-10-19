/**
 * Openings in face coordinates and the analytic decomposition of a wall face
 * into rectangular quads (pier / sill / lintel).
 *
 * Invariant: `quadsArea(faceQuads(L, H, openings)) === L * H - sum of opening
 * areas`, exactly. The quads tile the face without overlapping, which is what
 * lets the builder skip CSG.
 *
 * Face coordinates: `t` runs along the face from its own start (`side: 'R'`
 * faces run from the wall's node `b` back to `a`), `y` runs up from the floor.
 *
 * Pure module: no `three`, no DOM.
 */

import { EPS } from './plan-geometry.js';
import { clamp } from '../shared/math.js';
import type { Opening, OpeningShape, OpeningType, Wall } from '../scene/types.js';
import { effectiveOpeningShape, isDoorLike } from '../scene/types.js';

/** Door head when the data does not give one, in metres. */
export const DEFAULT_DOOR_HEAD = 2.1;
/** Window sill when the data does not give one, in metres. */
export const DEFAULT_WINDOW_SILL = 0.9;
/** Window head when the data does not give one, in metres. */
export const DEFAULT_WINDOW_HEAD = 2.2;

export type FaceOpening = {
  id: string;
  type: OpeningType;
  t0: number;
  t1: number;
  sill: number;
  head: number;
  shape: OpeningShape;
};

export type FaceQuad = {
  t0: number;
  t1: number;
  y0: number;
  y1: number;
  kind: 'pier' | 'sill' | 'lintel';
};

/**
 * The one projection of an authored `Opening` onto absolute metres.
 *
 * Omitted `sill`/`head` mean "the default for this kind", NOT zero and not the
 * ceiling: a window without heights is 0.9 m to 2.2 m, a door 0 m to 2.1 m.
 * Renderer, operations and clamping all go through here, so editing an
 * opening's width can never silently move a head it never mentioned.
 */
export function effectiveOpening(opening: Opening, ceilingHeight: number): OpeningGeometry {
  const doorLike = isDoorLike(opening.type);
  const rawHead = opening.head ?? (doorLike ? DEFAULT_DOOR_HEAD : DEFAULT_WINDOW_HEAD);
  const rawSill = doorLike ? 0 : (opening.sill ?? DEFAULT_WINDOW_SILL);
  const head = Math.min(rawHead, Math.max(MIN_OPENING_HEIGHT, ceilingHeight - CEILING_OPENING_MARGIN));
  return {
    center: opening.center,
    width: opening.width,
    sill: Math.max(0, Math.min(rawSill, head)),
    head,
  };
}

function heightsOf(opening: Opening, ceiling: number): { sill: number; head: number } {
  const { sill, head } = effectiveOpening(opening, ceiling);
  return { sill, head };
}

/**
 * Project a wall's openings (measured along the centreline from node `a`) into
 * the coordinates of one face, clipping to `[faceT0, faceT0 + faceLength]`.
 */
export function openingsForFace(
  wall: Wall,
  wallLength: number,
  side: 'L' | 'R',
  faceT0: number,
  faceLength: number,
  ceiling: number,
): FaceOpening[] {
  const out: FaceOpening[] = [];
  for (const opening of wall.openings ?? []) {
    const c0 = opening.center - opening.width / 2;
    const c1 = opening.center + opening.width / 2;
    // An 'R' face is walked from node b back to node a, so t runs the other way.
    const from = side === 'L' ? c0 : wallLength - c1;
    const to = side === 'L' ? c1 : wallLength - c0;
    const t0 = Math.max(0, from - faceT0);
    const t1 = Math.min(faceLength, to - faceT0);
    if (t1 - t0 <= EPS) continue;
    const { sill, head } = heightsOf(opening, ceiling);
    out.push({ id: opening.id, type: opening.type, t0, t1, sill, head, shape: effectiveOpeningShape(opening) });
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

/**
 * Cut a `length x height` face into pier, sill and lintel quads. Overlapping
 * openings are merged by a left-to-right cursor, so no quad is emitted twice.
 */
export function faceQuads(length: number, height: number, openings: FaceOpening[]): FaceQuad[] {
  const quads: FaceQuad[] = [];
  const sorted = [...openings].sort((a, b) => a.t0 - b.t0);
  let cursor = 0;
  for (const opening of sorted) {
    const start = Math.max(cursor, opening.t0);
    const end = Math.min(length, opening.t1);
    if (end - start <= EPS) continue;
    if (start - cursor > EPS) quads.push({ t0: cursor, t1: start, y0: 0, y1: height, kind: 'pier' });
    if (opening.sill > EPS) quads.push({ t0: start, t1: end, y0: 0, y1: opening.sill, kind: 'sill' });
    if (height - opening.head > EPS) {
      quads.push({ t0: start, t1: end, y0: opening.head, y1: height, kind: 'lintel' });
    }
    cursor = end;
  }
  if (length - cursor > EPS) quads.push({ t0: cursor, t1: length, y0: 0, y1: height, kind: 'pier' });
  return quads;
}

export function quadsArea(quads: readonly FaceQuad[]): number {
  let total = 0;
  for (const q of quads) total += (q.t1 - q.t0) * (q.y1 - q.y0);
  return total;
}

// -------------------------------------------------------------- clamping --

/** Clear wall left on both sides of an opening, metres. */
export const OPENING_EDGE_MARGIN = 0.1;
/** Narrowest opening the clamp will produce, metres. */
const MIN_OPENING_WIDTH = 0.3;
/** Shortest opening the clamp will produce, metres. */
const MIN_OPENING_HEIGHT = 0.3;
/**
 * Clearance the head of an opening must keep below the ceiling, metres
 * (`head <= ceilingHeight - 0.05`). Shared by the clamp and by `scene-validator.ts`, so an operation can never produce a scene the
 * validator would refuse.
 */
export const CEILING_OPENING_MARGIN = 0.05;

/** Everything a clamp needs to know about the wall an opening lives on. */
export type OpeningBounds = {
  /** Centreline length of the wall, metres. */
  wallLength: number;
  ceilingHeight: number;
};

/** Absolute geometry of an opening along its wall, all metres. */
export type OpeningGeometry = { center: number; width: number; sill: number; head: number };

/**
 * Clamps an opening into its wall and under the ceiling (`set_opening`): the
 * opening stays whole inside the wall with a `OPENING_EDGE_MARGIN` reveal at
 * both ends,
 * `0 <= sill < head <= ceiling - CEILING_OPENING_MARGIN`, and a door-like
 * opening always starts at the floor.
 *
 * The result is guaranteed to satisfy `validateScene`'s opening invariants for
 * a wall of `bounds.wallLength`, which is what makes `set_opening` total: it
 * never fails on out-of-range numbers, it corrects them.
 */
export function clampOpening(type: OpeningType, requested: OpeningGeometry, bounds: OpeningBounds): OpeningGeometry {
  const usable = Math.max(0, bounds.wallLength - 2 * OPENING_EDGE_MARGIN);
  const width = clamp(requested.width, Math.min(MIN_OPENING_WIDTH, usable), usable);
  const half = width / 2;
  const center = clamp(requested.center, OPENING_EDGE_MARGIN + half, bounds.wallLength - OPENING_EDGE_MARGIN - half);
  const maxHead = Math.max(MIN_OPENING_HEIGHT, bounds.ceilingHeight - CEILING_OPENING_MARGIN);
  const head = clamp(requested.head, MIN_OPENING_HEIGHT, maxHead);
  const sill = isDoorLike(type) ? 0 : clamp(requested.sill, 0, Math.max(0, head - MIN_OPENING_HEIGHT));
  return { center, width, sill, head };
}
