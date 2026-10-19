/**
 * Motion measured on the VIEWER'S clock, not on the wall clock.
 *
 * Everything that moves in the viewer — the tour, a walk, a flight — advances
 * by the frame step the render loop hands its hooks, and that step is capped
 * at `MAX_FRAME_DELTA` (`src/render/render-runtime.ts`). On a machine that
 * renders at 60 fps the two clocks agree. On a software rasteriser they do not:
 * a machine without a usable GPU (SwiftShader) draws the demo
 * page at 1.1-1.4 fps, so one wall second is 0.05 s of playback and «twenty
 * seconds of playback» observed on the wall clock was one second of it — the
 * tour check measured 2.19 m and failed a tour that was playing exactly as
 * authored.
 *
 * `step.ts` spends every wait budget on the same frame clock; this module is
 * the other half, for windows that MEASURE motion rather than wait for a state.
 *
 * The meter runs IN the page, on every rendered frame: it adds the same capped
 * step the viewer's hooks received, and each time that clock crosses a whole
 * `PLAYBACK_SAMPLE_S` it adds the straight-line distance the camera moved since
 * the previous sample: one-second chords of playback time, which equal
 * wall-clock seconds on a fast machine. A
 * window is then «N seconds of playback», which is what every speed assertion
 * in the check means; the numbers they compare against do not change.
 */

import { MAX_FRAME_DELTA } from '../../src/render/render-runtime.js';
import type { Session } from './session.js';
import { waitFor } from './step.js';

/** Playback seconds between two camera samples of the meter. */
const PLAYBACK_SAMPLE_S = 1;

/** What the meter has seen since `startPlaybackMeter`. */
export type PlaybackReading = { seconds: number; travel: number; frames: number; samples: number };

/**
 * Starts (or restarts) the page-side meter.
 *
 * The pose at the start is the origin of the first chord, and the clock starts
 * at zero from the call: the frame in flight belongs to the previous window.
 */
export async function startPlaybackMeter(session: Session): Promise<void> {
  await session.run([
    'eval',
    `(() => {
      if (window.__jeexPlayback) window.__jeexPlayback.stop = true;
      const meter = { seconds: 0, travel: 0, frames: 0, samples: 0, stop: false };
      window.__jeexPlayback = meter;
      let last = performance.now();
      let pose = window.__viewerDebug.camera();
      const tick = () => {
        if (meter.stop) return;
        const now = performance.now();
        meter.seconds += Math.min(${MAX_FRAME_DELTA}, (now - last) / 1000);
        last = now;
        meter.frames += 1;
        if (meter.seconds >= (meter.samples + 1) * ${PLAYBACK_SAMPLE_S}) {
          const camera = window.__viewerDebug.camera();
          if (camera && pose) meter.travel += Math.hypot(camera.x - pose.x, camera.y - pose.y, camera.z - pose.z);
          pose = camera;
          meter.samples += 1;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()`,
  ]);
}

/**
 * Waits until the meter has taken the samples of `seconds` of playback.
 *
 * On the sample count, not on `seconds` itself: the float sum can reach the
 * target a frame before the last chord is added.
 */
export async function waitForPlayback(session: Session, seconds: number, what: string): Promise<void> {
  const samples = Math.round(seconds / PLAYBACK_SAMPLE_S);
  // The meter and `waitFor`'s budget count the same capped frame step, so the
  // samples arrive at `seconds` of that clock; twice as long is pure slack.
  await waitFor(session, `window.__jeexPlayback.samples >= ${samples}`, `${seconds} s of playback: ${what}`, 2 * seconds * 1000);
}

/** Reads the meter and stops it. */
export async function stopPlaybackMeter(session: Session): Promise<PlaybackReading> {
  return session.evalValue<PlaybackReading>(
    `JSON.stringify((() => { const m = window.__jeexPlayback; m.stop = true; return { seconds: m.seconds, travel: m.travel, frames: m.frames, samples: m.samples }; })())`,
  );
}
