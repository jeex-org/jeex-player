/**
 * The facts a drag judges an object of a baked project's own library by: the
 * resolver reads them off the archetype at the variant's size, the built body
 * carries them, and the drag's bank hands them to the rules, so the drag and
 * the host's lint
 * (`projectLayoutCatalogue`) judge the same facts.
 */

import { describe, expect, test } from 'bun:test';
import { DEMO } from '../demo/demo-ids.js';
import { apartmentScene } from '../demo/scene-data.js';
import { isResolved, resolveAsset } from '../assets/asset-resolver.js';
import { dragCatalogue, type BodyFacts } from './asset-move-catalogue.js';
import type { DemoAsset } from '../scene/types.js';

function placement(id: string): DemoAsset {
  const found = apartmentScene.assets.find((asset) => asset.id === id);
  if (!found) throw new Error(`no placement ${id}`);
  return found;
}

describe('surface facts reach the drag of a body the shipped bank does not know', () => {
  test('the resolver reads them off the archetype; a body tagged with them is judged by them', () => {
    const desk = placement(DEMO.asset.studyDesk);
    const resolved = resolveAsset(desk);
    if (!isResolved(resolved)) throw new Error('the desk resolves');
    expect(resolved.asset.surfaceFacts?.top?.y).toBeCloseTo(0.75, 6);
    expect(resolved.asset.surfaceFacts?.kneeSpace?.sides).toEqual(['front']);

    const body: BodyFacts = {
      archetype: 'baked-desk',
      anchor: 'floor',
      dims: [1.4, 0.75, 0.7],
      clearance: 0.7,
      yaw: 0,
      surfaces: { top: { y: 0.75 } },
    };
    // An id the shipped bank does not hold, as a baked library's placement would name.
    const baked: DemoAsset = {
      ...desk,
      id: '01a12fe6-0000-7000-8000-0000000000aa',
      asset: '01a12fe6-0000-7000-8000-0000000000bb:01a12fe6-0000-7000-8000-0000000000cc',
    };
    const facts = dragCatalogue(() => body)(baked);
    expect(facts?.surfaces).toEqual({ top: { y: 0.75 } });
    expect(dragCatalogue(() => ({ ...body, surfaces: undefined }))(baked)?.surfaces).toBeUndefined();
  });
});
