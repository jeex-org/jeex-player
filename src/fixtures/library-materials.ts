/**
 * Project materials as a manifest carries them, one of each kind the room
 * surfaces draw: a natural scan, a tintable scan, a tintable paint, and one
 * `pbr` and one `generator` material for the legacy path. Their ids are the
 * ones `library-finishes.ts` gives the scene layer, so a test can judge a
 * document and draw it from the same table.
 */

import type { LibraryMapRole, LibraryMapSize, ProjectMaterial } from '../materials/finish-types.js';
import { LIBRARY_FINISH } from './library-finishes.js';

/** Catalogue versions the maps sit under, generated once offline. */
export const LIBRARY_VERSION = {
  floorScan: '01a167f6-040a-72e4-9504-fef48f8fd18d',
  wallOnly: '01a167f6-040a-77b2-ae9f-7185917d5b12',
  paint: '01a167ee-503a-7a92-b834-d3c769888ef6',
} as const;

/** One map of `version` at `sizes`, every file at its exact path. */
function map(version: string, role: LibraryMapRole, sizes: readonly LibraryMapSize[]) {
  const colourSpace = role === 'albedo' || role === 'albedoTint' ? ('srgb' as const) : ('linear' as const);
  return {
    colourSpace,
    ...(role === 'normal' && { convention: 'opengl' as const }),
    files: Object.fromEntries(sizes.map((size) => [size, `tex/${version}/${role}.${size}.webp`])),
  };
}

/** A natural plank scan with albedo, normal and ARM at 256 and 512. */
export const NATURAL_SCAN: ProjectMaterial = {
  id: LIBRARY_FINISH.floorScan,
  name: 'Oak planks',
  apply: ['floor'],
  library: {
    versionId: LIBRARY_VERSION.floorScan,
    kind: 'scan',
    facts: { tileM: [2, 1], grain: 'along_u', suitability: 'plank_floor', colourMode: 'natural', averageColour: '#9a7b56', pbr: {} },
    maps: {
      albedo: map(LIBRARY_VERSION.floorScan, 'albedo', ['256', '512']),
      normal: map(LIBRARY_VERSION.floorScan, 'normal', ['256', '512']),
      arm: map(LIBRARY_VERSION.floorScan, 'arm', ['256', '512']),
    },
  },
};

/** A tintable weave scan with its tint map and separate roughness. */
export const TINTABLE_SCAN: ProjectMaterial = {
  id: LIBRARY_FINISH.wallOnly,
  name: 'Linen weave',
  apply: ['wall'],
  library: {
    versionId: LIBRARY_VERSION.wallOnly,
    kind: 'scan',
    facts: {
      tileM: [0.5, 0.5],
      grain: 'none',
      suitability: 'continuous',
      normalStrength: 0.8,
      colourMode: 'tintable',
      tint: { recipe: 'luma-mid@1', suggestedColours: [{ name: 'Mist', hex: '#c9d6df' }] },
      averageColour: '#808080',
      pbr: { roughness: 0.9 },
    },
    maps: {
      albedoTint: map(LIBRARY_VERSION.wallOnly, 'albedoTint', ['512']),
      roughness: map(LIBRARY_VERSION.wallOnly, 'roughness', ['512']),
    },
  },
};

/** A tintable paint: parameters only. */
export const PAINT: ProjectMaterial = {
  id: LIBRARY_FINISH.paint,
  name: 'Matt paint',
  apply: ['wall', 'ceiling', 'facade', 'trim'],
  library: {
    versionId: LIBRARY_VERSION.paint,
    kind: 'parameters',
    facts: {
      tileM: null,
      grain: 'none',
      suitability: 'continuous',
      colourMode: 'tintable',
      tint: { recipe: 'luma-mid@1', suggestedColours: [{ name: 'Chalk', hex: '#f1eee8' }] },
      averageColour: '#806040',
      pbr: { baseColour: '#806040', roughness: 0.85 },
    },
    maps: {},
  },
};

/** A legacy `pbr` project material, drawn flat. */
export const PBR_WALL: ProjectMaterial = {
  id: LIBRARY_FINISH.pbrWall,
  name: 'Stone',
  apply: ['wall'],
  pbr: { albedo: 'tex/stone_albedo.ktx2', roughness: 0.6, tile: [1.2, 1.2] },
};

/** A legacy `generator` project material. */
export const GENERATOR_FLOOR: ProjectMaterial = {
  id: LIBRARY_FINISH.generatorFloor,
  name: 'Generated planks',
  apply: ['floor'],
  generator: { kind: 'plank_floor', tone: '#b5855a', seed: 1 },
};

/** All five, in manifest order. */
export const LIBRARY_MATERIALS: readonly ProjectMaterial[] = [NATURAL_SCAN, TINTABLE_SCAN, PAINT, PBR_WALL, GENERATOR_FLOOR];
