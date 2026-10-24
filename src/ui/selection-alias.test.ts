/**
 * A surface that wears a retired bundled finish (an alias): the picker shows
 * the target as current and never offers the alias; the scope actions and the
 * built-in footer spread the STORED alias until a swatch is picked; a picked
 * swatch writes the picked id. A project material under the alias id is a
 * real option and stays current.
 */

import { describe, expect, test } from 'bun:test';
import { describeSelection, finishCore } from './selection-options.js';
import { finishPanelRequest } from './panel-requests.js';
import { createMessages } from './messages.js';
import type { VariantBank } from '../assets/asset-variants.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import { FINISH } from '../materials/finish-ids.js';
import { PAINT } from '../fixtures/library-materials.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import type { SceneData } from '../scene/types.js';

const EN = createMessages('en');
const ROOM_A = L_SHAPE.room.a;
const RETIRED: readonly string[] = [FINISH.wallpaper_cream, FINISH.wallpaper_sage, FINISH.ash];

/** The L-shape with room A's walls on Cream stripes. */
const STRIPED: SceneData = { ...lShapePlan, finishes: { rooms: { [ROOM_A]: { walls: FINISH.wallpaper_cream } } } };

const materialOf = (op: unknown): unknown => (op as { material?: unknown }).material;

describe('a wall on a retired finish', () => {
  test('shows the target as current, offers no retired id, and scopes the stored id', () => {
    const core = finishCore(STRIPED, { surface: 'wall', roomId: ROOM_A }, EN)!;
    expect(core.current).toBe(FINISH.white);
    expect(core.options.some((option) => RETIRED.includes(option.id))).toBe(false);
    expect(materialOf(core.scope?.ops.one)).toBe(FINISH.wallpaper_cream);
    expect(materialOf(core.scope?.ops.all)).toBe(FINISH.wallpaper_cream);
  });

  test('a host is told the same', () => {
    const described = describeSelection(
      { kind: 'wall', roomId: ROOM_A },
      { scene: STRIPED, messages: EN, openings: [], renderPreview: () => null },
    )!;
    expect(described.current).toBe(FINISH.white);
    expect(described.options.some((option) => RETIRED.includes(option.id))).toBe(false);
    expect(materialOf(described.scope?.ops.all)).toBe(FINISH.wallpaper_cream);
  });

  test('a floor on a retired finish shows its target too', () => {
    const scene: SceneData = {
      ...lShapePlan,
      rooms: lShapePlan.rooms.map((room) => (room.id === ROOM_A ? { ...room, floorMaterial: FINISH.ash } : room)),
    };
    expect(finishCore(scene, { surface: 'floor', roomId: ROOM_A }, EN)?.current).toBe(FINISH.oak);
  });

  test('a project material under the retired id is offered and stays current', () => {
    const own: ProjectMaterial = { ...PAINT, id: FINISH.wallpaper_cream };
    const bank: VariantBank = { catalogue: undefined as never, materials: [own] };
    const core = finishCore(STRIPED, { surface: 'wall', roomId: ROOM_A }, EN, bank)!;
    expect(core.current).toBe(FINISH.wallpaper_cream);
    expect(core.options[0]?.id).toBe(FINISH.wallpaper_cream);
  });
});

describe('the built-in panel footer', () => {
  function panel() {
    const applied: (string | null)[] = [];
    const request = finishPanelRequest({
      messages: EN,
      scene: STRIPED,
      target: { surface: 'wall', roomId: ROOM_A },
      anchor: { x: 0, y: 0 },
      onPick: () => undefined,
      onApplyToAll: (id) => applied.push(id),
    })!;
    return { request, applied };
  }

  test('marks the target active and, without a pick, applies the stored retired id to all', () => {
    const { request, applied } = panel();
    expect(request.items.find((item) => item.active)?.id).toBe(FINISH.white);
    request.footer!.onClick({ activeId: FINISH.white, scopeChecked: false });
    expect(applied).toEqual([FINISH.wallpaper_cream]);
  });

  test('after a swatch pick applies the picked id', () => {
    const { request, applied } = panel();
    request.onPick({ id: FINISH.white, scopeChecked: false });
    request.footer!.onClick({ activeId: FINISH.white, scopeChecked: false });
    expect(applied).toEqual([FINISH.white]);
  });
});
