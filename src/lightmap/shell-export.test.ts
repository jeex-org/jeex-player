/**
 * The shell export for a light bake, on the demo apartment: identity nodes
 * with world-space vertices, one caller-minted UUID v7 per mesh, the contract
 * in `extras`, no furniture, no door leaves, no pick proxies; and the
 * scene-input digest, which no minted name and no furniture edit reaches.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { apartmentScene } from '../demo/scene-data.js';
import { SceneBuilder } from '../geometry/scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { draftOf } from '../shared/committed.js';
import type { SceneData } from '../scene/types.js';
import { glbJson } from '../fixtures/shell-unwrap.js';
import { judgeShellGltf, type ShellNodeExtras } from './shell-extras.schema.js';
import { exportShellForBake, SHIPPED_FINISHES } from './shell-export.js';
import { projectFinishes } from '../materials/project-finishes.js';
import { liveShellEntries } from './baked-shell.js';
import { unseenTriangles } from '../geometry/shell-unseen.js';
import { shellInputsHash } from './shell-inputs.js';
import { NATURAL_SCAN } from '../fixtures/library-materials.js';
import { DEFAULT_WALL_FINISH } from '../scene/scene-ops.js';
import type { ProjectMaterial } from '../materials/finish-types.js';

/** A deterministic UUID v7 minter: `prefix` keeps two minters apart. */
export function minter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-0000-7000-8000-${(n++).toString(16).padStart(12, '0')}`;
}

const A = minter('01a1b000');
const exported = await exportShellForBake(apartmentScene, { mintId: A, finishes: SHIPPED_FINISHES });
const json = glbJson(exported.glb);
const extras = json.nodes.map((node) => node.extras.jeex);

/** The triangles of `mesh` under `matrix`, in index order, each as nine numbers. */
function worldTriangles(mesh: THREE.Mesh, matrix: THREE.Matrix4): number[][] {
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.index;
  const count = index ? index.count : position.count;
  const point = new THREE.Vector3();
  const out: number[][] = [];
  for (let i = 0; i < count; i += 3) {
    const triangle: number[] = [];
    for (let k = 0; k < 3; k++)
      triangle.push(
        ...point
          .fromBufferAttribute(position, index ? index.getX(i + k) : i + k)
          .applyMatrix4(matrix)
          .toArray(),
      );
    out.push(triangle);
  }
  return out;
}

function liveRoot(scene: SceneData): THREE.Group {
  const root = new SceneBuilder(scene, solvePlan(scene)).build().root;
  root.updateMatrixWorld(true);
  return root;
}

describe('exportShellForBake', () => {
  test('writes a file the shell contract accepts: per live shell mesh its seen part, then its unseen part when it has one', () => {
    const verdict = judgeShellGltf(json);
    expect(verdict.ok ? 'ok' : verdict.message).toBe('ok');
    const expected = liveShellEntries(liveRoot(apartmentScene), apartmentScene).flatMap((entry) => {
      const flags = [...(unseenTriangles(entry.mesh.geometry) ?? [0])];
      return [...(flags.includes(0) ? [entry.extras] : []), ...(flags.includes(1) ? [{ ...entry.extras, unseen: true }] : [])];
    });
    // Through JSON, as the file carries them (`-0` becomes `0`).
    expect(extras).toEqual(JSON.parse(JSON.stringify(expected)) as ShellNodeExtras[]);
    expect(extras.some((entry) => 'unseen' in entry)).toBe(true);
  });

  test('gives both parts of a mesh the same material, and the same bytes for the same scene and minter', async () => {
    for (const [i, node] of json.nodes.entries()) {
      if (!('unseen' in node.extras.jeex)) continue;
      const seen = json.nodes[i - 1]!;
      expect(json.meshes[node.mesh]!.primitives[0].material).toBe(json.meshes[seen.mesh]!.primitives[0].material);
    }
    const again = await exportShellForBake(apartmentScene, { mintId: minter('01a1b000'), finishes: SHIPPED_FINISHES });
    expect(new Uint8Array(again.glb)).toEqual(new Uint8Array(exported.glb));
    expect(again.shellInputsHash).toBe(await shellInputsHash(apartmentScene));
  });

  test('names every node and mesh with the minted ids, in order, and gives them identity transforms', () => {
    expect(json.nodes.map((node) => node.name)).toEqual([...exported.names]);
    expect(new Set(exported.names).size).toBe(exported.names.length);
    for (const node of json.nodes) {
      const raw = node as Record<string, unknown>;
      expect([raw['matrix'], raw['translation'], raw['rotation'], raw['scale']]).toEqual([undefined, undefined, undefined, undefined]);
      expect(json.meshes[node.mesh]!.name).toBe(node.name);
    }
  });

  test('writes TEXCOORD_0 only: UV1 is the bake tool’s', () => {
    for (const mesh of json.meshes) expect(Object.keys(mesh.primitives[0].attributes).sort()).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0']);
  });

  test('covers every surface kind and leaves furniture, door leaves and pick proxies out', () => {
    const kinds = new Set(extras.map((entry) => entry.kind));
    expect([...kinds].sort()).toEqual(['ceiling', 'floor', 'joint', 'opening', 'site', 'skirting', 'wall']);
    const root = liveRoot(apartmentScene);
    const shell = root.getObjectByName('parametric-shell')!;
    let leaves = 0;
    let proxies = 0;
    shell.traverse((object) => {
      if (object.userData['isDoorLeaf'] === true) leaves += 1;
      if (object.name.endsWith('-pick')) proxies += 1;
    });
    expect(leaves).toBeGreaterThan(0);
    expect(proxies).toBeGreaterThan(0);
    const entries = liveShellEntries(root, apartmentScene);
    expect(entries.some(({ mesh }) => mesh.name.endsWith('-pick'))).toBe(false);
    for (const { mesh } of entries) {
      for (let at: THREE.Object3D | null = mesh; at; at = at.parent) {
        expect(at.userData['isDoorLeaf']).not.toBe(true);
        expect(at.name).not.toBe('furniture');
      }
    }
  });

  test('marks glazing, door frames and passage frames, and nothing else', () => {
    const openings = extras.filter((entry): entry is Extract<ShellNodeExtras, { kind: 'opening' }> => entry.kind === 'opening');
    expect(openings.filter((entry) => entry.opening === 'glass').every((entry) => !entry.castShadow)).toBe(true);
    expect(openings.some((entry) => entry.opening === 'glass')).toBe(true);
    expect(
      openings.filter((entry) => entry.openingType === 'door' && entry.opening !== 'glass').every((entry) => entry.opening === 'door'),
    ).toBe(true);
    expect(
      openings.filter((entry) => entry.openingType === 'window' && entry.opening !== 'glass').every((entry) => entry.opening === undefined),
    ).toBe(true);
    expect(extras.filter((entry) => entry.kind !== 'opening').every((entry) => !('opening' in entry))).toBe(true);
  });

  test('exports ceilings as visible: the bake needs them as casters', () => {
    expect(extras.filter((entry) => entry.kind === 'ceiling').every((entry) => entry.visible)).toBe(true);
  });

  test('writes each part’s world-space triangles: a mesh’s seen then unseen triangles, as the builder recorded them', async () => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const shipped = (await new GLTFLoader().parseAsync(exported.glb.slice(0), '')).scene.children as THREE.Mesh[];
    const entries = liveShellEntries(liveRoot(apartmentScene), apartmentScene);
    const fileTriangles = (mesh: THREE.Mesh): number[][] => worldTriangles(mesh, new THREE.Matrix4());
    let node = 0;
    for (const { mesh } of entries) {
      const live = worldTriangles(mesh, mesh.matrixWorld);
      const flags = unseenTriangles(mesh.geometry);
      const parts = [0, 1].map((flag) => live.filter((_, t) => (flags?.[t] ?? 0) === flag)).filter((part) => part.length > 0);
      for (const part of parts) {
        const file = fileTriangles(shipped[node++]!);
        expect(file.length).toBe(part.length);
        let worst = 0;
        part.forEach((triangle, t) => triangle.forEach((value, k) => (worst = Math.max(worst, Math.abs(value - file[t]![k]!)))));
        expect(worst).toBeLessThan(1e-5);
      }
    }
    expect(node).toBe(shipped.length);
    // The origin is real: most shell meshes stand inside their rooms, not at (0, 0, 0).
    expect(extras.filter((entry) => entry.origin.some((value) => value !== 0)).length).toBeGreaterThan(extras.length / 2);
  });

  test('marks about half of the area the bake would chart as unseen on the demo apartment', async () => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const shipped = (await new GLTFLoader().parseAsync(exported.glb.slice(0), '')).scene.children as THREE.Mesh[];
    const area = (mesh: THREE.Mesh): number =>
      worldTriangles(mesh, new THREE.Matrix4()).reduce((sum, [ax, ay, az, bx, by, bz, cx, cy, cz]) => {
        const u = new THREE.Vector3(bx! - ax!, by! - ay!, bz! - az!);
        return sum + u.cross(new THREE.Vector3(cx! - ax!, cy! - ay!, cz! - az!)).length() / 2;
      }, 0);
    const charted = (entry: ShellNodeExtras): boolean =>
      entry.kind !== 'site' && !(entry.kind === 'opening' && entry.opening === 'glass') && entry.visible;
    const byKind: Record<string, { nodes: number; area: number }> = {};
    let total = 0;
    let unseen = 0;
    shipped.forEach((mesh, i) => {
      const entry = extras[i]!;
      if (!charted(entry)) return;
      const a = area(mesh);
      total += a;
      if (!('unseen' in entry)) return;
      unseen += a;
      const slot = (byKind[entry.kind] ??= { nodes: 0, area: 0 });
      slot.nodes += 1;
      slot.area += a;
    });
    // Measured: 650.5 of 1472.5 m² (44.17 %), against about half of the charted area the real bake found at zero.
    expect(Object.fromEntries(Object.entries(byKind).map(([kind, { nodes }]) => [kind, nodes]))).toEqual({
      floor: 9,
      wall: 62,
      skirting: 46,
      joint: 23,
    });
    expect(unseen / total).toBeCloseTo(0.4417, 3);
  });

  test('refuses a minted id that is not a UUID v7, and one minted twice', async () => {
    expect(exportShellForBake(apartmentScene, { mintId: () => 'wall-face', finishes: SHIPPED_FINISHES })).rejects.toThrow('not a UUID v7');
    expect(
      exportShellForBake(apartmentScene, { mintId: () => '01a1b000-0000-7000-8000-000000000000', finishes: SHIPPED_FINISHES }),
    ).rejects.toThrow('minted twice');
  });

  test('the finishes are a required argument: a call without them is a type error and is refused', async () => {
    // @ts-expect-error -- the caller always names the finishes the live view paints with.
    await expect(exportShellForBake(apartmentScene, { mintId: minter('01a1d100') })).rejects.toThrow('finishes');
  });

  test('a project that answers a bundled finish id with its own finish gives the project’s albedo, as the live project view paints it', async () => {
    const tone = '#aa2020';
    const material: ProjectMaterial = {
      id: DEFAULT_WALL_FINISH,
      name: 'Project wall',
      tags: ['wall'],
      apply: ['wall'],
      generator: { kind: 'painted_plaster', tone, seed: 3 },
      tile: 2.4,
    };
    const red = new THREE.Color(tone);
    const albedos = (glb: ArrayBuffer): string[] =>
      glbJson(glb).materials.map((m) =>
        JSON.stringify(
          (m as unknown as { pbrMetallicRoughness: { baseColorFactor: number[] } }).pbrMetallicRoughness.baseColorFactor
            .slice(0, 3)
            .map((v) => v.toFixed(3)),
        ),
      );
    const want = JSON.stringify([red.r, red.g, red.b].map((v) => v.toFixed(3)));
    const project = await exportShellForBake(apartmentScene, { mintId: minter('01a1d200'), finishes: projectFinishes([material]) });
    expect(albedos(project.glb)).toContain(want);
    expect(albedos(exported.glb)).not.toContain(want);
  });

  test('two minters give different names and the same digest and extras', async () => {
    const other = await exportShellForBake(apartmentScene, { mintId: minter('01a1c000'), finishes: SHIPPED_FINISHES });
    expect(other.names).not.toEqual(exported.names);
    expect(other.shellInputsHash).toBe(exported.shellInputsHash);
    expect(glbJson(other.glb).nodes.map((node) => node.extras)).toEqual(json.nodes.map((node) => node.extras));
    expect(glbJson(other.glb).asset.extras).toEqual(json.asset.extras);
  });

  test('records the digest of the scene inputs in the file', async () => {
    expect(json.asset.extras.jeex).toEqual({
      format: 1,
      sceneId: apartmentScene.id,
      shellInputsHash: await shellInputsHash(apartmentScene),
    });
  });
});

const base = await shellInputsHash(apartmentScene);

describe('shellInputsHash', () => {
  const edited = async (edit: (scene: SceneData & Record<string, unknown>) => void): Promise<string> => {
    const scene = draftOf(apartmentScene) as SceneData & Record<string, unknown>;
    edit(scene);
    return shellInputsHash(scene);
  };

  test('reads `sha256:<hex>`', () => {
    expect(base).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('changes with one field the shell is built from', async () => {
    const changes: Array<(scene: SceneData & Record<string, unknown>) => void> = [
      (scene) => ((scene.walls[0] as { thickness: number }).thickness += 0.01),
      (scene) => ((scene as { ceilingHeight: number }).ceilingHeight += 0.01),
      (scene) => ((scene.nodes[0] as { p: { x: number } }).p.x += 0.01),
      (scene) => ((scene.rooms[0] as { floorMaterial: string }).floorMaterial = '01a12fdf-158f-702d-8070-693ed21d3b05'),
    ];
    for (const change of changes) expect(await edited(change)).not.toBe(base);
  });

  test('changes with a project material that replaces a default finish no surface names', async () => {
    const wall = (colour: string): ProjectMaterial => {
      const library = NATURAL_SCAN as ProjectMaterial & { library: { facts: Record<string, unknown> } };
      return {
        ...library,
        id: DEFAULT_WALL_FINISH,
        library: { ...library.library, facts: { ...library.library.facts, averageColour: colour } },
      } as ProjectMaterial;
    };
    expect(await shellInputsHash(apartmentScene, [wall('#aa2020')])).not.toBe(await shellInputsHash(apartmentScene, [wall('#2020aa')]));
  });

  test('does not change with furniture, cameras, names, room accents and purposes or wall roles', async () => {
    const changes: Array<(scene: SceneData & Record<string, unknown>) => void> = [
      (scene) => ((scene.assets[0] as { position: { x: number } }).position.x += 0.5),
      (scene) => ((scene as { name: string }).name = 'Another name'),
      (scene) => ((scene.rooms[0] as { name: string }).name = 'Another room'),
      (scene) => ((scene.presentationCamera as { position: { x: number } }).position.x += 1),
      (scene) => ((scene.rooms[0] as { accent?: string }).accent = '#123456'),
      (scene) => delete (scene.rooms[0] as { accent?: string }).accent,
      (scene) => ((scene.rooms[0] as { purpose?: string }).purpose = 'storage'),
      (scene) => delete (scene.rooms[0] as { purpose?: string }).purpose,
      (scene) => ((scene.walls[0] as { role?: string }).role = 'partition'),
      (scene) => ((scene.walls[0] as { role?: string }).role = 'bearing'),
    ];
    for (const change of changes) expect(await edited(change)).toBe(base);
  });
});
