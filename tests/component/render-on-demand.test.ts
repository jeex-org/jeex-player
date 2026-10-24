/**
 * Walk, tour, orbit and plan3d draw on demand (`src/render/render-demand.ts`),
 * in a real browser on the demo apartment: a resting view keeps ticking while
 * its display draws stay flat and the compositor keeps the last picture, and
 * every kind of visible change draws. In the editing modes each change is
 * followed by the skipped-draw verifier (`verifyNothingSkipped`): the picture
 * the compositor kept must equal a frame forced through the same path.
 *
 * Every wait is on the viewer's own tick counter (`__viewerDebug.renderDemand`),
 * never on the wall clock: at one or two frames a second a motion lasts the
 * same number of ticks and any number of seconds.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import * as THREE from 'three';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { RenderDemand, type DemandCounters } from '../../src/render/render-demand.js';
import { RenderRuntime } from '../../src/render/render-runtime.js';
import { WalkLighting } from '../../src/render/walk-post.js';
import { FloorRing } from '../../src/camera/floor-ring.js';
import { ViewerEditor } from '../../src/app/viewer-editor.js';
import { ViewerSelectionController } from '../../src/app/selection.js';
import { BOTTOM_RIGHT_CLAIMED_ATTRIBUTE } from '../../src/ui/host-slots.js';
import { DEMO } from '../../src/demo/demo-ids.js';
import { VARIANT } from '../../src/assets/catalogue-ids.js';
import type { SceneData, TourCheckpoint } from '../../src/scene/types.js';
import { ASSET_MOVE_CHUNK_TIMEOUT_MS, closeContainers, delay, demoScene, nextFrame, openContainer, until } from './support.js';

const MOUNT_TIMEOUT_MS = 300_000;
/** Ceiling of one wait on the tick counter: a hundred ticks at one frame a second, with room. */
const TICKS_TIMEOUT_MS = 180_000;
/** Ticks without a draw that count as resting. */
const REST_TICKS = 15;

const debug = () => window.__viewerDebug!;
const counters = (): DemandCounters => debug().renderDemand();

/** Waits `count` viewer ticks and answers what happened in them. */
async function ticks(count: number): Promise<DemandCounters> {
  const start = counters();
  await until(() => counters().ticks - start.ticks >= count, `${count} ticks`, TICKS_TIMEOUT_MS);
  const end = counters();
  return { ticks: end.ticks - start.ticks, draws: end.draws - start.draws, insetDraws: end.insetDraws - start.insetDraws };
}

/** Waits until a window of `REST_TICKS` ticks draws nothing. */
async function rest(what: string): Promise<void> {
  for (let round = 0; round < 40; round += 1) {
    if ((await ticks(REST_TICKS)).draws === 0) return;
  }
  throw new Error(`${what}: the view never came to rest`);
}

/**
 * Runs `change` on a resting view and follows the draws it caused until the
 * view rests again: how many ticks the motion lasted (up to its last draw)
 * and how many of them drew.
 */
async function follow(change: () => void): Promise<{ ticks: number; draws: number }> {
  await rest('before the change');
  const start = counters();
  change();
  let last = start;
  const deadline = performance.now() + TICKS_TIMEOUT_MS;
  for (;;) {
    await nextFrame();
    const now = counters();
    if (now.draws > last.draws) last = now;
    else if (now.ticks - last.ticks >= REST_TICKS) break;
    if (performance.now() > deadline) throw new Error('the change never came to rest');
  }
  return { ticks: last.ticks - start.ticks, draws: last.draws - start.draws };
}

/** Share of pixels of two PNG screenshots (base64) that differ by more than 8 levels in any channel. */
async function differingShare(a: string, b: string): Promise<number> {
  const pixels = async (png: string): Promise<Uint8ClampedArray> => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  };
  const [left, right] = [await pixels(a), await pixels(b)];
  let differing = 0;
  for (let i = 0; i < left.length; i += 4) {
    if (Math.max(Math.abs(left[i]! - right[i]!), Math.abs(left[i + 1]! - right[i + 1]!), Math.abs(left[i + 2]! - right[i + 2]!)) > 8)
      differing += 1;
  }
  return differing / (left.length / 4);
}

/**
 * Share of pixels of two PNG screenshots (base64) that differ by more than 8
 * levels from every pixel within one pixel of them in the other picture, both
 * ways. A sub-pixel shift of the whole picture (the end of a camera easing
 * below the pose tolerance, by design not redrawn) is mostly explained by a
 * neighbour; a change of any object's colour, place or presence is not.
 */
async function unexplainedShare(a: string, b: string): Promise<number> {
  const decode = async (png: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return { data: context.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
  };
  const [left, right] = [await decode(a), await decode(b)];
  const { width, height } = left;
  const close = (from: Uint8ClampedArray, i: number, to: Uint8ClampedArray, j: number): boolean =>
    Math.max(Math.abs(from[i]! - to[j]!), Math.abs(from[i + 1]! - to[j + 1]!), Math.abs(from[i + 2]! - to[j + 2]!)) <= 8;
  const explained = (from: Uint8ClampedArray, to: Uint8ClampedArray, x: number, y: number): boolean => {
    const i = (y * width + x) * 4;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (close(from, i, to, (ny * width + nx) * 4)) return true;
      }
    }
    return false;
  };
  let unexplained = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!explained(left.data, right.data, x, y) || !explained(right.data, left.data, x, y)) unexplained += 1;
    }
  }
  return unexplained / (width * height);
}

/** The compositor's picture of the page, as PNG base64. */
async function shot(): Promise<string> {
  return page.screenshot({ save: false });
}

describe('walk and tour draw on demand', { timeout: MOUNT_TIMEOUT_MS }, () => {
  let handle: ViewerHandle;
  let container: HTMLElement;
  let camera: THREE.Camera | null = null;
  /** The walk floor ring the camera controller made. */
  let ringOf: () => FloorRing = () => {
    throw new Error('no floor ring yet');
  };
  let hasRing = (): boolean => false;

  beforeAll(async () => {
    // The walk floor ring, as the camera controller made it: the receiver of its first `show`.
    const shows = vi.spyOn(FloorRing.prototype, 'show');
    ringOf = () => shows.mock.contexts[0] as FloorRing;
    hasRing = () => shows.mock.contexts.length > 0;
    // The live camera, as the gate reads it.
    const shouldDraw = Object.getOwnPropertyDescriptor(RenderDemand.prototype, 'shouldDraw')!.value as RenderDemand['shouldDraw'];
    vi.spyOn(RenderDemand.prototype, 'shouldDraw').mockImplementation(function (this: RenderDemand, live, mode) {
      camera = live as unknown as THREE.Camera;
      return shouldDraw.call(this, live, mode);
    });
    container = openContainer(480, 320);
    handle = mountViewer(container, {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      debug: true,
    });
    await handle.ready;
    handle.setMode('walk');
    await until(() => debug().walkLighting().state === 'live', 'room lighting live', MOUNT_TIMEOUT_MS - 60_000);
    await rest('walk entry');
  }, MOUNT_TIMEOUT_MS);

  afterAll(() => {
    handle.dispose();
    vi.restoreAllMocks();
    closeContainers();
  });

  test('a resting walk ticks on with its draws flat and the same picture on screen', async () => {
    const before = await shot();
    const idle = await ticks(60);
    expect(idle.ticks).toBeGreaterThanOrEqual(60);
    expect(idle.draws).toBe(0);
    expect(await shot()).toBe(before);
  });

  test('other layers or another projection at the same pose draw once each', async () => {
    const live = camera as THREE.PerspectiveCamera;
    const layered = await follow(() => live.layers.enable(30));
    live.layers.disable(30);
    expect(layered.draws).toBeGreaterThanOrEqual(1);
    const zoomed = await follow(() => {
      live.zoom = 1.02;
      live.updateProjectionMatrix();
    });
    live.zoom = 1;
    live.updateProjectionMatrix();
    expect(zoomed.draws).toBeGreaterThanOrEqual(1);
  });

  test('a door draws every tick of its motion, its final pose included, then rests', async () => {
    const door = debug().doors()[0]!;
    const motion = await follow(() => debug().toggleDoor(door.id));
    // The swing lasts wall-clock time, so its tick count is the frame rate's; every one of them draws.
    expect(motion.draws).toBeGreaterThanOrEqual(1);
    expect(motion.draws).toBeGreaterThanOrEqual(motion.ticks - 1);
    expect(
      debug()
        .doors()
        .find((record) => record.id === door.id)!.phase,
    ).not.toBe('opening');
  });

  test('the furniture ripple draws while it runs and rests after it, both ways', async () => {
    const hidden = await follow(() => handle.setFurnitureVisible(false));
    expect(hidden.draws).toBeGreaterThanOrEqual(1);
    expect(hidden.draws).toBeGreaterThanOrEqual(hidden.ticks - 1);
    const shown = await follow(() => handle.setFurnitureVisible(true));
    expect(shown.draws).toBeGreaterThanOrEqual(1);
  });

  test('a selection draws through its fade; clearing it at the same pose draws the unselected picture', async () => {
    await rest('before the selection');
    const unselected = await shot();
    // The first room floor whose tint shows from where the walk stands.
    let selected: string | null = null;
    for (const room of demoScene().rooms) {
      const set = await follow(() => handle.setSelection({ kind: 'room', id: room.id }));
      expect(set.draws).toBeGreaterThan(1);
      selected = await shot();
      if (selected !== unselected) break;
    }
    expect(selected).not.toBe(unselected);
    const cleared = await follow(() => handle.setSelection(null));
    expect(cleared.draws).toBeGreaterThanOrEqual(1);
    expect(await shot()).not.toBe(selected);
  });

  test('an edit draws, and the room lighting refresh after it draws again', async () => {
    const refreshed = Object.getOwnPropertyDescriptor(WalkLighting.prototype, 'refresh')!.value as WalkLighting['refresh'];
    /** Display draws when the refresh ran: its own tick draws after it. */
    let drawsAtRefresh = -1;
    const refresh = vi.spyOn(WalkLighting.prototype, 'refresh').mockImplementation(function (this: WalkLighting, scope) {
      drawsAtRefresh = counters().draws;
      refreshed.call(this, scope);
    });
    const asset = demoScene().assets[0]!;
    const edited = await follow(() => {
      const result = debug().applyOps!([
        { op: 'move_object', assetId: asset.id, position: { x: asset.position.x + 0.05, y: asset.position.y, z: asset.position.z } },
      ]);
      expect('error' in result ? result.error : undefined).toBeUndefined();
    });
    expect(edited.draws).toBeGreaterThanOrEqual(1);
    // The debounce is wall-clock time; the refresh lands on a tick after it.
    await until(() => refresh.mock.calls.length > 0, 'the lighting refresh', 60_000);
    await rest('after the refresh');
    expect(counters().draws).toBeGreaterThan(drawsAtRefresh);
    refresh.mockRestore();
  });

  test('the floor ring the walk puts on the floor draws on a move and on hiding while the camera rests', async () => {
    // The walk asks the ring to stand where a hovering pointer meets the floor
    // (`CameraController.flushHover`); this asks it the same way.
    // A pointer leaving the canvas hides the ring through the controller: that call names the ring.
    container.querySelector('[data-jeex="scene-canvas"]')!.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await until(() => hasRing(), 'the controller to hide the ring', 10_000);
    // The floor point the walk's own pick finds under a spot of the canvas (`CameraController.floorPoint`).
    const box = container.querySelector('[data-jeex="scene-canvas"]')!.getBoundingClientRect();
    let found: { x: number; y: number; z: number } | null = null;
    for (const [x, y] of [
      [0.5, 0.8],
      [0.4, 0.8],
      [0.6, 0.8],
      [0.5, 0.7],
      [0.5, 0.9],
    ] as const) {
      found ??= debug().floorPoint(box.left + box.width * x, box.top + box.height * y);
    }
    expect(found).not.toBeNull();
    const point = new THREE.Vector3(found!.x, found!.y, found!.z);
    await rest('before the ring');
    const without = await shot();
    const shown = await follow(() => ringOf().show(point));
    expect(shown.draws).toBeGreaterThanOrEqual(1);
    const withRing = await shot();
    expect(await differingShare(without, withRing)).toBeGreaterThan(0);
    const moved = await follow(() => ringOf().show(point.clone().add(new THREE.Vector3(0.3, 0, 0))));
    expect(moved.draws).toBeGreaterThanOrEqual(1);
    const hidden = await follow(() => ringOf().show(null));
    expect(hidden.draws).toBeGreaterThanOrEqual(1);
    expect(await differingShare(without, await shot())).toBe(0);
    // Hiding a hidden ring changes nothing and draws nothing.
    const again = await follow(() => ringOf().show(null));
    expect(again.draws).toBe(0);
  });

  test('a lost and restored GPU context draws the walk again, the same picture, then rests', async () => {
    await rest('before the loss');
    const before = await shot();
    const canvas = container.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    const lose = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    const lost = new Promise((resolve) => {
      canvas.addEventListener('webglcontextlost', resolve, { once: true });
    });
    lose.loseContext();
    await lost;
    const atLoss = counters();
    // Nothing is drawn while the context is gone.
    await nextFrame();
    await nextFrame();
    expect(counters().draws).toBe(atLoss.draws);
    lose.restoreContext();
    await until(() => counters().draws > atLoss.draws, 'a draw after the restore', TICKS_TIMEOUT_MS);
    await until(() => debug().walkLighting().state === 'live', 'room lighting live again', MOUNT_TIMEOUT_MS - 60_000);
    await rest('after the restore');
    expect(await differingShare(before, await shot())).toBeLessThan(0.01);
  });

  test('a resize draws a complete picture, then rests', async () => {
    const resized = await follow(() => {
      container.style.width = '440px';
    });
    expect(resized.draws).toBeGreaterThanOrEqual(1);
    container.style.width = '480px';
    await rest('the resize back');
  });

  test('a still with a redraw pending succeeds and the redraw still happens', async () => {
    await rest('before the still');
    const start = counters();
    handle.setSelection({ kind: 'wall', id: demoScene().walls[0]!.id });
    const { blob } = await handle.capture.still({ width: 80, height: 60, caption: false });
    expect(blob.size).toBeGreaterThan(0);
    await ticks(3);
    expect(counters().draws).toBeGreaterThan(start.draws);
    handle.setSelection(null);
    await rest('after the still');
  });

  test('a panorama with a redraw pending succeeds and the redraw still happens', async () => {
    await rest('before the panorama');
    const start = counters();
    handle.setSelection({ kind: 'wall', id: demoScene().walls[0]!.id });
    const { blob } = await handle.capture.panorama({ width: 64, roomId: demoScene().rooms[0]!.id, caption: false });
    expect(blob.size).toBeGreaterThan(0);
    await ticks(3);
    expect(counters().draws).toBeGreaterThan(start.draws);
    handle.setSelection(null);
    await rest('after the panorama');
  });

  test('a canvas taken off the page and put back draws a complete picture, then rests', async () => {
    await rest('before the detach');
    const parent = container.parentElement!;
    container.remove();
    await nextFrame();
    await nextFrame();
    const start = counters();
    parent.append(container);
    await ticks(3);
    expect(counters().draws).toBeGreaterThan(start.draws);
    await rest('after the reattach');
  });

  test('a video clip draws the restored live view once, then the view rests', async () => {
    await rest('before the clip');
    const result = await handle.capture.frames({
      aspect: '16:9',
      height: 60,
      fps: 24,
      from: 0,
      to: 0.1,
      caption: false,
      onFrame: () => undefined,
    });
    expect(result.frames).toBeGreaterThan(0);
    const after = await ticks(3);
    expect(after.draws).toBeGreaterThanOrEqual(1);
    await rest('after the clip');
  });
});

/**
 * Share of the 480 × 320 canvas allowed to differ after a camera motion's
 * sub-tolerance tail (see `verifyNothingSkipped`): about 60 pixels, where 23 to
 * 28 were measured after a drag. A skipped change of any object is far larger.
 */
const POSE_TAIL_SHARE = 0.0004;

/** Two tour cameras for the editing describe, by fixed UUID v7: one in the living room, one in the bedroom. */
const CAMERA_IDS = ['01a1300a-1c00-7000-8000-00000000c001', '01a1300a-1c00-7000-8000-00000000c002'] as const;

/** The demo apartment with two tour cameras, standing over two of its pieces. */
function sceneWithCameras(): SceneData {
  const scene = demoScene();
  const at = (assetId: string, id: string, yaw: number): TourCheckpoint => {
    const asset = scene.assets.find((candidate) => candidate.id === assetId)!;
    return { id, position: { x: asset.position.x, y: 1.6, z: asset.position.z }, yaw, pitch: 0 };
  };
  return { ...scene, tourCheckpoints: [at(DEMO.asset.livingTable, CAMERA_IDS[0], 0), at(DEMO.asset.bedroomBed, CAMERA_IDS[1], Math.PI)] };
}

describe('the editing modes draw on demand', { timeout: MOUNT_TIMEOUT_MS }, () => {
  let handle: ViewerHandle;
  let container: HTMLElement;
  /** The runtime's gate, as the frame loop asks it. */
  let demandOf: () => RenderDemand = () => {
    throw new Error('no gate yet');
  };
  let editorOf: () => ViewerEditor = () => {
    throw new Error('no editor yet');
  };
  let selectionOf: () => ViewerSelectionController = () => {
    throw new Error('no selection controller yet');
  };
  const canvas = (): HTMLCanvasElement => container.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
  const card = (): HTMLElement => container.querySelector<HTMLElement>('[data-jeex="camera-preview"]')!;
  const root = (): HTMLElement => container.querySelector<HTMLElement>('.jeex-viewer')!;

  /** Viewport pixels of a world point through the camera on screen. */
  function pixel(x: number, y: number, z: number): { clientX: number; clientY: number } {
    const point = debug().projectPoint(x, y, z);
    if (!point) throw new Error(`(${x}, ${y}, ${z}) is not on screen`);
    const box = canvas().getBoundingClientRect();
    return { clientX: box.left + point.x, clientY: box.top + point.y };
  }

  let pointerId = 7000;
  function pointer(target: Element, type: string, at: { clientX: number; clientY: number }, id: number): void {
    target.dispatchEvent(
      new PointerEvent(type, {
        ...at,
        pointerId: id,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        bubbles: true,
        pointerType: 'mouse',
      }),
    );
  }

  /**
   * The skipped-draw verifier: with the view at rest and animation time frozen,
   * the picture the compositor kept must equal a frame forced through the same
   * main-plus-inset path. A difference is a visible change nothing asked to draw.
   * Ticks after the forced frame, on the frozen clock, draw nothing: no main
   * frame and no inset.
   *
   * `tail` is the share of pixels allowed to differ after a camera motion: the
   * rig's easing ends below the pose tolerance (`POSE_TOLERANCE`), by design
   * not redrawn, and a forced frame at the final pose moves a few edge pixels.
   * Every other scenario allows none.
   */
  /** The scene canvas alone, as the compositor shows it: the chrome over it is DOM, fading on its own clock, and no frame draws it. */
  async function canvasShot(): Promise<string> {
    const only = document.createElement('style');
    only.textContent =
      '.jeex-viewer * { visibility: hidden !important; } .jeex-viewer canvas[data-jeex="scene-canvas"] { visibility: visible !important; }';
    document.head.append(only);
    try {
      await nextFrame();
      return await page.screenshot({ element: canvas(), save: false });
    } finally {
      only.remove();
    }
  }

  async function verifyNothingSkipped(what: string, tail = 0, afterKeep?: () => void): Promise<void> {
    await rest(what);
    // Longer than `rest`: a sub-tolerance tail must have stopped adding up before the comparison.
    await ticks(REST_TICKS);
    const frozen = performance.now();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(frozen);
    try {
      const retained = await canvasShot();
      afterKeep?.();
      const start = counters();
      demandOf().invalidate();
      await until(() => counters().draws > start.draws, `${what}: the forced frame`, TICKS_TIMEOUT_MS);
      await nextFrame();
      const forced = await canvasShot();
      const share = await unexplainedShare(retained, forced);
      expect(share, `${what}: the kept picture is the forced one`).toBeLessThanOrEqual(tail);
      const after = await ticks(10);
      expect(after.draws, `${what}: frozen ticks after the forced frame`).toBe(0);
      expect(after.insetDraws, `${what}: frozen ticks draw no inset`).toBe(0);
    } finally {
      clock.mockRestore();
    }
  }

  /** Runs `change` now (the view need not rest first) and follows its draws until the view rests. */
  async function followNow(change: () => void): Promise<{ ticks: number; draws: number }> {
    const start = counters();
    change();
    await rest('after the change');
    const end = counters();
    return { ticks: end.ticks - start.ticks, draws: end.draws - start.draws };
  }

  /** `change` on a resting view draws and the view rests again, with nothing skipped. */
  async function draws(what: string, change: () => void): Promise<{ ticks: number; draws: number }> {
    const result = await follow(change);
    expect(result.draws, `${what}: draws`).toBeGreaterThanOrEqual(1);
    await verifyNothingSkipped(what);
    return result;
  }

  /** The runtime's scene, as the frame loop draws it. */
  let sceneOf: () => THREE.Scene = () => {
    throw new Error('no runtime yet');
  };

  beforeAll(async () => {
    const addFrameHook = Object.getOwnPropertyDescriptor(RenderRuntime.prototype, 'addFrameHook')!.value as RenderRuntime['addFrameHook'];
    vi.spyOn(RenderRuntime.prototype, 'addFrameHook').mockImplementation(function (this: RenderRuntime, hook) {
      sceneOf = () => this.scene;
      return addFrameHook.call(this, hook);
    });
    const shouldDraw = Object.getOwnPropertyDescriptor(RenderDemand.prototype, 'shouldDraw')!.value as RenderDemand['shouldDraw'];
    vi.spyOn(RenderDemand.prototype, 'shouldDraw').mockImplementation(function (this: RenderDemand, live, mode) {
      demandOf = () => this;
      return shouldDraw.call(this, live, mode);
    });
    const updateGlows = Object.getOwnPropertyDescriptor(ViewerEditor.prototype, 'updateGlows')!.value as ViewerEditor['updateGlows'];
    vi.spyOn(ViewerEditor.prototype, 'updateGlows').mockImplementation(function (this: ViewerEditor, now) {
      editorOf = () => this;
      return updateGlows.call(this, now);
    });
    const update = Object.getOwnPropertyDescriptor(ViewerSelectionController.prototype, 'update')!
      .value as ViewerSelectionController['update'];
    vi.spyOn(ViewerSelectionController.prototype, 'update').mockImplementation(function (this: ViewerSelectionController, now) {
      selectionOf = () => this;
      return update.call(this, now);
    });
    container = openContainer(480, 320);
    handle = mountViewer(container, {
      scene: { repository: new InlineSceneRepository(sceneWithCameras()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      debug: true,
    });
    await handle.ready;
    expect(handle.getMode()).toBe('orbit');
    await rest('orbit after ready');
  }, MOUNT_TIMEOUT_MS);

  afterAll(() => {
    handle.dispose();
    vi.restoreAllMocks();
    closeContainers();
  });

  // Every test starts from the same resting orbit, whatever the one before it left behind.
  beforeEach(async () => {
    handle.setAssetMoveTool(false);
    handle.cancelCheckpointPlacement();
    handle.setCheckpointOverlay(false);
    handle.setSelection(null);
    if (editorOf !== undefined) {
      try {
        editorOf().handleFurniturePick(null);
      } catch {
        // No editor captured yet: nothing selected through it.
      }
    }
    if (handle.getMode() !== 'orbit') handle.setMode('orbit');
    await rest('a clean resting orbit');
  }, TICKS_TIMEOUT_MS);

  test('a visible change that asks for its frame inside the verifier window is a rest not yet reached, not a skipped draw', async () => {
    // A late library map does this: it lands while the kept picture is taken and
    // asks for a frame (`LibrarySurface.load` → `attached` → `invalidate`).
    const scene = sceneOf();
    const before = scene.environmentIntensity;
    try {
      await verifyNothingSkipped('a late landing inside the window', 0, () => {
        scene.environmentIntensity = before * 1.5;
        demandOf().invalidate();
      });
    } finally {
      scene.environmentIntensity = before;
      demandOf().invalidate();
    }
  });

  test('a resting orbit ticks on with no draw over 60 ticks and over two seconds, and keeps its picture', async () => {
    const before = await canvasShot();
    const idle = await ticks(60);
    expect(idle.ticks).toBeGreaterThanOrEqual(60);
    expect(idle.draws).toBe(0);
    const start = counters();
    await delay(2000);
    const window2s = counters();
    expect(window2s.ticks).toBeGreaterThan(start.ticks);
    expect(window2s.draws).toBe(start.draws);
    expect(await canvasShot()).toBe(before);
    await verifyNothingSkipped('resting orbit');
  });

  test('the top view rests too; the flat plan keeps only its heartbeat', async () => {
    const top = await follow(() => handle.setMode('plan3d'));
    expect(top.draws).toBeGreaterThanOrEqual(1);
    const idle = await ticks(60);
    expect(idle.draws).toBe(0);
    await verifyNothingSkipped('resting plan3d');
    handle.setMode('plan2d');
    await ticks(5);
    const start = counters();
    await delay(2000);
    const flat = { ticks: counters().ticks - start.ticks, draws: counters().draws - start.draws };
    expect(flat.draws).toBeGreaterThanOrEqual(1);
    expect(flat.draws).toBeLessThan(flat.ticks);
    handle.setMode('orbit');
    await rest('back in orbit');
  });

  test('a real drag orbits the camera; the easing draws until it settles, then the view rests', async () => {
    await rest('before the drag');
    const box = canvas().getBoundingClientRect();
    const from = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    const id = (pointerId += 1);
    const start = counters();
    pointer(canvas(), 'pointerdown', from, id);
    for (let step = 1; step <= 6; step += 1) {
      pointer(canvas(), 'pointermove', { clientX: from.clientX + step * 12, clientY: from.clientY }, id);
      await nextFrame();
    }
    pointer(canvas(), 'pointerup', { clientX: from.clientX + 72, clientY: from.clientY }, id);
    await rest('after the drag');
    expect(counters().draws - start.draws).toBeGreaterThan(1);
    await verifyNothingSkipped('after the drag', POSE_TAIL_SHARE);
  });

  test('the editor aura draws every tick while shown and through its fade-out, then the view rests', async () => {
    await rest('before the aura');
    const without = await canvasShot();
    editorOf().handleFurniturePick(DEMO.asset.livingSofa);
    // A live aura never rests: every tick draws while it is shown.
    const whileShown = await ticks(30);
    expect(whileShown.draws).toBeGreaterThanOrEqual(whileShown.ticks - 1);
    const cleared = await followNow(() => editorOf().handleFurniturePick(null));
    expect(cleared.draws).toBeGreaterThanOrEqual(1);
    expect(await differingShare(without, await canvasShot())).toBe(0);
    await verifyNothingSkipped('after the aura');
  });

  test('a host selection tint draws through its finite fade and rests; a recolour draws too', async () => {
    await rest('before the tint');
    const set = await follow(() => handle.setSelection({ kind: 'furniture', id: DEMO.asset.livingSofa }));
    expect(set.draws).toBeGreaterThan(1);
    await verifyNothingSkipped('host tint');
    await draws('selection recolour', () => selectionOf().tint(0xd9534f));
    await draws('selection colour back', () => selectionOf().tint(null));
    await draws('selection cleared', () => handle.setSelection(null));
  });

  test('scene edits draw: a move, a finish, a variant swap, a shell rebuild; each rests', async () => {
    const asset = demoScene().assets.find((candidate) => candidate.id === DEMO.asset.livingCoffeeTable)!;
    const apply = (ops: Parameters<NonNullable<ReturnType<typeof debug>['applyOps']>>[0]) => () => {
      const result = debug().applyOps!(ops);
      expect('error' in result ? result.error : undefined).toBeUndefined();
    };
    await draws(
      'move_object',
      apply([{ op: 'move_object', assetId: asset.id, position: { x: asset.position.x + 0.1, y: asset.position.y, z: asset.position.z } }]),
    );
    const finish = debug().presets()[0];
    if (finish) await draws('a finish preset', () => debug().applyPreset(finish.id));
    const armchair = handle.getScene()!.assets.find((candidate) => candidate.id === DEMO.asset.livingArmchair)!;
    const variant =
      (armchair as { variant?: string }).variant === VARIANT.armchair_boucle ? VARIANT.armchair_sage : VARIANT.armchair_boucle;
    // The swap pops the old body out and the new one in over a tenth of a second: every frame of it draws, the last one included.
    await draws('a variant swap', apply([{ op: 'replace_asset_variant', assetId: armchair.id, variant }]));
    await draws('a shell rebuild', apply([{ op: 'set_ceiling', height: demoScene().ceilingHeight + 0.1 }]));
  });

  test('a door draws every tick of its motion and its final pose; the furniture ripple draws to its last frame', async () => {
    const door = debug().doors()[0]!;
    const motion = await draws('door', () => debug().toggleDoor(door.id));
    expect(motion.draws).toBeGreaterThanOrEqual(motion.ticks - 1);
    const hidden = await draws('furniture hidden', () => handle.setFurnitureVisible(false));
    expect(hidden.draws).toBeGreaterThanOrEqual(hidden.ticks - 1);
    await draws('furniture shown', () => handle.setFurnitureVisible(true));
  });

  test('the light temperature draws', async () => {
    await draws('warm light', () => handle.setLightTemperature(2700));
    await draws('original light', () => handle.setLightTemperature(null));
  });

  test('the tour-camera rig: switched on and off, hover, focus, a marker drag and its cancel', async () => {
    const without = await canvasShot();
    await draws('overlay on', () => handle.setCheckpointOverlay(true));
    expect(await differingShare(without, await canvasShot())).toBeGreaterThan(0);
    await draws('overlay off', () => handle.setCheckpointOverlay(false));
    expect(await differingShare(without, await canvasShot())).toBe(0);
    await draws('overlay on again', () => handle.setCheckpointOverlay(true));
    const camera = sceneWithCameras().tourCheckpoints![0]!;
    const marker = pixel(camera.position.x, camera.position.y, camera.position.z);
    const hoverId = (pointerId += 1);
    await draws('hover', () =>
      canvas().dispatchEvent(new PointerEvent('pointermove', { ...marker, pointerId: hoverId, bubbles: true, pointerType: 'mouse' })),
    );
    await draws('hover off', () =>
      canvas().dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: marker.clientX + 150,
          clientY: marker.clientY - 100,
          pointerId: hoverId,
          bubbles: true,
          pointerType: 'mouse',
        }),
      ),
    );
    // A marker drag, a frame at a time, then cancelled: every move draws, and the reverted rig is drawn.
    const id = (pointerId += 1);
    const before = await canvasShot();
    pointer(canvas(), 'pointerdown', marker, id);
    let moved = 0;
    for (let step = 1; step <= 4; step += 1) {
      const start = counters();
      pointer(canvas(), 'pointermove', { clientX: marker.clientX + step * 15, clientY: marker.clientY }, id);
      await ticks(2);
      if (counters().draws > start.draws) moved += 1;
    }
    expect(moved).toBe(4);
    await draws('drag cancelled', () => pointer(canvas(), 'pointercancel', marker, id));
    // The focus the press gave survives the cancel; clearing it puts the rig back as it was.
    await draws('focus cleared', () => handle.focusCheckpoint(null));
    expect(await differingShare(before, await canvasShot())).toBe(0);
    await draws('overlay off at the end', () => handle.setCheckpointOverlay(false));
  });

  test('the placement ghost draws as it follows the pointer and goes when placing is cancelled', async () => {
    await draws('overlay on for placing', () => handle.setCheckpointOverlay(true));
    const id = '01a1300a-1c00-7000-8000-00000000c003';
    expect(handle.startCheckpointPlacement({ id })).toBe(true);
    const box = canvas().getBoundingClientRect();
    const hoverId = (pointerId += 1);
    await draws('ghost', () =>
      canvas().dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: box.left + box.width * 0.5,
          clientY: box.top + box.height * 0.7,
          pointerId: hoverId,
          bubbles: true,
          pointerType: 'mouse',
        }),
      ),
    );
    await draws('ghost moved', () =>
      canvas().dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: box.left + box.width * 0.55,
          clientY: box.top + box.height * 0.7,
          pointerId: hoverId,
          bubbles: true,
          pointerType: 'mouse',
        }),
      ),
    );
    await draws('placing cancelled', () => handle.cancelCheckpointPlacement());
    await draws('overlay off after placing', () => handle.setCheckpointOverlay(false));
  });

  test('the camera preview: open, aim, card resized and relocated, aim cancelled, closed; the inset is drawn once per main frame', async () => {
    await rest('before the preview');
    const without = await canvasShot();
    await draws('overlay on for the preview', () => handle.setCheckpointOverlay(true));
    const open = counters();
    await draws('preview open', () => handle.focusCheckpoint(CAMERA_IDS[1]));
    expect(card().dataset['visible']).toBe('true');
    expect(counters().insetDraws).toBeGreaterThan(open.insetDraws);
    const windowEl = card().querySelector<HTMLElement>('.camera-preview-window')!;
    const box = windowEl.getBoundingClientRect();
    const centre = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    // Aiming, a frame at a time: each move draws the main picture and the inset over it.
    const id = (pointerId += 1);
    pointer(windowEl, 'pointerdown', centre, id);
    for (let step = 1; step <= 3; step += 1) {
      const start = counters();
      pointer(windowEl, 'pointermove', { clientX: centre.clientX + step * 10, clientY: centre.clientY }, id);
      await ticks(2);
      expect(counters().draws).toBeGreaterThan(start.draws);
      expect(counters().insetDraws).toBeGreaterThan(start.insetDraws);
    }
    await draws('aim cancelled', () => pointer(windowEl, 'pointercancel', centre, id));
    await draws('card resized', () => (card().style.width = '240px'));
    await draws('card relocated by a host box', () => root().setAttribute(BOTTOM_RIGHT_CLAIMED_ATTRIBUTE, 'true'));
    root().removeAttribute(BOTTOM_RIGHT_CLAIMED_ATTRIBUTE);
    card().style.width = '';
    await rest('card back');
    const closing = counters();
    await draws('preview closed', () => handle.focusCheckpoint(null));
    expect(card().dataset['visible']).toBe('false');
    const closed = counters();
    expect(closed.insetDraws).toBe(closing.insetDraws);
    await draws('overlay off', () => handle.setCheckpointOverlay(false));
    expect(await differingShare(without, await canvasShot())).toBe(0);
  });

  test('the asset move tool: a drag with its legality field, a nudge, a mirror and a revert each draw; the field goes', async () => {
    handle.setSelection({ kind: 'furniture', id: DEMO.asset.livingCoffeeTable });
    handle.setAssetMoveTool(true);
    await until(() => debug().assetMove().loaded, 'the asset move chunk', ASSET_MOVE_CHUNK_TIMEOUT_MS);
    await rest('the tool armed');
    const without = await canvasShot();
    const table = handle.getScene()!.assets.find((asset) => asset.id === DEMO.asset.livingCoffeeTable)!;
    const from = pixel(table.position.x, 0.3, table.position.z);
    const id = (pointerId += 1);
    pointer(canvas(), 'pointerdown', from, id);
    let drawnMoves = 0;
    for (let step = 1; step <= 4; step += 1) {
      const start = counters();
      pointer(canvas(), 'pointermove', { clientX: from.clientX + step * 4, clientY: from.clientY }, id);
      await ticks(2);
      if (counters().draws > start.draws) drawnMoves += 1;
    }
    expect(drawnMoves).toBe(4);
    expect(debug().assetMove().state?.maskCells ?? 0).toBeGreaterThan(0);
    // The release takes the field away (a mask-only change at the release pose) and the move is emitted.
    await draws('drag released', () => pointer(canvas(), 'pointerup', { clientX: from.clientX + 16, clientY: from.clientY }, id));
    expect(debug().assetMove().state?.maskCells).toBe(0);
    await draws('revert', () => handle.revertAssetEdit());
    await draws('mirror', () => expect(handle.mirrorAsset(DEMO.asset.livingCoffeeTable, 'x')).toBe(true));
    await draws('revert the mirror', () => handle.revertAssetEdit());
    await draws('nudge', () => root().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    handle.setAssetMoveTool(false);
    await draws('selection cleared', () => handle.setSelection(null));
    await rest('the tool off');
    expect(await differingShare(without, await canvasShot())).toBeLessThan(0.002);
  });

  test('lifecycle: resize, a hidden tab, a context restore, each draw once and rest', async () => {
    await draws('resize', () => (container.style.width = '440px'));
    await draws('resize back', () => (container.style.width = '480px'));
    // A pixel-ratio change alone is proved below the browser: the runtime refits its buffer
    // (`render-runtime.test.ts`, «a pixel-ratio change at a fixed CSS box») and the plan canvas
    // refits its drawing (`plan-modes.test.ts`); a headless page cannot change its own ratio.
    // A backgrounded tab parks the loop; coming back draws once.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    let parked: DemandCounters;
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await delay(300);
      parked = counters();
      await delay(300);
      // Parked: no tick, no draw while the tab is hidden.
      expect(counters().ticks).toBe(parked.ticks);
    } finally {
      delete (document as { hidden?: boolean }).hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    }
    await until(() => counters().draws > parked.draws, 'a draw when the tab is visible again', TICKS_TIMEOUT_MS);
    await verifyNothingSkipped('tab visible again');
    const lose = canvas().getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    const lost = new Promise((resolve) => {
      canvas().addEventListener('webglcontextlost', resolve, { once: true });
    });
    lose.loseContext();
    await lost;
    const atLoss = counters();
    // Nothing is drawn while the context is gone.
    await nextFrame();
    await nextFrame();
    expect(counters().draws).toBe(atLoss.draws);
    lose.restoreContext();
    await until(() => counters().draws > atLoss.draws, 'a draw after the restore', TICKS_TIMEOUT_MS);
    await verifyNothingSkipped('after the restore');
  });

  test('captures keep a pending redraw: no display draw during the capture, the redraw on the next tick', async () => {
    for (const capture of [
      () => handle.capture.still({ width: 80, height: 60, caption: false }),
      () => handle.capture.panorama({ width: 64, roomId: DEMO.room.living, caption: false }),
    ]) {
      await rest('before the capture');
      // Hold every display draw (the gate answers «no» while held): the capture
      // runs with one redraw pending and no frame that could clear it.
      let held = true;
      let commits = 0;
      const demand = demandOf();
      const gate = demand.shouldDraw.bind(demand);
      const commit = demand.commit.bind(demand);
      // Own properties over the prototype's, for this capture only.
      Object.assign(demand, {
        shouldDraw: (live: Parameters<RenderDemand['shouldDraw']>[0], mode: string | undefined) => {
          const wants = gate(live, mode);
          return held ? false : wants;
        },
        commit: (live: Parameters<RenderDemand['commit']>[0]) => {
          commits += 1;
          commit(live);
        },
      });
      try {
        demand.invalidate();
        const start = counters();
        const { blob } = await capture();
        expect(blob.size).toBeGreaterThan(0);
        // The capture rendered on its own path: no display draw, no display commit.
        expect(commits).toBe(0);
        expect(counters().draws).toBe(start.draws);
        // Released: the redraw that was pending before the capture is drawn on the next tick.
        held = false;
        await ticks(2);
        expect(counters().draws).toBeGreaterThan(start.draws);
      } finally {
        delete (demand as { shouldDraw?: unknown }).shouldDraw;
        delete (demand as { commit?: unknown }).commit;
      }
      await verifyNothingSkipped('after the capture');
    }
  });
});

describe('the editing modes from a hidden mount', { timeout: MOUNT_TIMEOUT_MS }, () => {
  afterAll(() => closeContainers());

  test('mounted hidden: ready without a draw; an edit while hidden; shown, it draws the edited scene once and rests', async () => {
    const container = openContainer(480, 320);
    container.style.display = 'none';
    const handle = mountViewer(container, {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      debug: true,
    });
    try {
      await handle.ready;
      expect(counters().draws).toBe(0);
      handle.setFurnitureVisible(false);
      await delay(500);
      expect(counters().draws).toBe(0);
      container.style.display = '';
      await until(() => counters().draws > 0, 'the first picture once shown', 60_000);
      await rest('after the reveal');
      expect(debug().furnitureRendered()).toBe(false);
    } finally {
      handle.dispose();
    }
  });
});
