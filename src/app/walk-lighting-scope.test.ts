import { describe, expect, test } from 'bun:test';
import { mergeScopes, refreshScope, type ScopeLookups } from './walk-lighting-scope.js';
import type { TouchedEntity } from '../scene/ops/context.js';

const lookups: ScopeLookups = {
  assetRoom: (id) => (id === 'sofa' ? 'living' : null),
  openingRooms: (id) => (id === 'door' ? ['hall', 'bath'] : []),
};

const scope = (touched: TouchedEntity[]) => refreshScope(touched, lookups);

describe('refreshScope', () => {
  test("a furniture edit re-captures its room's probe only", () => {
    expect(scope([{ kind: 'asset', id: 'sofa' }])).toEqual({ all: false, grids: [], probes: ['living'], lamps: true });
  });

  test('an asset edit the updated model cannot place in a room (removed, or moved out of every room) still asks for the lamp check', () => {
    expect(scope([{ kind: 'asset', id: 'gone' }])).toEqual({ all: false, grids: [], probes: [], lamps: true });
  });

  test('edits that touch no asset ask for no lamp check', () => {
    expect(scope([{ kind: 'floor', room: 'bath' }])?.lamps).toBeUndefined();
  });

  test("a finish edit re-bakes its room's grid (and with it the probe)", () => {
    expect(scope([{ kind: 'floor', room: 'bath' }])).toEqual({ all: false, grids: ['bath'], probes: [] });
    expect(scope([{ kind: 'face', face: { room: 'hall', wallId: 'w', side: 'L' } }])).toEqual({ all: false, grids: ['hall'], probes: [] });
  });

  test('an opening edit re-bakes both rooms it joins', () => {
    expect(scope([{ kind: 'opening', id: 'door' }])).toEqual({ all: false, grids: ['hall', 'bath'], probes: [] });
  });

  test('a plan change, a sun change or a facade change re-bakes everything; camera edits nothing', () => {
    expect(scope([{ kind: 'shell' }])?.all).toBe(true);
    expect(scope([{ kind: 'site' }])?.all).toBe(true);
    expect(scope([{ kind: 'facade' }])?.all).toBe(true);
    expect(scope([{ kind: 'tourCheckpoints' }, { kind: 'navigation' }])).toBeNull();
  });
});

describe('mergeScopes', () => {
  test('unions rooms and keeps a full re-bake', () => {
    const a = { all: false, grids: ['a'], probes: ['b'] };
    const b = { all: false, grids: ['a', 'c'], probes: [] };
    expect(mergeScopes(a, b)).toEqual({ all: false, grids: ['a', 'c'], probes: ['b'] });
    expect(mergeScopes(null, b)).toEqual(b);
    expect(mergeScopes(a, { all: true, grids: [], probes: [] }).all).toBe(true);
    expect(mergeScopes(a, { all: false, grids: [], probes: [], lamps: true }).lamps).toBe(true);
    expect(mergeScopes({ all: false, grids: [], probes: [], lamps: true }, b).lamps).toBe(true);
  });
});
