/**
 * The tour-camera tool's projection into the author's view: where each camera,
 * its footprint, its badge and its handles land in canvas pixels, and how big
 * one pixel is in metres at each of them — the numbers the size floor, the
 * constant-size handles and the screen-space picking all read, from ONE
 * function each, so what is drawn is exactly what is grabbed.
 *
 * Invariant: everything here reads the camera and the canvas box of the
 * moment it is asked (`viewOf`) and caches nothing — a resize, a zoom or an
 * orbit changes every number without telling anyone.
 */

import * as THREE from 'three';
import { handleLayout, ringPoints, type HandleScale } from './checkpoint-gizmo.js';
import { BODY_WIDTH_M, GLYPH_TOP_M, WEDGE_RADIUS_M } from './checkpoint-marker.js';
import { BODY_MIN_PX, type ActiveShapes, type HandleKind, type MarkerShape, type ScreenPoint } from './checkpoint-picking.js';
import type { TourCheckpoint, Vec3 } from '../scene/types.js';

/** The badge floats this far above the body's top, px. */
const BADGE_GAP_PX = 16;
/** Radius of the footprint disc a press may grab, metres (the drawn disc). */
const FOOTPRINT_GRAB_M = 0.12;

/**
 * A camera the picture can be drawn with: the perspective rig, or the
 * orthographic top view `plan3d` installs (`ui/plan-modes.ts`).
 */
export type ViewCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** The camera and canvas box of one moment. */
export type CheckpointView = {
  readonly camera: ViewCamera;
  readonly width: number;
  readonly height: number;
  /** A world point in canvas pixels; `null` behind the camera or past the far plane. */
  project(point: Vec3): ScreenPoint | null;
  /** The world size of one canvas pixel at a point's depth, metres. */
  metresPerPixel(point: Vec3): number;
};

/**
 * The view of `camera` over `canvas` right now; `null` before either can
 * answer. `camera` must be the one the frame is DRAWN with: projecting
 * through the perspective rig while `plan3d` draws through its top view put
 * every badge where the hidden 360 camera would see it.
 */
export function viewOf(camera: ViewCamera | undefined, canvas: HTMLCanvasElement): CheckpointView | null {
  if (!camera) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  // Asked from a frame hook, which runs before `renderer.render()` updates the
  // world matrix: without this the projection reads the previous frame's pose.
  camera.updateMatrixWorld();
  const scratch = new THREE.Vector3();
  const metresPerPixel =
    camera instanceof THREE.OrthographicCamera
      ? orthographicScale(camera, rect.height)
      : perspectiveScale(camera, camera.getWorldDirection(new THREE.Vector3()), rect.height);
  return {
    camera,
    width: rect.width,
    height: rect.height,
    project: (point) => {
      scratch.set(point.x, point.y, point.z).project(camera);
      if (scratch.z > 1 || scratch.z < -1) return null;
      return { x: ((scratch.x + 1) / 2) * rect.width, y: ((1 - scratch.y) / 2) * rect.height };
    },
    metresPerPixel,
  };
}

/** Perspective: a pixel grows with the point's depth along the view axis. */
function perspectiveScale(camera: THREE.PerspectiveCamera, forward: THREE.Vector3, height: number): (point: Vec3) => number {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  return (point) => {
    const depth =
      (point.x - camera.position.x) * forward.x + (point.y - camera.position.y) * forward.y + (point.z - camera.position.z) * forward.z;
    return (2 * Math.max(camera.near, depth) * tanHalf) / height;
  };
}

/** Orthographic: one pixel is the same number of metres at every depth. */
function orthographicScale(camera: THREE.OrthographicCamera, height: number): (point: Vec3) => number {
  const metres = (camera.top - camera.bottom) / Math.max(camera.zoom, 1e-6) / height;
  return () => metres;
}

/** The size floor (`size` ≥ 1 scales the body) and the handle scale for one camera. */
export function scaleAt(checkpoint: TourCheckpoint, view: CheckpointView): HandleScale & { size: number } {
  const head = view.metresPerPixel(checkpoint.position);
  const size = Math.max(1, (BODY_MIN_PX * head) / BODY_WIDTH_M);
  // The drawing camera's screen axes, world space: columns 0 and 1 of its world matrix.
  const e = view.camera.matrixWorld.elements;
  return {
    head,
    floor: view.metresPerPixel({ x: checkpoint.position.x, y: 0, z: checkpoint.position.z }),
    bodyHalfPx: (GLYPH_TOP_M * size) / head,
    bodyHalfWidthPx: (BODY_WIDTH_M * size) / head / 2,
    right: unit(e[0], e[1], e[2]),
    up: unit(e[4], e[5], e[6]),
    size,
  };
}

function unit(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

/** Where the order badge's centre goes: above the body's top. */
export function badgeAt(checkpoint: TourCheckpoint, view: CheckpointView): ScreenPoint | null {
  const at = view.project(checkpoint.position);
  return at ? { x: at.x, y: at.y - scaleAt(checkpoint, view).bodyHalfPx - BADGE_GAP_PX } : null;
}

/** What selects one camera: its body, its footprint disc, its badge. */
export function markerShape(checkpoint: TourCheckpoint, view: CheckpointView): MarkerShape {
  const scale = scaleAt(checkpoint, view);
  const at = view.project(checkpoint.position);
  const floor = view.project({ x: checkpoint.position.x, y: 0, z: checkpoint.position.z });
  return {
    id: checkpoint.id,
    body: at ? { at, radius: (BODY_WIDTH_M * scale.size) / scale.head / 2 } : null,
    footprint: floor ? { at: floor, radius: Math.max(6, FOOTPRINT_GRAB_M / scale.floor) } : null,
    badge: badgeAt(checkpoint, view),
  };
}

/**
 * The active camera's handles, projected: body, footprint, height arrow,
 * pitch slider, yaw ring, wedge tip — the ones `handles` names (the mode's;
 * `plan3d` has no height and no pitch), the others `null`.
 */
export function activeShapes(checkpoint: TourCheckpoint, view: CheckpointView, handles: ReadonlySet<HandleKind>): ActiveShapes {
  const layout = handleLayout(checkpoint, scaleAt(checkpoint, view));
  const marker = markerShape(checkpoint, view);
  const base = handles.has('height') ? view.project(layout.base) : null;
  const tip = handles.has('height') ? view.project(layout.tip) : null;
  const top = handles.has('pitch') ? view.project(layout.pitch.top) : null;
  const bottom = handles.has('pitch') ? view.project(layout.pitch.bottom) : null;
  const yaw = handles.has('yaw');
  const ring = yaw
    ? ringPoints(layout.centre, layout.ringRadius)
        .map((point) => view.project(point))
        .filter((point): point is ScreenPoint => point !== null)
    : [];
  const { x, z } = checkpoint.position;
  return {
    body: marker.body,
    footprint: marker.footprint,
    height: base && tip ? [base, tip] : null,
    pitch: top && bottom ? [top, bottom] : null,
    ring: ring.length > 2 ? ring : null,
    wedgeTip: yaw
      ? view.project({ x: x + Math.sin(checkpoint.yaw) * WEDGE_RADIUS_M, y: 0, z: z + Math.cos(checkpoint.yaw) * WEDGE_RADIUS_M })
      : null,
  };
}
