import { describe, expect, test } from 'bun:test';
import {
  SILL_BOARD_DEPTH_M,
  SILL_BOARD_OVERHANG_M,
  SILL_BOARD_STANDOFF_M,
  barBoundaries,
  boxCorners,
  chordBoundaries,
  chordSpans,
  curvedOpeningParts,
  type CurvedBox,
  type CurvedOpeningInput,
} from './opening-arc.js';
import { ARC_TOL, EPS, arcFromChord, arcLength, arcSegments, dist } from './plan-geometry.js';
import type { ArcDef } from './plan-geometry.js';

/** The demo bay: `bay-living`, R 1.6, chord 3.2 (an exact semicircle), t 0.30. */
const BAY: ArcDef = arcFromChord({ x: 2.8, z: 0.55 }, { x: 6.0, z: 0.55 }, 1.6, false);
const BAY_THICKNESS = 0.3;
/** `window-living-bay`: centre 2.513, width 2.6, sill 0.85, head 2.3. */
const OPENING_T0 = 2.513 - 1.3;
const OPENING_T1 = 2.513 + 1.3;

function bayInput(overrides: Partial<CurvedOpeningInput> = {}): CurvedOpeningInput {
  return {
    arc: BAY,
    thickness: BAY_THICKNESS,
    t0: OPENING_T0,
    t1: OPENING_T1,
    sill: 0.85,
    head: 2.3,
    frameWidth: 0.07,
    frameDepth: 0.13,
    // The living room is inside the circle the bay bulges out of.
    interiorOutward: -1,
    glazing: { panes: 2, mullions: 'vertical' },
    sillBoard: true,
    pickDepth: 0.38,
    ...overrides,
  };
}

/** Radial distance of a plan point from the centre of the centreline circle. */
function radius(point: { x: number; z: number }): number {
  return dist(point, BAY.centre);
}

const FRAME_ROLES = new Set(['jamb', 'head', 'sill', 'bar-vertical', 'bar-horizontal']);

function frameBoxes(boxes: CurvedBox[]): CurvedBox[] {
  return boxes.filter((box) => FRAME_ROLES.has(box.role));
}

describe('chord discretisation of an opening span', () => {
  test('the chords tile the opening span exactly', () => {
    const chords = chordSpans(BAY, OPENING_T0, OPENING_T1);
    expect(chords.length).toBeGreaterThan(4);
    expect(chords[0]!.t0).toBeCloseTo(OPENING_T0, 12);
    expect(chords.at(-1)!.t1).toBeCloseTo(OPENING_T1, 12);
    for (let i = 0; i + 1 < chords.length; i += 1) {
      expect(chords[i + 1]!.t0).toBeCloseTo(chords[i]!.t1, 12);
    }
  });

  test('every interior chord boundary is a vertex of the wall arc discretisation', () => {
    const total = arcLength(BAY);
    const step = total / arcSegments(BAY.radius, BAY.sweep, ARC_TOL);
    const chords = chordSpans(BAY, OPENING_T0, OPENING_T1);
    const interior = chords.slice(1).map((chord) => chord.t0);
    expect(interior.length).toBeGreaterThan(0);
    for (const t of interior) {
      const k = t / step;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
  });

  test('the chord ends lie on the circle and the sagitta stays inside the tolerance', () => {
    for (const chord of chordSpans(BAY, OPENING_T0, OPENING_T1)) {
      expect(radius(chord.start)).toBeCloseTo(BAY.radius, 10);
      expect(radius(chord.end)).toBeCloseTo(BAY.radius, 10);
      expect(BAY.radius - radius(chord.mid)).toBeLessThanOrEqual(ARC_TOL + 1e-9);
    }
  });

  test('a concentric span keeps the centreline boundaries but sits on its own radius', () => {
    const delta = -0.22;
    const offset = chordSpans(BAY, OPENING_T0, OPENING_T1, ARC_TOL, delta);
    const centre = chordSpans(BAY, OPENING_T0, OPENING_T1);
    expect(offset.map((c) => c.t0)).toEqual(centre.map((c) => c.t0));
    for (const chord of offset) expect(radius(chord.start)).toBeCloseTo(BAY.radius + delta, 10);
    // Consecutive segments share their boundary point exactly: no fan gaps.
    for (let i = 0; i + 1 < offset.length; i += 1) {
      expect(dist(offset[i]!.end, offset[i + 1]!.start)).toBeLessThan(1e-12);
    }
  });

  test('a degenerate or empty span produces no chords', () => {
    expect(chordSpans(BAY, 1, 1)).toEqual([]);
    expect(chordSpans({ ...BAY, sweep: 0 }, 0, 1)).toEqual([]);
    expect(chordBoundaries(BAY, 2, 2)).toEqual([]);
  });
});

describe('curved frame stays inside the wall', () => {
  test('every frame vertex is within thickness/2 + frameDepth + 1 mm of the centreline circle', () => {
    const input = bayInput();
    const limit = input.thickness / 2 + input.frameDepth + 0.001;
    const parts = curvedOpeningParts(input);
    const frame = frameBoxes(parts.boxes);
    expect(frame.length).toBeGreaterThan(6);
    for (const box of frame) {
      for (const corner of boxCorners(box)) {
        expect(Math.abs(radius(corner) - BAY.radius)).toBeLessThanOrEqual(limit);
      }
    }
  });

  test('the frame is in fact tighter than that: no vertex leaves half the wall thickness', () => {
    const input = bayInput();
    const parts = curvedOpeningParts(input);
    for (const box of frameBoxes(parts.boxes)) {
      for (const corner of boxCorners(box)) {
        expect(Math.abs(radius(corner) - BAY.radius)).toBeLessThanOrEqual(input.thickness / 2);
      }
    }
  });

  test('the glass panes hug the centreline', () => {
    const parts = curvedOpeningParts(bayInput());
    expect(parts.panes.length).toBeGreaterThan(4);
    for (const pane of parts.panes) {
      const half = pane.width / 2;
      for (const s of [-half, 0, half]) {
        const point = { x: pane.centre.x + pane.tangent.x * s, z: pane.centre.z + pane.tangent.z * s };
        expect(Math.abs(radius(point) - BAY.radius)).toBeLessThanOrEqual(ARC_TOL + 1e-9);
      }
    }
  });

  test('a flat frame of the same width would leave the wall — this is the bug it fixes', () => {
    // The straight chord across the whole opening: its ends are 0.5 m off the
    // arc, an order of magnitude past the wall.
    const chord = dist(chordSpans(BAY, OPENING_T0, OPENING_T1)[0]!.start, chordSpans(BAY, OPENING_T0, OPENING_T1).at(-1)!.end);
    const sagitta = BAY.radius - Math.sqrt(Math.max(0, BAY.radius ** 2 - (chord / 2) ** 2));
    expect(sagitta).toBeGreaterThan(BAY_THICKNESS / 2 + 0.13);
  });
});

/** Plan points of the two ends of a box, along its own length axis. */
function boxEnds(box: CurvedBox): { start: { x: number; z: number }; end: { x: number; z: number } } {
  const half = box.length / 2;
  return {
    start: { x: box.centre.x - box.tangent.x * half, z: box.centre.z - box.tangent.z * half },
    end: { x: box.centre.x + box.tangent.x * half, z: box.centre.z + box.tangent.z * half },
  };
}

describe('the frame covers the opening span', () => {
  test('head and sill bands run from the first chord start to the last chord end', () => {
    const parts = curvedOpeningParts(bayInput());
    const first = parts.chords[0]!;
    const last = parts.chords.at(-1)!;
    for (const role of ['head', 'sill'] as const) {
      const bandBoxes = parts.boxes.filter((box) => box.role === role);
      expect(bandBoxes.length).toBe(parts.chords.length);
      // One box per chord, in order, starting and ending exactly on the span.
      expect(dist(boxEnds(bandBoxes[0]!).start, first.start)).toBeLessThan(1e-9);
      expect(dist(boxEnds(bandBoxes.at(-1)!).end, last.end)).toBeLessThan(1e-9);
      // The segments overlap rather than gap: each covers at least its chord.
      bandBoxes.forEach((box, index) => {
        expect(box.length).toBeGreaterThanOrEqual(parts.chords[index]!.length - EPS);
      });
    }
  });

  test('a jamb closes each end of the span, standing on the arc', () => {
    const parts = curvedOpeningParts(bayInput());
    const jambs = parts.boxes.filter((box) => box.role === 'jamb');
    // A jamb narrower than the end chord is one box; here the span starts mid
    // chord, so the leading jamb spills onto the next chord and becomes two.
    expect(jambs.length).toBeGreaterThanOrEqual(2);
    const first = parts.chords[0]!;
    const last = parts.chords.at(-1)!;
    expect(dist(boxEnds(jambs[0]!).start, first.start)).toBeLessThan(1e-9);
    expect(dist(boxEnds(jambs.at(-1)!).end, last.end)).toBeLessThan(1e-9);
    for (const jamb of jambs) expect(jamb.height).toBeCloseTo(2.3 - 0.85, 10);
  });
});

describe('glazing bars map onto chord boundaries', () => {
  test('a vertical mullion pattern puts one post on each chosen chord boundary', () => {
    const parts = curvedOpeningParts(bayInput({ glazing: { panes: 2, mullions: 'vertical' } }));
    const bars = parts.boxes.filter((box) => box.role === 'bar-vertical');
    // 2 sashes x 2 columns => 3 interior bars, each ONE post on a boundary.
    expect(bars.length).toBe(3);
    for (const bar of bars) {
      const onBoundary = parts.chords.some((chord) => dist(bar.centre, chord.start) < 1e-9 || dist(bar.centre, chord.end) < 1e-9);
      expect(onBoundary).toBe(true);
      expect(radius(bar.centre)).toBeCloseTo(BAY.radius, 10);
    }
  });

  test('a grid adds the horizontal bar as a segmented band', () => {
    const parts = curvedOpeningParts(bayInput({ glazing: { panes: 2, mullions: 'grid' } }));
    const horizontal = parts.boxes.filter((box) => box.role === 'bar-horizontal');
    expect(horizontal.length).toBeGreaterThan(4);
    const y = horizontal[0]!.y;
    for (const bar of horizontal) expect(bar.y).toBeCloseTo(y, 12);
  });

  test('no mullions still leaves one pane per glazed chord', () => {
    const input = bayInput({ glazing: { panes: 1, mullions: 'none' } });
    const parts = curvedOpeningParts(input);
    expect(parts.boxes.filter((box) => box.role.startsWith('bar-'))).toEqual([]);
    // The glazed span starts a frame width in, so the two stub end chords the
    // jambs sit on carry no glass.
    const glazed = parts.chords.filter(
      (chord) => Math.min(chord.t1, OPENING_T1 - input.frameWidth) - Math.max(chord.t0, OPENING_T0 + input.frameWidth) > EPS,
    );
    expect(parts.panes.length).toBe(glazed.length);
    expect(glazed.length).toBeGreaterThan(parts.chords.length - 3);
  });

  test('barBoundaries snaps to the nearest free boundary and never repeats one', () => {
    const boundaries = [1, 2, 3, 4, 5];
    expect(barBoundaries(boundaries, 0, 0, 6)).toEqual([]);
    expect(barBoundaries(boundaries, 1, 0, 6)).toEqual([3]);
    expect(barBoundaries(boundaries, 2, 0, 6)).toEqual([2, 4]);
    // More bars than boundaries: every boundary carries one, none twice.
    expect(barBoundaries(boundaries, 9, 0, 6)).toEqual(boundaries);
  });
});

describe('the interior sill board follows the curve', () => {
  test('every segment sits on the inner face offset', () => {
    const input = bayInput();
    const parts = curvedOpeningParts(input);
    const board = parts.boxes.filter((box) => box.role === 'sill-board');
    expect(board.length).toBeGreaterThan(4);
    const expected = BAY.radius - (input.thickness / 2 + SILL_BOARD_STANDOFF_M);
    for (const segment of board) {
      expect(radius(segment.centre)).toBeGreaterThan(expected - ARC_TOL - 1e-9);
      expect(radius(segment.centre)).toBeLessThanOrEqual(expected + 1e-9);
      expect(segment.depth).toBeCloseTo(SILL_BOARD_DEPTH_M, 12);
      expect(segment.y).toBeCloseTo(input.sill + 0.035 / 2, 12);
    }
  });

  test('the board overhangs the opening at both ends', () => {
    const input = bayInput();
    const parts = curvedOpeningParts(bayInput());
    const board = parts.boxes.filter((box) => box.role === 'sill-board');
    const covered = board.reduce((sum, box) => sum + box.length, 0);
    // The board runs on the inner face radius, so its own arc is shorter than
    // the centreline span by exactly the radius ratio.
    const innerRadius = BAY.radius - (input.thickness / 2 + SILL_BOARD_STANDOFF_M);
    const span = (OPENING_T1 - OPENING_T0 + 2 * SILL_BOARD_OVERHANG_M) * (innerRadius / BAY.radius);
    expect(covered).toBeGreaterThan(span * 0.99);
  });

  test('a variant without a sill board builds none', () => {
    expect(curvedOpeningParts(bayInput({ sillBoard: false })).boxes.some((b) => b.role === 'sill-board')).toBe(false);
  });
});

describe('pick proxy', () => {
  test('the proxy is segmented per chord and stays inside the wall plus its margin', () => {
    const input = bayInput();
    const parts = curvedOpeningParts(input);
    const proxies = parts.boxes.filter((box) => box.role === 'pick');
    expect(proxies.length).toBe(parts.chords.length);
    for (const proxy of proxies) {
      expect(proxy.depth).toBeCloseTo(input.pickDepth!, 12);
      for (const corner of boxCorners(proxy)) {
        // Plus the sagitta the chord midpoint sits inside the circle by.
        expect(Math.abs(radius(corner) - BAY.radius)).toBeLessThanOrEqual(input.pickDepth! / 2 + ARC_TOL);
      }
    }
  });

  test('no pick depth, no proxy', () => {
    expect(curvedOpeningParts(bayInput({ pickDepth: 0 })).boxes.some((b) => b.role === 'pick')).toBe(false);
  });
});

describe('doors and passages on an arc', () => {
  test('a frame-only opening gets jambs and a head band, no glazing and no sill', () => {
    const parts = curvedOpeningParts(bayInput({ glazing: undefined, sillBoard: false, pickDepth: 0, sill: 0, head: 2.1 }));
    expect(parts.panes).toEqual([]);
    expect(parts.boxes.some((box) => box.role === 'sill')).toBe(false);
    expect(parts.boxes.filter((box) => box.role === 'jamb').length).toBeGreaterThanOrEqual(2);
    expect(parts.boxes.filter((box) => box.role === 'head').length).toBe(parts.chords.length);
  });
});

describe('degenerate inputs', () => {
  test('a zero-height or zero-width opening produces nothing', () => {
    expect(curvedOpeningParts(bayInput({ head: 0.85 })).boxes).toEqual([]);
    expect(curvedOpeningParts(bayInput({ t1: OPENING_T0 })).boxes).toEqual([]);
  });
});
