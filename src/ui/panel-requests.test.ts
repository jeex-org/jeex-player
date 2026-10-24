/**
 * Panel requests are pure functions of scene data plus callbacks, so the whole
 * wording, dataset and scope contract that `browser-check.ts` asserts on can be
 * pinned here without a DOM.
 *
 * The load-bearing one: a preview is an image, never text.
 */

import { builtinFolder } from '../materials/builtin-folder.js';
import { describe, expect, test } from 'bun:test';
import { finishPanelRequest, furniturePanelRequest, interiorPanelRequest, openingPanelRequest } from './panel-requests.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { faceKey, type SceneData } from '../scene/types.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { DEMO } from '../demo/demo-ids.js';
import { ARCHETYPE, OPENING_VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { variantsForOpening } from '../assets/opening-variants.js';
import { variantsForPlacement } from '../assets/asset-variants.js';
import type { DemoAsset } from '../scene/types.js';
import type { InteriorPreset } from '../scene/scene-ops.js';
import type { OpeningListEntry } from '../geometry/opening-builder.js';
import { createMessages } from './messages.js';

const ANCHOR = { x: 120, y: 80 };
/** Every request builder now takes the instance catalogue instead of a global. */
const EN = createMessages('en');

/** The ids this file invents: fixed UUID v7 literals. */
const KITCHEN = '01a12fff-5bb1-77d9-8acc-38f96ca4d104';
const LIVING_SOFA = '01a12fff-5bb2-7213-8fc6-c61ef12804f1';
const W1 = L_SHAPE.wall.wSA;

/**
 * The document the wording is read from: one named room with an oak floor and
 * sand walls. `ownerName` and `current` come off the scene, not from
 * arguments, through the one builder `describeSelection` shares
 * (`selection-options.ts`).
 */
const SCENE: SceneData = {
  ...lShapePlan,
  rooms: [{ id: KITCHEN, name: 'Kitchen', anchor: { x: 1, z: 1 }, floorMaterial: FINISH.oak }],
  finishes: { rooms: { [KITCHEN]: { walls: FINISH.sand } } },
};

function finishPanel(target: Parameters<typeof finishPanelRequest>[0]['target']) {
  const request = finishPanelRequest({
    messages: EN,
    scene: SCENE,
    target,
    anchor: ANCHOR,
    onPick: () => undefined,
    onApplyToAll: () => undefined,
  });
  if (!request) throw new Error(`no panel for ${JSON.stringify(target)}`);
  return request;
}

const SOFA: DemoAsset = {
  id: LIVING_SOFA,
  type: 'sofa',
  asset: ARCHETYPE.sofa_3s,
  position: { x: 0, y: 0, z: 0 },
};

const OPENING: OpeningListEntry = {
  id: L_SHAPE.opening.doorEntry,
  type: 'door',
  wallId: W1,
  entrance: true,
  variant: OPENING_VARIANT.entry_door_walnut_panelled,
  center: { x: 1, y: 1, z: 0 },
  pick: { x: 1, y: 1, z: 0 },
};

describe('finish panel', () => {
  test('a target the paint vocabulary cannot address opens no panel at all', () => {
    const request = finishPanelRequest({
      messages: EN,
      scene: SCENE,
      target: { surface: 'floor' },
      anchor: ANCHOR,
      onPick: () => undefined,
      onApplyToAll: () => undefined,
    });
    expect(request).toBeNull();
  });

  test('a floor target offers floor finishes, no scope row, and the floors footer', () => {
    const request = finishPanel({ surface: 'floor', roomId: KITCHEN });
    expect(request.kind).toBe('finish');
    expect(request.scope).toBeUndefined();
    expect(request.panelData).toEqual({ surface: 'floor', owner: KITCHEN });
    expect(request.items.map((item) => item.dataset?.['finish'])).toContain(FINISH.oak);
    expect(request.items.map((item) => item.dataset?.['finish'])).not.toContain(FINISH.sand);
    expect(request.items.filter((item) => item.active).map((item) => item.id)).toEqual([FINISH.oak]);
    expect(request.footer?.label).toBe('Apply to all floors');
  });

  test('a room wall target offers wall finishes and marks the current one active', () => {
    const request = finishPanel({ surface: 'wall', roomId: KITCHEN });
    expect(request.items.map((item) => item.dataset?.['finish'])).toContain(FINISH.sand);
    expect(request.items.filter((item) => item.active).map((item) => item.id)).toEqual([FINISH.sand]);
    expect(request.scope).toBeUndefined();
    expect(request.panelData).toEqual({ surface: 'wall', owner: KITCHEN });
  });

  test('a face target adds the "only this wall" scope and the face dataset', () => {
    const request = finishPanel({ surface: 'wall', roomId: KITCHEN, face: faceKey(KITCHEN, W1, 'L') });
    expect(request.scope).toEqual({ label: 'Only this wall (corner to corner)', checked: false });
    expect(request.panelData).toEqual({ surface: 'wall', owner: KITCHEN, wall: W1, side: 'L' });
  });

  test('a facade face is owned by "facade" and gets its own footer wording', () => {
    const request = finishPanel({ surface: 'wall', face: faceKey(null, W1, 'R') });
    expect(request.panelData).toEqual({ surface: 'wall', owner: 'facade', wall: W1, side: 'R' });
    expect(request.footer?.label).toBe('Apply to all room walls');
  });
});

describe('replace panels', () => {
  test('a furniture panel offers exactly the placement variants, dataset-tagged', () => {
    const request = furniturePanelRequest({
      messages: EN,
      placement: SOFA,
      renderPreview: () => null,
      onPick: () => undefined,
      onStandard: () => undefined,
    });
    const offered = variantsForPlacement(SOFA).map((variant) => variant.id);
    expect(request.kind).toBe('furniture');
    expect(request.items.map((item) => item.id)).toEqual(offered);
    expect(request.items.every((item) => item.dataset?.['variant'] === item.id)).toBe(true);
    expect(request.panelData).toEqual({ asset: LIVING_SOFA });
    expect(request.anchor).toEqual({ x: 0, y: 0 });
  });

  test('an opening panel offers the entrance family and reports the opening dataset', () => {
    const request = openingPanelRequest({
      messages: EN,
      entry: OPENING,
      current: OPENING_VARIANT.entry_door_walnut_panelled,
      anchor: ANCHOR,
      onPick: () => undefined,
      onStandard: () => undefined,
    });
    expect(request.items.map((item) => item.id)).toEqual(variantsForOpening('door', { entrance: true }).map((variant) => variant.id));
    expect(request.panelData).toEqual({ opening: L_SHAPE.opening.doorEntry, openingType: 'door', entrance: 'true' });
    expect(request.items.filter((item) => item.active).map((item) => item.id)).toEqual([OPENING_VARIANT.entry_door_walnut_panelled]);
  });
});

describe('previews carry no text', () => {
  const requests = [
    finishPanel({ surface: 'floor', roomId: KITCHEN }),
    finishPanel({ surface: 'wall', roomId: KITCHEN }),
    furniturePanelRequest({
      messages: EN,
      placement: SOFA,
      renderPreview: () => null,
      onPick: () => undefined,
      onStandard: () => undefined,
    }),
    openingPanelRequest({
      messages: EN,
      entry: OPENING,
      current: null,
      anchor: ANCHOR,
      onPick: () => undefined,
      onStandard: () => undefined,
    }),
  ];

  test('every item has a separate label and an image-or-colour preview', () => {
    for (const request of requests) {
      expect(request.items.length).toBeGreaterThan(0);
      for (const item of request.items) {
        expect(typeof item.label).toBe('string');
        expect(item.label.length).toBeGreaterThan(0);
        // Without a `document` the generators return null, so the fallback chip
        // has to carry the colour; a bundled scan shows its shipped albedo.
        // Either way nothing renders text.
        expect(item.thumbnail === null || item.thumbnail.startsWith('data:image/') || item.thumbnail.startsWith(builtinFolder())).toBe(
          true,
        );
        expect(typeof item.background).toBe('string');
      }
    }
  });
});

describe('interior panel', () => {
  const PRESETS: InteriorPreset[] = [
    { id: DEMO.preset.oakSand, name: 'Oak and sand', swatch: [FINISH.oak, FINISH.sand], ops: [] },
    { id: DEMO.preset.sageGraphite, name: 'Sage and graphite', swatch: [FINISH.chevron, FINISH.sage], ops: [] },
  ];

  function panel(activeId: string | null = null) {
    return interiorPanelRequest({ messages: EN, presets: PRESETS, activeId, anchor: ANCHOR, onPick: () => undefined });
  }

  test('offers one item per preset, keyed by preset id', () => {
    const request = panel();
    expect(request.kind).toBe('interior');
    expect(request.items.map((item) => item.dataset['preset'])).toEqual([DEMO.preset.oakSand, DEMO.preset.sageGraphite]);
    expect(request.panelData).toEqual({ presets: '2' });
    expect(request.anchor).toBe(ANCHOR);
  });

  test('the label is the scene-authored name, and no item carries text in its preview', () => {
    for (const item of panel().items) {
      expect(item.label).toBe(PRESETS.find((preset) => preset.id === item.id)!.name);
      // Without a DOM there is no rendered swatch; the fallback is a pure
      // two-colour gradient, and neither form can contain a glyph.
      expect(item.thumbnail).toBeNull();
      expect(item.background).toMatch(/^linear-gradient\(135deg, #[0-9a-f]{6} 50%, #[0-9a-f]{6} 50%\)$/);
    }
  });

  test('exactly the applied preset is marked active', () => {
    expect(panel(DEMO.preset.sageGraphite).items.map((item) => item.active)).toEqual([false, true]);
    expect(panel(null).items.every((item) => !item.active)).toBe(true);
  });

  test('it offers no footer and no scope row: a preset is the whole flat', () => {
    expect(panel().footer).toBeUndefined();
    expect(panel().scope).toBeUndefined();
  });
});
