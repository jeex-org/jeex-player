/**
 * The walk, driven by the keyboard, on a mounted viewer.
 *
 * The pieces are proved one by one below this tier: `camera-input.test.ts`
 * turns a `keydown` on the key target into a key gesture, `walk-rig.test.ts`
 * turns a held key into a step, `camera-controller.test.ts` binds the
 * listeners. What none of them can show is the chain on a real page: a real
 * `KeyboardEvent` reaching the viewer root moves the real camera, at eye
 * height, and a `keyup` stops it (the e2e tier keeps only the key ISOLATION between two viewers, `embed-two.spec.ts`,
 * because a whole-page keyboard tour costs the one software GPU far more than
 * this mount does).
 *
 * `debug: true` for `__viewerDebug.camera()`, the pose the browser check
 * reads; one viewer per test, because the debug globals are one per page.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { EYE_HEIGHT_M } from '../../src/navigation/navigation.js';
import { SETTLE_FRAMES, closeContainers, delay, demoScene, nextFrame, openContainer, untilCameraStill, untilFrames } from './support.js';

/** A demo-apartment mount on SwiftShader, two frame-counted settles and a second of walking, at the loaded tier's 1-2 fps. */
const WALK_TIMEOUT_MS = 240_000;

const handles: ViewerHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

type Pose = { x: number; y: number; z: number };

function pose(): Pose {
  const camera = window.__viewerDebug?.camera() ?? null;
  if (camera === null) throw new Error('the debug surface has no camera');
  return camera;
}

function distance(a: Pose, b: Pose): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function key(root: Element, type: 'keydown' | 'keyup', name: string): void {
  root.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true }));
}

describe('walking with the keyboard', () => {
  test(
    'a held W moves the camera at eye height, and letting go stops it',
    async () => {
      const handle = mountViewer(openContainer(), {
        scene: { repository: new InlineSceneRepository(demoScene()) },
        tour: { mode: 'off' },
        view: { mode: 'walk' },
        debug: true,
      });
      handles.push(handle);
      await handle.ready;
      const start = await untilCameraStill('the walk entry to settle');
      expect(start.y).toBeCloseTo(EYE_HEIGHT_M, 2);

      key(handle.element, 'keydown', 'w');
      await untilFrames(() => distance(pose(), start) > 0.05, 'movement from a held W', SETTLE_FRAMES);
      await delay(200);
      key(handle.element, 'keyup', 'w');

      const stopped = await untilCameraStill('the walk to stop after the key is released');
      expect(distance(stopped, start)).toBeGreaterThan(0.05);
      expect(stopped.y).toBeCloseTo(EYE_HEIGHT_M, 2);
      // Stopped means stopped: more frames, no more movement.
      for (let frame = 0; frame < 10; frame += 1) await nextFrame();
      expect(distance(pose(), stopped)).toBeLessThan(1e-6);
    },
    WALK_TIMEOUT_MS,
  );
});
