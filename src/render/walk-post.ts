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
   * The camera white balance: a partial adaptation from `source`, the
   * measured linear colour of the neutral surfaces, towards the display
   * white, by `degree` (`white-balance.ts`). Not yet calibrated: identity.
   */
  whiteBalance: Object.freeze({ source: Object.freeze([1, 1, 1] as const), degree: 0 }),
});

/** The tuned white balance the chain applies by default. */
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

/** Options of a chain; the white balance defaults to the tuned one. */
export type WalkPostOptions = { whiteBalance?: Mat3 | undefined };

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

/** GTAO at the tuned resolution, fed by opaque surfaces only, releasing everything it made. */
class OcclusionPass extends GTAOPass {
  override setSize(width: number, height: number): void {
    const scale = WALK_POST_TUNING.aoResolutionScale;
    super.setSize(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)));
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
  /** The white balance the output pass applies, row-major. */
  readonly whiteBalance: Mat3;
  private readonly renderer: THREE.WebGLRenderer;
  /** The composer's size in device pixels now: the live size, or the last capture's until the next live frame. */
  private width: number;
  private height: number;
  /** The live drawing buffer's size in device pixels, which the next live frame restores. */
  private liveWidth: number;
  private liveHeight: number;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, options: WalkPostOptions = {}) {
    this.renderer = renderer;
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
    this.occlusion = new OcclusionPass(scene, camera, this.width, this.height);
    this.occlusion.updateGtaoMaterial({ radius: WALK_POST_TUNING.aoRadiusM, screenSpaceRadius: false });
    this.occlusion.updatePdMaterial(WALK_POST_TUNING.denoise);
    this.smaa = new SMAAPass();
    this.output = new OutputPass();
    this.whiteBalance = options.whiteBalance ?? WALK_WHITE_BALANCE;
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

  render(scene: THREE.Scene, camera: THREE.Camera, delta: number): void {
    this.view(scene, camera);
    // A capture leaves its own size behind (a clip of N frames resizes once); the live frame takes its size back.
    this.resize(this.liveWidth, this.liveHeight);
    this.composer.render(delta);
  }

  renderTo(target: THREE.WebGLRenderTarget, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): void {
    const live = { scene: this.beauty.scene, camera: this.beauty.camera };
    const previous = this.renderer.getRenderTarget();
    try {
      this.view(scene, camera);
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.composer.dispose();
    for (const pass of this.composer.passes) pass.dispose();
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
