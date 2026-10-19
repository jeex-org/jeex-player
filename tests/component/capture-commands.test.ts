/**
 * The `capture` command bag, against a real WebGL context.
 *
 * Most of it is driven through `captureCommands` over a `RenderRuntime` of the
 * test's own rather than through a mounted viewer: the subject is what the
 * commands do to the RENDERER — the offscreen build for the «as is» state, and
 * whether anything is left on the GPU afterwards — and `renderer.info.memory`
 * is not something the handle exposes, nor should it be. One test at the end
 * goes through the whole mount, because the wiring from `handle.capture` down
 * to a PNG is its own claim.
 *
 * The scene is `plan-l-shape`, not the demo apartment: an apartment under
 * SwiftShader is seconds per frame and none of that is the subject: a
 * component test mounts the smallest scene that carries its claim.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { CATALOGUE_REGISTRIES } from '../../src/assets/catalogue-registries.js';
import { captureCommands, type CaptureCommands } from '../../src/app/capture-commands.js';
import { DEFAULT_VIEWER_OPTIONS } from '../../src/app/viewer-options.js';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { createMessages } from '../../src/ui/messages.js';
import { SceneModel } from '../../src/scene/scene-model.js';
import { SceneBuilder } from '../../src/geometry/scene-builder.js';
import { createRenderRuntime, type RenderRuntime } from '../../src/render/render-runtime.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { L_SHAPE } from '../../src/fixtures/plan-l-shape-ids.js';
import { FINISH } from '../../src/materials/finish-ids.js';
import { closeContainers, openContainer } from './support.js';

/** A well-formed room id the fixture does not have, fixed UUID v7. */
const NOWHERE = '01a12ffa-de52-7ebf-9129-0a91479080bb';

const runtimes: RenderRuntime[] = [];
const builders: SceneBuilder[] = [];
const handles: ViewerHandle[] = [];

/**
 * A runtime with no frame loop: the schedule is a stub, so nothing draws
 * except the captures themselves and the assertions are about them alone.
 */
function openRuntime(): RenderRuntime {
  const container = openContainer(320, 240);
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const runtime = createRenderRuntime({
    canvas,
    viewport: { clientWidth: 320, clientHeight: 240, element: container },
    scheduleFrame: () => 0,
    cancelFrame: () => undefined,
  });
  runtimes.push(runtime);
  return runtime;
}

/**
 * The commands over a runtime and a document, with the shipped option defaults.
 *
 * The document is BUILT into the runtime's scene first, the way `SceneMount`
 * does for a real mount: without that, a `'current'` capture is a picture of
 * an empty sky and every assertion about it passes by accident.
 */
function commandsFor(runtime: RenderRuntime, model: SceneModel, ready = true): CaptureCommands {
  const builder = new SceneBuilder(model.scene, model.plan);
  builders.push(builder);
  runtime.scene.add(builder.build().root);
  return captureCommands({
    runtime: () => runtime,
    model: () => model,
    livePose: () => null,
    options: () => DEFAULT_VIEWER_OPTIONS,
    messages: () => createMessages('en'),
    shellState: () => 'dollhouse',
    ready: () => ready,
  });
}

function loadModel(): SceneModel {
  return SceneModel.load(structuredClone(lShapePlan), CATALOGUE_REGISTRIES);
}

/** The same fixture with room A repainted, so the pair has two pictures to tell apart. */
function loadPaintedModel(): SceneModel {
  return SceneModel.load(
    { ...structuredClone(lShapePlan), finishes: { rooms: { [L_SHAPE.room.a]: { floor: FINISH.stone } } } },
    CATALOGUE_REGISTRIES,
  );
}

async function decode(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Mean colour of the whole picture, as `[r, g, b]`. */
function meanColour(image: ImageData): [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let at = 0; at < image.data.length; at += 4) {
    red += image.data[at]!;
    green += image.data[at + 1]!;
    blue += image.data[at + 2]!;
  }
  const pixels = image.data.length / 4;
  return [red / pixels, green / pixels, blue / pixels];
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  for (const builder of builders.splice(0)) builder.dispose();
  closeContainers();
});

describe('capture.still', () => {
  test('answers a PNG of the requested size with a still provenance', async () => {
    const model = loadModel();
    const capture = commandsFor(openRuntime(), model);
    const { blob, provenance } = await capture.still({ width: 320, height: 180, camera: 'presentation' });
    expect(blob.type).toBe('image/png');
    const image = await decode(blob);
    expect(image.width).toBe(320);
    expect(image.height).toBe(180);
    expect(provenance.kind).toBe('still');
    expect(provenance.state).toBe('current');
    expect(provenance.sceneId).toBe(model.scene.id);
    expect(provenance.rev).toBe(model.rev);
    expect(provenance.camera).toEqual(model.scene.presentationCamera);
  });

  test('a room camera is the pose the scene names for that room', async () => {
    const model = loadModel();
    const capture = commandsFor(openRuntime(), model);
    const { provenance } = await capture.still({ width: 64, height: 64, camera: { roomId: L_SHAPE.room.b } });
    expect(provenance.camera).toEqual(model.scene.roomCameras[L_SHAPE.room.b]!);
  });

  test('a room the scene has no camera for is refused, not guessed at', async () => {
    const capture = commandsFor(openRuntime(), loadModel());
    await expect(capture.still({ width: 64, height: 64, camera: { roomId: NOWHERE } })).rejects.toThrow(NOWHERE);
  });

  test('a room named by anything but its UUID is refused with bad-params', async () => {
    const capture = commandsFor(openRuntime(), loadModel());
    await expect(capture.still({ width: 64, height: 64, camera: { roomId: 'Room A' } })).rejects.toMatchObject({ code: 'bad-params' });
  });

  test('before the first frame it refuses with not-ready', async () => {
    const capture = commandsFor(openRuntime(), loadModel(), false);
    await expect(capture.still({ width: 64, height: 64 })).rejects.toMatchObject({ code: 'not-ready' });
  });
});

describe('capture.pair', () => {
  test('answers both states of one shot, and they are different pictures', async () => {
    // Room A's floor is painted in the document; the default state must not
    // show that paint, which is the whole point of the pair.
    const capture = commandsFor(openRuntime(), loadPaintedModel());
    const pair = await capture.pair({ width: 160, height: 120, camera: { roomId: L_SHAPE.room.a } });
    expect(pair.current.provenance.state).toBe('current');
    expect(pair.default.provenance.state).toBe('default');
    const current = meanColour(await decode(pair.current.blob));
    const original = meanColour(await decode(pair.default.blob));
    const distance = Math.abs(current[0] - original[0]) + Math.abs(current[1] - original[1]) + Math.abs(current[2] - original[2]);
    expect(distance).toBeGreaterThan(2);
  });

  test('the offscreen build leaves nothing on the GPU', async () => {
    const runtime = openRuntime();
    const capture = commandsFor(runtime, loadModel());
    // One capture first, so the baseline includes whatever the FIRST offscreen
    // build uploads and the shared texture cache holds; the second is the one
    // under test.
    await capture.still({ width: 64, height: 64, state: 'default' });
    const before = { ...runtime.renderer.info.memory };
    await capture.still({ width: 64, height: 64, state: 'default' });
    expect(runtime.renderer.info.memory.geometries).toBe(before.geometries);
    expect(runtime.renderer.info.memory.textures).toBe(before.textures);
  });
});

describe('capture.panorama', () => {
  test('answers a 2:1 PNG for the room it names', async () => {
    const capture = commandsFor(openRuntime(), loadModel());
    const { blob, provenance } = await capture.panorama({ width: 256, roomId: L_SHAPE.room.a });
    const image = await decode(blob);
    expect(image.width).toBe(256);
    expect(image.height).toBe(128);
    expect(provenance.kind).toBe('panorama');
    expect(provenance.roomId).toBe(L_SHAPE.room.a);
  });

  test('a room the scene does not have is refused', async () => {
    const capture = commandsFor(openRuntime(), loadModel());
    await expect(capture.panorama({ width: 64, roomId: NOWHERE })).rejects.toThrow(NOWHERE);
  });

  test('a room named by anything but its UUID is refused with bad-params', async () => {
    const capture = commandsFor(openRuntime(), loadModel());
    await expect(capture.panorama({ width: 64, roomId: 'Room A' })).rejects.toMatchObject({ code: 'bad-params' });
  });
});

describe('the disclosure caption', () => {
  test('is on by default and can be turned off per request', async () => {
    const capture = commandsFor(openRuntime(), loadModel());
    const captioned = await decode((await capture.still({ width: 128, height: 128 })).blob);
    const bare = await decode((await capture.still({ width: 128, height: 128, caption: false })).blob);
    // The band is the bottom rows; only there may the two differ.
    const bandRow = captioned.height - 6;
    const at = (bandRow * captioned.width + 8) * 4;
    expect(captioned.data[at]).not.toBe(bare.data[at]);
  });

  test('every artefact carries the disclosure whether or not it is captioned', async () => {
    const capture = commandsFor(openRuntime(), loadModel());
    const { provenance } = await capture.still({ width: 64, height: 64, caption: false });
    expect(provenance.disclosure).toBe('rendered-3d');
    expect(provenance.generator).toBe('jeex-viewer');
  });
});

describe('handle.capture', () => {
  test('a mounted viewer captures without moving the camera on screen', async () => {
    const handle = mountViewer(openContainer(), {
      scene: { repository: new InlineSceneRepository(structuredClone(lShapePlan)) },
      tour: { mode: 'off' },
      debug: false,
    });
    handles.push(handle);
    await handle.ready;
    const before = handle.getState();
    const { blob, provenance } = await handle.capture.still({ width: 200, height: 120, camera: 'live' });
    const image = await decode(blob);
    expect(image.width).toBe(200);
    expect(provenance.sceneId).toBe(lShapePlan.id);
    // Nothing about the live view changed: same mode, same document, same
    // revision, and the canvas is still the size the container gave it.
    expect(handle.getState()).toEqual(before);
    const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.width).not.toBe(200);
  });
});
