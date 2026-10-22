/**
 * The tour's pure path and gaze geometry, apart from the player
 * (`tour-player.ts`) that drives a clock over it: sampling a route polyline
 * (filleted for an authored route, as-is for a checkpoint route), reading a
 * position off it by arc length, and turning a gaze key into an AIM — yaw,
 * pitch and reach — and an aim into the point the camera looks at.
 */

import * as THREE from 'three';
import type { RouteGazeKey, TourLook } from '../scene/tour-route.js';
import type { Vec3 } from '../scene/types.js';
import { clamp } from '../shared/math.js';
import { ViewerLibError } from '../shared/errors.js';

/** Metres between samples of a filleted path; the approach also reads it. */
export const FILLET_SAMPLE = 0.04;

type Sample = { p: THREE.Vector3; d: number };

/** A polyline sampled at `FILLET_SAMPLE`, with the arc distance of every control point. */
export type SampledPath = { samples: Sample[]; length: number; controlDistances: number[] };

/** One gaze key's look, the route vocabulary (`RouteGazeKey`) in player terms. */
export type Look = { target: THREE.Vector3 } | { direction: TourLook } | { travel: true };
/** A look resolved at one point of the route: where it points and how far. */
export type Aim = { yaw: number; pitch: number; reach: number };

export function vec3(point: Vec3): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

/**
 * Samples a control polyline as straight legs joined by quadratic Bezier
 * fillets. Tangents are continuous with the legs on both sides, so the camera
 * glides through corners while staying within ~1 m of the authored route.
 *
 * The authored route and the approach fly-in ride this; a checkpoint route
 * is already its own smooth curve and rides `samplePolyline`.
 */
export function sampleFilletedPath(controls: THREE.Vector3[]): SampledPath {
  const head = controls[0];
  const tail = controls.at(-1);
  // Both callers (`build`, `buildApproach`) pass at least two controls; an
  // empty polyline has no path to sample and would divide by zero downstream.
  if (!head || !tail) throw new ViewerLibError('internal', 'sampleFilletedPath needs at least one control point');
  const samples: Sample[] = [{ p: head.clone(), d: 0 }];
  const controlDistances = Array.from<number>({ length: controls.length }).fill(0);
  let dist = 0;
  const push = (point: THREE.Vector3): void => {
    // `samples` is seeded above and only ever grows, so the last one exists.
    dist += samples.at(-1)!.p.distanceTo(point);
    samples.push({ p: point, d: dist });
  };
  // `i` runs 1..length-2, so all three neighbours are in range.
  for (let i = 1; i < controls.length - 1; i += 1) {
    const prev = controls[i - 1]!;
    const cur = controls[i]!;
    const next = controls[i + 1]!;
    const inUnit = cur.clone().sub(prev).normalize();
    const outUnit = next.clone().sub(cur).normalize();
    const k = Math.min(1.4, cur.distanceTo(prev) * 0.45, next.distanceTo(cur) * 0.45);
    const a = cur.clone().addScaledVector(inUnit, -k);
    const b = cur.clone().addScaledVector(outUnit, k);
    push(a);
    controlDistances[i] = dist;
    const per = Math.max(6, Math.ceil((k * 2) / FILLET_SAMPLE));
    for (let j = 1; j <= per; j += 1) {
      const u = j / per;
      const point = a
        .clone()
        .multiplyScalar((1 - u) * (1 - u))
        .addScaledVector(cur, 2 * u * (1 - u))
        .addScaledVector(b, u * u);
      push(point);
    }
  }
  controlDistances[controls.length - 1] = dist;
  push(tail.clone());
  return { samples, length: dist, controlDistances };
}

/**
 * Samples a polyline that already IS the curve — the checkpoint route
 * (`scene/tour-route.ts`) is a dense spline through the cameras — without
 * filleting it: a fillet would cut every camera by a few millimetres and the
 * tour must stand exactly where the author put each one.
 */
export function samplePolyline(controls: THREE.Vector3[]): SampledPath {
  const samples: Sample[] = [];
  const controlDistances: number[] = [];
  let dist = 0;
  controls.forEach((point, index) => {
    if (index > 0) dist += controls[index - 1]!.distanceTo(point);
    samples.push({ p: point.clone(), d: dist });
    controlDistances.push(dist);
  });
  return { samples, length: dist, controlDistances };
}

export function lookOf(key: RouteGazeKey): Look {
  if ('target' in key) return { target: vec3(key.target) };
  if ('direction' in key) return { direction: { yaw: key.direction.yaw, pitch: key.direction.pitch } };
  return { travel: true };
}

/** `to - from` wrapped into `[-PI, PI)`: the short way round. */
export function yawDelta(from: number, to: number): number {
  const turn = 2 * Math.PI;
  return ((((to - from + Math.PI) % turn) + turn) % turn) - Math.PI;
}

/** Position at `distance` metres along a sampled path, clamped to its ends. */
export function positionOnPath(path: SampledPath, distance: number): THREE.Vector3 {
  const table = path.samples;
  const d = clamp(distance, 0, path.length);
  let lo = 0;
  let hi = table.length - 1;
  // `sampleFilletedPath` never returns an empty table, and the search keeps
  // `0 <= lo < hi <= length - 1`, so every index below is in range.
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid]!.d <= d) lo = mid;
    else hi = mid;
  }
  const a = table[lo]!;
  const b = table[hi]!;
  return a.p.clone().lerp(b.p, (d - a.d) / (b.d - a.d || 1));
}

/**
 * The aim `progress` of the way from `from` to `to`: yaw along the SHORT arc
 * unless `turn` names the signed way round, pitch and reach blended. Blending
 * two world points instead would cut through the camera itself on a
 * turn-around — two looks opposite ways — and whip the view.
 */
export function turnAim(from: Aim, to: Aim, progress: number, turn = yawDelta(from.yaw, to.yaw)): Aim {
  return {
    yaw: from.yaw + turn * progress,
    pitch: THREE.MathUtils.lerp(from.pitch, to.pitch, progress),
    reach: THREE.MathUtils.lerp(from.reach, to.reach, progress),
  };
}

/**
 * The way round of a turn between two looks that move with the eye: the
 * signed yaw turn at `count + 1` even steps across the turn's window, taken
 * along the short arc at its first step and followed without wrapping from
 * there on. `gapAt(u)` is the raw yaw gap `to - from` a fraction `u` of the
 * way through the window. Taking the short arc afresh on every frame would
 * flip the turn to the other side the moment the gap passes 180° and snap the
 * view.
 */
export function turnTrack(count: number, gapAt: (u: number) => number): number[] {
  const turns: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    const gap = gapAt(index / count);
    const previous = turns.at(-1);
    turns.push(previous === undefined ? yawDelta(0, gap) : previous + yawDelta(previous, gap));
  }
  return turns;
}

/**
 * The signed turn a fraction `u` of the way through a `turnTrack`: the raw
 * `gap` there, on the side the track's nearest step took. An empty track
 * falls back to the short arc.
 */
export function turnOnTrack(turns: readonly number[], u: number, gap: number): number {
  const near = turns[Math.round(clamp(u, 0, 1) * (turns.length - 1))];
  return near === undefined ? yawDelta(0, gap) : near + yawDelta(near, gap);
}

/**
 * The gaze point of `aim` seen from `eye`. A downward look is shortened so the
 * point never sinks under the floor: the DIRECTION is the view, and a point
 * below the floor would make the tour stare at the floor.
 */
export function lookPoint(eye: THREE.Vector3, aim: Aim): THREE.Vector3 {
  const horizontal = Math.cos(aim.pitch);
  const direction = new THREE.Vector3(Math.sin(aim.yaw) * horizontal, Math.sin(aim.pitch), Math.cos(aim.yaw) * horizontal);
  let reach = Math.max(aim.reach, 1e-3);
  if (direction.y < 0 && eye.y > 0) reach = Math.max(1e-3, Math.min(reach, (eye.y * 0.999) / -direction.y));
  return eye.clone().addScaledVector(direction, reach);
}
