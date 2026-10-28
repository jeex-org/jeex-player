/**
 * The walk chain's tuning: the values the spec names, frozen. The chain itself
 * needs a WebGL context and is proved in `tests/component/walk-post.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { quadMaterials, WALK_POST_TUNING, WalkPost, type WalkPostTierInputs } from './walk-post.js';
import { QUALITY_TIERS } from './quality-tier.js';

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
   * The low tier's inputs, as the quality module would hand them over, but at
   * a three-quarter occlusion buffer: the tier itself keeps the full buffer,
   * and this pins that the chain still honours a reduced scale.
   */
  const LOW: WalkPostTierInputs = {
    aoResolutionScale: 0.75,
    denoise: { ...QUALITY_TIERS.low.denoise },
    gtaoSamples: QUALITY_TIERS.low.gtaoSamples,
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

  test('a chain built on the low sampling halves the rays and sizes the occlusion buffer at a reduced scale', () => {
    const post = tierChain({ tier: LOW });
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
    post.applyTier(LOW);
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
    post.applyTier(LOW);
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
