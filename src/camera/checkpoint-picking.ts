/**
 * Screen-space picking for the tour-camera tool: which handle a press at a
 * pixel belongs to, decided by the
 * DISTANCE in CSS pixels from the pointer to each handle's projected shape —
 * never by a ray against invisible proxies, whose hit sizes shrank with the
 * zoom and whose «priority» was really the ray's depth order.
 *
 * Pure: no three, no DOM (the shared kit it reads, `edit/drag-kit.ts`, names
 * three only as types). The overlay projects the shapes; everything here is
 * plane geometry over pixels plus the angle arithmetic the gestures share, so
 * the rules are pinned by unit tests without a renderer.
 *
 * Invariant: the priority is FIXED — body > footprint > height > pitch > yaw
 * — and a candidate of a higher rank wins over
 * a nearer one of a lower rank, so the body can always be dragged from its
 * centre (the height arrow starts above it on screen, the pitch slider beside
 * it) and an overlap never turns a move into a lift or a tilt.
 */

import { SAME_ANGLE_RAD, sameAngle, samePosition, snapAngle } from '../edit/drag-kit.js';

/** A point in CSS pixels of the canvas, origin top-left. */
export type ScreenPoint = { readonly x: number; readonly y: number };

/** How far from a handle's drawn shape a press still grabs it, px (within a 14–18 px band). */
export const GRACE_PX = 16;
/** A click further than this from every handle of the active camera clears the focus, px. */
export const DESELECT_PX = 24;
/** Smallest on-screen size of a camera body, px: a world-size body is scaled up to at least this. */
export const BODY_MIN_PX = 28;
/** Yaw ring radius on the floor, px — constant screen size (within a 70–90 px band). */
export const RING_RADIUS_PX = 80;
/** Gap between the body's top and the height arrow's base, px. */
export const HEIGHT_GAP_PX = 20;
/** Height arrow length above that gap, px. */
export const HEIGHT_LENGTH_PX = 56;
/** Gap between the body's side and the pitch slider, px. */
export const PITCH_GAP_PX = 20;
/** Pitch slider length, px: the same as the height arrow. */
export const PITCH_LENGTH_PX = 56;
/** Pitch per pixel of vertical drag on the slider: 0.25°. */
export const PITCH_RAD_PER_PX = (0.25 / 180) * Math.PI;
/** Shift-drag snap on the pitch slider: 5°. */
export const PITCH_SNAP_RAD = (5 / 180) * Math.PI;

/** What a claimed press does. `move` covers the body AND the floor footprint. */
export type HandleKind = 'move' | 'height' | 'pitch' | 'yaw';

/** The active camera's handles, projected. `null` members are off-screen or behind the camera. */
export type ActiveShapes = {
  /** Body centre and its drawn radius in px. */
  readonly body: { readonly at: ScreenPoint; readonly radius: number } | null;
  /** The footprint disc's centre on the floor and its radius in px. */
  readonly footprint: { readonly at: ScreenPoint; readonly radius: number } | null;
  /** The height arrow, base to tip. */
  readonly height: readonly [ScreenPoint, ScreenPoint] | null;
  /** The pitch slider, top to bottom, standing upright on screen beside the body. */
  readonly pitch: readonly [ScreenPoint, ScreenPoint] | null;
  /** The yaw ring as a closed polyline. */
  readonly ring: readonly ScreenPoint[] | null;
  /** The tip of the floor wedge — dragging it turns the yaw too. */
  readonly wedgeTip: ScreenPoint | null;
};

/** One camera the pointer may SELECT (every camera, the active one included). */
export type MarkerShape = {
  readonly id: string;
  readonly body: { readonly at: ScreenPoint; readonly radius: number } | null;
  readonly footprint: { readonly at: ScreenPoint; readonly radius: number } | null;
  /** The order badge's centre; a press on it selects and moves the camera. */
  readonly badge: ScreenPoint | null;
};

export type Pick = { readonly id: string; readonly kind: HandleKind };

export function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from `p` to the segment `a`–`b`, px. */
export function distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return distance(p, a);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to a CLOSED polyline, px; `Infinity` for fewer than two points. */
export function distanceToLoop(p: ScreenPoint, points: readonly ScreenPoint[]): number {
  if (points.length < 2) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    best = Math.min(best, distanceToSegment(p, points[index]!, points[(index + 1) % points.length]!));
  }
  return best;
}

/** Distance from `p` to a disc's rim-or-inside: `0` inside, px outside. */
function toDisc(p: ScreenPoint, disc: { at: ScreenPoint; radius: number } | null): number {
  return disc ? Math.max(0, distance(p, disc.at) - disc.radius) : Number.POSITIVE_INFINITY;
}

/**
 * Distance from `p` to each of the active camera's handles, in the fixed
 * priority order. The overlay reads the SAME numbers for the click-away rule
 * (`nearestActiveHandle`), so «claimed» and «not far enough to deselect» can
 * never disagree about where a handle is.
 */
function activeDistances(p: ScreenPoint, shapes: ActiveShapes): Array<[HandleKind, number]> {
  return [
    ['move', toDisc(p, shapes.body)],
    ['move', toDisc(p, shapes.footprint)],
    ['height', shapes.height ? distanceToSegment(p, shapes.height[0], shapes.height[1]) : Number.POSITIVE_INFINITY],
    ['pitch', shapes.pitch ? distanceToSegment(p, shapes.pitch[0], shapes.pitch[1]) : Number.POSITIVE_INFINITY],
    ['yaw', shapes.ring ? distanceToLoop(p, shapes.ring) : Number.POSITIVE_INFINITY],
    ['yaw', shapes.wedgeTip ? distance(p, shapes.wedgeTip) : Number.POSITIVE_INFINITY],
  ];
}

/** The pixel distance from `p` to the nearest handle of the active camera; `Infinity` without one. */
export function nearestActiveHandle(p: ScreenPoint, shapes: ActiveShapes | null): number {
  if (!shapes) return Number.POSITIVE_INFINITY;
  return Math.min(...activeDistances(p, shapes).map(([, value]) => value));
}

/**
 * What a press at `p` grabs, or `null` when it grabs nothing and belongs to
 * the orbit. The active camera's handles are tried first, in the fixed
 * priority (the FIRST within `grace` wins, however much nearer a later one
 * is); then every camera's body, footprint and badge, the NEAREST winning —
 * two cameras overlapping on screen answer with the one the pointer is closer
 * to.
 */
export function pickHandle(
  p: ScreenPoint,
  active: { readonly id: string; readonly shapes: ActiveShapes } | null,
  markers: readonly MarkerShape[],
  grace = GRACE_PX,
): Pick | null {
  if (active) {
    for (const [kind, value] of activeDistances(p, active.shapes)) {
      if (value <= grace) return { id: active.id, kind };
    }
  }
  let best: { id: string; value: number } | null = null;
  for (const marker of markers) {
    const value = Math.min(
      toDisc(p, marker.body),
      toDisc(p, marker.footprint),
      marker.badge ? distance(p, marker.badge) : Number.POSITIVE_INFINITY,
    );
    if (value <= grace && (best === null || value < best.value)) best = { id: marker.id, value };
  }
  return best ? { id: best.id, kind: 'move' } : null;
}

/** The cursor that names what a handle does (selection feedback). */
export function cursorFor(kind: HandleKind | null): string {
  if (kind === 'move') return 'move';
  if (kind === 'height' || kind === 'pitch') return 'ns-resize';
  if (kind === 'yaw') return ROTATE_CURSOR;
  return '';
}

/**
 * CSS has no rotate cursor; a small circular-arrow glyph with `grab` as the
 * fallback the platform draws when data URIs are refused.
 */
const ROTATE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23111' stroke-width='2.4'%3E%3Cpath d='M20 12a8 8 0 1 1-2.3-5.6'/%3E%3Cpath d='M20 4v5h-5'/%3E%3C/svg%3E\") 12 12, grab";

// ------------------------------------------------------------------ angles --

// The angle arithmetic lives in the editor's shared kit.
export { YAW_SNAP_RAD, YawSweep, floorAngle, wrapAngle } from '../edit/drag-kit.js';

/**
 * The pitch a vertical slider drag asks for: RELATIVE to the pitch at the
 * grab, 0.25° per pixel, a drag UP tilting the view up (screen `y` grows
 * down), Shift snapping to 5°, clamped to `±limit`.
 */
export function pitchFromDrag(startPitch: number, dy: number, snap: boolean, limit: number): number {
  const pitch = startPitch - dy * PITCH_RAD_PER_PX;
  const snapped = snap ? snapAngle(pitch, PITCH_SNAP_RAD) : pitch;
  return Math.min(limit, Math.max(-limit, snapped));
}

// ------------------------------------------------------------ comparisons --

type Pose = {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
  readonly pitch: number;
  readonly name?: string | undefined;
};

/** Whether two poses are the same shot within 1 mm and 0.1° (so an unchanged pose never commits). */
export function samePose(a: Pose, b: Pose): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    samePosition(a.position, b.position) &&
    sameAngle(a.yaw, b.yaw) &&
    Math.abs(a.pitch - b.pitch) < SAME_ANGLE_RAD
  );
}

/** Whether two ordered lists are the same list of the same shots. */
export function sameList(a: readonly Pose[], b: readonly Pose[]): boolean {
  return a.length === b.length && a.every((pose, index) => samePose(pose, b[index]!));
}
