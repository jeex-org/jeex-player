/**
 * Procedural builders for lighting fixtures and decor: lamps, pendants,
 * ceiling lights, rugs, art, mirrors, coat racks. The houseplants have their
 * own module (`asset-builders-plants.ts`): four species built to reference
 * photographs do not fit beside a rug.
 *
 * See the conventions list in `asset-builders.ts` for the anchor/orientation
 * rules every builder here follows.
 *
 * Invariant: builders only ever take geometry from the shared cache and
 * materials from the finish registry - they never create or dispose either.
 */

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { readOptions, type OptionSpec } from './asset-options.js';
import { put, type BuildKit, type Builder } from './asset-kit.js';
import { mainPassOnly } from './mirror-capture.js';

/* ----------------------------------------------------------------- lighting */

/** Turned stem for the floor lamp, nominal 1.0 m, scaled per mesh to the stem's real run. */
const LAMP_STEM_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.018, 0.0],
  [0.018, 0.008],
  [0.013, 0.02],
  [0.011, 0.9],
  [0.013, 0.94],
  [0.0112, 0.98],
  [0.0122, 1.0],
];

/** Turned post for the coat rack, nominal 0.96 m, scaled per mesh to the post's real run. */
const RACK_POST_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.026, 0.0],
  [0.026, 0.01],
  [0.019, 0.024],
  [0.015, 0.5],
  [0.0165, 0.62],
  [0.0142, 0.9],
  [0.015, 0.96],
];

/**
 * `buildLamp`. `lightIntensity` and `lightDistance` are the two options every
 * light in the bank shares — spelled out per builder rather than shared,
 * because the defaults differ by fitting.
 */
const LAMP_OPTIONS = {
  base: { kind: 'text', values: ['disc', 'dome'], default: 'disc' },
  lightIntensity: { kind: 'number', default: 2.4, min: 0 },
  lightDistance: { kind: 'number', default: 4.2, min: 0 },
} as const satisfies Record<string, OptionSpec>;

export const buildLamp: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height] = asset.dims;
  const options = readOptions(asset.options, LAMP_OPTIONS);
  const shadeHeight = Math.min(0.34, Math.max(0.14, height * 0.22));
  const shadeBottom = width / 2;
  const shadeTop = shadeBottom * 0.66;
  const metal = kit.finish('metal');
  const dome = options.base === 'dome';

  if (dome) {
    put(group, kit.cylinder(width * 0.22, width * 0.36, height * 0.2, 20), metal, { y: height * 0.1 });
  } else {
    put(group, kit.cylinder(width * 0.4, width * 0.42, 0.026, 24), metal, { y: 0.013 });
    put(group, kit.cylinder(width * 0.16, width * 0.24, 0.055, 18), metal, { y: 0.052 });
  }
  const stemBottom = dome ? height * 0.2 : 0.075;
  const stemTop = height - shadeHeight;
  put(group, kit.lathe(LAMP_STEM_PROFILE, 12), metal, { y: stemBottom, sy: Math.max(0.02, stemTop - stemBottom) });
  // Socket cap where the stem meets the shade opening.
  put(group, kit.cylinder(shadeTop * 0.5, shadeTop * 0.34, 0.03, 12), metal, { y: stemTop + 0.015 });

  put(group, kit.cylinderOpen(shadeTop, shadeBottom, shadeHeight, 26), kit.finishDouble('shade'), { y: stemTop + shadeHeight / 2 });
  put(group, kit.circleRing(shadeTop, 0.012, 0.004), kit.finish('shade'), { y: stemTop + shadeHeight, rx: -Math.PI / 2 });

  const bulb = new THREE.PointLight('#ffd9a4', options.lightIntensity, options.lightDistance, 2);
  bulb.position.y = stemTop + shadeHeight * 0.45;
  bulb.name = `${asset.placementId}-light`;
  group.add(bulb);
  return group;
};

/**
 * Pendant hanging from the ceiling plane at the origin.
 *
 * `dims[1]` is the drop: the distance from the ceiling down to the *bottom* of
 * the shade, already clamped to the room by `clampHangingDrop`. Everything is
 * measured from y = 0 downward, so the fixture is flush with whatever ceiling
 * the scene has and never pokes through it.
 */
/** `buildPendant`; `shape` picks the shade, and each shape has its own height. */
const PENDANT_OPTIONS = {
  shape: { kind: 'text', values: ['cone', 'dome', 'globe'], default: 'cone' },
  lightIntensity: { kind: 'number', default: 1.8, min: 0 },
  lightDistance: { kind: 'number', default: 5.2, min: 0 },
} as const satisfies Record<string, OptionSpec>;

export const buildPendant: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, drop] = asset.dims;
  const options = readOptions(asset.options, PENDANT_OPTIONS);
  const shape = options.shape;
  const metal = kit.finish('metal');
  const radius = width / 2;
  const shadeHeight = shape === 'globe' ? radius * 1.24 : shape === 'dome' ? radius * 0.62 : radius * 0.85;
  const shadeTopY = -Math.max(0.02, drop - shadeHeight);

  put(group, kit.cylinder(0.055, 0.055, 0.02, 14), metal, { y: -0.01 });
  put(group, kit.cylinder(0.005, 0.005, -shadeTopY, 6), metal, { y: shadeTopY / 2 });
  // Socket cap where the cord enters the shade.
  put(group, kit.cylinder(0.02, 0.03, 0.04, 12), metal, { y: shadeTopY + 0.012 });

  if (shape === 'globe') {
    put(group, kit.sphere(radius * 0.62, 20), kit.finish('shade'), { y: shadeTopY - shadeHeight / 2 });
  } else if (shape === 'dome') {
    put(group, kit.cylinderOpen(radius * 0.3, radius, shadeHeight, 24), kit.finishDouble('shade'), { y: shadeTopY - shadeHeight / 2 });
  } else {
    put(group, kit.cylinderOpen(radius * 0.28, radius, shadeHeight, 24), kit.finishDouble('shade'), { y: shadeTopY - shadeHeight / 2 });
    put(group, kit.sphere(0.045, 12), kit.finish('shade'), { y: shadeTopY - shadeHeight * 0.72 });
  }

  const bulb = new THREE.PointLight('#ffd9a4', options.lightIntensity, options.lightDistance, 2);
  bulb.position.y = shadeTopY - shadeHeight * 0.6;
  bulb.name = `${asset.placementId}-light`;
  group.add(bulb);
  return group;
};

/**
 * Flush ceiling light: a shallow dome under the ceiling plane at the origin.
 * `dims[1]` is how far it hangs below that plane.
 */
/** `buildCeilingLight`: a flush fitting, so only the lamp itself is optional. */
const CEILING_LIGHT_OPTIONS = {
  lightIntensity: { kind: 'number', default: 2.6, min: 0 },
  lightDistance: { kind: 'number', default: 7.5, min: 0 },
} as const satisfies Record<string, OptionSpec>;

export const buildCeilingLight: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, drop] = asset.dims;
  const options = readOptions(asset.options, CEILING_LIGHT_OPTIONS);
  const radius = width / 2;
  const domeHeight = Math.max(0.04, drop - 0.04);
  put(group, kit.cylinder(radius * 0.92, radius * 0.98, 0.03, 26), kit.finish('metal'), { y: -0.015 });
  put(group, kit.cylinderOpen(radius, radius * 0.72, domeHeight, 26), kit.finishDouble('shade'), { y: -0.03 - domeHeight / 2 });
  put(group, kit.cylinder(radius * 0.72, radius * 0.72, 0.012, 26), kit.finish('shade'), { y: -0.03 - domeHeight - 0.006 });
  const bulb = new THREE.PointLight('#ffd9a4', options.lightIntensity, options.lightDistance, 2);
  bulb.position.y = -drop - 0.1;
  bulb.name = `${asset.placementId}-light`;
  group.add(bulb);
  return group;
};

/* -------------------------------------------------------------------- decor */

/** `buildRug`; `border` is the inset of the woven trim, capped by the rug's own size. */
const RUG_OPTIONS = {
  border: { kind: 'number', default: 0.13, min: 0 },
} as const satisfies Record<string, OptionSpec>;

export const buildRug: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, thickness, depth] = asset.dims;
  const border = Math.min(readOptions(asset.options, RUG_OPTIONS).border, Math.min(width, depth) * 0.22);
  const pile = put(group, kit.rounded(width, thickness, depth, 0.008), kit.finish('top'), { y: thickness / 2 });
  pile.castShadow = false;
  const trim = put(
    group,
    kit.ring(
      { width: width - 0.1, height: depth - 0.1, radius: 0.03 },
      { width: width - 0.1 - border * 2, height: depth - 0.1 - border * 2, radius: 0.02 },
      0.004,
    ),
    kit.finish('accent'),
    { y: thickness + 0.002, rx: -Math.PI / 2 },
  );
  trim.castShadow = false;
  // Fringe: strands at the two short ends, lying flat on the floor.
  const tufts = Math.max(5, Math.round((depth - 0.2) / 0.13));
  const span = Math.max(0.08, depth - 0.18);
  for (const sign of [-1, 1]) {
    for (let index = 0; index < tufts; index += 1) {
      const strand = put(group, kit.cylinder(0.004, 0.004, 0.036, 6), kit.finish('accent'), {
        x: sign * (width / 2 + 0.017),
        y: thickness * 0.5,
        z: -span / 2 + (span / (tufts - 1)) * index,
        rz: Math.PI / 2,
      });
      strand.castShadow = false;
    }
  }
  return group;
};

/** `buildArt`; `mat` is the mount board's width inside the frame, metres. */
const ART_OPTIONS = {
  mat: { kind: 'number', default: 0.11, min: 0 },
} as const satisfies Record<string, OptionSpec>;

export const buildArt: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, thickness] = asset.dims;
  const frameWidth = 0.036;
  const { mat } = readOptions(asset.options, ART_OPTIONS);
  put(
    group,
    kit.ring(
      { width, height, radius: 0.006 },
      { width: width - frameWidth * 2, height: height - frameWidth * 2, radius: 0.004 },
      thickness,
    ),
    kit.finish('frame'),
  );
  put(group, kit.box(width - frameWidth * 2, height - frameWidth * 2, 0.005), kit.finish('top'), { z: thickness * 0.55 });
  const artWidth = width - frameWidth * 2 - mat * 2;
  const artHeight = height - frameWidth * 2 - mat * 2;
  put(group, kit.box(artWidth, artHeight, 0.004), kit.finish('accent'), { z: thickness * 0.55 + 0.004 });
  put(group, kit.cylinder(artHeight * 0.22, artHeight * 0.22, 0.003, 26), kit.finish('top'), {
    x: -artWidth * 0.16,
    y: artHeight * 0.1,
    z: thickness * 0.55 + 0.007,
    rx: Math.PI / 2,
  });
  return group;
};

/** `buildMirror`; round by default, rectangular when the manifest says so. */
const MIRROR_OPTIONS = {
  shape: { kind: 'text', values: ['round', 'rect'], default: 'round' },
} as const satisfies Record<string, OptionSpec>;

/** Edge of the mirror reflection render target, pixels. */
const MIRROR_RT_SIZE = 512;
/** Real mirrors reflect most of the light; a faint cool tint trims the pass toward that instead of chrome. */
const MIRROR_TINT = '#d9dcdf';

/**
 * Mirror glass lives in two states. Until a real user touches the page, the
 * glass is a plain finished disc - the live planar reflection is simply not
 * mounted. The first TRUSTED pointer, wheel or key event arms the page: every
 * mirror then swaps its flat glass for a `Reflector` and re-renders the scene
 * per frame from there on. Untouched viewers (test workers dispatching
 * synthetic events, kiosk stills, embeds below the fold) therefore cost
 * nothing per frame, and a real visitor never sees the swap - it happens the
 * moment they start moving the camera anyway. The listeners are page-global
 * and install once per document running this module.
 */
let mirrorArmed = false;
const mirrorArmCallbacks = new Set<() => void>();
const mirrorArmController = new AbortController();

function armMirrors(event: Event): void {
  // Synthetic events (test dispatches, scripted demos) must not arm the
  // reflection: a page full of scripted viewers would mount one live render
  // pass per mirror and stall. Only trusted input - a real user - does.
  if (!event.isTrusted) return;
  if (mirrorArmed) return;
  mirrorArmed = true;
  mirrorArmController.abort();
  for (const callback of [...mirrorArmCallbacks]) callback();
  mirrorArmCallbacks.clear();
}

/**
 * Registers `callback` for the arming gesture and returns the de-registration.
 * Handing the removal BACK is what makes the leak impossible to reintroduce:
 * the caller cannot register without holding the way out, so there is no code
 * path that pins a build in the page-global set and forgets to release it.
 */
function onMirrorsArm(callback: () => void): () => void {
  if (mirrorArmed) {
    callback();
    return () => {};
  }
  mirrorArmCallbacks.add(callback);
  return () => {
    mirrorArmCallbacks.delete(callback);
  };
}

if (typeof window !== 'undefined') {
  const signal = mirrorArmController.signal;
  window.addEventListener('pointerdown', armMirrors, { signal, passive: true });
  window.addEventListener('pointermove', armMirrors, { signal, passive: true });
  window.addEventListener('wheel', armMirrors, { signal, passive: true });
  window.addEventListener('keydown', armMirrors, { signal, passive: true });
}

export const buildMirror: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height, thickness] = asset.dims;
  if (readOptions(asset.options, MIRROR_OPTIONS).shape === 'rect') {
    const frameWidth = 0.03;
    put(
      group,
      kit.ring(
        { width, height, radius: 0.02 },
        { width: width - frameWidth * 2, height: height - frameWidth * 2, radius: 0.014 },
        thickness,
      ),
      kit.finish('frame'),
    );
    const flat = put(group, kit.plane(width - frameWidth * 2, height - frameWidth * 2), kit.finish('glass'), { z: thickness * 0.6 });
    flat.name = 'mirror-glass';
    swapInMirrorGlass(group, kit, flat, kit.plane(width - frameWidth * 2, height - frameWidth * 2), thickness);
    return group;
  }
  const radius = width / 2;
  put(group, kit.circleRing(radius, radius - 0.034, thickness), kit.finish('frame'));
  const flat = put(group, kit.circle(radius - 0.032, 64), kit.finish('glass'), { z: thickness * 0.6 });
  flat.name = 'mirror-glass';
  swapInMirrorGlass(group, kit, flat, kit.circle(radius - 0.032, 64), thickness);
  return group;
};

/**
 * Swaps a mounted flat-glass mesh for a live `Reflector` once the page is
 * armed. The reflector renders the scene from a mirrored camera into its own
 * target every frame - the one builder-owned live resource in the bank - so
 * its GPU resources are registered through `kit.ownDispose` and the flat glass
 * it replaces stays cached and untouched.
 */
function swapInMirrorGlass(group: THREE.Group, kit: BuildKit, flat: THREE.Mesh, geometry: THREE.BufferGeometry, thickness: number): void {
  const swap = (): void => {
    const glass = new Reflector(geometry, {
      clipBias: 0.003,
      textureWidth: MIRROR_RT_SIZE,
      textureHeight: MIRROR_RT_SIZE,
      color: MIRROR_TINT,
    });
    glass.position.z = thickness * 0.6;
    glass.name = 'mirror-glass';
    // One capture per FRAME, not per pass: the scene's transmissive materials
    // make `WebGLRenderer` run a transmission pass first, and that pass calls
    // `onBeforeRender` too - a second full scene render per mirror per frame
    // (`mirror-capture.ts`).
    // `bind` because the pass is a method reference reading `this` (its
    // reflection camera, its `forceUpdate` flag) and the receiver is this
    // reflector for good - which is also what satisfies `unbound-method`.
    glass.onBeforeRender = mainPassOnly(glass.onBeforeRender.bind(glass));
    flat.visible = false;
    group.add(glass);
    kit.ownDispose(() => {
      glass.getRenderTarget().dispose();
      const materials = Array.isArray(glass.material) ? glass.material : [glass.material];
      for (const material of materials) material.dispose();
    });
  };
  // The arm callback captures this whole build, so it MUST leave the page-global
  // registry when the viewer is disposed - otherwise every mount cycle pins one
  // more scene graph until the first user gesture fires them all at a corpse.
  // Registration and removal are ONE statement, so no future edit can move the
  // removal inside `swap` (where it would only run for a page that armed).
  kit.ownDispose(onMirrorsArm(swap));
}
/** `buildCoatRack`; `hooks` alternate between two levels around the post. */
const COAT_RACK_OPTIONS = {
  hooks: { kind: 'number', default: 4, min: 3, integer: true },
} as const satisfies Record<string, OptionSpec>;

export const buildCoatRack: Builder = (asset, kit) => {
  const group = new THREE.Group();
  const [width, height] = asset.dims;
  const { hooks } = readOptions(asset.options, COAT_RACK_OPTIONS);
  const frame = kit.finish('frame');
  put(group, kit.cylinder(width * 0.46, width * 0.5, 0.024, 24), frame, { y: 0.012 });
  put(group, kit.cylinder(width * 0.3, width * 0.34, 0.02, 18), frame, { y: 0.034 });
  put(group, kit.lathe(RACK_POST_PROFILE, 12), frame, { y: 0.044, sy: (height - 0.072) / 0.96 });
  for (let index = 0; index < hooks; index += 1) {
    const angle = (index / hooks) * Math.PI * 2;
    const level = height - 0.12 - (index % 2) * 0.16;
    const hook = put(group, kit.cylinder(0.013, 0.011, 0.17, 8), frame, {
      x: Math.cos(angle) * 0.085,
      y: level,
      z: Math.sin(angle) * 0.085,
    });
    hook.rotation.set(Math.sin(angle) * 1.05, 0, Math.cos(angle) * 1.05);
    put(group, kit.sphere(0.018, 10), kit.finish('metal'), {
      x: Math.cos(angle) * 0.15,
      y: level - 0.06,
      z: Math.sin(angle) * 0.15,
    });
  }
  put(group, kit.sphere(0.032, 12), kit.finish('metal'), { y: height - 0.01 });
  return group;
};
