/**
 * What a mounted viewer does on every frame, and in what ORDER.
 *
 * The ordering is the content of this module, and it is policy rather than
 * wiring, which is why it left the composition root: the dollhouse fade and
 * the furniture animation run first, the doors and the mini-map read the pose
 * of the frame that is about to be drawn, and the selection glows go last
 * because they are decoration over everything else.
 *
 * `ViewerStage` puts the CAMERA hook in front of all of these
 * (`viewer-stage.orderFrameHooks`); nothing here may assume anything about the
 * camera except that it has already moved.
 */

import type { Dollhouse } from '../geometry/dollhouse.js';
import type { DoorController } from './door-controller.js';
import type { FrameHook } from '../render/render-runtime.js';
import type { FurnitureAnimator } from '../geometry/furniture-animator.js';
import type { SceneMount } from './scene-mount.js';
import type { SlotAnchor } from './slot-anchor.js';
import type { ViewerStage } from './viewer-stage.js';

/** Everything the per-frame work reads; all of it late-bound. */
type FrameHookDeps = {
  /** `undefined` between `teardown()` and the next boot. */
  stage: () => ViewerStage | undefined;
  dollhouse: Dollhouse;
  animator: FurnitureAnimator;
  doors: DoorController;
  mount: SceneMount;
  anchor: SlotAnchor;
};

/** The hooks a mounted viewer runs, in the order they must run in. */
export function frameHooksFor(deps: FrameHookDeps): readonly FrameHook[] {
  /** Whether the furniture moved on the previous frame: the first still frame after motion settles the sun. */
  let furnitureWasMoving = false;
  return [
    (_delta, now) => {
      const stage = deps.stage();
      deps.dollhouse.update(stage?.camera);
      deps.animator.update(now);
      // After the camera hook: the tour's auto-open and the HUD anchor both
      // read the pose of the frame that is about to be drawn.
      deps.doors.update(now);
      // After both animations: what they moved this frame is what the cached
      // sun shadow must redraw (`render/sun-shadow.ts`); drained every frame.
      const doorsMoved = deps.doors.takeMoved();
      const furnitureMoved = deps.animator.takeMoved();
      // A model upgrade swapped bodies since the last frame: one refit for all of them.
      deps.mount.flushSunRefit();
      const sun = deps.mount.sunShadow;
      if (sun && doorsMoved) sun.markDirty();
      for (const group of furnitureMoved) sun?.include(group);
      if (furnitureWasMoving && furnitureMoved.length === 0) sun?.settle();
      furnitureWasMoving = furnitureMoved.length > 0;
      // The map follows whatever the mode ended up being — a button, a room
      // focus or a manual grab mid-tour all land here on the next frame.
      stage?.syncMinimap();
      // After the camera hook, like the door HUD above it: the anchor reads the
      // pose of the frame that is about to be drawn, and the document root the
      // mount currently holds (`slot-anchor.ts` caches its walk against it).
      // `hasTarget` first, because building the scene MEASURES the viewport —
      // a layout read a mount with no anchor must not pay for every frame.
      if (deps.anchor.hasTarget()) deps.anchor.update(stage ? stage.anchorScene(deps.mount.sceneRoot) : null);
    },
    (_delta, now) => {
      deps.mount.editor?.updateGlows(now);
      // Decoration over everything else, like the glows above it: the
      // selection tint fades in and out rather than popping.
      deps.stage()?.selection.update(now);
    },
  ];
}
