/**
 * `captureFrames` against a real WebGL context, and `capture.frames` on a
 * mounted viewer for the wiring end to end.
 *
 * Mirrors `capture-commands.test.ts`'s pattern: a `RenderRuntime` and a
 * `SceneModel` of the test's own, built into the runtime's scene the way
 * `SceneMount` does. The tour here is a `TourPlayer` of the test's own too —
 * `plan-l-shape`'s `autotour` gives it a real route — with its emitted pose
 * read back through a small `livePose` stand-in for
 * `CameraController.getPose()`.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { CATALOGUE_REGISTRIES } from '../../src/assets/catalogue-registries.js';
import { captureFrames, type FrameCaptureDeps } from '../../src/app/video-frames.js';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { SceneModel } from '../../src/scene/scene-model.js';
import { SceneBuilder } from '../../src/geometry/scene-builder.js';
import { createRenderRuntime, type RenderRuntime } from '../../src/render/render-runtime.js';
import { TourPlayer } from '../../src/camera/tour-player.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { closeContainers, openContainer } from './support.js';
import type { CameraPose } from '../../src/scene/types.js';

const runtimes: RenderRuntime[] = [];
const builders: SceneBuilder[] = [];
const handles: ViewerHandle[] = [];

/** A runtime with no frame loop: nothing draws except the captures themselves. */
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

function loadModel(): SceneModel {
  return SceneModel.load(structuredClone(lShapePlan), CATALOGUE_REGISTRIES);
}

/** A tour over `model`'s own `autotour`, with the pose it emits readable back. */
function tourFor(model: SceneModel): { tour: TourPlayer; livePose: () => CameraPose | null } {
  let pose: CameraPose | null = null;
  const tour = new TourPlayer(
    model.scene,
    (position, target) => {
      pose = { position: { x: position.x, y: position.y, z: position.z }, target: { x: target.x, y: target.y, z: target.z } };
    },
    { onState: () => undefined, onProgress: () => undefined },
  );
  return { tour, livePose: () => pose };
}

/** `FrameCaptureDeps` over a runtime already carrying the built document; `'default'` state is not exercised here (that path is `capture-commands.ts`'s own `inState`, covered by `capture-commands.test.ts`). */
function depsFor(runtime: RenderRuntime, model: SceneModel, tour: TourPlayer, livePose: () => CameraPose | null): FrameCaptureDeps {
  const builder = new SceneBuilder(model.scene, model.plan);
  builders.push(builder);
  runtime.scene.add(builder.build().root);
  return { runtime, model, tour, livePose, withRoot: (take) => take(runtime.scene), captionFor: () => null };
}

async function decode(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  for (const builder of builders.splice(0)) builder.dispose();
  closeContainers();
});

/**
 * 25 sequential capture round-trips make this the heaviest single test in
 * the suite. The frame count itself is the acceptance scenario and is not
 * shrunk; the test gets 90 s, the budget its two-build siblings get, instead
 * of the tier's 60 s light-path `testTimeout` (`vitest.config.ts`). If it goes
 * red here, it needs its own larger figure.
 */
const HEAVY_TEST_TIMEOUT_MS = 90_000;

describe('captureFrames', () => {
  test(
    'steps the tour deterministically and captures a frame per fps step',
    async () => {
      const model = loadModel();
      const { tour, livePose } = tourFor(model);
      const deps = depsFor(openRuntime(), model, tour, livePose);
      const frames: Array<{ index: number; timeS: number; blob: Blob }> = [];
      const result = await captureFrames(deps, {
        aspect: '9:16',
        height: 320,
        fps: 24,
        from: 0,
        to: 1,
        onFrame: (frame) => {
          frames.push(frame);
        },
      });
      expect(frames).toHaveLength(25);
      expect(result.frames).toBe(25);
      expect(frames.map((frame) => frame.index)).toEqual(Array.from({ length: 25 }, (_, index) => index));
      expect(frames.map((frame) => frame.timeS)).toEqual(Array.from({ length: 25 }, (_, index) => index / 24));
      for (const frame of frames) {
        const image = await decode(frame.blob);
        expect(image.width).toBe(180);
        expect(image.height).toBe(320);
      }
      expect(result.provenance.kind).toBe('frame');
      expect(result.provenance.state).toBe('current');
      expect(result.provenance.sceneId).toBe(model.scene.id);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  test(
    'two runs give byte-identical first frames',
    async () => {
      // Only the FIRST frame of each run is ever read, so the request asks for
      // exactly one (`to: 0`) rather than the thirteen a longer window would
      // render and discard — the same determinism claim, at a thirteenth of
      // the GPU work.
      async function firstFrame(): Promise<Uint8Array> {
        const model = loadModel();
        const { tour, livePose } = tourFor(model);
        const deps = depsFor(openRuntime(), model, tour, livePose);
        let first: Blob | undefined;
        await captureFrames(deps, {
          aspect: '16:9',
          height: 90,
          fps: 24,
          from: 0,
          to: 0,
          onFrame: (frame) => {
            first ??= frame.blob;
          },
        });
        return new Uint8Array(await first!.arrayBuffer());
      }
      const a = await firstFrame();
      const b = await firstFrame();
      expect(Array.from(a)).toEqual(Array.from(b));
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  test('a context lost mid-capture rejects with a typed context-lost error, and the tour is put back', async () => {
    const model = loadModel();
    const { tour, livePose } = tourFor(model);
    tour.seek(0.5);
    const before = tour.progress();
    const runtime = openRuntime();
    const deps = depsFor(runtime, model, tour, livePose);
    const lose = runtime.renderer.getContext().getExtension('WEBGL_lose_context');
    expect(lose, 'the browser must expose WEBGL_lose_context for this test to mean anything').toBeTruthy();
    const seen: number[] = [];

    // Guards against a host's recording left at `recording` for good: the
    // context goes while the clip is being produced, and the promise must say so.
    const capture = captureFrames(deps, {
      aspect: '1:1',
      height: 40,
      fps: 24,
      from: 0,
      to: 0.5,
      onFrame: ({ index }) => {
        seen.push(index);
        if (index === 1) lose!.loseContext();
      },
    });

    await expect(capture).rejects.toMatchObject({ name: 'ViewerLibError', code: 'context-lost' });
    expect(seen).toEqual([0, 1]);
    expect(tour.getState()).toBe('paused');
    expect(tour.progress().distance).toBeCloseTo(before.distance, 5);
  });

  test('restores a paused tour to its state and distance', async () => {
    const model = loadModel();
    const { tour, livePose } = tourFor(model);
    tour.seek(0.5);
    const before = tour.progress();
    const deps = depsFor(openRuntime(), model, tour, livePose);
    await captureFrames(deps, { aspect: '1:1', height: 40, fps: 24, from: 0, to: 0.2, onFrame: () => undefined });
    expect(tour.getState()).toBe('paused');
    expect(tour.progress().distance).toBeCloseTo(before.distance, 5);
  });

  test('restores a playing tour to playing at its resumed distance', async () => {
    const model = loadModel();
    const { tour, livePose } = tourFor(model);
    tour.play();
    tour.seekDistance(tour.length() * 0.3);
    expect(tour.getState()).toBe('playing');
    const before = tour.progress();
    const deps = depsFor(openRuntime(), model, tour, livePose);
    await captureFrames(deps, { aspect: '1:1', height: 40, fps: 24, from: 0, to: 0.1, onFrame: () => undefined });
    expect(tour.getState()).toBe('playing');
    expect(tour.progress().distance).toBeCloseTo(before.distance, 5);
  });

  test('restores an ended tour to ended', async () => {
    const model = loadModel();
    const { tour, livePose } = tourFor(model);
    tour.play();
    tour.seekDistance(tour.length());
    expect(tour.getState()).toBe('ended');
    const deps = depsFor(openRuntime(), model, tour, livePose);
    await captureFrames(deps, { aspect: '1:1', height: 40, fps: 24, from: 0, to: 0.1, onFrame: () => undefined });
    expect(tour.getState()).toBe('ended');
    expect(tour.progress().distance).toBeCloseTo(tour.length(), 5);
  });

  test('a tour never played is ready again afterwards', async () => {
    const model = loadModel();
    const { tour, livePose } = tourFor(model);
    expect(tour.getState()).toBe('ready');
    const deps = depsFor(openRuntime(), model, tour, livePose);
    await captureFrames(deps, { aspect: '1:1', height: 40, fps: 24, from: 0, to: 0.2, onFrame: () => undefined });
    expect(tour.getState()).toBe('ready');
    expect(tour.progress().distance).toBe(0);
  });

  test(
    'a speed setting scales the clip: round(window / speed * fps) + 1 frames, 1x seconds per frame times the speed',
    async () => {
      const model = loadModel();
      const { tour, livePose } = tourFor(model);
      const deps = depsFor(openRuntime(), model, tour, livePose);
      const run = async (speed: 0.5 | 1 | 2) => {
        const times: number[] = [];
        const result = await captureFrames(deps, {
          aspect: '1:1',
          height: 40,
          fps: 24,
          from: 0,
          to: 0.25,
          speed,
          onFrame: (frame) => {
            times.push(frame.timeS);
          },
        });
        return { result, times };
      };
      // The count a host computes in advance (a host's framesExpected): round(0.25 / speed * 24) + 1.
      const half = await run(0.5);
      const normal = await run(1);
      const double = await run(2);
      expect([half.result.frames, normal.result.frames, double.result.frames]).toEqual([13, 7, 4]);
      expect([half.result.durationS, normal.result.durationS, double.result.durationS]).toEqual([0.5, 0.25, 0.125]);
      expect(double.times).toEqual([0, 1, 2, 3].map((index) => (index * 2) / 24));
      expect(half.times.at(-1)).toBeCloseTo(0.25, 12);
      // The 1x clip is the one it always was.
      expect(normal.times).toEqual(Array.from({ length: 7 }, (_, index) => index / 24));
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  test('refuses a speed that is not a tour speed setting', async () => {
    const model = loadModel();
    const { tour, livePose } = tourFor(model);
    const deps = depsFor(openRuntime(), model, tour, livePose);
    await expect(
      captureFrames(deps, { aspect: '1:1', height: 40, fps: 24, from: 0, to: 0.1, speed: 3 as 2, onFrame: () => undefined }),
    ).rejects.toMatchObject({ code: 'bad-params' });
  });

  test('refuses a frame rate the profile does not name', async () => {
    const model = loadModel();
    const { tour, livePose } = tourFor(model);
    const deps = depsFor(openRuntime(), model, tour, livePose);
    await expect(
      captureFrames(deps, { aspect: '1:1', height: 40, fps: 23 as 24, from: 0, to: 0.1, onFrame: () => undefined }),
    ).rejects.toMatchObject({ code: 'bad-params' });
  });

  test('refuses a "to" before "from"', async () => {
    const model = loadModel();
    const { tour, livePose } = tourFor(model);
    const deps = depsFor(openRuntime(), model, tour, livePose);
    await expect(
      captureFrames(deps, { aspect: '1:1', height: 40, fps: 24, from: 1, to: 0, onFrame: () => undefined }),
    ).rejects.toMatchObject({ code: 'bad-params' });
  });
});

describe('capture.frames on a mounted viewer', () => {
  test('produces frames without leaving the live tour off its starting state', async () => {
    const handle = mountViewer(openContainer(), {
      scene: { repository: new InlineSceneRepository(structuredClone(lShapePlan)) },
      tour: { mode: 'off' },
      debug: false,
    });
    handles.push(handle);
    await handle.ready;
    const before = handle.getState();
    const frames: Array<{ index: number; timeS: number; blob: Blob }> = [];
    const result = await handle.capture.frames({
      aspect: '9:16',
      height: 160,
      fps: 24,
      from: 0,
      to: 0.2,
      caption: false,
      onFrame: (frame) => {
        frames.push(frame);
      },
    });
    expect(result.frames).toBe(frames.length);
    expect(frames.length).toBeGreaterThan(0);
    const image = await decode(frames[0]!.blob);
    expect(image.height).toBe(160);
    // Nothing about the live view changed: same mode, same document, same revision.
    expect(handle.getState()).toEqual(before);
  });
});
