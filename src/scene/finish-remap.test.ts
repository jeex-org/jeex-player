import { describe, expect, test } from 'bun:test';
import { remapFaceFinishes } from './finish-remap.js';
import { faceKey } from './types.js';
import type { FaceFinish, FaceKey, FinishRef, TopologyRemap } from './types.js';
import { FINISH } from '../materials/finish-ids.js';

/**
 * What happens to the paint when the plan under it changes.
 *
 * Every case here is a decision that has to be made SOMEWHERE the day a wall
 * is split, and making it in one pure function is the whole point: the
 * alternative is each editing operation inventing its own answer and the
 * finishes drifting apart between them.
 */

/** Fixed ids for these tests, generated once offline. */
const ID = {
  living: '01a12ff4-17d5-735f-9b1c-f6103da12945',
  w1: '01a12ff4-17d6-7e21-8029-e6cf6e610582',
  w1a: '01a12ff4-17d7-7650-b00d-907dd617e43c',
  w1b: '01a12ff4-17d8-780c-bd6c-f8982406d8f4',
  w2: '01a12ff4-17d9-7ecb-9861-09bbb2663182',
  wMerged: '01a12ff4-17da-79de-8f5e-d036b6ea4474',
} as const;

const A = faceKey(ID.living, ID.w1, 'L');
const A1 = faceKey(ID.living, ID.w1a, 'L');
const A2 = faceKey(ID.living, ID.w1b, 'L');
const B = faceKey(ID.living, ID.w2, 'L');
const M = faceKey(ID.living, ID.wMerged, 'L');
/** The facade side of the split wall: painted on its own, never mixed with the room side. */
const AF = faceKey(null, ID.w1, 'R');
const AF1 = faceKey(null, ID.w1a, 'R');
const AF2 = faceKey(null, ID.w1b, 'R');

const OAK = FINISH.oak;
const WALNUT = FINISH.walnut;
const SAGE = FINISH.sage;

const painted = (face: FaceKey, finish: FinishRef): FaceFinish => ({ ...face, finish });

/** A remap with no `created` faces — the common case. */
const remapOf = (faces: TopologyRemap['faces']): TopologyRemap => ({ faces, created: [] });

describe('remapFaceFinishes', () => {
  test('a split replaces the ancestor in place with its heirs, in the order the remap lists them', () => {
    const out = remapFaceFinishes(
      [painted(B, WALNUT), painted(A, OAK), painted(AF, SAGE)],
      remapOf([{ from: A, to: [A1, A2], primary: A1, status: 'split' }]),
    );
    expect(out).toEqual([painted(B, WALNUT), painted(A1, OAK), painted(A2, OAK), painted(AF, SAGE)]);
  });

  test('the two sides of a split wall keep their own finishes', () => {
    const out = remapFaceFinishes(
      [painted(A, OAK), painted(AF, SAGE)],
      remapOf([
        { from: A, to: [A1, A2], primary: A1, status: 'split' },
        { from: AF, to: [AF1, AF2], primary: AF1, status: 'split' },
      ]),
    );
    expect(out).toEqual([painted(A1, OAK), painted(A2, OAK), painted(AF1, SAGE), painted(AF2, SAGE)]);
  });

  test('a merge keeps the primary ancestor’s finish and loses the other', () => {
    const out = remapFaceFinishes(
      [painted(A, OAK), painted(B, WALNUT)],
      remapOf([
        { from: A, to: [M], primary: A, status: 'merged' },
        { from: B, to: [M], primary: A, status: 'merged' },
      ]),
    );
    expect(out).toEqual([painted(M, OAK)]);
  });

  test('a merge whose primary ancestor was unpainted carries nothing', () => {
    // `primary` names the ANCESTOR that wins, not the survivor.
    const out = remapFaceFinishes(
      [painted(B, WALNUT)],
      remapOf([
        { from: A, to: [M], primary: A, status: 'merged' },
        { from: B, to: [M], primary: A, status: 'merged' },
      ]),
    );
    expect(out).toEqual([]);
  });

  test('a deleted face drops its finish', () => {
    const out = remapFaceFinishes([painted(A, OAK), painted(B, WALNUT)], remapOf([{ from: A, to: [], status: 'deleted' }]));
    expect(out).toEqual([painted(B, WALNUT)]);
  });

  test('an unchanged face keeps its finish in its place', () => {
    const out = remapFaceFinishes([painted(B, WALNUT), painted(A, OAK)], remapOf([{ from: A, to: [A], status: 'unchanged' }]));
    expect(out).toEqual([painted(B, WALNUT), painted(A, OAK)]);
  });

  test('faces the remap does not mention are carried over untouched, in order', () => {
    const out = remapFaceFinishes([painted(B, WALNUT), painted(AF, SAGE)], remapOf([{ from: A, to: [A1], primary: A1, status: 'split' }]));
    expect(out).toEqual([painted(B, WALNUT), painted(AF, SAGE)]);
  });

  test('an heir already painted in its own right takes the remap’s finish, once', () => {
    const out = remapFaceFinishes(
      [painted(A2, WALNUT), painted(A, OAK)],
      remapOf([{ from: A, to: [A1, A2], primary: A1, status: 'split' }]),
    );
    expect(out).toEqual([painted(A1, OAK), painted(A2, OAK)]);
  });

  test('an entry whose old face carried no finish writes nothing', () => {
    const out = remapFaceFinishes([], remapOf([{ from: A, to: [A1, A2], primary: A1, status: 'split' }]));
    expect(out).toEqual([]);
  });

  test('created faces get nothing — they have no ancestor to inherit from', () => {
    const out = remapFaceFinishes([painted(A, OAK)], { faces: [{ from: A, to: [A], status: 'unchanged' }], created: [A1, A2] });
    expect(out).toEqual([painted(A, OAK)]);
  });

  test('a facade entry stays a facade entry: no room key appears', () => {
    const [entry] = remapFaceFinishes([painted(AF, SAGE)], remapOf([{ from: AF, to: [AF1], primary: AF1, status: 'split' }]));
    expect(entry).toEqual({ wallId: ID.w1a, side: 'R', finish: SAGE });
    expect('room' in entry!).toBe(false);
  });

  test('never mutates what it was handed, and answers with fresh entries', () => {
    const input = [painted(A, OAK), painted(B, WALNUT)];
    const before = structuredClone(input);
    const out = remapFaceFinishes(input, remapOf([{ from: A, to: [A1, A2], primary: A1, status: 'split' }]));
    expect(input).toEqual(before);
    expect(out[2]).toEqual(input[1]);
    expect(out[2]).not.toBe(input[1]);
  });
});

describe('remapFaceFinishes carries a finish object whole', () => {
  /** A library material with both modifiers (the id is a finish UUID; which one does not matter to the remap). */
  const TINTED = { material: OAK, colour: '#d8cbb5', rotation: 90 } as const;

  test('a split hands both heirs an object deep-equal to the ancestor’s', () => {
    const out = remapFaceFinishes([painted(A, TINTED)], remapOf([{ from: A, to: [A1, A2], primary: A1, status: 'split' }]));
    expect(out).toEqual([painted(A1, TINTED), painted(A2, TINTED)]);
  });

  test('a merge keeps the primary ancestor’s object', () => {
    const out = remapFaceFinishes(
      [painted(A, TINTED), painted(B, WALNUT)],
      remapOf([
        { from: A, to: [M], primary: A, status: 'merged' },
        { from: B, to: [M], primary: A, status: 'merged' },
      ]),
    );
    expect(out).toEqual([painted(M, TINTED)]);
  });

  test('an unmentioned object is carried over as it was', () => {
    expect(remapFaceFinishes([painted(B, TINTED)], remapOf([]))).toEqual([painted(B, TINTED)]);
  });
});
