/**
 * The walk and tour post-processing chain: ambient occlusion (GTAO) and SMAA
 * over the lit scene, then the lighting standard's display transform.
 *
 * The only module that imports three's post-processing addons. It is loaded
 * on demand (`app/walk-post-controller.ts`): a separate chunk in the ES and
 * demo builds, inline in the IIFE build, which cannot split code.
 *
 * Chain: scene pass → GTAO → SMAA → output pass, on half-float composer
 * targets without multisampling. The scene pass renders into a plain target,
 * where three applies no tone mapping and keeps the working (linear) colour
 * space; SMAA expects linear input; the output pass applies the camera white
 * balance (one linear 3x3 matrix, clamped at zero, `white-balance.ts`), then
 * the renderer's tone mapping (PBR Neutral), exposure and sRGB encoding once. The renderer's
 * own tone mapping setting stays as the lighting standard set it, because the
 * output pass reads it from there.
 *
 * Mirror invariant: the scene pass draws inside the beauty-pass scope
 * (`shared/scene-pass.ts`), naming the composer buffer it binds, so a mirror
 * captures there once per frame and never in GTAO's own render of the scene.
 *
 * Occlusion invariant: GTAO's input render sees only opaque meshes on layer 0
 * (`ao-occluders.ts`), and its buffer follows the drawing buffer on every
 * resize.
 *
 * Disposal invariant: three's `EffectComposer.dispose` does not dispose the
 * passes and `GTAOPass.dispose` leaves its AO and blend materials, so
 * `dispose` here releases every pass and both materials itself.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { warmPrograms } from './scene-compile.js';
import { withScenePass } from '../shared/scene-pass.js';
import { withOccludersOnly } from './ao-occluders.js';
import type { PostProcessor } from './post-processor.js';
import { ViewerLibError } from '../shared/errors.js';
import { whiteBalanceMatrix, type Mat3 } from './white-balance.js';

// The walk and tour room lighting travels in this chunk: one lazy load for everything walk adds.
export { WalkLighting } from './walk-lighting/walk-lighting.js';
// A host's sky (`lighting.hdri`): its decoder and its scene state travel here too.
export { loadHdriEnvironment, loadHdriSky } from './hdri/hdri-assets.js';
export { HdriSky } from './hdri/hdri-sky.js';

/** The chain's tuning, in one place. */
export const WALK_POST_TUNING = Object.freeze({
  /** GTAO sampling radius in world space, metres. */
  aoRadiusM: 0.3,
  /**
   * The occlusion buffer's size as a fraction of the drawing buffer, per side.
   * Full: at 0.5 the bilinear upsampling of the blend crossed depth breaks and
   * left stair-stepped halos on door and table edges. The quality-tier step
   * decides a lower value per tier.
   */
  aoResolutionScale: 1,
  /** Composer colour targets: linear half float, so highlights survive until the output pass. */
  colourType: THREE.HalfFloatType,
  /** Multisampling of the composer targets: none; SMAA smooths the edges. */
  samples: 0,
  /**
   * GTAO's Poisson denoise (three r186 `PoissonDenoiseShader`): a neighbour's
   * weight falls linearly to zero at `depthPhi` metres off the centre's plane
   * and with the normals' cosine to the power `normalPhi`. The pass's own
   * `depthPhi` of 2 m blurred the occlusion of a picture frame or a toilet
   * across the wall behind it as dark blotches.
   */
  denoise: Object.freeze({ depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 6, samples: 16 }),
  /**
   * The fixed camera white balance, applied while the room lighting is live
   * but no room balance answers (a device that cannot read the room
   * measurement back, or a capture point outside every room); before the
   * room lighting is live the frame takes no balance
   * (`WalkLightingController.balance`), and `walk-lighting/room-balance.ts`
   * sets each room's once it is: a partial adaptation from `source`, the
   * measured linear colour of the neutral surfaces, towards the display
   * white, by `degree` (`white-balance.ts`). Measured 2026-10-25 on the demo
   * apartment's living-room ceiling at the walk start (the default sun preset
   * and lamps, the lamps feeding the room grids, the room lighting live), in
   * scene-linear colour (the live scene rendered into a float target: no tone
   * mapping, no exposure), on an NVIDIA GPU: linear (0.2827, 0.1936, 0.1152),
   * red over blue 2.453 (2.086 on 2026-10-24, before the lamps fed the
   * grids); the living walls in view carry the sand finish and are not
   * neutral, so the ceiling alone is the source (normalised to red). The
   * degree puts the ceiling at red over blue 1.45, the middle of the
   * warm-white band 1.3-1.6, with red > green > blue: warm white, not peach.
   * `tests/component/walk-glossy.test.ts` repeats the measurement.
   */
  whiteBalance: Object.freeze({ source: Object.freeze([1, 0.6846, 0.4076] as const), degree: 0.554 }),
});

/** The tuned white balance the chain applies when no room balance answers. */
export const WALK_WHITE_BALANCE: Mat3 = whiteBalanceMatrix(WALK_POST_TUNING.whiteBalance.source, WALK_POST_TUNING.whiteBalance.degree);

/** The line of three r186's `OutputShader` the white balance follows: the linear colour just read. */
const OUTPUT_READ = 'gl_FragColor = texture2D( tDiffuse, vUv );';
const OUTPUT_SAMPLER = 'uniform sampler2D tDiffuse;';

/**
 * Three's output fragment shader with the white balance applied to the colour
 * it reads, before tone mapping and encoding; refuses a shader without the
 * anchors, so a three upgrade that changes the shader fails loudly.
 */
export function whiteBalancedOutput(fragment: string): string {
  if (!fragment.includes(OUTPUT_READ) || !fragment.includes(OUTPUT_SAMPLER)) {
    throw new ViewerLibError('internal', 'the output shader has no anchor for the white balance');
  }
  return fragment
    .replace(OUTPUT_SAMPLER, `${OUTPUT_SAMPLER}\nuniform mat3 jeexWhiteBalance;`)
    .replace(OUTPUT_READ, `${OUTPUT_READ}\ngl_FragColor.rgb = max( jeexWhiteBalance * gl_FragColor.rgb, vec3( 0.0 ) );`);
}

/**
 * Where the chain takes a camera balance from (`walk-lighting/room-balance.ts`):
 * the live one for the screen, a room's at a capture's camera; `null` keeps
 * the chain's own.
 */
export type BalanceSource = {
  live(): Mat3 | null;
  at(position: { x: number; y: number; z: number }): Mat3 | null;
};

/** Options of a chain; the white balance defaults to the tuned one, and a balance source, when given, overrides it. */
export type WalkPostOptions = {
  whiteBalance?: Mat3 | undefined;
  balance?: BalanceSource | undefined;
  tier?: WalkPostTierInputs | undefined;
};

/**
 * The per-tier inputs the chain takes (quality tiers, `quality-tier.ts`): the
 * occlusion buffer's resolution scale, the GTAO denoise and the GTAO ray
 * count. The ray count is a shader define: three sets needsUpdate and relinks
 * that one program on a live switch (`applyTier`); the denoise is uniforms
 * and defines the material applies itself; the scale is effective at the next
 * `setSize`.
 */
export type WalkPostTierInputs = {
  aoResolutionScale: number;
  denoise: { depthPhi: number; normalPhi: number; lumaPhi: number; radius: number; samples: number };
  gtaoSamples: number;
};

/** The inputs the chain ran with before the tiers existed: the tuning and three's default ray count. */
export const WALK_POST_DEFAULT_TIER: WalkPostTierInputs = Object.freeze({
  aoResolutionScale: WALK_POST_TUNING.aoResolutionScale,
  denoise: WALK_POST_TUNING.denoise,
  gtaoSamples: 16,
});

/** The scene pass, drawing inside the beauty-pass scope a mirror captures in. */
class BeautyPass extends RenderPass {
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const target = this.renderToScreen ? null : readBuffer;
    withScenePass(renderer, { target, scene: this.scene, camera: this.camera }, () =>
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive),
    );
  }
}

/** GTAO at the occlusion buffer's scale, fed by opaque surfaces only, releasing everything it made. */
class OcclusionPass extends GTAOPass {
  /** The occlusion buffer's size as a fraction of the drawing buffer, per side; a tier may lower it. */
  aoScale: number;

  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number, aoScale: number) {
    super(scene, camera, width, height);
    this.aoScale = aoScale;
  }

  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.floor(width * this.aoScale)), Math.max(1, Math.floor(height * this.aoScale)));
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    // The only scene render in this pass is its normal and depth input; the
    // rest are full-screen quads, which the hidden objects do not affect.
    withOccludersOnly(this.scene, () => super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive));
  }

  override dispose(): void {
    super.dispose();
    this.gtaoMaterial.dispose();
    this.blendMaterial.dispose();
  }
}

/** SMAA's lookup textures as three r186 names them (its type declarations still use older names). */
type SmaaTextures = { _areaTexture: THREE.Texture; _searchTexture: THREE.Texture };

/** The chain on one renderer; build it with `createWalkPost`. */
export class WalkPost implements PostProcessor {
  readonly composer: EffectComposer;
  readonly beauty: BeautyPass;
  readonly occlusion: OcclusionPass;
  readonly smaa: SMAAPass;
  readonly output: OutputPass;
  /** The white balance the output pass applies when no balance source answers, row-major. */
  readonly whiteBalance: Mat3;
  private readonly balance: BalanceSource | null;
  private readonly renderer: THREE.WebGLRenderer;
  /** The tier inputs the chain runs on now; `applyTier` retunes them. */
  private tier: WalkPostTierInputs;
  /** The composer's size in device pixels now: the live size, or the last capture's until the next live frame. */
  private width: number;
  private height: number;
  /** The live drawing buffer's size in device pixels, which the next live frame restores. */
  private liveWidth: number;
  private liveHeight: number;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, options: WalkPostOptions = {}) {
    this.renderer = renderer;
    this.tier = options.tier ?? WALK_POST_DEFAULT_TIER;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.width = Math.max(1, size.x);
    this.height = Math.max(1, size.y);
    this.liveWidth = this.width;
    this.liveHeight = this.height;
    const target = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: WALK_POST_TUNING.colourType,
      samples: WALK_POST_TUNING.samples,
    });
    target.texture.name = 'WalkPost.colour';
    this.composer = new EffectComposer(renderer, target);
    // Sizes are handed over in device pixels; the composer must not multiply again.
    this.composer.setPixelRatio(1);
    this.beauty = new BeautyPass(scene, camera);
    this.occlusion = new OcclusionPass(scene, camera, this.width, this.height, this.tier.aoResolutionScale);
    this.applyOcclusionTier(this.tier);
    this.smaa = new SMAAPass();
    this.output = new OutputPass();
    this.whiteBalance = options.whiteBalance ?? WALK_WHITE_BALANCE;
    this.balance = options.balance ?? null;
    const material = this.output.material;
    material.fragmentShader = whiteBalancedOutput(material.fragmentShader);
    material.uniforms['jeexWhiteBalance'] = { value: new THREE.Matrix3().set(...this.whiteBalance) };
    for (const pass of [this.beauty, this.occlusion, this.smaa, this.output]) this.composer.addPass(pass);
  }

  /** Resolves once SMAA's lookup textures have decoded; rejects when they cannot. */
  async ready(): Promise<void> {
    const textures = this.smaa as unknown as SmaaTextures;
    await Promise.all(
      [textures._areaTexture, textures._searchTexture].map(async (texture) => {
        await (texture.image as HTMLImageElement).decode();
        texture.needsUpdate = true;
      }),
    );
  }

  /** The camera balance for a picture from `position`: the source's room balance, else the chain's own. */
  whiteBalanceAt(position: { x: number; y: number; z: number }): Mat3 {
    return this.balance?.at(position) ?? this.whiteBalance;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, delta: number): void {
    this.view(scene, camera);
    this.setBalance(this.balance?.live() ?? this.whiteBalance);
    // A capture leaves its own size behind (a clip of N frames resizes once); the live frame takes its size back.
    this.resize(this.liveWidth, this.liveHeight);
    this.composer.render(delta);
  }

  renderTo(target: THREE.WebGLRenderTarget, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): void {
    const live = { scene: this.beauty.scene, camera: this.beauty.camera };
    const previous = this.renderer.getRenderTarget();
    try {
      this.view(scene, camera);
      this.setBalance(this.whiteBalanceAt(camera.getWorldPosition(new THREE.Vector3())));
      this.resize(width, height);
      // Every pass but the last into the composer's buffers, then the output
      // pass once, into the caller's target.
      this.composer.renderToScreen = false;
      this.output.enabled = false;
      this.composer.render(0);
      this.output.renderToScreen = false;
      this.output.render(this.renderer, target, this.composer.readBuffer, 0, false);
    } finally {
      this.output.enabled = true;
      this.composer.renderToScreen = true;
      this.view(live.scene, live.camera);
      this.renderer.setRenderTarget(previous);
    }
  }

  compile(scene: THREE.Scene, camera: THREE.Camera): Promise<unknown> {
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    // The chain's own full-screen materials too (measured on the demo
    // apartment: about 115 ms of links in the first frame through the chain
    // without this), each on a throwaway quad with the target it draws into.
    // Not the output pass's: it replaces its defines at its first render, so
    // a program compiled before would never be used (`quadMaterials`).
    // Position and uv only, as three's full-screen quad: a normal attribute is a different program.
    const quad = new THREE.PlaneGeometry(2, 2).deleteAttribute('normal');
    const view = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quads = (materials: readonly THREE.Material[]): THREE.Scene => {
      const holder = new THREE.Scene();
      for (const material of materials) holder.add(new THREE.Mesh(quad, material));
      return holder;
    };
    const intoBuffers = quadMaterials(this.composer.passes, this.output);
    try {
      // `compileAsync` creates every program synchronously, before its first
      // await: the target bound here is the one their keys are made with.
      renderer.setRenderTarget(this.composer.readBuffer);
      const pending = [renderer.compileAsync(scene, camera), renderer.compileAsync(quads(intoBuffers), view)];
      return Promise.all(pending).then(() => warmPrograms(renderer));
    } finally {
      renderer.setRenderTarget(previous);
    }
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    // `WebGLRenderer.setSize` floors the same product for the drawing buffer.
    this.liveWidth = Math.max(1, Math.floor(width * pixelRatio));
    this.liveHeight = Math.max(1, Math.floor(height * pixelRatio));
    this.resize(this.liveWidth, this.liveHeight);
  }

  /**
   * Applies one tier's post inputs (`quality-tier.ts`): the denoise through
   * the material, the occlusion buffer's scale — effective at the next
   * `setSize`, and reapplied here so a switch whose drawing buffer does not
   * move (a display under both caps) still takes — and the ray count as the
   * GTAO material's SAMPLES define: three sets needsUpdate and relinks only
   * that one program. A rebuilt pass would relink every program of the pass
   * and allocate its targets again — a hitch on a device that is already
   * slow, and a spike the machine would read as another slow frame. The tone
   * curve, the exposure, SMAA and the targets are a tier's business never.
   */
  applyTier(inputs: WalkPostTierInputs): void {
    if (this.disposed) return;
    this.applyOcclusionTier(inputs);
    this.tier = inputs;
    this.occlusion.setSize(this.width, this.height);
  }

  /** The one occlusion setup both a fresh chain and a live tier switch run, so the two can never drift. */
  private applyOcclusionTier(inputs: WalkPostTierInputs): void {
    // The radius is world space (metres), not the pass's screen-space default;
    // the ray count is the material's SAMPLES define (three's default of 16 is
    // what an unspecified build runs).
    this.occlusion.updateGtaoMaterial({ radius: WALK_POST_TUNING.aoRadiusM, screenSpaceRadius: false, samples: inputs.gtaoSamples });
    this.occlusion.updatePdMaterial(inputs.denoise);
    this.occlusion.aoScale = inputs.aoResolutionScale;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.composer.dispose();
    for (const pass of this.composer.passes) pass.dispose();
  }

  /** Sets the matrix the output pass applies. */
  private setBalance(balance: Mat3): void {
    (this.output.material.uniforms['jeexWhiteBalance']!.value as THREE.Matrix3).set(...balance);
  }

  /** Points the two scene-reading passes at `scene` and `camera`. */
  private view(scene: THREE.Scene, camera: THREE.Camera): void {
    this.beauty.scene = scene;
    this.beauty.camera = camera;
    this.occlusion.scene = scene;
    this.occlusion.camera = camera;
  }

  /** Sizes every target of the chain to `width` x `height` device pixels; nothing when unchanged. */
  private resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.composer.setSize(w, h);
  }
}

/**
 * Builds the chain on `renderer` and waits until it can draw. A chain whose
 * SMAA textures fail to decode is disposed before the error is passed on, so
 * a failed build leaves nothing allocated.
 */
export async function createWalkPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: WalkPostOptions = {},
): Promise<WalkPost> {
  const chain = new WalkPost(renderer, scene, camera, options);
  try {
    await chain.ready();
  } catch (error) {
    chain.dispose();
    throw error;
  }
  return chain;
}

/**
 * The full-screen materials of the chain's passes that draw into its own
 * buffers, compiled ahead on throwaway quads: every pass's but `output`'s,
 * whose defines are replaced at its first render (three r186 `OutputPass`).
 */
export function quadMaterials(passes: readonly object[], output: object): THREE.Material[] {
  return passes.filter((pass) => pass !== output).flatMap((pass) => materialsOf(pass));
}

/** The materials a pass keeps as its own fields: what its full-screen quad draws with. */
function materialsOf(pass: object): THREE.Material[] {
  return Object.values(pass).filter((value): value is THREE.Material => value instanceof THREE.Material);
}
