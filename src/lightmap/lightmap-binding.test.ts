/**
 * The binding transaction on the calibration shell: clones per material and
 * page, the marks, the lamps, the refusals that change nothing, and the undo.
 */

import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CALIBRATION_LAMP, CALIBRATION_NODES } from '../../tests/fixtures/lightmap-calibration/calibration-facts.js';
import * as bakedSurface from '../render/baked-surface.js';
import { isBakedSurface } from '../render/baked-surface.js';
import type { LightBake } from './light-bake.js';
import { LightBakeError } from './light-bake-error.js';
import { bindLightBake } from './lightmap-binding.js';
import { rgbmRangeOf } from './lightmap-shader.js';
import { createWalkUniforms, installWalkPatch } from '../render/walk-lighting/box-probe-patch.js';
import { AssetLoader } from '../geometry/asset-loader.js';
import { projectBank } from '../assets/project-catalogue.js';
import { parseProjectManifest } from '../assets/project-manifest.schema.js';
import { lampLightTag } from '../assets/artificial-light.js';
import { LAMP_PROJECT_FIXTURE as LAMPS } from '../../tests/fixtures/project/fixture-ids.js';

const DIR = new URL('../../tests/fixtures/lightmap-calibration/', import.meta.url);
const sidecar = (): LightBake => JSON.parse(readFileSync(new URL('sidecar.json', DIR), 'utf8')) as LightBake;

async function shell(): Promise<THREE.Group> {
  const bytes = readFileSync(new URL('shell.glb', DIR));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return gltf.scene;
}

/** A lamp the way a bank lamp is built: a light inside its placement group. */
function lampPlacement(id: string): { group: THREE.Group; light: THREE.PointLight } {
  const group = new THREE.Group();
  group.userData['assetId'] = id;
  const light = new THREE.PointLight();
  const shade = new THREE.Group();
  shade.add(light);
  group.add(shade);
  return { group, light };
}

const page = (): THREE.Texture => new THREE.Texture();
const meshNamed = (root: THREE.Object3D, name: string): THREE.Mesh => root.getObjectByName(name) as THREE.Mesh;
const materialOf = (root: THREE.Object3D, name: string): THREE.MeshStandardMaterial =>
  meshNamed(root, name).material as THREE.MeshStandardMaterial;

describe('bindLightBake', () => {
  test("decodes with the sidecar's own RGBM range, not the calibration's", async () => {
    const root = await shell();
    const bake = sidecar();
    const ranged: LightBake = { ...bake, contract: { ...bake.contract, encoding: { ...bake.contract.encoding, range: 1 } } };
    const texture = page();
    bindLightBake(root, ranged, [texture]);
    const clone = materialOf(root, CALIBRATION_NODES.floor);
    expect(rgbmRangeOf(clone)).toBe(1);
    expect(clone.lightMap).toBe(texture);
    const shader = {
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      vertexShader: '',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    clone.onBeforeCompile(shader, undefined as never);
    expect(shader.fragmentShader).toContain('#define JEEX_RGBM_RANGE 1.000000');
    expect(shader.fragmentShader).not.toContain('JEEX_RGBM_RANGE 8');
    expect(clone.customProgramCacheKey()).toMatch(/\|jeex-lightmap-rgbm-r1@1$/);
  });

  test('binds every lightmapped mesh with a decoded, marked clone on UV channel 1, leaving the block alone', async () => {
    const root = await shell();
    const block = materialOf(root, CALIBRATION_NODES.block);
    const originals = new Map(Object.values(CALIBRATION_NODES).map((id) => [id, materialOf(root, id)]));
    const texture = page();
    const bound = bindLightBake(root, sidecar(), [texture]);
    for (const [role, id] of Object.entries(CALIBRATION_NODES)) {
      const material = materialOf(root, id);
      if (role === 'block') {
        expect(material).toBe(block);
        expect(isBakedSurface(material)).toBe(false);
        continue;
      }
      expect(material).not.toBe(originals.get(id));
      expect(material.lightMap).toBe(texture);
      expect(material.lightMapIntensity).toBeCloseTo(Math.PI, 12);
      expect(rgbmRangeOf(material)).toBe(8);
      expect(isBakedSurface(material)).toBe(true);
      expect(material.color.equals(originals.get(id)!.color)).toBe(true);
    }
    expect(bound.unresolvedLamps).toEqual([CALIBRATION_LAMP.id]);
  });

  test('marks the exact clone it binds, never relying on a flag the source already carried', async () => {
    const root = await shell();
    const floor = materialOf(root, CALIBRATION_NODES.floor);
    floor.userData['jeexBakedSurface'] = true;
    const mark = spyOn(bakedSurface, 'markBakedSurface');
    try {
      bindLightBake(root, sidecar(), [page()]);
      const marked = new Set(mark.mock.calls.map(([material]) => material));
      expect(marked.has(materialOf(root, CALIBRATION_NODES.floor))).toBe(true);
      expect(marked.has(floor)).toBe(false);
      expect(marked.size).toBe(7);
    } finally {
      mark.mockRestore();
    }
  });

  test('one clone per source material and page, shared by the meshes that use the pair', async () => {
    const root = await shell();
    const shared = new THREE.MeshStandardMaterial();
    meshNamed(root, CALIBRATION_NODES.wallLeft).material = shared;
    meshNamed(root, CALIBRATION_NODES.wallRight).material = shared;
    bindLightBake(root, sidecar(), [page()]);
    expect(materialOf(root, CALIBRATION_NODES.wallLeft)).toBe(materialOf(root, CALIBRATION_NODES.wallRight));
    expect(materialOf(root, CALIBRATION_NODES.wallLeft)).not.toBe(shared);
    expect(isBakedSurface(shared)).toBe(false);
  });

  test('marks every light under a listed lamp placement as baked, and leaves an unlisted lamp live', async () => {
    const root = await shell();
    const baked = lampPlacement(CALIBRATION_LAMP.id);
    const live = lampPlacement('01a16825-acf5-7011-8f24-000000000001');
    root.add(baked.group, live.group);
    const bound = bindLightBake(root, sidecar(), [page()]);
    expect(baked.light.userData).toEqual({ jeexBaked: true });
    expect(live.light.userData).toEqual({});
    expect(bound.unresolvedLamps).toEqual([]);
  });

  test('keeps the source material hook and program key on the clone', async () => {
    const root = await shell();
    const source = materialOf(root, CALIBRATION_NODES.floor);
    const seen: string[] = [];
    source.onBeforeCompile = () => void seen.push('previous');
    source.customProgramCacheKey = () => 'previous-key';
    bindLightBake(root, sidecar(), [page()]);
    // The binding's preflight ran the composed hook once on a throwaway copy.
    expect(seen).toEqual(['previous']);
    seen.length = 0;
    const clone = materialOf(root, CALIBRATION_NODES.floor);
    const shader = {
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      vertexShader: '',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    clone.onBeforeCompile(shader, undefined as never);
    expect(seen).toEqual(['previous']);
    expect(shader.fragmentShader).toContain('#define lightMapIntensity ( lightMapIntensity * lightMapTexel.a * JEEX_RGBM_RANGE )');
    // The shader composer leads the key, then the previous key, then its transforms in their fixed order.
    expect(clone.customProgramCacheKey()).toBe('jeex|previous-key|jeex-baked-surface@2|jeex-lightmap-rgbm-r8@1');
  });

  test('clones of a walk-patched source and of a plain one, once both walk-patched, share one program key', async () => {
    const patchedRoot = await shell();
    installWalkPatch(patchedRoot, createWalkUniforms());
    bindLightBake(patchedRoot, sidecar(), [page()]);
    const plainRoot = await shell();
    bindLightBake(plainRoot, sidecar(), [page()]);
    installWalkPatch(plainRoot, createWalkUniforms());
    const patched = materialOf(patchedRoot, CALIBRATION_NODES.floor);
    const plain = materialOf(plainRoot, CALIBRATION_NODES.floor);
    expect(plain.customProgramCacheKey()).toBe(patched.customProgramCacheKey());
    expect(plain.customProgramCacheKey()).toBe('jeex||jeex-walk-lighting@3|jeex-baked-surface@2|jeex-lightmap-rgbm-r8@1');
  });

  test('a source that already carries the walk lighting gives its clone the patch, the policy and the decode, without touching the source', async () => {
    const root = await shell();
    const source = materialOf(root, CALIBRATION_NODES.floor);
    installWalkPatch(root, createWalkUniforms());
    bindLightBake(root, sidecar(), [page()]);
    const clone = materialOf(root, CALIBRATION_NODES.floor);
    const shader = {
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      vertexShader: '',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    clone.onBeforeCompile(shader, undefined as never);
    expect(shader.fragmentShader).toContain('jeexLocate( - vViewPosition, normal );');
    expect(shader.fragmentShader).toContain('#define JEEX_BAKED_SURFACE');
    expect(shader.fragmentShader).toContain('#define lightMapIntensity ( lightMapIntensity * lightMapTexel.a * JEEX_RGBM_RANGE )');
    expect(clone.customProgramCacheKey()).toMatch(/\|jeex-walk-lighting@3\|jeex-baked-surface@2\|jeex-lightmap-rgbm-r8@1$/);
    expect(source.customProgramCacheKey()).toMatch(/\|jeex-walk-lighting@3$/);
  });

  test('refuses a missing, ambiguous, multi-material or UV-less mesh, and UV1 outside its rect, changing nothing', async () => {
    const cases: [string, (root: THREE.Object3D) => void, string][] = [
      ['missing', (root) => (meshNamed(root, CALIBRATION_NODES.floor).name = 'wall-face'), 'no mesh has this name'],
      [
        'ambiguous',
        (root) => (root.add(new THREE.Group().add(new THREE.Object3D())).children.at(-1)!.children[0]!.name = CALIBRATION_NODES.floor),
        '2 objects have this name',
      ],
      [
        'multi-material',
        (root) =>
          (meshNamed(root, CALIBRATION_NODES.floor).material = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]),
        'more than one material',
      ],
      [
        'basic material',
        (root) => (meshNamed(root, CALIBRATION_NODES.floor).material = new THREE.MeshBasicMaterial()),
        'no standard material',
      ],
      ['no UV1', (root) => meshNamed(root, CALIBRATION_NODES.floor).geometry.deleteAttribute('uv1'), 'no two-component UV1'],
      [
        'UV1 outside',
        (root) => (meshNamed(root, CALIBRATION_NODES.floor).geometry.getAttribute('uv1') as THREE.BufferAttribute).setX(0, 0.9),
        'UV1 leaves the chart rect',
      ],
      [
        'UV1 not finite',
        (root) => (meshNamed(root, CALIBRATION_NODES.floor).geometry.getAttribute('uv1') as THREE.BufferAttribute).setX(0, Number.NaN),
        'UV1 is not finite',
      ],
    ];
    for (const [name, spoil, why] of cases) {
      const root = await shell();
      spoil(root);
      const before = new Map<THREE.Object3D, unknown>();
      root.traverse((object) => before.set(object, (object as THREE.Mesh).material));
      let error: unknown;
      try {
        bindLightBake(root, sidecar(), [page()]);
      } catch (caught) {
        error = caught;
      }
      expect({ name, refused: error instanceof LightBakeError }).toEqual({ name, refused: true });
      expect((error as Error).message).toContain(why);
      root.traverse((object) => expect((object as THREE.Mesh).material).toBe(before.get(object) as never));
    }
  });

  test('refuses, changing nothing, when an existing hook leaves the decode no anchor', async () => {
    const root = await shell();
    const floor = materialOf(root, CALIBRATION_NODES.floor);
    floor.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lightmap_pars_fragment>', '');
    };
    expect(() => bindLightBake(root, sidecar(), [page()])).toThrow('no lightmap pars include or declaration');
    expect(materialOf(root, CALIBRATION_NODES.floor)).toBe(floor);
    expect(isBakedSurface(materialOf(root, CALIBRATION_NODES.ceiling))).toBe(false);
  });

  test('drops an AO map from the clone and leaves a transmissive material unbound, unmarked and named', async () => {
    const root = await shell();
    const floor = materialOf(root, CALIBRATION_NODES.floor);
    floor.aoMap = new THREE.Texture();
    const glass = new THREE.MeshPhysicalMaterial({ transmission: 1 });
    meshNamed(root, CALIBRATION_NODES.plate).material = glass;
    const bound = bindLightBake(root, sidecar(), [page()]);
    expect(materialOf(root, CALIBRATION_NODES.floor).aoMap).toBeNull();
    expect(floor.aoMap).not.toBeNull();
    expect(materialOf(root, CALIBRATION_NODES.plate)).toBe(glass);
    expect(isBakedSurface(glass)).toBe(false);
    expect(bound.transmissive).toEqual([CALIBRATION_NODES.plate]);
  });

  test('preflights the clone in its final state: a hook that drops the anchor only once a lightmap is set is refused, and so is a hook that throws', async () => {
    for (const hook of [
      function (this: THREE.MeshStandardMaterial, shader: THREE.WebGLProgramParametersWithUniforms) {
        if (this.lightMap) shader.fragmentShader = shader.fragmentShader.replace('#include <lightmap_pars_fragment>', '');
      },
      () => {
        throw new Error('needs a renderer');
      },
    ]) {
      const root = await shell();
      const floor = materialOf(root, CALIBRATION_NODES.floor);
      floor.onBeforeCompile = hook;
      expect(() => bindLightBake(root, sidecar(), [page()])).toThrow(LightBakeError);
      expect(materialOf(root, CALIBRATION_NODES.floor)).toBe(floor);
      expect(floor.lightMap).toBeNull();
    }
  });

  test('refuses a texture list that does not match the pages', async () => {
    expect(() => bindLightBake(new THREE.Group(), sidecar(), [])).toThrow(LightBakeError);
  });

  test('unbind restores materials and lamp flags once, and leaves a material changed since', async () => {
    const root = await shell();
    const { group, light } = lampPlacement(CALIBRATION_LAMP.id);
    root.add(group);
    const floor = materialOf(root, CALIBRATION_NODES.floor);
    const ceiling = materialOf(root, CALIBRATION_NODES.ceiling);
    const bound = bindLightBake(root, sidecar(), [page()]);
    const repainted = new THREE.MeshStandardMaterial();
    meshNamed(root, CALIBRATION_NODES.ceiling).material = repainted;
    bound.unbind();
    expect(materialOf(root, CALIBRATION_NODES.floor)).toBe(floor);
    expect(materialOf(root, CALIBRATION_NODES.ceiling)).toBe(repainted);
    expect(isBakedSurface(floor) || isBakedSurface(ceiling)).toBe(false);
    expect(light.userData).toEqual({});
    meshNamed(root, CALIBRATION_NODES.floor).material = repainted;
    bound.unbind();
    expect(materialOf(root, CALIBRATION_NODES.floor)).toBe(repainted);
  });

  test('unbind puts back a lamp flag that was there before', async () => {
    const root = await shell();
    const { group, light } = lampPlacement(CALIBRATION_LAMP.id);
    light.userData['jeexBaked'] = false;
    root.add(group);
    bindLightBake(root, sidecar(), [page()]).unbind();
    expect(light.userData).toEqual({ jeexBaked: false });
  });
});

describe('bindLightBake and the lamp lights of a project', () => {
  /** The lamp fixture's table lamp, built by the loader as the placement the calibration bake lists. */
  function factLamp(): { group: THREE.Group; light: THREE.PointLight } {
    const manifest = parseProjectManifest(JSON.parse(readFileSync(new URL('../project-lamps/project.json', DIR), 'utf8')) as unknown);
    const bank = projectBank(manifest, 'https://lamps.test/bake/');
    const loader = new AssetLoader([], {
      defaultLibrary: manifest.library.id,
      catalogue: bank.catalogue,
      resolveFinish: bank.resolveFinish,
      projectMaterials: manifest.library.materials,
      modelUrl: () => undefined,
    });
    const { group } = loader.load({
      id: CALIBRATION_LAMP.id,
      type: LAMPS.asset.tableLamp,
      asset: LAMPS.asset.tableLamp,
      variant: LAMPS.variant.tableLamp,
      position: { x: 1, y: 0, z: 1 },
    });
    let light: THREE.PointLight | undefined;
    group.traverse((child) => {
      if (lampLightTag(child) !== null) light = child as THREE.PointLight;
    });
    if (!light) throw new Error('the table lamp should carry its fact light');
    return { group, light };
  }

  test('a listed fact lamp has its lights marked baked, and unbinding restores their state', async () => {
    const root = await shell();
    const { group, light } = factLamp();
    root.add(group);
    const before = { ...light.userData };
    const bound = bindLightBake(root, sidecar(), [page()]);
    expect(bound.unresolvedLamps).toEqual([]);
    expect(light.userData).toEqual({ ...before, jeexBaked: true });
    bound.unbind();
    expect(light.userData).toEqual(before);
  });
});
