/**
 * A deterministic SVG rendering of the plan drawing: the static artefact a portal's `Floor Plan` slot and a
 * printed brochure both want, independent of any canvas or browser.
 *
 * Design note on `labels` versus `dimensions` (there is no `SceneData` here,
 * only `plan: SolvedPlan`, so the two cannot be treated alike):
 * - room-label TEXT needs a room NAME, which only `SceneData.rooms` carries;
 *   this module reads it off `drawing.primitives` (`kind: 'label'`), already
 *   resolved by whoever called `buildPlanDrawing(plan, scene, { labels: true,
 *   … })`. `options.labels` here only toggles whether they are drawn.
 * - a facade dimension chain needs only the solved plan, so `options.dimensions`
 *   calls `facadeDimensions(plan)` FRESH, independent of whatever `drawing`
 *   itself was built with — the export's own choice, not a re-reading of the
 *   caller's.
 *
 * Determinism: every coordinate is `toFixed(3)`, every element's attributes
 * are written in one fixed literal order (never `Object.entries` on a
 * dictionary), and nothing here reads the clock, a random source or the DOM.
 *
 * Pure module: no `three`, no DOM.
 */

import { facadeDimensions, type PlanDimension } from './plan-dimensions.js';
import { fitTransform, planPoint, type PlanDrawing, type PlanPrimitive } from './plan-drawing.js';
import type { SolvedPlan } from './plan-solver.js';
import type { Vec2 } from '../scene/types.js';

export type PlanSvgOptions = {
  width: number;
  height: number;
  /** Fraction of the shorter side left empty all round. Default `0.06`. */
  padding?: number;
  /** Room-name labels, read from `drawing.primitives` (`kind: 'label'`). Default `true`. */
  labels?: boolean;
  /** Facade dimension chains, recomputed from `plan`. Default `true`. */
  dimensions?: boolean;
  /** A bottom-left scale bar at a "nice" round metre length. Default `true`. */
  scaleBar?: boolean;
  title?: string;
  locale?: 'en' | 'ru';
};

/** Fraction of the shorter side left empty all round, when `options.padding` is omitted. */
const DEFAULT_PADDING = 0.06;
/** Target fraction of the drawing width the scale bar's length aims for, before rounding to a nice number. */
const SCALE_BAR_TARGET_FRACTION = 0.15;
/** Round metre lengths the scale bar picks from. */
const NICE_METRES: readonly number[] = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
/** Screen-pixel margin of the scale bar from the bottom-left corner. */
const SCALE_BAR_MARGIN_PX = 16;
/** Half-height of a scale-bar end tick, pixels. */
const SCALE_BAR_TICK_PX = 4;

const CAVEAT: Readonly<Record<'en' | 'ru', string>> = {
  en: 'Room areas are the shoelace area of the solved floor polygon, not a surveyed figure.',
  ru: 'Площади комнат — это площадь решённого контура пола, а не результат обмера.',
};

const PAPER = '#ffffff';
const WALL_FILL = '#101010';
const PANE_STROKE = '#3d3d3d';
const DETAIL_STROKE = '#6f6f6f';
const TEXT_FILL = '#242424';

/** 3-decimal fixed formatting; `-0` and any non-finite input fold to `'0.000'`. */
function fmt(value: number): string {
  if (!Number.isFinite(value)) return '0.000';
  const fixed = value.toFixed(3);
  return fixed === '-0.000' ? '0.000' : fixed;
}

/** Escapes the five XML predefined-entity characters; safe for both text content and attribute values. */
function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

type Transform = ReturnType<typeof fitTransform>;

function at(transform: Transform, point: Vec2): { x: number; y: number } {
  return planPoint(transform, point);
}

function pointsAttr(transform: Transform, polygon: readonly Vec2[]): string {
  return polygon
    .map((point) => {
      const p = at(transform, point);
      return `${fmt(p.x)},${fmt(p.y)}`;
    })
    .join(' ');
}

function polygonEl(transform: Transform, polygon: readonly Vec2[], fill: string, stroke?: string): string {
  const strokeAttr = stroke ? ` stroke="${stroke}" stroke-width="0.75"` : '';
  return `<polygon points="${pointsAttr(transform, polygon)}" fill="${fill}"${strokeAttr}/>`;
}

/** `a`/`b` are the same direction, to the same fold `door-swing`'s arcs use elsewhere: subtract whole turns, never mirror into `[0, 2*PI)`. */
function arcFlags(a0: number, a1: number, anticlockwise: boolean): { large: 0 | 1; sweep: 0 | 1 } {
  const turn = Math.PI * 2;
  const raw = anticlockwise ? a0 - a1 : a1 - a0;
  const delta = ((raw % turn) + turn) % turn;
  return { large: delta > Math.PI ? 1 : 0, sweep: anticlockwise ? 0 : 1 };
}

/**
 * One door swing as an SVG arc path. `centre`/`radius` are in PLAN metres,
 * `a0`/`a1` in the plan-geometry angle convention (`atan2(z, x)`) — the same
 * numbers `plan-canvas.ts`'s `ctx.arc` takes directly, because `planPoint`'s
 * `(x, z) -> (x, y)` mapping never flips the vertical axis, so no angle here
 * needs re-deriving for the SVG's own (also y-down) coordinate system.
 */
function arcPath(transform: Transform, centre: Vec2, radius: number, a0: number, a1: number): string {
  const anticlockwise = a1 < a0;
  const c = at(transform, centre);
  const radiusPx = radius * transform.scale;
  const start = { x: c.x + radiusPx * Math.cos(a0), y: c.y + radiusPx * Math.sin(a0) };
  const end = { x: c.x + radiusPx * Math.cos(a1), y: c.y + radiusPx * Math.sin(a1) };
  const { large, sweep } = arcFlags(a0, a1, anticlockwise);
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(radiusPx)} ${fmt(radiusPx)} 0 ${large} ${sweep} ${fmt(end.x)} ${fmt(end.y)}`;
}

function wallsAndOpenings(transform: Transform, primitives: readonly PlanPrimitive[]): string[] {
  const out: string[] = [];
  for (const primitive of primitives) if (primitive.kind === 'wall') out.push(polygonEl(transform, primitive.polygon, WALL_FILL));
  for (const primitive of primitives) if (primitive.kind === 'opening') out.push(polygonEl(transform, primitive.quad, PAPER));
  for (const primitive of primitives) {
    if (primitive.kind !== 'window') continue;
    out.push(`<polygon points="${pointsAttr(transform, primitive.quad)}" fill="none" stroke="${PANE_STROKE}" stroke-width="0.9"/>`);
  }
  return out;
}

function doorsAndFixtures(transform: Transform, primitives: readonly PlanPrimitive[]): string[] {
  const out: string[] = [];
  for (const primitive of primitives) {
    if (primitive.kind !== 'leaf') continue;
    const from = at(transform, primitive.from);
    const to = at(transform, primitive.to);
    out.push(
      `<line x1="${fmt(from.x)}" y1="${fmt(from.y)}" x2="${fmt(to.x)}" y2="${fmt(to.y)}" stroke="${DETAIL_STROKE}" stroke-width="1.1"/>`,
    );
  }
  for (const primitive of primitives) {
    if (primitive.kind !== 'swing') continue;
    out.push(
      `<path d="${arcPath(transform, primitive.centre, primitive.radius, primitive.a0, primitive.a1)}" fill="none" stroke="${DETAIL_STROKE}" stroke-width="0.8"/>`,
    );
  }
  for (const primitive of primitives) {
    if (primitive.kind !== 'fixture') continue;
    out.push(`<polygon points="${pointsAttr(transform, primitive.polygon)}" fill="none" stroke="${DETAIL_STROKE}" stroke-width="0.9"/>`);
  }
  return out;
}

/** One `<text>` per room label: name, then its area one `<tspan>` line below. */
function labelEls(transform: Transform, primitives: readonly PlanPrimitive[]): string[] {
  const out: string[] = [];
  for (const primitive of primitives) {
    if (primitive.kind !== 'label') continue;
    const p = at(transform, primitive.at);
    const x = fmt(p.x);
    out.push(
      `<text x="${x}" y="${fmt(p.y)}" text-anchor="middle" fill="${TEXT_FILL}">` +
        `<tspan x="${x}" dy="0" font-size="13" font-weight="600">${escapeXml(primitive.text)}</tspan>` +
        `<tspan x="${x}" dy="14" font-size="11">≈ ${primitive.area.toFixed(1)} m²</tspan>` +
        `</text>`,
    );
  }
  return out;
}

/** One extension-and-witness chain plus its value, per facade dimension. */
function dimensionEls(transform: Transform, dimensions: readonly PlanDimension[]): string[] {
  const out: string[] = [];
  for (const dimension of dimensions) {
    const dx = dimension.b.x - dimension.a.x;
    const dz = dimension.b.z - dimension.a.z;
    const length = Math.hypot(dx, dz) || 1;
    const dir = { x: dx / length, z: dz / length };
    const normal = { x: -dir.z, z: dir.x };
    const sign = dimension.side === 'L' ? 1 : -1;
    const nx = normal.x * sign * dimension.offset;
    const nz = normal.z * sign * dimension.offset;
    const offsetA: Vec2 = { x: dimension.a.x + nx, z: dimension.a.z + nz };
    const offsetB: Vec2 = { x: dimension.b.x + nx, z: dimension.b.z + nz };

    const pA = at(transform, dimension.a);
    const pB = at(transform, dimension.b);
    const pOffsetA = at(transform, offsetA);
    const pOffsetB = at(transform, offsetB);
    const mid = { x: (pOffsetA.x + pOffsetB.x) / 2, y: (pOffsetA.y + pOffsetB.y) / 2 };

    out.push(
      `<line x1="${fmt(pA.x)}" y1="${fmt(pA.y)}" x2="${fmt(pOffsetA.x)}" y2="${fmt(pOffsetA.y)}" stroke="${DETAIL_STROKE}" stroke-width="0.6"/>`,
      `<line x1="${fmt(pB.x)}" y1="${fmt(pB.y)}" x2="${fmt(pOffsetB.x)}" y2="${fmt(pOffsetB.y)}" stroke="${DETAIL_STROKE}" stroke-width="0.6"/>`,
      `<line x1="${fmt(pOffsetA.x)}" y1="${fmt(pOffsetA.y)}" x2="${fmt(pOffsetB.x)}" y2="${fmt(pOffsetB.y)}" stroke="${TEXT_FILL}" stroke-width="0.8"/>`,
      `<text x="${fmt(mid.x)}" y="${fmt(mid.y - 3)}" text-anchor="middle" font-size="11" fill="${TEXT_FILL}">${dimension.value.toFixed(2)} m</text>`,
    );
  }
  return out;
}

/** Nearest of `NICE_METRES` to `target`. */
function niceMetres(target: number): number {
  let best = NICE_METRES[0]!;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of NICE_METRES) {
    const diff = Math.abs(candidate - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}

function scaleBarEls(transform: Transform, width: number, height: number): string[] {
  const scale = Math.abs(transform.scale) > 1e-9 ? transform.scale : 1;
  const metres = niceMetres((width * SCALE_BAR_TARGET_FRACTION) / scale);
  const barWidth = metres * scale;
  const x0 = SCALE_BAR_MARGIN_PX;
  const x1 = x0 + barWidth;
  const y = height - SCALE_BAR_MARGIN_PX;
  return [
    `<line x1="${fmt(x0)}" y1="${fmt(y)}" x2="${fmt(x1)}" y2="${fmt(y)}" stroke="${TEXT_FILL}" stroke-width="1.5"/>`,
    `<line x1="${fmt(x0)}" y1="${fmt(y - SCALE_BAR_TICK_PX)}" x2="${fmt(x0)}" y2="${fmt(y + SCALE_BAR_TICK_PX)}" stroke="${TEXT_FILL}" stroke-width="1.5"/>`,
    `<line x1="${fmt(x1)}" y1="${fmt(y - SCALE_BAR_TICK_PX)}" x2="${fmt(x1)}" y2="${fmt(y + SCALE_BAR_TICK_PX)}" stroke="${TEXT_FILL}" stroke-width="1.5"/>`,
    `<text x="${fmt((x0 + x1) / 2)}" y="${fmt(y - SCALE_BAR_TICK_PX - 3)}" text-anchor="middle" font-size="10" fill="${TEXT_FILL}">${metres} m</text>`,
  ];
}

/**
 * Deterministic SVG of `drawing`: wall bodies filled, openings cut, windows
 * and door swings as strokes, fixtures outlined, room labels and facade
 * dimensions opt in (default on), a bottom-left scale bar (default on). No
 * DOM: a string is built and handed back, nothing is parsed or measured.
 */
export function planToSvg(drawing: PlanDrawing, plan: SolvedPlan, options: PlanSvgOptions): string {
  const padding = options.padding ?? DEFAULT_PADDING;
  const transform = fitTransform(drawing.bounds, { w: options.width, h: options.height }, padding);
  const locale = options.locale ?? 'en';

  const body: string[] = [
    ...(options.title === undefined ? [] : [`<title>${escapeXml(options.title)}</title>`]),
    `<desc>${escapeXml(CAVEAT[locale])}</desc>`,
    `<rect x="0" y="0" width="${fmt(options.width)}" height="${fmt(options.height)}" fill="${PAPER}"/>`,
    ...wallsAndOpenings(transform, drawing.primitives),
    ...doorsAndFixtures(transform, drawing.primitives),
    ...((options.dimensions ?? true) ? dimensionEls(transform, facadeDimensions(plan)) : []),
    ...((options.labels ?? true) ? labelEls(transform, drawing.primitives) : []),
    ...((options.scaleBar ?? true) ? scaleBarEls(transform, options.width, options.height) : []),
  ];

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${options.width} ${options.height}" width="${options.width}" height="${options.height}">` +
    body.join('') +
    `</svg>`
  );
}
