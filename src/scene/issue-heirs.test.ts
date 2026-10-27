import { describe, expect, test } from 'bun:test';
import { heirsOf, inheritedKeys, issueKey } from './issue-heirs.js';

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
