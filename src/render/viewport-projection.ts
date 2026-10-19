/**
 * World-to-viewport projection: the one place a world point becomes a CSS
 * pixel coordinate. Used by the mini-map camera marker, the door HUD's
 * screen point and `window.__viewerDebug`'s `projectPoint`, so the three
 * call sites cannot project differently.
 *
 * Pure aside from the `THREE.Camera` and `THREE.Vector3` arguments; never
 * mutates the point it is given.
 */

import type * as THREE from 'three';

/**
 * Projects a world point to CSS-pixel viewport coordinates through `camera`.
 * `null` when the point is behind the camera (`projected.z > 1` in NDC),
 * which is what tells a caller "there is nothing to draw here" instead of a
 * pixel coordinate that happens to be off-screen.
 */
export function projectToViewport(
  camera: THREE.Camera,
  point: THREE.Vector3,
  viewport: { width: number; height: number },
): { x: number; y: number } | null {
  const projected = point.clone().project(camera);
  if (projected.z > 1) return null;
  return {
    x: ((projected.x + 1) * viewport.width) / 2,
    y: ((1 - projected.y) * viewport.height) / 2,
  };
}

/**
 * Where the camera stands and looks, as the mini-map's marker.
 *
 * The heading comes from the POSE, not from the walk look angles: in tour mode
 * those are stale, and the map has to follow the clip like everything else
 * does. `fov` is the HORIZONTAL field of view, which is what a cone on a plan
 * means; the camera carries the vertical one.
 */
export function cameraMarker(
  camera: THREE.PerspectiveCamera,
  pose: { position: { x: number; z: number }; target: { x: number; z: number } },
): { x: number; z: number; yaw: number; fov: number } {
  const dx = pose.target.x - pose.position.x;
  const dz = pose.target.z - pose.position.z;
  const vertical = (camera.fov * Math.PI) / 180;
  return {
    x: pose.position.x,
    z: pose.position.z,
    yaw: dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) : 0,
    fov: 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect),
  };
}
