/**
 * Walk and tour draw on demand (`src/render/render-demand.ts`), in a real
 * browser on the demo apartment: a resting view keeps ticking while its
 * display draws stay flat and the compositor keeps the last picture, and
 * every kind of visible change draws.
 *
 * Every wait is on the viewer's own tick counter (`__viewerDebug.renderDemand`),
 * never on the wall clock: at one or two frames a second a motion lasts the
 * same number of ticks and any number of seconds.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import type * as THREE from 'three';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { RenderDemand, type DemandCounters } from '../../src/render/render-demand.js';
import { WalkLighting } from '../../src/render/walk-post.js';
import { closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

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
  return { ticks: end.ticks - start.ticks, draws: end.draws - start.draws };
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

/** The compositor's picture of the page, as PNG base64. */
async function shot(): Promise<string> {
  return page.screenshot({ save: false });
}

describe('walk and tour draw on demand', { timeout: MOUNT_TIMEOUT_MS }, () => {
  let handle: ViewerHandle;
  let container: HTMLElement;
  let camera: THREE.Camera | null = null;

  beforeAll(async () => {
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

  test('editing modes keep drawing every tick; plan2d keeps only its heartbeat', async () => {
    handle.setMode('orbit');
    await ticks(5);
    const orbit = await ticks(20);
    expect(orbit.draws).toBe(orbit.ticks);
    handle.setMode('plan2d');
    await ticks(5);
    const plan = await ticks(20);
    expect(plan.draws).toBeLessThan(plan.ticks);
    handle.setMode('walk');
    await rest('back in walk');
  });
});
