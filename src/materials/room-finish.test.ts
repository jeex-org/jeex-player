import { describe, expect, test } from 'bun:test';
import { FINISH } from './finish-ids.js';
import { findFinish } from './finish-catalogue.js';
import { resolveRoomFinish } from './room-finish.js';
import type { ProjectMaterial } from './finish-types.js';
import { GENERATOR_FLOOR, LIBRARY_MATERIALS, NATURAL_SCAN, PAINT, PBR_WALL } from '../fixtures/library-materials.js';
import { BUILTIN_DEFAULT_CEILING, BUILTIN_FINISHES } from './builtin-library.js';

/** The legacy lookup a project document uses: its own materials, then the bank. */
const legacy = (id: string) => findFinish(id, LIBRARY_MATERIALS) ?? findFinish(id);

describe('resolveRoomFinish', () => {
  test('a generator and a pbr finish resolve to the legacy Finish they always drew', () => {
    for (const id of [GENERATOR_FLOOR.id, PBR_WALL.id]) {
      const resolved = resolveRoomFinish(id, LIBRARY_MATERIALS, legacy);
      expect({ id, kind: resolved?.kind, finish: resolved?.kind === 'legacy' ? resolved.finish : null }).toEqual({
        id,
        kind: 'legacy',
        finish: legacy(id),
      });
    }
  });

  test('a library material resolves to a library draw from its bare UUID, rotation 0 and no colour', () => {
    const material = (NATURAL_SCAN as Extract<ProjectMaterial, { library: unknown }>).library;
    expect(resolveRoomFinish(NATURAL_SCAN.id, LIBRARY_MATERIALS, legacy)).toEqual({
      kind: 'library',
      draw: { id: NATURAL_SCAN.id, material, rotation: 0 },
    });
  });

  test('a finish object carries its colour and rotation into the draw', () => {
    const resolved = resolveRoomFinish({ material: PAINT.id, colour: '#2050a0', rotation: 90 }, LIBRARY_MATERIALS, legacy);
    expect(resolved?.kind === 'library' && { colour: resolved.draw.colour, rotation: resolved.draw.rotation }).toEqual({
      colour: '#2050a0',
      rotation: 90,
    });
  });

  test('a bound bundled finish resolves to a built-in library draw with its own tint and rotation', () => {
    const oak = BUILTIN_FINISHES.get(FINISH.oak)!;
    expect(resolveRoomFinish(FINISH.oak, undefined, findFinish)).toEqual({
      kind: 'library',
      draw: { id: FINISH.oak, material: oak.material, rotation: oak.rotation, builtin: true },
    });
    const sand = BUILTIN_FINISHES.get(FINISH.sand)!;
    expect(resolveRoomFinish(FINISH.sand, LIBRARY_MATERIALS, legacy)).toEqual({
      kind: 'library',
      draw: { id: FINISH.sand, material: sand.material, colour: sand.colour!, rotation: sand.rotation, builtin: true },
    });
  });

  test('a project material of any kind under a bundled id wins over the built-in draw', () => {
    const generator: ProjectMaterial = { ...GENERATOR_FLOOR, id: FINISH.oak };
    const own = [generator];
    const ownLegacy = (id: string) => findFinish(id, own) ?? findFinish(id);
    expect(resolveRoomFinish(FINISH.oak, own, ownLegacy)).toEqual({ kind: 'legacy', finish: ownLegacy(FINISH.oak)! });
    const library: ProjectMaterial = { ...NATURAL_SCAN, id: FINISH.sand };
    const drawn = resolveRoomFinish(FINISH.sand, [library], findFinish);
    expect(drawn?.kind === 'library' && drawn.draw.builtin).toBeUndefined();
  });

  test('a kept bundled finish still resolves to the legacy Finish it always drew', () => {
    expect(BUILTIN_FINISHES.has(FINISH.wallpaper_cream)).toBe(false);
    expect(resolveRoomFinish(FINISH.wallpaper_cream, undefined, findFinish)).toEqual({
      kind: 'legacy',
      finish: findFinish(FINISH.wallpaper_cream)!,
    });
  });

  test('the default-ceiling id never resolves from the built-in table', () => {
    expect(BUILTIN_DEFAULT_CEILING).not.toBeNull();
    expect(resolveRoomFinish(FINISH.plaster_white, undefined, findFinish)).toBeNull();
  });

  test('an id nobody knows resolves to nothing', () => {
    expect(resolveRoomFinish('01a167f6-040a-72e4-9504-fef48f8fd18d', LIBRARY_MATERIALS, legacy)).toBeNull();
  });
});
