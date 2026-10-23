/**
 * Project library materials in the swatches and in `describeSelection`: which
 * of them a picked surface lists, the explicit `set_material` each option and
 * scope action carries, the finish marked current, and the chip it shows.
 */

import { describe, expect, test } from 'bun:test';
import { describeSelection, finishCore, type DescribeDeps } from './selection-options.js';
import { createMessages } from './messages.js';
import { FLOOR_FINISHES, WALL_FINISHES } from '../materials/finishes.js';
import type { VariantBank } from '../assets/asset-variants.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { LIBRARY_FINISH } from '../fixtures/library-finishes.js';
import { GENERATOR_FLOOR, NATURAL_SCAN, PAINT, TINTABLE_SCAN } from '../fixtures/library-materials.js';
import { faceKey, type SceneData } from '../scene/types.js';

const EN = createMessages('en');
const ROOM_A = L_SHAPE.room.a;
const ROOM_FACE = faceKey(ROOM_A, L_SHAPE.wall.wPart, 'L');
const FACADE_FACE = faceKey(null, L_SHAPE.wall.wSA, 'R');

/** The paint again under another id and `apply`: a material for the facade alone, and one for the facade and walls. */
const asMaterial = (id: string, apply: ProjectMaterial['apply']): ProjectMaterial => ({ ...PAINT, id, apply });
const FACADE_ONLY = asMaterial(LIBRARY_FINISH.facadeOnly, ['facade']);
const FACADE_AND_WALL = asMaterial(LIBRARY_FINISH.facadeAndWall, ['facade', 'wall']);
const PREVIEWED: ProjectMaterial = { ...TINTABLE_SCAN, preview: 'prev/linen.webp' };

/** The project's bank: its materials in manifest order, and the folder its previews resolve against. */
const BANK: VariantBank = {
  catalogue: undefined as never,
  materials: [NATURAL_SCAN, PAINT, FACADE_ONLY, FACADE_AND_WALL, PREVIEWED, GENERATOR_FLOOR],
  previewUrl: (entry) => (entry.preview === undefined ? undefined : `https://project.test/p/${entry.preview}`),
};

/** The L-shape with optional finishes. */
const scene = (finishes?: SceneData['finishes']): SceneData => ({ ...lShapePlan, ...(finishes && { finishes }) });

const ids = (core: ReturnType<typeof finishCore>): string[] => core?.options.map((option) => option.id) ?? [];

describe('project materials offered by surface', () => {
  test('a floor lists the library materials that dress floors first, in manifest order, then the bundled floor finishes', () => {
    const core = finishCore(scene(), { surface: 'floor', roomId: ROOM_A }, EN, BANK);
    expect(ids(core)).toEqual([NATURAL_SCAN.id, ...FLOOR_FINISHES.map((finish) => finish.id)]);
  });

  test('a room wall lists the materials whose apply names wall', () => {
    const core = finishCore(scene(), { surface: 'wall', roomId: ROOM_A, face: ROOM_FACE }, EN, BANK);
    expect(ids(core)).toEqual([PAINT.id, FACADE_AND_WALL.id, PREVIEWED.id, ...WALL_FINISHES.map((finish) => finish.id)]);
  });

  test('a facade face lists the materials whose apply names facade, then the bundled wall finishes', () => {
    const core = finishCore(scene(), { surface: 'wall', face: FACADE_FACE }, EN, BANK);
    expect(ids(core)).toEqual([PAINT.id, FACADE_ONLY.id, FACADE_AND_WALL.id, ...WALL_FINISHES.map((finish) => finish.id)]);
  });

  test('a bare scene lists the bundled finishes, unchanged', () => {
    expect(ids(finishCore(scene(), { surface: 'floor', roomId: ROOM_A }, EN))).toEqual(FLOOR_FINISHES.map((finish) => finish.id));
  });
});

describe('library options carry the explicit form', () => {
  const option = (core: ReturnType<typeof finishCore>, id: string) => core?.options.find((candidate) => candidate.id === id);

  test('the floor option of a scan paints that room’s floor', () => {
    const core = finishCore(scene(), { surface: 'floor', roomId: ROOM_A }, EN, BANK);
    expect(option(core, NATURAL_SCAN.id)?.op).toEqual({ op: 'set_material', surface: 'floor', room: ROOM_A, material: NATURAL_SCAN.id });
  });

  test('a room wall option paints the room’s walls; a facade face option the facade', () => {
    const wall = finishCore(scene(), { surface: 'wall', roomId: ROOM_A, face: ROOM_FACE }, EN, BANK);
    expect(option(wall, PAINT.id)?.op).toEqual({ op: 'set_material', surface: 'wall', room: ROOM_A, material: PAINT.id });
    const facade = finishCore(scene(), { surface: 'wall', face: FACADE_FACE }, EN, BANK);
    expect(option(facade, FACADE_ONLY.id)?.op).toEqual({ op: 'set_material', surface: 'facade', material: FACADE_ONLY.id });
  });

  test('bundled options keep the legacy form', () => {
    const core = finishCore(scene(), { surface: 'floor', roomId: ROOM_A }, EN, BANK);
    const first = FLOOR_FINISHES[0]!;
    expect(option(core, first.id)?.op).toEqual({ op: 'set_material', target: ROOM_A, material: first.id });
  });
});

describe('scope actions follow the destination surface', () => {
  const deps = (finishes: SceneData['finishes']): DescribeDeps => ({
    scene: scene(finishes),
    messages: EN,
    openings: [],
    renderPreview: () => null,
    variants: BANK,
  });

  test('a facade-only material offers the facade face and no every-room walls action', () => {
    const described = describeSelection({ kind: 'wall', face: FACADE_FACE }, deps({ facade: FACADE_ONLY.id }));
    expect(described?.scope?.ops).toEqual({ one: { op: 'set_material', surface: 'facade', face: FACADE_FACE, material: FACADE_ONLY.id } });
  });

  test('a facade-and-wall material offers both', () => {
    const described = describeSelection({ kind: 'wall', face: FACADE_FACE }, deps({ facade: FACADE_AND_WALL.id }));
    expect(described?.scope?.ops).toEqual({
      one: { op: 'set_material', surface: 'facade', face: FACADE_FACE, material: FACADE_AND_WALL.id },
      all: { op: 'set_material', surface: 'wall', material: FACADE_AND_WALL.id },
    });
  });

  test('a room floor in a scan: this room and every room, both explicit', () => {
    const described = describeSelection({ kind: 'room', roomId: ROOM_A }, deps({ rooms: { [ROOM_A]: { floor: NATURAL_SCAN.id } } }));
    expect(described?.scope?.ops).toEqual({
      one: { op: 'set_material', surface: 'floor', room: ROOM_A, material: NATURAL_SCAN.id },
      all: { op: 'set_material', surface: 'floor', material: NATURAL_SCAN.id },
    });
  });

  test('a room face in a paint: this face and every room’s walls', () => {
    const described = describeSelection(
      { kind: 'wall', roomId: ROOM_A, face: ROOM_FACE },
      deps({ rooms: { [ROOM_A]: { walls: PAINT.id } } }),
    );
    expect(described?.scope?.ops).toEqual({
      one: { op: 'set_material', surface: 'wall', face: ROOM_FACE, material: PAINT.id },
      all: { op: 'set_material', surface: 'wall', material: PAINT.id },
    });
  });
});

describe('current finish and appearance', () => {
  test('the current finish of a face wearing a finish object is its material UUID, and that option is the current one', () => {
    const described = describeSelection(
      { kind: 'wall', roomId: ROOM_A, face: ROOM_FACE },
      {
        scene: scene({ faces: [{ ...ROOM_FACE, finish: { material: PAINT.id, colour: '#c9d6df' } }] }),
        messages: EN,
        openings: [],
        renderPreview: () => null,
        variants: BANK,
      },
    );
    expect(described?.current).toBe(PAINT.id);
    expect(described?.options.some((option) => option.id === PAINT.id)).toBe(true);
  });

  test('a scan’s chip is its averageColour, a tintable paint’s its first suggested colour, and a preview wins when given', () => {
    const floor = finishCore(scene(), { surface: 'floor', roomId: ROOM_A }, EN, BANK)!;
    expect(floor.options[0]).toMatchObject({ background: '#9a7b56', palette: ['#9a7b56'], thumbnail: null });
    const wall = finishCore(scene(), { surface: 'wall', roomId: ROOM_A, face: ROOM_FACE }, EN, BANK)!;
    expect(wall.options.find((option) => option.id === PAINT.id)).toMatchObject({ background: '#f1eee8', palette: ['#f1eee8'] });
    expect(wall.options.find((option) => option.id === PREVIEWED.id)?.image).toBe('https://project.test/p/prev/linen.webp');
  });
});
