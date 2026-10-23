import { describe, expect, test } from 'bun:test';
import { FINISH } from './finish-ids.js';
import { findFinish } from './finish-catalogue.js';
import { resolveRoomFinish } from './room-finish.js';
import type { ProjectMaterial } from './finish-types.js';
import { GENERATOR_FLOOR, LIBRARY_MATERIALS, NATURAL_SCAN, PAINT, PBR_WALL } from '../fixtures/library-materials.js';

/** The legacy lookup a project document uses: its own materials, then the bank. */
const legacy = (id: string) => findFinish(id, LIBRARY_MATERIALS) ?? findFinish(id);

describe('resolveRoomFinish', () => {
  test('a bundled, a generator and a pbr finish resolve to the legacy Finish they always drew', () => {
    for (const id of [FINISH.oak, GENERATOR_FLOOR.id, PBR_WALL.id]) {
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

  test('a bare scene has no project materials and resolves through the bank alone', () => {
    expect(resolveRoomFinish(FINISH.sand, undefined, findFinish)?.kind).toBe('legacy');
  });

  test('an id nobody knows resolves to nothing', () => {
    expect(resolveRoomFinish('01a167f6-040a-72e4-9504-fef48f8fd18d', LIBRARY_MATERIALS, legacy)).toBeNull();
  });
});
