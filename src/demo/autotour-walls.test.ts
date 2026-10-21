/**
 * The demo tour as it PLAYS, held against the walls of the plan.
 *
 * The authored waypoints are not what the camera rides: the player fillets
 * every corner and eases each gaze key into the next (`camera/tour-player.ts`).
 * So this file samples the player itself on its own playback clock
 * (`seekTime`, the clock a recorded clip steps through) every 0.05 s and
 * judges every sample against the solved plan's wall slabs, the scene's own
 * openings and the door leaves at rest, never against the navigation the
 * route is supposed to obey.
 *
 * Three rules, each one a defect seen in a recording of the tour:
 * - the camera crosses a wall only through a door, clear of both jambs;
 * - it keeps `WALL_CLEARANCE_M` from every wall face and open door leaf;
 * - the frame is never bare wall at arm's length: across the width of the
 *   view, less than `BARE_WALL_SHARE` of the sight lines meet a wall or a
 *   leaf within `BARE_WALL_M`, on a landscape (16:9) and a portrait (9:16)
 *   frame, each at the field of view the camera uses there.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { openingFrameWidth } from '../assets/opening-frame.js';
import { fieldOfViewFor } from '../camera/camera-tuning.js';
import { TourPlayer } from '../camera/tour-player.js';
import { polylineSlabs } from '../layout/layout-geometry.js';
import { wallCrossings } from '../navigation/navigation.js';
import { LEAF_REST_ANGLE_RAD, doorLeafQuad, doorSwings } from '../plan/door-swing.js';
import { cross, distanceToPolygon, pointInPolygon, polylineSlice, sub } from '../plan/plan-geometry.js';
import { solvePlan, type WallCentreline } from '../plan/plan-solver.js';
import type { Opening, Vec2 } from '../scene/types.js';
import { apartmentScene } from './scene-data.js';

/** Seconds between two samples of the played tour. */
const STEP_S = 0.05;
/** A door crossing keeps this far from either jamb, metres (the checkpoint route's rule too). */
const JAMB_MARGIN_M = 0.15;
/**
 * Closest the eye may come to a wall face or a door leaf, metres. The near
 * plane's corner reaches about 0.14 m from the eye at eye level on a 16:9
 * view (the 0.1 m near plane of `camera-tuning.ts` at its eye-level field of
 * view, `fieldOfViewFor`); twice that keeps a wall out of the clipping range whichever way
 * the view turns, and it stays above the walk's 0.2 m room margin. A 0.8 m
 * door passed at its centre leaves 0.4 m to either jamb, so the rule holds in
 * the doorways too.
 */
const WALL_CLEARANCE_M = 0.3;
/** The frames the bare-wall rule looks through: width over height. */
const ASPECTS = [16 / 9, 9 / 16] as const;
/** Eye height of the tour, metres: every waypoint of the demo route stands at it. */
const EYE_M = 1.6;
/** Half the horizontal field of view of a frame of `aspect` at eye level, radians. */
function halfViewOf(aspect: number): number {
  const vertical = (fieldOfViewFor(aspect, EYE_M) * Math.PI) / 180;
  return Math.atan(Math.tan(vertical / 2) * aspect);
}
/** Sight lines spread evenly across the width of the frame. */
const SIGHT_LINES = 21;
/**
 * A wall this close fills a landscape frame's height at the eye-level field
 * of view (53°: 2 · 1.2 · tan 26.5° ≈ 1.2 m of wall from edge to edge), metres.
 */
const BARE_WALL_M = 1.2;
/** The share of the frame's width that may be such a wall. */
const BARE_WALL_SHARE = 0.8;

const scene = apartmentScene;
const plan = solvePlan(scene);

type Sample = { t: number; eye: THREE.Vector3; look: THREE.Vector3 };

/** The played tour, every `STEP_S` of its playback clock from start to end. */
function playedTour(): Sample[] {
  let pose = { eye: new THREE.Vector3(), look: new THREE.Vector3() };
  const player = new TourPlayer(scene, (eye, look) => (pose = { eye: eye.clone(), look: look.clone() }), {
    onState: () => undefined,
    onProgress: () => undefined,
  });
  const samples: Sample[] = [];
  const count = Math.floor(player.getDuration() / STEP_S);
  for (let index = 0; index <= count; index += 1) {
    player.seekTime(index * STEP_S);
    samples.push({ t: index * STEP_S, ...pose });
  }
  return samples;
}

function openingsOf(line: WallCentreline): readonly Opening[] {
  return scene.walls.find((wall) => wall.id === line.wallId)?.openings ?? [];
}

/** The wall slabs left once the given openings are cut out of every centreline. */
function slabsWithout(cut: (opening: Opening) => boolean): Vec2[][] {
  return plan.centrelines.flatMap((line) => {
    const gaps = openingsOf(line)
      .filter((opening) => cut(opening))
      .map((opening) => [opening.center - opening.width / 2, opening.center + opening.width / 2] as const)
      .sort((a, b) => a[0] - b[0]);
    const runs: Array<[number, number]> = [];
    let cursor = 0;
    for (const [t0, t1] of gaps) {
      if (t0 - cursor > 1e-4) runs.push([cursor, t0]);
      cursor = Math.max(cursor, t1);
    }
    if (line.length - cursor > 1e-4) runs.push([cursor, line.length]);
    return runs.flatMap(([t0, t1]) => polylineSlabs(polylineSlice(line.polyline, line.length, t0, t1), line.thickness / 2));
  });
}

/** Distance from `point` to the nearest quad; negative inside one. */
function clearanceTo(quads: readonly Vec2[][], point: Vec2): number {
  return Math.min(...quads.map((quad) => (pointInPolygon(point, quad) ? -1 : 1) * distanceToPolygon(point, quad).distance));
}

/** Distance from `from` along the unit `direction` to the first quad edge, `Infinity` when none. */
function firstHit(quads: readonly Vec2[][], from: Vec2, direction: Vec2): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const quad of quads) {
    for (let index = 0; index < quad.length; index += 1) {
      const a = quad[index]!;
      const edge = sub(quad[(index + 1) % quad.length]!, a);
      const denominator = cross(direction, edge);
      if (Math.abs(denominator) < 1e-12) continue;
      const offset = sub(a, from);
      const along = cross(offset, edge) / denominator;
      const across = cross(offset, direction) / denominator;
      if (along > 1e-6 && across >= 0 && across <= 1) nearest = Math.min(nearest, along);
    }
  }
  return nearest;
}

/** The share of the frame's width whose sight line meets a quad within `BARE_WALL_M`. */
function bareWallShare(quads: readonly Vec2[][], { eye, look }: Sample, aspect: number): number {
  const half = halfViewOf(aspect);
  const yaw = Math.atan2(look.x - eye.x, look.z - eye.z);
  let near = 0;
  for (let line = 0; line < SIGHT_LINES; line += 1) {
    const angle = yaw + ((2 * line) / (SIGHT_LINES - 1) - 1) * half;
    if (firstHit(quads, eye, { x: Math.sin(angle), z: Math.cos(angle) }) < BARE_WALL_M) near += 1;
  }
  return near / SIGHT_LINES;
}

/** Consecutive offending samples merged into `from-to s` intervals, for a readable failure. */
function intervals(samples: readonly Sample[], bad: (sample: Sample) => boolean): string[] {
  const out: string[] = [];
  let start: number | null = null;
  samples.forEach((sample, index) => {
    const hit = bad(sample);
    if (hit && start === null) start = sample.t;
    if (!hit && start !== null) {
      out.push(`${start.toFixed(2)}-${samples[index - 1]!.t.toFixed(2)} s`);
      start = null;
    }
  });
  if (start !== null) out.push(`${(start as number).toFixed(2)}-${samples.at(-1)!.t.toFixed(2)} s`);
  return out;
}

describe('the demo tour as it plays', () => {
  const samples = playedTour();
  const leaves = doorSwings(scene, plan, openingFrameWidth).map((swing) => doorLeafQuad(swing, LEAF_REST_ANGLE_RAD));
  /** What the eye must keep clear of: solid wall (a window is glass, a door a gap) and the open leaves. */
  const solid = [...slabsWithout((opening) => opening.type !== 'window'), ...leaves];
  /** What the eye cannot see through: wall outside every opening, and the open leaves. */
  const opaque = [...slabsWithout(() => true), ...leaves];

  test('every wall crossing goes through a door, clear of both jambs', () => {
    const crossings: string[] = [];
    for (let index = 1; index < samples.length; index += 1) {
      const a = samples[index - 1]!.eye;
      const b = samples[index]!.eye;
      for (const { centreline, t } of wallCrossings(plan, a, b)) {
        const door = openingsOf(centreline).find(
          (opening) =>
            opening.type !== 'window' &&
            Math.abs(t - opening.center) < opening.width / 2 - JAMB_MARGIN_M &&
            b.y < (opening.head ?? Number.POSITIVE_INFINITY),
        );
        crossings.push(door ? 'door' : `${samples[index]!.t.toFixed(2)} s through wall ${centreline.wallId}`);
      }
    }
    // Every room but the WC is entered and left: a crossing count well above zero.
    expect(crossings.length).toBeGreaterThan(10);
    expect(crossings.filter((crossing) => crossing !== 'door')).toEqual([]);
  });

  test(`the eye keeps ${WALL_CLEARANCE_M} m from every wall face and door leaf`, () => {
    expect(intervals(samples, ({ eye }) => clearanceTo(solid, eye) < WALL_CLEARANCE_M)).toEqual([]);
  });

  test.each(ASPECTS.map((aspect) => [aspect.toFixed(2), aspect] as const))(
    `the frame of aspect %s is never mostly wall within ${BARE_WALL_M} m`,
    (_, aspect) => {
      expect(intervals(samples, (sample) => bareWallShare(opaque, sample, aspect) >= BARE_WALL_SHARE)).toEqual([]);
    },
  );

  test('the geometry the rules read is the real plan', () => {
    // Negative controls: the hall's centre is open space, the middle of the
    // bearing spine is inside a slab, and due north from the hall's centre
    // (no door at x = 10.0) the spine's face is 0.73 m away.
    expect(clearanceTo(solid, { x: 10.0, z: 4.45 })).toBeGreaterThan(0.5);
    expect(clearanceTo(solid, { x: 2.0, z: 3.6 })).toBeLessThan(0);
    expect(firstHit(opaque, { x: 10.0, z: 4.45 }, { x: 0, z: -1 })).toBeCloseTo(0.73, 2);
    // A view straight at the hall's south wall from its centre is all wall.
    const atWall = { t: 0, eye: new THREE.Vector3(10.0, 1.6, 4.45), look: new THREE.Vector3(10.0, 1.6, 6.0) };
    expect(ASPECTS.map((aspect) => bareWallShare(opaque, atWall, aspect))).toEqual([1, 1]);
  });
});
