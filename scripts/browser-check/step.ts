/**
 * A named unit inside one area of the check, and the two ways to wait.
 *
 * An area is a list of steps, printed as it runs, and a failure names the
 * step, so a reader never has to count commands in the transcript to find
 * where an area of twenty to forty sequential commands stopped.
 *
 * The other half: 48 hard-coded `run(['wait', N])` across ten files, 17
 * distinct magic durations, each one a flake on a loaded machine and dead time
 * on a fast one. `waitFor` replaces every one that has an observable
 * predicate; `settle` is what the residue is spelled with, and it takes a
 * NAMED constant with a comment saying what physical duration it covers.
 *
 * Both are measured on the VIEWER'S clock, not only on the wall clock.
 * Everything the check waits for — a flight landing, a walk
 * arriving, a tour moving — advances by the frame step the render loop hands
 * its hooks, capped at `MAX_FRAME_DELTA`; on a renderer that draws one frame a
 * second (a machine without a usable GPU: SwiftShader, 1.1-1.4 fps) eight wall seconds
 * are 0.4 s of the viewer's time, and every budget written as «8 s» failed a
 * viewer that was doing exactly what it should. A budget is therefore spent on
 * a page-side frame clock that adds the same capped step per rendered frame.
 * On a machine that renders at speed the two clocks agree and every number
 * means what it always meant; the wall clock stays as a hang guard.
 */

import { MAX_FRAME_DELTA } from '../../src/render/render-runtime.js';
import type { Session } from './session.js';

/**
 * One named unit of an area.
 *
 * `run` closes over the area's own locals — a step that picks a door hands it
 * to the step that opens it — which is why an area builds its list inline
 * rather than exporting one.
 */
export type Step = { name: string; run: () => Promise<void> };

/**
 * Runs the steps in order, printing each as it starts and naming it if it
 * fails.
 *
 * The indent is one level deeper than the runner's area line, so a transcript
 * reads as area → step without any other decoration.
 */
export async function runSteps(steps: Step[]): Promise<void> {
  for (const step of steps) {
    console.log(`     · ${step.name}`);
    try {
      await step.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`step "${step.name}": ${message}`, { cause: error });
    }
  }
}

/**
 * The longest any one wait may take on the wall clock, milliseconds.
 *
 * Not a budget — those are on the frame clock — but the point at which a page
 * that stopped rendering altogether is reported instead of waited on. Ten
 * minutes is a twenty-second budget at 0.7 fps.
 */
export const WALL_CAP_MS = 600_000;

/**
 * The page-side frame clock, installed once per document on first use: seconds
 * of viewer time (the capped step per rendered frame) and the frame count.
 */
export const FRAME_CLOCK = `(window.__jeexClock ??= (() => {
  const clock = { seconds: 0, frames: 0 };
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    clock.seconds += Math.min(${MAX_FRAME_DELTA}, (now - last) / 1000);
    last = now;
    clock.frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return clock;
})())`;

let waitSerial = 0;

/**
 * Polls `expression` until it holds or `budgetMs` of the frame clock have
 * passed since the first poll; answers whether it held.
 *
 * The outcome is recorded in the page, so a predicate with side effects (the
 * camera-still counter) is never evaluated again just to learn the answer.
 */
async function waitOnFrameClock(session: Session, expression: string, budgetMs: number): Promise<boolean> {
  waitSerial += 1;
  const id = `${Date.now()}-${waitSerial}`;
  const probe = `(() => {
    const clock = ${FRAME_CLOCK};
    let w = window.__jeexWait;
    if (!w || w.id !== '${id}') w = window.__jeexWait = { id: '${id}', start: clock.seconds, outcome: null };
    if (w.outcome) return true;
    if (${expression}) { w.outcome = 'met'; return true; }
    if (clock.seconds - w.start >= ${budgetMs / 1000}) { w.outcome = 'expired'; return true; }
    return false;
  })()`;
  await session.run(['wait', '--fn', probe, '--timeout', String(WALL_CAP_MS)]);
  const outcome = await session.evalValue<string>(`window.__jeexWait?.id === '${id}' ? window.__jeexWait.outcome : 'lost'`);
  return outcome === 'met';
}

/**
 * Waits until a page-side expression is true.
 *
 * This is the DEFAULT way to wait. `agent-browser wait --fn` polls the
 * expression in the page, so the step costs exactly as long as the thing it is
 * waiting for — no more on a fast machine, and no false failure on a slow one.
 * `timeoutMs` is spent on the frame clock (module comment).
 *
 * `what` is not decoration: a `--fn` timeout is reported with the EXPRESSION,
 * and an expression is a poor description of the state that never arrived.
 */
export async function waitFor(session: Session, expression: string, what: string, timeoutMs = PREDICATE_TIMEOUT_MS): Promise<void> {
  let met = false;
  try {
    met = await waitOnFrameClock(session, expression, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`timed out after ${WALL_CAP_MS} ms of wall clock waiting for ${what}\n${message}`, { cause: error });
  }
  if (!met) throw new Error(`timed out after ${timeoutMs} ms of the viewer's clock waiting for ${what}\n${expression}`);
}

/** How long a predicate may go unmet before the step is a failure, ms of the viewer's clock. */
export const PREDICATE_TIMEOUT_MS = 8000;

/** A pose is "the same pose" below this, metres. */
const CAMERA_STILL_EPS_M = 0.002;
/** Consecutive RENDERED FRAMES at the same pose before the camera counts as at rest. */
const CAMERA_STILL_SAMPLES = 3;

/**
 * The camera has stopped moving.
 *
 * This is the predicate most of the converted hard waits become: almost every
 * `wait N` in the check was standing in for "the flight the click started has
 * landed". It samples the pose once per rendered frame and needs three
 * consecutive matches, so a camera that is merely slow does not read as one at
 * rest. Per FRAME, not per poll: at 1 fps several polls land inside one frame
 * and would see one pose three times.
 *
 * The counter is reset before the wait rather than at the end of the previous
 * one: a stale one from an earlier step would satisfy the first poll and the
 * step would race the flight it is waiting for.
 */
export async function waitForCameraStill(session: Session, what: string, timeoutMs = PREDICATE_TIMEOUT_MS): Promise<void> {
  await session.run(['eval', '(() => { delete window.__jeexCamStill; return true; })()']);
  await waitFor(
    session,
    `(() => {
      const camera = window.__viewerDebug?.camera();
      if (!camera) return false;
      const frame = ${FRAME_CLOCK}.frames;
      const seen = (window.__jeexCamStill ??= { x: Number.NaN, y: Number.NaN, z: Number.NaN, n: 0, frame: -1 });
      if (seen.frame === frame) return seen.n >= ${CAMERA_STILL_SAMPLES};
      seen.frame = frame;
      const still = Math.hypot(camera.x - seen.x, camera.y - seen.y, camera.z - seen.z) < ${CAMERA_STILL_EPS_M};
      seen.x = camera.x; seen.y = camera.y; seen.z = camera.z;
      seen.n = still ? seen.n + 1 : 0;
      return seen.n >= ${CAMERA_STILL_SAMPLES};
    })()`,
    `${what} (the camera to come to rest)`,
    timeoutMs,
  );
}

/**
 * Waits for a predicate and answers whether it arrived, instead of failing.
 *
 * For the handful of places where NOT arriving is a legitimate outcome the
 * caller then asserts on — "the tap either walked or was refused with a
 * reason" — a thrown timeout would hide the second half.
 */
export async function tryWaitFor(session: Session, expression: string, timeoutMs = PREDICATE_TIMEOUT_MS): Promise<boolean> {
  try {
    return await waitOnFrameClock(session, expression, timeoutMs);
  } catch {
    return false;
  }
}

/**
 * Waits a FIXED duration, because there is nothing to observe.
 *
 * Every call must pass a named constant and a `covers` string saying what
 * physical duration the number is: an animation, a transition, a debounce. A
 * bare magic number here is what `settle` exists to prevent, and a reviewer should reject one.
 *
 * The duration passes on BOTH clocks: the viewer's (its own animations run on
 * the frame step) and the wall's (a CSS transition, a debounce, a timer). On a
 * machine that renders at speed that is one wait of `ms`.
 */
export async function settle(session: Session, ms: number, covers: string): Promise<void> {
  const started = Date.now();
  await waitOnFrameClock(session, 'false', ms);
  const rest = ms - (Date.now() - started);
  if (rest > 0) await session.run(['wait', String(rest)]);
  // Not printed: the step name already says what is happening, and a line per
  // sleep would drown the transcript. `covers` is for the reader of the source.
  void covers;
}

/**
 * Clicks a control-bar button with a real pointer, after pinning the bar open.
 *
 * The bar collapses after 4.2 s of idle to `pointer-events: none`, and the
 * canvas under it takes the click. Relying on the bar still being open from an
 * earlier pointer is a race a software rasteriser at 1 fps loses («reset-button
 * is covered by canvas.scene-canvas»). The same two steps `tests/e2e/support.ts` `pressMode`
 * takes remove the deadline instead of racing it, in ONE page task: a
 * `pointermove` on the viewer root wakes the bar, and focusing the button
 * wakes it with `force`, which arms no hide timer. The real click then moves
 * the pointer onto the bar, where the idle timer keeps it open for as long as
 * the pointer rests there (`ViewerChrome.wake`). The wait between the two also
 * lets the bar's slide-in transform finish, so the point the click aims at is
 * where the button stays.
 */
export async function pressControl(session: Session, selector: string): Promise<void> {
  const target = `document.querySelector(${JSON.stringify(selector)})`;
  await session.run([
    'eval',
    `(() => {
      const element = ${target};
      const bar = element?.closest('[data-jeex="control-bar"]');
      if (!element || !bar) throw new Error('not a control-bar button: ' + ${JSON.stringify(selector)});
      element.closest('[data-jeex="viewer"]').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
      element.focus();
      return true;
    })()`,
  ]);
  await waitFor(
    session,
    `(() => {
      const element = ${target};
      const bar = element.closest('[data-jeex="control-bar"]');
      return document.activeElement === element && bar.dataset.collapsed === 'false' && bar.getAnimations().length === 0;
    })()`,
    `the control bar to be pinned open around ${selector}`,
  );
  await session.run(['click', selector]);
}
