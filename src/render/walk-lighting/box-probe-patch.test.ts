import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import {
  atlasLayout,
  createWalkUniforms,
  ENGINE_CHUNK_ANCHORS,
  guardBumpNormal,
  installWalkPatch,
  patchFragmentShader,
  WALK_TRANSFORM,
  setRoomBoxes,
  setUniformState,
} from './box-probe-patch.js';
import type { RoomBox } from './room-volumes.js';
import { chunkMarker, expandOwnedChunks } from '../shader-compose.js';
import { WALK_LIGHTING_TUNING } from './walk-lighting-tuning.js';
import { bakeFragmentShader } from '../baked-surface-glsl.js';

describe('the r186 chunks the patch rewrites', () => {
  test('still read exactly as the patch expects', () => {
    for (const [chunk, anchors] of Object.entries(ENGINE_CHUNK_ANCHORS)) {
      const text = (THREE.ShaderChunk as unknown as Record<string, string>)[chunk]!;
      for (const anchor of anchors) expect(text).toContain(anchor);
    }
  });
});

describe('patchFragmentShader', () => {
  const physical = patchFragmentShader(THREE.ShaderLib.physical.fragmentShader);

  test('rewrites the expanded lighting chunks and keeps everything else', () => {
    expect(physical).not.toContain('#include <lights_fragment_begin>');
    expect(physical).not.toContain('#include <lights_fragment_maps>');
    // The room lookup exists where the box count is defined: the baked policy keys its gain on it.
    expect(physical).toContain('#define JEEX_MAX_BOXES');
    // Raw and already expanded text give the same shader.
    expect(patchFragmentShader(expandOwnedChunks(THREE.ShaderLib.physical.fragmentShader))).toBe(physical);
    expect(physical).toContain('#include <lights_fragment_end>');
    expect(physical).toContain('#include <envmap_physical_pars_fragment>');
    expect(physical).toContain('uniform sampler2D jeexAtlas;');
    expect(physical).toContain('outgoingLight *= mix( jeexOutside, 1.0, jeexInRoom );');
  });

  test('routes diffuse, specular and clearcoat through the switches, keeps anisotropy and retroreflection', () => {
    expect(physical).toContain('iblIrradiance += getIBLIrradiance( geometryNormal ) * jeexDiffuseScale;');
    expect(physical).toContain('vec3 iblRadiance = jeexRadiance( geometryViewDir, geometryNormal, material.roughness );');
    expect(physical).toContain(
      'clearcoatRadiance += jeexRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );',
    );
    expect(physical).toContain(
      'getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy )',
    );
    expect(physical).toContain('getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness )');
    // A fragment beyond a box (an open boundary's blend band) does not reflect that box's open face,
    // but a ray heading back into the box keeps its far wall.
    expect(physical).toContain('exits += step( 1e-4, abs( jeexWorldPos - from ) ) * step( exits, vec3( 1e-4 ) ) * 1e4;');
  });

  test('scales direct sunlight inside the rooms by the walk sun factor, after the room is located, and nothing else', () => {
    const begin = physical.indexOf('getDirectionalLightInfo( directionalLight, directLight );');
    const locate = physical.indexOf('jeexLocate( - vViewPosition, normal );');
    const scale = physical.indexOf('directLight.color *= jeexSunScale;');
    expect(locate).toBeGreaterThan(-1);
    expect(locate).toBeLessThan(begin);
    expect(scale).toBeGreaterThan(begin);
    // Located once per fragment, ahead of the lights and the maps chunk that both read it.
    expect(physical.split('jeexLocate(')).toHaveLength(3); // the definition and the one call
    expect(locate).toBeLessThan(physical.indexOf('vec3 geometryPosition = - vViewPosition;'));
    // Once, in the directional loop: point lights (the lamps) and the rest keep their light.
    expect(physical.split('directLight.color *= jeexSunScale;')).toHaveLength(2);
    // Declared beside the directional light, 1 for a material without the studio environment (no room lookup).
    const declared = physical.indexOf('float jeexSunScale = mix( 1.0, jeexSun, jeexInRoom );');
    expect(declared).toBeGreaterThan(physical.indexOf('DirectionalLight directionalLight;'));
    expect(declared).toBeLessThan(begin);
    expect(physical).toContain('float jeexSunScale = 1.0;');
    expect(physical.indexOf('float jeexSunScale')).toBeGreaterThan(physical.indexOf(chunkMarker('lights_fragment_begin', 'begin')));
  });

  test("keeps the grid's irradiance apart so the walk can hand it to the environment's place", () => {
    expect(physical).toContain('jeexGridIrradiance = getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );');
    expect(physical).toContain('irradiance -= jeexGridIrradiance * jeexMove;');
  });

  test('a baked surface skips the grid sample, the hand-over and the diffuse scale', () => {
    const grid = physical.indexOf('jeexGridIrradiance = getLightProbeGridIrradiance');
    expect(physical.lastIndexOf('#ifndef JEEX_BAKED_SURFACE', grid)).toBeGreaterThan(physical.lastIndexOf('#endif', grid));
    const move = physical.indexOf('float jeexMove');
    expect(physical.lastIndexOf('! defined( JEEX_BAKED_SURFACE )', move)).toBeGreaterThan(physical.lastIndexOf('#endif', move));
    const scale = physical.indexOf('float jeexDiffuseScale = mix(');
    expect(physical.lastIndexOf('! defined( JEEX_BAKED_SURFACE )', scale)).toBeGreaterThan(physical.lastIndexOf('#endif', scale));
  });
});

describe('installWalkPatch', () => {
  test('patches every standard material once through the composer, with one program key, and marks compiled ones for an update', () => {
    const uniforms = createWalkUniforms();
    const shared = new THREE.MeshStandardMaterial();
    const basic = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.Mesh(new THREE.BoxGeometry(), shared));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshPhysicalMaterial(), basic]));
    const version = shared.version;
    expect(installWalkPatch(root, uniforms)).toBe(2);
    expect(shared.version).toBe(version + 1);
    const key = `jeex||${WALK_TRANSFORM.id}@${WALK_TRANSFORM.version}`;
    expect(shared.customProgramCacheKey()).toBe(key);
    expect(basic.customProgramCacheKey()).not.toBe(key);
    expect(installWalkPatch(root, uniforms)).toBe(0);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      vertexShader: '',
    };
    shared.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms['jeexDiffuse']).toBe(uniforms.jeexDiffuse);
  });
});

describe('uniform states', () => {
  test('editing: environment diffuse on, box probes off; capture: diffuse off; walk: both', () => {
    const uniforms = createWalkUniforms();
    setUniformState(uniforms, 'capture');
    expect([uniforms.jeexDiffuse.value, uniforms.jeexBoxProbes.value]).toEqual([0, 0]);
    setUniformState(uniforms, 'walk');
    expect([uniforms.jeexDiffuse.value, uniforms.jeexBoxProbes.value]).toEqual([0, 1]);
    // Facades keep the editing look under the walk exposure.
    expect(uniforms.jeexOutside.value).toBeCloseTo(1 / WALK_LIGHTING_TUNING.walkExposure, 9);
    setUniformState(uniforms, 'editing');
    expect([uniforms.jeexDiffuse.value, uniforms.jeexBoxProbes.value, uniforms.jeexOutside.value]).toEqual([1, 0, 1]);
  });

  test('the sun factor: 1 in editing and capture, the walk sun scale in walk', () => {
    const uniforms = createWalkUniforms();
    expect(uniforms.jeexSun.value).toBe(1);
    setUniformState(uniforms, 'walk');
    expect(uniforms.jeexSun.value).toBe(WALK_LIGHTING_TUNING.walkSunScale);
    expect(WALK_LIGHTING_TUNING.walkSunScale).toBeCloseTo(1 / 3.5, 9);
    setUniformState(uniforms, 'capture');
    expect(uniforms.jeexSun.value).toBe(1);
    setUniformState(uniforms, 'editing');
    expect(uniforms.jeexSun.value).toBe(1);
  });

  test('room boxes fill the arrays with their tiles and probe points', () => {
    const uniforms = createWalkUniforms();
    const box = (x: number): RoomBox => ({
      roomId: `r${x}`,
      projection: { min: { x, y: 0, z: 0 }, max: { x: x + 1, y: 2.5, z: 1 } },
      sampling: { min: { x, y: 0, z: 0 }, max: { x: x + 1, y: 2.5, z: 1 } },
      selection: { min: { x: x - 0.05, y: -0.2, z: -0.05 }, max: { x: x + 1.05, y: 2.7, z: 1.05 } },
      resolution: { x: 2, y: 2, z: 2 },
    });
    const layout = atlasLayout(2);
    setRoomBoxes(
      uniforms,
      [box(0), box(2)],
      [
        { roomId: 'r0', position: { x: 0.5, y: 1.5, z: 0.5 } },
        { roomId: 'r2', position: { x: 2.5, y: 1.5, z: 0.5 } },
      ],
      layout,
    );
    expect(uniforms.jeexBoxCount.value).toBe(2);
    expect(uniforms.jeexBoxMax.value[1]!.toArray()).toEqual([3, 2.5, 1]);
    expect(uniforms.jeexSelMin.value[0]!.toArray()).toEqual([-0.05, -0.2, -0.05]);
    expect(uniforms.jeexProbe.value[1]!.toArray()).toEqual([2.5, 1.5, 0.5]);
    expect(uniforms.jeexTile.value[1]!.toArray()).toEqual([0, 512]);
    // Each box carries its room's index, the probe order.
    expect(uniforms.jeexBoxRoom.value.slice(0, 2)).toEqual([0, 1]);
  });

  test('every box of one room carries that room', () => {
    const uniforms = createWalkUniforms();
    const box = (roomId: string, x: number): RoomBox => ({
      roomId,
      projection: { min: { x, y: 0, z: 0 }, max: { x: x + 1, y: 2.5, z: 1 } },
      sampling: { min: { x, y: 0, z: 0 }, max: { x: x + 1, y: 2.5, z: 1 } },
      selection: { min: { x, y: 0, z: 0 }, max: { x: x + 1, y: 2.5, z: 1 } },
      resolution: { x: 2, y: 2, z: 2 },
    });
    setRoomBoxes(
      uniforms,
      [box('b', 0), box('a', 1), box('b', 2)],
      [
        { roomId: 'a', position: { x: 1.5, y: 1.5, z: 0.5 } },
        { roomId: 'b', position: { x: 0.5, y: 1.5, z: 0.5 } },
      ],
      atlasLayout(2),
    );
    expect(uniforms.jeexBoxRoom.value.slice(0, 3)).toEqual([1, 0, 1]);
  });
});

describe('the lamp gate', () => {
  const physical = patchFragmentShader(THREE.ShaderLib.physical.fragmentShader);

  test('declares the scope, the box rooms and the per-point-light rooms, the last only with point lights', () => {
    expect(physical).toContain('uniform float jeexLampScope;');
    expect(physical).toContain('uniform float jeexBoxRoom[ JEEX_MAX_BOXES ];');
    const declared = physical.indexOf('uniform float jeexPointRoom[ NUM_POINT_LIGHTS ];');
    expect(declared).toBeGreaterThan(0);
    expect(physical.lastIndexOf('#if NUM_POINT_LIGHTS > 0', declared)).toBeGreaterThan(physical.lastIndexOf('#endif', declared));
  });

  test('locates the receiver room with boundaries included, the faced room on a shared boundary, the lower index on a tie; jeexInRoom stays strict', () => {
    expect(physical).toContain('float jeexRoom = -1.0;');
    expect(physical).toContain('if ( jeexInside( jeexLookup, i ) > 0.0 ) jeexInRoom = 1.0;');
    expect(physical).toContain('if ( d >= 0.0 ) {');
    expect(physical).toContain('float ahead = jeexInside( jeexLookup + jeexPushDir * jeexPush, i );');
    expect(physical).toContain('if ( jeexRoom < 0.0 || ahead > jeexAhead || ( ahead == jeexAhead && jeexBoxRoom[ i ] < jeexRoom ) ) {');
  });

  test('gates each point light right after its info and before its direct term', () => {
    const info = physical.indexOf('getPointLightInfo( pointLight, geometryPosition, directLight );');
    const gate = physical.indexOf('directLight.color *= jeexLampGate( jeexPointRoom[ i ] );');
    const direct = physical.indexOf('RE_Direct(', info);
    expect(info).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(info);
    expect(gate).toBeLessThan(direct);
    expect(physical).toContain('float jeexLampGate( const in float room ) {');
  });

  test('the baked policy still finds its point-light anchor after the gate', () => {
    expect(() => bakeFragmentShader(physical)).not.toThrow();
    expect(bakeFragmentShader(physical)).toContain('jeexPointDiffuse[ i ]');
  });

  test('the scope uniform defaults off and the transform version is 6', () => {
    expect(createWalkUniforms().jeexLampScope.value).toBe(0);
    expect(WALK_TRANSFORM.version).toBe(6);
  });
});

describe('atlasLayout', () => {
  test('stacks 384 x 512 tiles in one column up to eight rooms, then adds columns', () => {
    expect(atlasLayout(3)).toMatchObject({ columns: 1, rows: 3, width: 384, height: 1536 });
    const nine = atlasLayout(9);
    expect(nine).toMatchObject({ columns: 2, rows: 5, width: 768, height: 2560 });
    expect(nine.tiles[5]).toEqual({ x: 384, y: 0 });
    expect(atlasLayout(16).height).toBeLessThanOrEqual(4096);
  });
});

describe('guardBumpNormal', () => {
  test('replaces the bump perturbation with one that keeps the surface normal where the perturbed one vanishes', () => {
    const out = guardBumpNormal(THREE.ShaderLib.standard.fragmentShader);
    expect(out).not.toContain('#include <bumpmap_pars_fragment>');
    expect(out).not.toContain('return normalize( abs( fDet ) * surf_norm - vGrad );');
    expect(out).toContain('dot( jeexBumped, jeexBumped ) > 1e-20 ? normalize( jeexBumped ) : surf_norm');
  });

  test('leaves a shader without the bump chunk alone', () => {
    expect(guardBumpNormal('void main() {}')).toBe('void main() {}');
  });
});
