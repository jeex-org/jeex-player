/**
 * The lighting context and its two rigs: the standard applied to one renderer.
 *
 * `createLightingContext(three, renderer)` binds the standard to the caller's
 * three.js namespace and renderer. It refuses a foreign engine revision and a
 * colour-managed pipeline other than linear sRGB before it allocates anything,
 * sets the renderer's display transform and shadow maps, and prefilters the
 * generated environment with the caller's `PMREMGenerator`. Rigs come from the
 * context and light one scene each.
 *
 * Ownership invariant: the context owns the prefiltered environment (the PMREM
 * render target, not only its texture) and every rig it made; a rig owns its
 * lights and their shadow maps. Disposing a context disposes its rigs first,
 * then the environment, so no rig is ever left lighting with a released
 * texture. Disposal is idempotent and never touches the caller's renderer,
 * scenes, models or materials. A creation that fails releases what it had
 * allocated.
 *
 * Attachment invariant: one rig per scene, across every context built from
 * this copy of the module (`SCENE_RIGS`; the player's bundles and the
 * published entry are separate copies, each with its own). Attaching saves the scene's environment, its intensity and
 * its rotation and sets the standard's; detaching restores each one only where
 * the scene still holds the value the rig set, so a caller's own change made
 * meanwhile survives.
 *
 * Type-only imports of `three`, no DOM, no listeners: a lost GPU context is the
 * caller's to answer, by disposing this context and creating a new one.
 */

import type { DataTexture, PMREMGenerator, WebGLRenderTarget, Group, Texture } from 'three';
import { LightingError } from './lighting-error.js';
import { apartmentEnvironmentIntensity, LIGHTING_STANDARD, referenceEnvironmentIntensity, type Triple } from './lighting-standard.js';
import { generateEnvironment, toHalfFloats } from './environment-recipe.js';
import { judgeApartmentRigOptions, type ApartmentRigOptions } from './lighting-options.schema.js';
import type { LightingRenderer, LightingScene, LightingThree } from './lighting-three.js';

/** Which rig: material review or the player's apartment. */
export type LightingRigKind = 'reference' | 'apartment';

/** A set of lights and the standard environment, attachable to one scene at a time. */
export type LightingRig = {
  readonly kind: LightingRigKind;
  /** The scene the rig lights now, or `null`. */
  readonly scene: LightingScene | null;
  /** Lights `scene`; again on the same scene does nothing. */
  attach(scene: LightingScene): void;
  /** Takes the rig off its scene and restores what it replaced; does nothing when not attached. */
  detach(): void;
  /** Detaches, then releases the lights and their shadow maps; idempotent. */
  dispose(): void;
};

/** The standard bound to one renderer. */
export type LightingContext = {
  /** The rig of material swatches and asset review: environment and one white key. */
  createReferenceRig(): LightingRig;
  /** The rig of the player's scenes: environment, sky, shadow-casting sun and fill. */
  createApartmentRig(options?: ApartmentRigOptions): LightingRig;
  /** Whether `dispose` has run. */
  readonly disposed: boolean;
  /** Disposes every rig of this context, then the environment; idempotent. */
  dispose(): void;
};

/** Which rig lights which scene, for every context of the page. */
const SCENE_RIGS = new WeakMap<LightingScene, Rig>();

/** The environment's half-float texels, computed once: the recipe is fixed. */
let environmentTexels: Uint16Array | null = null;

function texels(): Uint16Array {
  environmentTexels ??= toHalfFloats(generateEnvironment(LIGHTING_STANDARD.environment.recipe));
  return environmentTexels;
}

/** What `attach` replaced on a scene, and what it set there. */
type Saved = {
  environment: Texture | null;
  intensity: number;
  rotation: [number, number, number, string];
};

class Rig implements LightingRig {
  readonly kind: LightingRigKind;
  private readonly group: Group;
  private readonly environment: Texture;
  private readonly intensity: number;
  private readonly forget: (rig: Rig) => void;
  private attached: LightingScene | null = null;
  private saved: Saved | null = null;
  private released = false;

  constructor(kind: LightingRigKind, group: Group, environment: Texture, intensity: number, forget: (rig: Rig) => void) {
    this.kind = kind;
    this.group = group;
    this.environment = environment;
    this.intensity = intensity;
    this.forget = forget;
  }

  get scene(): LightingScene | null {
    return this.attached;
  }

  attach(scene: LightingScene): void {
    if (this.released) throw new LightingError('disposed', `the ${this.kind} rig was disposed`);
    if (this.attached === scene) return;
    if (this.attached !== null) throw new LightingError('rig-attached', `the ${this.kind} rig is already attached to another scene`);
    if (SCENE_RIGS.has(scene)) throw new LightingError('scene-has-rig', 'the scene already carries a lighting rig');
    const rotation = scene.environmentRotation;
    this.saved = {
      environment: scene.environment,
      intensity: scene.environmentIntensity,
      rotation: [rotation.x, rotation.y, rotation.z, rotation.order],
    };
    scene.environment = this.environment;
    scene.environmentIntensity = this.intensity;
    rotation.set(0, 0, 0);
    scene.add(this.group);
    SCENE_RIGS.set(scene, this);
    this.attached = scene;
  }

  detach(): void {
    const scene = this.attached;
    const saved = this.saved;
    if (scene === null || saved === null) return;
    scene.remove(this.group);
    if (scene.environment === this.environment) scene.environment = saved.environment;
    if (scene.environmentIntensity === this.intensity) scene.environmentIntensity = saved.intensity;
    const rotation = scene.environmentRotation;
    if (rotation.x === 0 && rotation.y === 0 && rotation.z === 0) {
      const [x, y, z, order] = saved.rotation;
      rotation.set(x, y, z, order as typeof rotation.order);
    }
    SCENE_RIGS.delete(scene);
    this.attached = null;
    this.saved = null;
  }

  dispose(): void {
    if (this.released) return;
    this.detach();
    this.released = true;
    this.group.traverse((object) => {
      (object as { dispose?: () => void }).dispose?.();
    });
    this.group.clear();
    this.forget(this);
  }
}

/** `object.position` set from a frozen triple. */
function place(object: { position: { set(x: number, y: number, z: number): unknown } }, at: Triple): void {
  object.position.set(at[0], at[1], at[2]);
}

class Context implements LightingContext {
  private readonly three: LightingThree;
  private readonly renderer: LightingRenderer;
  private readonly target: WebGLRenderTarget;
  private readonly rigs = new Set<Rig>();
  private released = false;

  constructor(three: LightingThree, renderer: LightingRenderer, target: WebGLRenderTarget) {
    this.three = three;
    this.renderer = renderer;
    this.target = target;
  }

  get disposed(): boolean {
    return this.released;
  }

  createReferenceRig(): LightingRig {
    this.refuseDisposed();
    const { key } = LIGHTING_STANDARD.reference;
    const group = this.group('reference');
    const light = new this.three.DirectionalLight(key.colour, key.intensity);
    light.name = 'jeex-lighting-key';
    light.castShadow = false;
    place(light, key.position);
    group.add(light, light.target);
    return this.adopt('reference', group, referenceEnvironmentIntensity());
  }

  createApartmentRig(options?: ApartmentRigOptions): LightingRig {
    this.refuseDisposed();
    const verdict = judgeApartmentRigOptions(options);
    if (!verdict.ok) throw new LightingError('bad-options', verdict.message);
    const { hemisphere, sun, fill } = LIGHTING_STANDARD.apartment;
    const shadow = sun.shadow;
    const size = Math.min(verdict.value.shadowMapSize ?? shadow.defaultMapSize, this.renderer.capabilities.maxTextureSize);
    const group = this.group('apartment');

    const sky = new this.three.HemisphereLight(hemisphere.sky, hemisphere.ground, hemisphere.intensity);
    sky.name = 'jeex-lighting-sky';
    group.add(sky);

    const sunLight = new this.three.DirectionalLight(sun.colour, sun.intensity);
    sunLight.name = 'jeex-lighting-sun';
    place(sunLight, sun.position);
    place(sunLight.target, sun.target);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(size, size);
    const camera = sunLight.shadow.camera;
    camera.left = -shadow.extent;
    camera.right = shadow.extent;
    camera.top = shadow.extent;
    camera.bottom = -shadow.extent;
    camera.near = shadow.near;
    camera.far = shadow.far;
    sunLight.shadow.bias = shadow.bias;
    sunLight.shadow.normalBias = shadow.normalBias;
    group.add(sunLight, sunLight.target);

    const fillLight = new this.three.DirectionalLight(fill.colour, fill.intensity);
    fillLight.name = 'jeex-lighting-fill';
    fillLight.castShadow = false;
    place(fillLight, fill.position);
    group.add(fillLight, fillLight.target);
    return this.adopt('apartment', group, apartmentEnvironmentIntensity());
  }

  dispose(): void {
    if (this.released) return;
    this.released = true;
    for (const rig of [...this.rigs]) rig.dispose();
    this.target.dispose();
  }

  private group(kind: LightingRigKind): Group {
    const group = new this.three.Group();
    group.name = `jeex-lighting-${kind}-rig`;
    return group;
  }

  private adopt(kind: LightingRigKind, group: Group, intensity: number): Rig {
    const rig = new Rig(kind, group, this.target.texture, intensity, (gone) => this.rigs.delete(gone));
    this.rigs.add(rig);
    return rig;
  }

  private refuseDisposed(): void {
    if (this.released) throw new LightingError('disposed', 'the lighting context was disposed');
  }
}

/**
 * The prefiltered environment: the recipe's texels uploaded as a half-float
 * equirectangular texture and converted by the caller's `PMREMGenerator`. The
 * source texture and the generator are released whatever happens.
 */
function prefilteredEnvironment(three: LightingThree, renderer: LightingRenderer): WebGLRenderTarget {
  const { width, height } = LIGHTING_STANDARD.environment.recipe;
  let source: DataTexture | null = null;
  let generator: PMREMGenerator | null = null;
  try {
    source = new three.DataTexture(texels(), width, height, three.RGBAFormat, three.HalfFloatType);
    source.mapping = three.EquirectangularReflectionMapping;
    source.colorSpace = three.LinearSRGBColorSpace;
    source.minFilter = three.LinearFilter;
    source.magFilter = three.LinearFilter;
    source.generateMipmaps = false;
    source.needsUpdate = true;
    generator = new three.PMREMGenerator(renderer);
    return generator.fromEquirectangular(source);
  } finally {
    source?.dispose();
    generator?.dispose();
  }
}

/**
 * The standard bound to `renderer`, built with the caller's `three`.
 *
 * Throws `LightingError` `engine-revision` or `colour-management` before
 * anything is allocated or any setting changed.
 */
export function createLightingContext(three: LightingThree, renderer: LightingRenderer): LightingContext {
  const expected = LIGHTING_STANDARD.engineRevision;
  if (three.REVISION !== expected) {
    throw new LightingError(
      'engine-revision',
      `the lighting standard needs three.js revision ${expected}; the three.js passed in is revision ${three.REVISION}`,
    );
  }
  const management = three.ColorManagement;
  if (!management.enabled || management.workingColorSpace !== three.LinearSRGBColorSpace) {
    throw new LightingError(
      'colour-management',
      'the lighting standard needs three.js colour management on, with a linear sRGB working space',
    );
  }
  renderer.toneMapping = three.NeutralToneMapping;
  renderer.toneMappingExposure = LIGHTING_STANDARD.display.exposure;
  renderer.outputColorSpace = three.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = three.PCFShadowMap;
  return new Context(three, renderer, prefilteredEnvironment(three, renderer));
}
