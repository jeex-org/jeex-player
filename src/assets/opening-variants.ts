/**
 * Opening variant bank (window and door replacements, same principle as
 * furniture asset variants): for every opening kind a small, hand-picked set
 * of strongly different looks — the first one in each set is the default
 * used by the demo scene. A variant only carries the data the builder needs
 * to rebuild a window or door group in place (frame/leaf proportions,
 * finish UUIDs, glazing/leaf style) plus a preview swatch spec; it never
 * touches geometry, and it reaches a canvas only through `createCanvas2D`
 * (`materials/canvas-2d.ts`), which answers `null` where there is no DOM.
 * `frame.material` (and `leaf.material`
 * when present) must resolve through `findFinish` in `./finishes` (enforced
 * by this module's tests) — this module stays pure and never imports `three`.
 */

import { createCanvas2D } from '../materials/canvas-2d.js';
import { FINISH } from '../materials/finish-ids.js';
import { OPENING_VARIANT } from './catalogue-ids.js';
import type { OpeningType } from '../scene/types.js';

export type OpeningVariant = {
  /** UUID v7 of the variant (`OPENING_VARIANT` in `catalogue-ids.ts`): what an opening's `variant` names. */
  id: string;
  /** Display-only readable name (`door-white-flat-bar`); never a key. */
  slug: string;
  name: string;
  for: 'window' | 'door';
  /** Marks an entrance/security door set, kept separate from interior doors. */
  entrance?: boolean;
  frame: { material: string; width: number; depth: number };
  // window-only
  glazing?: { panes: 1 | 2 | 3; mullions: 'none' | 'vertical' | 'grid'; tint: string };
  sillBoard?: boolean;
  // door-only
  leaf?: { style: 'flat' | 'panelled' | 'glass' | 'sliding' | 'double'; material: string; handle: 'bar' | 'knob' | 'none' };
  swing?: 'in' | 'out';
  /** Flat colours used to draw the preview swatch; independent of the finish texture. */
  preview: { base: string; accent?: string };
};

/** Frame cross-section defaults (metres), tuned per variant below. */
const FRAME_WIDTH_SLIM_M = 0.04;
const FRAME_WIDTH_STANDARD_M = 0.06;
const FRAME_WIDTH_WIDE_M = 0.07;
const FRAME_DEPTH_SLIM_M = 0.08;
const FRAME_DEPTH_STANDARD_M = 0.1;
const FRAME_DEPTH_WIDE_M = 0.12;

export const WINDOW_VARIANTS: OpeningVariant[] = [
  {
    id: OPENING_VARIANT.window_pvc_white,
    slug: 'window-pvc-white',
    name: 'White PVC, no mullions',
    for: 'window',
    frame: { material: FINISH.white, width: FRAME_WIDTH_STANDARD_M, depth: FRAME_DEPTH_WIDE_M },
    glazing: { panes: 2, mullions: 'none', tint: '#bcdce0' },
    sillBoard: true,
    preview: { base: '#eae4d6', accent: '#bcdce0' },
  },
  {
    id: OPENING_VARIANT.window_oak_vertical,
    slug: 'window-oak-vertical',
    name: 'Oak frame, vertical mullion',
    for: 'window',
    frame: { material: FINISH.oak, width: FRAME_WIDTH_WIDE_M, depth: FRAME_DEPTH_WIDE_M + 0.01 },
    glazing: { panes: 2, mullions: 'vertical', tint: '#c7dbdb' },
    sillBoard: true,
    preview: { base: '#b5855a', accent: '#c7dbdb' },
  },
  {
    id: OPENING_VARIANT.window_graphite_grid,
    slug: 'window-graphite-grid',
    name: 'Graphite aluminium grid',
    for: 'window',
    frame: { material: FINISH.graphite, width: FRAME_WIDTH_SLIM_M + 0.01, depth: FRAME_DEPTH_STANDARD_M },
    glazing: { panes: 2, mullions: 'grid', tint: '#9fc4c9' },
    sillBoard: true,
    preview: { base: '#6a6862', accent: '#9fc4c9' },
  },
  {
    id: OPENING_VARIANT.window_black_slim_triple,
    slug: 'window-black-slim-triple',
    name: 'Slim black frame, triple pane',
    for: 'window',
    frame: { material: FINISH.graphite, width: FRAME_WIDTH_SLIM_M, depth: FRAME_DEPTH_SLIM_M + 0.01 },
    glazing: { panes: 3, mullions: 'none', tint: '#87b3ba' },
    sillBoard: false,
    preview: { base: '#232322', accent: '#87b3ba' },
  },
];

export const DOOR_VARIANTS: OpeningVariant[] = [
  {
    id: OPENING_VARIANT.door_white_flat_bar,
    slug: 'door-white-flat-bar',
    name: 'White flat leaf, bar handle',
    for: 'door',
    frame: { material: FINISH.white, width: FRAME_WIDTH_STANDARD_M, depth: FRAME_DEPTH_STANDARD_M },
    leaf: { style: 'flat', material: FINISH.white, handle: 'bar' },
    swing: 'in',
    preview: { base: '#eae4d6', accent: '#8a8a86' },
  },
  {
    id: OPENING_VARIANT.door_oak_panelled_knob,
    slug: 'door-oak-panelled-knob',
    name: 'Oak panelled, knob handle',
    for: 'door',
    frame: { material: FINISH.oak, width: FRAME_WIDTH_WIDE_M, depth: FRAME_DEPTH_WIDE_M - 0.01 },
    leaf: { style: 'panelled', material: FINISH.oak, handle: 'knob' },
    swing: 'in',
    preview: { base: '#b5855a', accent: '#3a3a3a' },
  },
  {
    id: OPENING_VARIANT.door_glass_slim,
    slug: 'door-glass-slim',
    name: 'Glass leaf, slim frame',
    for: 'door',
    frame: { material: FINISH.graphite, width: FRAME_WIDTH_SLIM_M, depth: FRAME_DEPTH_SLIM_M },
    leaf: { style: 'glass', material: FINISH.graphite, handle: 'bar' },
    swing: 'in',
    preview: { base: '#6a6862', accent: '#bcdcdc' },
  },
  {
    id: OPENING_VARIANT.door_white_double,
    slug: 'door-white-double',
    name: 'White double leaf',
    for: 'door',
    frame: { material: FINISH.white, width: FRAME_WIDTH_STANDARD_M, depth: FRAME_DEPTH_STANDARD_M },
    leaf: { style: 'double', material: FINISH.white, handle: 'bar' },
    swing: 'in',
    preview: { base: '#eae4d6', accent: '#8a8a86' },
  },
];

export const ENTRY_DOOR_VARIANTS: OpeningVariant[] = [
  {
    id: OPENING_VARIANT.entry_door_oak_veneer,
    slug: 'entry-door-oak-veneer',
    name: 'Oak veneer security door',
    for: 'door',
    entrance: true,
    frame: { material: FINISH.oak, width: FRAME_WIDTH_WIDE_M, depth: FRAME_DEPTH_WIDE_M },
    leaf: { style: 'flat', material: FINISH.oak, handle: 'bar' },
    swing: 'in',
    preview: { base: '#8a5a34', accent: '#3a3a3a' },
  },
  {
    id: OPENING_VARIANT.entry_door_graphite_steel,
    slug: 'entry-door-graphite-steel',
    name: 'Graphite steel',
    for: 'door',
    entrance: true,
    frame: { material: FINISH.graphite, width: FRAME_WIDTH_WIDE_M, depth: FRAME_DEPTH_WIDE_M },
    leaf: { style: 'flat', material: FINISH.graphite, handle: 'bar' },
    swing: 'in',
    preview: { base: '#4c4c4a', accent: '#b9bec2' },
  },
  {
    id: OPENING_VARIANT.entry_door_walnut_panelled,
    slug: 'entry-door-walnut-panelled',
    name: 'Walnut panelled',
    for: 'door',
    entrance: true,
    frame: { material: FINISH.walnut, width: FRAME_WIDTH_WIDE_M, depth: FRAME_DEPTH_WIDE_M },
    leaf: { style: 'panelled', material: FINISH.walnut, handle: 'knob' },
    swing: 'in',
    preview: { base: '#6e4a30', accent: '#3a3a3a' },
  },
  {
    id: OPENING_VARIANT.entry_door_white_glass,
    slug: 'entry-door-white-glass',
    name: 'White with glass insert',
    for: 'door',
    entrance: true,
    frame: { material: FINISH.white, width: FRAME_WIDTH_WIDE_M, depth: FRAME_DEPTH_WIDE_M },
    leaf: { style: 'glass', material: FINISH.white, handle: 'bar' },
    swing: 'in',
    preview: { base: '#eae4d6', accent: '#bcdcdc' },
  },
];

const ALL_VARIANTS: OpeningVariant[] = [...WINDOW_VARIANTS, ...DOOR_VARIANTS, ...ENTRY_DOOR_VARIANTS];

/**
 * Which catalogue family fills an opening. A `passage` has no leaf of its own,
 * but its frame comes from the door sets, so it shares them.
 */
export function variantFamily(type: OpeningType): 'window' | 'door' {
  return type === 'window' ? 'window' : 'door';
}

/** Returns the fixed-order variant set for an opening type; doors default to the interior set. */
export function variantsForOpening(type: OpeningType, options?: { entrance?: boolean | undefined }): OpeningVariant[] {
  if (variantFamily(type) === 'window') return WINDOW_VARIANTS;
  return options?.entrance ? ENTRY_DOOR_VARIANTS : DOOR_VARIANTS;
}

/** Looks up a variant by id across every set (windows, interior doors, entrance doors). */
export function findOpeningVariant(id: string): OpeningVariant | undefined {
  return ALL_VARIANTS.find((variant) => variant.id === id);
}

/** The standard look for an opening type — always the first entry of its set. */
export function defaultOpeningVariant(type: OpeningType, entrance?: boolean): OpeningVariant {
  // Every branch of `variantsForOpening` returns one of the three literal sets
  // below, and all three are non-empty.
  return variantsForOpening(type, { entrance })[0]!;
}

const SWATCH_SIZE_PX = 64;

/**
 * Small schematic preview of a window/door variant (frame + leaf/glazing block
 * drawn from `preview.base`/`preview.accent`, no text). Returns null
 * when there is no 2D canvas to draw into (`canvas-2d.ts`), so pure-catalogue
 * tests run under Bun.
 */
export function openingVariantSwatchDataURL(variant: OpeningVariant): string | null {
  const surface = createCanvas2D(SWATCH_SIZE_PX);
  if (!surface) return null;
  const { canvas, ctx } = surface;

  const size = SWATCH_SIZE_PX;
  const margin = size * 0.12;
  const accent = variant.preview.accent ?? variant.preview.base;

  // Frame block.
  ctx.fillStyle = variant.preview.base;
  ctx.fillRect(margin, margin, size - margin * 2, size - margin * 2);

  // Inner opening (glazing pane or door leaf) inset from the frame.
  const inset = margin + size * 0.1;
  ctx.fillStyle = accent;
  ctx.fillRect(inset, inset, size - inset * 2, size - inset * 2);

  if (variant.glazing) {
    // Mullion lines on top of the glazing block.
    ctx.strokeStyle = variant.preview.base;
    ctx.lineWidth = Math.max(1, size * 0.02);
    const cx = size / 2;
    const cy = size / 2;
    if (variant.glazing.mullions === 'vertical' || variant.glazing.mullions === 'grid') {
      ctx.beginPath();
      ctx.moveTo(cx, inset);
      ctx.lineTo(cx, size - inset);
      ctx.stroke();
    }
    if (variant.glazing.mullions === 'grid') {
      ctx.beginPath();
      ctx.moveTo(inset, cy);
      ctx.lineTo(size - inset, cy);
      ctx.stroke();
    }
  } else if (variant.leaf) {
    // Handle mark on the leaf block.
    ctx.fillStyle = variant.preview.base;
    const handleY = size / 2;
    const handleX = size - inset - size * 0.08;
    if (variant.leaf.handle === 'bar') {
      ctx.fillRect(handleX, inset + size * 0.06, size * 0.03, size - inset * 2 - size * 0.12);
    } else if (variant.leaf.handle === 'knob') {
      ctx.beginPath();
      ctx.arc(handleX, handleY, size * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
    if (variant.leaf.style === 'double') {
      ctx.strokeStyle = variant.preview.base;
      ctx.lineWidth = Math.max(1, size * 0.02);
      ctx.beginPath();
      ctx.moveTo(size / 2, inset);
      ctx.lineTo(size / 2, size - inset);
      ctx.stroke();
    }
  }

  return canvas.toDataURL('image/png');
}
