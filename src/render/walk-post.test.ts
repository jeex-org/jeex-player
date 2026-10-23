/**
 * The walk chain's tuning: the values the spec names, frozen. The chain itself
 * needs a WebGL context and is proved in `tests/component/walk-post.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { quadMaterials, WALK_POST_TUNING, WalkPost } from './walk-post.js';

describe('WALK_POST_TUNING', () => {
  test('GTAO at 0.3 m world radius on a full-resolution buffer with depth-aware denoise, half-float targets without multisampling', () => {
    expect(WALK_POST_TUNING).toEqual({
      aoRadiusM: 0.3,
      aoResolutionScale: 1,
      colourType: THREE.HalfFloatType,
      samples: 0,
      denoise: { depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 6, samples: 16 },
    });
  });

  test('is frozen', () => {
    expect(Object.isFrozen(WALK_POST_TUNING)).toBe(true);
    expect(Object.isFrozen(WALK_POST_TUNING.denoise)).toBe(true);
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

describe('quadMaterials', () => {
  test('the chain compiles every pass material ahead but the output pass, whose defines change at its first render', () => {
    const blur = new THREE.ShaderMaterial();
    const edges = new THREE.ShaderMaterial();
    const shown = new THREE.ShaderMaterial();
    const output = { material: shown, enabled: true };
    expect(quadMaterials([{ blur, size: 2 }, { edges }, output], output)).toEqual([blur, edges]);
  });
});
