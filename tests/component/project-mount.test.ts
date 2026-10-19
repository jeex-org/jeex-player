/**
 * `mountViewer` over a BAKED PROJECT, in a real browser.
 *
 * The three entrances the format has, proved end to end against the fixture
 * bake this repository carries:
 *
 *   1. `scene: { url }` on a `project.json` — a real fetch of a real folder,
 *      which is what a listing page does;
 *   2. `scene: { document, library }` — an editor host, which already holds both
 *      in memory and must not serve its own manifest back to itself;
 *   3. `scene: { document }` with no library — a bare scene, which must take
 *      exactly the path it took before the format existed.
 *
 * Only a browser can run these: `scene.url` needs a network stack, and the
 * claim that the GLB replaced the stand-in is about a WebGL scene graph.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { ViewerSelection } from '../../src/app/selection.js';
import { PROJECT_FIXTURE } from '../fixtures/project/fixture-ids.js';
import { SETTLE_FRAMES, closeContainers, demoScene, nextFrame, openContainer, until, untilCameraStill, untilFrames } from './support.js';

/** The fixture bake, served by Vite from the repository at its own path. */
const PROJECT_URL = '/tests/fixtures/project/project.json';
const PROJECT_BASE = new URL('/tests/fixtures/project/', window.location.origin).href;

/** A bank bed this file adds to the fixture scene, by fixed UUID v7. */
const LEGACY_BED_ID = '01a12ffa-de4b-77ad-a4a1-274001f2a4c5';

/** How far apart the scan's sample points are, in CSS pixels. */
const SCAN_STEP_PX = 10;

/**
 * One demo mount plus a fetch and a GLB, and frame-counted settles that run
 * at 1-2 fps on the loaded tier; the light-path default is not a budget for it.
 */
const PROJECT_TIMEOUT_MS = 180_000;

const handles: ViewerHandle[] = [];

function mount(options: Record<string, unknown>): ViewerHandle {
  const handle = mountViewer(openContainer(), { tour: { mode: 'off' }, debug: false, ...options });
  handles.push(handle);
  return handle;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

/**
 * The furniture bodies of the FIRST frame that had any, captured from a frame
 * loop started at mount time.
 *
 * It cannot be read after `await handle.ready`: over a warm cache the GLB is
 * already in by then, and the assertion would either pass or fail depending on
 * how fast the machine served a file it had in memory. The stand-in exists for
 * exactly one stretch of frames — between the build and the fetch — so the
 * only honest way to see it is to be watching while it is there.
 * `dev/project.ts` samples the same thing for `scripts/browser-check`.
 */
function firstFurnitureFrame(): Promise<ReturnType<NonNullable<Window['__viewerDebug']>['assetModels']>> {
  return new Promise((resolve) => {
    const sample = (): void => {
      const bodies = window.__viewerDebug?.assetModels() ?? [];
      if (bodies.length > 0) resolve(bodies);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

/** The fixture manifest and scene, fetched the way a host that holds them would have. */
async function fetchFixture(): Promise<{ manifest: unknown; scene: unknown }> {
  const manifest = (await (await fetch(PROJECT_URL)).json()) as { scene: string };
  const scene = (await (await fetch(new URL(manifest.scene, PROJECT_BASE).href)).json()) as unknown;
  return { manifest, scene };
}

describe('a baked project by url', () => {
  test(
    'mounts, reports its manifest, and swaps the GLB in over the stand-in',
    async () => {
      const handle = mount({ scene: { url: PROJECT_URL } });
      // Armed BEFORE the first frame: the stand-in is on screen only between
      // the build and the fetch that replaces it.
      const firstFrame = firstFurnitureFrame();
      await handle.ready;

      const project = handle.project();
      expect(project).not.toBeNull();
      expect(project!.manifest.projectId).toBe(PROJECT_FIXTURE.projectId);
      expect(project!.manifest.library.id).toBe(PROJECT_FIXTURE.projectId);
      expect(project!.baseUrl).toBe(PROJECT_BASE);
      // The document came from the manifest's `scene`, not from anywhere else.
      expect(handle.getScene()?.assetLibrary).toBe(PROJECT_FIXTURE.projectId);

      // The FIRST frame is the stand-in: a project object has no builder, and
      // `ready` means "drawn", with no network in it.
      const drawn = await firstFrame;
      expect(drawn).toEqual([
        expect.objectContaining({ id: PROJECT_FIXTURE.placement.sofa, state: 'procedural', degraded: 'pending-model' }),
      ]);
      expect(drawn[0]!.triangles).toBeGreaterThan(0);

      const bodies = () => window.__viewerDebug!.assetModels();
      await until(() => bodies()[0]?.state === 'gltf', 'the GLB to replace the stand-in');
      const swapped = bodies()[0]!;
      expect(swapped.degraded).toBeUndefined();
      expect(swapped.triangles).toBeGreaterThan(0);
    },
    PROJECT_TIMEOUT_MS,
  );
});

/**
 * Every point of the canvas, on a coarse grid, until one of them names a
 * furniture placement. A scan rather than one computed point: the fixture's
 * presentation camera decides where the sofa lands, and a test that hard-codes
 * that pixel breaks on a camera change instead of on the behaviour it guards.
 */
async function scanForFurniture(canvas: HTMLCanvasElement, seen: ViewerSelection[]): Promise<ViewerSelection | null> {
  const box = canvas.getBoundingClientRect();
  let id = 4000;
  for (let y = box.top; y < box.bottom; y += SCAN_STEP_PX) {
    for (let x = box.left; x < box.right; x += SCAN_STEP_PX) {
      seen.length = 0;
      const pointerId = (id += 1);
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, pointerId, bubbles: true }));
      const hit = seen.find((selection) => selection.kind === 'furniture');
      if (hit) return hit;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  return null;
}

/**
 * A click on a placement whose GLB has arrived.
 *
 * The regression this pins: `upgradeModels` swapped the body
 * inside the group and told nobody, so the pick registries kept the DETACHED
 * stand-in and the GLB's own meshes were in no registry and carried no
 * `surface`/`assetId`. Every ray through the model went on to the floor behind
 * it, and a host editor could not select a single piece of catalogue furniture. Only
 * a browser can see it: it is a raycast against a real scene graph after a real
 * fetch.
 */
describe('picking an upgraded body', () => {
  test(
    'a click on the GLB names its placement, not the floor behind it',
    async () => {
      const handle = mount({ scene: { url: PROJECT_URL }, select: true });
      const seen: ViewerSelection[] = [];
      handle.on('select', (selection) => seen.push(selection));
      await handle.ready;
      await until(() => window.__viewerDebug!.assetModels()[0]?.state === 'gltf', 'the GLB to replace the stand-in');

      const canvas = document.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
      expect(canvas).not.toBeNull();
      // The swap reaches the pick only once a render has placed the GLB's
      // meshes (their world matrices) under a camera that has stopped easing.
      await untilCameraStill('the camera to settle over the upgraded model');
      await nextFrame();
      const hit = await scanForFurniture(canvas!, seen);
      expect(hit?.id).toBe(PROJECT_FIXTURE.placement.sofa);

      // That the answer comes from the body ON SCREEN and not from the
      // detached stand-in: taking the furniture off screen takes it out of the
      // pick too. A ghost left in the registry survives this, which is what
      // made the regression answer with a silhouette nobody could see.
      // Off screen means the ripple has finished and the group left the scene
      // graph: the hide is an animation on the frame clock, and on a loaded
      // SwiftShader (the component tier's four files at once) a scan right after
      // the call would run while the sofa is still mid-ripple and still,
      // correctly, pickable.
      handle.setFurnitureVisible(false);
      await untilFrames(
        () => window.__viewerDebug!.furnitureRendered() === false,
        'exit of the furniture from the scene graph',
        SETTLE_FRAMES,
      );
      expect(await scanForFurniture(canvas!, seen)).toBeNull();
    },
    PROJECT_TIMEOUT_MS,
  );
});

describe('a baked project a host already holds', () => {
  test(
    'reads the library from `scene.library` beside an in-memory document',
    async () => {
      const { manifest, scene } = await fetchFixture();
      // Not one request for `project.json` from the viewer: the host has it.
      const handle = mount({ scene: { document: scene, library: { manifest, baseUrl: PROJECT_BASE } } });
      await handle.ready;

      expect(handle.project()?.manifest.library.id).toBe(PROJECT_FIXTURE.projectId);
      expect(handle.getScene()?.assetLibrary).toBe(PROJECT_FIXTURE.projectId);
      await until(() => window.__viewerDebug!.assetModels()[0]?.state === 'gltf', 'the GLB to replace the stand-in');
    },
    PROJECT_TIMEOUT_MS,
  );

  test(
    'draws a legacy `type` placement from the shipped bank instead of degrading it',
    async () => {
      // A host editor's templates may still hold `type`-only demo objects no
      // exporter rewrote, and a project library that REPLACED the bank turned
      // every one of them into an `unknown-asset` placeholder. Two entrances,
      // one validator, and the shipped bank stays behind the project library.
      const { manifest, scene } = await fetchFixture();
      const mixed = scene as { assets: unknown[] };
      mixed.assets = [
        ...mixed.assets,
        { id: LEGACY_BED_ID, type: 'bed', room: PROJECT_FIXTURE.room.bedroom, position: { x: 6, y: 0, z: 1.5 }, rotationY: 0 },
      ];
      const handle = mount({ scene: { document: mixed, library: { manifest, baseUrl: PROJECT_BASE } } });
      await handle.ready;

      const bodies = window.__viewerDebug!.assetModels();
      expect(bodies.map((body) => body.id).sort()).toEqual([LEGACY_BED_ID, PROJECT_FIXTURE.placement.sofa].sort());
      expect(bodies.filter((body) => body.degraded === 'unknown-asset')).toEqual([]);
      // The bank entry keeps the procedural body it has always had: its GLB
      // path belongs to a library with no `baseUrl`, not to the bake's folder.
      const bed = bodies.find((body) => body.id === LEGACY_BED_ID)!;
      expect({ state: bed.state, degraded: bed.degraded }).toEqual({ state: 'procedural', degraded: undefined });
      expect(bed.triangles).toBeGreaterThan(0);
    },
    PROJECT_TIMEOUT_MS,
  );

  test(
    'a manifest that is not one fails the mount rather than being half-read',
    async () => {
      const { scene } = await fetchFixture();
      const handle = mount({
        scene: { document: scene, library: { manifest: { format: 'jeex-project', formatVersion: 3 }, baseUrl: PROJECT_BASE } },
      });
      await expect(handle.ready).rejects.toThrow(/formatVersion|project/i);
    },
    PROJECT_TIMEOUT_MS,
  );
});

describe('a bare scene', () => {
  test(
    'keeps the path it had before the format: no project, shipped catalogue, built bodies',
    async () => {
      const handle = mount({ scene: { document: demoScene() } });
      await handle.ready;
      expect(handle.project()).toBeNull();
      expect(handle.getScene()?.assetLibrary).toBeUndefined();
      // Procedural bodies, and not one of them a `pending-model` stand-in.
      const bodies = window.__viewerDebug!.assetModels();
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies.filter((body) => body.degraded !== undefined)).toEqual([]);
    },
    PROJECT_TIMEOUT_MS,
  );
});
