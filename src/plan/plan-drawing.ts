/**
 * The apartment as a classic architectural drawing: solid wall bodies, white
 * cuts where the openings are, a leaf line and a quarter-circle swing arc per
 * door, a double line per window, and the bath and kitchen fixtures as
 * outlined footprints. No furniture beyond that. Room name labels and facade
 * dimension chains (`plan-dimensions.ts`) are opt in via `PlanDrawingOptions`,
 * default off, so every caller that does not ask keeps the drawing it had.
 *
 * One drawing serves two consumers: the `plan2d` mode paints it over the whole
 * viewport, the mini-map paints the same primitives small (`plan-canvas.ts`).
 * Both get plan METRES; turning them into pixels is `fitTransform` plus
 * `planPoint`, so the painter never has to know the plan and the drawing never
 * has to know the canvas.
 *
 * Invariants (see `plan-drawing.test.ts`):
 * - one `wall` body per wall plus one per joint core, i.e. exactly the solids
 *   the shell extrudes, so the drawing and the 3D walls cannot drift apart;
 * - one `opening` cut per authored opening, of the wall's true thickness;
 * - one `leaf` and one `swing` per hinged door, taken from `door-swing.ts`, so
 *   the arc on paper is the sector the layout linter keeps clear;
 * - `roomAt` answers with the same room ids the solver assigned.
 *
 * What this module does NOT do is ask the object bank anything: which
 * placements are fixtures and how big they are arrive through
 * `PlanDrawingOptions`, resolved by the caller
 * (`assets/plan-fixtures.planDrawingInputs`), so a pure 2D drawing never
 * imports the collision system (`navigation.footprintOf`) or the catalogue
 * (`asset-catalogue.findCatalogueEntry`).
 *
 * Pure module: no `three`, no DOM.
 */

import { EPS, add, dist, dot, leftN, mul, norm, polylineSlice, sub } from './plan-geometry.js';
import { clamp } from '../shared/math.js';
import { jointCores } from './plan-joints.js';
import { doorSwings, type FrameWidthOf } from './door-swing.js';
import { facadeDimensions, roomLabels, type PlanDimension, type PlanLabel } from './plan-dimensions.js';
import type { SolvedPlan } from './plan-solver.js';
import type { OpeningType, SceneData, Vec2 } from '../scene/types.js';

/** One thing to draw, in plan metres. */
export type PlanPrimitive =
  /** Filled wall body — a wall band or a joint core. Black on the drawing. */
  | { kind: 'wall'; polygon: Vec2[] }
  /** White cut through the wall body where an opening is. */
  | { kind: 'opening'; quad: Vec2[]; type: OpeningType }
  /** Door leaf at its rest angle: `pivot -> pivot + open * leaf`. */
  | { kind: 'leaf'; from: Vec2; to: Vec2 }
  /** Quarter arc from the open leaf back to the closed one; `a0`/`a1` radians. */
  | { kind: 'swing'; centre: Vec2; radius: number; a0: number; a1: number }
  /** Thin double line inside a window cut. */
  | { kind: 'window'; quad: Vec2[] }
  /** Bath or kitchen fixture footprint, outlined. */
  | { kind: 'fixture'; polygon: Vec2[]; category: string }
  /** Hit-test and highlight region; not painted in `plan2d`. */
  | { kind: 'room'; id: string; polygon: Vec2[] }
  /** Room name and area (`plan-dimensions.ts`); opt in via `options.labels`. */
  | PlanLabel
  /** Facade dimension chain (`plan-dimensions.ts`); opt in via `options.dimensions`. */
  | PlanDimension;

export type PlanBounds = { min: Vec2; max: Vec2 };

export type PlanDrawing = { bounds: PlanBounds; primitives: PlanPrimitive[] };

/** Plan metres to canvas pixels: `x * scale + ox`, `z * scale + oy`. */
export type PlanTransform = { scale: number; ox: number; oy: number };

/** One bath or kitchen fixture to outline, already resolved to plan geometry. */
export type PlanFixture = {
  /** Footprint quad in plan metres. */
  readonly polygon: readonly Vec2[];
  /** Catalogue category, so the painter can style a bath and a hob apart. */
  readonly category: string;
};

export type PlanDrawingOptions = {
  /**
   * Frame rebate per opening, metres — what the leaf and its swing arc are
   * measured from. Handed in because the number is variant data
   * (`assets/opening-frame.openingFrameWidth`).
   */
  readonly frameWidthOf: FrameWidthOf;
  /**
   * The fixtures to outline. Omitted draws NONE: which placements count as
   * fixtures and how big they are is a catalogue question, and this module
   * answers no catalogue questions (`assets/plan-fixtures.planFixtures`).
   */
  readonly fixtures?: readonly PlanFixture[];
  /** One label per room (name plus shoelace area). Default `false` — the drawing today has none. */
  readonly labels?: boolean;
  /** One dimension chain per facade run (`plan-dimensions.facadeDimensions`). Default `false`. */
  readonly dimensions?: boolean;
};

/**
 * Overshoot of an opening cut past the wall face, metres. The cut is painted
 * white over the black body, and a cut of the exact thickness leaves a hairline
 * of body behind after rounding; two millimetres is invisible at any plan scale
 * and removes it.
 */
const CUT_OVERSHOOT_M = 0.002;

/** How far a mitre may stretch a band vertex, as a multiple of the half width. */
const MITER_LIMIT = 4;

/**
 * Category paths whose objects are FIXTURES: they belong to the building, not
 * to the furnishing, and a classic plan draws them. The paths are the store's
 * category tree (`asset-category@1`), which the built-in bank files under too.
 * Everything else — seating, beds, storage, decor, lighting — is left out.
 */
const FIXTURE_PREFIXES = ['bathroom/', 'kitchen/', 'appliances/'];
/** A hood hangs above the worktop and a kettle stands on it: neither has a footprint on the floor plan. */
const FIXTURE_EXCLUDED = new Set(['appliances/cooker-hoods', 'appliances/kettles']);

/** Whether a catalogue category is drawn as a fixture on the 2D plan. */
export function isPlanFixtureCategory(category: string): boolean {
  if (FIXTURE_EXCLUDED.has(category)) return false;
  return FIXTURE_PREFIXES.some((prefix) => category.startsWith(prefix));
}

/**
 * The band of half width `half` around a polyline, as one closed polygon:
 * the left offsets in order, then the right offsets reversed.
 *
 * Vertex normals are the averaged segment normals with the usual miter
 * scaling, so a discretised arc comes out as a smooth concentric band rather
 * than a chain of disjoint rectangles.
 */
function bandPolygon(points: readonly Vec2[], half: number): Vec2[] {
  const clean: Vec2[] = [];
  for (const point of points) {
    const previous = clean.at(-1);
    if (previous && dist(previous, point) <= EPS) continue;
    clean.push(point);
  }
  if (clean.length < 2 || half <= EPS) return [];

  const normals: Vec2[] = [];
  for (let i = 0; i + 1 < clean.length; i += 1) normals.push(leftN(norm(sub(clean[i + 1]!, clean[i]!))));

  const offsets = clean.map((point, i) => {
    const before = normals[i - 1];
    const after = normals[i];
    const seam = before && after ? norm(add(before, after)) : (after ?? before)!;
    const reference = after ?? before!;
    const cosine = dot(seam, reference);
    const stretch = clamp(cosine > EPS ? 1 / cosine : MITER_LIMIT, 1, MITER_LIMIT);
    return { point, offset: mul(seam, half * stretch) };
  });

  const left = offsets.map((entry) => add(entry.point, entry.offset));
  const right = offsets.map((entry) => sub(entry.point, entry.offset)).reverse();
  return [...left, ...right];
}

/** Angle of a unit direction in the plan-geometry convention (`atan2(z, x)`). */
function angleOf(direction: Vec2): number {
  return Math.atan2(direction.z, direction.x);
}

/** `angle` moved by whole turns into `[reference - PI, reference + PI]`. */
function unwrapNear(angle: number, reference: number): number {
  const turn = 2 * Math.PI;
  const delta = (((angle - reference + Math.PI) % turn) + turn) % turn;
  return reference + delta - Math.PI;
}

/**
 * Every primitive of one document, in painting order: rooms (regions only),
 * wall bodies, opening cuts, window lines, door leaves and swings, fixtures.
 */
export function buildPlanDrawing(plan: SolvedPlan, scene: SceneData, options: PlanDrawingOptions): PlanDrawing {
  const primitives: PlanPrimitive[] = [];

  for (const room of plan.rooms) {
    if (room.polygon.length >= 3) primitives.push({ kind: 'room', id: room.roomId, polygon: room.polygon.map(copy) });
  }

  const centrelines = new Map(plan.centrelines.map((line) => [line.wallId, line]));
  for (const line of plan.centrelines) {
    const polygon = bandPolygon(line.polyline, line.thickness / 2);
    if (polygon.length >= 3) primitives.push({ kind: 'wall', polygon });
  }
  for (const core of jointCores(scene)) primitives.push({ kind: 'wall', polygon: core.polygon.map(copy) });

  for (const wall of scene.walls) {
    const line = centrelines.get(wall.id);
    if (!line) continue;
    for (const opening of wall.openings ?? []) {
      const half = opening.width / 2;
      const slice = polylineSlice(line.polyline, line.length, opening.center - half, opening.center + half);
      if (slice.length < 2) continue;
      const cut = bandPolygon(slice, line.thickness / 2 + CUT_OVERSHOOT_M);
      if (cut.length >= 3) primitives.push({ kind: 'opening', quad: cut, type: opening.type });
      if (opening.type !== 'window') continue;
      const pane = bandPolygon(slice, line.thickness / 2);
      if (pane.length >= 3) primitives.push({ kind: 'window', quad: pane });
    }
  }

  for (const swing of doorSwings(scene, plan, options.frameWidthOf)) {
    if (swing.leaf <= EPS) continue;
    primitives.push({ kind: 'leaf', from: copy(swing.pivot), to: add(swing.pivot, mul(swing.open, swing.leaf)) });
    const a0 = angleOf(swing.open);
    primitives.push({ kind: 'swing', centre: copy(swing.pivot), radius: swing.leaf, a0, a1: unwrapNear(angleOf(swing.closed), a0) });
  }

  for (const fixture of options.fixtures ?? []) {
    primitives.push({ kind: 'fixture', polygon: fixture.polygon.map(copy), category: fixture.category });
  }

  if (options.labels) primitives.push(...roomLabels(plan, scene.rooms));
  if (options.dimensions) primitives.push(...facadeDimensions(plan));

  return {
    bounds: {
      min: { x: plan.bounds.minX, z: plan.bounds.minZ },
      max: { x: plan.bounds.maxX, z: plan.bounds.maxZ },
    },
    primitives,
  };
}

/**
 * The one scale and offset that fits `bounds` into `viewport` with `padding`
 * (a fraction of each side) free all round, aspect kept.
 *
 * A degenerate bounds or a zero viewport still answers with finite numbers: a
 * canvas that has not been laid out yet must not poison the drawing with NaN.
 */
export function fitTransform(bounds: PlanBounds, viewport: { w: number; h: number }, padding: number): PlanTransform {
  const width = Math.max(1, Number.isFinite(viewport.w) ? viewport.w : 1);
  const height = Math.max(1, Number.isFinite(viewport.h) ? viewport.h : 1);
  const pad = clamp(padding, 0, 0.45);
  const spanX = Math.max(EPS, bounds.max.x - bounds.min.x);
  const spanZ = Math.max(EPS, bounds.max.z - bounds.min.z);
  const scale = Math.min((width * (1 - 2 * pad)) / spanX, (height * (1 - 2 * pad)) / spanZ);
  return {
    scale,
    ox: width / 2 - (scale * (bounds.min.x + bounds.max.x)) / 2,
    oy: height / 2 - (scale * (bounds.min.z + bounds.max.z)) / 2,
  };
}

/** A plan point in canvas pixels. `+x` is right, `+z` is DOWN (north is up). */
export function planPoint(transform: PlanTransform, point: Vec2): { x: number; y: number } {
  return { x: point.x * transform.scale + transform.ox, y: point.z * transform.scale + transform.oy };
}

/** Inverse of `planPoint`: canvas pixels back to plan metres. */
export function planPointAt(transform: PlanTransform, pixel: { x: number; y: number }): Vec2 {
  const scale = Math.abs(transform.scale) > EPS ? transform.scale : 1;
  return { x: (pixel.x - transform.ox) / scale, z: (pixel.y - transform.oy) / scale };
}

/** The room whose polygon contains `point`, or `null` outside every room. */
export function roomAt(drawing: PlanDrawing, point: Vec2): string | null {
  for (const primitive of drawing.primitives) {
    if (primitive.kind !== 'room') continue;
    if (pointInside(point, primitive.polygon)) return primitive.id;
  }
  return null;
}

/**
 * Strict even-odd containment.
 *
 * `plan-geometry.pointInPolygon` counts the boundary as inside, which is right
 * for the solver — a room face point sits ON its own polygon — but wrong for a
 * hit test: two rooms share a wall centre line, and the first one listed would
 * then answer for a pointer on the boundary of the other.
 */
function pointInside(point: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.z > point.z !== b.z > point.z) {
      const xAt = a.x + ((point.z - a.z) * (b.x - a.x)) / (b.z - a.z);
      if (point.x < xAt) inside = !inside;
    }
  }
  return inside;
}

function copy(point: Vec2): Vec2 {
  return { x: point.x, z: point.z };
}
