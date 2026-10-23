/**
 * Fits the sun's orthographic shadow frustum to the apartment: the boxes of
 * everything that casts or receives, a sun direction and the map size the rig
 * really allocated.
 *
 * Light space is three's own: the shadow camera stands at the light and looks
 * at its target, so its `-z` is the opposite of the sun direction `d`; its up
 * is `+y`, or `-z` when the sun is within one degree of the zenith (where `+y`
 * and `d` are nearly parallel and `lookAt` would have no basis). The camera's
 * `x` is `normalize(up x d)` and its `y` is `d x x`, exactly what
 * `Matrix4.lookAt` builds, so the six planes returned here are the planes the
 * shadow camera ends up with.
 *
 * Invariants: every corner of every box lies inside the six planes with the
 * standard's lateral and depth padding to spare; the light stands upstream of
 * every box; the near plane is at least the standard's minimum. The fit is
 * fixed in the world (it does not follow the view camera), so no texel
 * snapping is needed. Bias is a constant depth offset in metres turned into
 * depth-buffer units, normal bias half a world texel inside the standard's
 * clamp.
 *
 * Pure module: no `three`, no DOM.
 */

import { LightingError } from './lighting-error.js';
import { LIGHTING_STANDARD, type Triple } from './lighting-standard.js';

/** An axis-aligned box in world metres. */
export type ShadowBox = { readonly min: Triple; readonly max: Triple };

/** A fitted shadow frustum: where the light and its target stand, the camera's up, its planes and biases. */
export type ShadowFit = {
  readonly position: Triple;
  readonly target: Triple;
  readonly up: Triple;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly near: number;
  readonly far: number;
  /** Depth-buffer bias (`DirectionalLightShadow.bias`). */
  readonly bias: number;
  /** World normal offset, metres (`DirectionalLightShadow.normalBias`). */
  readonly normalBias: number;
  /** The larger side of one shadow-map texel in the world, metres. */
  readonly texel: number;
};

/** Cosine of one degree: a sun closer than this to straight up takes `-z` as the camera's up. */
const ZENITH_COS = Math.cos(Math.PI / 180);

function refuse(message: string): never {
  throw new LightingError('bad-options', `shadow fit refused: ${message}`);
}

function finiteTriple(value: Triple): boolean {
  return value.length === 3 && value.every((component) => typeof component === 'number' && Number.isFinite(component));
}

function cross(a: Triple, b: Triple): Triple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalise(value: Triple): Triple {
  const length = Math.hypot(value[0], value[1], value[2]);
  return [value[0] / length, value[1] / length, value[2] / length];
}

function dot(a: Triple, b: Triple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The unit sun direction, or a refusal for one that is zero, non-finite or not above the horizon. */
function judgeDirection(direction: Triple): Triple {
  if (!finiteTriple(direction)) refuse('the sun direction must be three finite numbers');
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length === 0) refuse('the sun direction must not be zero');
  if (direction[1] <= 0) refuse('the sun direction must point upwards');
  return normalise(direction);
}

function judgeBoxes(boxes: readonly ShadowBox[]): void {
  if (boxes.length === 0) refuse('there is nothing to fit');
  boxes.forEach((box, index) => {
    if (!finiteTriple(box.min) || !finiteTriple(box.max)) refuse(`box ${String(index)} has a coordinate that is not a finite number`);
    if (box.min.some((value, axis) => value > box.max[axis]!)) refuse(`box ${String(index)} has a minimum greater than its maximum`);
  });
}

/**
 * The frustum for `boxes` lit along `direction` (towards the sun, any length)
 * on a square map of `mapSize` texels.
 *
 * Throws `LightingError` `bad-options` for no boxes, a box with a non-finite
 * coordinate or a minimum above its maximum, a zero, non-finite or
 * non-upward direction, or a map size that is not a positive integer.
 */
export function fitShadowFrustum(boxes: readonly ShadowBox[], direction: Triple, mapSize: number): ShadowFit {
  judgeBoxes(boxes);
  const d = judgeDirection(direction);
  if (!Number.isInteger(mapSize) || mapSize <= 0) refuse(`the map size must be a positive integer, got ${String(mapSize)}`);
  const tuning = LIGHTING_STANDARD.apartment.sun.fit;

  const up: Triple = d[1] > ZENITH_COS ? [0, 0, -1] : [0, 1, 0];
  const x = normalise(cross(up, d));
  const y = cross(d, x);

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    for (const cx of [box.min[0], box.max[0]]) {
      for (const cy of [box.min[1], box.max[1]]) {
        for (const cz of [box.min[2], box.max[2]]) {
          const corner: Triple = [cx, cy, cz];
          const px = dot(corner, x);
          const py = dot(corner, y);
          const pz = dot(corner, d);
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
          minZ = Math.min(minZ, pz);
          maxZ = Math.max(maxZ, pz);
        }
      }
    }
  }

  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const halfWidth = (maxX - minX) / 2 + tuning.lateralPadding;
  const halfHeight = (maxY - minY) / 2 + tuning.lateralPadding;
  // The light stands past the box nearest the sun by the depth padding plus
  // the near plane; the far plane is past the box farthest from it by the
  // same padding.
  const near = tuning.minNear;
  const lightAlong = maxZ + tuning.depthPadding + near;
  const far = lightAlong - minZ + tuning.depthPadding;
  const at = (along: number): Triple => [
    centreX * x[0] + centreY * y[0] + along * d[0],
    centreX * x[1] + centreY * y[1] + along * d[1],
    centreX * x[2] + centreY * y[2] + along * d[2],
  ];
  const texel = Math.max(2 * halfWidth, 2 * halfHeight) / mapSize;
  return {
    position: at(lightAlong),
    target: at(minZ),
    up,
    left: -halfWidth,
    right: halfWidth,
    top: halfHeight,
    bottom: -halfHeight,
    near,
    far,
    bias: -tuning.depthOffset / (far - near),
    normalBias: Math.min(tuning.normalBiasMax, Math.max(tuning.normalBiasMin, tuning.normalBiasTexels * texel)),
    texel,
  };
}
