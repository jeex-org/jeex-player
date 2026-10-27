import { describe, expect, test } from 'bun:test';
import { heirsOf, inheritedCirculation, inheritedKeys, issueKey } from './issue-heirs.js';

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
