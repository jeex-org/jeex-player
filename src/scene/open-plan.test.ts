/**
 * An open-plan edit on a furnished flat as a plan recogniser outlines it
 * (`tests/fixtures/open-plan/`): removing the wall between the kitchen and
 * the living room, where the dining room is already a zone of the living room.
 */

import { describe, expect, test } from 'bun:test';
import FIXTURE from '../../tests/fixtures/open-plan/open-plan.json' with { type: 'json' };
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { lintLayout, type LayoutCatalogue, type LayoutFacts } from '../layout/layout-lint.js';
import { SceneModel, isApplyOk } from './scene-model.js';
import type { SceneData, SceneOp } from './types.js';

const facts = FIXTURE.facts as unknown as Record<string, Omit<LayoutFacts, 'layout'>>;
const catalogue: LayoutCatalogue = (placement) => {
  const fact = facts[placement.id];
  return fact ? { layout: undefined, ...fact } : null;
};
const scene = FIXTURE.scene as unknown as SceneData;
const roomNamed = (name: string) => scene.rooms.find((room) => room.name === name)!;

describe('opening the kitchen onto the living room', () => {
  test('the kitchen stays a zone of the living room, beside the dining zone, and strict-new takes the edit', () => {
    const model = SceneModel.load(structuredClone(scene), CATALOGUE_REGISTRIES, undefined, {
      lint: (candidate, plan) => lintLayout(candidate, plan, catalogue),
    });
    const kitchen = roomNamed('Room 4');
    const living = roomNamed('Room 2');
    const outline = model.plan.rooms.find((room) => room.roomId === kitchen.id)!.polygon;

    const result = model.apply({ baseRev: 0, ops: FIXTURE.ops as SceneOp[], lint: 'strict-new' });

    if (!isApplyOk(result)) throw new Error(`expected a commit, got ${result.error}: ${result.message}`);
    expect(result.roomMerges).toEqual([{ from: kitchen.id, to: living.id, summary: 'Room 4 kept as a zone of Room 2', kept: 'zone' }]);
    const zones = model.scene.rooms.filter((room) => room.polygon !== undefined).map((room) => [room.name, room.purpose]);
    expect(zones).toEqual([
      ['Room 4', 'kitchen'],
      ['Room 9', 'dining'],
    ]);
    expect(model.scene.rooms.find((room) => room.id === kitchen.id)!.polygon).toEqual(outline);
    expect(model.plan.caveats).toEqual([]);
  });
});
