/**
 * Painter for `plan-drawing.ts`: the same primitives on paper (`'drawing'`,
 * the full-viewport 2D mode) and on a card (`'minimap'`, the small map of the
 * walk and tour modes).
 *
 * Invariant: this module owns no element and no id. It is handed a 2D context,
 * a drawing in plan metres and the transform that maps them to CSS pixels, and
 * it paints — nothing else. `fitCanvasToBox` is the one DOM convenience it
 * offers: size a canvas's backing store to its CSS box at the device pixel
 * ratio and hand back the context already scaled, so every length below is in
 * CSS pixels whatever the display.
 *
 * The two styles differ only in palette and in what they leave out: the
 * mini-map drops the leaf, the swing arc, the fixtures, the room labels and
 * the dimension chains (`palette.detail`; all illegible at 196 px) and adds
 * the room highlight. The camera dot and its view cone are common to both —
 * the mini-map always wants one, `plan2d` wants one when `options.plan.camera`
 * is on (`ui/plan-modes.ts`).
 */

import { planPoint, type PlanDrawing, type PlanPrimitive, type PlanTransform } from './plan-drawing.js';
import { add, leftN, mul, norm, sub } from './plan-geometry.js';

export type PlanStyle = 'drawing' | 'minimap';

/** Camera marker of the mini-map: plan position, heading and horizontal FOV. */
export type PlanCameraMarker = {
  x: number;
  z: number;
  /** Heading in radians, measured as `atan2(dx, dz)` like the walk controller. */
  yaw: number;
  /** Horizontal field of view in radians; a sensible default is used when absent. */
  fov?: number;
};

export type PlanPaintOptions = {
  /** Room id to fill with the accent (mini-map hover). */
  highlightRoom?: string | null;
  /** Camera dot and view cone; both the mini-map and `plan2d` may ask for one. */
  camera?: PlanCameraMarker | null;
  /** Radius of the view cone in plan metres. */
  coneRadius?: number;
};

type Palette = {
  paper: string;
  body: string;
  /** Leaf, swing arc and fixture outlines. */
  line: string;
  /** Window pane lines. */
  pane: string;
  accent: string;
  /** Room-label and dimension-chain text and lines. */
  text: string;
  /** Whether the door leaf, the swing arc, the fixtures, the labels and the dimensions are drawn at all. */
  detail: boolean;
};

const PALETTES: Record<PlanStyle, Palette> = {
  drawing: { paper: '#ffffff', body: '#101010', line: '#6f6f6f', pane: '#3d3d3d', accent: '#dfbd7d', text: '#242424', detail: true },
  minimap: { paper: '#ffffff', body: '#2b302f', line: '#8b8b8b', pane: '#5c5c5c', accent: '#e08a3c', text: '#242424', detail: false },
};

/** Room-name font, CSS pixels (`drawing` style; illegible at mini-map size, gated by `palette.detail`). */
const LABEL_NAME_FONT = '600 13px system-ui, sans-serif';
/** Room-area font, CSS pixels; drawn one line below the name. */
const LABEL_AREA_FONT = '11px system-ui, sans-serif';
/** Gap between a room name and its area line, CSS pixels. */
const LABEL_LINE_GAP_PX = 14;
/** Dimension value font, CSS pixels. */
const DIMENSION_FONT = '11px system-ui, sans-serif';
/** Half-length of a dimension tick mark, CSS pixels. */
const DIMENSION_TICK_PX = 4;

/** Padding around the drawing, as a fraction of the viewport side. */
export const PLAN_PADDING = 0.06;
/** Default horizontal field of view of the mini-map cone, radians. */
const DEFAULT_CONE_FOV = 1.15;
/** Default reach of the mini-map view cone, metres. */
const DEFAULT_CONE_RADIUS_M = 3.2;
/** Cap on the backing-store scale; a 3x phone would quadruple the fill cost for nothing. */
const MAX_PIXEL_RATIO = 2;

/**
 * Sizes a canvas's backing store to its CSS box and returns a context whose
 * user space is CSS pixels. `null` when the element has no box yet or the
 * browser refuses a 2D context.
 */
export function fitCanvasToBox(
  canvas: HTMLCanvasElement,
  box: { clientWidth: number; clientHeight: number },
  pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = Math.max(1, Math.round(box.clientWidth));
  const h = Math.max(1, Math.round(box.clientHeight));
  const ratio = Math.min(MAX_PIXEL_RATIO, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1));
  const width = Math.round(w * ratio);
  const height = Math.round(h * ratio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, w, h };
}

/** What a `PRIMITIVE_PAINTERS` entry needs; built once per `paintPlan` call. */
type PainterContext = {
  ctx: CanvasRenderingContext2D;
  at: (point: { x: number; z: number }) => { x: number; y: number };
  transform: PlanTransform;
  palette: Palette;
  style: PlanStyle;
};

/**
 * Every `PlanPrimitive.kind` that is actually painted; `room` is hit-test only
 * (the highlight fill is its own pre-pass). `label` and `dimension`
 * (`plan-dimensions.ts`) are painted separately, after the primitive
 * loop — they are text and ticked lines, not filled or stroked polygons, and
 * do not fit the one-`strokeStyle`-per-kind shape `PRIMITIVE_PAINTERS` is.
 */
type PaintedKind = Exclude<PlanPrimitive['kind'], 'room' | 'label' | 'dimension'>;

/** One bucket of primitives per kind, built by `bucketPrimitives` so each painter below scans only its own. */
type PrimitiveBuckets = Readonly<Record<PlanPrimitive['kind'], PlanPrimitive[]>>;

function bucketPrimitives(primitives: readonly PlanPrimitive[]): PrimitiveBuckets {
  const buckets: Record<PlanPrimitive['kind'], PlanPrimitive[]> = {
    wall: [],
    opening: [],
    leaf: [],
    swing: [],
    window: [],
    fixture: [],
    room: [],
    label: [],
    dimension: [],
  };
  for (const primitive of primitives) buckets[primitive.kind].push(primitive);
  return buckets;
}

/**
 * One painter per painted `PlanPrimitive.kind`, keyed and iterated in the
 * order the drawing overlays them on paper: solid bodies, the white cuts an
 * opening punches through them, the window panes, then (style permitting)
 * the door leaf, its swing arc and the fixture outlines. Each sets its own
 * `strokeStyle`/`lineWidth` rather than relying on what the previous painter
 * left behind, so the entries stay independently correct in any order.
 */
const PRIMITIVE_PAINTERS: Readonly<Record<PaintedKind, (context: PainterContext, bucket: readonly PlanPrimitive[]) => void>> = {
  // Bodies first, then the white cuts over them: an opening is a hole in the
  // wall, and painting it as paper is the cheapest honest way to say so.
  //
  // One fill per body, not one accumulated path: a wall band runs clockwise
  // and a joint core counter-clockwise, so a single `nonzero` fill would
  // CANCEL every overlap between them and punch a hole at each junction.
  wall: ({ ctx, at, palette }, bucket) => {
    ctx.fillStyle = palette.body;
    for (const primitive of bucket) {
      if (primitive.kind !== 'wall') continue;
      tracePolygon(ctx, primitive.polygon, at);
      ctx.fill();
    }
  },
  opening: ({ ctx, at, palette }, bucket) => {
    ctx.fillStyle = palette.paper;
    for (const primitive of bucket) {
      if (primitive.kind !== 'opening') continue;
      tracePolygon(ctx, primitive.quad, at);
      ctx.fill();
    }
  },
  window: ({ ctx, at, palette, style }, bucket) => {
    ctx.strokeStyle = palette.pane;
    ctx.lineWidth = style === 'drawing' ? 0.9 : 0.7;
    for (const primitive of bucket) {
      if (primitive.kind !== 'window') continue;
      tracePolygon(ctx, primitive.quad, at);
      ctx.stroke();
    }
  },
  leaf: ({ ctx, at, palette }, bucket) => {
    if (!palette.detail) return;
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1.1;
    for (const primitive of bucket) {
      if (primitive.kind !== 'leaf') continue;
      const from = at(primitive.from);
      const to = at(primitive.to);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  },
  swing: ({ ctx, at, palette, transform }, bucket) => {
    if (!palette.detail) return;
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 0.8;
    for (const primitive of bucket) {
      if (primitive.kind !== 'swing') continue;
      const centre = at(primitive.centre);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, primitive.radius * transform.scale, primitive.a0, primitive.a1, primitive.a1 < primitive.a0);
      ctx.stroke();
    }
  },
  fixture: ({ ctx, at, palette }, bucket) => {
    if (!palette.detail) return;
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 0.9;
    for (const primitive of bucket) {
      if (primitive.kind !== 'fixture') continue;
      tracePolygon(ctx, primitive.polygon, at);
      ctx.stroke();
    }
  },
};

/** Drawn in this order — see the doc comment on `PRIMITIVE_PAINTERS`. */
const PAINT_ORDER: readonly PaintedKind[] = ['wall', 'opening', 'window', 'leaf', 'swing', 'fixture'];

/**
 * Paints one drawing. The paper is filled first, so the result is opaque and
 * can sit over the WebGL canvas without letting the last frame through.
 */
export function paintPlan(
  ctx: CanvasRenderingContext2D,
  drawing: PlanDrawing,
  transform: PlanTransform,
  style: PlanStyle,
  options: PlanPaintOptions = {},
): void {
  const palette = PALETTES[style];
  const at = (point: { x: number; z: number }): { x: number; y: number } => planPoint(transform, point);

  const matrix = ctx.getTransform();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  ctx.setTransform(matrix);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';

  const buckets = bucketPrimitives(drawing.primitives);

  if (options.highlightRoom) {
    ctx.fillStyle = withAlpha(palette.accent, 0.25);
    for (const primitive of buckets.room) {
      if (primitive.kind !== 'room' || primitive.id !== options.highlightRoom) continue;
      tracePolygon(ctx, primitive.polygon, at);
      ctx.fill();
    }
  }

  const context: PainterContext = { ctx, at, transform, palette, style };
  for (const kind of PAINT_ORDER) PRIMITIVE_PAINTERS[kind](context, buckets[kind]);

  paintDimensions(ctx, buckets.dimension, at, transform, palette);
  paintLabels(ctx, buckets.label, at, palette);

  if (options.camera) paintCamera(ctx, options.camera, transform, palette, options.coneRadius ?? DEFAULT_CONE_RADIUS_M);
}

/**
 * Room name, then its area one line below, both centred on `label.at` — the
 * point `plan-dimensions.roomLabels` already placed strictly inside the room
 * polygon. `≈` marks the area as an approximation ("area only with a
 * caveat"): it is the shoelace area of the SOLVED polygon, not a surveyed
 * figure.
 */
function paintLabels(ctx: CanvasRenderingContext2D, labels: readonly PlanPrimitive[], at: PainterContext['at'], palette: Palette): void {
  if (!palette.detail || labels.length === 0) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.text;
  for (const primitive of labels) {
    if (primitive.kind !== 'label') continue;
    const centre = at(primitive.at);
    ctx.font = LABEL_NAME_FONT;
    ctx.fillText(primitive.text, centre.x, centre.y);
    ctx.font = LABEL_AREA_FONT;
    ctx.fillText(`≈ ${primitive.area.toFixed(1)} m²`, centre.x, centre.y + LABEL_LINE_GAP_PX);
  }
  ctx.restore();
}

/**
 * One facade dimension chain: two short extension lines from the wall face
 * out to the offset dimension line, the line itself with a tick at each end,
 * and the value centred above it.
 */
function paintDimensions(
  ctx: CanvasRenderingContext2D,
  dimensions: readonly PlanPrimitive[],
  at: PainterContext['at'],
  transform: PlanTransform,
  palette: Palette,
): void {
  if (!palette.detail || dimensions.length === 0) return;
  ctx.save();
  ctx.strokeStyle = palette.text;
  ctx.lineWidth = 0.8;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = DIMENSION_FONT;
  ctx.fillStyle = palette.text;

  for (const primitive of dimensions) {
    if (primitive.kind !== 'dimension') continue;
    const dir = norm(sub(primitive.b, primitive.a));
    const side = leftN(dir);
    const signed = primitive.side === 'L' ? side : mul(side, -1);
    const offsetA = add(primitive.a, mul(signed, primitive.offset));
    const offsetB = add(primitive.b, mul(signed, primitive.offset));
    const pA = at(primitive.a);
    const pB = at(primitive.b);
    const pOffsetA = at(offsetA);
    const pOffsetB = at(offsetB);
    const tick = mul(signed, DIMENSION_TICK_PX / Math.max(1e-6, transform.scale));
    const tickA = at(add(offsetA, tick));
    const tickB = at(add(offsetB, tick));

    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pOffsetA.x, pOffsetA.y);
    ctx.moveTo(pB.x, pB.y);
    ctx.lineTo(pOffsetB.x, pOffsetB.y);
    ctx.moveTo(pOffsetA.x, pOffsetA.y);
    ctx.lineTo(pOffsetB.x, pOffsetB.y);
    ctx.moveTo(pOffsetA.x, pOffsetA.y);
    ctx.lineTo(tickA.x, tickA.y);
    ctx.moveTo(pOffsetB.x, pOffsetB.y);
    ctx.lineTo(tickB.x, tickB.y);
    ctx.stroke();

    const mid = { x: (pOffsetA.x + pOffsetB.x) / 2, y: (pOffsetA.y + pOffsetB.y) / 2 };
    ctx.fillText(`${primitive.value.toFixed(2)} m`, mid.x, mid.y - 3);
  }
  ctx.restore();
}

/** The orange dot, its ring and the view cone of the mini-map. */
function paintCamera(
  ctx: CanvasRenderingContext2D,
  camera: PlanCameraMarker,
  transform: PlanTransform,
  palette: Palette,
  coneRadius: number,
): void {
  const centre = planPoint(transform, { x: camera.x, z: camera.z });
  const radius = Math.max(6, coneRadius * transform.scale);
  const fov = camera.fov ?? DEFAULT_CONE_FOV;
  // `yaw` is `atan2(dx, dz)`; the plan angle of that heading is `atan2(z, x)`
  // of the same direction, which is `PI/2 - yaw`.
  const heading = Math.PI / 2 - camera.yaw;

  ctx.fillStyle = withAlpha(palette.accent, 0.35);
  ctx.beginPath();
  ctx.moveTo(centre.x, centre.y);
  ctx.arc(centre.x, centre.y, radius, heading - fov / 2, heading + fov / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, 5.2, 0, Math.PI * 2);
  ctx.stroke();
}

/** One closed path from a plan polygon; the caller fills or strokes it. */
function tracePolygon(
  ctx: CanvasRenderingContext2D,
  polygon: readonly { x: number; z: number }[],
  at: (point: { x: number; z: number }) => { x: number; y: number },
): void {
  ctx.beginPath();
  if (polygon.length < 2) return;
  const first = at(polygon[0]!);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < polygon.length; i += 1) {
    const point = at(polygon[i]!);
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

/** `#rrggbb` plus an alpha, as `rgba(...)`; any other notation is returned as is. */
function withAlpha(colour: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return colour;
  const value = Number.parseInt(colour.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
