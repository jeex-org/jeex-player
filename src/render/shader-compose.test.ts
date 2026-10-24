import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import {
  addShaderTransform,
  BAKED_TRANSFORM_ID,
  chunkMarker,
  expandOwnedChunks,
  hasShaderTransform,
  OWNED_CHUNKS,
  replaceAnchor,
  WALK_TRANSFORM_ID,
  type ShaderTransform,
} from './shader-compose.js';

type Shader = THREE.WebGLProgramParametersWithUniforms;

/** What a maker copying a material does: assigns the two compile hooks of the source. */
function copyCompileHooks(source: THREE.Material, target: THREE.Material): void {
  Object.assign(target, {
    onBeforeCompile: Reflect.get(source, 'onBeforeCompile'),
    customProgramCacheKey: Reflect.get(source, 'customProgramCacheKey'),
  });
}

const physicalShader = (): Shader =>
  ({
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    uniforms: {},
    defines: {},
  }) as unknown as Shader;

/** Runs a material's compile hook as three does, with no renderer (as a preflight does). */
function compile(material: THREE.Material): Shader {
  const shader = physicalShader();
  material.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
  return shader;
}

/** A transform that appends a marker comment, so the order of application shows in the text. */
const tag =
  (name: string): ShaderTransform =>
  (shader) => {
    shader.fragmentShader += `\n// tag:${name}`;
  };

const tags = (shader: Shader): string[] => [...shader.fragmentShader.matchAll(/\/\/ tag:(\S+)/g)].map((match) => match[1]!);

describe('owned chunks', () => {
  test('are expanded in place between markers, and the lightmap pars include stays', () => {
    const text = expandOwnedChunks(THREE.ShaderLib.physical.fragmentShader);
    for (const chunk of OWNED_CHUNKS) {
      expect(text).not.toContain(`#include <${chunk}>`);
      const begin = text.indexOf(chunkMarker(chunk, 'begin'));
      const end = text.indexOf(chunkMarker(chunk, 'end'));
      expect(begin).toBeGreaterThan(-1);
      expect(text.slice(begin, end)).toContain((THREE.ShaderChunk as unknown as Record<string, string>)[chunk]!.trim().slice(0, 40));
    }
    expect(text).toContain('#include <lightmap_pars_fragment>');
    // Idempotent: a second pass finds nothing left to expand.
    expect(expandOwnedChunks(text)).toBe(text);
  });

  test('every transform sees them expanded', () => {
    const material = new THREE.MeshStandardMaterial();
    const seen: boolean[] = [];
    addShaderTransform(
      material,
      'probe',
      1,
      (shader) => void seen.push(shader.fragmentShader.includes(chunkMarker('lights_fragment_maps', 'begin'))),
    );
    compile(material);
    expect(seen).toEqual([true]);
  });
});

describe('order and identity', () => {
  test('walk, then baked, then the others in registration order, whatever order they were added in', () => {
    const material = new THREE.MeshStandardMaterial();
    addShaderTransform(material, 'decode', 1, tag('decode'));
    addShaderTransform(material, BAKED_TRANSFORM_ID, 1, tag('baked'));
    addShaderTransform(material, 'later', 1, tag('later'));
    addShaderTransform(material, WALK_TRANSFORM_ID, 2, tag('walk'));
    expect(tags(compile(material))).toEqual(['walk', 'baked', 'decode', 'later']);
    expect(material.customProgramCacheKey()).toBe(`jeex||${WALK_TRANSFORM_ID}@2|${BAKED_TRANSFORM_ID}@1|decode@1|later@1`);
  });

  test('the same id and version is a no-op; a new version replaces the entry in place and recompiles', () => {
    const material = new THREE.MeshStandardMaterial();
    addShaderTransform(material, 'a', 1, tag('a1'));
    addShaderTransform(material, 'b', 1, tag('b'));
    const version = material.version;
    addShaderTransform(material, 'a', 1, tag('ignored'));
    expect(material.version).toBe(version);
    addShaderTransform(material, 'a', 2, tag('a2'));
    expect(material.version).toBe(version + 1);
    expect(tags(compile(material))).toEqual(['a2', 'b']);
    expect(hasShaderTransform(material, 'a', 2)).toBe(true);
    expect(hasShaderTransform(material, 'a', 1)).toBe(false);
    expect(hasShaderTransform(material, 'a')).toBe(true);
  });

  test('a foreign hook runs first and its key leads the program key', () => {
    const material = new THREE.MeshStandardMaterial();
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader += '\n// tag:foreign';
    };
    material.customProgramCacheKey = () => 'host-7';
    addShaderTransform(material, 'x', 3, tag('x'));
    expect(tags(compile(material))).toEqual(['foreign', 'x']);
    expect(material.customProgramCacheKey()).toBe('jeex|host-7|x@3');
  });

  test("a foreign hook with three's default key contributes its source text, captured before the wrap", () => {
    const material = new THREE.MeshStandardMaterial();
    const hook = (shader: Shader): void => void (shader.defines!['HOST'] = 1);
    material.onBeforeCompile = hook;
    addShaderTransform(material, 'x', 1, tag('x'));
    expect(material.customProgramCacheKey()).toBe(`jeex|${hook.toString()}|x@1`);
  });
});

describe('copies', () => {
  test('a material given another material’s hooks adopts a copy of its list; the two then diverge', () => {
    const source = new THREE.MeshStandardMaterial();
    addShaderTransform(source, WALK_TRANSFORM_ID, 2, tag('walk'));
    const clone = source.clone();
    copyCompileHooks(source, clone);
    expect(hasShaderTransform(clone, WALK_TRANSFORM_ID, 2)).toBe(true);
    addShaderTransform(clone, 'decode', 1, tag('decode'));
    expect(tags(compile(clone))).toEqual(['walk', 'decode']);
    expect(tags(compile(source))).toEqual(['walk']);
    expect(source.customProgramCacheKey()).toBe(`jeex||${WALK_TRANSFORM_ID}@2`);
    expect(clone.customProgramCacheKey()).toBe(`jeex||${WALK_TRANSFORM_ID}@2|decode@1`);
  });
});

describe('replaceAnchor', () => {
  test('replaces once and throws with the transform id when the anchor is missing', () => {
    expect(replaceAnchor('a b a', 'a', 'c', 't')).toBe('c b a');
    expect(() => replaceAnchor('abc', 'zz', 'c', 'my-transform')).toThrow(/my-transform.*zz/);
  });
});
