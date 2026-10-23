/**
 * The texture source of a mounted project: one per document, built from the
 * device the renderer reported and the host's resolver, started after the
 * first frame, kept across a context restore and released with the document.
 *
 * Real model, builder and mount over the L-shape plan dressed in library
 * materials; the network is a stub that counts what is asked for.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { draftOf } from '../shared/committed.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FurnitureAnimator } from '../geometry/furniture-animator.js';
import { Picker } from '../geometry/picker.js';
import { SceneModel } from '../scene/scene-model.js';
import type { SceneData } from '../scene/types.js';
import { createMessages } from '../ui/messages.js';
import { editsWiring } from './edits-wiring.js';
import type { LoadedDocument } from './project-wiring.js';
import { SceneMount } from './scene-mount.js';
import { resolveViewerOptions } from './viewer-options.js';
import { createProjectTextures, type TextureEnv } from './project-textures.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import { LIBRARY_REGISTRIES } from '../fixtures/library-finishes.js';
import { LIBRARY_MATERIALS, LIBRARY_VERSION, NATURAL_SCAN } from '../fixtures/library-materials.js';
import { findFinish } from '../materials/finish-catalogue.js';

const ROOM = L_SHAPE.room;
const BASE = 'https://project.test/p/';
const QUIET = { warn: () => {}, error: () => {} };

const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;
beforeAll(() => {
  // `nextFrame` waits for a frame; bun has none, so a timer stands in for it.
  const frames = new Map<number, ReturnType<typeof setTimeout>>();
  let next = 0;
  globalThis.requestAnimationFrame = (callback) => {
    next += 1;
    frames.set(
      next,
      setTimeout(() => callback(performance.now()), 0),
    );
    return next;
  };
  globalThis.cancelAnimationFrame = (handle) => {
    clearTimeout(frames.get(handle));
    frames.delete(handle);
  };
});
afterAll(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
});

/** Lets frame-paced work run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1);
    });
  }
}

/** A stub network and decoder; every URL asked for is recorded. */
function network() {
  const fetched: string[] = [];
  const images: { closed: boolean }[] = [];
  return {
    fetched,
    images,
    fetch: async (url: string) => {
      fetched.push(url);
      return new Response(new Uint8Array(16));
    },
    decode: async (_blob: Blob) => {
      const size = Number(/\.(\d+)\.webp/.exec(fetched.at(-1) ?? '')?.[1] ?? 512);
      const image = { width: size, height: size, closed: false, close: () => void (image.closed = true) };
      images.push(image);
      return image;
    },
  };
}

/** The L-shape as 2.3 with room `a` floored with the natural scan. */
function dressed(): SceneData {
  const scene = draftOf(lShapePlan) as SceneData & { schemaVersion: string; finishes?: unknown };
  scene.schemaVersion = '2.3';
  scene.finishes = { rooms: { [ROOM.a]: { floor: NATURAL_SCAN.id } } };
  return scene;
}

/** A loaded project document over the dressed plan, under `key`. */
function loaded(key = 'project-under-test'): LoadedDocument {
  return {
    model: new SceneModel(dressed(), LIBRARY_REGISTRIES),
    project: {
      key,
      info: { manifest: {}, baseUrl: BASE } as never,
      registries: LIBRARY_REGISTRIES,
      variants: undefined as never,
      builderOptions: {
        projectMaterials: LIBRARY_MATERIALS,
        findFinish: (id) => findFinish(id, LIBRARY_MATERIALS) ?? findFinish(id),
        log: QUIET,
      },
    },
  };
}

/** A mount whose renderer reports `env`, or none when `env` is `null`. */
function rig(env: Partial<TextureEnv> | null, stub = network()) {
  const ui = {
    showDegradedNotice: () => {},
    closePanel: () => {},
    openPanel: () => {},
    setHint: () => {},
    wakeControls: () => {},
    setProjectMark: () => {},
  };
  const dollhouse = { prepare: () => {}, isExterior: () => false, update: () => {} };
  const mount = new SceneMount({
    runtime: () => ({ scene: new THREE.Scene() }),
    picker: new Picker({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }),
    dollhouse: dollhouse as unknown as Dollhouse,
    animator: new FurnitureAnimator(),
    ui: ui as unknown as ViewerUI,
    messages: createMessages('en'),
    renderPreview: () => null,
    edits: editsWiring(resolveViewerOptions({}), () => {}),
    onDocument: () => {},
    onAssetsChanged: () => {},
    onError: (error) => {
      throw new Error(error.message);
    },
    textureEnv: () =>
      env === null ? null : { device: 'mid', maxAnisotropy: 16, log: QUIET, fetch: stub.fetch, decode: stub.decode, ...env },
  });
  const floorA = () => (mount.sceneRoot!.getObjectByName(`floor-${ROOM.a}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
  return { mount, floorA, ...stub };
}

describe('createProjectTextures', () => {
  test('resolves against the manifest folder, sized by the device, with the renderer’s anisotropy', async () => {
    const stub = network();
    const textures = createProjectTextures(BASE, { device: 'low', maxAnisotropy: 4, log: QUIET, fetch: stub.fetch, decode: stub.decode });
    expect(textures.device).toBe('low');
    textures.source.start();
    const view = await textures.source.acquire(
      { versionId: LIBRARY_VERSION.floorScan, role: 'albedo', size: '256', path: `tex/${LIBRARY_VERSION.floorScan}/albedo.256.webp` },
      {},
    );
    expect(stub.fetched).toEqual([`${BASE}tex/${LIBRARY_VERSION.floorScan}/albedo.256.webp`]);
    expect(view?.anisotropy).toBe(4);
  });

  test('a host resolver replaces the folder', async () => {
    const stub = network();
    const textures = createProjectTextures(BASE, {
      device: 'mid',
      maxAnisotropy: 1,
      log: QUIET,
      fetch: stub.fetch,
      decode: stub.decode,
      resolveTexture: (path) => `https://signed.test/${path}`,
    });
    textures.source.start();
    await textures.source.acquire({ versionId: LIBRARY_VERSION.floorScan, role: 'arm', size: '512', path: `tex/x/arm.512.webp` }, {});
    expect(stub.fetched).toEqual(['https://signed.test/tex/x/arm.512.webp']);
  });
});

describe('a mounted project draws its maps', () => {
  test('nothing is fetched while the document mounts; the maps arrive after the first frame', async () => {
    const subject = rig({});
    subject.mount.mountDocument(loaded());
    expect(subject.fetched).toEqual([]);
    expect(subject.floorA().map).toBeNull();
    await settle();
    expect(subject.fetched.length).toBe(3);
    expect(subject.floorA().map).not.toBeNull();
  });

  test('the size follows the device class the renderer reported, telemetry or not', async () => {
    const high = rig({ device: 'high' });
    high.mount.mountDocument(loaded());
    await settle();
    expect(high.fetched.every((url) => url.endsWith('.512.webp'))).toBe(true);
    const low = rig({ device: 'low' });
    low.mount.mountDocument(loaded());
    await settle();
    expect(low.fetched.every((url) => url.endsWith('.256.webp'))).toBe(true);
  });

  test('without a WebGL context no texture is fetched and the surfaces stay flat', async () => {
    const subject = rig(null);
    subject.mount.mountDocument(loaded());
    await settle();
    expect(subject.fetched).toEqual([]);
    expect(subject.floorA().map).toBeNull();
  });

  test('another document gets a source of its own, starting at zero; the old one’s images are closed', async () => {
    const subject = rig({});
    subject.mount.mountDocument(loaded('first'));
    await settle();
    subject.mount.mountDocument(loaded('second'));
    expect(subject.images.every((image) => image.closed)).toBe(true);
    await settle();
    expect(subject.fetched.length).toBe(6);
  });

  test('releasing the mount closes every image', async () => {
    const subject = rig({});
    subject.mount.mountDocument(loaded());
    await settle();
    subject.mount.release();
    expect(subject.images.every((image) => image.closed)).toBe(true);
  });
});

describe('a context restore remounts the document with what it was mounted with', () => {
  test('the materials, the library key and the texture source survive; the maps come back from kept bytes, nothing is fetched', async () => {
    const subject = rig({});
    const document = loaded();
    subject.mount.mountDocument(document);
    await settle();
    const fetches = subject.fetched.length;
    const decodes = subject.images.length;
    subject.mount.remount();
    await settle();
    // The project's materials: the floor is the library scan again, with its map.
    expect(subject.floorA().map).not.toBeNull();
    expect(subject.fetched.length).toBe(fetches);
    expect(subject.images.length).toBe(decodes * 2);
    // The library key: the same document presented again is a revision, not a new mount.
    const before = subject.mount.sceneRoot;
    subject.mount.present({ ...document, model: new SceneModel(dressed(), LIBRARY_REGISTRIES) });
    expect(subject.mount.sceneRoot).toBe(before);
  });

  test('with nothing mounted there is nothing to remount', () => {
    expect(rig({}).mount.remount()).toBeNull();
  });
});
