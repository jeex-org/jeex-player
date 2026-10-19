/**
 * The tour cameras on a real WebGL2 mount: the overlay is drawn in EVERY WebGL mode — `plan3d`
 * too, not only `orbit` — and a tour over the cameras opens ON camera 1 in its
 * exact pose (a cut under reduced motion, never a fly-in).
 *
 * The overlay and the pose are read through `__viewerDebug` (`tourCameras`,
 * `camera`, `cameraLook`), the same reads a host editor's live check uses.
 *
 * The rig hides in walk and tour. Entering walk glides to camera 1 and stops; the walker steps
 * between the cameras with PageDown/PageUp/Home/End and the camera bar.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { SceneData, TourCheckpoint } from '../../src/scene/types.js';
import { GLIDE_SECONDS } from '../../src/camera/pose-glide.js';
import { MAX_FRAME_DELTA } from '../../src/render/render-runtime.js';
import { closeContainers, demoScene, nextFrame, openContainer, SETTLE_FRAMES, until, untilFrames } from './support.js';

/** The cameras' ids, fixed UUID v7: three seeded below, one the click-to-place test drops. */
const CAM = {
  living: '01a12ffa-de4d-7cd6-a722-91c7d6c68916',
  bedroom: '01a12ffa-de4e-71a8-999b-465a49c3d32b',
  kitchen: '01a12ffa-de4f-7327-997a-e0f0d5cc5428',
  placed: '01a12ffa-de50-7fd5-b821-76ba4f5c19cd',
} as const;

/** Three cameras in three rooms of the demo apartment; the bedroom is a dead end. */
const CAMERAS: TourCheckpoint[] = [
  { id: CAM.living, position: { x: 4.4, y: 1.55, z: 2.4 }, yaw: 0.5, pitch: -0.3 },
  { id: CAM.bedroom, position: { x: 11.9, y: 1.6, z: 8.4 }, yaw: Math.PI, pitch: -0.2 },
  { id: CAM.kitchen, position: { x: 1.1, y: 1.5, z: 5.2 }, yaw: -Math.PI / 2, pitch: -0.4 },
];

type Debug = {
  mode: () => string | undefined;
  camera: () => { x: number; y: number; z: number } | null;
  cameraLook: () => { yaw: number; pitch: number } | null;
  tourCameras: () => { visible: boolean; rendered: boolean; markers: string[]; tube: boolean };
  tour?: { play: () => void; progress: () => { state: string } | null };
};

const handles: ViewerHandle[] = [];

function debug(): Debug {
  return (window as unknown as { __viewerDebug: Debug }).__viewerDebug;
}

async function mount(options: Record<string, unknown> = {}): Promise<ViewerHandle> {
  const scene: SceneData = { ...demoScene(), tourCheckpoints: CAMERAS };
  const handle = mountViewer(openContainer(), {
    scene: { repository: new InlineSceneRepository(scene) },
    tour: { mode: 'off' },
    debug: true,
    ...options,
  });
  handles.push(handle);
  await handle.ready;
  return handle;
}

function angleGap(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

describe('the tour-camera overlay', () => {
  test('is drawn in plan3d as well as orbit, and only the 2D plan (renderer off) hides it', async () => {
    const handle = await mount();
    expect(debug().tourCameras().visible).toBe(false);
    handle.setCheckpointOverlay(true);
    handle.setMode('plan3d');
    await until(() => debug().mode() === 'plan3d', 'the top view');
    await nextFrame();
    const top = debug().tourCameras();
    expect(top).toEqual({ visible: true, rendered: true, markers: CAMERAS.map((camera) => camera.id), tube: true });
    handle.setMode('plan2d');
    await until(() => debug().mode() === 'plan2d', 'the 2D plan');
    expect(debug().tourCameras().rendered).toBe(false);
    handle.setMode('orbit');
    await until(() => debug().mode() === 'orbit', 'orbit');
    expect(debug().tourCameras().rendered).toBe(true);
  });
});

describe('the authoring rig in walk and tour', () => {
  /**
   * Six mode switches, two of them glides on the frame clock, plus a mount:
   * a count of FRAMES, which at 1-3 fps (four component files on one
   * SwiftShader) outlasts the default 60 s test budget. Each wait below is
   * bounded in frames; the test's ceiling is the same one the walk-entry
   * test uses.
   */
  const RIG_TIMEOUT_MS = 120_000;

  test(
    'markers, tube and the preview card hide in walk and tour and come back on leaving, the switch untouched',
    async () => {
      const handle = await mount();
      handle.setCheckpointOverlay(true);
      handle.setMode('orbit');
      await untilFrames(() => debug().mode() === 'orbit', 'orbit', SETTLE_FRAMES);
      expect(handle.focusCheckpoint(CAMERAS[1]!.id)).toBe(true);
      const card = (): string | undefined => document.querySelector<HTMLElement>('[data-jeex="camera-preview"]')?.dataset['visible'];
      await untilFrames(() => debug().tourCameras().rendered && card() === 'true', 'the rig and the card in orbit', SETTLE_FRAMES);
      for (const mode of ['walk', 'tour'] as const) {
        handle.setMode(mode);
        await untilFrames(() => debug().mode() === mode, mode, SETTLE_FRAMES);
        await untilFrames(() => !debug().tourCameras().rendered && card() === 'false', `the rig hidden in ${mode}`, SETTLE_FRAMES);
        // The host's switch is not the mode's: it stays on.
        expect(debug().tourCameras().visible).toBe(true);
      }
      handle.setMode('orbit');
      await untilFrames(() => debug().mode() === 'orbit', 'orbit again', SETTLE_FRAMES);
      await untilFrames(() => debug().tourCameras().rendered && card() === 'true', 'the rig and the card restored', SETTLE_FRAMES);
    },
    RIG_TIMEOUT_MS,
  );
});

describe('a tour over the cameras', () => {
  test('opens on camera 1 in its exact pose', async () => {
    await mount({ motion: 'reduced' });
    debug().tour!.play();
    const first = CAMERAS[0]!;
    await until(() => {
      const at = debug().camera();
      return at !== null && Math.hypot(at.x - first.position.x, at.y - first.position.y, at.z - first.position.z) < 0.02;
    }, 'the camera on camera 1');
    const look = debug().cameraLook()!;
    // A frame or two may have passed since the cut: the run eases in from
    // rest, so the view is still camera 1's to well within a degree.
    expect(angleGap(look.yaw, first.yaw)).toBeLessThan(0.02);
    expect(Math.abs(look.pitch - first.pitch)).toBeLessThan(0.02);
  });
});

describe('entering walk on a document with a checkpoint route', () => {
  /**
   * The glide lasts `GLIDE_SECONDS` of the viewer's clock, and a frame advances
   * that clock by at most `MAX_FRAME_DELTA`: at least this many frames however
   * slow they are, tripled as headroom. At 2-3 fps
   * (the component tier's four files on one SwiftShader) that is seconds each,
   * which a wall-clock `until` budget mistook for a stuck glide.
   */
  const GLIDE_FRAMES = Math.ceil(GLIDE_SECONDS / MAX_FRAME_DELTA) * 3;
  /** The test's own ceiling: two frame budgets at 2 fps plus the mount, milliseconds. */
  const FRAME_BOUND_TIMEOUT_MS = 120_000;

  test(
    'glides to camera 1 in about a second and stops there: nothing rides on, the rig stays hidden',
    async () => {
      const handle = await mount();
      const first = CAMERAS[0]!;
      const fromFirst = (): number => {
        const at = debug().camera();
        return at === null
          ? Number.POSITIVE_INFINITY
          : Math.hypot(at.x - first.position.x, at.y - first.position.y, at.z - first.position.z);
      };
      const entered = performance.now();
      handle.setMode('walk');
      await untilFrames(() => handle.getState().walk.camera.index === 0, 'arrival on camera 1', GLIDE_FRAMES);
      expect(fromFirst()).toBeLessThan(1e-3);
      // About a second: not a cut, not a crawl (SwiftShader frames are slow, so only a floor is sharp).
      expect(performance.now() - entered).toBeGreaterThan(600);
      const look = debug().cameraLook()!;
      expect(angleGap(look.yaw, first.yaw)).toBeLessThan(1e-3);
      expect(Math.abs(look.pitch - first.pitch)).toBeLessThan(1e-3);
      // It stays: no guided ride along the track any more.
      for (let frame = 0; frame < 10; frame += 1) await nextFrame();
      expect(fromFirst()).toBeLessThan(1e-3);
      expect(debug().mode()).toBe('walk');
      expect(debug().tourCameras().rendered).toBe(false);
    },
    FRAME_BOUND_TIMEOUT_MS,
  );

  test(
    'PageDown, End and the Next button step between the cameras; the bar shows «i / n» and disables its ends',
    async () => {
      // Reduced motion: every step lands in one frame, so the test counts steps, not metres.
      const handle = await mount({ motion: 'reduced' });
      const reported: Array<number | null> = [];
      handle.on('walkCamera', ({ index }) => reported.push(index));
      handle.setMode('walk');
      await untilFrames(() => handle.getState().walk.camera.index === 0, 'camera 1', SETTLE_FRAMES);
      const bar = document.querySelector<HTMLElement>('[data-jeex="walk-cameras"]')!;
      await untilFrames(() => !bar.hidden, 'the camera bar', SETTLE_FRAMES);
      const previous = bar.querySelector<HTMLButtonElement>('.walk-cameras-previous')!;
      const next = bar.querySelector<HTMLButtonElement>('.walk-cameras-next')!;
      expect(bar.textContent).toBe('1 / 3');
      expect(previous.disabled).toBe(true);
      expect(next.getAttribute('aria-label')).toBe('Next camera');

      const key = (name: string): void => {
        handle.element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
        handle.element.dispatchEvent(new KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true }));
      };
      key('PageDown');
      await untilFrames(() => handle.getState().walk.camera.index === 1, 'camera 2', SETTLE_FRAMES);
      const second = CAMERAS[1]!;
      const at = debug().camera()!;
      expect(Math.hypot(at.x - second.position.x, at.y - second.position.y, at.z - second.position.z)).toBeLessThan(1e-3);
      next.click();
      await untilFrames(() => handle.getState().walk.camera.index === 2, 'camera 3', SETTLE_FRAMES);
      expect(bar.textContent).toBe('3 / 3');
      expect(next.disabled).toBe(true);
      key('Home');
      await untilFrames(() => handle.getState().walk.camera.index === 0, 'camera 1 again', SETTLE_FRAMES);
      expect(reported).toEqual([0, 1, 2, 0]);
      expect(debug().mode()).toBe('walk');
    },
    FRAME_BOUND_TIMEOUT_MS,
  );

  test("a host without the viewer's controls keeps the keys but gets no camera bar", async () => {
    const handle = await mount({ motion: 'reduced', chrome: { controls: false } });
    handle.setMode('walk');
    await untilFrames(() => handle.getState().walk.camera.index === 0, 'camera 1', SETTLE_FRAMES);
    await nextFrame();
    expect(document.querySelector<HTMLElement>('[data-jeex="walk-cameras"]')!.hidden).toBe(true);
    expect(handle.stepCamera('next')).toBe(true);
    await untilFrames(() => handle.getState().walk.camera.index === 1, 'camera 2', SETTLE_FRAMES);
  });

  for (const from of ['plan3d', 'plan2d'] as const) {
    test(
      `from ${from} the glide opens on the top view on screen, not on the hidden 360 pose`,
      async () => {
        const handle = await mount();
        handle.setMode(from);
        await untilFrames(() => debug().mode() === from, from, SETTLE_FRAMES);
        const hidden = debug().cameraLook()!;
        handle.setMode('walk');
        await nextFrame();
        await nextFrame();
        // Two frames into a one-second ease-in: still looking (almost) straight down, where the 360 rig never looks.
        const look = debug().cameraLook()!;
        expect(hidden.pitch).toBeGreaterThan(-1.2);
        expect(look.pitch).toBeLessThan(-1.4);
        expect(debug().camera()!.y).toBeGreaterThan(5);
      },
      FRAME_BOUND_TIMEOUT_MS,
    );
  }

  test('under reduced motion the entry is a cut to camera 1', async () => {
    const handle = await mount({ motion: 'reduced' });
    handle.setMode('walk');
    await nextFrame();
    await nextFrame();
    const first = CAMERAS[0]!;
    const at = debug().camera()!;
    // The ride eases in from rest: a frame after the cut it is still on camera 1.
    expect(Math.hypot(at.x - first.position.x, at.y - first.position.y, at.z - first.position.z)).toBeLessThan(0.05);
  });
});

describe('the camera tool', () => {
  const badges = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-jeex="checkpoint-badges"] .checkpoint-badge')];

  async function authoring(): Promise<ViewerHandle> {
    const handle = await mount();
    handle.setCheckpointOverlay(true);
    handle.setMode('orbit');
    await until(() => debug().mode() === 'orbit' && debug().tourCameras().rendered, 'the rig in orbit');
    return handle;
  }

  test('every camera wears its tour order as a badge; the active one carries the accent', async () => {
    const handle = await authoring();
    await until(() => badges().length === CAMERAS.length, 'one badge per camera');
    expect(badges().map((badge) => badge.textContent)).toEqual(['1', '2', '3']);
    expect(badges().map((badge) => badge.dataset['checkpointId'])).toEqual(CAMERAS.map((camera) => camera.id));
    handle.focusCheckpoint(CAMERAS[1]!.id);
    await until(() => badges()[1]!.dataset['active'] === 'true', 'the active badge');
    const active = getComputedStyle(badges()[1]!).backgroundColor;
    expect(active).not.toBe(getComputedStyle(badges()[0]!).backgroundColor);
    // The layer hides in walk with the rest of the rig.
    handle.setMode('walk');
    await until(() => document.querySelector<HTMLElement>('[data-jeex="checkpoint-badges"]')!.hidden === true, 'badges hidden in walk');
  });

  test('in plan3d each badge floats right above its camera in the top view, not where the hidden 360 camera sees it', async () => {
    const handle = await authoring();
    handle.setMode('plan3d');
    await untilFrames(() => debug().mode() === 'plan3d' && badges().length === CAMERAS.length, 'badges in the top view', SETTLE_FRAMES);
    // The badges are placed by the overlay's frame step: one more frame reads this top view's placement.
    await nextFrame();
    const probe = (window as unknown as { __viewerDebug: { selectionPoint: (x: number, z: number) => { x: number; y: number } | null } })
      .__viewerDebug;
    const canvas = document.querySelector<HTMLElement>('[data-jeex="scene-canvas"]')!.getBoundingClientRect();
    for (const [index, camera] of CAMERAS.entries()) {
      const at = probe.selectionPoint(camera.position.x, camera.position.z)!;
      const box = badges()[index]!.getBoundingClientRect();
      const badge = { x: box.left + box.width / 2 - canvas.left, y: box.top + box.height / 2 - canvas.top };
      expect(Math.abs(badge.x - at.x)).toBeLessThan(3);
      // Above the body, by its half height plus the 16 px gap — never 150 px away.
      expect(at.y - badge.y).toBeGreaterThan(10);
      expect(at.y - badge.y).toBeLessThan(80);
    }
  });

  test('look through: the view stands in the camera; Cancel commits nothing, keeping commits ONE edit', async () => {
    const handle = await authoring();
    const edits: number[] = [];
    handle.on('checkpointEdit', (edit) => edits.push(edit.checkpoints.length));
    const target = CAMERAS[0]!;
    expect(handle.lookThroughCheckpoint(target.id)).toBe(true);
    expect(handle.getMode()).toBe('walk');
    await nextFrame();
    const at = debug().camera()!;
    expect(Math.hypot(at.x - target.position.x, at.y - target.position.y, at.z - target.position.z)).toBeLessThan(0.02);
    const bar = document.querySelector<HTMLElement>('[data-jeex="look-through"]')!;
    expect(bar.hidden).toBe(false);
    bar.querySelector<HTMLButtonElement>('.look-through-cancel')!.click();
    expect(handle.getMode()).toBe('orbit');
    expect(edits).toEqual([]);
    handle.lookThroughCheckpoint(target.id);
    handle.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }));
    document.querySelector<HTMLButtonElement>('[data-jeex="look-through"] .look-through-done')!.click();
    expect(edits).toEqual([CAMERAS.length]);
  });

  test('click-to-place drops one camera, under the id the host gave, on the floor under the click', async () => {
    const handle = await authoring();
    const edits: TourCheckpoint[] = [];
    handle.on('checkpointEdit', (edit) => edits.push(edit.checkpoints.at(-1)!));
    expect(handle.startCheckpointPlacement({ id: CAM.placed })).toBe(true);
    const canvas = document.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    const box = canvas.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, pointerId: 11, button: 0, bubbles: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', at));
    canvas.dispatchEvent(new PointerEvent('pointerup', at));
    expect(handle.getState().checkpoints.placing).toBe(false);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.id).toBe(CAM.placed);
    expect(edits[0]!.position.y).toBeCloseTo(1.65, 6);
  });
});
