/**
 * The cached sun shadow through the motions that need the demo apartment or a
 * baked project: a drag past the facade and its refusal, a revert, an
 * interior preset swap, the furniture ripple's final frame, and a model
 * upgrade swap. Each reads the redraw count and the fitted frustum through
 * `__viewerDebug.sunShadow`.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { DEMO } from '../../src/demo/demo-ids.js';
import type { ShadowFit } from '../../src/lighting/shadow-fit.js';
import type { SunShadowState } from '../../src/render/sun-shadow.js';
import { ASSET_MOVE_CHUNK_TIMEOUT_MS, closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

type Debug = {
  mode: () => string | undefined;
  sunShadow: () => SunShadowState | null;
  selectionPoint: (x: number, z: number) => { x: number; y: number } | null;
  assetMove: () => { loaded: boolean; state: { pending: string | null } | null };
  presets: () => Array<{ id: string; active: boolean }>;
  applyPreset: (id: string) => { error?: unknown };
  furnitureRendered: () => boolean | null;
  assetModels: () => Array<{ state: string }>;
};

function debug(): Debug {
  return (window as unknown as { __viewerDebug: Debug }).__viewerDebug;
}

const handles: ViewerHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

/** Mount, wait for the first scene and for the tool chunk, and four renders of the demo apartment. */
const DEMO_TIMEOUT_MS = 120_000;
/** A baked project's GLB arrives over the network after the first frame. */
const PROJECT_TIMEOUT_MS = 180_000;

async function frames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await nextFrame();
}

const draws = (): number => debug().sunShadow()?.draws ?? -1;
const fit = (): ShadowFit => debug().sunShadow()!.fit!;
const width = (shadow: ShadowFit): number => (shadow.right - shadow.left) * (shadow.top - shadow.bottom);

/** Waits until the redraw count has held still for 20 frames, and answers it. */
async function settle(): Promise<number> {
  let last = draws();
  let still = 0;
  for (let frame = 0; frame < 900 && still < 20; frame += 1) {
    await nextFrame();
    const now = draws();
    still = now === last ? still + 1 : 0;
    last = now;
  }
  return last;
}

async function mountDemo(mode: 'orbit' | 'plan3d'): Promise<{ handle: ViewerHandle; canvas: HTMLCanvasElement }> {
  const container = openContainer();
  const handle = mountViewer(container, {
    scene: { repository: new InlineSceneRepository(demoScene()) },
    tour: { mode: 'off' },
    debug: true,
  });
  handles.push(handle);
  await handle.ready;
  handle.setMode(mode);
  await until(() => debug().mode() === mode, mode);
  const canvas = container.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
  if (!canvas) throw new Error('no scene canvas');
  await settle();
  return { handle, canvas };
}

let pointerId = 7000;

/** Presses on `from`, moves in eight steps to `to` and holds there; `release` lets go. */
function press(canvas: HTMLCanvasElement, from: { x: number; y: number }, to: { x: number; y: number }): () => void {
  const box = canvas.getBoundingClientRect();
  const id = (pointerId += 1);
  const at = (point: { x: number; y: number }) => ({
    clientX: box.left + point.x,
    clientY: box.top + point.y,
    button: 0,
    pointerId: id,
    bubbles: true,
  });
  canvas.dispatchEvent(new PointerEvent('pointerdown', at(from)));
  for (let step = 1; step <= 8; step += 1) {
    const k = step / 8;
    canvas.dispatchEvent(new PointerEvent('pointermove', at({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k })));
  }
  return () => canvas.dispatchEvent(new PointerEvent('pointerup', at(to)));
}

function pixel(x: number, z: number): { x: number; y: number } {
  const point = debug().selectionPoint(x, z);
  if (!point) throw new Error(`(${x}, ${z}) is not on screen`);
  return point;
}

describe('the sun shadow follows motion', { timeout: DEMO_TIMEOUT_MS }, () => {
  async function armedOnBed(): Promise<{ handle: ViewerHandle; canvas: HTMLCanvasElement; home: { x: number; z: number } }> {
    const { handle, canvas } = await mountDemo('plan3d');
    handle.setSelection({ kind: 'furniture', id: DEMO.asset.bedroomBed });
    handle.setAssetMoveTool(true);
    await until(() => debug().assetMove().loaded, 'the asset move chunk', ASSET_MOVE_CHUNK_TIMEOUT_MS);
    await settle();
    const home = demoScene().assets.find((asset) => asset.id === DEMO.asset.bedroomBed)!.position;
    return { handle, canvas, home };
  }

  test('a drag past the facade grows the frustum while it lasts; the refusal fits the apartment again', async () => {
    const { canvas, home } = await armedOnBed();
    const before = fit();
    const drawsBefore = draws();
    const release = press(canvas, pixel(home.x, home.z), pixel(home.x + 7, home.z));
    await frames(5);
    const during = fit();
    const drawsDuring = draws();
    release();
    await settle();
    expect(width(during)).toBeGreaterThan(width(before));
    expect(drawsDuring).toBeGreaterThan(drawsBefore);
    expect(fit()).toEqual(before);
    expect(debug().assetMove().state?.pending).toBeNull();
  });

  test('a legal drag redraws the moved bed, and revertAssetEdit puts the fit and the shadow back', async () => {
    const { handle, canvas, home } = await armedOnBed();
    const before = fit();
    press(canvas, pixel(home.x, home.z), pixel(home.x - 0.4, home.z))();
    const moved = await settle();
    expect(debug().assetMove().state?.pending).toBe(DEMO.asset.bedroomBed);
    handle.revertAssetEdit();
    const reverted = await settle();
    expect(reverted).toBeGreaterThan(moved);
    expect(fit()).toEqual(before);
  });

  test('an interior preset swap redraws through the swap animation and stops', async () => {
    await mountDemo('orbit');
    const target = debug()
      .presets()
      .find((preset) => !preset.active)!;
    const before = draws();
    expect(debug().applyPreset(target.id).error).toBeUndefined();
    await frames(5);
    expect(draws()).toBeGreaterThan(before);
    const after = await settle();
    await frames(30);
    expect(draws()).toBe(after);
  });

  test('the furniture ripple draws its final frame, once, and then nothing', async () => {
    const { handle } = await mountDemo('orbit');
    const before = draws();
    handle.setFurnitureVisible(false);
    await until(() => debug().furnitureRendered() === false, 'the ripple to end', 30_000);
    const atEnd = draws();
    expect(atEnd).toBeGreaterThan(before);
    const settled = await settle();
    expect(settled - atEnd).toBeLessThanOrEqual(1);
    await frames(30);
    expect(draws()).toBe(settled);
  });
});

describe('a model upgrade swap', () => {
  test(
    'redraws the shadow when the GLB replaces the stand-in',
    async () => {
      const handle = mountViewer(openContainer(), { scene: { url: '/tests/fixtures/project/project.json' }, tour: { mode: 'off' } });
      handles.push(handle);
      // The shadow draws while the stand-in is still on screen; `ready` follows the
      // first picture, which waits for the shaders, so the GLB may land before it.
      let atStandIn = -1;
      await until(
        () => {
          const models = window.__viewerDebug?.assetModels() ?? [];
          if (models[0]?.state === 'gltf') return true;
          if (window.__viewerDebug) atStandIn = draws();
          return false;
        },
        'the GLB to replace the stand-in',
        PROJECT_TIMEOUT_MS,
      );
      await handle.ready;
      const settled = await settle();
      expect(settled).toBeGreaterThan(atStandIn);
      expect(debug().sunShadow()!.fit).not.toBeNull();
    },
    PROJECT_TIMEOUT_MS,
  );
});
