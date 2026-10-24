/**
 * The finishes window and door frames are drawn in when no room paint fits
 * them: a library material drawn FLAT, in its first-frame colour with its PBR
 * scalars, through `createLibraryMaterial`. No maps are fetched or attached:
 * frame parts are boxes whose UVs run 0..1 per face, not the world-metre UVs
 * a scan's tile is laid out on, so a scan's maps would be stretched over every
 * face. The version facts are pinned here, as the library projects them; the
 * ids are code constants (`FINISH`), never minted at run time.
 *
 * Pure module: no `three`, no DOM.
 */

import { FINISH } from './finish-ids.js';
import type { LibraryMaterial } from './finish-types.js';

/** One frame finish: a library material and the tint it is drawn in. */
export type FrameFinish = {
  readonly id: string;
  /** Display-only readable name (`frame_graphite`); never a key. */
  readonly slug: string;
  readonly name: string;
  readonly material: LibraryMaterial;
  /** The tint of the tintable material, `#rrggbb`. */
  readonly colour: string;
};

export const FRAME_FINISHES: readonly FrameFinish[] = [
  {
    id: FINISH.frame_graphite,
    slug: 'frame_graphite',
    name: 'Graphite powder coat',
    colour: '#6a6862',
    // Metal 027, powder-coated metal (ambientCG Metal027, CC0), library version 1.0.0.
    material: {
      versionId: '01a16edd-4f5a-76e8-bd15-da5ac8c2f0ca',
      kind: 'scan',
      facts: {
        tileM: [0.5, 0.5],
        grain: 'unknown',
        suitability: 'continuous',
        normalStrength: 1,
        colourMode: 'tintable',
        tint: { recipe: 'luma-mid@1', suggestedColours: [{ name: 'natural', hex: '#2e2d35' }] },
        averageColour: '#808080',
        pbr: { roughness: 0.8472592781444162 },
      },
      maps: {},
    },
  },
];

/** The frame finish with that id, or `undefined`. */
export function frameFinish(id: string): FrameFinish | undefined {
  return FRAME_FINISHES.find((finish) => finish.id === id);
}
