/**
 * Room surfaces dressed with library materials: what the shell builds for
 * them on the first frame, and what repainting and disposal do to the
 * textures they share. Everything runs without a WebGL context; the texture
 * source behind the surfaces is the real one over a stub network.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { draftOf } from '../shared/committed.js';
import { SceneBuilder, type SceneBuilderOptions } from './scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { findFinish } from '../materials/finish-catalogue.js';
import { LIBRARY_MATERIALS, NATURAL_SCAN, PAINT, TINTABLE_SCAN } from '../fixtures/library-materials.js';
import type { SceneData } from '../scene/types.js';
import { SceneModel, isApplyOk } from '../scene/scene-model.js';
import type { SceneOp } from '../scene/scene-ops.js';
import { LIBRARY_REGISTRIES } from '../fixtures/library-finishes.js';
import { FINISH } from '../materials/finish-ids.js';
import { TextureSource } from '../materials/texture-source.js';
import { createLogger } from '../shared/logger.js';

const ROOM = L_SHAPE.room;

/** The builder options a project document is drawn with: its materials in front of the bank. */
const PROJECT: SceneBuilderOptions = {
  projectMaterials: LIBRARY_MATERIALS,
  findFinish: (id) => findFinish(id, LIBRARY_MATERIALS) ?? findFinish(id),
};

/** The L-shape as 2.3 with room `a` dressed in library materials and room `b` left alone. */
function dressed(): SceneData {
  const scene = draftOf(lShapePlan) as SceneData & { schemaVersion: string; finishes?: unknown };
  scene.schemaVersion = '2.3';
  scene.finishes = {
    rooms: {
      [ROOM.a]: {
        floor: NATURAL_SCAN.id,
        walls: TINTABLE_SCAN.id,
        ceiling: { material: PAINT.id, colour: '#2050a0' },
        trim: PAINT.id,
      },
    },
  };
  return scene;
}

/** Every mesh under `root`. */
function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object);
  });
  return found;
}

/** The materials the meshes `wanted` picks wear, deduplicated. */
function materialsOf(root: THREE.Object3D, wanted: (mesh: THREE.Mesh) => boolean): Set<THREE.Material> {
  return new Set(
    meshes(root)
      .filter((mesh) => wanted(mesh))
      .map((mesh) => mesh.material as THREE.Material),
  );
}

/** The skirting of one room. */
const skirtingOf = (room: string) => (mesh: THREE.Mesh) =>
  mesh.name === 'wall-face-skirting' && (mesh.userData['face'] as { room?: string }).room === room;

/** The colour of a material as `#rrggbb`. */
const hexOf = (material: THREE.Material): string => `#${(material as THREE.MeshStandardMaterial).color.getHexString()}`;

describe('the shell of a legacy scene', () => {
  test('makes no extra material: every ceiling shares one, every baseboard shares one', () => {
    const scene = lShapePlan;
    const { root } = new SceneBuilder(scene, solvePlan(scene)).build();
    expect(materialsOf(root, (mesh) => mesh.name.startsWith('ceiling-')).size).toBe(1);
    expect(materialsOf(root, (mesh) => mesh.name === 'wall-face-skirting').size).toBe(1);
  });
});

describe('the shell of a dressed scene, first frame', () => {
  const scene = dressed();
  const { root } = new SceneBuilder(scene, solvePlan(scene), PROJECT).build();
  const ceilingA = (root.getObjectByName(`ceiling-${ROOM.a}`) as THREE.Mesh).material as THREE.Material;
  const ceilingB = (root.getObjectByName(`ceiling-${ROOM.b}`) as THREE.Mesh).material as THREE.Material;

  test('a room with a ceiling finish gets its own ceiling material, flat in the tint; the other keeps the plaster', () => {
    expect(ceilingA).not.toBe(ceilingB);
    expect(hexOf(ceilingA)).toBe('#2050a0');
    expect((ceilingA as THREE.MeshStandardMaterial).map).toBeNull();
  });

  test('a room with a trim finish gets its own baseboard material; the other keeps the default trim', () => {
    const trimA = [...materialsOf(root, skirtingOf(ROOM.a))];
    const trimB = [...materialsOf(root, skirtingOf(ROOM.b))];
    expect(trimA.length).toBe(1);
    expect(trimB.length).toBe(1);
    expect(trimA[0]).not.toBe(trimB[0]);
    expect(hexOf(trimA[0]!)).toBe('#f1eee8');
  });

  test('a library floor starts flat in its averageColour, with no map', () => {
    const floor = (root.getObjectByName(`floor-${ROOM.a}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(hexOf(floor)).toBe('#9a7b56');
    expect(floor.map).toBeNull();
  });

  test('library walls start flat in averageColour times the first suggested tint and its recipe gain', () => {
    const walls = materialsOf(
      root,
      (mesh) => mesh.userData['surface'] === 'wall' && (mesh.userData['face'] as { room?: string }).room === ROOM.a,
    );
    expect(walls.size).toBe(1);
    // A mid-grey averageColour times the `luma-mid@1` gain gives the tint back,
    // within one 8-bit step (`#808080` sits a hair above the map's exact mean).
    const wall = [...walls][0] as THREE.MeshStandardMaterial;
    const drawn = wall.color.clone().convertLinearToSRGB();
    const tint = new THREE.Color('#c9d6df').convertLinearToSRGB();
    for (const channel of ['r', 'g', 'b'] as const) expect(Math.abs(drawn[channel] - tint[channel])).toBeLessThan(1 / 255 + 1e-9);
    expect(wall.map).toBeNull();
  });
});

/* --------------------------------------------------------------- repaint --- */

/** A texture source over a stub network that counts fetches and can hold them back. */
function stubTextures() {
  const fetched: string[] = [];
  let hold: Promise<void> | null = null;
  const images: { closed: boolean }[] = [];
  const source = new TextureSource({
    baseUrl: 'https://project.test/',
    log: createLogger(() => undefined),
    maxAnisotropy: 8,
    fetch: async (url) => {
      fetched.push(url);
      if (hold) await hold;
      return new Response(new Uint8Array(16));
    },
    decode: async () => {
      const image = { width: 512, height: 512, closed: false, close: () => void (image.closed = true) };
      images.push(image);
      return image;
    },
  });
  return {
    textures: { source, device: 'mid' } as const,
    fetched,
    images,
    /** Holds every later fetch until the returned function is called. */
    holdFetches(): () => void {
      let release: () => void = () => undefined;
      hold = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        hold = null;
        release();
      };
    },
  };
}

/** Lets the texture work run: a few turns of the event loop. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/** Both rooms floored with the natural scan, built and bound to a model on the library registries. */
async function sharedScan() {
  const network = stubTextures();
  const document = draftOf(lShapePlan) as SceneData & { schemaVersion: string; finishes?: unknown };
  document.schemaVersion = '2.3';
  document.finishes = { rooms: { [ROOM.a]: { floor: NATURAL_SCAN.id }, [ROOM.b]: { floor: NATURAL_SCAN.id } } };
  const model = new SceneModel(document, LIBRARY_REGISTRIES);
  const builder = new SceneBuilder(model.scene, model.plan, { ...PROJECT, textures: network.textures });
  const { root } = builder.build();
  builder.bindModel(model);
  await flush();
  const paint = (...ops: SceneOp[]): void => {
    const result = model.apply({ baseRev: model.rev, ops });
    if (!isApplyOk(result)) throw new Error(`expected a commit, got ${result.error}: ${result.message}`);
  };
  const floorOf = (room: string) => (root.getObjectByName(`floor-${room}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
  return { ...network, model, builder, root, paint, floorOf };
}

describe('repainting library surfaces', () => {
  test('both rooms draw one shared image after the first frame', async () => {
    const { floorOf, fetched } = await sharedScan();
    expect(floorOf(ROOM.a).map).not.toBeNull();
    expect(floorOf(ROOM.a).map?.source).toBe(floorOf(ROOM.b).map?.source);
    // Albedo, normal and ARM at the mid size: one fetch each, shared by both rooms.
    expect(fetched.length).toBe(3);
  });

  test('every surface whose maps arrive reports it once, after they are attached (a redraw of walk and tour)', async () => {
    const network = stubTextures();
    const attached: Array<THREE.Texture | null> = [];
    const document = draftOf(lShapePlan) as SceneData & { schemaVersion: string; finishes?: unknown };
    document.schemaVersion = '2.3';
    document.finishes = { rooms: { [ROOM.a]: { floor: NATURAL_SCAN.id }, [ROOM.b]: { floor: NATURAL_SCAN.id } } };
    const model = new SceneModel(document, LIBRARY_REGISTRIES);
    const floor = (): THREE.MeshStandardMaterial =>
      (root.getObjectByName(`floor-${ROOM.a}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const textures = { ...network.textures, attached: () => attached.push(floor().map) };
    const { root } = new SceneBuilder(model.scene, model.plan, { ...PROJECT, textures }).build();
    expect(attached).toEqual([]);
    await flush();
    expect(attached).toHaveLength(2);
    expect(attached.at(-1)).not.toBeNull();
  });

  test('repainting one of two rooms keeps the other’s texture and fetches nothing', async () => {
    const { floorOf, fetched, images, paint } = await sharedScan();
    const kept = floorOf(ROOM.b).map;
    paint({ op: 'set_material', surface: 'floor', room: ROOM.a, material: FINISH.oak });
    await flush();
    expect(floorOf(ROOM.b).map).toBe(kept);
    expect(images.some((image) => image.closed)).toBe(false);
    expect(fetched.length).toBe(3);
  });

  test('a repaint releases through the source: the replaced material’s views go, the shared image stays until its last user goes', async () => {
    const { floorOf, images, paint } = await sharedScan();
    const replaced = floorOf(ROOM.a);
    let viewDisposed = false;
    replaced.map?.addEventListener('dispose', () => {
      viewDisposed = true;
    });
    paint({ op: 'set_material', surface: 'floor', room: ROOM.a, material: FINISH.oak });
    expect(viewDisposed).toBe(true);
    expect(images.some((image) => image.closed)).toBe(false);
    paint({ op: 'set_material', surface: 'floor', room: ROOM.b, material: FINISH.oak });
    expect(images.every((image) => image.closed)).toBe(true);
  });

  test('a texture that lands after its surface was repainted is never applied', async () => {
    const network = stubTextures();
    const release = network.holdFetches();
    const document = draftOf(lShapePlan) as SceneData & { schemaVersion: string; finishes?: unknown };
    document.schemaVersion = '2.3';
    document.finishes = { rooms: { [ROOM.a]: { floor: NATURAL_SCAN.id } } };
    const model = new SceneModel(document, LIBRARY_REGISTRIES);
    const builder = new SceneBuilder(model.scene, model.plan, { ...PROJECT, textures: network.textures });
    const { root } = builder.build();
    builder.bindModel(model);
    const loading = (root.getObjectByName(`floor-${ROOM.a}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(
      isApplyOk(model.apply({ baseRev: model.rev, ops: [{ op: 'set_material', surface: 'floor', room: ROOM.a, material: FINISH.oak }] })),
    ).toBe(true);
    release();
    await flush();
    expect(loading.map).toBeNull();
    const now = (root.getObjectByName(`floor-${ROOM.a}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(now).not.toBe(loading);
  });

  test('ceiling and trim repaint from their touched entries, and only them', async () => {
    const { root, paint } = await sharedScan();
    const ceilingB = () => (root.getObjectByName(`ceiling-${ROOM.b}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const ceilingA = (root.getObjectByName(`ceiling-${ROOM.a}`) as THREE.Mesh).material;
    const trimB = () => [...materialsOf(root, skirtingOf(ROOM.b))];
    paint({ op: 'set_material', surface: 'ceiling', room: ROOM.b, material: PAINT.id, colour: '#2050a0' });
    expect(hexOf(ceilingB())).toBe('#2050a0');
    expect((root.getObjectByName(`ceiling-${ROOM.a}`) as THREE.Mesh).material).toBe(ceilingA);
    paint({ op: 'set_material', surface: 'trim', room: ROOM.b, material: PAINT.id, colour: '#203040' });
    expect(trimB().map((material) => hexOf(material))).toEqual(['#203040']);
    expect([...materialsOf(root, skirtingOf(ROOM.a))].map((material) => hexOf(material))).not.toEqual(['#203040']);
  });
});

describe('a room with no ceiling', () => {
  test('painting every ceiling with a loggia among the rooms is no drift: the loggia simply has none', async () => {
    const network = stubTextures();
    const plan = draftOf(lShapePlan);
    const document = {
      ...plan,
      schemaVersion: '2.3',
      rooms: plan.rooms.map((room) => (room.id === ROOM.b ? { ...room, kind: 'loggia' as const } : room)),
    } as SceneData;
    const model = new SceneModel(document, LIBRARY_REGISTRIES);
    const builder = new SceneBuilder(model.scene, model.plan, { ...PROJECT, textures: network.textures });
    const { root } = builder.build();
    const drifted: unknown[] = [];
    builder.bindModel(model, (failed) => drifted.push(...failed));
    const result = model.apply({
      baseRev: model.rev,
      ops: [{ op: 'set_material', surface: 'ceiling', material: PAINT.id, colour: '#2050a0' }],
    });
    expect(isApplyOk(result)).toBe(true);
    expect(drifted).toEqual([]);
    expect(hexOf((root.getObjectByName(`ceiling-${ROOM.a}`) as THREE.Mesh).material as THREE.Material)).toBe('#2050a0');
    expect(root.getObjectByName(`ceiling-${ROOM.b}`)).toBeUndefined();
  });
});

describe('unmount', () => {
  test('disposing the builder releases every texture view and closes every image the document made', async () => {
    const network = stubTextures();
    const views: THREE.Texture[] = [];
    const acquire = network.textures.source.acquire.bind(network.textures.source);
    network.textures.source.acquire = async (request, owner) => {
      const view = await acquire(request, owner);
      if (view) views.push(view);
      return view;
    };
    const document = dressed();
    const model = new SceneModel(document, LIBRARY_REGISTRIES);
    const builder = new SceneBuilder(model.scene, model.plan, { ...PROJECT, textures: network.textures });
    builder.build();
    builder.bindModel(model);
    await flush();
    expect(views.length).toBeGreaterThan(0);
    const disposed = new Set<THREE.Texture>();
    for (const view of views) view.addEventListener('dispose', () => disposed.add(view));
    builder.dispose();
    expect(disposed.size).toBe(views.length);
    expect(network.images.length).toBeGreaterThan(0);
    expect(network.images.every((image) => image.closed)).toBe(true);
  });

  test('a load still in flight at unmount attaches nothing and its image is closed when it lands', async () => {
    const network = stubTextures();
    const release = network.holdFetches();
    const document = dressed();
    const model = new SceneModel(document, LIBRARY_REGISTRIES);
    const builder = new SceneBuilder(model.scene, model.plan, { ...PROJECT, textures: network.textures });
    const { root } = builder.build();
    const floor = (root.getObjectByName(`floor-${ROOM.a}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    builder.dispose();
    release();
    await flush();
    expect(floor.map).toBeNull();
    expect(network.images.every((image) => image.closed)).toBe(true);
  });
});

describe('mapsSettled', () => {
  test('resolves only once every library map of the shell has attached', async () => {
    const network = stubTextures();
    const release = network.holdFetches();
    const document = dressed();
    const builder = new SceneBuilder(document, solvePlan(document), { ...PROJECT, textures: network.textures });
    const { root } = builder.build();
    const floor = (root.getObjectByName(`floor-${ROOM.a}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    let settled = false;
    void builder.mapsSettled().then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    release();
    await flush();
    expect(settled).toBe(true);
    expect(floor.map).not.toBeNull();
  });

  test('resolves at once for a shell without library materials', async () => {
    const builder = new SceneBuilder(lShapePlan, solvePlan(lShapePlan));
    builder.build();
    let settled = false;
    void builder.mapsSettled().then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(true);
  });
});
