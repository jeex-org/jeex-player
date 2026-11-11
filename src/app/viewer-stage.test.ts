/**
 * The one part of `ViewerStage` that can be pinned without a renderer: the
 * ORDER its frame hooks run in.
 *
 * It matters, so it is pinned here rather than left implicit in `start()`.
 * Everything the application's hooks do (the
 * dollhouse fade, the door automation, the HUD anchor, the mini-map marker)
 * reads the pose of the frame about to be drawn, so a hook that runs before the
 * camera has been advanced is one frame of lag on all of it (the ordering
 * guarantee).
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { anchorCamera, bindStageFrame, orderFrameHooks, type StageAuthoringHooks } from './viewer-stage.js';
import { projectToViewport } from '../render/viewport-projection.js';
import type { FrameHook } from '../render/render-runtime.js';

describe('orderFrameHooks', () => {
  test('the camera and tour hook runs before every application hook', () => {
    const seen: string[] = [];
    const camera: FrameHook = () => seen.push('camera');
    const app: FrameHook[] = [() => seen.push('app-1'), () => seen.push('app-2')];
    for (const hook of orderFrameHooks(camera, app)) hook(0.016, 1000);
    expect(seen).toEqual(['camera', 'app-1', 'app-2']);
  });

  test('the application hooks keep the order they were given in', () => {
    const camera: FrameHook = () => undefined;
    const first: FrameHook = () => undefined;
    const second: FrameHook = () => undefined;
    expect(orderFrameHooks(camera, [first, second])).toEqual([camera, first, second]);
  });

  test('a mount with no application hooks still runs the camera', () => {
    const camera: FrameHook = () => undefined;
    expect(orderFrameHooks(camera, [])).toEqual([camera]);
  });
});

/** A runtime that records its hooks and runs one tick: the frame hooks, the draw, the post-render hooks. */
function recordingRuntime(seen: string[]): {
  addFrameHook: (hook: FrameHook) => void;
  addPostRenderHook: (hook: FrameHook) => void;
  tick: () => void;
} {
  const frame: FrameHook[] = [];
  const post: FrameHook[] = [];
  return {
    addFrameHook: (hook) => frame.push(hook),
    addPostRenderHook: (hook) => post.push(hook),
    tick: () => {
      for (const hook of frame) hook(0.016, 1000);
      seen.push('draw');
      for (const hook of post) hook(0.016, 1000);
    },
  };
}

describe('bindStageFrame', () => {
  test('the authoring hooks run after the camera update, before the tour, at the frame end and after the draw', () => {
    const seen: string[] = [];
    const runtime = recordingRuntime(seen);
    const authoring: StageAuthoringHooks = {
      afterCamera: () => seen.push('afterCamera'),
      frameEnd: () => seen.push('frameEnd'),
      postRender: () => seen.push('postRender'),
      document: () => seen.push('document'),
    };
    bindStageFrame(runtime, { camera: () => seen.push('camera'), tour: () => seen.push('tour'), authoring: () => authoring }, [
      () => seen.push('app-1'),
      () => seen.push('app-2'),
    ]);
    runtime.tick();
    expect(seen).toEqual(['camera', 'afterCamera', 'tour', 'app-1', 'app-2', 'frameEnd', 'draw', 'postRender']);
  });

  test('without authoring hooks the frame runs the same steps around the missing ones', () => {
    const seen: string[] = [];
    const runtime = recordingRuntime(seen);
    bindStageFrame(runtime, { camera: () => seen.push('camera'), tour: () => seen.push('tour'), authoring: () => null }, [
      () => seen.push('app'),
    ]);
    runtime.tick();
    expect(seen).toEqual(['camera', 'tour', 'app', 'draw']);
  });
});

describe('anchorCamera', () => {
  // A sofa's top, seen from an orbit pose low and to the side, and from the
  // plan's top view straight above: the two put it in different pixels.
  const point = new THREE.Vector3(2, 0.9, 1);
  const viewport = { width: 800, height: 600 };

  function rig(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.05, 200);
    camera.position.set(-6, 3, 6);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
  }

  function top(): THREE.OrthographicCamera {
    const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 100);
    camera.position.set(0, 30, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
  }

  test('plan3d projects through the top view, so the anchor sits where the plan draws the object', () => {
    const view = top();
    const camera = anchorCamera({ pickCamera: () => view }, rig());
    const projected = projectToViewport(camera, point, viewport);
    const expected = projectToViewport(view, point, viewport);
    expect(camera).toBe(view);
    expect(projected).toEqual(expected);
    // The top view puts +X right of the centre and +Z below it.
    expect(projected!.x).toBeGreaterThan(400);
    expect(projected!.y).toBeGreaterThan(300);
  });

  test('a mode without a plan camera keeps the perspective rig', () => {
    const perspective = rig();
    expect(anchorCamera({ pickCamera: () => undefined }, perspective)).toBe(perspective);
  });
});
