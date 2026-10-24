/**
 * Procedural builders for seating and beds: sofas, tables, chairs, stools, beds.
 *
 * See the conventions list in `asset-builders.ts` for the anchor/orientation
 * rules every builder here follows.
 *
 * Invariant: builders only ever take geometry from the shared cache and
 * materials from the finish registry - they never create or dispose either.
 */

import * as THREE from 'three';
import { readOptions, type OptionSpec } from './asset-options.js';
import { barHandle, put, shakerFront, turnedLeg, LEAF_REVEAL, type BuildKit, type Builder, type Place } from './asset-kit.js';

/* ------------------------------------------------------------- upholstered */

/** Sofas and armchairs: turned legs, an upholstered plinth and back, welted arms, plump `seats` cushions. */
/** `buildSofa`; `seats` is the number of seat cushions, and so the read of the piece. */
const SOFA_OPTIONS = {
  seats: { kind: 'number', default: 3, min: 1, integer: true },
} as const satisfies Record<string, OptionSpec>;

/**
 * Turned front-leg profile, metres `[radius, height]` bottom to top: foot pad,
 * slim shaft, collar, tapered neck. A real profile reads at eye level where a
 * plain taper dissolves into the floor tone.
 */
const SOFA_LEG_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0155, 0.0],
  [0.0155, 0.007],
  [0.0122, 0.013],
  [0.0102, 0.052],
  [0.0098, 0.088],
  [0.0134, 0.104],
  [0.0139, 0.113],
  [0.0118, 0.125],
  [0.0132, 0.14],
];

/** Welt cord radius, metres: a thin run half-sunk into a seam reads as upholstery piping. */
const WELT_RADIUS = 0.0075;

/**
 * Inset from a face plane to where the welt sits half-sunk on the corner arc
 * of a rounded box: the piping hugs the 45° point of the rounding, so on a
 * plump radius the seam sits far deeper than the flat faces suggest. Naive
 * `plane - small epsilon` placements float the cord in mid-air.
 */
const weltInset = (radius: number): number => 0.293 * radius + 0.354 * WELT_RADIUS;

function welt(group: THREE.Group, kit: BuildKit, slot: string, length: number, place: Place): void {
  put(group, kit.cylinder(WELT_RADIUS, WELT_RADIUS, length, 8), kit.finish(slot), place).name = 'welt';
}

export const buildSofa: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { seats } = readOptions(asset.options, SOFA_OPTIONS);
  const legHeight = 0.14;
  const armWidth = Math.min(0.24, width * 0.14);
  const plinthHeight = 0.17;
  const plinthTop = legHeight + plinthHeight;
  const backThickness = 0.18;
  const upholstery = kit.finish('upholstery');
  const cushion = kit.finish('cushion');

  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      put(group, kit.lathe(SOFA_LEG_PROFILE, 12), kit.finish('leg'), {
        x: x * (width / 2 - armWidth * 0.55),
        z: z * (depth / 2 - 0.15),
      }).name = 'leg';
    }
  }

  put(group, kit.rounded(width - 0.04, plinthHeight, depth - 0.1, 0.032, 2), upholstery, {
    y: legHeight + plinthHeight / 2,
  }).name = 'plinth';

  const backHeight = height - plinthTop + 0.06;
  put(group, kit.rounded(width, backHeight, backThickness, 0.06, 2), upholstery, {
    y: plinthTop - 0.06 + backHeight / 2,
    z: -depth / 2 + backThickness / 2,
  }).name = 'back';

  const armHeight = (height - plinthTop) * 0.72;
  const armRadius = armWidth * 0.45;
  for (const side of [-1, 1]) {
    put(group, kit.rounded(armWidth, armHeight, depth - 0.03, armRadius, 2), upholstery, {
      x: (side * (width - armWidth)) / 2,
      y: plinthTop + armHeight / 2 - 0.02,
      z: 0.01,
    }).name = 'arm';
    welt(group, kit, 'upholstery', depth - 0.03 - 2 * (armRadius - 0.01), {
      x: (side * (width - 2 * weltInset(armRadius))) / 2,
      y: plinthTop + armHeight - 0.02 - weltInset(armRadius),
      z: 0.01,
      rx: Math.PI / 2,
    });
  }

  const innerWidth = width - armWidth * 2 - 0.02;
  const gap = 0.02;
  const seatWidth = (innerWidth - gap * (seats - 1)) / seats;
  const seatDepth = depth - backThickness - 0.14;
  const seatThickness = 0.18;
  const seatRadius = Math.min(0.062, seatWidth * 0.11);
  const seatY = plinthTop + seatThickness / 2 - 0.01;
  const seatZ = depth / 2 - seatDepth / 2 - 0.05;
  for (let index = 0; index < seats; index += 1) {
    const x = -innerWidth / 2 + seatWidth / 2 + index * (seatWidth + gap);
    const seatDepthIndex = seatDepth - index * 0.004;
    put(group, kit.rounded(seatWidth, seatThickness, seatDepthIndex, seatRadius, 2), cushion, {
      x,
      y: seatY,
      z: seatZ,
      ry: (index % 2 === 0 ? 1 : -1) * 0.007,
    }).name = `seat-cushion-${index}`;
    welt(group, kit, 'upholstery', seatWidth - 2 * (seatRadius - 0.01), {
      x,
      y: seatY + seatThickness / 2 - weltInset(seatRadius),
      z: seatZ + seatDepthIndex / 2 - weltInset(seatRadius),
      rz: Math.PI / 2,
    });

    const cushionHeight = height - plinthTop - seatThickness + 0.02;
    const cushionDepth = 0.16;
    const cushionRadius = Math.min(0.07, seatWidth * 0.12);
    const slouch = -0.085 - (index % 2) * 0.01;
    const backY = plinthTop + seatThickness + cushionHeight / 2 - 0.03;
    const backZ = -depth / 2 + backThickness + 0.062;
    put(group, kit.rounded(seatWidth - 0.012, cushionHeight, cushionDepth, cushionRadius, 2), cushion, {
      x,
      y: backY,
      z: backZ,
      rx: slouch,
      ry: (index % 2 === 0 ? -1 : 1) * 0.006,
    }).name = `back-cushion-${index}`;
    const seamY = cushionHeight / 2 - weltInset(cushionRadius);
    const seamZ = cushionDepth / 2 - weltInset(cushionRadius);
    const cos = Math.cos(slouch);
    const sin = Math.sin(slouch);
    welt(group, kit, 'upholstery', seatWidth - 0.012 - 2 * (cushionRadius - 0.01), {
      x,
      y: backY + seamY * cos - seamZ * sin,
      z: backZ + seamY * sin + seamZ * cos,
      rx: slouch,
      rz: Math.PI / 2,
    });
  }

  const seatTop = seatY + seatThickness / 2;
  const pillows: ReadonlyArray<{ size: number; thickness: number; x: number; z: number; rx: number; ry: number; rz: number }> = [
    {
      size: 0.44,
      thickness: 0.15,
      x: -innerWidth / 2 + seatWidth * 0.5,
      z: -depth / 2 + backThickness + 0.26,
      rx: -0.17,
      ry: 0.1,
      rz: 0.13,
    },
    {
      size: 0.37,
      thickness: 0.14,
      x: innerWidth / 2 - seatWidth * 0.45,
      z: -depth / 2 + backThickness + 0.22,
      rx: -0.24,
      ry: -0.14,
      rz: -0.11,
    },
  ];
  for (const [index, pillow] of (seats > 1 ? pillows : pillows.slice(0, 1)).entries()) {
    put(group, kit.rounded(pillow.size, pillow.thickness, pillow.size, Math.min(0.085, pillow.size * 0.2), 2), cushion, {
      x: pillow.x,
      y: seatTop + pillow.thickness / 2 - 0.012,
      z: pillow.z,
      rx: pillow.rx,
      ry: pillow.ry,
      rz: pillow.rz,
    }).name = `throw-pillow-${index}`;
  }
  return group;
};

/* ------------------------------------------------------------------ tables */

/**
 * Turned profiles at nominal heights, `[radius, y]` bottom to top, metres.
 * They are scaled per mesh to the piece's real leg height, so one geometry
 * serves every size variant.
 */
const TABLE_LEG_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.02, 0.0],
  [0.02, 0.008],
  [0.0158, 0.016],
  [0.0125, 0.06],
  [0.0118, 0.55],
  [0.0146, 0.62],
  [0.0151, 0.66],
  [0.0122, 0.72],
  [0.0136, 0.78],
];
const COLUMN_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.026, 0.0],
  [0.026, 0.012],
  [0.019, 0.026],
  [0.0132, 0.09],
  [0.0156, 0.16],
  [0.0132, 0.23],
  [0.0118, 0.32],
  [0.0138, 0.36],
  [0.0112, 0.4],
  [0.0132, 0.42],
];
const CHAIR_LEG_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0145, 0.0],
  [0.0145, 0.006],
  [0.0112, 0.014],
  [0.0092, 0.4],
  [0.0108, 0.42],
];
const CHAIR_POST_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0162, 0.0],
  [0.0162, 0.007],
  [0.0125, 0.016],
  [0.0108, 0.42],
  [0.0122, 0.46],
  [0.0105, 0.62],
  [0.0098, 0.9],
];
/** How far a dining chair's back posts lean back out of the vertical, radians. */
const CHAIR_BACK_LEAN = 0.045;
const STOOL_LEG_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0165, 0.0],
  [0.0165, 0.007],
  [0.0128, 0.016],
  [0.0108, 0.3],
  [0.0122, 0.34],
  [0.0105, 0.62],
  [0.0118, 0.66],
];

/** Dining, coffee, side tables and desks: a top plus legs, a column, or a pedestal. */
/**
 * `buildTable`. `pedestal` chooses what carries the top: four tapered legs, a
 * single turned column, or a desk pedestal of drawers under one end.
 */
const TABLE_OPTIONS = {
  apron: { kind: 'number', default: 0.07, min: 0 },
  round: { kind: 'flag', default: false },
  pedestal: { kind: 'text', values: ['legs', 'column', 'drawers', 'none'], default: 'legs' },
  shelf: { kind: 'flag', default: false },
} as const satisfies Record<string, OptionSpec>;

export const buildTable: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const topThickness = Math.max(0.026, height * 0.05);
  const { apron, round, pedestal, shelf } = readOptions(asset.options, TABLE_OPTIONS);
  const inset = 0.085;
  const legHeight = height - topThickness;

  if (round) {
    put(group, kit.cylinder(width / 2, width / 2, topThickness, 40), kit.finish('top'), { y: height - topThickness / 2 });
  } else {
    put(group, kit.rounded(width, topThickness, depth, topThickness * 0.34), kit.finish('top'), { y: height - topThickness / 2 });
  }

  if (pedestal === 'column') {
    // Single turned column on a weighted disc - the classic side table.
    turnedLeg(group, kit, COLUMN_PROFILE, 'leg', 0, 0, legHeight);
    put(group, kit.cylinder(width * 0.3, width * 0.32, 0.024, 22), kit.finish('leg'), { y: 0.012 });
    return group;
  }

  if (apron > 0) {
    put(group, kit.rounded(width - inset * 2, apron, depth - inset * 2, 0.006), kit.finish('leg'), {
      y: height - topThickness - apron / 2,
    });
  }
  const legRadius = round ? width / 2 - inset * 1.6 : 0;
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const lx = round ? x * legRadius * 0.72 : x * (width / 2 - inset);
      const lz = round ? z * legRadius * 0.72 : z * (depth / 2 - inset);
      turnedLeg(group, kit, TABLE_LEG_PROFILE, 'leg', lx, lz, legHeight);
    }
  }
  if (shelf) {
    put(group, kit.rounded(width - inset * 2 - 0.06, 0.024, depth - inset * 2 - 0.04, 0.008), kit.finish('leg'), { y: height * 0.34 });
  }
  if (pedestal === 'drawers') {
    // Desk pedestal: two shaker drawer fronts hung under one end of the top.
    const boxWidth = Math.min(0.42, width * 0.36);
    const boxHeight = legHeight * 0.62;
    const boxX = width / 2 - inset - boxWidth / 2;
    const boxY = height - topThickness - apron - boxHeight / 2;
    const frontZ = (depth - inset * 2) / 2;
    const frontHeight = (boxHeight - LEAF_REVEAL) / 2;
    for (const y of [boxY + boxHeight / 2 - frontHeight / 2, boxY + boxHeight / 2 - frontHeight - LEAF_REVEAL - frontHeight / 2]) {
      shakerFront(group, kit, 'front', boxWidth, frontHeight, 0.016, boxX, y, frontZ);
      barHandle(group, kit, 'metal', boxWidth * 0.45, boxX, y, frontZ);
    }
  }
  return group;
};

export const buildChair: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const seatHeight = 0.45;
  const seatThickness = 0.045;
  const inset = 0.048;
  const frame = kit.finish('frame');
  // The rear posts are the back legs too: each rises from the floor to the top
  // of the back, leaning back by `CHAIR_BACK_LEAN` about its own foot, and the
  // back slat and rail sit on the posts wherever the lean has carried them.
  const postFootZ = -(depth / 2 - inset) - 0.012;
  const postZ = (y: number): number => postFootZ - Math.sin(CHAIR_BACK_LEAN) * y;
  const postNominal = CHAIR_POST_PROFILE.at(-1)![1];

  for (const x of [-1, 1]) {
    turnedLeg(group, kit, CHAIR_LEG_PROFILE, 'leg', x * (width / 2 - inset), depth / 2 - inset, seatHeight - seatThickness);
    const post = put(group, kit.lathe(CHAIR_POST_PROFILE, 12), kit.finish('leg'), {
      x: x * (width / 2 - inset),
      z: postFootZ,
      ry: Math.PI / 4,
      sy: height / postNominal,
    });
    post.rotation.x = -CHAIR_BACK_LEAN;
    post.name = 'chair-post';
  }
  for (const x of [-1, 1]) {
    put(group, kit.box(0.022, 0.022, depth - inset * 2), kit.finish('leg'), { x: x * (width / 2 - inset), y: 0.2, z: 0 });
  }
  put(group, kit.box(width - inset * 2, 0.02, 0.022), kit.finish('leg'), { y: 0.2, z: 0 });

  put(group, kit.rounded(width - 0.02, seatThickness, depth - 0.05, 0.014), frame, { y: seatHeight - seatThickness / 2 });
  put(group, kit.rounded(width - 0.07, 0.05, depth - 0.11, 0.022, 2), kit.finish('cushion'), { y: seatHeight + 0.021, z: 0.008 });
  welt(group, kit, 'cushion', width - 0.07 - 2 * (0.022 - 0.008), {
    y: seatHeight + 0.021 + 0.025 - weltInset(0.022),
    z: 0.008 + (depth - 0.11) / 2 - weltInset(0.022),
    rz: Math.PI / 2,
  });

  const backTop = height - 0.03;
  const slatY = backTop - 0.11;
  const railY = seatHeight + 0.17;
  put(group, kit.rounded(width - 0.09, 0.19, 0.032, 0.014), frame, { y: slatY, z: postZ(slatY) + 0.001, rx: -CHAIR_BACK_LEAN });
  put(group, kit.rounded(width - 0.09, 0.055, 0.028, 0.012), frame, { y: railY, z: postZ(railY) + 0.0035, rx: -CHAIR_BACK_LEAN });
  return group;
};

export const buildStool: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height] = asset.dims;
  const radius = width / 2;
  const seatThickness = 0.05;
  const legHeight = height - seatThickness - 0.04;

  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const leg = put(group, kit.lathe(STOOL_LEG_PROFILE, 12), kit.finish('leg'), {
        x: x * radius * 0.62,
        y: legHeight / 2,
        z: z * radius * 0.62,
        ry: Math.PI / 4,
        sy: legHeight / 0.66,
      });
      leg.rotation.x = -z * 0.05;
      leg.rotation.z = x * 0.05;
    }
  }
  put(group, kit.torus(radius * 0.72, 0.009, 20), kit.finish('leg'), { y: height * 0.3, rx: Math.PI / 2 });
  put(group, kit.cylinder(radius, radius * 0.96, seatThickness, 22), kit.finish('frame'), { y: height - seatThickness / 2 - 0.028 });
  put(group, kit.cylinder(radius * 0.94, radius * 0.94, 0.035, 22), kit.finish('cushion'), { y: height - 0.017 });
  put(group, kit.torus(radius * 0.94, WELT_RADIUS, 24), kit.finish('cushion'), { y: height - 0.004, rx: Math.PI / 2 }).name = 'welt';
  return group;
};

/* -------------------------------------------------------------------- beds */

/** `buildBed`; a `platform` bed sits on a solid base instead of on four legs. */
const BED_OPTIONS = {
  platform: { kind: 'flag', default: false },
  pillows: { kind: 'number', default: 2, min: 1, integer: true },
} as const satisfies Record<string, OptionSpec>;

export const buildBed: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { platform, pillows } = readOptions(asset.options, BED_OPTIONS);
  const legHeight = platform ? 0.05 : 0.14;
  const frameHeight = platform ? 0.2 : 0.17;
  const frameTop = legHeight + frameHeight;
  const mattressHeight = 0.26;
  const mattressTop = frameTop + mattressHeight;

  if (platform) {
    put(group, kit.box(width - 0.14, legHeight, depth - 0.16), kit.finish('frame'), { y: legHeight / 2 });
  } else {
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        turnedLeg(group, kit, SOFA_LEG_PROFILE, 'leg', x * (width / 2 - 0.1), z * (depth / 2 - 0.14), legHeight);
      }
    }
  }
  put(group, kit.rounded(width, frameHeight, depth, 0.022), kit.finish('frame'), { y: legHeight + frameHeight / 2 });
  put(group, kit.rounded(width - 0.06, mattressHeight, depth - 0.06, 0.05, 2), kit.finish('cushion'), { y: frameTop + mattressHeight / 2 });

  const headboardHeight = height - frameTop;
  if (headboardHeight > 0.12) {
    const headZ = -depth / 2 - 0.03;
    put(group, kit.rounded(width + 0.06, headboardHeight, 0.1, 0.03), kit.finish('upholstery'), {
      y: frameTop + headboardHeight / 2,
      z: headZ,
    });
    const panels = 5;
    const panelWidth = (width - 0.08) / panels - 0.018;
    for (let index = 0; index < panels; index += 1) {
      put(group, kit.rounded(panelWidth, headboardHeight - 0.12, 0.06, 0.024, 2), kit.finish('upholstery'), {
        x: -(width - 0.08) / 2 + (index + 0.5) * ((width - 0.08) / panels),
        y: frameTop + headboardHeight / 2 + 0.02,
        z: headZ + 0.075,
      });
    }
    for (let index = 1; index < panels; index += 1) {
      welt(group, kit, 'upholstery', headboardHeight - 0.2, {
        x: -(width - 0.08) / 2 + index * ((width - 0.08) / panels),
        y: frameTop + headboardHeight / 2 + 0.02,
        z: headZ + 0.056,
      });
    }
  }

  const duvetDepth = depth * 0.66;
  put(group, kit.rounded(width - 0.02, 0.13, duvetDepth, 0.05, 2), kit.finish('cushion'), {
    y: mattressTop + 0.05,
    z: depth / 2 - duvetDepth / 2 - 0.04,
  });
  put(group, kit.rounded(width - 0.02, 0.075, 0.24, 0.035, 2), kit.finish('upholstery'), {
    y: mattressTop + 0.09,
    z: depth / 2 - duvetDepth - 0.02,
    rx: 0.1,
  });

  const pillowWidth = Math.min(0.66, (width - 0.16) / pillows);
  for (let index = 0; index < pillows; index += 1) {
    const x = pillows === 1 ? 0 : -(width - 0.16) / 2 + pillowWidth / 2 + index * ((width - 0.16) / pillows);
    put(group, kit.rounded(pillowWidth, 0.15, 0.38, 0.075, 2), kit.finish('cushion'), {
      x,
      y: mattressTop + 0.09,
      z: -depth / 2 + 0.26,
      rx: -0.22,
      ry: (index % 2 === 0 ? 1 : -1) * 0.06,
    });
  }
  return group;
};
