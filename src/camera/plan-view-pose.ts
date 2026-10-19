/**
 * The perspective stand-in for a plan mode's top view.
 *
 * `plan2d` paints a drawing and `plan3d` draws through an orthographic camera,
 * while the camera stack only ever moves the PERSPECTIVE camera, which a plan
 * mode leaves frozen wherever the 360 view was. A walk or tour entry glides
 * from the view on screen, so from a plan mode
 * it needs a perspective pose that shows what the plan showed: straight down,
 * north up, over the same centre, high enough that the FLOOR fills the frame
 * exactly as the top view's frustum does. The first frame of the glide then
 * lands the plan's floor on the pixels it already occupied.
 */

import * as THREE from 'three';
import { fieldOfViewFor } from './camera-tuning.js';
import type { TourPose } from './tour-player.js';

/**
 * How far north of the plumb point the gaze aims, as a fraction of the height:
 * a view EXACTLY straight down has no heading, and `lookAt` would pick one.
 * One thousandth keeps north up at a tilt nobody can see (0.06°).
 */
const NORTH_TILT = 1e-3;
/**
 * Rounds of the height ↔ field-of-view fixed point. Above `fov.boostTopM`
 * (5.2 m) the policy is flat and one round is exact; inside the blend band
 * below it the rounds converge geometrically, and four are well inside 1 %.
 */
const FIT_ROUNDS = 4;

/**
 * The perspective pose whose picture of the floor (`y = 0`) matches `top`, a
 * top view as `plan-modes.ts` fits it (looking down, `up` = -Z). `aspect` is
 * the perspective camera's, which is the viewport's: the field of view comes
 * from the same policy the controller applies every frame (`fieldOfViewFor`),
 * so the pose is what the next rendered frame really shows.
 */
export function planViewPose(top: THREE.OrthographicCamera, aspect: number): TourPose {
  const halfHeight = (top.top - top.bottom) / 2 / Math.max(top.zoom, 1e-6);
  const centre = new THREE.Vector3(top.position.x, 0, top.position.z);
  let height = top.position.y;
  for (let round = 0; round < FIT_ROUNDS; round += 1) {
    const fov = THREE.MathUtils.degToRad(fieldOfViewFor(aspect, height));
    height = halfHeight / Math.tan(fov / 2);
  }
  return {
    position: new THREE.Vector3(centre.x, height, centre.z),
    target: new THREE.Vector3(centre.x, 0, centre.z - height * NORTH_TILT),
  };
}
