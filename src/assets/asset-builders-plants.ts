/**
 * Procedural builders for the four houseplant species of the starter bank,
 * each built to its own reference photograph: a Kentia palm, a bird of
 * paradise, a fiddle-leaf fig and a compact upright Strelitzia.
 *
 * See the conventions list in `asset-builders.ts` for the anchor and
 * orientation rules every builder here follows, and `plant-parts.ts` for the
 * organs they are assembled from.
 *
 * What separates these from the one archetype they replace - ten identical
 * straight stems each carrying one flat leaf, which the reference photographs
 * show is nothing any of these species looks like - is that a species here is
 * a SILHOUETTE: how many stalks, how hard they arch, how far the blades lean
 * out and droop, and what shape a blade of that species is. Each of those is a
 * named constant below, so the plant can be read against its photograph.
 *
 * Invariants:
 *  - every dimension is derived from the archetype's `dims` or from a named
 *    constant; no magic numbers reach the geometry;
 *  - every random draw comes from `makeRandom(seed)`, so one seed is always one
 *    plant, down to the transform of the first leaf;
 *  - the crown is grown at its own proportions and fitted to `dims`, so the
 *    declared box really is the box the plant occupies;
 *  - builders only ever take geometry from the shared cache and materials from
 *    the finish registry - they never create or dispose either.
 */

import * as THREE from 'three';
import { readOptions, type OptionSpec } from './asset-options.js';
import { makeRandom } from '../materials/texture-noise.js';
import type { BladeSpec, BuildKit, Builder } from './asset-kit.js';
import {
  arcPath,
  BladeBatch,
  fitCrown,
  foliageOf,
  mulchPebbles,
  paddleStalk,
  pathAt,
  pinnateFrond,
  potBasket,
  potClay,
  potGloss,
  potSphere,
  putPath,
  soilSurface,
  swayPath,
  STEM_NAME,
  toneFor,
  type Foliage,
} from './plant-parts.js';

/** Angle successive leaves of a cluster take around their branch, radians. */
const GOLDEN_ANGLE_RAD = 2.39996;
/** A unit-length upright stalk, scaled per mesh to a real leaf stalk. */
const UNIT_STALK: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [0, 1, 0],
];
/** Lengthwise and radial segments of a leaf stalk: it is a few centimetres long. */
const STALK_TUBULAR = 1;
const STALK_RADIAL = 4;
/** Control points a branch's arc is sampled at before it is swept. */
const BRANCH_SAMPLES = 4;

/** Draw from `random` inside `[low, high]`; every species' variation goes through it. */
const between = (random: () => number, low: number, high: number): number => low + (high - low) * random();

/**
 * Places one organ's own frame on the plant: spun to `azimuth` about the pot's
 * axis and leaning outward by `lean`.
 *
 * `YXZ` order is what makes that read as one sentence: the lean is applied in
 * the frame the azimuth has already turned, so the stalk leans OUTWARD in the
 * direction it faces rather than always toward +Z.
 */
function standOrgan(organ: THREE.Object3D, azimuth: number, lean: number, base: { x: number; y: number; z: number }): void {
  organ.position.set(base.x, base.y, base.z);
  organ.rotation.order = 'YXZ';
  organ.rotation.set(lean, azimuth, 0);
}

/* ------------------------------------------------------------ Kentia palm --- */

/** `buildKentia`. `canes` is the clump's size, `leaflets` the ranks per frond. */
const KENTIA_OPTIONS = {
  seed: { kind: 'number', default: 11, integer: true },
  canes: { kind: 'number', default: 9, min: 5, max: 12, integer: true },
  leaflets: { kind: 'number', default: 16, min: 8, max: 18, integer: true },
} as const satisfies Record<string, OptionSpec>;

/** Height of the basket, as a fraction of the plant's own height. */
const KENTIA_POT_HEIGHT = 0.19;
/**
 * Rim radius of the basket, as a fraction of the plant's own half-footprint -
 * a palm overhangs its basket by half of it again. Every species' pot radius
 * is that species' `layout.footprint` in `asset-library-plants.ts`: the pot IS
 * the footprint the layout linter is told about, and
 * `asset-builders-plants.test.ts` measures the built pot against it.
 */
const KENTIA_POT_RADIUS = 0.5;
/** How far a cane's foot scatters from the pot's axis, as a fraction of the basket radius. */
const KENTIA_FOOT_SCATTER = 0.45;
/** Radius of a cane where it leaves the soil, metres. */
const KENTIA_CANE_RADIUS = 0.011;
/** Range a frond's whole rachis arches through, radians - the shortest fronds arch hardest. */
const KENTIA_TURN = [0.24, 0.95] as const;
/** Range a cane leans out of the vertical at its foot, radians. */
const KENTIA_LEAN = [0.03, 0.16] as const;
/** Range of a rachis' length, as a fraction of the tallest cane's nominal length. */
const KENTIA_LENGTH = [0.62, 1] as const;
/** How much of the rachis is bare cane before the first leaflet. */
const KENTIA_BARE = [0.4, 0.54] as const;
/** Length of the longest leaflet, as a fraction of its own rachis. */
const KENTIA_LEAFLET = 0.21;
/** How far a leaflet leans toward the frond's tip, radians. */
const KENTIA_FORWARD = 0.5;
/** How far the apical leaflets fall below their frond's plane, as a fraction of their length. */
const KENTIA_DROOP = 1.1;
/** Rise of an arc as a fraction of its length, used to size the nominal rachis before the fit. */
const KENTIA_RISE = 0.95;

/**
 * Long, narrow, softly folded and pointed: one leaflet of a pinnate frond.
 *
 * Three ribs and one column per half - twelve triangles a leaflet - because a
 * frond carries thirty of them and the plant carries nine fronds. The droop is
 * in the leaflet's ORIENTATION, so three ribs are enough to bend it.
 */
const KENTIA_LEAFLET_BLADE: BladeSpec = {
  width: 0.075,
  waist: 0.4,
  blunt: 1.15,
  crease: 0.05,
  curl: 0.1,
  pinch: 0,
  wave: 0,
  rows: 3,
  cols: 1,
};

export const buildKentia: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { seed, canes, leaflets } = readOptions(asset.options, KENTIA_OPTIONS);
  const random = makeRandom(seed * 3571 + 11);
  const potHeight = height * KENTIA_POT_HEIGHT;
  const potRadius = (Math.min(width, depth) / 2) * KENTIA_POT_RADIUS;

  potBasket(group, kit, potRadius, potHeight);
  const soilTop = soilSurface(group, kit, 'soil', potRadius * 0.86, potHeight);

  const crown = new THREE.Group();
  const foliage = foliageOf(kit);
  const nominal = (height - soilTop) / KENTIA_RISE;
  for (let index = 0; index < canes; index += 1) {
    const azimuth = (index / canes) * Math.PI * 2 + between(random, -0.3, 0.3);
    const reach = between(random, KENTIA_LENGTH[0], KENTIA_LENGTH[1]);
    const length = nominal * reach;
    const frond = pinnateFrond(
      kit,
      {
        length,
        // The clump's tall central fronds stand up and its short outer ones
        // arch over, in a palm as in the reference photograph - so the arch is
        // read off the frond's own length rather than drawn independently.
        turn: KENTIA_TURN[1] - (KENTIA_TURN[1] - KENTIA_TURN[0]) * reach + between(random, -0.04, 0.04),
        radius: KENTIA_CANE_RADIUS,
        pairs: leaflets,
        from: between(random, KENTIA_BARE[0], KENTIA_BARE[1]),
        leaflet: length * KENTIA_LEAFLET,
        forward: KENTIA_FORWARD,
        droop: KENTIA_DROOP,
      },
      KENTIA_LEAFLET_BLADE,
      // One tone per frond: a new frond is lighter than the one below it.
      toneFor(foliage, index),
      random,
    );
    const scatter = potRadius * KENTIA_FOOT_SCATTER * random();
    standOrgan(frond, azimuth, KENTIA_LEAN[1] - (KENTIA_LEAN[1] - KENTIA_LEAN[0]) * reach, {
      x: Math.sin(azimuth) * scatter,
      y: soilTop,
      z: Math.cos(azimuth) * scatter,
    });
    crown.add(frond);
  }
  group.add(crown);
  fitCrown(crown, soilTop, height, width, depth);
  return group;
};

/* -------------------------------------------------------- bird of paradise --- */

/** `buildStrelitzia`. `leaves` is the fan's size; the paddles are its whole silhouette. */
const STRELITZIA_OPTIONS = {
  seed: { kind: 'number', default: 23, integer: true },
  leaves: { kind: 'number', default: 11, min: 6, max: 14, integer: true },
} as const satisfies Record<string, OptionSpec>;

/** Height of the cylinder pot, as a fraction of the plant's own height. */
const STRELITZIA_POT_HEIGHT = 0.22;
/** Rim radius of the pot, as a fraction of the plant's own half-footprint (see `KENTIA_POT_RADIUS`). */
const STRELITZIA_POT_RADIUS = 0.42;
/** Range a petiole leans out of the vertical, radians. */
const STRELITZIA_LEAN = [0.22, 0.62] as const;
/** Range a petiole arches through over its own length, radians. */
const STRELITZIA_TURN = [0.08, 0.34] as const;
/** Radius of a petiole at the base, metres. */
const STRELITZIA_PETIOLE_RADIUS = 0.014;
/** Length of a blade, as a fraction of the plant's height - 0.5 to 0.6 m at 1.6 m. */
const STRELITZIA_LEAF = [0.32, 0.375] as const;
/**
 * Range a blade is laid over past its petiole's own direction, radians. The top
 * of the range is most of a right angle, which is the two or three leaves the
 * reference photograph shows lying almost horizontal.
 */
const STRELITZIA_PITCH = [0.3, 1.35] as const;
/** Range of a petiole's length, as a fraction of the reach left under the blade. */
const STRELITZIA_STALK = [0.5, 1] as const;
/** How far a blade twists about its own growth axis, radians. */
const STRELITZIA_ROLL = 0.5;
/** How far a leaf's foot scatters from the pot's axis, as a fraction of the pot radius. */
const STRELITZIA_FOOT_SCATTER = 0.32;
/** Rise of a petiole plus its blade as a fraction of their run, before the fit. */
const STRELITZIA_RISE = 0.94;

/**
 * A large elliptic paddle: broad, bluntly rounded at the tip, folded softly
 * about its midrib and curling down over its outer third. `blunt` below 1 is
 * what holds it broad to the shoulder instead of tapering it into a kite.
 */
const STRELITZIA_BLADE: BladeSpec = {
  width: 0.25,
  waist: 0.52,
  blunt: 0.52,
  crease: 0.06,
  curl: 0.13,
  pinch: 0.03,
  wave: 0.03,
  rows: 9,
  cols: 4,
};

export const buildStrelitzia: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { seed, leaves } = readOptions(asset.options, STRELITZIA_OPTIONS);
  const random = makeRandom(seed * 3571 + 11);
  const potHeight = height * STRELITZIA_POT_HEIGHT;
  const potRadius = (Math.min(width, depth) / 2) * STRELITZIA_POT_RADIUS;

  potGloss(group, kit, potRadius, potHeight);
  const soilTop = soilSurface(group, kit, 'soil', potRadius * 0.84, potHeight);

  const crown = new THREE.Group();
  const foliage = foliageOf(kit);
  for (let index = 0; index < leaves; index += 1) {
    const azimuth = (index / leaves) * Math.PI * 2 + between(random, -0.24, 0.24);
    const leaf = height * between(random, STRELITZIA_LEAF[0], STRELITZIA_LEAF[1]);
    const reach = (height - soilTop) / STRELITZIA_RISE - leaf;
    const stalk = paddleStalk(kit, STRELITZIA_BLADE, toneFor(foliage, index), {
      length: reach * between(random, STRELITZIA_STALK[0], STRELITZIA_STALK[1]),
      turn: between(random, STRELITZIA_TURN[0], STRELITZIA_TURN[1]),
      radius: STRELITZIA_PETIOLE_RADIUS,
      leaf,
      pitch: between(random, STRELITZIA_PITCH[0], STRELITZIA_PITCH[1]),
      roll: between(random, -STRELITZIA_ROLL, STRELITZIA_ROLL),
    });
    const scatter = potRadius * STRELITZIA_FOOT_SCATTER * random();
    standOrgan(stalk, azimuth, between(random, STRELITZIA_LEAN[0], STRELITZIA_LEAN[1]), {
      x: Math.sin(azimuth) * scatter,
      y: soilTop,
      z: Math.cos(azimuth) * scatter,
    });
    crown.add(stalk);
  }
  group.add(crown);
  fitCrown(crown, soilTop, height, width, depth);
  return group;
};

/* --------------------------------------------------------- fiddle-leaf fig --- */

/** `buildFicusLyrata`. `leaves` is the whole crown, spread over `branches` ends. */
const FICUS_OPTIONS = {
  seed: { kind: 'number', default: 37, integer: true },
  leaves: { kind: 'number', default: 40, min: 18, max: 46, integer: true },
  branches: { kind: 'number', default: 4, min: 2, max: 5, integer: true },
} as const satisfies Record<string, OptionSpec>;

/** Height of the clay planter, as a fraction of the plant's own height. */
const FICUS_POT_HEIGHT = 0.21;
/** Rim radius of the planter, as a fraction of the plant's own half-footprint (see `KENTIA_POT_RADIUS`). */
const FICUS_POT_RADIUS = 0.62;
/** How much of the rise above the soil is bare trunk before the first branch. */
const FICUS_TRUNK = 0.52;
/** How far the trunk's S-lean swings out, as a fraction of the trunk's own length. */
const FICUS_SWAY = [0.07, 0.13] as const;
/** Radius of the trunk at the soil, metres - 40 mm across the base of a 1.7 m tree. */
const FICUS_TRUNK_RADIUS = 0.023;
/** Lengthwise segments of the trunk sweep: an S needs more than a straight cane. */
const FICUS_TRUNK_TUBULAR = 12;
/** Radius of a branch where it leaves the trunk, metres. */
const FICUS_BRANCH_RADIUS = 0.013;
/** Range a branch arches through over its own length, radians. */
const FICUS_BRANCH_TURN = [0.2, 0.48] as const;
/** Range a branch leaves the trunk at, out of the trunk's own direction, radians. */
const FICUS_BRANCH_LEAN = [0.14, 0.4] as const;
/** Range of a branch's length, as a fraction of the rise left above the trunk. */
const FICUS_BRANCH_LENGTH = [0.5, 0.85] as const;
/** Where along a branch its leaves begin, as a fraction of its length: they cluster at the end. */
const FICUS_CLUSTER_FROM = 0.3;
/** Where the lowest branch forks off the trunk, as a fraction of the trunk's length. */
const FICUS_FORK_FROM = 0.58;
/** Length of a leaf, as a fraction of the plant's height - 0.25 to 0.32 m at 1.7 m. */
const FICUS_LEAF = [0.17, 0.21] as const;
/** Range a leaf leans out of its branch's own direction, radians. */
const FICUS_LEAF_LEAN = [0.4, 0.95] as const;
/** Length of a leaf's stalk, as a fraction of the leaf itself. */
const FICUS_PETIOLE = 0.2;
/** Radius of a leaf's stalk, metres. */
const FICUS_PETIOLE_RADIUS = 0.0075;
/** Rise of the trunk-and-branch run as a fraction of its length, before the fit. */
const FICUS_RISE = 0.86;

/**
 * A lyrate blade: pinched at the waist, broad and bluntly rounded over the
 * outer lobes, edge in shallow waves. That outline plus the midrib crease is
 * the whole reason a fig is recognisable from across a room.
 */
const FICUS_BLADE: BladeSpec = {
  width: 0.36,
  waist: 0.62,
  blunt: 0.72,
  crease: 0.045,
  curl: 0.1,
  pinch: 0.24,
  wave: 0.07,
  rows: 7,
  cols: 3,
};

/**
 * The leaves of one branch, clustered over its last stretch and turned out of
 * the branch's own line - which is what makes a fig read as a small tree
 * rather than as a bottle brush.
 *
 * Successive leaves take the golden angle around the branch instead of lying in
 * one plane: that is what a real phyllotaxis does, and over a count this small
 * it never repeats a direction.
 */
function clusterLeaves(
  branch: THREE.Object3D,
  kit: BuildKit,
  spec: { path: ReadonlyArray<readonly [number, number, number]>; count: number; leaf: number },
  foliage: Foliage,
  firstTone: number,
  random: () => number,
): void {
  const geometry = kit.blade(FICUS_BLADE);
  const bark = kit.finish('bark');
  const stalkGeometry = kit.tube(UNIT_STALK, FICUS_PETIOLE_RADIUS, STALK_TUBULAR, STALK_RADIAL);
  // One batch per tone plus one for the stalks: three buffers for a whole
  // branch instead of two meshes per leaf (see `BladeBatch`).
  const tones = [new BladeBatch(), new BladeBatch()];
  const stalks = new BladeBatch();
  for (let index = 0; index < spec.count; index += 1) {
    const along = FICUS_CLUSTER_FROM + ((1 - FICUS_CLUSTER_FROM) * index) / Math.max(1, spec.count - 1);
    const roll = index * GOLDEN_ANGLE_RAD + between(random, -0.3, 0.3);
    const { point: foot, tangent } = pathAt(spec.path, along);
    // The branch's own side direction at this leaf, rolled around the branch.
    const side = new THREE.Vector3(Math.cos(roll), 0, Math.sin(roll));
    side.addScaledVector(tangent, -side.dot(tangent));
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, tangent).normalize();
    const lean = between(random, FICUS_LEAF_LEAN[0], FICUS_LEAF_LEAN[1]);
    const direction = new THREE.Vector3().addScaledVector(tangent, Math.cos(lean)).addScaledVector(side, Math.sin(lean)).normalize();
    const leaf = spec.leaf * between(random, 0.82, 1);
    stalks.add(stalkGeometry, foot, direction, up, leaf * FICUS_PETIOLE);
    const base = foot.clone().addScaledVector(direction, leaf * FICUS_PETIOLE);
    tones[(firstTone + index) % 2]!.add(geometry, base, direction, up, leaf);
  }
  stalks.flush(branch, kit, bark, STEM_NAME);
  tones[0]!.flush(branch, kit, toneFor(foliage, 0));
  tones[1]!.flush(branch, kit, toneFor(foliage, 1));
}

export const buildFicusLyrata: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { seed, leaves, branches } = readOptions(asset.options, FICUS_OPTIONS);
  const random = makeRandom(seed * 3571 + 11);
  const potHeight = height * FICUS_POT_HEIGHT;
  const potRadius = (Math.min(width, depth) / 2) * FICUS_POT_RADIUS;

  potClay(group, kit, potRadius, potHeight);
  const soilTop = soilSurface(group, kit, 'soil', potRadius * 0.86, potHeight);
  mulchPebbles(group, kit, 'soil', potRadius * 0.8, soilTop, random);

  const crown = new THREE.Group();
  const foliage = foliageOf(kit);
  const run = (height - soilTop) / FICUS_RISE;
  const trunkLength = run * FICUS_TRUNK;
  const trunkPath = swayPath(trunkLength, trunkLength * between(random, FICUS_SWAY[0], FICUS_SWAY[1]));
  const trunk = new THREE.Group();
  putPath(trunk, kit, trunkPath, FICUS_TRUNK_RADIUS, 'bark', FICUS_TRUNK_TUBULAR);
  standOrgan(trunk, between(random, 0, Math.PI * 2), 0, { x: 0, y: soilTop, z: 0 });
  crown.add(trunk);

  const perBranch = Math.max(1, Math.round(leaves / branches));
  for (let index = 0; index < branches; index += 1) {
    const branch = new THREE.Group();
    const along = FICUS_FORK_FROM + (index / branches) * (1 - FICUS_FORK_FROM);
    const length = (run - trunkLength) * between(random, FICUS_BRANCH_LENGTH[0], FICUS_BRANCH_LENGTH[1]);
    const turn = between(random, FICUS_BRANCH_TURN[0], FICUS_BRANCH_TURN[1]);
    const branchPath = arcPath(length, turn, BRANCH_SAMPLES);
    putPath(branch, kit, branchPath, FICUS_BRANCH_RADIUS, 'bark');
    clusterLeaves(
      branch,
      kit,
      { path: branchPath, count: perBranch, leaf: height * between(random, FICUS_LEAF[0], FICUS_LEAF[1]) },
      foliage,
      index * perBranch,
      random,
    );
    const { point: fork, tangent } = pathAt(trunkPath, along);
    // The branch leaves the trunk along the angle the trunk is already going,
    // plus its own spread: a branch that starts vertical reads as a second trunk.
    const lean = Math.atan2(tangent.z, tangent.y) + between(random, FICUS_BRANCH_LEAN[0], FICUS_BRANCH_LEAN[1]);
    standOrgan(branch, (index / branches) * Math.PI * 2 + between(random, -0.4, 0.4), lean, fork);
    trunk.add(branch);
  }
  group.add(crown);
  fitCrown(crown, soilTop, height, width, depth);
  return group;
};

/* ---------------------------------------------------- compact Strelitzia --- */

/** `buildStrelitziaWhite`. The upright rosette of the fourth reference photograph. */
const WHITE_OPTIONS = {
  seed: { kind: 'number', default: 53, integer: true },
  leaves: { kind: 'number', default: 9, min: 5, max: 11, integer: true },
} as const satisfies Record<string, OptionSpec>;

/** Height of the sphere planter, as a fraction of the plant's own height. */
const WHITE_POT_HEIGHT = 0.33;
/** Radius of the sphere, as a fraction of the plant's own half-footprint (see `KENTIA_POT_RADIUS`). */
const WHITE_POT_RADIUS = 0.86;
/** Range a petiole leans out of the vertical, radians - this one stands up. */
const WHITE_LEAN = [0.02, 0.22] as const;
/** Range a petiole arches through over its own length, radians. */
const WHITE_TURN = [0.04, 0.26] as const;
/** Radius of a petiole at the base, metres. */
const WHITE_PETIOLE_RADIUS = 0.012;
/** Length of a blade, as a fraction of the rise above the mulch - 0.5 to 0.6 m at 1.4 m. */
const WHITE_LEAF = [0.5, 0.64] as const;
/** Range a blade is laid over past its petiole's own direction, radians. */
const WHITE_PITCH = [0.02, 0.26] as const;
/**
 * How far a leaf of the fan wanders out of the fan's own plane, radians.
 *
 * This one does NOT stand in a ring: photograph 4 is a young Strelitzia, whose
 * leaves come up in one plane like a banana plant's, and spreading them over a
 * full circle is what turned it into a bunch of tulips. Successive leaves face
 * opposite ends of that plane, so the fan opens left and right and stays
 * centred over its pot rather than all leaning the same way.
 */
const WHITE_FAN = 0.3;
/** How far a leaf's foot scatters from the pot's axis, as a fraction of the top opening. */
const WHITE_FOOT_SCATTER = 0.55;
/** Rise of a petiole plus its blade as a fraction of their run, before the fit. */
const WHITE_RISE = 0.98;

/** A broad upright paddle, rounded at the tip and softly folded: a young Strelitzia's leaf. */
const WHITE_BLADE: BladeSpec = {
  width: 0.24,
  waist: 0.5,
  blunt: 0.48,
  crease: 0.07,
  curl: 0.08,
  pinch: 0.02,
  wave: 0.02,
  rows: 8,
  cols: 3,
};

export const buildStrelitziaWhite: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { seed, leaves } = readOptions(asset.options, WHITE_OPTIONS);
  const random = makeRandom(seed * 3571 + 11);
  const potHeight = height * WHITE_POT_HEIGHT;
  const potRadius = (Math.min(width, depth) / 2) * WHITE_POT_RADIUS;

  potSphere(group, kit, potRadius, potHeight);
  const mouth = Math.sqrt(Math.max(0, potRadius * potRadius - (potHeight - potRadius) ** 2));
  const soilTop = soilSurface(group, kit, 'soil', mouth * 0.96, potHeight);
  mulchPebbles(group, kit, 'soil', mouth * 0.7, soilTop, random);

  const crown = new THREE.Group();
  const foliage = foliageOf(kit);
  const run = (height - soilTop) / WHITE_RISE;
  for (let index = 0; index < leaves; index += 1) {
    // Alternating ends of the fan, outwards from the middle, so the tallest
    // leaves stand in the centre of it and the shortest lean furthest out.
    const rank = Math.ceil(index / 2) / Math.max(1, Math.ceil((leaves - 1) / 2));
    const side = index % 2 === 0 ? 1 : -1;
    const azimuth = side * (Math.PI / 2 + between(random, -WHITE_FAN, WHITE_FAN));
    const leaf = run * between(random, WHITE_LEAF[0], WHITE_LEAF[1]);
    const stalk = paddleStalk(kit, WHITE_BLADE, toneFor(foliage, index), {
      length: run - leaf,
      turn: between(random, WHITE_TURN[0], WHITE_TURN[1]),
      radius: WHITE_PETIOLE_RADIUS,
      leaf,
      pitch: between(random, WHITE_PITCH[0], WHITE_PITCH[1]),
      roll: between(random, -0.2, 0.2),
    });
    const scatter = mouth * WHITE_FOOT_SCATTER * random();
    standOrgan(stalk, azimuth, between(random, WHITE_LEAN[0], WHITE_LEAN[1]) * (1 + rank), {
      x: Math.sin(azimuth) * scatter,
      y: soilTop,
      z: Math.cos(azimuth) * scatter,
    });
    crown.add(stalk);
  }
  group.add(crown);
  fitCrown(crown, soilTop, height, width, depth);
  return group;
};
