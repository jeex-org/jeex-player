import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import {
  atlasLayout,
  createWalkUniforms,
  ENGINE_CHUNK_ANCHORS,
  installWalkPatch,
  patchFragmentShader,
  PROGRAM_KEY,
  setRoomBoxes,
  setUniformState,
} from './box-probe-patch.js';
import type { RoomBox } from './room-volumes.js';

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

  test('replaces the three lighting includes and keeps everything else', () => {
    expect(physical).not.toContain('#include <lights_fragment_begin>');
    // Only as the fallback of a material without the environment.
    expect(physical.split('#include <lights_fragment_maps>')).toHaveLength(2);
    expect(physical).toContain('#include <lights_fragment_end>');
    expect(physical).toContain('#include <envmap_physical_pars_fragment>');
    expect(physical).toContain('uniform sampler2D jeexAtlas;');
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
  });

  test("keeps the grid's irradiance apart so the walk can hand it to the environment's place", () => {
    expect(physical).toContain('jeexGridIrradiance = getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );');
    expect(physical).toContain('irradiance -= jeexGridIrradiance * jeexMove;');
  });
});

describe('installWalkPatch', () => {
  test('patches every standard material once, with one constant program key, and marks compiled ones for an update', () => {
    const uniforms = createWalkUniforms();
    const shared = new THREE.MeshStandardMaterial();
    const basic = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.Mesh(new THREE.BoxGeometry(), shared));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshPhysicalMaterial(), basic]));
    const version = shared.version;
    expect(installWalkPatch(root, uniforms)).toBe(2);
    expect(shared.version).toBe(version + 1);
    expect(shared.customProgramCacheKey()).toBe(PROGRAM_KEY);
    expect(basic.customProgramCacheKey()).not.toBe(PROGRAM_KEY);
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
    setUniformState(uniforms, 'editing');
    expect([uniforms.jeexDiffuse.value, uniforms.jeexBoxProbes.value]).toEqual([1, 0]);
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
