/**
 * The round trip of a light bake's shell on the demo apartment: export, a
 * stand-in UV1 step that splits vertices, then adoption into a live scene
 * built from the same document. Adoption must leave every behaviour of the
 * live shell (picking, paint registrations, opening behaviour, visibility)
 * and every world position as it was, give the lit meshes their UV1, keep
 * the site and glazing live, and refuse a file made for another revision
 * before anything changes. Page decoding is the browser's
 * (`tests/component/baked-shell.test.ts`).
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { apartmentScene } from '../demo/scene-data.js';
import { Dollhouse } from '../geometry/dollhouse.js';
import { SceneBuilder } from '../geometry/scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { draftOf } from '../shared/committed.js';
import type { SceneData } from '../scene/types.js';
import { glbJson, isLit, standInSidecar, standInUnwrap, type Unwrapped } from '../fixtures/shell-unwrap.js';
import type { LightBake } from './light-bake.js';
import type { ShellNodeExtras } from './shell-extras.schema.js';
import { LightBakeError } from './light-bake-error.js';
import { isBakedSurface } from '../render/baked-surface.js';
import { bindLightBake } from './lightmap-binding.js';
import { applyBakedShell, liveShellEntries, verifiedShellFile } from './baked-shell.js';
import { adoptShippedShell, parseShellFile } from './shell-adopt.js';
import { exportShellForBake, SHIPPED_FINISHES } from './shell-export.js';
import { shellInputsHash } from './shell-inputs.js';
import CALIBRATION from '../../tests/fixtures/lightmap-calibration/sidecar.json' with { type: 'json' };

const PAGE = 512;
const minter = (prefix: string): (() => string) => {
  let n = 0;
  return () => `${prefix}-0000-7000-8000-${(n++).toString(16).padStart(12, '0')}`;
};

const exported = await exportShellForBake(apartmentScene, { mintId: minter('01a1b000'), finishes: SHIPPED_FINISHES });
const unwrapped: Unwrapped = await standInUnwrap(exported.glb, PAGE);
const liveHash = await shellInputsHash(apartmentScene);

const sidecarFor = (file: Unwrapped, overrides: Partial<LightBake> = {}): Promise<LightBake> =>
  standInSidecar(file, CALIBRATION as unknown as LightBake, apartmentScene.id, liveHash, PAGE).then((bake) => ({ ...bake, ...overrides }));

function live(scene: SceneData = apartmentScene): { root: THREE.Group; shell: THREE.Object3D } {
  const root = new SceneBuilder(scene, solvePlan(scene)).build().root;
  root.updateMatrixWorld(true);
  return { root, shell: root.getObjectByName('parametric-shell')! };
}

/** Everything about one mesh the rest of the player reads, resolvers answered, plus its world triangles. */
function behaviour(mesh: THREE.Mesh): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mesh.userData)) data[key] = typeof value === 'function' ? (value as () => unknown)() : value;
  return { name: mesh.name, parent: mesh.parent?.name, visible: mesh.visible, layers: mesh.layers.mask, material: mesh.material, data };
}

/** The mesh's triangles in world space, in drawing order, each as nine rounded numbers. */
function worldTriangles(mesh: THREE.Mesh): number[][] {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const position = geometry.getAttribute('position');
  const triangles: number[][] = [];
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    const triangle: number[] = [];
    for (let k = 0; k < 3; k++) {
      mesh.localToWorld(point.fromBufferAttribute(position, i + k));
      triangle.push(...point.toArray().map((value) => Math.round(value * 1e4) / 1e4 || 0));
    }
    triangles.push(triangle);
  }
  return triangles;
}

/** Rays across the plan at eye height and from above, and what each hits first. */
function picks(root: THREE.Object3D, shell: THREE.Object3D): Array<{ object: string; distance: number; data: unknown } | null> {
  const box = new THREE.Box3().setFromObject(shell);
  const caster = new THREE.Raycaster();
  const out: Array<{ object: string; distance: number; data: unknown } | null> = [];
  const targets: THREE.Object3D[] = [];
  shell.traverse((object) => {
    if (object instanceof THREE.Mesh && object.visible) targets.push(object);
  });
  for (let i = 0; i <= 12; i++)
    for (let j = 0; j <= 12; j++) {
      const x = box.min.x + ((box.max.x - box.min.x) * i) / 12;
      const z = box.min.z + ((box.max.z - box.min.z) * j) / 12;
      for (const [origin, direction] of [
        [new THREE.Vector3(x, 1.4, z), new THREE.Vector3(1, -0.05, 0.3).normalize()],
        [new THREE.Vector3(x, 8, z), new THREE.Vector3(0.05, -1, 0.02).normalize()],
      ] as const) {
        caster.set(origin, direction);
        const hit = caster.intersectObjects(targets, false)[0];
        root.updateMatrixWorld(true);
        out.push(
          hit
            ? { object: hit.object.uuid, distance: Math.round(hit.distance * 1e4) / 1e4, data: hit.object.userData['surface'] ?? null }
            : null,
        );
      }
    }
  return out;
}

async function refusal(promise: Promise<unknown>): Promise<LightBakeError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LightBakeError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('the stand-in unwrap', () => {
  test('splits vertices and keeps names, order, materials and extras', () => {
    const before = glbJson(exported.glb);
    const after = glbJson(unwrapped.glb);
    expect(after.nodes.map((node) => [node.name, node.extras])).toEqual(before.nodes.map((node) => [node.name, node.extras]));
    expect(after.materials.map((material) => material.extras)).toEqual(before.materials.map((material) => material.extras));
    const accessors = (json: typeof before) => (json as unknown as { accessors: Array<{ count: number }> }).accessors;
    const count = (json: typeof before, i: number) => accessors(json)[json.meshes[i]!.primitives[0].attributes.POSITION]!.count;
    expect(before.meshes.some((_, i) => count(before, i) !== count(after, i))).toBe(true);
  });
});

describe('adoptShippedShell', () => {
  test('keeps every behaviour and world position of the live shell, and gives the lit meshes UV1', async () => {
    const { root, shell } = live();
    const entries = liveShellEntries(root, apartmentScene);
    const before = entries.map(({ mesh }) => ({ behaviour: behaviour(mesh), triangles: worldTriangles(mesh), geometry: mesh.geometry }));
    const rays = picks(root, shell);
    const shipped = await parseShellFile(unwrapped.glb, 'test');
    const adopted = adoptShippedShell(entries, shipped);
    shipped.dispose();

    for (const [i, { mesh, extras }] of entries.entries()) {
      expect(behaviour(mesh)).toEqual(before[i]!.behaviour);
      const triangles = worldTriangles(mesh);
      expect(triangles.length).toBe(before[i]!.triangles.length);
      expect(triangles).toEqual(before[i]!.triangles);
      const uv1 = mesh.geometry.getAttribute('uv1');
      expect({ kind: extras.kind, uv1: uv1 !== undefined }).toEqual({ kind: extras.kind, uv1: isLit(extras) });
      if (!isLit(extras)) expect(mesh.geometry).toBe(before[i]!.geometry);
      const origin = mesh.getWorldPosition(new THREE.Vector3()).toArray();
      for (let k = 0; k < 3; k++) expect(origin[k]!).toBeCloseTo(extras.origin[k]!, 5);
    }
    expect(picks(root, shell)).toEqual(rays);
    expect(adopted.named.size).toBe(entries.length);

    adopted.restore();
    for (const [i, { mesh }] of entries.entries()) expect(mesh.geometry).toBe(before[i]!.geometry);
  });

  test('keeps opening behaviour: the dollhouse cuts and restores adopted frame parts at the same places', async () => {
    const { root, shell } = live();
    const entries = liveShellEntries(root, apartmentScene);
    const plan = solvePlan(apartmentScene);
    const run = (): number[][][] => {
      const dollhouse = new Dollhouse(() => []);
      dollhouse.prepare(plan, root);
      const shots: number[][][] = [];
      for (const state of ['dollhouse', 'full'] as const) {
        dollhouse.setState(state);
        root.updateMatrixWorld(true);
        shots.push(
          entries
            .filter(({ extras }) => extras.kind === 'opening')
            .map(({ mesh }) => [mesh.visible ? 1 : 0, ...worldTriangles(mesh).flat()]),
        );
      }
      return shots;
    };
    const before = run();
    const shipped = await parseShellFile(unwrapped.glb, 'test');
    adoptShippedShell(entries, shipped);
    shipped.dispose();
    expect(run()).toEqual(before);
    expect(shell.children.length).toBeGreaterThan(0);
  });

  test('refuses a live shell built from another revision, and changes nothing', async () => {
    const scene = draftOf(apartmentScene) as SceneData & { walls: Array<{ thickness: number }> };
    scene.walls[0]!.thickness += 0.02;
    const { root } = live(scene);
    const entries = liveShellEntries(root, scene);
    const geometries = entries.map(({ mesh }) => mesh.geometry);
    const shipped = await parseShellFile(unwrapped.glb, 'test');
    expect(() => adoptShippedShell(entries, shipped)).toThrow(LightBakeError);
    shipped.dispose();
    expect(entries.map(({ mesh }) => mesh.geometry)).toEqual(geometries);
  });
});

describe('verifiedShellFile', () => {
  const bytes = unwrapped.glb;

  test('accepts the file of this revision', async () => {
    const shipped = await verifiedShellFile(await sidecarFor(unwrapped), bytes, apartmentScene, liveHash);
    expect(shipped.meshes.length).toBe(exported.names.length);
    shipped.dispose();
  });

  test('refuses a bake for another revision: a one-field change to the shell inputs', async () => {
    const scene = draftOf(apartmentScene) as SceneData & { ceilingHeight: number };
    scene.ceilingHeight += 0.01;
    const error = await refusal(verifiedShellFile(await sidecarFor(unwrapped), bytes, scene, await shellInputsHash(scene)));
    expect(error.reason).toBe('shell');
    expect(error.message).toContain('another revision');
  });

  test('refuses bindings that leave a lit mesh unbound', async () => {
    const bake = await sidecarFor(unwrapped);
    const missing = { ...bake, bindings: bake.bindings.slice(1) };
    const error = await refusal(verifiedShellFile(missing, bytes, apartmentScene, liveHash));
    expect(error.reason).toBe('binding');
    expect(error.message).toContain('not exactly the shell meshes it lit');
  });

  test('refuses a shell file that gives UV1 to the site or the glazing, which stay live', async () => {
    const lighting = {
      site: (extras: ShellNodeExtras) => isLit(extras) || extras.kind === 'site',
      glass: (extras: ShellNodeExtras) => isLit(extras) || (extras.kind === 'opening' && extras.opening === 'glass'),
    };
    for (const lights of Object.values(lighting)) {
      const file = await standInUnwrap(exported.glb, PAGE, 16, lights);
      const error = await refusal(verifiedShellFile(await sidecarFor(file), file.glb, apartmentScene, liveHash));
      expect(error.reason).toBe('shell');
      expect(error.message).toContain('stay live');
    }
  });

  test('refuses a sidecar without shellInputsHash or lights, for another scene, or disagreeing with the file', async () => {
    const { shellInputsHash: _omitted, ...without } = await sidecarFor(unwrapped);
    expect((await refusal(verifiedShellFile(without as LightBake, bytes, apartmentScene, liveHash))).message).toContain('scene inputs');
    const { lights: _unsaid, ...unlit } = await sidecarFor(unwrapped);
    expect((await refusal(verifiedShellFile(unlit as LightBake, bytes, apartmentScene, liveHash))).message).toContain('which lights');
    const foreign = await sidecarFor(unwrapped, { sceneId: '01a1d000-0000-7000-8000-000000000000' });
    expect((await refusal(verifiedShellFile(foreign, bytes, apartmentScene, liveHash))).message).toContain('another scene');
    const other = `sha256:${'0'.repeat(64)}`;
    const disagreeing = await sidecarFor(unwrapped, { shellInputsHash: other });
    expect((await refusal(verifiedShellFile(disagreeing, bytes, apartmentScene, other))).message).toContain('disagree');
  });
});

describe('binding an adopted shell', () => {
  test('binds every lit mesh by its file name and leaves the site and glazing live and unmarked', async () => {
    const { root } = live();
    const entries = liveShellEntries(root, apartmentScene);
    const shipped = await parseShellFile(unwrapped.glb, 'test');
    const adopted = adoptShippedShell(entries, shipped);
    shipped.dispose();
    const bake = await sidecarFor(unwrapped);
    const bound = bindLightBake(root, bake, [new THREE.Texture()], adopted.named);
    for (const { mesh, extras } of entries) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect({ kind: extras.kind, opening: 'opening' in extras ? extras.opening : undefined, baked: isBakedSurface(material) }).toEqual({
        kind: extras.kind,
        opening: 'opening' in extras ? extras.opening : undefined,
        baked: isLit(extras),
      });
    }
    bound.unbind();
    adopted.restore();
  });

  test('refuses a binding that names a mesh without UV1 (the site), changing nothing', async () => {
    const { root } = live();
    const entries = liveShellEntries(root, apartmentScene);
    const shipped = await parseShellFile(unwrapped.glb, 'test');
    const adopted = adoptShippedShell(entries, shipped);
    shipped.dispose();
    const site = [...adopted.named].find(([, mesh]) => mesh.name === 'site-slab')![0];
    const bake = await sidecarFor(unwrapped);
    const withSite = { ...bake, bindings: [...bake.bindings, { node: site, page: 0, rect: { x: 0, y: 496, w: 16, h: 16 } }] };
    const materials = entries.map(({ mesh }) => mesh.material);
    expect(() => bindLightBake(root, withSite, [new THREE.Texture()], adopted.named)).toThrow('no two-component UV1');
    expect(entries.map(({ mesh }) => mesh.material)).toEqual(materials);
    adopted.restore();
  });
});

describe('applyBakedShell', () => {
  /** Serves a sidecar and a shell file from memory, recording every request. */
  const serve = (sidecar: unknown, shell: ArrayBuffer) => {
    const asked: string[] = [];
    return {
      asked,
      fetchBytes: async (url: URL): Promise<Blob> => {
        const name = url.pathname.split('/').at(-1)!;
        asked.push(name);
        if (name === 'sidecar.json') return new Blob([JSON.stringify(sidecar)]);
        if (name === 'shell.glb') return new Blob([shell]);
        throw new Error(`unexpected ${name}`);
      },
    };
  };
  const urls = { sidecarUrl: new URL('https://bake.test/b/sidecar.json'), shellUrl: new URL('https://bake.test/b/shell.glb') };

  test('keeps the live shell and asks for neither the shell file nor a page when the scene changed since the bake', async () => {
    const scene = draftOf(apartmentScene) as SceneData & { ceilingHeight: number };
    scene.ceilingHeight += 0.01;
    const { root } = live(scene);
    const geometries = liveShellEntries(root, scene).map(({ mesh }) => mesh.geometry);
    const { fetchBytes, asked } = serve(await sidecarFor(unwrapped), unwrapped.glb);
    const outcome = await applyBakedShell({ ...urls, scene, root, fetchBytes });
    expect(outcome.applied).toBe(false);
    if (!outcome.applied) expect(outcome.error.message).toContain('another revision');
    expect(asked).toEqual(['sidecar.json']);
    expect(liveShellEntries(root, scene).map(({ mesh }) => mesh.geometry)).toEqual(geometries);
  });

  test('refuses a shell file whose bytes differ from shellHash', async () => {
    const { root } = live();
    const tampered = unwrapped.glb.slice(0);
    new Uint8Array(tampered)[tampered.byteLength - 1]! ^= 1;
    const { fetchBytes, asked } = serve(await sidecarFor(unwrapped), tampered);
    const outcome = await applyBakedShell({ ...urls, scene: apartmentScene, root, fetchBytes });
    expect(outcome.applied ? 'applied' : outcome.error.message).toContain('another shell');
    expect(asked).toEqual(['sidecar.json', 'shell.glb']);
  });
});
