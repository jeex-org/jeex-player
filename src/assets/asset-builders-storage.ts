/**
 * Procedural builders for carcass furniture: case goods, wall cabinets,
 * shelving, media units.
 *
 * See the conventions list in `asset-builders.ts` for the anchor/orientation
 * rules every builder here follows.
 *
 * Invariant: builders only ever take geometry from the shared cache and
 * materials from the finish registry - they never create or dispose either.
 */

import * as THREE from 'three';
import { optionNumber } from './asset-resolver.js';
import { readOptions, type OptionSpec } from './asset-options.js';
import { makeRandom } from '../materials/texture-noise.js';
import { LEAF_REVEAL, barHandle, knobHandle, put, shakerFront, taperedLeg, turnedLeg, type Builder } from './asset-kit.js';

/** Turned leg for chests and consoles, nominal 0.2 m, scaled per mesh to the piece's base height. */
const CASE_LEG_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.018, 0.0],
  [0.018, 0.006],
  [0.0142, 0.014],
  [0.0112, 0.09],
  [0.0108, 0.15],
  [0.0126, 0.17],
  [0.0112, 0.2],
];

/* ---------------------------------------------------------------- carcasses */

/**
 * Everything with a box body and fronts: nightstands, dressers, consoles,
 * wardrobes, tall kitchen units, shoe cabinets. `doors`, `drawers`, `plinth`,
 * `legs`, `handle`, `split` and `capping` cover the whole family.
 *
 * The fronts carry the whole read of the object: shaker leaves proud of the
 * carcass, a 4 mm reveal between them, a recessed toe kick under them and a
 * capped top over them. Without that a white wardrobe against a white wall is
 * an untextured box - which is exactly what it looked like before.
 */
/**
 * `buildCaseGoods`. `body` is the share of the height the carcass takes;
 * anything under 1 lifts it on longer legs, which is the difference between a
 * chest and a console.
 */
const CASE_GOODS_OPTIONS = {
  plinth: { kind: 'number', default: 0, min: 0 },
  legs: { kind: 'text', values: ['none', 'tapered'], default: 'none' },
  doors: { kind: 'number', default: 0, min: 0, integer: true },
  drawers: { kind: 'number', default: 0, min: 0, integer: true },
  handle: { kind: 'text', values: ['bar', 'knob'], default: 'bar' },
  split: { kind: 'number', default: 0, min: 0 },
  capping: { kind: 'flag', default: false },
  body: { kind: 'number', default: 1, min: 0.2, max: 1 },
  shelf: { kind: 'flag', default: false },
} as const satisfies Record<string, OptionSpec>;

export const buildCaseGoods: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const {
    plinth,
    legs,
    doors,
    drawers,
    handle,
    split,
    capping,
    body: bodyFraction,
    shelf,
  } = readOptions(asset.options, CASE_GOODS_OPTIONS);
  const topThickness = capping || legs === 'tapered' ? 0.03 : 0;
  const shell = height - topThickness;
  const base = legs === 'tapered' ? (bodyFraction < 1 ? shell * (1 - bodyFraction) : 0.13) : plinth;
  const bodyHeight = shell - base;
  const carcass = kit.finish('carcass');
  const gap = LEAF_REVEAL;
  const frontDepth = 0.02;

  if (legs === 'tapered') {
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        turnedLeg(group, kit, CASE_LEG_PROFILE, 'leg', x * (width / 2 - 0.055), z * (depth / 2 - 0.055), base);
      }
    }
  } else if (plinth > 0) {
    put(group, kit.box(width - 0.07, plinth, depth - 0.06), carcass, { y: plinth / 2, z: -0.02 });
  }

  put(group, kit.rounded(width, bodyHeight, depth, 0.008), carcass, { y: base + bodyHeight / 2 });
  if (topThickness > 0) {
    put(group, kit.rounded(width + 0.03, topThickness, depth + 0.03, 0.006), kit.finish(capping ? 'top' : 'carcass'), {
      y: height - topThickness / 2,
    });
  }
  if (shelf) {
    // Open shelf slung between the legs - the hallway console silhouette.
    put(group, kit.rounded(width - 0.12, 0.022, depth - 0.06, 0.006), carcass, { y: base * 0.34 });
  }

  const frontZ = depth / 2 + frontDepth / 2;
  // Leaves sit proud of the carcass by `frontDepth` and are inset by half a
  // reveal all round, so neighbours leave a 4 mm shadow gap between them.
  const addFront = (fw: number, fh: number, cx: number, cy: number): void => {
    shakerFront(group, kit, 'front', fw, fh, frontDepth, cx, cy, frontZ);
  };

  if (drawers > 0) {
    const cellHeight = bodyHeight / drawers;
    for (let index = 0; index < drawers; index += 1) {
      const cy = base + cellHeight * (index + 0.5);
      addFront(width - gap, cellHeight - gap, 0, cy);
      if (handle === 'knob') knobHandle(group, kit, 'metal', 0, cy, frontZ + frontDepth / 2);
      else barHandle(group, kit, 'metal', Math.min(0.16, width * 0.4), 0, cy, frontZ + frontDepth / 2);
    }
  }

  if (doors > 0 && split > 0) {
    const lower = bodyHeight * split;
    addFront(width - gap, lower - gap, 0, base + lower / 2);
    addFront(width - gap, bodyHeight - lower - gap, 0, base + lower + (bodyHeight - lower) / 2);
    barHandle(group, kit, 'metal', Math.min(0.22, width * 0.5), 0, base + lower - 0.09, frontZ + frontDepth / 2);
    barHandle(group, kit, 'metal', Math.min(0.22, width * 0.5), 0, base + lower + 0.09, frontZ + frontDepth / 2);
  } else if (doors > 0) {
    const cellWidth = width / doors;
    for (let index = 0; index < doors; index += 1) {
      const cx = -width / 2 + cellWidth * (index + 0.5);
      addFront(cellWidth - gap, bodyHeight - gap, cx, base + bodyHeight / 2);
      const edge = doors === 1 ? cellWidth * 0.3 : index < doors / 2 ? cellWidth * 0.32 : -cellWidth * 0.32;
      if (handle === 'knob') knobHandle(group, kit, 'metal', cx + edge, base + bodyHeight * 0.55, frontZ + frontDepth / 2);
      else
        barHandle(
          group,
          kit,
          'metal',
          Math.min(0.34, bodyHeight * 0.34),
          cx + edge,
          base + bodyHeight * 0.55,
          frontZ + frontDepth / 2,
          true,
        );
    }
  }
  return group;
};

/** Wall cabinet: a carcass centred on its origin, fronts toward the room. */
/** `buildWallCabinet`; `doors: 0` is the open version, with a mid shelf. */
const WALL_CABINET_OPTIONS = {
  doors: { kind: 'number', default: 2, min: 0, integer: true },
} as const satisfies Record<string, OptionSpec>;

export const buildWallCabinet: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { doors } = readOptions(asset.options, WALL_CABINET_OPTIONS);
  const carcass = kit.finish('carcass');
  put(group, kit.rounded(width, height, depth, 0.008), carcass, {});
  put(group, kit.rounded(width + 0.04, 0.03, depth + 0.02, 0.006), kit.finish('top'), { y: height / 2 + 0.015 });
  // Light valance: a rail proud of the bottom front that catches shadow and reads as the under-cabinet zone.
  put(group, kit.box(width - 0.03, 0.016, 0.02), carcass, { y: -height / 2 + 0.008, z: depth / 2 - 0.006 });

  if (doors === 0) {
    // Open version: one mid shelf and two end cheeks.
    put(group, kit.box(width - 0.06, 0.022, depth - 0.02), carcass, {});
    return group;
  }
  const cellWidth = width / doors;
  const frontDepth = 0.019;
  for (let index = 0; index < doors; index += 1) {
    const cx = -width / 2 + cellWidth * (index + 0.5);
    shakerFront(group, kit, 'front', cellWidth - LEAF_REVEAL, height - LEAF_REVEAL, frontDepth, cx, 0, depth / 2 + frontDepth / 2);
    const edge = index < doors / 2 ? cellWidth * 0.3 : -cellWidth * 0.3;
    barHandle(group, kit, 'metal', Math.min(0.2, height * 0.34), cx + edge, -height * 0.22, depth / 2 + frontDepth, true);
  }
  return group;
};

/** Open shelving with a seeded row of books per shelf. */
/** `buildShelving`; `books` is the share of each shelf a row of books fills. */
const SHELVING_OPTIONS = {
  shelves: { kind: 'number', default: 4, min: 2, integer: true },
  books: { kind: 'number', default: 0.72, min: 0, max: 0.95 },
  seed: { kind: 'number', default: 17, integer: true },
  back: { kind: 'flag', default: true },
} as const satisfies Record<string, OptionSpec>;

export const buildShelving: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { shelves, books: fill, seed, back } = readOptions(asset.options, SHELVING_OPTIONS);
  const panel = 0.035;
  const carcass = kit.finish('carcass');
  const random = makeRandom(seed * 7919 + 3);

  for (const side of [-1, 1]) {
    put(group, kit.rounded(panel, height, depth, 0.004), carcass, { x: (side * (width - panel)) / 2, y: height / 2 });
  }
  // Top cap overhangs the sides - the furniture read a bare panel lacks.
  put(group, kit.rounded(width + 0.02, panel, depth + 0.012, 0.005), carcass, { y: height - panel / 2 });
  put(group, kit.box(width, panel, depth), carcass, { y: panel / 2 });
  // Recessed plinth rail across the bottom front.
  put(group, kit.box(width - panel * 2 - 0.04, 0.06, 0.016), carcass, { y: panel + 0.03, z: depth / 2 - 0.008 });
  if (back) {
    put(group, kit.box(width - panel * 2, height - panel * 2, 0.012), carcass, { y: height / 2, z: -depth / 2 + 0.006 });
  }

  const inner = height - panel * 2;
  const bay = inner / shelves;
  const spines = [kit.finish('accent'), kit.finish('top'), kit.finish('metal'), carcass];
  for (let index = 0; index < shelves; index += 1) {
    const shelfY = panel + bay * (index + 1);
    if (index < shelves - 1) put(group, kit.box(width - panel * 2, 0.022, depth - 0.02), carcass, { y: shelfY, z: 0.01 });
    const bookTop = panel + bay * index + 0.011;
    const usable = (width - panel * 2 - 0.04) * fill;
    let cursor = -(width - panel * 2) / 2 + 0.02;
    const limit = cursor + usable;
    while (cursor < limit) {
      const bookWidth = 0.026 + random() * 0.034;
      if (cursor + bookWidth > limit) break;
      const bookHeight = bay * (0.52 + random() * 0.3);
      const lean = random() > 0.88 ? 0.16 : 0;
      // `random()` is in [0, 1) and `spines` is the four-entry literal above.
      const spine = spines[Math.floor(random() * spines.length)]!;
      put(group, kit.box(bookWidth, bookHeight, depth * (0.55 + random() * 0.2)), spine, {
        x: cursor + bookWidth / 2,
        y: bookTop + bookHeight / 2,
        z: 0.02,
        rz: lean,
      });
      cursor += bookWidth + 0.004;
    }
  }
  return group;
};

/** Media unit: a low cabinet with a flat screen standing on it. */
/**
 * `buildMediaUnit`. `screen` is the ONE option in the bank with a default that
 * depends on the archetype's own dimensions, so it stays an `optionNumber`
 * read: a spec default is a constant, and pretending otherwise (a sentinel, a
 * nullable) would cost more than it saves.
 */
const MEDIA_UNIT_OPTIONS = {
  doors: { kind: 'number', default: 2, min: 1, integer: true },
} as const satisfies Record<string, OptionSpec>;

export const buildMediaUnit: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, , depth] = asset.dims;
  const { doors } = readOptions(asset.options, MEDIA_UNIT_OPTIONS);
  const screenWidth = optionNumber(asset.options, 'screen', width * 0.74);
  const legHeight = 0.1;
  const bodyHeight = 0.4;
  const bodyTop = legHeight + bodyHeight;
  const frontDepth = 0.018;

  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      taperedLeg(group, kit, 'leg', 0.02, 0.014, legHeight, x * (width / 2 - 0.09), z * (depth / 2 - 0.09));
    }
  }
  put(group, kit.rounded(width, bodyHeight, depth, 0.008), kit.finish('carcass'), { y: legHeight + bodyHeight / 2 });
  // Back panel: without it the wall shows through the open underside of the box.
  put(group, kit.box(width - 0.06, bodyHeight - 0.04, 0.012), kit.finish('carcass'), {
    y: legHeight + bodyHeight / 2,
    z: -depth / 2 + 0.006,
  });
  const cellWidth = width / doors;
  for (let index = 0; index < doors; index += 1) {
    const cx = -width / 2 + cellWidth * (index + 0.5);
    shakerFront(
      group,
      kit,
      'front',
      cellWidth - LEAF_REVEAL,
      bodyHeight - LEAF_REVEAL,
      frontDepth,
      cx,
      legHeight + bodyHeight / 2,
      depth / 2 + frontDepth / 2,
    );
    barHandle(group, kit, 'metal', Math.min(0.24, cellWidth * 0.5), cx, legHeight + bodyHeight * 0.7, depth / 2 + frontDepth);
  }

  // Screen: a bezel panel on a plate stand, tilted a hair back.
  const screenHeight = screenWidth * 0.5625;
  const standHeight = 0.09;
  put(group, kit.cylinder(0.09, 0.11, 0.022, 20), kit.finish('metal'), { y: bodyTop + 0.011 });
  put(group, kit.box(0.05, standHeight, 0.03), kit.finish('metal'), { y: bodyTop + 0.022 + standHeight / 2 });
  const panelY = bodyTop + 0.022 + standHeight + screenHeight / 2;
  put(group, kit.box(screenWidth, screenHeight, 0.024), kit.finish('metal'), { y: panelY, rx: -0.04 });
  put(group, kit.box(screenWidth - 0.03, screenHeight - 0.03, 0.006), kit.finish('screen'), { y: panelY, z: 0.015, rx: -0.04 });
  return group;
};
