/**
 * The asset move tool's two handles, beside the drag on the body itself:
 *
 * - the YAW ring, lying round a floor or ceiling object's footprint: a drag
 *   along it turns the object by the angle swept, in `TURN_STEP_DEG` steps
 *   (the step `turnAsset` and Q/E take);
 * - the HEIGHT bar, beside a wall object in `plan3d`, where the top view has
 *   no height to read: a drag up the screen lifts the object, a drag down
 *   lowers it, kept in the band `height-fit` allows.
 *
 * A wall object does not turn (its yaw is its face's), so it has no ring; in
 * `orbit` its height is the drag's own vertical gesture, so it has no bar.
 *
 * Picking is by DISTANCE in CSS pixels from the pointer to the handle's
 * projected shape, like the tour-camera tool's (`camera/checkpoint-picking.ts`).
 *
 * Pure: plane geometry over plan points and pixels.
 */

import type { MaskSurface } from '../layout/asset-mask.js';

export type AssetHandle = 'yaw' | 'height';

/** A point in the plan with its height, metres. */
export type HandlePoint = { readonly x: number; readonly y: number; readonly z: number };
/** A point in CSS pixels of the canvas. */
export type HandlePixel = { readonly x: number; readonly y: number };

/** What is drawn and grabbed: a ring on a horizontal plane, or a straight bar. */
export type HandleShape =
  | { readonly kind: 'yaw'; readonly centre: HandlePoint; readonly radius: number }
  | { readonly kind: 'height'; readonly from: HandlePoint; readonly to: HandlePoint };

/** How far outside an object's footprint its ring lies, metres. */
export const RING_MARGIN_M = 0.25;
/** The ring's lift off the floor (or below the ceiling), metres: clear of z-fighting. */
export const RING_LIFT_M = 0.015;
/** The height bar's length, and its gap from the body's side, metres. */
export const BAR_LENGTH_M = 0.6;
export const BAR_GAP_M = 0.2;
/** How far from a handle's drawn shape a press still grabs it, px (the camera tool's grace). */
export const HANDLE_GRACE_PX = 16;
/** Points of the ring polyline the picking measures against. */
const RING_POINTS = 48;

/** The object a handle belongs to, as the drag judges it. */
export type HandleTarget = {
  readonly surface: MaskSurface;
  readonly position: HandlePoint;
  /** Half-extents of its footprint, metres (`LintItem.dims` / 2). */
  readonly hx: number;
  readonly hz: number;
  /** Its yaw, radians: the bar of a wall object stands off its side along the face. */
  readonly rotationY: number;
  /** The top of its body for a ceiling object, the ceiling height, metres. */
  readonly ceiling: number;
};

/**
 * The handle `target` gets in `mode`, or `null`: a ring for a floor or a
 * ceiling object, a bar for a wall object in `plan3d`. `screenUp` is the plan
 * direction pointing up the screen in the top view.
 */
export function handleShape(target: HandleTarget, mode: 'orbit' | 'plan3d', screenUp: { x: number; z: number }): HandleShape | null {
  const { position } = target;
  if (target.surface === 'floor' || target.surface === 'ceiling') {
    const y = target.surface === 'floor' ? RING_LIFT_M : target.ceiling - RING_LIFT_M;
    return { kind: 'yaw', centre: { x: position.x, y, z: position.z }, radius: Math.hypot(target.hx, target.hz) + RING_MARGIN_M };
  }
  if (mode !== 'plan3d') return null;
  // Beside the body along its face (the object's own x axis), running up the screen.
  const side = { x: Math.cos(target.rotationY), z: -Math.sin(target.rotationY) };
  const at = { x: position.x + side.x * (target.hx + BAR_GAP_M), z: position.z + side.z * (target.hx + BAR_GAP_M) };
  const half = BAR_LENGTH_M / 2;
  return {
    kind: 'height',
    from: { x: at.x - screenUp.x * half, y: position.y, z: at.z - screenUp.z * half },
    to: { x: at.x + screenUp.x * half, y: position.y, z: at.z + screenUp.z * half },
  };
}

/** The shape as the plan polyline it is drawn and picked along. */
export function shapePoints(shape: HandleShape): HandlePoint[] {
  if (shape.kind === 'height') return [shape.from, shape.to];
  const points: HandlePoint[] = [];
  for (let i = 0; i <= RING_POINTS; i += 1) {
    const angle = (i / RING_POINTS) * Math.PI * 2;
    points.push({
      x: shape.centre.x + shape.radius * Math.sin(angle),
      y: shape.centre.y,
      z: shape.centre.z + shape.radius * Math.cos(angle),
    });
  }
  return points;
}

function toSegment(p: HandlePixel, a: HandlePixel, b: HandlePixel): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The handle a press at `pointer` grabs: within `HANDLE_GRACE_PX` of the projected shape, else `null`. */
export function handleAt(
  shape: HandleShape | null,
  project: (point: HandlePoint) => HandlePixel | null,
  pointer: HandlePixel,
): AssetHandle | null {
  if (!shape) return null;
  const pixels = shapePoints(shape).map((point) => project(point));
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < pixels.length; i += 1) {
    const a = pixels[i];
    const b = pixels[i + 1];
    if (a && b) nearest = Math.min(nearest, toSegment(pointer, a, b));
  }
  return nearest <= HANDLE_GRACE_PX ? shape.kind : null;
}
