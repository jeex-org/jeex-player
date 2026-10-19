/**
 * The property under test: `solvePlan` is a function of the PLAN, not of the
 * order the plan was authored in.
 *
 * Shuffling `nodes[]`, `walls[]` and `rooms[]` is the cheapest possible model
 * of what an importer does — a DXF, an IFC or a hand-edited JSON emits the same
 * building in whatever order its own iteration produced — and every downstream
 * contract that keys on the solver's output (a face key, a golden export, a
 * stable exchange GUID) is worthless if that order can leak through.
 */

import { describe, expect, test } from 'bun:test';
import { apartmentScene } from '../demo/scene-data.js';
import { bayPlan, lShapePlan } from '../fixtures/plan-l-shape.js';
import { solvePlan } from './plan-solver.js';
import type { SolvedPlan } from './plan-solver.js';
import type { SceneData } from '../scene/types.js';

/** Mulberry32: 32 bits of state, no dependency, identical on every runtime. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy, driven by `random`; the input is left alone. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

type PlanInput = Pick<SceneData, 'nodes' | 'walls' | 'rooms' | 'ceilingHeight'>;

/** The same document with its three plan arrays re-ordered by `seed`. */
function reorder(scene: PlanInput, seed: number): PlanInput {
  const random = mulberry32(seed);
  return {
    ceilingHeight: scene.ceilingHeight,
    nodes: shuffled(scene.nodes, random),
    walls: shuffled(scene.walls, random),
    rooms: shuffled(scene.rooms, random),
  };
}

const byKey = (a: readonly [string, unknown], b: readonly [string, unknown]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** The faces as `[owner/wall/side, face]` pairs in that order — the map's insertion order is not the subject. */
const sortedFaces = (plan: SolvedPlan): Array<readonly [string, unknown]> =>
  [...plan.faces.entries()].map(([key, face]) => [`${key.room ?? 'facade'}/${key.wallId}/${key.side}`, face] as const).sort(byKey);

/** Every wall face, in key order. */
const facesByKey = (plan: SolvedPlan): string => JSON.stringify(sortedFaces(plan));

/** Every centreline by `wallId`; the array itself keeps the document's wall order by design. */
const centrelinesByWall = (plan: SolvedPlan): string =>
  JSON.stringify([...plan.centrelines].map((c) => [c.wallId, c] as const).sort(byKey));

const FIXTURES: ReadonlyArray<readonly [string, PlanInput]> = [
  ['lShapePlan', lShapePlan],
  ['bayPlan', bayPlan],
  ['apartmentScene', apartmentScene],
];

const SEEDS = [1, 20260910, 0x5f3759df] as const;

describe('solvePlan is invariant to authoring order', () => {
  for (const [name, scene] of FIXTURES) {
    const base = solvePlan(scene);

    for (const seed of SEEDS) {
      const other = solvePlan(reorder(scene, seed));

      test(`${name}: every wall face is identical (seed ${seed})`, () => {
        expect(other.faces.size).toBe(base.faces.size);
        expect(facesByKey(other)).toBe(facesByKey(base));
      });

      test(`${name}: the rooms come back in the same order (seed ${seed})`, () => {
        expect(other.rooms.map((r) => r.roomId)).toEqual(base.rooms.map((r) => r.roomId));
      });

      test(`${name}: each room polygon starts at the same vertex (seed ${seed})`, () => {
        // Deliberately NOT canonicalised: the SOLVER has to pick the start, so
        // a test that rotated both rings before comparing would pass on the
        // very bug this file exists to catch.
        for (let i = 0; i < base.rooms.length; i += 1) {
          expect(other.rooms[i]!.polygon).toEqual(base.rooms[i]!.polygon);
          expect(other.rooms[i]!.bbox).toEqual(base.rooms[i]!.bbox);
        }
      });

      test(`${name}: the facade loop is the same loop from the same start (seed ${seed})`, () => {
        expect(other.facade.map((f) => f.key)).toEqual(base.facade.map((f) => f.key));
      });

      test(`${name}: every centreline is identical (seed ${seed})`, () => {
        expect(centrelinesByWall(other)).toBe(centrelinesByWall(base));
      });

      test(`${name}: the plan bounds are identical (seed ${seed})`, () => {
        expect(other.bounds).toEqual(base.bounds);
      });
    }

    test(`${name}: the whole solved plan serialises byte for byte (seed set)`, () => {
      const canonical = (plan: SolvedPlan): string =>
        JSON.stringify({
          rooms: plan.rooms,
          facade: plan.facade,
          faces: sortedFaces(plan),
          centrelines: [...plan.centrelines].map((c) => [c.wallId, c] as const).sort(byKey),
          bounds: plan.bounds,
        });
      for (const seed of SEEDS) {
        expect(canonical(solvePlan(reorder(scene, seed)))).toBe(canonical(base));
      }
    });
  }

  test('the shuffle really does re-order every fixture', () => {
    // A shuffle that returned its input would make all of the above vacuous.
    for (const [, scene] of FIXTURES) {
      const moved = SEEDS.some((seed) => {
        const other = reorder(scene, seed);
        return (
          other.walls.map((w) => w.id).join() !== scene.walls.map((w) => w.id).join() &&
          other.nodes.map((n) => n.id).join() !== scene.nodes.map((n) => n.id).join()
        );
      });
      expect(moved).toBe(true);
    }
  });
});
