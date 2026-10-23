import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { compileScene, PROGRAMS_PER_TASK, warmPrograms } from './scene-compile.js';

/** A renderer that records which target was bound for each asynchronous compilation. */
function recordingRenderer(withCompile = true) {
  let bound: THREE.WebGLRenderTarget | null = null;
  const compiled: Array<THREE.WebGLRenderTarget | null> = [];
  const renderer = {
    info: { programs: [] },
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

describe('compileScene and a texture background', () => {
  test('compiles a stand-in of the background plane inside the scene, for both targets, and takes it out again', async () => {
    const { renderer } = recordingRenderer();
    const seen: number[] = [];
    const scene = new THREE.Scene();
    scene.background = new THREE.Texture();
    (renderer as unknown as { compileAsync: (compiled: THREE.Scene) => Promise<unknown> }).compileAsync = (compiled) => {
      seen.push(compiled.children.length);
      return Promise.resolve();
    };
    await compileScene(renderer, scene, new THREE.PerspectiveCamera());
    expect(seen).toEqual([1, 1]);
    expect(scene.children).toHaveLength(0);
  });
});

describe('warmPrograms', () => {
  test('asks every linked program for its uniforms, a few per task, so no task holds them all', async () => {
    const warmed: number[] = [];
    let task = 0;
    const programs = Array.from({ length: PROGRAMS_PER_TASK * 2 + 1 }, () => ({ getUniforms: () => warmed.push(task) }));
    const renderer = { info: { programs } } as unknown as THREE.WebGLRenderer;
    const timer = setInterval(() => (task += 1), 0);
    await warmPrograms(renderer);
    clearInterval(timer);
    expect(warmed).toHaveLength(programs.length);
    expect(new Set(warmed).size).toBeGreaterThanOrEqual(2);
  });

  test('a renderer with no program list warms nothing', async () => {
    await warmPrograms({ info: { programs: null } } as unknown as THREE.WebGLRenderer);
  });
});
