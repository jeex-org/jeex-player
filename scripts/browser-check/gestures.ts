/**
 * Input direction, measured rather than argued about: every 360 gesture and
 * every walk drag must move the picture the way the fingers moved.
 */

import type { CheckContext } from './context.js';
import type { GestureMotion } from './gestures-probe.js';

/** 360 and walk input directions, measured through projection. */
export async function checkGestures(ctx: CheckContext): Promise<void> {
  const { assert, summary } = ctx;
  const { GESTURE_CASES, WALK_GESTURE_CASES, gestureMotion, gestureVerdict, walkGestureMotion, walkGestureVerdict } = ctx.gestures;
  // ---- 360 input direction: every gesture moves the scene with the fingers ----
  // The trackpad bug this guards against was invisible to
  // every state-only assertion: the camera moved, it just moved the wrong way.
  // Run on the plain page, before the error sweep, so a gesture that throws is
  // caught by it too.
  const gestureMotions = new Map<string, GestureMotion>();
  for (const item of GESTURE_CASES) {
    const motionResult = await gestureMotion(item.dispatch);
    gestureMotions.set(item.name, motionResult);
    const verdict = gestureVerdict(motionResult, item.expect);
    console.log(`  gesture ${item.name}: ${verdict.line}`);
    assert(verdict.ok, `${item.name} must follow the fingers | ${verdict.line}`);
  }
  summary.push(`360 input direction: ${GESTURE_CASES.length} gestures measured, all move the scene with the fingers`);

  // ---- Two-pointer touch pan gain: the centroid, not once per finger ----
  // Guards against two fingers moving together panning ~2x a one-pointer drag
  // of the same travel (each pointer's own pointermove applying the full
  // dx/dy). The pan follows the centroid, so the two-pointer pan must land
  // within 15% of the equivalent shift-drag pan, on both axes.
  {
    const shiftRight = gestureMotions.get('shift-drag right 120 px (pan)')!;
    const twoRight = gestureMotions.get('two-pointer drag right 120 px (touch pan)')!;
    const shiftDown = gestureMotions.get('shift-drag down 120 px (pan)')!;
    const twoDown = gestureMotions.get('two-pointer drag down 120 px (touch pan)')!;
    const ratioX = twoRight.cx / shiftRight.cx;
    const ratioY = twoDown.cy / shiftDown.cy;
    console.log(
      `  two-pointer pan gain: right ${twoRight.cx.toFixed(1)} px vs shift-drag ${shiftRight.cx.toFixed(1)} px ` +
        `(ratio ${ratioX.toFixed(2)}), down ${twoDown.cy.toFixed(1)} px vs shift-drag ${shiftDown.cy.toFixed(1)} px (ratio ${ratioY.toFixed(2)})`,
    );
    assert(Math.abs(ratioX - 1) < 0.15, `two-pointer pan right must land within 15% of a shift-drag | ratio ${ratioX.toFixed(2)}`);
    assert(Math.abs(ratioY - 1) < 0.15, `two-pointer pan down must land within 15% of a shift-drag | ratio ${ratioY.toFixed(2)}`);
    summary.push(
      `two-pointer touch pan gain: right ${(ratioX * 100).toFixed(0)}%, down ${(ratioY * 100).toFixed(0)}% of a one-pointer shift-drag`,
    );
  }

  // ---- Walk input direction: the drag-look follows the fingers too ----
  // The 360 fix left walk mode's first-person convention alone on purpose;
  // the user reported it was still inverted, so the same rule now applies
  // here: dragging must move the picture WITH the pointer on both axes.
  for (const item of WALK_GESTURE_CASES) {
    const verdict = walkGestureVerdict(item.name, await walkGestureMotion(item.dx, item.dy, item.options), item.expect);
    console.log(`  gesture ${verdict.line}`);
    assert(verdict.ok, `${item.name} must follow the fingers | ${verdict.line}`);
  }
  summary.push(
    `walk input direction: ${WALK_GESTURE_CASES.length} look, move and wheel gestures measured, all move the picture with the fingers`,
  );
  // Leaves the camera in walk mode; the runner reopens the plain page and
  // resets before the review screenshot.
}
