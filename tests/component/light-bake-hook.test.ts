/**
 * The page's debug light bake on a mounted viewer, in a real browser: the
 * demo flat is mounted with `__JEEX_DEBUG_LIGHT_BAKE__` naming a stand-in bake
 * (the player's own shell export, given UV1 by the tests' stand-in unwrap and
 * lit by the calibration page) and `__JEEX_DEBUG_CAMERA__` naming a view.
 * The bake is applied once the scene settled, on the live shell objects; a
 * repaint drops it before the repaint lands; dispose restores the live shell;
 * a bake made for another revision is refused with one warning; a lost and
 * restored WebGL context binds it again exactly once.
 */

import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { SceneBuilder } from '../../src/geometry/scene-builder.js';
import { standInSidecar, standInUnwrap, type Unwrapped } from '../../src/fixtures/shell-unwrap.js';
import type { LightBake } from '../../src/lightmap/light-bake.js';
import { liveShellEntries } from '../../src/lightmap/baked-shell.js';
import { exportShellForBake, SHIPPED_FINISHES } from '../../src/lightmap/shell-export.js';
import { shellInputsHash } from '../../src/lightmap/shell-inputs.js';
import { FINISH } from '../../src/materials/finish-ids.js';
import { isBakedSurface } from '../../src/render/baked-surface.js';
import { isApplyOk } from '../../src/scene/scene-model.js';
import type { LogEntry } from '../../src/shared/logger.js';
import type { HdriEntry } from '../../src/lighting/hdri-entry.js';
import type { SceneData } from '../../src/scene/types.js';
import CALIBRATION from '../fixtures/lightmap-calibration/sidecar.json' with { type: 'json' };
import { closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';
import { FIXTURE } from './lightmap-support.js';

const MOUNT_TIMEOUT_MS = 180_000;
const BAKE_TIMEOUT_MS = 120_000;
const BASE = 'https://bake.test/hook/';
/** A view inside the flat: the eye of the walk, looking along the plan. */
const VIEW = { mode: 'walk', position: [2.2, 1.6, 2.4], target: [5.2, 1.5, 2.4] } as const;

const page = globalThis as { __JEEX_DEBUG_LIGHT_BAKE__?: unknown; __JEEX_DEBUG_CAMERA__?: unknown };
const debug = () => window.__viewerDebug!;
const handles: ViewerHandle[] = [];
const roots: THREE.Group[] = [];
const realFetch = globalThis.fetch.bind(globalThis);

let unwrapped: Unwrapped;
let bake: LightBake;
/** What `https://bake.test/hook/sidecar.json` serves; a test may swap it. */
let served: LightBake;
/** How many times the sidecar was asked for: one per attempt. */
let attempts = 0;
/** Every URL fetched through the page's `fetch`. */
const fetched: string[] = [];

beforeAll(async () => {
  const scene = demoScene();
  let n = 0;
  const exported = await exportShellForBake(scene, {
    mintId: () => `01a1f200-0000-7000-8000-${(n++).toString(16).padStart(12, '0')}`,
    finishes: SHIPPED_FINISHES,
  });
  unwrapped = await standInUnwrap(exported.glb);
  bake = await standInSidecar(unwrapped, CALIBRATION as unknown as LightBake, scene.id, await shellInputsHash(scene));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    if (!url.startsWith(BASE)) return realFetch(input, init);
    const name = url.slice(BASE.length);
    if (name === 'sidecar.json') {
      attempts += 1;
      return new Response(JSON.stringify(served));
    }
    if (name === 'shell.glb') return new Response(unwrapped.glb.slice(0));
    return realFetch(new URL(name, FIXTURE));
  });
  const build = Object.getOwnPropertyDescriptor(SceneBuilder.prototype, 'build')!.value as SceneBuilder['build'];
  vi.spyOn(SceneBuilder.prototype, 'build').mockImplementation(function (this: SceneBuilder) {
    const built = build.call(this);
    roots.push(built.root);
    return built;
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
  roots.length = 0;
  delete page.__JEEX_DEBUG_LIGHT_BAKE__;
  delete page.__JEEX_DEBUG_CAMERA__;
});

/** Mounts the demo flat with the debug bake and view; `log` collects what the viewer reports. */
async function mounted(log: LogEntry[] = []): Promise<{ handle: ViewerHandle; container: HTMLElement }> {
  served = bake;
  page.__JEEX_DEBUG_LIGHT_BAKE__ = { sidecar: `${BASE}sidecar.json`, shell: `${BASE}shell.glb` };
  page.__JEEX_DEBUG_CAMERA__ = VIEW;
  const container = openContainer(480, 320);
  const handle = mountViewer(container, {
    scene: { repository: new InlineSceneRepository(demoScene()) },
    tour: { mode: 'off' },
    debug: true,
    onLog: (entry) => log.push(entry),
  });
  handles.push(handle);
  await new Promise<void>((resolve) => {
    handle.on('ready', () => resolve());
  });
  return { handle, container };
}

/** The live shell of the current root. */
const shellMeshes = (): THREE.Mesh[] => liveShellEntries(roots.at(-1)!, demoScene()).map(({ mesh }) => mesh);
/** Meshes of the current shell drawn with a baked material. */
const bakedMeshes = (): THREE.Mesh[] => shellMeshes().filter((mesh) => isBakedSurface(mesh.material as THREE.Material));
/** Meshes of the current shell wearing the shipped shell's UV1. */
const withUv1 = (): THREE.Mesh[] => shellMeshes().filter((mesh) => mesh.geometry.getAttribute('uv1') !== undefined);

const untilState = (state: string): Promise<void> =>
  until(() => debug().lightBake().state === state, `light bake ${state} (now ${JSON.stringify(debug().lightBake())})`, BAKE_TIMEOUT_MS);

describe('the debug light bake', () => {
  test(
    'opens on the named view and bakes the live shell objects; a repaint drops it before it lands',
    async () => {
      await mounted();
      expect(debug().mode()).toBe('walk');
      const eye = debug().camera()!;
      expect([eye.x, eye.y, eye.z].map((value) => Math.round(value * 100) / 100)).toEqual([...VIEW.position]);
      const live = shellMeshes();
      await untilState('applied');
      expect(debug().lightBake()).toEqual({ state: 'applied', bakeId: bake.bakeId, bound: bake.bindings.length });
      expect(shellMeshes()).toEqual(live);
      expect(bakedMeshes()).toHaveLength(bake.bindings.length);
      expect(withUv1()).toHaveLength(bake.bindings.length);

      const room = demoScene().rooms[0]!.id;
      const root = roots.at(-1)!;
      const floor = root.getObjectByName(`floor-${room}`) as THREE.Mesh;
      const result = debug().applyOps!([{ op: 'set_material', surface: 'floor', room, material: FINISH.walnut }]);
      expect(isApplyOk(result)).toBe(true);
      expect(debug().lightBake().state).toBe('dropped');
      // Repainted in place: had the repaint met the bound clone, the shell would have drifted and been rebuilt.
      expect(roots.at(-1)).toBe(root);
      expect(bakedMeshes()).toHaveLength(0);
      expect(withUv1()).toHaveLength(0);
      expect(debug().floorFinish(room)).toBe(FINISH.walnut);
      expect(isBakedSurface(floor.material as THREE.Material)).toBe(false);
      expect((floor.material as THREE.MeshStandardMaterial).lightMap).toBeNull();
    },
    MOUNT_TIMEOUT_MS,
  );

  test(
    'dispose gives the live shell back',
    async () => {
      const { handle } = await mounted();
      await untilState('applied');
      const meshes = shellMeshes();
      const bakedMaterials = meshes.map((mesh) => mesh.material as THREE.MeshStandardMaterial);
      handle.dispose();
      // Every bound clone is its source (given back by the dispose) with the lightmap added and the AO map dropped, nothing else.
      let compared = 0;
      for (const [i, mesh] of meshes.entries()) {
        const clone = bakedMaterials[i]!;
        if (!isBakedSurface(clone)) continue;
        const source = mesh.material as THREE.MeshStandardMaterial;
        compared += 1;
        expect(clone).not.toBe(source);
        expect([clone.map, clone.color.getHex(), clone.map?.colorSpace, clone.roughness, clone.metalness, clone.normalMap]).toEqual([
          source.map,
          source.color.getHex(),
          source.map?.colorSpace,
          source.roughness,
          source.metalness,
          source.normalMap,
        ]);
        expect(clone.aoMap).toBeNull();
        expect(clone.lightMap).not.toBeNull();
      }
      expect(compared).toBe(bake.bindings.length);
      expect(meshes.filter((mesh) => mesh.geometry.getAttribute('uv1') !== undefined)).toHaveLength(0);
      expect(meshes.filter((mesh) => isBakedSurface(mesh.material as THREE.Material))).toHaveLength(0);
      expect(meshes.map((mesh) => mesh.material)).not.toEqual(bakedMaterials);
    },
    MOUNT_TIMEOUT_MS,
  );

  test(
    'a bake made for another revision of the shell is refused with one warning, and live lighting stays',
    async () => {
      const log: LogEntry[] = [];
      served = { ...bake, shellInputsHash: `sha256:${'0'.repeat(64)}` };
      page.__JEEX_DEBUG_LIGHT_BAKE__ = { sidecar: `${BASE}sidecar.json`, shell: `${BASE}shell.glb` };
      const handle = mountViewer(openContainer(480, 320), {
        scene: { repository: new InlineSceneRepository(demoScene()) },
        tour: { mode: 'off' },
        debug: true,
        onLog: (entry) => log.push(entry),
      });
      handles.push(handle);
      await new Promise<void>((resolve) => {
        handle.on('ready', () => resolve());
      });
      await untilState('refused');
      expect(debug().lightBake()).toMatchObject({ state: 'refused', reason: 'shell' });
      const refusals = log.filter((entry) => entry.code === 'light-bake-refused');
      expect(refusals).toHaveLength(1);
      expect(refusals[0]!.message).toContain('another revision');
      expect(bakedMeshes()).toHaveLength(0);
      expect(withUv1()).toHaveLength(0);
    },
    MOUNT_TIMEOUT_MS,
  );

  test(
    'a host sky over a bake: held while the bake loads, the sky alone once applied, full lighting once dropped',
    async () => {
      const log: LogEntry[] = [];
      const scene: SceneData = { ...demoScene(), site: { northDeg: 30, sun: 'noon' } };
      served = await standInSidecar(unwrapped, CALIBRATION as unknown as LightBake, scene.id, await shellInputsHash(scene));
      page.__JEEX_DEBUG_LIGHT_BAKE__ = { sidecar: `${BASE}sidecar.json`, shell: `${BASE}shell.glb` };
      page.__JEEX_DEBUG_CAMERA__ = VIEW;
      const hdriFile = (name: string): string => new URL(`/tests/fixtures/hdri/${name}`, location.href).href;
      const sidecar = (await (await realFetch(hdriFile('sky.json'))).json()) as { sun: HdriEntry['sun'] };
      const entry: HdriEntry = { environmentUrl: hdriFile('sky-1k.jpg'), skyUrl: hdriFile('sky-256.avif'), sun: sidecar.sun };
      fetched.length = 0;
      const handle = mountViewer(openContainer(480, 320), {
        scene: { repository: new InlineSceneRepository(scene) },
        tour: { mode: 'off' },
        debug: true,
        lighting: { hdri: { noon: entry } },
        onLog: (item) => log.push(item),
      });
      handles.push(handle);
      await new Promise<void>((resolve) => {
        handle.on('ready', () => resolve());
      });
      await untilState('applied');
      await until(() => debug().hdri().state === 'sky-only', `the sky alone (now ${JSON.stringify(debug().hdri())})`, BAKE_TIMEOUT_MS);
      expect(fetched).toContain(entry.skyUrl);
      expect(fetched).not.toContain(entry.environmentUrl);
      // The bake's daylight stays: the preset sun, not the sky's.
      expect(debug().sunShadow()!.elevation).toBe(55);
      expect(log.filter((item) => item.code === 'hdri-bake-daylight')).toHaveLength(1);
      const room = scene.rooms[0]!.id;
      expect(isApplyOk(debug().applyOps!([{ op: 'set_material', surface: 'floor', room, material: FINISH.walnut }]))).toBe(true);
      expect(debug().lightBake().state).toBe('dropped');
      await until(
        () => debug().hdri().state === 'live',
        `full lighting after the drop (now ${JSON.stringify(debug().hdri())})`,
        BAKE_TIMEOUT_MS * 2,
      );
      expect(fetched).toContain(entry.environmentUrl);
      expect(debug().sunShadow()!.elevation).toBeCloseTo(entry.sun.elevationDeg, 6);
      expect(log.filter((item) => item.code === 'hdri-bake-daylight')).toHaveLength(1);
    },
    MOUNT_TIMEOUT_MS * 2,
  );

  test(
    'a lost and restored WebGL context bakes the rebuilt shell again, exactly once',
    async () => {
      const { container } = await mounted();
      await untilState('applied');
      const before = roots.at(-1)!;
      const attemptsBefore = attempts;
      const canvas = container.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
      const lose = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
      const lost = new Promise((resolve) => {
        canvas.addEventListener('webglcontextlost', resolve, { once: true });
      });
      lose.loseContext();
      await lost;
      await nextFrame();
      await nextFrame();
      lose.restoreContext();
      await until(() => roots.at(-1) !== before, 'the shell rebuilt after the restore', BAKE_TIMEOUT_MS);
      expect(debug().lightBake().state).not.toBe('applied');
      await untilState('applied');
      expect(attempts - attemptsBefore).toBe(1);
      expect(bakedMeshes()).toHaveLength(bake.bindings.length);
      expect(withUv1()).toHaveLength(bake.bindings.length);
      const old = liveShellEntries(before, demoScene()).map(({ mesh }) => mesh);
      expect(old.filter((mesh) => isBakedSurface(mesh.material as THREE.Material))).toHaveLength(0);
    },
    MOUNT_TIMEOUT_MS,
  );
});
