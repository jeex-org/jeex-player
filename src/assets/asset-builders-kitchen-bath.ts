/**
 * Procedural builders for kitchen and sanitary fixtures: islands, counters,
 * cookers, appliances, hoods, vanities, toilets, bathtubs.
 *
 * See the conventions list in `asset-builders.ts` for the anchor/orientation
 * rules every builder here follows.
 *
 * Invariant: builders only ever take geometry from the shared cache and
 * materials from the finish registry - they never create or dispose either.
 */

import * as THREE from 'three';
import { FINISH } from '../materials/finish-ids.js';
import { readOptions, type OptionSpec } from './asset-options.js';
import { barHandle, mixerTap, put, sinkBasin, type Builder } from './asset-kit.js';

/* ------------------------------------------------------------------ kitchen */

/** `buildIsland`; `overhang` is the worktop's reach past the carcass, metres. */
const ISLAND_OPTIONS = {
  overhang: { kind: 'number', default: 0.26, min: 0 },
  doors: { kind: 'number', default: 3, min: 1, integer: true },
  hob: { kind: 'flag', default: true },
} as const satisfies Record<string, OptionSpec>;

export const buildIsland: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { overhang, doors, hob } = readOptions(asset.options, ISLAND_OPTIONS);
  const toeKick = 0.1;
  const topThickness = 0.045;
  const bodyHeight = height - toeKick - topThickness;
  const frontDepth = 0.02;

  put(group, kit.box(width - 0.12, toeKick, depth - 0.1), kit.finish('carcass'), { y: toeKick / 2 });
  put(group, kit.rounded(width, bodyHeight, depth, 0.006), kit.finish('carcass'), { y: toeKick + bodyHeight / 2 });

  // Fronts sit on the working side (-Z); the counter overhangs toward the seating side (+Z).
  const cellWidth = width / doors;
  for (let index = 0; index < doors; index += 1) {
    const cx = -width / 2 + cellWidth * (index + 0.5);
    put(group, kit.rounded(cellWidth - 0.014, bodyHeight - 0.012, frontDepth, 0.006), kit.finish('front'), {
      x: cx,
      y: toeKick + bodyHeight / 2,
      z: -depth / 2 - frontDepth / 2,
    });
    put(group, kit.cylinder(0.009, 0.009, Math.min(0.4, cellWidth * 0.62), 8), kit.finish('metal'), {
      x: cx,
      y: toeKick + bodyHeight - 0.11,
      z: -depth / 2 - frontDepth - 0.026,
      rz: Math.PI / 2,
    });
  }

  put(group, kit.rounded(width + 0.06, topThickness, depth + overhang, 0.01), kit.finish('top'), {
    y: height - topThickness / 2,
    z: overhang / 2,
  }).name = 'island-worktop';
  // Doubled edge under the seating overhang: a bare 45 mm slab reads thin from the sofa side.
  put(group, kit.box(width + 0.06, 0.028, overhang - 0.02), kit.finish('top'), {
    y: height - topThickness - 0.014,
    z: overhang - 0.01,
  });

  if (hob) {
    put(group, kit.rounded(0.58, 0.012, 0.5, 0.004), kit.finish('accent'), { y: height + 0.005, z: -0.14 });
    for (const x of [-0.14, 0.14]) {
      for (const z of [-0.26, -0.02]) {
        put(group, kit.torus(0.062, 0.006, 18), kit.finish('metal'), { x, y: height + 0.013, z, rx: Math.PI / 2 });
      }
    }
  }

  const sinkX = width / 2 - 0.42;
  sinkBasin(group, kit, sinkX, height, -0.1, 0.46, 0.38);
  mixerTap(group, kit, 'metal', sinkX, height, -0.16, 0.26, 0.016);
  return group;
};

/** Counter run against a wall: base units, worktop, sink and a tiled backsplash. */
/** `buildCounter`; `backsplash` is how far the tiled band rises above the worktop. */
const COUNTER_OPTIONS = {
  doors: { kind: 'number', default: 3, min: 1, integer: true },
  backsplash: { kind: 'number', default: 0.56, min: 0 },
  sink: { kind: 'flag', default: true },
} as const satisfies Record<string, OptionSpec>;

export const buildCounter: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { doors, backsplash, sink } = readOptions(asset.options, COUNTER_OPTIONS);
  const toeKick = 0.1;
  const topThickness = 0.045;
  const worktop = 0.92;
  const bodyHeight = worktop - toeKick - topThickness;
  const frontDepth = 0.02;
  const splashTop = Math.min(height, worktop + backsplash);

  put(group, kit.box(width - 0.12, toeKick, depth - 0.1), kit.finish('carcass'), { y: toeKick / 2, z: -0.03 });
  put(group, kit.rounded(width, bodyHeight, depth, 0.006), kit.finish('carcass'), { y: toeKick + bodyHeight / 2 });

  const cellWidth = width / doors;
  for (let index = 0; index < doors; index += 1) {
    const cx = -width / 2 + cellWidth * (index + 0.5);
    put(group, kit.rounded(cellWidth - 0.014, bodyHeight - 0.012, frontDepth, 0.006), kit.finish('front'), {
      x: cx,
      y: toeKick + bodyHeight / 2,
      z: depth / 2 + frontDepth / 2,
    });
    barHandle(group, kit, 'metal', Math.min(0.3, cellWidth * 0.55), cx, toeKick + bodyHeight - 0.09, depth / 2 + frontDepth);
  }

  put(group, kit.rounded(width + 0.03, topThickness, depth + 0.03, 0.008), kit.finish('top'), { y: worktop - topThickness / 2 });
  // Backsplash: a thin tiled slab standing on the worktop against the wall.
  put(group, kit.box(width, splashTop - worktop, 0.024), kit.finish('accent'), {
    y: worktop + (splashTop - worktop) / 2,
    z: -depth / 2 + 0.012,
  });

  if (sink) {
    sinkBasin(group, kit, 0, worktop, 0.01, 0.56, depth * 0.6);
    mixerTap(group, kit, 'metal', 0, worktop, -0.05, 0.24, 0.015);
  }
  return group;
};

/** Freestanding cooker: oven door with glass, control fascia, hob with grate burners. */
/** `buildCooker`; `burners` is the number of rings on the hob. */
const COOKER_OPTIONS = {
  burners: { kind: 'number', default: 4, min: 1, integer: true },
} as const satisfies Record<string, OptionSpec>;

/**
 * Turned control knob, absolute metres `[radius, y]` bottom to top: stem foot,
 * grip barrel, domed top. Placed with its base on the fascia face.
 */
const COOKER_KNOB_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.007, 0.0],
  [0.016, 0.002],
  [0.019, 0.007],
  [0.019, 0.016],
  [0.016, 0.021],
  [0.009, 0.024],
];

/**
 * Burner crown (flame spreader cup), absolute metres: pan seat, waist,
 * flame ring, cap seat. The cap closes it from above.
 */
const COOKER_BURNER_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.03, 0.0],
  [0.03, 0.004],
  [0.022, 0.007],
  [0.022, 0.012],
  [0.026, 0.014],
  [0.026, 0.016],
];

/**
 * Turned handle standoff, absolute metres along +Y, rotated to +Z in place:
 * foot, collar, shaft, head. Reads as a cast mount, not a plain dowel.
 */
const COOKER_STANDOFF_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.011, 0.0],
  [0.011, 0.004],
  [0.007, 0.008],
  [0.007, 0.038],
  [0.01, 0.042],
  [0.01, 0.05],
];

export const buildCooker: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const toeKick = 0.09;
  const hob = 0.9;
  const bodyHeight = hob - toeKick;
  const { burners } = readOptions(asset.options, COOKER_OPTIONS);
  const metal = kit.finish('metal');
  const frontZ = depth / 2;

  // Levelling feet + recessed plinth. Feet peek under the shadow gap.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(group, kit.cylinder(0.02, 0.024, 0.03, 10), kit.finish('accent'), {
        x: sx * (width / 2 - 0.09),
        y: 0.015,
        z: sz * (depth / 2 - 0.1),
      });
    }
  }
  put(group, kit.box(width - 0.06, toeKick, depth - 0.06), metal, { y: toeKick / 2, z: -0.02 });
  // Two vent slits on the plinth face, proud by 2 mm so no face is coplanar.
  for (const x of [-0.12, 0.12]) {
    put(group, kit.box(0.14, 0.014, 0.004), kit.finish('accent'), { x, y: 0.045, z: frontZ - 0.048 });
  }

  put(group, kit.rounded(width, bodyHeight, depth, 0.01), kit.finish('carcass'), { y: toeKick + bodyHeight / 2 });
  // Brushed side-edge trims running the full body height: the highlight that
  // separates the carcass side from the front stack. Proud by 1.5 mm.
  for (const side of [-1, 1]) {
    put(group, kit.box(0.014, bodyHeight - 0.02, 0.014), metal, {
      x: side * (width / 2 - 0.007),
      y: toeKick + bodyHeight / 2,
      z: frontZ - 0.007,
    });
  }

  // Oven door: layered stack so every face sits on its own plane.
  const doorH = bodyHeight * 0.56;
  const doorY = toeKick + bodyHeight * 0.37;
  put(group, kit.rounded(width - 0.03, doorH, 0.026, 0.008), kit.finish('front'), {
    y: doorY,
    z: frontZ + 0.013,
  });
  // Window bezel: a metal ring standing proud of the door face, so the glass
  // covers a real shallow cavity instead of a flat panel print.
  const winW = width - 0.19;
  const winH = doorH * 0.56;
  const winY = doorY - 0.01;
  put(
    group,
    kit.ring({ width: winW + 0.07, height: winH + 0.07, radius: 0.012 }, { width: winW, height: winH, radius: 0.008 }, 0.02),
    metal,
    { y: winY, z: frontZ + 0.024 },
  );
  // Oven glass: TRANSPARENT smoked pane (the `glass` slot) set 0.5 mm inside
  // the bezel face. The lighting standard's PMREM environment gives it live reflections;
  // no Reflector here, one mirror RT per scene is the budget.
  put(group, kit.plane(winW, winH), kit.finish('glass'), { y: winY, z: frontZ + 0.0435 });
  // Cavity back: dark enamel 14 mm behind the glass, the depth the eye reads.
  put(group, kit.box(winW + 0.01, winH + 0.01, 0.003), kit.finish('accent'), {
    y: winY,
    z: frontZ + 0.0275,
  });
  // Wire rack: two side rails and four rods riding ahead of the back wall.
  const rackZ = frontZ + 0.0355;
  for (const side of [-1, 1]) {
    put(group, kit.box(0.006, winH - 0.02, 0.006), metal, {
      x: side * (winW / 2 - 0.02),
      y: winY,
      z: rackZ,
    });
  }
  for (const dy of [-0.3, -0.1, 0.1, 0.3]) {
    const rod = put(group, kit.cylinder(0.0016, 0.0016, winW - 0.04, 6), metal, {
      x: 0,
      y: winY + dy * winH,
      z: rackZ,
    });
    rod.rotation.z = Math.PI / 2;
  }
  // Baking tray with a roast and potatoes, so there is something cooking.
  const trayY = winY - winH * 0.28;
  put(group, kit.box(winW - 0.04, 0.003, 0.012), kit.finish('accent'), { x: 0, y: trayY, z: frontZ + 0.031 });
  put(group, kit.rounded(0.17, 0.075, 0.009, 0.025), kit.finish(FINISH.leather_tan), {
    x: 0,
    y: trayY + 0.039,
    z: frontZ + 0.032,
  });
  const potato = kit.finish(FINISH.pigment_ochre);
  for (const px of [-0.13, -0.075, 0.075, 0.13]) {
    put(group, kit.sphere(0.011, 6), potato, { x: px, y: trayY + 0.012, z: frontZ + 0.03 });
  }
  // Oven lamp: a small warm emissive block in the cavity's top corner.
  put(group, kit.box(0.03, 0.012, 0.004), kit.finish(FINISH.shade_opal), {
    x: winW / 2 - 0.05,
    y: winY + winH / 2 - 0.025,
    z: frontZ + 0.033,
  });
  // Hinge blocks at the door foot.
  for (const side of [-1, 1]) {
    put(group, kit.box(0.03, 0.05, 0.02), metal, {
      x: side * (width / 2 - 0.06),
      y: toeKick + 0.1,
      z: frontZ + 0.02,
    });
  }

  // Full-width rail handle on turned standoffs.
  const railY = toeKick + bodyHeight * 0.7;
  const rail = put(group, kit.cylinder(0.012, 0.012, width - 0.12, 12), metal, {
    y: railY,
    z: frontZ + 0.062,
  });
  rail.rotation.z = Math.PI / 2;
  // Rounded end caps so the cut tube ends never show.
  for (const side of [-1, 1]) {
    put(group, kit.sphere(0.012, 10), metal, { x: side * (width / 2 - 0.06), y: railY, z: frontZ + 0.062 });
    const stand = put(group, kit.lathe(COOKER_STANDOFF_PROFILE, 10), metal, {
      x: side * (width / 2 - 0.08),
      y: railY,
      z: frontZ + 0.012,
      rx: Math.PI / 2,
    });
    void stand;
  }

  // Bottom drawer with shadow gap and its own rail handle.
  const drawerH = bodyHeight * 0.15;
  const drawerY = toeKick + bodyHeight * 0.075;
  put(group, kit.box(width - 0.03, 0.008, 0.004), kit.finish('accent'), {
    y: drawerY + drawerH / 2 + 0.006,
    z: frontZ + 0.014,
  });
  put(group, kit.rounded(width - 0.03, drawerH, 0.024, 0.006), kit.finish('front'), {
    y: drawerY,
    z: frontZ + 0.012,
  });
  const drawerRail = put(group, kit.cylinder(0.009, 0.009, width * 0.5, 10), metal, {
    y: drawerY + 0.02,
    z: frontZ + 0.045,
  });
  drawerRail.rotation.z = Math.PI / 2;

  // Control fascia: a proud band carrying turned knobs, tick marks and an LED.
  const fasciaH = 0.095;
  const fasciaY = toeKick + bodyHeight * 0.885;
  put(group, kit.rounded(width - 0.03, fasciaH, 0.022, 0.006), kit.finish('front'), {
    y: fasciaY,
    z: frontZ + 0.011,
  });
  for (let index = 0; index < burners; index += 1) {
    const x = -width / 2 + (width / burners) * (index + 0.5);
    put(group, kit.lathe(COOKER_KNOB_PROFILE, 14), metal, {
      x,
      y: fasciaY - 0.012,
      z: frontZ + 0.022,
      rx: Math.PI / 2,
    });
    // Indicator tick above the knob, 2 mm proud of the fascia.
    put(group, kit.box(0.003, 0.014, 0.002), metal, { x, y: fasciaY + 0.032, z: frontZ + 0.023 });
  }
  // Power LED between the middle knobs.
  put(group, kit.box(0.022, 0.007, 0.003), kit.finish('accent'), {
    x: 0,
    y: fasciaY - 0.032,
    z: frontZ + 0.023,
  });

  // Hob: steel base slab, inset dark glass, bright front edge. The hob glass
  // stays OPAQUE (the `accent` slot): a cooktop is black glass-ceramic, never
  // see-through, and its low roughness picks up the room environment as shine.
  put(group, kit.rounded(width + 0.02, 0.03, depth + 0.02, 0.006), kit.finish('accent'), { y: hob - 0.015 });
  put(group, kit.box(width - 0.05, 0.008, depth - 0.05), kit.finish('accent'), { y: hob + 0.004 });
  put(group, kit.box(width - 0.04, 0.012, 0.014), metal, { y: hob - 0.002, z: frontZ + 0.004 });

  const rows = burners > 2 ? 2 : 1;
  const cols = Math.ceil(burners / rows);
  for (let index = 0; index < burners; index += 1) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const cx = -width / 2 + (width / cols) * (col + 0.5);
    const cz = (row + 0.5) * (depth / rows) - depth / 2;
    // Enamel drip pan, then the turned burner crown and its cap.
    put(group, kit.cylinder(0.088, 0.082, 0.006, 20), metal, { x: cx, y: hob + 0.011, z: cz });
    put(group, kit.lathe(COOKER_BURNER_PROFILE, 16), metal, { x: cx, y: hob + 0.014, z: cz });
    put(group, kit.cylinder(0.024, 0.028, 0.012, 14), kit.finish('accent'), { x: cx, y: hob + 0.036, z: cz });
    // Cast-iron grate: outer ring riding above the cap plus a cross, all dark.
    put(group, kit.torus(0.075, 0.007, 16), kit.finish('accent'), { x: cx, y: hob + 0.048, z: cz, rx: Math.PI / 2 });
    put(group, kit.box(0.19, 0.008, 0.022), kit.finish('accent'), { x: cx, y: hob + 0.048, z: cz });
    put(group, kit.box(0.022, 0.008, 0.19), kit.finish('accent'), { x: cx, y: hob + 0.048, z: cz });
  }
  // Backguard with folded top lip and vent slots, all faces offset.
  put(group, kit.box(width, height - hob, 0.03), metal, { y: hob + (height - hob) / 2, z: -depth / 2 + 0.015 });
  put(group, kit.box(width, 0.016, 0.05), metal, { y: height - 0.008, z: -depth / 2 + 0.025 });
  for (const x of [-0.15, 0, 0.15]) {
    put(group, kit.box(0.09, 0.014, 0.004), kit.finish('accent'), { x, y: hob + 0.035, z: -depth / 2 + 0.032 });
  }
  return group;
};

/** Tall appliance (refrigerator): plinth, body, one or two doors with rail handles. */
/** `buildAppliance`; `split` is where a two-door fridge divides, as a height fraction. */
const APPLIANCE_OPTIONS = {
  doors: { kind: 'number', default: 2, min: 1, integer: true },
  split: { kind: 'number', default: 0.66, min: 0, max: 1 },
} as const satisfies Record<string, OptionSpec>;

export const buildAppliance: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const { doors, split } = readOptions(asset.options, APPLIANCE_OPTIONS);
  const plinth = 0.07;
  const bodyHeight = height - plinth;

  put(group, kit.box(width - 0.05, plinth, depth - 0.05), kit.finish('carcass'), { y: plinth / 2 });
  put(group, kit.rounded(width, bodyHeight, depth, 0.012), kit.finish('carcass'), { y: plinth + bodyHeight / 2 });

  const heights = doors === 2 ? [bodyHeight * split, bodyHeight * (1 - split)] : [bodyHeight];
  let cursor = plinth;
  for (const doorHeight of heights) {
    put(group, kit.rounded(width - 0.012, doorHeight - 0.01, 0.03, 0.01), kit.finish('front'), {
      y: cursor + doorHeight / 2,
      z: depth / 2 + 0.015,
    });
    // Flat vertical rail handle, standing off the door face.
    const railLength = Math.min(0.5, doorHeight * 0.55);
    put(group, kit.box(0.038, railLength, 0.045), kit.finish('metal'), {
      x: width / 2 - 0.07,
      y: cursor + doorHeight - railLength / 2 - 0.09,
      z: depth / 2 + 0.052,
    });
    cursor += doorHeight;
  }
  return group;
};

/**
 * Chimney extractor hood, built to a set of reference photographs:
 * a flat rim band carrying the push buttons, a pyramidal canopy above it, a
 * narrow duct rising from the canopy top, and a recessed underside plenum with
 * two mesh grease filters flanked by two warm lamps.
 *
 * The canopy is a single `kit.frustum`. The reference's cheeks are flat sheet
 * meeting at crisp arrises: a 4-segment cylinder or lathe shares its seam
 * normals and smooth-shades the same shape into a warped cone, and a stack of
 * boxes reads as stairs.
 *
 * Anchoring: the rim's top face is the mount plane at y = 0, the rim hangs
 * below it and the duct ends exactly `height` above the rim's underside, so the
 * object fills its catalogue height with nothing to spare.
 *
 * Every layer is offset from its neighbour by at least 2 mm, and where two
 * faces do share a plane they either face opposite ways or sit inside the
 * solid, which is what keeps the underside free of z-fighting.
 */
export const buildHood: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const metal = kit.finish('metal');
  const accent = kit.finish('accent');
  const lamp = kit.finish('light');
  const frontZ = depth / 2;

  const rimHeight = 0.046; // the flat band under the canopy, metres
  const rimWall = 0.026; // how wide that band reads from below, metres
  const rimProud = 0.008; // how far the rim overhangs the canopy - the shadow line
  const canopyHeight = 0.215; // the sloping cheeks, metres
  const ductWidth = width / 3; // the reference duct is a third of the canopy
  const ductDepth = 0.18;
  const ductSink = 0.004; // the duct's foot buried in the canopy top
  const plenumThickness = 0.012; // sheet closing the canopy off above the filters
  const plenumGap = 0.002; // clearance under the canopy's base, so no faces meet
  const plenumWidth = width - rimWall * 2;
  const plenumDepth = depth - rimWall * 2;
  const plenumBottom = -plenumGap - plenumThickness;

  // ---- Rim: a frame, not a slab, so the underside is a real recess ----------

  put(
    group,
    kit.ring({ width, height: depth, radius: 0.002 }, { width: plenumWidth, height: plenumDepth, radius: 0.002 }, rimHeight),
    metal,
    { y: -rimHeight, rx: -Math.PI / 2 },
  ).name = 'hood-rim';

  // Plenum ceiling, oversized by 3 mm so its edges hide inside the rim.
  put(group, kit.box(plenumWidth + 0.006, plenumThickness, plenumDepth + 0.006), metal, {
    y: plenumBottom + plenumThickness / 2,
  }).name = 'hood-plenum';

  // ---- Canopy: one frustum, back face vertical, three cheeks sloping -------

  const canopyTopWidth = ductWidth + 0.024;
  const canopyTopDepth = ductDepth + 0.024;
  // Offsetting the top face back by half the depth it loses leaves the back
  // face vertical: it stands against the wall and cannot slope.
  const canopyTopZ = (canopyTopDepth - (depth - rimProud * 2)) / 2;
  put(group, kit.frustum(width - rimProud * 2, depth - rimProud * 2, canopyTopWidth, canopyTopDepth, canopyHeight, canopyTopZ), metal, {
    y: canopyHeight / 2,
  }).name = 'hood-canopy';

  // ---- Duct: a shallow shaft, barely tapered, ending at the catalogue height

  const ductHeight = height - rimHeight - canopyHeight + ductSink;
  const ductTopDepth = ductDepth - 0.008;
  put(group, kit.frustum(ductWidth, ductDepth, ductWidth - 0.012, ductTopDepth, ductHeight, (ductTopDepth - ductDepth) / 2), metal, {
    y: canopyHeight - ductSink + ductHeight / 2,
    z: canopyTopZ,
  }).name = 'hood-duct';

  // ---- Underside: two mesh grease filters, a strip of plenum between them --

  const plenumFront = frontZ - rimWall;
  const lampStrip = 0.08; // front band of the plenum the lamps sit in, metres
  const filterFront = plenumFront - lampStrip;
  const filterBack = -plenumFront + 0.008;
  const filterDepth = filterFront - filterBack;
  const filterZ = (filterFront + filterBack) / 2;
  const filterDivider = 0.012; // plenum left visible between the two cassettes
  const filterWidth = (plenumWidth - filterDivider - 0.016) / 2;
  const filterThickness = 0.014;
  const filterRim = 0.015; // cassette frame around the mesh, metres
  // The cassette's top is buried 3 mm in the plenum sheet, so its own top face
  // never shows; its bottom stays 21 mm above the rim's edge, which is the
  // recess the reference shows.
  const filterTop = plenumBottom + 0.003;
  const meshHeight = filterThickness - 0.004;

  for (const side of [-1, 1]) {
    const cx = side * (filterDivider / 2 + filterWidth / 2);
    put(
      group,
      kit.ring(
        { width: filterWidth, height: filterDepth, radius: 0.003 },
        { width: filterWidth - filterRim * 2, height: filterDepth - filterRim * 2, radius: 0.002 },
        filterThickness,
      ),
      metal,
      { x: cx, y: filterTop - filterThickness, z: filterZ, rx: -Math.PI / 2 },
    ).name = 'hood-filter';
    // Aluminium mesh, 4 mm up inside its frame: the shadow line is what reads
    // as a filter rather than a plate. Oversized so its edges hide in the frame.
    put(group, kit.box(filterWidth - filterRim * 2 + 0.004, meshHeight, filterDepth - filterRim * 2 + 0.004), metal, {
      x: cx,
      y: filterTop - meshHeight / 2,
      z: filterZ,
    }).name = 'hood-filter-mesh';
    // Release tab at the cassette's front edge.
    put(group, kit.box(0.05, 0.006, 0.016), accent, {
      x: cx,
      y: filterTop - filterThickness - 0.003,
      z: filterFront - 0.045,
    }).name = 'hood-filter-tab';
  }

  // ---- Two warm lamps in the front band of the plenum ----------------------

  const lampZ = plenumFront - 0.042;
  for (const side of [-1, 1]) {
    const lx = side * width * 0.24;
    // Bezel, then the lens standing 7 mm below it so the emissive face is what
    // the room sees. Emissive only - the hood adds no light to the scene.
    put(group, kit.cylinder(0.03, 0.028, 0.01, 16), metal, { x: lx, y: plenumBottom - 0.004, z: lampZ }).name = 'hood-lamp-bezel';
    put(group, kit.cylinder(0.023, 0.021, 0.012, 16), lamp, { x: lx, y: plenumBottom - 0.01, z: lampZ }).name = 'hood-lamp';
  }

  // ---- Four push buttons on the rim's front face, right of centre ----------

  const buttons = 4;
  const buttonSpacing = 0.024;
  const buttonCentre = width * 0.12;
  for (let index = 0; index < buttons; index += 1) {
    put(group, kit.cylinder(0.0085, 0.009, 0.005, 12), accent, {
      x: buttonCentre + (index - (buttons - 1) / 2) * buttonSpacing,
      y: -rimHeight / 2,
      z: frontZ + 0.0015,
      rx: Math.PI / 2,
    }).name = 'hood-button';
  }

  return group;
};

/* ----------------------------------------------------------------- sanitary */

export const buildVanity: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const topThickness = 0.05;
  const base = 0.16;
  const bodyHeight = height - base - topThickness;
  const frontDepth = 0.018;

  put(group, kit.box(width - 0.18, base, depth - 0.1), kit.finish('carcass'), { y: base / 2, z: -0.03 });
  put(group, kit.rounded(width, bodyHeight, depth, 0.008), kit.finish('carcass'), { y: base + bodyHeight / 2 });
  for (const side of [-1, 1]) {
    put(group, kit.rounded(width / 2 - 0.012, bodyHeight - 0.012, frontDepth, 0.006), kit.finish('front'), {
      x: (side * width) / 4,
      y: base + bodyHeight / 2,
      z: depth / 2 + frontDepth / 2,
    });
    barHandle(group, kit, 'metal', 0.14, side * width * 0.12, base + bodyHeight - 0.08, depth / 2 + frontDepth);
  }
  put(group, kit.rounded(width + 0.02, topThickness, depth + 0.02, 0.008), kit.finish('top'), { y: height - topThickness / 2 }).name =
    'vanity-top';

  // Vessel basin: an open cylinder with a rim, squashed into an oval. Open at
  // both ends: the stone top is its floor, and a capped one read as a full bowl.
  const ceramic = kit.finishDouble('ceramic');
  put(group, kit.cylinderOpen(0.185, 0.15, 0.13, 24), ceramic, { y: height + 0.062, sx: 1.45 }).name = 'vanity-basin';
  put(group, kit.torus(0.185, 0.011, 24), kit.finish('ceramic'), { y: height + 0.127, rx: Math.PI / 2, sx: 1.45, sz: 1.45 });
  mixerTap(group, kit, 'metal', 0, height + 0.02, -depth / 2 + 0.17, 0.24, 0.015);
  return group;
};

export const buildToilet: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const ceramic = kit.finish('ceramic');
  const cisternHeight = height * 0.53;

  put(group, kit.rounded(width - 0.02, cisternHeight, 0.19, 0.035), ceramic, { y: height - cisternHeight / 2, z: -depth / 2 + 0.095 });
  put(group, kit.rounded(width * 0.62, 0.36, depth * 0.42, 0.08), ceramic, { y: 0.18, z: -depth / 2 + 0.22 });
  put(group, kit.cylinder(0.175, 0.13, 0.2, 22), ceramic, { y: 0.38, z: 0.09, sz: 1.5 });
  put(group, kit.torus(0.172, 0.02, 22), ceramic, { y: 0.475, z: 0.09, rx: Math.PI / 2, sz: 1.5 });
  put(group, kit.cylinder(0.178, 0.178, 0.018, 22), ceramic, { y: 0.494, z: 0.09, sz: 1.5 });
  put(group, kit.cylinder(0.022, 0.022, 0.012, 12), kit.finish('metal'), { y: height + 0.006, z: -depth / 2 + 0.095 });
  return group;
};

export const buildBathtub: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, depth] = asset.dims;
  const wall = 0.075;
  put(
    group,
    kit.ring({ width, height: depth, radius: 0.16 }, { width: width - wall * 2, height: depth - wall * 2, radius: 0.12 }, height),
    kit.finish('ceramic'),
    { rx: -Math.PI / 2 },
  ).name = 'bath-shell';
  put(group, kit.rounded(width - wall * 2 + 0.02, 0.09, depth - wall * 2 + 0.02, 0.05), kit.finish('ceramic'), { y: 0.06 });
  // Drain disc at the tap end, on the tub floor.
  put(group, kit.cylinder(0.024, 0.024, 0.012, 12), kit.finish('metal'), { x: -width / 2 + 0.15, y: 0.111, z: 0.02 });
  mixerTap(group, kit, 'metal', -width / 2 + 0.15, height, 0.02, 0.28, 0.016);
  return group;
};
