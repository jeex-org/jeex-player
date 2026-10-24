/**
 * The built-in texture source: one per viewer, resolving against the
 * `finish-maps/` folder next to the player file, never through the host's
 * resolver, started after the first frame of every mount, kept across
 * documents, releases and context restores, ended with the viewer, and
 * warning once.
 *
 * Real model, builder and mount over the bare L-shape plan, whose floors and
 * walls wear bundled finishes; the network is a stub that records URLs.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FurnitureAnimator } from '../geometry/furniture-animator.js';
import { Picker } from '../geometry/picker.js';
import { SceneModel } from '../scene/scene-model.js';
import { draftOf } from '../shared/committed.js';
import { createMessages } from '../ui/messages.js';
import { editsWiring } from './edits-wiring.js';
import type { LoadedDocument } from './project-wiring.js';
import { SceneMount } from './scene-mount.js';
import { resolveViewerOptions } from './viewer-options.js';
import type { TextureEnv } from './project-textures.js';
import { createBuiltinTextures, onceLogger } from './builtin-textures.js';
import { builtinFolder } from '../materials/builtin-folder.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import { BUILTIN_FINISHES } from '../materials/builtin-library.js';
import { FINISH } from '../materials/finish-ids.js';
import type { Logger } from '../shared/logger.js';

const FOLDER = 'https://player.test/v1/finish-maps/';
const QUIET: Logger = { warn: () => {}, error: () => {} };
const OAK = BUILTIN_FINISHES.get(FINISH.oak)!.material.versionId;

const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;
beforeAll(() => {
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

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1);
    });
}

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
    decode: async () => {
      const size = Number(/\.(\d+)\.webp/.exec(fetched.at(-1) ?? '')?.[1] ?? 512);
      const image = { width: size, height: size, closed: false, close: () => void (image.closed = true) };
      images.push(image);
      return image;
    },
  };
}

/** A bare document: no project, the L-shape on bundled finishes. */
function bare(): LoadedDocument {
  return { model: new SceneModel(draftOf(lShapePlan), CATALOGUE_REGISTRIES), project: null };
}

function rig(env: Partial<TextureEnv> | null, stub = network()) {
  const ui = {
    showDegradedNotice: () => {},
    closePanel: () => {},
    openPanel: () => {},
    setHint: () => {},
    wakeControls: () => {},
    setProjectMark: () => {},
  };
  let invalidated = 0;
  const resolved: string[] = [];
  const mount = new SceneMount({
    runtime: () => ({ scene: new THREE.Scene(), demand: { invalidate: () => void (invalidated += 1) } }),
    picker: new Picker({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }),
    dollhouse: { prepare: () => {}, isExterior: () => false, update: () => {} } as unknown as Dollhouse,
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
    builtinFolder: FOLDER,
    textureEnv: () =>
      env === null
        ? null
        : {
            device: 'mid',
            maxAnisotropy: 16,
            log: QUIET,
            fetch: stub.fetch,
            decode: stub.decode,
            resolveTexture: (path: string) => {
              resolved.push(path);
              return `https://host.test/${path}`;
            },
            ...env,
          },
  });
  const floorA = () => (mount.sceneRoot!.getObjectByName(`floor-${L_SHAPE.room.a}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
  return { mount, floorA, resolved, invalidated: () => invalidated, ...stub };
}

describe('builtinFolder', () => {
  test('is the finish-maps folder next to the player file', () => {
    expect(builtinFolder('https://cdn.test/embed/v1/jeex-viewer.iife.js')).toBe('https://cdn.test/embed/v1/finish-maps/');
  });
});

describe('onceLogger', () => {
  test('lets the first warning through, drops the later ones, and passes every error', () => {
    const seen: string[] = [];
    const log = onceLogger({ warn: (code) => void seen.push(`warn ${code}`), error: (code) => void seen.push(`error ${code}`) });
    log.warn('texture-fetch', 'a');
    log.warn('texture-fetch', 'b');
    log.error('internal', 'c');
    log.error('internal', 'd');
    expect(seen).toEqual(['warn texture-fetch', 'error internal', 'error internal']);
  });
});

describe('createBuiltinTextures', () => {
  test('resolves against the folder and never through the host resolver', async () => {
    const stub = network();
    const resolved: string[] = [];
    const textures = createBuiltinTextures(
      {
        device: 'mid',
        maxAnisotropy: 4,
        log: QUIET,
        fetch: stub.fetch,
        decode: stub.decode,
        resolveTexture: (path) => (resolved.push(path), path),
      },
      FOLDER,
    );
    textures.source.start();
    await textures.source.acquire({ versionId: OAK, role: 'albedo', size: '512', path: `tex/${OAK}/albedo.512.webp` }, {});
    expect(stub.fetched).toEqual([`${FOLDER}tex/${OAK}/albedo.512.webp`]);
    expect(resolved).toEqual([]);
  });
});

describe('a bare scene in a viewer', () => {
  test('fetches nothing while it mounts, then the maps of the bundled finishes on screen from the folder', async () => {
    const subject = rig({});
    subject.mount.mountDocument(bare());
    expect(subject.fetched).toEqual([]);
    await settle();
    expect(subject.fetched.length).toBeGreaterThan(0);
    expect(subject.fetched.every((url) => url.startsWith(`${FOLDER}tex/`))).toBe(true);
    expect(subject.fetched.some((url) => url.includes(OAK))).toBe(true);
    expect(subject.resolved).toEqual([]);
    expect(subject.floorA().map).not.toBeNull();
  });

  test('only the finishes on screen are fetched', async () => {
    const subject = rig({});
    subject.mount.mountDocument(bare());
    await settle();
    const versions = new Set(subject.fetched.map((url) => /tex\/([0-9a-f-]{36})\//.exec(url)?.[1]));
    const onScreen = new Set([
      OAK,
      BUILTIN_FINISHES.get(FINISH.stone)!.material.versionId,
      BUILTIN_FINISHES.get(FINISH.sand)!.material.versionId,
    ]);
    for (const version of versions) expect(onScreen.has(version!)).toBe(true);
  });

  test('a second document with the same finishes fetches nothing again', async () => {
    const subject = rig({});
    subject.mount.mountDocument(bare());
    await settle();
    const fetches = subject.fetched.length;
    subject.mount.mountDocument(bare());
    await settle();
    expect(subject.fetched.length).toBe(fetches);
    expect(subject.floorA().map).not.toBeNull();
  });

  test('a mount released before its first frame does not leave the source waiting', async () => {
    const subject = rig({});
    subject.mount.mountDocument(bare());
    subject.mount.release();
    subject.mount.mountDocument(bare());
    await settle();
    expect(subject.floorA().map).not.toBeNull();
  });

  test('attached maps ask for a redraw', async () => {
    const subject = rig({});
    subject.mount.mountDocument(bare());
    const before = subject.invalidated();
    await settle();
    expect(subject.invalidated()).toBeGreaterThan(before);
  });

  test('a context restore draws the maps again from kept bytes', async () => {
    const subject = rig({});
    subject.mount.mountDocument(bare());
    await settle();
    const fetches = subject.fetched.length;
    subject.mount.remount();
    await settle();
    expect(subject.fetched.length).toBe(fetches);
    expect(subject.floorA().map).not.toBeNull();
  });

  test('without a WebGL context nothing is fetched', async () => {
    const subject = rig(null);
    subject.mount.mountDocument(bare());
    await settle();
    expect(subject.fetched).toEqual([]);
  });

  test('disposing the mount closes every image of the source', async () => {
    const subject = rig({});
    subject.mount.mountDocument(bare());
    await settle();
    subject.mount.dispose();
    expect(subject.images.length).toBeGreaterThan(0);
    expect(subject.images.every((image) => image.closed)).toBe(true);
  });

  test('missing files give one warning for the whole viewer', async () => {
    const warnings: string[] = [];
    const stub = network();
    const subject = rig(
      {
        log: { warn: (code) => void warnings.push(code), error: () => {} },
        fetch: async (url: string) => {
          stub.fetched.push(url);
          return new Response('missing', { status: 404 });
        },
      },
      stub,
    );
    subject.mount.mountDocument(bare());
    await settle();
    subject.mount.mountDocument(bare());
    await settle();
    expect(stub.fetched.length).toBeGreaterThan(1);
    expect(warnings).toHaveLength(1);
  });
});
