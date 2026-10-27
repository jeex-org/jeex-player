import { describe, expect, test } from 'bun:test';
import { heirsOf, inheritedCirculation, inheritedKeys, inheritedPath, issueKey } from './issue-heirs.js';
import { circulationSentence } from '../layout/layout-issue.js';
import type { SceneOp } from './types.js';

/** Readable stand-ins: the module only compares strings, so the ids need not be UUIDs. */
const W = 'wall-w';
const P = 'half-p';
const Q = 'half-q';
const J = 'joined';
const SOFA = 'sofa';

describe('heirsOf', () => {
  test('a split hands a wall to both halves, a merge both walls to the joined one', () => {
    const heirs = heirsOf(
      [
        { op: 'split_wall', wallId: W, at: 1, nodeId: 'cut', ids: [P, Q] },
        { op: 'merge_wall', wallIds: ['a', 'b'], id: J },
      ],
      [],
    );
    expect([...heirs.get(W)!]).toEqual([P, Q]);
    expect([...heirs.get('a')!]).toEqual([J]);
    expect([...heirs.get('b')!]).toEqual([J]);
  });

  test('followed in op order: halves joined again land on the joined wall', () => {
    const heirs = heirsOf(
      [
        { op: 'split_wall', wallId: W, at: 1, nodeId: 'cut', ids: [P, Q] },
        { op: 'merge_wall', wallIds: [P, Q], id: J },
      ],
      [],
    );
    expect([...heirs.get(W)!]).toEqual([J]);
  });

  test('a room kept as a zone is not gone: its id keeps naming it', () => {
    const heirs = heirsOf([], [{ from: 'kitchen', to: 'living', summary: '', kept: 'zone' }]);
    expect(heirs.has('kitchen')).toBe(false);
  });

  test('a room merge, after every op, hands the absorbed room to the survivor', () => {
    const heirs = heirsOf([], [{ from: 'kitchen', to: 'living', summary: '' }]);
    expect([...heirs.get('kitchen')!]).toEqual(['living']);
  });
});

describe('inheritedKeys', () => {
  test('an issue is old under every id its entities became, and only under those', () => {
    const heirs = heirsOf([{ op: 'split_wall', wallId: W, at: 1, nodeId: 'cut', ids: [P, Q] }], []);
    const keys = inheritedKeys([{ rule: 'inside-a-wall', ids: [SOFA, W] }], heirs);
    expect([...keys].sort()).toEqual(
      [issueKey({ rule: 'inside-a-wall', ids: [SOFA, P] }), issueKey({ rule: 'inside-a-wall', ids: [SOFA, Q] })].sort(),
    );
  });

  test('an id the batch never touched keeps its own key', () => {
    const keys = inheritedKeys([{ rule: 'on-floor', ids: [SOFA] }], new Map());
    expect([...keys]).toEqual([issueKey({ rule: 'on-floor', ids: [SOFA] })]);
  });
});

describe('inheritedCirculation', () => {
  /** A kitchen merged into a terrace; door DOOR and passage PASSAGE are the kitchen's, door OTHER_DOOR the terrace's. */
  const KITCHEN = 'kitchen';
  const TERRACE = 'terrace';
  const DOOR = 'door-d';
  const PASSAGE = 'passage-p';
  const OTHER_DOOR = 'door-e';
  const merges = [{ from: KITCHEN, to: TERRACE, summary: '' }];
  const openings = new Set([DOOR, PASSAGE, OTHER_DOOR]);
  const blocked = (opening: string, room: string) => ({ rule: 'circulation' as const, ids: [opening, room] });
  const noPath = { rule: 'circulation' as const, ids: [DOOR, PASSAGE, TERRACE] };

  test('a: every opening the new error names was already blocked in a merged room, so it is inherited', () => {
    expect(inheritedCirculation(noPath, [blocked(DOOR, KITCHEN), blocked(PASSAGE, KITCHEN)], merges, openings)).toBe(true);
  });

  test('b: both openings were clear before: the blocked path is new', () => {
    expect(inheritedCirculation(noPath, [], merges, openings)).toBe(false);
  });

  test('c: one opening was blocked and the other clear: the error is new', () => {
    expect(inheritedCirculation(noPath, [blocked(DOOR, KITCHEN)], merges, openings)).toBe(false);
  });

  test('a blockage counts only where it was in one of the merged rooms', () => {
    expect(inheritedCirculation(noPath, [blocked(DOOR, 'elsewhere'), blocked(PASSAGE, KITCHEN)], merges, openings)).toBe(false);
  });

  test('only circulation errors in a merge survivor, naming at least one opening', () => {
    expect(inheritedCirculation({ rule: 'inside-a-wall', ids: [DOOR, TERRACE] }, [blocked(DOOR, KITCHEN)], merges, openings)).toBe(false);
    expect(inheritedCirculation({ rule: 'circulation', ids: [DOOR, KITCHEN] }, [blocked(DOOR, KITCHEN)], [], openings)).toBe(false);
    expect(inheritedCirculation({ rule: 'circulation', ids: [TERRACE] }, [], merges, openings)).toBe(false);
  });
});

describe('inheritedPath', () => {
  /** A dining room merged into a living room; the path runs from the terrace door T to door D, D the dining room's. */
  const DINING = 'dining';
  const LIVING = 'living';
  const T = 'door-t';
  const D = 'door-d';
  const merges = [{ from: DINING, to: LIVING, summary: '' }];
  /** D's approach point: where a path error to D is reported, and where its boxed-in error was. */
  const D_POINT = { x: 7.56, z: 5.71 };
  const noFloor = (opening: string, room: string, at: { x: number; z: number }) => ({
    rule: 'circulation' as const,
    ids: [opening, room],
    message: circulationSentence.noFloor(opening, '0.80', room),
    at,
  });
  const path = {
    rule: 'circulation' as const,
    ids: [T, D, LIVING],
    message: circulationSentence.noPath(T, D, '0.80', LIVING),
    at: D_POINT,
  };
  const wallsOnly: SceneOp[] = [{ op: 'remove_wall', wallId: 'wall' }];

  test('the target door was boxed in at that same point before, and the batch moved no furniture: inherited', () => {
    expect(inheritedPath(path, [noFloor(D, DINING, D_POINT)], merges, wallsOnly)).toBe(true);
  });

  test('4.2: both doors were clear before, the path between them blocked: new', () => {
    expect(inheritedPath(path, [], merges, wallsOnly)).toBe(false);
  });

  test('4.3: an endpoint with another circulation error before does not excuse a new blockage', () => {
    const mainZone = { rule: 'circulation' as const, ids: [DINING, D], message: circulationSentence.mainZone(DINING, D), at: D_POINT };
    expect(inheritedPath(path, [mainZone], merges, wallsOnly)).toBe(false);
  });

  test('the weak point: a batch that moves furniture can block the path anew, so it never inherits', () => {
    const moved: SceneOp[] = [...wallsOnly, { op: 'move_object', assetId: 'cabinet', position: { x: 6, y: 0, z: 6 } }];
    expect(inheritedPath(path, [noFloor(D, DINING, D_POINT)], merges, moved)).toBe(false);
  });

  test('boxed in elsewhere, or in a room the merge did not join, does not count', () => {
    expect(inheritedPath(path, [noFloor(D, DINING, { x: 7.6, z: 5.71 })], merges, wallsOnly)).toBe(false);
    expect(inheritedPath(path, [noFloor(D, 'study', D_POINT)], merges, wallsOnly)).toBe(false);
  });

  test('only a path error in a merge survivor', () => {
    expect(inheritedPath(noFloor(D, LIVING, D_POINT), [noFloor(D, DINING, D_POINT)], merges, wallsOnly)).toBe(false);
    expect(inheritedPath(path, [noFloor(D, DINING, D_POINT)], [], wallsOnly)).toBe(false);
  });
});
