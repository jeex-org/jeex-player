/**
 * The walk chain's tuning: the values the spec names, frozen. The chain itself
 * needs a WebGL context and is proved in `tests/component/walk-post.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { quadMaterials, WALK_POST_TUNING, WalkPost, type WalkPostTierInputs } from './walk-post.js';
import { QUALITY_TIERS } from './quality-tier.js';
import { restJitter, restNoiseAngle, rotateNoise } from './rest-accumulation.js';

describe('WALK_POST_TUNING', () => {
  test('GTAO at 0.3 m world radius on a full-resolution buffer with depth-aware denoise, half-float targets without multisampling', () => {
    expect(WALK_POST_TUNING).toEqual({
      aoRadiusM: 0.3,
      aoResolutionScale: 1,
      colourType: THREE.HalfFloatType,
      samples: 0,
      denoise: { depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 6, samples: 16 },
      // The calibrated values and their measurement are pinned by `tests/component/walk-glossy.test.ts`.
      whiteBalance: { source: [expect.any(Number), expect.any(Number), expect.any(Number)], degree: expect.any(Number) },
    });
  });

  test('is frozen', () => {
    expect(Object.isFrozen(WALK_POST_TUNING)).toBe(true);
    expect(Object.isFrozen(WALK_POST_TUNING.denoise)).toBe(true);
    expect(Object.isFrozen(WALK_POST_TUNING.whiteBalance)).toBe(true);
    expect(Object.isFrozen(WALK_POST_TUNING.whiteBalance.source)).toBe(true);
  });
});

describe('WalkPost sizes around captures', () => {
  /** The chain over a renderer with no GPU: nothing is drawn, only the sizes are watched. */
  function chain(): { post: WalkPost; sizes: Array<[number, number]> } {
    const globals = globalThis as { Image?: unknown };
    globals.Image ??= class {
      src = '';
      onload: (() => void) | null = null;
      decode(): Promise<void> {
        return Promise.resolve();
      }
    };
    let bound: unknown = null;
    const renderer = {
      getPixelRatio: () => 1,
      getSize: (target: THREE.Vector2) => target.set(800, 450),
      getDrawingBufferSize: (target: THREE.Vector2) => target.set(800, 450),
      getRenderTarget: () => bound,
      setRenderTarget: (target: unknown) => {
        bound = target;
      },
    } as unknown as THREE.WebGLRenderer;
    const post = new WalkPost(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
    const sizes: Array<[number, number]> = [];
    const setSize = post.composer.setSize.bind(post.composer);
    post.composer.setSize = (width, height) => {
      sizes.push([width, height]);
      setSize(width, height);
    };
    post.composer.render = () => undefined;
    post.output.render = () => undefined;
    return { post, sizes };
  }

  test('consecutive captures of one size resize once; the next live frame has the live size again', () => {
    const { post, sizes } = chain();
    const target = new THREE.WebGLRenderTarget(64, 36);
    for (let frame = 0; frame < 5; frame += 1) post.renderTo(target, new THREE.Scene(), new THREE.PerspectiveCamera(), 640, 360);
    expect(sizes).toEqual([[640, 360]]);
    post.render(new THREE.Scene(), new THREE.PerspectiveCamera(), 0);
    expect(sizes).toEqual([
      [640, 360],
      [800, 450],
    ]);
    expect(post.composer.renderTarget1.width).toBe(800);
    post.render(new THREE.Scene(), new THREE.PerspectiveCamera(), 0);
    expect(sizes.length).toBe(2);
  });

  test('a resize while a capture size is applied takes effect on the next live frame', () => {
    const { post, sizes } = chain();
    post.renderTo(new THREE.WebGLRenderTarget(64, 36), new THREE.Scene(), new THREE.PerspectiveCamera(), 640, 360);
    post.setSize(500, 300, 2);
    post.render(new THREE.Scene(), new THREE.PerspectiveCamera(), 0);
    expect(sizes.at(-1)).toEqual([1000, 600]);
  });
});

describe('WalkPost per-tier inputs', () => {
  /**
   * Reduced sampling, spelled out: no tier ships it (the low tier keeps
   * high's occlusion and the full buffer), and this pins that the chain still
   * honours a smaller buffer, fewer rays and a lighter denoise when handed them.
   */
  const REDUCED: WalkPostTierInputs = {
    aoResolutionScale: 0.75,
    denoise: { ...QUALITY_TIERS.low.denoise, radius: 4, samples: 8 },
    gtaoSamples: 8,
    restFrames: 0,
  };

  /** The chain over a renderer with no GPU: nothing is drawn, only the sizes are watched. */
  function tierChain(options: { tier?: WalkPostTierInputs } = {}): WalkPost {
    const globals = globalThis as { Image?: unknown };
    globals.Image ??= class {
      src = '';
      onload: (() => void) | null = null;
      decode(): Promise<void> {
        return Promise.resolve();
      }
    };
    const renderer = {
      getPixelRatio: () => 1,
      getSize: (target: THREE.Vector2) => target.set(800, 450),
      getDrawingBufferSize: (target: THREE.Vector2) => target.set(800, 450),
      getRenderTarget: () => null,
      setRenderTarget: () => undefined,
    } as unknown as THREE.WebGLRenderer;
    return new WalkPost(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), options.tier ? { tier: options.tier } : {});
  }

  test('default construction is today`s behaviour: full resolution, the tuned denoise, three`s default rays', () => {
    const post = tierChain();
    expect(post.occlusion.gtaoMaterial.defines['SAMPLES']!).toBe(16);
    expect(post.occlusion.pdMaterial.uniforms['depthPhi']!.value).toBe(WALK_POST_TUNING.denoise.depthPhi);
    expect(post.occlusion.pdMaterial.uniforms['radius']!.value).toBe(WALK_POST_TUNING.denoise.radius);
    // A real size change propagates at the default scale of 1.
    post.setSize(640, 360, 1);
    expect(post.occlusion.gtaoRenderTarget.width).toBe(640);
    post.dispose();
  });

  test('a chain handed reduced sampling halves the rays and sizes the occlusion buffer at a reduced scale', () => {
    const post = tierChain({ tier: REDUCED });
    expect(post.occlusion.gtaoMaterial.defines['SAMPLES']!).toBe(8);
    expect(post.occlusion.pdMaterial.uniforms['radius']!.value).toBe(4);
    post.setSize(640, 360, 1);
    expect(post.occlusion.gtaoRenderTarget.width).toBe(480);
    expect(post.occlusion.gtaoRenderTarget.height).toBe(270);
    post.dispose();
  });

  test('applyTier retunes the denoise, the ray define and the buffer scale on the same pass', () => {
    const post = tierChain();
    const original = post.occlusion;
    let disposed = 0;
    const realDispose = original.dispose.bind(original);
    original.dispose = () => {
      disposed += 1;
      realDispose();
    };
    post.applyTier(REDUCED);
    // A different ray count is a shader define on the SAME pass: three sets
    // needsUpdate and relinks only the GTAO program; nothing is rebuilt,
    // disposed or re-allocated (the switch lands on a device that is already
    // slow — a rebuilt pass would relink every program of the pass).
    expect(disposed).toBe(0);
    expect(post.occlusion).toBe(original);
    expect(post.composer.passes[1]).toBe(post.occlusion);
    expect(post.composer.passes.length).toBe(4);
    expect(post.occlusion.gtaoMaterial.defines['SAMPLES']!).toBe(8);
    expect(post.occlusion.pdMaterial.uniforms['radius']!.value).toBe(4);
    // The scale applies at once, without waiting for a resize...
    expect(post.occlusion.gtaoRenderTarget.width).toBe(600);
    // ...and a real resize keeps scaling with it.
    post.setSize(640, 360, 1);
    expect(post.occlusion.gtaoRenderTarget.width).toBe(480);
    post.dispose();
  });

  test('applyTier with the same ray count keeps the pass; applying the same tier twice changes nothing twice over', () => {
    const post = tierChain();
    const original = post.occlusion;
    const sameSamples: WalkPostTierInputs = { aoResolutionScale: 1, denoise: { ...WALK_POST_TUNING.denoise, radius: 4 }, gtaoSamples: 16 };
    post.applyTier(sameSamples);
    expect(post.occlusion).toBe(original);
    expect(original.pdMaterial.uniforms['radius']!.value).toBe(4);
    post.applyTier({ ...sameSamples });
    expect(post.occlusion).toBe(original);
    post.dispose();
  });

  test('applyTier on a disposed chain retunes nothing: nothing is allocated that disposal would miss', () => {
    const post = tierChain();
    post.dispose();
    const tuned: number[] = [];
    post.occlusion.updateGtaoMaterial = (parameters) => tuned.push(parameters['samples'] as number);
    post.applyTier(REDUCED);
    expect(tuned).toEqual([]);
  });
});

describe('quadMaterials', () => {
  test('the chain compiles every pass material ahead but the output pass, whose defines change at its first render', () => {
    const blur = new THREE.ShaderMaterial();
    const edges = new THREE.ShaderMaterial();
    const shown = new THREE.ShaderMaterial();
    const output = { material: shown, enabled: true };
    expect(quadMaterials([{ blur, size: 2 }, { edges }, output], output)).toEqual([blur, edges]);
  });
});

describe('WalkPost rest frames', () => {
  /** What the chain had set up when the composer rendered. */
  type Seen = { accumulate: boolean; frame: number; smaa: boolean; projection: number[]; noise: number[] };

  /** The chain over a renderer with no GPU, on `camera`, recording what each composer render saw. */
  function restChain(camera: THREE.PerspectiveCamera, restFrames = 8): { post: WalkPost; seen: Seen[] } {
    const globals = globalThis as { Image?: unknown };
    globals.Image ??= class {
      src = '';
      onload: (() => void) | null = null;
      decode(): Promise<void> {
        return Promise.resolve();
      }
    };
    const renderer = {
      getPixelRatio: () => 1,
      getSize: (target: THREE.Vector2) => target.set(800, 450),
      getDrawingBufferSize: (target: THREE.Vector2) => target.set(800, 450),
      getRenderTarget: () => null,
      setRenderTarget: () => undefined,
    } as unknown as THREE.WebGLRenderer;
    const tier = { ...QUALITY_TIERS.high, denoise: { ...QUALITY_TIERS.high.denoise }, restFrames };
    const post = new WalkPost(renderer, new THREE.Scene(), camera, { tier });
    const seen: Seen[] = [];
    post.composer.render = () => {
      seen.push({
        accumulate: post.accumulate.enabled,
        frame: post.accumulate.frame,
        smaa: post.smaa.enabled,
        projection: [...camera.projectionMatrix.elements],
        noise: [...(post.occlusion.gtaoNoiseTexture.image.data as Uint8Array)],
      });
    };
    post.output.render = () => undefined;
    return { post, seen };
  }

  function view(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(60, 800 / 450, 0.05, 100);
    camera.position.set(1, 1.6, 2);
    camera.updateMatrixWorld();
    return camera;
  }

  test('the count comes from the tier and a tier switch retunes it; a chain built without a tier has none', () => {
    const { post } = restChain(view(), 32);
    expect(post.restFrames).toBe(32);
    post.applyTier({ ...QUALITY_TIERS.low, denoise: { ...QUALITY_TIERS.low.denoise }, restFrames: 8 });
    expect(post.restFrames).toBe(8);
    const bare = new WalkPost(post.composer.renderer, new THREE.Scene(), view());
    expect(bare.restFrames).toBe(0);
  });

  test('a draw that answered a change is today`s: no accumulation, SMAA, the projection and the noise untouched', () => {
    const camera = view();
    const { post, seen } = restChain(camera);
    const base = [...(post.occlusion.gtaoNoiseTexture.image.data as Uint8Array)];
    post.render(new THREE.Scene(), camera, 0);
    post.render(new THREE.Scene(), camera, 0, null);
    for (const frame of seen) {
      expect(frame.accumulate).toBe(false);
      expect(frame.smaa).toBe(true);
      expect(frame.projection).toEqual([...camera.projectionMatrix.elements]);
      expect(frame.noise).toEqual(base);
    }
  });

  test('rest frame 0 seeds the mean with today`s picture: no jitter, three`s noise, SMAA on', () => {
    const camera = view();
    const { post, seen } = restChain(camera);
    const base = [...(post.occlusion.gtaoNoiseTexture.image.data as Uint8Array)];
    post.render(new THREE.Scene(), camera, 0, 0);
    expect(seen[0]).toEqual({ accumulate: true, frame: 0, smaa: true, projection: [...camera.projectionMatrix.elements], noise: base });
  });

  test('a later rest frame is jittered inside one pixel, turns the noise, skips SMAA, and gives the camera back untouched', () => {
    const camera = view();
    const { post, seen } = restChain(camera);
    const base = Uint8Array.from(post.occlusion.gtaoNoiseTexture.image.data as Uint8Array);
    const projection = [...camera.projectionMatrix.elements];
    const inverse = [...camera.projectionMatrixInverse.elements];
    const world = [...camera.matrixWorld.elements];
    post.render(new THREE.Scene(), camera, 0, 3);
    const [dx, dy] = restJitter(3);
    const jittered = new THREE.Matrix4().fromArray(projection);
    jittered.elements[8] -= (2 * dx) / 800;
    jittered.elements[9] -= (2 * dy) / 450;
    const turned = new Uint8Array(base.length);
    rotateNoise(base, restNoiseAngle(3), turned);
    expect(seen[0]!.accumulate).toBe(true);
    expect(seen[0]!.frame).toBe(3);
    expect(seen[0]!.smaa).toBe(false);
    seen[0]!.projection.forEach((value, index) => expect(value).toBeCloseTo(jittered.elements[index]!, 12));
    expect(seen[0]!.noise).toEqual([...turned]);
    // What render-demand compares is exactly what it was.
    expect([...camera.projectionMatrix.elements]).toEqual(projection);
    expect([...camera.projectionMatrixInverse.elements]).toEqual(inverse);
    expect([...camera.matrixWorld.elements]).toEqual(world);
  });

  test('a capture between rest frames is not averaged: no accumulation, no jitter, SMAA and three`s noise', () => {
    const camera = view();
    const { post, seen } = restChain(camera);
    const base = [...(post.occlusion.gtaoNoiseTexture.image.data as Uint8Array)];
    post.render(new THREE.Scene(), camera, 0, 5);
    const capture = view();
    post.renderTo(new THREE.WebGLRenderTarget(64, 36), new THREE.Scene(), capture, 640, 360);
    expect(seen[1]).toEqual({ accumulate: false, frame: seen[1]!.frame, smaa: true, projection: [...camera.projectionMatrix.elements], noise: base });
  });
});
