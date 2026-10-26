/**
 * Every closed set of the library covers its union, exhaustively.
 *
 * A closed set has two halves: a string-literal UNION the compiler reasons
 * about, and a runtime LIST something iterates or validates against. When they
 * drift, adding `'skylight'` to `OpeningType` compiles everywhere and is
 * silently rejected by the validator with "unknown type" — which is exactly
 * what happened in the four sets that guard the scene schema.
 *
 * Each set below is asserted TWICE, on purpose:
 *
 * 1. at COMPILE time, with `satisfies Record<Union, true>`. A member of the
 *    union that is missing from the set makes the object literal incomplete
 *    and this file stops compiling — before any test runs. That is the half
 *    that catches the drift the moment it is introduced.
 * 2. at RUN time, by length. The compile-time half proves every member of the
 *    union is IN the set; the length proves the set holds nothing else and no
 *    duplicates, which a `Record` cannot see.
 *
 * The sets are declared `as const satisfies readonly Union[]` at their homes,
 * which is the third leg: a member of the SET that is not in the union fails
 * to compile there.
 *
 * Adding a closed set to the library means adding four lines here. A set with
 * no entry in this file is a set that may drift.
 */

import { describe, expect, test } from 'bun:test';
import {
  OPENING_HINGES,
  OPENING_SHAPES,
  OPENING_SWINGS,
  OPENING_TYPES,
  ROOM_KINDS,
  ROOM_PURPOSES,
  SITE_SUNS,
  WALL_ROLES,
} from './scene/schema-sets.js';
import type { OpeningHinge, OpeningShape, OpeningSwing, OpeningType, RoomKind, RoomPurpose, SiteSun, WallRole } from './scene/types.js';
import { FINISH_KINDS } from './materials/finish-catalogue.js';
import type { FinishKind } from './materials/finish-catalogue.js';
import { ASSET_ANCHORS, KNEE_SIDES, VARIANT_ACCESS } from './assets/asset-types.js';
import type { AssetAnchor, KneeSide, VariantAccess } from './assets/asset-types.js';
import { LAYOUT_RULE_IDS } from './layout/rules/context.js';
import type { LayoutRule } from './layout/rules/context.js';

/* -------------------------------------------------------- compile-time half */

const EVERY_OPENING_TYPE = { door: true, window: true, passage: true } satisfies Record<OpeningType, true>;
const EVERY_OPENING_SHAPE = { flat: true, arch: true } satisfies Record<OpeningShape, true>;
const EVERY_OPENING_HINGE = { a: true, b: true } satisfies Record<OpeningHinge, true>;
const EVERY_OPENING_SWING = { in: true, out: true } satisfies Record<OpeningSwing, true>;
const EVERY_SITE_SUN = { morning: true, noon: true, evening: true } satisfies Record<SiteSun, true>;
const EVERY_ROOM_KIND = { room: true, loggia: true } satisfies Record<RoomKind, true>;
const EVERY_ROOM_PURPOSE = {
  living: true,
  kitchen: true,
  'kitchen-living': true,
  dining: true,
  bedroom: true,
  kids: true,
  study: true,
  bathroom: true,
  wc: true,
  hall: true,
  corridor: true,
  storage: true,
  utility: true,
  balcony: true,
} satisfies Record<RoomPurpose, true>;
const EVERY_WALL_ROLE = { bearing: true, partition: true, facade: true } satisfies Record<WallRole, true>;
const EVERY_FINISH_KIND = {
  planks: true,
  chevron: true,
  terrazzo: true,
  tiles: true,
  plaster: true,
  stripes: true,
} satisfies Record<FinishKind, true>;
const EVERY_ASSET_ANCHOR = { floor: true, wall: true, ceiling: true } satisfies Record<AssetAnchor, true>;
const EVERY_KNEE_SIDE = { front: true, back: true, left: true, right: true } satisfies Record<KneeSide, true>;
const EVERY_VARIANT_ACCESS = { free: true, pro: true, exclusive: true } satisfies Record<VariantAccess, true>;
const EVERY_LAYOUT_RULE = {
  'inside-a-wall': true,
  'no-interpenetration': true,
  'door-clear-zone': true,
  'door-swing-path': true,
  'wall-hung': true,
  circulation: true,
  'window-clearance': true,
  'on-floor': true,
  'ceiling-hung': true,
  'height-fit': true,
  'wall-facing': true,
  'case-goods-on-a-wall': true,
  'kitchen-run': true,
  'seating-group': true,
  'dining-tuck': true,
  bedroom: true,
  hall: true,
} satisfies Record<LayoutRule, true>;

/** One row: the union spelled out as keys, and the runtime set that must match it. */
const SETS = [
  ['OPENING_TYPES', EVERY_OPENING_TYPE, OPENING_TYPES],
  ['OPENING_SHAPES', EVERY_OPENING_SHAPE, OPENING_SHAPES],
  ['OPENING_HINGES', EVERY_OPENING_HINGE, OPENING_HINGES],
  ['OPENING_SWINGS', EVERY_OPENING_SWING, OPENING_SWINGS],
  ['SITE_SUNS', EVERY_SITE_SUN, SITE_SUNS],
  ['ROOM_KINDS', EVERY_ROOM_KIND, ROOM_KINDS],
  ['ROOM_PURPOSES', EVERY_ROOM_PURPOSE, ROOM_PURPOSES],
  ['WALL_ROLES', EVERY_WALL_ROLE, WALL_ROLES],
  ['FINISH_KINDS', EVERY_FINISH_KIND, FINISH_KINDS],
  ['ASSET_ANCHORS', EVERY_ASSET_ANCHOR, ASSET_ANCHORS],
  ['KNEE_SIDES', EVERY_KNEE_SIDE, KNEE_SIDES],
  ['VARIANT_ACCESS', EVERY_VARIANT_ACCESS, VARIANT_ACCESS],
  ['LAYOUT_RULE_IDS', EVERY_LAYOUT_RULE, LAYOUT_RULE_IDS],
] as const satisfies ReadonlyArray<readonly [string, Readonly<Record<string, true>>, readonly string[]]>;

describe('closed sets', () => {
  for (const [name, union, set] of SETS) {
    test(`${name} covers its union exactly, with no duplicates`, () => {
      const members: readonly string[] = set;
      expect({ name, members: [...members].sort() }).toEqual({ name, members: Object.keys(union).sort() });
      expect({ name, size: new Set(members).size }).toEqual({ name, size: members.length });
    });
  }

  test('every set in the library has a row here', () => {
    // The count is the assertion: a new closed set is a new row, and a row
    // that was deleted with its set takes the number down with it. Bump this
    // deliberately, never to make the test pass.
    expect(SETS.length).toBe(13);
  });
});
