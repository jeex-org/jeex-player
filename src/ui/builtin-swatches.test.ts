/**
 * Swatches of the bundled room finishes: a bound finish shows its shipped
 * albedo (natural scan) or a flat chip, never a generated picture (no
 * bundled finish is kept any more); a project option under a bundled id is listed
 * once. The two canvas swatch painters are spied on, so "never generated" is
 * observed directly, without a DOM.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as finishes from '../materials/finishes.js';
import { finishCore } from './selection-options.js';
import { interiorPanelRequest } from './panel-requests.js';
import { createMessages } from './messages.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { BUILTIN_FINISHES } from '../materials/builtin-library.js';
import { builtinFolder, builtinSwatchUrl } from '../materials/builtin-folder.js';
import { NATURAL_SCAN } from '../fixtures/library-materials.js';

const generated: string[] = [];
const spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  generated.length = 0;
  spies.push(
    spyOn(finishes, 'finishSwatchDataURL').mockImplementation((finish) => {
      generated.push(finish.id);
      return 'data:image/png;base64,GENERATED';
    }),
    spyOn(finishes, 'finishPairSwatchDataURL').mockImplementation((first, second) => {
      generated.push(`${first.id}+${second.id}`);
      return 'data:image/png;base64,GENERATED';
    }),
  );
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

const EN = createMessages('en');
const ROOM = L_SHAPE.room.a;

describe('bundled finish swatches', () => {
  test('a bound natural scan shows its shipped 256 albedo and is not generated', () => {
    const core = finishCore(lShapePlan, { surface: 'floor', roomId: ROOM }, EN)!;
    const oak = core.options.find((option) => option.id === FINISH.oak)!;
    const binding = BUILTIN_FINISHES.get(FINISH.oak)!;
    expect(oak.image).toBe(`${builtinFolder()}tex/${binding.material.versionId}/albedo.256.webp`);
    expect(oak.image).toBe(builtinSwatchUrl(binding));
    expect(oak.thumbnail).toBeNull();
    expect(oak.background).toBe(finishes.findFinish(FINISH.oak)!.base);
    expect(generated).not.toContain(FINISH.oak);
  });

  test('a bound tintable wall is a flat chip in its colour, not generated', () => {
    const core = finishCore(lShapePlan, { surface: 'wall', roomId: ROOM }, EN)!;
    const sand = core.options.find((option) => option.id === FINISH.sand)!;
    expect(sand.image).toBeUndefined();
    expect(sand.thumbnail).toBeNull();
    expect(sand.background).toBe(finishes.findFinish(FINISH.sand)!.base);
    expect(generated).not.toContain(FINISH.sand);
  });

  test('no bundled finish is kept, so no bundled swatch is generated', () => {
    const walls = finishCore(lShapePlan, { surface: 'wall', roomId: ROOM }, EN)!;
    const floors = finishCore(lShapePlan, { surface: 'floor', roomId: ROOM }, EN)!;
    for (const option of [...walls.options, ...floors.options]) expect(option.thumbnail).toBeNull();
    expect(generated).toEqual([]);
  });

  test('the order and the names of the bank stay as they were', () => {
    const core = finishCore(lShapePlan, { surface: 'floor', roomId: ROOM }, EN)!;
    expect(core.options.map((option) => option.id)).toEqual(finishes.FLOOR_FINISHES.map((finish) => finish.id));
    expect(core.options.map((option) => option.label)).toEqual(finishes.FLOOR_FINISHES.map((finish) => finish.name));
  });

  test('the default-ceiling id is never offered', () => {
    for (const surface of ['floor', 'wall'] as const) {
      const core = finishCore(lShapePlan, { surface, roomId: ROOM }, EN)!;
      expect(core.options.some((option) => option.id === FINISH.plaster_white)).toBe(false);
    }
  });

  test('a project library material under a bundled id is listed once, as the project’s', () => {
    const own = { ...NATURAL_SCAN, id: FINISH.oak, name: 'Project oak' };
    const core = finishCore(lShapePlan, { surface: 'floor', roomId: ROOM }, EN, { catalogue: () => null, materials: [own] })!;
    const oaks = core.options.filter((option) => option.id === FINISH.oak);
    expect(oaks).toHaveLength(1);
    expect(oaks[0]!.label).toBe('Project oak');
  });
});

test('a project material under a bundled id that does not dress this surface leaves the bundled option in place', () => {
  const own = { ...NATURAL_SCAN, id: FINISH.oak, name: 'Project oak', apply: ['wall' as const] };
  const core = finishCore(lShapePlan, { surface: 'floor', roomId: ROOM }, EN, { catalogue: () => null, materials: [own] })!;
  expect(core.options.filter((option) => option.id === FINISH.oak).map((option) => option.label)).toEqual(['Natural oak']);
});

describe('interior preset chips', () => {
  const ANCHOR = { x: 0, y: 0 };
  const request = (swatch: [string, string]) =>
    interiorPanelRequest({
      messages: EN,
      presets: [{ id: 'p', name: 'P', swatch, ops: [] }],
      activeId: null,
      anchor: ANCHOR,
      onPick: () => undefined,
    });

  test('a preset on bound finishes is a flat two-colour chip, not generated', () => {
    const item = request([FINISH.oak, FINISH.sand]).items[0]!;
    expect(item.thumbnail).toBeNull();
    expect(item.background).toContain(finishes.findFinish(FINISH.oak)!.base);
    expect(generated).toEqual([]);
  });

  test('a preset on two retired finishes shows the flat colours of their targets', () => {
    const item = request([FINISH.ash, FINISH.wallpaper_cream]).items[0]!;
    expect(item.thumbnail).toBeNull();
    expect(item.background).toContain(finishes.findFinish(FINISH.oak)!.base);
    expect(item.background).toContain(finishes.findFinish(FINISH.white)!.base);
    expect(generated).toEqual([]);
  });
});
