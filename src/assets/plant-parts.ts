/**
 * The parts the four houseplant species are assembled from: their pots, their
 * soil, and the stems, blades and fronds their crowns are grown out of.
 *
 * Every organ is built in ITS OWN frame - base at the origin, rising along +Y,
 * arching toward +Z - and the species builder only decides where that frame
 * sits and which way it faces. That is what keeps the trigonometry in one place
 * instead of once per leaf, and why a leaf's droop is a named amount in the
 * frond's own frame rather than three Euler angles nobody can read.
 *
 * Invariants:
 *  - every dimension is a named constant or a parameter, and every random draw
 *    comes from the caller's seeded stream, so one seed is always one plant;
 *  - a blade is a surface with no thickness, so it always takes `finishDouble`
 *    and is named `BLADE_NAME` - `asset-builders-plants.test.ts` reads the
 *    crown back by that name;
 *  - parts only ever take geometry from the shared cache and materials from the
 *    finish registry: they never create or dispose either.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { put, type BladeSpec, type BuildKit } from './asset-kit.js';

/** Mesh name every leaf blade carries, so a test can find the crown. */
export const BLADE_NAME = 'blade';
/** Mesh name every part of a pot carries, soil and mulch excluded. */
export const POT_NAME = 'pot';
/** Mesh name of the soil or mulch surface the crown grows out of. */
export const SOIL_NAME = 'soil';
/** Mesh name of a stalk: a cane, a petiole, a rachis, a trunk, a branch. */
export const STEM_NAME = 'stem';
/** Name of the group holding everything above the soil, which `fitCrown` sizes. */
export const CROWN_NAME = 'crown';

/** Smallest arc a stem may turn through before it is treated as a straight stalk. */
const STRAIGHT_TURN_RAD = 1e-3;
/** Reference direction used to orient a blade whose growth axis is vertical. */
const FALLBACK_FACE = new THREE.Vector3(0, 0, 1);

const SCRATCH_POINT = new THREE.Vector3();
const SCRATCH_TANGENT = new THREE.Vector3();
const SCRATCH_SIDE = new THREE.Vector3();
const SCRATCH_UP = new THREE.Vector3();
const SCRATCH_DIRECTION = new THREE.Vector3();
const SCRATCH_BASIS = new THREE.Matrix4();
const SCRATCH_X = new THREE.Vector3();
const SCRATCH_Z = new THREE.Vector3();
/** Transform carrier for a blade that is baked into a batch rather than made a mesh. */
const SCRATCH_PIVOT = new THREE.Object3D();

/**
 * The two tones a crown alternates between.
 *
 * A canopy finished in one green reads as a single plastic moulding however
 * good the silhouette is, so every builder takes each leaf's material from
 * here by the leaf's own index. `deep` rides the `accent` slot - the bank's
 * established "second tone of the same object" slot, as on a rug - so a
 * catalogue variant can re-tone both halves of the crown.
 */
export type Foliage = { readonly green: THREE.Material; readonly deep: THREE.Material };

export function foliageOf(kit: BuildKit): Foliage {
  return { green: kit.finishDouble('foliage'), deep: kit.finishDouble('accent') };
}

/** The tone leaf `index` takes; alternating by index, never at random. */
export function toneFor(foliage: Foliage, index: number): THREE.Material {
  return index % 2 === 0 ? foliage.green : foliage.deep;
}

/* ------------------------------------------------------------- arc stems --- */

/**
 * Point on a stem `length` metres long that turns through `turn` radians, at
 * `fraction` of its arc. The stem starts at the origin rising along +Y and
 * arches toward +Z, so `turn = 0` is a straight stalk and `turn = 1.4` a palm
 * frond's rachis.
 */
function arcPoint(length: number, turn: number, fraction: number, out: THREE.Vector3): THREE.Vector3 {
  if (Math.abs(turn) < STRAIGHT_TURN_RAD) return out.set(0, length * fraction, 0);
  const radius = length / turn;
  const angle = turn * fraction;
  return out.set(0, radius * Math.sin(angle), radius * (1 - Math.cos(angle)));
}

/** Unit tangent of that stem at `fraction` of its arc - the way it is growing there. */
function arcTangent(turn: number, fraction: number, out: THREE.Vector3): THREE.Vector3 {
  const angle = turn * fraction;
  return out.set(0, Math.cos(angle), Math.sin(angle));
}

/** The stem's arc as tube control points, in its own frame. */
export function arcPath(length: number, turn: number, samples: number): Array<readonly [number, number, number]> {
  const points: Array<readonly [number, number, number]> = [];
  for (let step = 0; step <= samples; step += 1) {
    const point = arcPoint(length, turn, step / samples, SCRATCH_POINT);
    points.push([point.x, point.y, point.z]);
  }
  return points;
}

/**
 * Orients `object` so its own +Y runs along `direction` and its own +Z - a
 * blade's face, a frond's upper side - leans toward `faceUp`.
 *
 * An explicit basis, not `setFromUnitVectors`: the shortest rotation between
 * two vectors leaves the roll about the growth axis to chance, and a crown of
 * leaves whose faces point at random angles is exactly the "plastic sticks"
 * look this whole module exists to replace.
 */
function aimAlong(object: THREE.Object3D, direction: THREE.Vector3, faceUp: THREE.Vector3): void {
  const growth = SCRATCH_DIRECTION.copy(direction).normalize();
  SCRATCH_Z.copy(faceUp).addScaledVector(growth, -faceUp.dot(growth));
  if (SCRATCH_Z.lengthSq() < 1e-8) SCRATCH_Z.copy(FALLBACK_FACE).addScaledVector(growth, -FALLBACK_FACE.dot(growth));
  SCRATCH_Z.normalize();
  SCRATCH_X.crossVectors(growth, SCRATCH_Z);
  SCRATCH_BASIS.makeBasis(SCRATCH_X, growth, SCRATCH_Z);
  object.quaternion.setFromRotationMatrix(SCRATCH_BASIS);
}

/**
 * A batch of same-material blades, merged into ONE buffer with their
 * transforms baked in.
 *
 * A palm frond carries thirty leaflets and a palm nine fronds: as separate
 * meshes that is three hundred draw calls and three hundred matrix updates for
 * one plant, and the twenty mount/dispose cycles of `tests/e2e/leaks.spec.ts`
 * measure exactly that - the demo went from 1170 meshes to 1814 and the test
 * from comfortable to 95 % of its timeout. The blades of one frond share one
 * unit geometry and one tone, so they are one buffer.
 *
 * The merged buffer is NOT cached geometry: it is unique to this build, which
 * is why it is registered with `kit.ownDispose` rather than left to the
 * `GeometryCache` that owns everything else a builder draws from.
 */
export class BladeBatch {
  private readonly parts: THREE.BufferGeometry[] = [];

  /** One blade, positioned and oriented like `growBlade` but not yet a mesh. */
  add(
    geometry: THREE.BufferGeometry,
    base: THREE.Vector3,
    direction: THREE.Vector3,
    faceUp: THREE.Vector3,
    length: number,
    roll = 0,
  ): void {
    SCRATCH_PIVOT.position.copy(base);
    SCRATCH_PIVOT.scale.setScalar(length);
    aimAlong(SCRATCH_PIVOT, direction, faceUp);
    if (roll !== 0) SCRATCH_PIVOT.rotateY(roll);
    SCRATCH_PIVOT.updateMatrix();
    const part = geometry.clone();
    part.applyMatrix4(SCRATCH_PIVOT.matrix);
    this.parts.push(part);
  }

  /** The batch as one mesh under `parent`; `null` when nothing was added. */
  flush(parent: THREE.Object3D, kit: BuildKit, material: THREE.Material, name = BLADE_NAME): THREE.Mesh | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts);
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    if (!merged) return null;
    kit.ownDispose(() => merged.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  }
}

/**
 * One blade grown from `base` along `direction`, with its face turned toward
 * `faceUp` and its shared unit geometry scaled to `length`.
 *
 * For a species whose blades are few and each its own tone; a crown of hundreds
 * goes through `BladeBatch` instead.
 */
function growBlade(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  base: THREE.Vector3,
  direction: THREE.Vector3,
  faceUp: THREE.Vector3,
  length: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = BLADE_NAME;
  mesh.position.copy(base);
  aimAlong(mesh, direction, faceUp);
  mesh.scale.setScalar(length);
  parent.add(mesh);
  return mesh;
}

/* ---------------------------------------------------------------- fronds --- */

/** How many control points a stem's arc is sampled at; four is smooth at these radii. */
const STEM_SAMPLES = 4;
/** Radial and lengthwise segments of a stalk sweep - the crown's triangle budget lives here. */
const STEM_TUBULAR = 8;
const STEM_RADIAL = 5;
/** How thin a stalk gets at its tip, as a fraction of its base radius. */
const STEM_TAPER = 0.55;

/**
 * One stalk sweeping along its own arc, rooted at its frame's origin: the
 * cane of a palm, a petiole, a branch. Named and tapered, so a species builder
 * never repeats the segment counts.
 */
function putStem(parent: THREE.Object3D, kit: BuildKit, length: number, turn: number, radius: number, slot = 'foliage'): THREE.Mesh {
  return putPath(parent, kit, arcPath(length, turn, STEM_SAMPLES), radius, slot);
}

/** The same stalk along a path the caller built itself - a trunk's S-lean. */
export function putPath(
  parent: THREE.Object3D,
  kit: BuildKit,
  path: ReadonlyArray<readonly [number, number, number]>,
  radius: number,
  slot = 'foliage',
  tubular = STEM_TUBULAR,
): THREE.Mesh {
  const mesh = new THREE.Mesh(kit.tube(path, radius, tubular, STEM_RADIAL, STEM_TAPER), kit.finish(slot));
  mesh.name = STEM_NAME;
  parent.add(mesh);
  return mesh;
}

/**
 * Points of a trunk that leans one way and then back - the S a fig grows into
 * when it has been turned toward a window every few weeks. `sway` is the
 * furthest it leans, metres.
 */
export function swayPath(length: number, sway: number): Array<readonly [number, number, number]> {
  return [
    [0, 0, 0],
    [0, length * 0.34, sway],
    [0, length * 0.68, sway * 0.2],
    [0, length, sway * 0.85],
  ];
}

/** Point and unit tangent at `fraction` along a path `putPath` was given. */
export function pathAt(
  path: ReadonlyArray<readonly [number, number, number]>,
  fraction: number,
): { point: THREE.Vector3; tangent: THREE.Vector3 } {
  const curve = new THREE.CatmullRomCurve3(path.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return { point: curve.getPointAt(fraction), tangent: curve.getTangentAt(fraction).normalize() };
}

export type FrondSpec = {
  /** Arc length of the rachis, metres. */
  length: number;
  /** Total angle the rachis arches through, radians. */
  turn: number;
  /** Radius of the rachis at the cane, metres. */
  radius: number;
  /** Leaflets per side. */
  pairs: number;
  /** Where along the rachis the first leaflet sits, as a fraction of its length. */
  from: number;
  /** Length of the longest leaflet, metres. */
  leaflet: number;
  /** How far a leaflet leans toward the rachis tip, radians. */
  forward: number;
  /** How far the APICAL leaflets fall below the frond's plane, as a fraction of their length. */
  droop: number;
  /** Radius of the cane where it leaves the soil, metres. */
  cane?: number;
};

/** Shortest leaflet of a frond, as a fraction of the longest. */
const LEAFLET_SHORTEST = 0.42;
/** How much of a leaflet's length the seeded stream may add or take away. */
const LEAFLET_JITTER = 0.14;
/** Where along the leaflet band the longest leaflets sit, as a fraction of the band. */
const LEAFLET_PEAK = 0.42;
/** How much of its full droop the FIRST leaflet of a frond takes. */
const LEAFLET_DROOP_FROM = 0.3;

/**
 * One pinnate frond - the arching rachis of a Kentia palm and its two ranks of
 * drooping leaflets - in its own frame.
 *
 * The leaflets of a pair are offset by half a step along the rachis, so the
 * ranks alternate the way a real frond's do instead of standing in facing
 * pairs. One `tone` for the whole frond, because that is how a palm's greens
 * actually differ: a new frond is lighter than the one below it, and mixing
 * the two tones WITHIN a frond only makes it look dusty.
 */
export function pinnateFrond(kit: BuildKit, spec: FrondSpec, blade: BladeSpec, tone: THREE.Material, random: () => number): THREE.Group {
  const frond = new THREE.Group();
  putStem(frond, kit, spec.length, spec.turn, spec.cane ?? spec.radius);
  const geometry = kit.blade(blade);
  const batch = new BladeBatch();
  const step = (1 - spec.from) / Math.max(1, spec.pairs);
  for (let pair = 0; pair < spec.pairs; pair += 1) {
    for (const side of [1, -1]) {
      // Half a step of offset per rank: facing pairs read as a fishbone.
      const along = Math.min(1, spec.from + step * (pair + (side === 1 ? 0.25 : 0.75)));
      const band = (along - spec.from) / Math.max(1e-6, 1 - spec.from);
      const taper = LEAFLET_SHORTEST + (1 - LEAFLET_SHORTEST) * Math.sin(Math.PI * Math.pow(band, Math.log(0.5) / Math.log(LEAFLET_PEAK)));
      const length = spec.leaflet * taper * (1 + (random() - 0.5) * LEAFLET_JITTER);
      // The droop deepens along the rachis: the leaflets by the cane stand out
      // sideways, the apical ones hang - which is the whole silhouette of an
      // arching frond, and what a single droop for the frond flattens away.
      const droop = spec.droop * (LEAFLET_DROOP_FROM + (1 - LEAFLET_DROOP_FROM) * band);
      const base = arcPoint(spec.length, spec.turn, along, SCRATCH_POINT);
      const tangent = arcTangent(spec.turn, along, SCRATCH_TANGENT);
      SCRATCH_SIDE.set(side, 0, 0);
      // The frond's own upper side, so a leaflet droops away from the light.
      const up = SCRATCH_UP.crossVectors(SCRATCH_SIDE, tangent).normalize();
      const direction = new THREE.Vector3()
        .addScaledVector(SCRATCH_SIDE, Math.cos(spec.forward))
        .addScaledVector(tangent, Math.sin(spec.forward))
        .addScaledVector(up, -droop);
      batch.add(geometry, base, direction, up, length);
    }
  }
  batch.flush(frond, kit, tone);
  return frond;
}

/**
 * One stalk with a single blade on its tip - a Strelitzia petiole and its
 * paddle - in its own frame. `pitch` is how far the blade continues past the
 * petiole's own direction: positive lays the paddle over, negative lifts it.
 */
export function paddleStalk(
  kit: BuildKit,
  blade: BladeSpec,
  tone: THREE.Material,
  spec: { length: number; turn: number; radius: number; leaf: number; pitch: number; roll: number },
): THREE.Group {
  const stalk = new THREE.Group();
  putStem(stalk, kit, spec.length, spec.turn, spec.radius);
  const base = arcPoint(spec.length, spec.turn, 1, SCRATCH_POINT);
  const tangent = arcTangent(spec.turn, 1, SCRATCH_TANGENT);
  SCRATCH_SIDE.set(1, 0, 0);
  const up = SCRATCH_UP.crossVectors(SCRATCH_SIDE, tangent).normalize();
  const direction = new THREE.Vector3().addScaledVector(tangent, Math.cos(spec.pitch)).addScaledVector(up, -Math.sin(spec.pitch));
  const paddle = growBlade(stalk, kit.blade(blade), tone, base, direction, up, spec.leaf);
  // A twist about the blade's own growth axis: a fan of paddles all presenting
  // the same face is a cardboard cut-out.
  paddle.rotateY(spec.roll);
  return stalk;
}

/* ------------------------------------------------------------------ pots --- */

/** Radial segments of a turned pot: 18 is round at 0.5 m across and cheap. */
const POT_SEGMENTS = 18;
/** Segments of the soil or mulch disc that caps a pot. */
const SOIL_SEGMENTS = 16;
/** How thick the visible soil surface is, metres. */
const SOIL_THICKNESS = 0.022;
/** How far below the rim the soil surface sits, metres. */
const SOIL_DROP = 0.03;

/**
 * The soil or mulch surface, and the height its top sits at.
 *
 * Returned rather than assumed, because every builder needs it twice: once to
 * start its stems from and once as the line every blade must stay above.
 */
export function soilSurface(group: THREE.Group, kit: BuildKit, slot: string, radius: number, rim: number): number {
  const top = rim - SOIL_DROP;
  put(group, kit.cylinder(radius, radius, SOIL_THICKNESS, SOIL_SEGMENTS), kit.finish(slot), { y: top - SOIL_THICKNESS / 2 }).name =
    SOIL_NAME;
  return top;
}

function turnPot(group: THREE.Group, kit: BuildKit, profile: ReadonlyArray<readonly [number, number]>): void {
  put(group, kit.lathe(profile, POT_SEGMENTS), kit.finish('ceramic'), {}).name = POT_NAME;
}

/** How many rope courses a woven basket is built from. */
const BASKET_COURSES = 4;
/** How far a course stands out of the weave, as a fraction of the rim radius. */
const BASKET_RELIEF = 0.045;
/** Radius at the floor, as a fraction of the rim radius: a basket sits in slightly. */
const BASKET_FOOT = 0.82;
/** Radius of a rim handle, as a fraction of the rim radius. */
const BASKET_HANDLE = 0.17;
/** Tube radius of a rim handle, metres. */
const BASKET_HANDLE_TUBE = 0.012;
/** Tubular segments of a rim handle - a half torus, so eight reads as a loop. */
const BASKET_HANDLE_SEGMENTS = 8;

/**
 * Woven basket: a turned body whose profile steps in and out once per rope
 * course, a rolled rim, and the two small handles the reference basket carries.
 *
 * The relief is in the PROFILE rather than in stacked torus rings: a ring per
 * course costs six times the triangles for the same silhouette, and the whole
 * crown above it has to fit in the same 5 000.
 */
export function potBasket(group: THREE.Group, kit: BuildKit, radius: number, height: number): void {
  const profile: Array<readonly [number, number]> = [
    [0, 0],
    [radius * BASKET_FOOT * 0.92, 0],
  ];
  for (let course = 0; course <= BASKET_COURSES; course += 1) {
    const along = course / BASKET_COURSES;
    const waist = radius * (BASKET_FOOT + (1 - BASKET_FOOT) * along);
    const relief = course % 2 === 0 ? -BASKET_RELIEF : BASKET_RELIEF;
    profile.push([waist * (1 + relief), height * along]);
    if (course < BASKET_COURSES) profile.push([waist * (1 - relief * 0.6), height * (along + 0.5 / BASKET_COURSES)]);
  }
  profile.push([radius * 0.94, height], [radius * 0.88, height - SOIL_DROP * 0.6]);
  turnPot(group, kit, profile);
  const handle = kit.torus(radius * BASKET_HANDLE, BASKET_HANDLE_TUBE, BASKET_HANDLE_SEGMENTS, Math.PI);
  for (const side of [1, -1]) {
    put(group, handle, kit.finish('ceramic'), {
      x: side * radius * 0.93,
      y: height - radius * BASKET_HANDLE * 0.5,
      ry: Math.PI / 2,
    }).name = POT_NAME;
  }
}

/** How far a glossy pot's lip flares past its body, as a fraction of the body. */
const GLOSS_LIP = 0.035;
/** How much the foot of a glossy cylinder is drawn in, as a fraction of its body. */
const GLOSS_FOOT = 0.9;

/**
 * Glossy ceramic cylinder with a soft lip rolled outward - the reference pot of
 * photograph 2, which is straight-sided and not the bellied urn a turned
 * profile falls into by default.
 *
 * The LIP is the widest ring, not the body, so the body is sized down by the
 * flare: the pot has to fit the footprint its archetype declares, and the
 * widest thing on it is what gets measured.
 */
export function potGloss(group: THREE.Group, kit: BuildKit, radius: number, height: number): void {
  const body = radius / (1 + GLOSS_LIP);
  turnPot(group, kit, [
    [0, 0],
    [body * GLOSS_FOOT, 0],
    [body * (GLOSS_FOOT + 0.03), height * 0.03],
    [body * 0.99, height * 0.16],
    [body, height * 0.88],
    [radius, height * 0.965],
    [radius * 0.97, height],
    [body * 0.9, height - SOIL_DROP * 0.7],
  ]);
}

/**
 * Matte clay planter: a hand-thrown silhouette - slight belly, thick rolled
 * lip - and no rim decoration.
 *
 * A lathe is a solid of revolution, so it cannot be uneven around its rim; the
 * six lobes that first stood in for the reference pot's wavy lip read as beads
 * stuck to the edge, which is worse than a plain lip. The unevenness is in the
 * PROFILE instead, where a lathe can carry it.
 */
export function potClay(group: THREE.Group, kit: BuildKit, radius: number, height: number): void {
  turnPot(group, kit, [
    [0, 0],
    [radius * 0.72, 0],
    [radius * 0.79, height * 0.05],
    [radius * 0.9, height * 0.26],
    [radius * 0.97, height * 0.52],
    [radius * 0.945, height * 0.78],
    [radius * 0.97, height * 0.93],
    [radius, height],
    [radius * 0.9, height - SOIL_DROP * 0.9],
  ]);
}

/** How many pebbles a mulched pot carries. */
const PEBBLE_COUNT = 5;
/** Radius of one pebble, metres - a real 2-3 cm stone. */
const PEBBLE_RADIUS = [0.011, 0.016] as const;
/** Segments of a pebble: it is 2 cm across and read as a lump, never as a sphere. */
const PEBBLE_SEGMENTS = 6;
/** How flat a pebble is squashed, so it lies on the soil rather than resting on it. */
const PEBBLE_FLATTEN = 0.62;

/**
 * Pebbles scattered on the soil INSIDE the pot, the way a mulched planter's
 * are - on the surface the crown grows out of, never on the rim.
 */
export function mulchPebbles(group: THREE.Group, kit: BuildKit, slot: string, radius: number, top: number, random: () => number): void {
  for (let index = 0; index < PEBBLE_COUNT; index += 1) {
    const size = PEBBLE_RADIUS[0] + (PEBBLE_RADIUS[1] - PEBBLE_RADIUS[0]) * random();
    const azimuth = (index / PEBBLE_COUNT) * Math.PI * 2 + random() * 0.6;
    const away = radius * (0.3 + 0.6 * random());
    put(group, kit.sphere(size, PEBBLE_SEGMENTS), kit.finish(slot), {
      x: Math.sin(azimuth) * away,
      y: top + size * PEBBLE_FLATTEN * 0.5,
      z: Math.cos(azimuth) * away,
      sy: PEBBLE_FLATTEN,
    }).name = SOIL_NAME;
  }
}

/** Ribs the sphere pot's profile is sampled at, from the floor up to the cut. */
const SPHERE_RIBS = 7;

/**
 * Sphere planter cut flat at the top: the profile follows a circle of the
 * radius the footprint allows, and stops at the height the cut sits at.
 *
 * The cut is what makes it a planter rather than a ball, so it is derived from
 * `height` instead of being a magic fraction: the sphere's centre sits at its
 * own radius, and the profile runs from the floor to whatever latitude the
 * requested height crosses.
 */
export function potSphere(group: THREE.Group, kit: BuildKit, radius: number, height: number): void {
  const cut = Math.max(-0.98, Math.min(0.98, (height - radius) / radius));
  const cutAngle = Math.asin(cut);
  const profile: Array<readonly [number, number]> = [[0, 0]];
  for (let rib = 0; rib <= SPHERE_RIBS; rib += 1) {
    const angle = -Math.PI / 2 + (cutAngle + Math.PI / 2) * (rib / SPHERE_RIBS);
    profile.push([radius * Math.cos(angle), radius + radius * Math.sin(angle)]);
  }
  profile.push([radius * Math.cos(cutAngle) * 0.88, height - SOIL_DROP * 0.5]);
  turnPot(group, kit, profile);
}

/* ------------------------------------------------------------------- fit --- */

/**
 * Fits the crown to its archetype's box: exactly as tall as `dims` declares,
 * and never wider or deeper than it. Answers how much it had to be slimmed
 * horizontally to get there, which is `1` for a species designed to its box.
 *
 * The crown is grown at its own proportions and fitted afterwards, the way
 * `turnedLeg` scales one turned profile to a real leg: a species then reads as
 * a shape - how hard the stalks arch, how far the blades droop - instead of as
 * a table of numbers retuned per size variant, and the `dims` the layout
 * linter and the collision box are built on stay the truth.
 *
 * The height is fitted UNIFORMLY and the reach is then taken out of X and Z
 * alone. One uniform fit against both would let a crown 20 % too wide cut 20 %
 * off the plant's height, and a plant two thirds of its declared height is
 * seen from across the room where a crown 10 % narrower than it grew is not.
 * The reach is clamped per axis and as a RADIUS about the pot's own axis, not
 * as the crown's extent: the pot is centred on the pivot, so a crown that
 * leans out to one side and a pot centred under it add up to a box wider than
 * either, and a plant has to fit the box it declares as a whole.
 *
 * `asset-builders-plants.test.ts` holds that slimming near 1 for every shipped
 * variant, so it stays a correction rather than the design.
 */
export function fitCrown(crown: THREE.Group, soilTop: number, targetTop: number, maxWidth: number, maxDepth: number): number {
  crown.name = CROWN_NAME;
  const box = new THREE.Box3().setFromObject(crown);
  const rise = box.max.y - soilTop;
  const lift = rise > 1e-6 ? (targetTop - soilTop) / rise : 1;
  const reachX = Math.max(box.max.x, -box.min.x) * lift;
  const reachZ = Math.max(box.max.z, -box.min.z) * lift;
  const slim = Math.min(reachX > 1e-6 ? maxWidth / 2 / reachX : 1, reachZ > 1e-6 ? maxDepth / 2 / reachZ : 1, 1);
  crown.scale.set(lift * slim, lift, lift * slim);
  // Scaling a group scales about its parent's origin, so the soil line has to
  // be put back where it was or the whole crown sinks into the pot.
  crown.position.y = soilTop * (1 - lift);
  return slim;
}
