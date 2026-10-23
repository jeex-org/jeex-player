import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { compileScene } from './scene-compile.js';

/** A renderer that records which target was bound for each asynchronous compilation. */
function recordingRenderer(withCompile = true) {
  let bound: THREE.WebGLRenderTarget | null = null;
  const compiled: Array<THREE.WebGLRenderTarget | null> = [];
  const renderer = {
    getRenderTarget: () => bound,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
      bound = target;
    },
    ...(withCompile && {
      compileAsync: () => {
        compiled.push(bound);
        return Promise.resolve();
      },
    }),
  } as unknown as THREE.WebGLRenderer;
  return { renderer, compiled, bound: () => bound };
}

describe('compileScene', () => {
  test('compiles for the screen and for a linear target (mirrors, transmission), then puts the bound target back', async () => {
    const { renderer, compiled, bound } = recordingRenderer();
    const previous = new THREE.WebGLRenderTarget(4, 4);
    renderer.setRenderTarget(previous);
    const pending = compileScene(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(pending).not.toBeNull();
    await pending;
    expect(compiled).toHaveLength(2);
    expect(compiled[0]).toBeNull();
    expect(compiled[1]).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(compiled[1]).not.toBe(previous);
    expect(bound()).toBe(previous);
  });

  test('a renderer without asynchronous compilation answers null', () => {
    const { renderer } = recordingRenderer(false);
    expect(compileScene(renderer, new THREE.Scene(), new THREE.PerspectiveCamera())).toBeNull();
  });
});
