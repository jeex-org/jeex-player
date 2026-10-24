import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { BAKED_CHUNK_ANCHORS, bakeFragmentShader } from './baked-surface-glsl.js';
import {
  addShaderTransform,
  bakedLightGain,
  isBakedSurface,
  markBakedSurface,
  setBakedLightMode,
  setLampBaked,
  type ShaderTransform,
} from './baked-surface.js';
import { LIGHTING_STANDARD } from '../lighting/lighting-standard.js';
import { chunkMarker, expandOwnedChunks, hasShaderTransform } from './shader-compose.js';
import { patchFragmentShader } from './walk-lighting/box-probe-patch.js';

type Shader = THREE.WebGLProgramParametersWithUniforms;

/** A material's draw hook, read as the property it is. */
const hookOf = (material: THREE.Material): unknown => Reflect.get(material, 'onBeforeRender');

/** What a maker copying a material does: assigns the two compile hooks of the source. */
function copyCompileHooks(source: THREE.Material, target: THREE.Material): void {
  Object.assign(target, {
    onBeforeCompile: Reflect.get(source, 'onBeforeCompile'),
    customProgramCacheKey: Reflect.get(source, 'customProgramCacheKey'),
  });
}

function compile(material: THREE.Material): Shader {
  const shader = {
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    vertexShader: '',
    uniforms: {},
    defines: {},
  } as unknown as Shader;
  material.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
  return shader;
}

describe('the r186 chunks the baked policy rewrites', () => {
  test('still read exactly as it expects', () => {
    for (const [chunk, anchors] of Object.entries(BAKED_CHUNK_ANCHORS)) {
      const text = (THREE.ShaderChunk as unknown as Record<string, string>)[chunk]!;
      for (const anchor of anchors) expect(text).toContain(anchor);
    }
    // The environment's diffuse line is the only one of its kind; the diffuse RE adds `diffuse`.
    expect(THREE.ShaderChunk.lights_physical_pars_fragment.split('reflectedLight.indirectDiffuse += indirectDiffuse;')).toHaveLength(2);
  });
});

describe('bakeFragmentShader', () => {
  const text = bakeFragmentShader(expandOwnedChunks(THREE.ShaderLib.physical.fragmentShader));

  test('masks the point and spot diffuse after their shadow and cookie factors, and the directional lights', () => {
    const point = text.indexOf('mix( jeexDiffuseBefore, reflectedLight.directDiffuse, jeexPointDiffuse[ i ] )');
    const spot = text.indexOf('mix( jeexDiffuseBefore, reflectedLight.directDiffuse, jeexSpotDiffuse[ i ] )');
    expect(point).toBeGreaterThan(text.indexOf('getPointShadow('));
    expect(spot).toBeGreaterThan(text.indexOf('spotColor.rgb'));
    expect(spot).toBeGreaterThan(text.indexOf('getShadow( spotShadowMap[ i ]'));
    expect(text.indexOf('directLight.color *= jeexDirDirect[ i ];')).toBeGreaterThan(text.indexOf('getDirectionalLightInfo('));
    // Sun lights and rect-area lights keep their RE_Direct untouched.
    expect(text.split('jeexDiffuseBefore = reflectedLight.directDiffuse')).toHaveLength(3);
  });

  test('clears irradiance after the begin chunk, drops only the environment diffuse line, scales after the maps chunk', () => {
    expect(text.indexOf('irradiance = vec3( 0.0 );')).toBeGreaterThan(text.indexOf(chunkMarker('lights_fragment_begin', 'end')));
    expect(text).not.toContain('reflectedLight.indirectDiffuse += indirectDiffuse;');
    expect(text).toContain('reflectedLight.indirectDiffuse += diffuse;');
    expect(text).toContain('iblIrradiance += getIBLIrradiance( geometryNormal );');
    expect(text.indexOf('irradiance *= jeexBakedGain;')).toBeGreaterThan(text.indexOf(chunkMarker('lights_fragment_maps', 'end')));
    expect(text.indexOf('uniform float jeexBakedGain;')).toBeLessThan(text.indexOf('void main()'));
    expect(text.indexOf('#define JEEX_BAKED_SURFACE')).toBeLessThan(text.indexOf('void main()'));
    expect(text).not.toMatch(/#define lightMapIntensity/);
  });

  test('applies over the walk rewrite', () => {
    const both = bakeFragmentShader(patchFragmentShader(THREE.ShaderLib.physical.fragmentShader));
    expect(both).toContain('directLight.color *= jeexSunScale;');
    expect(both).toContain('directLight.color *= jeexDirDirect[ i ];');
  });

  test('the lightmap is indirect light: never scaled by the walk sun factor, only by the gain of its mode', () => {
    const both = bakeFragmentShader(patchFragmentShader(THREE.ShaderLib.physical.fragmentShader));
    // The walk's own sun scale stays the only use of the factor.
    expect(both.split('jeexSunScale;')).toHaveLength(2);
    expect(both).not.toContain('irradiance *= jeexSunScale;');
    // Inside the room boxes the gain of the mode, outside every box the editing gain (a facade keeps the editing look).
    expect(both.split('irradiance *= mix( jeexBakedEditingGain, jeexBakedGain, jeexInRoom );')).toHaveLength(2);
    expect(both.indexOf('irradiance *= mix( jeexBakedEditingGain')).toBeGreaterThan(both.indexOf('jeexLocate( - vViewPosition, normal );'));
  });
});

describe('the baked-interior gain', () => {
  const { editing, walk } = LIGHTING_STANDARD.baked.exposure;
  const camera = new THREE.PerspectiveCamera();
  let frame = 0;
  /** Draws `material` once in `scene` as three would, through its draw hook only. */
  function draw(material: THREE.Material, scene: THREE.Scene): void {
    const renderer = { info: { render: { frame: (frame += 1) } } } as unknown as THREE.WebGLRenderer;
    const hook = hookOf(material) as (...args: unknown[]) => void;
    hook.call(material, renderer, scene, camera, undefined, new THREE.Mesh(), undefined);
  }

  test('editing until the scene is put in walk, per scene, and back', () => {
    const scene = new THREE.Scene();
    const other = new THREE.Scene();
    expect(bakedLightGain(scene)).toBe(editing);
    setBakedLightMode(scene, 'walk');
    expect([bakedLightGain(scene), bakedLightGain(other)]).toEqual([walk, editing]);
    setBakedLightMode(scene, 'editing');
    expect(bakedLightGain(scene)).toBe(editing);
  });

  test('every draw sets the shared uniform from the drawn scene, whatever was drawn before', () => {
    const material = new THREE.MeshStandardMaterial();
    markBakedSurface(material);
    const gain = compile(material).uniforms['jeexBakedGain'] as { value: number };
    const walking = new THREE.Scene();
    setBakedLightMode(walking, 'walk');
    const editingScene = new THREE.Scene();
    draw(material, walking);
    expect(gain.value).toBe(walk);
    draw(material, editingScene);
    expect(gain.value).toBe(editing);
    // The same render and camera, another scene: the scene still decides.
    frame -= 1;
    draw(material, walking);
    expect(gain.value).toBe(walk);
  });
});

describe('marks', () => {
  test('flags, the transform and the draw hook; marking twice changes nothing', () => {
    const material = new THREE.MeshStandardMaterial();
    expect(isBakedSurface(material)).toBe(false);
    markBakedSurface(material);
    expect(isBakedSurface(material)).toBe(true);
    const hook = hookOf(material);
    const version = material.version;
    markBakedSurface(material);
    expect(hookOf(material)).toBe(hook);
    expect(material.version).toBe(version);
    expect(compile(material).uniforms['jeexPointDiffuse']).toBeDefined();
  });

  test('a copy carrying the flag and the compile hooks still gets its draw hook when marked', () => {
    const source = new THREE.MeshStandardMaterial();
    markBakedSurface(source);
    const clone = source.clone();
    copyCompileHooks(source, clone);
    expect(isBakedSurface(clone)).toBe(true);
    expect(hookOf(clone)).not.toBe(hookOf(source));
    const before = hookOf(clone);
    markBakedSurface(clone);
    expect(hookOf(clone)).not.toBe(before);
    expect(hasShaderTransform(clone, 'jeex-baked-surface', 2)).toBe(true);
  });

  test('lamps: baked, then live', () => {
    const lamp = new THREE.PointLight();
    setLampBaked(lamp, true);
    expect(lamp.userData['jeexBaked']).toBe(true);
    setLampBaked(lamp, false);
    expect('jeexBaked' in lamp.userData).toBe(false);
  });

  test('the lightmap decode of the lightmap binding composes: its include anchor survives the owned-chunk expansion', () => {
    const material = new THREE.MeshStandardMaterial();
    markBakedSurface(material);
    let seen = '';
    // The whole seam is importable from this module, the transform type included.
    const decode: ShaderTransform = (shader) => void (seen = shader.fragmentShader);
    addShaderTransform(material, 'jeex-lightmap-rgbm-r8', 1, decode);
    compile(material);
    expect(seen).toContain('#include <lightmap_pars_fragment>');
    expect(seen).toContain('#define JEEX_BAKED_SURFACE');
  });
});
