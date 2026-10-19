/**
 * Openings on CURVED walls: the chords an opening span is cut into, and the
 * placement of every box and pane its frame is built from.
 *
 * A window on an arc cannot be one flat rectangle. With the demo bay
 * (`R = 1.6`, chord `3.2`) a 2.6 m opening has a sagitta of ~0.5 m, so a
 * straight frame leaves the wall on both sides while the wall cut — quads per
 * chord of the discretised face — follows the arc. This module produces the
 * faceted equivalent: head and sill bands, glazing bars, glass panes, jambs
 * and the interior sill board, all per chord.
 *
 * Invariants:
 * - the chords tile `[t0, t1]` of the centreline arc EXACTLY, and every
 *   interior chord boundary is a vertex of the wall's own arc discretisation
 *   (`arcSegments(radius, sweep)`), so the frame facets line up with the
 *   wall-cut facets instead of crossing them;
 * - every frame box stays inside the wall: its centre is on the centreline
 *   arc and its radial half-size is `depth / 2`, so no vertex is further than
 *   `depth / 2` from the circle. The interior sill board is the one part that
 *   deliberately protrudes — it is a windowsill — and carries its own radius.
 *
 * Coordinates are plan metres `(x, z)` with `y` up, exactly as everywhere else.
 * Pure module: no `three`, no DOM.
 */

import type { ArcDef } from './plan-geometry.js';
import { ARC_TOL, EPS, arcLength, arcSegments, dist, norm, sub } from './plan-geometry.js';
import { clamp } from '../shared/math.js';
import { GLAZING_BAR_M, SASH_BAR_M } from './opening-geometry.js';
import type { Vec2 } from '../scene/types.js';

/** Overhang of the interior sill board past the opening at each end, metres. */
export const SILL_BOARD_OVERHANG_M = 0.06;
/** How far the sill board stands off the interior wall face, metres. */
export const SILL_BOARD_STANDOFF_M = 0.07;
/** Thickness (vertical) of the sill board, metres. */
const SILL_BOARD_THICKNESS_M = 0.035;
/** Depth of the sill board across the wall, metres. */
export const SILL_BOARD_DEPTH_M = 0.18;

/** One chord of the discretised opening span. */
export type ChordSpan = {
  /** Arc-length parameters of the chord ends on the CENTRELINE, from node `a`. */
  t0: number;
  t1: number;
  /** Arc angles of the chord ends, radians. */
  angle0: number;
  angle1: number;
  /** Chord ends, on the circle this span was generated for. */
  start: Vec2;
  end: Vec2;
  /** Chord midpoint: it sits one sagitta INSIDE the circle. */
  mid: Vec2;
  /** Unit direction `start -> end`. */
  tangent: Vec2;
  /** Unit radial at the chord midpoint, pointing AWAY from the arc centre. */
  outward: Vec2;
  /** Chord length (shorter than `t1 - t0`, by the discretisation error). */
  length: number;
  /** Angular width of the chord, radians, always positive. */
  angularWidth: number;
};

/** What a curved opening part is: everything but `pane` is a box. */
export type CurvedPartRole = 'jamb' | 'head' | 'sill' | 'bar-vertical' | 'bar-horizontal' | 'sill-board' | 'pick';

/** One box of a curved opening, in plan metres. */
export type CurvedBox = {
  role: CurvedPartRole;
  /** Centre of the box in plan. */
  centre: Vec2;
  /** Height of the box centre above the floor. */
  y: number;
  /** Size along `tangent`. */
  length: number;
  /** Vertical size. */
  height: number;
  /** Size across the wall (radial). */
  depth: number;
  /** Unit plan direction of the box's own length axis. */
  tangent: Vec2;
};

/** One flat glass pane, on the chord it belongs to. */
export type CurvedPane = {
  centre: Vec2;
  y: number;
  /** Size along `tangent`. */
  width: number;
  height: number;
  tangent: Vec2;
};

export type CurvedOpeningInput = {
  /** Centreline arc of the wall. */
  arc: ArcDef;
  thickness: number;
  /** Opening span along the centreline, arc length from node `a`. */
  t0: number;
  t1: number;
  sill: number;
  head: number;
  frameWidth: number;
  frameDepth: number;
  /** `+1` when the room lies OUTSIDE the centreline circle, `-1` when inside. */
  interiorOutward: 1 | -1;
  /** Window glazing; omitted for a door or a passage (frame only). */
  glazing?: { panes: 1 | 2 | 3; mullions: 'none' | 'vertical' | 'grid' } | undefined;
  /** Depth of the glazing bars across the wall; defaults to `0.6 * frameDepth`. */
  barDepth?: number;
  /** Build the interior sill board. */
  sillBoard?: boolean;
  /** Depth of the (invisible) pick proxy across the wall. */
  pickDepth?: number;
  /** Sagitta budget of the discretisation; the wall's own `ARC_TOL`. */
  tol?: number;
};

export type CurvedOpeningParts = {
  chords: ChordSpan[];
  boxes: CurvedBox[];
  panes: CurvedPane[];
};

function pointOn(arc: ArcDef, angle: number, radius: number): Vec2 {
  return { x: arc.centre.x + radius * Math.cos(angle), z: arc.centre.z + radius * Math.sin(angle) };
}

/**
 * Chord boundaries of the wall's own discretisation that fall inside
 * `[from, to]`, plus the two ends. The interior boundaries are exactly the
 * vertices `arcSegments` puts on the centreline, which is what keeps the frame
 * facets in step with the wall-cut facets.
 */
export function chordBoundaries(arc: ArcDef, from: number, to: number, tol: number = ARC_TOL): number[] {
  const total = arcLength(arc);
  if (!(total > EPS)) return [];
  const lo = clamp(Math.min(from, to), 0, total);
  const hi = clamp(Math.max(from, to), 0, total);
  if (hi - lo <= EPS) return [];
  const count = arcSegments(arc.radius, arc.sweep, tol);
  const step = total / count;
  const out: number[] = [lo];
  for (let k = 1; k < count; k += 1) {
    const t = k * step;
    if (t > lo + EPS && t < hi - EPS) out.push(t);
  }
  out.push(hi);
  return out;
}

/**
 * Chords of `[from, to]`, optionally on a CONCENTRIC circle
 * (`radiusDelta != 0`) but always cut at the centreline's own boundaries, so a
 * band offset from the wall (the sill board) keeps the same facets as the
 * frame and its segments meet corner to corner.
 */
export function chordSpans(arc: ArcDef, from: number, to: number, tol: number = ARC_TOL, radiusDelta = 0): ChordSpan[] {
  const total = arcLength(arc);
  const boundaries = chordBoundaries(arc, from, to, tol);
  if (boundaries.length < 2) return [];
  const radius = arc.radius + radiusDelta;
  const spans: ChordSpan[] = [];
  for (let i = 0; i + 1 < boundaries.length; i += 1) {
    const t0 = boundaries[i]!;
    const t1 = boundaries[i + 1]!;
    const angle0 = arc.a0 + (arc.sweep * t0) / total;
    const angle1 = arc.a0 + (arc.sweep * t1) / total;
    const start = pointOn(arc, angle0, radius);
    const end = pointOn(arc, angle1, radius);
    const length = dist(start, end);
    if (length <= EPS) continue;
    const mid = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
    spans.push({
      t0,
      t1,
      angle0,
      angle1,
      start,
      end,
      mid,
      tangent: norm(sub(end, start)),
      outward: norm(sub(mid, arc.centre)),
      length,
      angularWidth: Math.abs(angle1 - angle0),
    });
  }
  return spans;
}

/**
 * One band of boxes over `[tFrom, tTo]`, one per chord it crosses.
 *
 * Two boxes that meet at a chord boundary open a wedge on the OUTER side of
 * the turn, exactly as two prisms of a chorded wall face do. A box cannot
 * share a bisector normal the way the face prisms do, so each segment is
 * lengthened by `depth / 2 * tan(halfAngle)` at every interior boundary: the
 * outer corners then touch and the boxes overlap slightly on the inner side,
 * which is invisible inside solid timber.
 */
function band(
  chords: ChordSpan[],
  role: CurvedPartRole,
  tFrom: number,
  tTo: number,
  y0: number,
  y1: number,
  depth: number,
  radial: number,
): CurvedBox[] {
  const out: CurvedBox[] = [];
  if (tTo - tFrom <= EPS || y1 - y0 <= EPS) return out;
  const crossing = chords.filter((chord) => Math.min(chord.t1, tTo) - Math.max(chord.t0, tFrom) > EPS);
  crossing.forEach((chord, index) => {
    const span = chord.t1 - chord.t0;
    if (span <= EPS) return;
    const from = Math.max(chord.t0, tFrom);
    const to = Math.min(chord.t1, tTo);
    // Project the sub-span onto the chord line, so every band on one chord is
    // coplanar with the frame of that chord.
    let s0 = ((from - chord.t0) / span) * chord.length;
    let s1 = ((to - chord.t0) / span) * chord.length;
    const grow = (Math.abs(depth) / 2) * Math.tan(chord.angularWidth / 2);
    if (index > 0 && from <= chord.t0 + EPS) s0 -= grow;
    if (index < crossing.length - 1 && to >= chord.t1 - EPS) s1 += grow;
    const length = s1 - s0;
    if (length <= EPS) return;
    const centreS = (s0 + s1) / 2;
    out.push({
      role,
      centre: {
        x: chord.start.x + chord.tangent.x * centreS + chord.outward.x * radial,
        z: chord.start.z + chord.tangent.z * centreS + chord.outward.z * radial,
      },
      y: (y0 + y1) / 2,
      length,
      height: y1 - y0,
      depth: Math.abs(depth),
      tangent: chord.tangent,
    });
  });
  return out;
}

/**
 * A free-standing band of boxes over `[tFrom, tTo]` of the arc: the pick
 * proxies of a curved opening, which are boxes like any other but belong to no
 * frame. `radiusDelta` puts the band on a concentric circle.
 */
export function chordBandBoxes(
  arc: ArcDef,
  role: CurvedPartRole,
  tFrom: number,
  tTo: number,
  y0: number,
  y1: number,
  depth: number,
  tol: number = ARC_TOL,
  radiusDelta = 0,
): CurvedBox[] {
  return band(chordSpans(arc, tFrom, tTo, tol, radiusDelta), role, tFrom, tTo, y0, y1, depth, 0);
}

/**
 * A single vertical post standing ON a chord boundary, oriented along the
 * bisector of the two chords that meet there. Splitting the post into two
 * boxes instead would fold a 45 mm mullion into a visible V.
 */
function post(chords: ChordSpan[], t: number, width: number, y0: number, y1: number, depth: number): CurvedBox | null {
  if (width <= EPS || y1 - y0 <= EPS) return null;
  const before = chords.find((chord) => Math.abs(chord.t1 - t) <= EPS);
  const after = chords.find((chord) => Math.abs(chord.t0 - t) <= EPS);
  const anchor = before ?? after;
  if (!anchor) return null;
  const centre = before ? before.end : after!.start;
  const tangent = before && after ? norm({ x: before.tangent.x + after.tangent.x, z: before.tangent.z + after.tangent.z }) : anchor.tangent;
  return {
    role: 'bar-vertical',
    centre,
    y: (y0 + y1) / 2,
    length: width,
    height: y1 - y0,
    depth,
    tangent,
  };
}

/** One flat pane per chord over `[tFrom, tTo]`, at the wall centreline. */
function panes(chords: ChordSpan[], tFrom: number, tTo: number, y0: number, y1: number): CurvedPane[] {
  const out: CurvedPane[] = [];
  if (tTo - tFrom <= EPS || y1 - y0 <= EPS) return out;
  for (const chord of chords) {
    const from = Math.max(chord.t0, tFrom);
    const to = Math.min(chord.t1, tTo);
    if (to - from <= EPS) continue;
    const span = chord.t1 - chord.t0;
    const s0 = ((from - chord.t0) / span) * chord.length;
    const s1 = ((to - chord.t0) / span) * chord.length;
    const centreS = (s0 + s1) / 2;
    out.push({
      centre: {
        x: chord.start.x + chord.tangent.x * centreS,
        z: chord.start.z + chord.tangent.z * centreS,
      },
      y: (y0 + y1) / 2,
      width: s1 - s0,
      height: y1 - y0,
      tangent: chord.tangent,
    });
  }
  return out;
}

/**
 * Where the vertical glazing bars go on an arc.
 *
 * A flat sash pattern (`paneLayout`) wants `columns - 1` interior bars evenly
 * spread across the glazed span. On an arc a bar can only stand on a chord
 * boundary — anywhere else it would cross a facet — so each wanted position is
 * SNAPPED to the nearest free boundary. When the arc offers fewer boundaries
 * than the pattern wants, every boundary gets a bar.
 */
export function barBoundaries(boundaries: number[], wanted: number, from: number, to: number): number[] {
  const free = boundaries.filter((t) => t > from + EPS && t < to - EPS);
  if (wanted <= 0 || free.length === 0) return [];
  if (wanted >= free.length) return [...free];
  const chosen = new Set<number>();
  for (let i = 1; i <= wanted; i += 1) {
    const target = from + ((to - from) * i) / (wanted + 1);
    let best: number | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const t of free) {
      if (chosen.has(t)) continue;
      const gap = Math.abs(t - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = t;
      }
    }
    if (best !== null) chosen.add(best);
  }
  return [...chosen].sort((a, b) => a - b);
}

/**
 * Every box and pane of one opening on a curved wall.
 *
 * A door or a passage passes no `glazing` and no `sillBoard`: it gets the
 * curved frame (jambs plus head band) only. Its leaf is NOT part of this
 * module — a leaf is a rigid panel and stays flat on the tangent at the
 * opening centre (a known limitation of curved doors).
 */
export function curvedOpeningParts(input: CurvedOpeningInput): CurvedOpeningParts {
  const { arc, thickness, sill, head, interiorOutward } = input;
  const tol = input.tol ?? ARC_TOL;
  const total = arcLength(arc);
  const t0 = clamp(Math.min(input.t0, input.t1), 0, total);
  const t1 = clamp(Math.max(input.t0, input.t1), 0, total);
  const chords = chordSpans(arc, t0, t1, tol);
  const boxes: CurvedBox[] = [];
  const glass: CurvedPane[] = [];
  if (chords.length === 0 || head - sill <= EPS) return { chords, boxes, panes: glass };

  const width = t1 - t0;
  const height = head - sill;
  const frameWidth = Math.min(input.frameWidth, width / 3, height / 3);
  const frameDepth = Math.min(input.frameDepth, thickness + 0.02);
  const barDepth = input.barDepth ?? Math.min(frameDepth * 0.6, 0.055);

  // Jambs stand on the arc at both ends, head and sill bands run the whole span.
  boxes.push(
    ...band(chords, 'jamb', t0, t0 + frameWidth, sill, head, frameDepth, 0),
    ...band(chords, 'jamb', t1 - frameWidth, t1, sill, head, frameDepth, 0),
    ...band(chords, 'head', t0, t1, head - frameWidth, head, frameDepth, 0),
  );
  if (input.glazing) boxes.push(...band(chords, 'sill', t0, t1, sill, sill + frameWidth, frameDepth, 0));

  if (input.glazing) {
    const glazeFrom = t0 + frameWidth;
    const glazeTo = t1 - frameWidth;
    const glazeY0 = sill + frameWidth;
    const glazeY1 = head - frameWidth;
    if (glazeTo - glazeFrom > EPS && glazeY1 - glazeY0 > EPS) {
      const sashes = Math.min(3, Math.max(1, Math.round(input.glazing.panes)));
      const perSash = input.glazing.mullions === 'none' ? 1 : 2;
      const columns = sashes * perSash;
      const boundaries = chordBoundaries(arc, glazeFrom, glazeTo, tol).slice(1, -1);
      const bars = barBoundaries(boundaries, columns - 1, glazeFrom, glazeTo);

      // Horizontal glazing bar of a grid: one segmented band across the middle.
      const rows: Array<[number, number]> = [];
      if (input.glazing.mullions === 'grid') {
        const middle = (glazeY0 + glazeY1) / 2;
        const halfBar = GLAZING_BAR_M / 2;
        if (glazeY1 - glazeY0 > GLAZING_BAR_M * 3) {
          boxes.push(...band(chords, 'bar-horizontal', glazeFrom, glazeTo, middle - halfBar, middle + halfBar, barDepth, 0));
          rows.push([glazeY0, middle - halfBar], [middle + halfBar, glazeY1]);
        }
      }
      if (rows.length === 0) rows.push([glazeY0, glazeY1]);

      // Vertical bars snapped to chord boundaries, then glass in what is left.
      const cuts: Array<[number, number]> = [];
      let cursor = glazeFrom;
      bars.forEach((t, index) => {
        const barWidth = (index + 1) % perSash === 0 ? SASH_BAR_M : GLAZING_BAR_M;
        const from = t - barWidth / 2;
        const to = t + barWidth / 2;
        const bar = post(chords, t, barWidth, glazeY0, glazeY1, barDepth);
        if (bar) boxes.push(bar);
        if (from - cursor > EPS) cuts.push([cursor, from]);
        cursor = to;
      });
      if (glazeTo - cursor > EPS) cuts.push([cursor, glazeTo]);

      for (const [from, to] of cuts) {
        for (const [y0, y1] of rows) glass.push(...panes(chords, from, to, y0, y1));
      }
    }
  }

  if (input.sillBoard) {
    // Its own concentric arc: segments meet corner to corner on the offset
    // radius instead of fanning out from the centreline chords.
    const radiusDelta = interiorOutward * (thickness / 2 + SILL_BOARD_STANDOFF_M);
    const from = clamp(t0 - SILL_BOARD_OVERHANG_M, 0, total);
    const to = clamp(t1 + SILL_BOARD_OVERHANG_M, 0, total);
    const boardChords = chordSpans(arc, from, to, tol, radiusDelta);
    boxes.push(...band(boardChords, 'sill-board', from, to, sill, sill + SILL_BOARD_THICKNESS_M, SILL_BOARD_DEPTH_M, 0));
  }

  if (input.pickDepth && input.pickDepth > EPS) {
    boxes.push(...band(chords, 'pick', t0, t1, sill, head, input.pickDepth, 0));
  }

  return { chords, boxes, panes: glass };
}

/** The four plan corners of a box, at its own height band. */
export function boxCorners(box: CurvedBox): Vec2[] {
  const t = box.tangent;
  const n = { x: -t.z, z: t.x };
  const halfLength = box.length / 2;
  const halfDepth = box.depth / 2;
  const corners: Vec2[] = [];
  for (const a of [-halfLength, halfLength]) {
    for (const b of [-halfDepth, halfDepth]) {
      corners.push({ x: box.centre.x + t.x * a + n.x * b, z: box.centre.z + t.z * a + n.z * b });
    }
  }
  return corners;
}
