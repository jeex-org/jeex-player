/**
 * The tour as a PROP and as a control surface: it plays on load because the
 * options said so, the bar mirrors it, every seek is repeatable, and the three
 * mount-option variants (paused, opted out, scroll-driven) behave as documented.
 *
 * The two areas are lists of named steps (`step.ts`).
 */

import type { CheckContext } from './context.js';
import { startPlaybackMeter, stopPlaybackMeter, waitForPlayback } from './playback.js';
import { pressControl, runSteps, type Step, waitFor } from './step.js';

/**
 * The observation window of the autoplay check, seconds of PLAYBACK.
 *
 * This is a MEASUREMENT window, not a wait for a state: the point is to watch
 * the camera for twenty seconds of the tour and add up how far it went, which
 * no state predicate can express. It is counted on the viewer's own frame
 * clock (`playback.ts`), so it is twenty wall seconds on a machine that renders
 * at speed and as many frames as twenty seconds of the clip take on one that
 * does not; the camera is sampled once per second of playback.
 */
const TOUR_WINDOW_S = 20;

/** How long a paused run is watched to prove it does not drift, seconds of playback. */
const PAUSED_OBSERVATION_S = 1;
/** The same for a mount that came up paused; longer, because a boot can settle late. */
const PAUSED_MOUNT_OBSERVATION_S = 2;

/** The clip's state, as a page-side expression. */
const TOUR_STATE = 'window.__viewerDebug.tour.progress().state';

/**
 * The camera has moved at least `metres` from `pose`, as a page-side
 * expression.
 *
 * The state flag is not the observable to wait on here: `play()` flips it in
 * the same tick, so a step that waits for `playing` and then reads the camera
 * samples it before the first frame of the run. What the assertion is about is
 * the MOVEMENT, so that is what the predicate says.
 */
function movedFrom(pose: { x: number; y: number; z: number }, metres: number): string {
  return `(() => { const c = window.__viewerDebug.camera(); return Boolean(c) && Math.hypot(c.x - ${pose.x}, c.y - ${pose.y}, c.z - ${pose.z}) > ${metres}; })()`;
}

/** Autoplay, the bar, seeking and scrubbing. Leaves the tour playing. */
export async function checkTourPlayback(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, cameraAt, tourState, tourProgressText, tourBar, distance } = ctx;

  let barOnLoad = { visible: '', state: '', valuenow: 0 };
  let progressStart = '';
  let seeked = { before: '', fraction: 0, distance: 0, length: 0, state: '' };

  /**
   * Clicks the bar's own play/pause button with a real pointer.
   *
   * Waking the chrome with a pointer in the middle of the canvas and then
   * `click`ing the selector races twice on a 1 fps software renderer and can
   * lose both: the click's own round trips outlasted the
   * 4.2 s idle, so the bar collapsed to `pointer-events: none` under it, and the
   * point `click` aimed at was taken mid-way through the bar's 0.34 s slide-in
   * transform, so the press landed on the bar's padding 14 px below the button.
   *
   * Neither is raced here. The pointer goes to the button's UNTRANSFORMED
   * centre (the collapse is a `translateY` on the bar): that move wakes the
   * chrome. Once the bar is open and its transitions have finished, the pointer
   * moves there again, now onto the bar — and a pointer resting on the bar
   * keeps it open (`TourBar.staysAwake`), so there is no deadline left. The
   * press is a real `mouse down`/`up` at a point the page has just confirmed
   * hits the button.
   */
  const pressTourPlay = async (): Promise<void> => {
    const button = 'document.querySelector(\'[data-jeex="tour-play"]\')';
    const bar = `${button}.closest('.tour-bar')`;
    const at = await evalValue<{ x: number; y: number }>(
      `JSON.stringify((() => { const r = ${button}.getBoundingClientRect(); const shift = new DOMMatrix(getComputedStyle(${bar}).transform).m42;` +
        ' return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2 - shift) }; })())',
    );
    const x = String(at.x);
    const y = String(at.y);
    await run(['mouse', 'move', x, y]);
    await waitFor(
      ctx,
      `(() => { const b = ${bar}; return !b.classList.contains('is-collapsed') && b.getAnimations({ subtree: true }).length === 0; })()`,
      'the tour bar to open and finish its slide-in',
    );
    await run(['mouse', 'move', x, y]);
    await waitFor(
      ctx,
      `(() => { const hit = document.elementFromPoint(${x}, ${y}); return Boolean(hit) && ${button}.contains(hit) && ${bar}.matches(':hover'); })()`,
      'the pointer to rest on the play button',
    );
    await run(['mouse', 'down']);
    await run(['mouse', 'up']);
  };

  const steps: Step[] = [
    {
      name: 'the tour plays on load, because playback is a prop and not a button',
      run: async () => {
        assert((await tourState()) === 'playing', 'the tour should play on load, with no click');
        barOnLoad = await tourBar();
        assert(barOnLoad.visible === 'true', `the progress bar should be shown by default | ${JSON.stringify(barOnLoad)}`);
        assert(barOnLoad.state === 'playing', `the bar should mirror the clip state | ${JSON.stringify(barOnLoad)}`);
        progressStart = await tourProgressText();
        await startPlaybackMeter(ctx);
      },
    },
    {
      name: 'the debug surface reads the look and the tour-camera overlay, which is off by default',
      run: async () => {
        // `cameraLook` completes `camera()` into a pose a tour camera can be
        // compared with; `tourCameras` says what the overlay draws. Both are
        // read-only contract members (`app/viewer-debug.ts`).
        const look = await evalValue<{ yaw: number; pitch: number } | null>('JSON.stringify(window.__viewerDebug.cameraLook())');
        assert(
          look !== null && Number.isFinite(look.yaw) && Number.isFinite(look.pitch),
          `cameraLook should answer a finite yaw/pitch | ${JSON.stringify(look)}`,
        );
        const overlay = await evalValue<{ visible: boolean; rendered: boolean; markers: string[]; tube: boolean }>(
          'JSON.stringify(window.__viewerDebug.tourCameras())',
        );
        assert(
          !overlay.visible && !overlay.rendered,
          `the tour-camera overlay is off until a host switches it on | ${JSON.stringify(overlay)}`,
        );
      },
    },
    {
      name: 'twenty seconds of playback move the camera, the clock and the bar',
      run: async () => {
        // A tour that reports `playing` while the camera stands still, or crawls
        // the whole run, looks broken to a viewer and green to a state-only
        // check: let it run and measure the camera, the clock and the bar.
        await waitForPlayback(ctx, TOUR_WINDOW_S, 'the autoplaying tour');
        const { travel: tourTravel, frames } = await stopPlaybackMeter(ctx);
        const barAfter = await tourBar();
        assert((await tourState()) === 'playing', 'tour should still be playing after 20 s of playback');
        assert(tourTravel > 5, `tour camera should travel more than 5 m in 20 s of playback | travelled=${tourTravel.toFixed(2)} m`);
        assert((await tourProgressText()) !== progressStart, `tour progress text should advance | start=${progressStart}`);
        assert(
          barAfter.valuenow > barOnLoad.valuenow,
          `#tour-track aria-valuenow should advance | ${barOnLoad.valuenow} -> ${barAfter.valuenow}`,
        );
        const insideNow = await cameraAt();
        assert(
          Math.abs(insideNow.y - 1.6) < 0.05,
          `tour should be walking the flat at eye level after 20 s of playback | y=${insideNow.y.toFixed(2)}`,
        );
        summary.push(
          `autoplay: travelled ${tourTravel.toFixed(1)} m in 20 s of playback (${frames} frames), aria-valuenow ${barOnLoad.valuenow} -> ${barAfter.valuenow}`,
        );
      },
    },
    {
      name: 'the bar’s own play/pause button stops and restarts the run',
      run: async () => {
        await pressTourPlay();
        assert((await tourState()) === 'paused', 'the bar play button should pause the run');
        const frozenAt = await cameraAt();
        await startPlaybackMeter(ctx);
        await waitForPlayback(ctx, PAUSED_OBSERVATION_S, 'a paused run watched for drift');
        await stopPlaybackMeter(ctx);
        const stillAt = await cameraAt();
        assert(
          distance(frozenAt, stillAt) < 0.01,
          `a paused tour must not move the camera | moved ${distance(frozenAt, stillAt).toFixed(3)} m in 1 s of playback`,
        );
        await pressTourPlay();
        assert((await tourState()) === 'playing', 'the bar play button should resume the run');
      },
    },
    {
      name: 'seek reports the route and never changes the state',
      run: async () => {
        seeked = await evalValue<typeof seeked>(`(() => {
    const tour = window.__viewerDebug.tour;
    const before = tour.progress().state;
    tour.seek(0.5);
    const p = tour.progress();
    return JSON.stringify({ before, fraction: p.fraction, distance: p.distance, length: p.length, state: p.state });
  })()`);
        assert(Math.abs(seeked.fraction - 0.5) < 0.01, `seek(0.5) should report half the route | ${seeked.fraction}`);
        assert(
          Math.abs(seeked.distance - seeked.length / 2) < 0.05,
          `the reported distance should be half the route length | ${seeked.distance} of ${seeked.length}`,
        );
        assert(seeked.state === seeked.before, `a seek must not change the state | ${seeked.before} -> ${seeked.state}`);
      },
    },
    {
      name: 'the same fraction always lands on the same metre of the route',
      run: async () => {
        // A scroll-driven host gets a repeatable camera, not a drifting one.
        await pressTourPlay();
        assert((await tourState()) === 'paused', 'the run should be paused for the deterministic seek check');
        await run(['eval', 'window.__viewerDebug.tour.seek(0.5)']);
        const halfway = await cameraAt();
        // A quarter in, the demo tour is in the living room beside the bay; half way it is in the hall.
        await run(['eval', 'window.__viewerDebug.tour.seek(0.25)']);
        const quarter = await cameraAt();
        await run(['eval', 'window.__viewerDebug.tour.seek(0.5)']);
        const halfwayAgain = await cameraAt();
        assert(distance(halfway, quarter) > 0.5, 'seeking to a different fraction should move the camera');
        assert(
          distance(halfway, halfwayAgain) < 0.05,
          `the same fraction must land on the same pose | ${distance(halfway, halfwayAgain).toFixed(3)} m apart`,
        );
        summary.push(`seek(0.5) = ${seeked.distance.toFixed(2)} m of ${seeked.length.toFixed(2)} m, repeatable within 5 cm`);
      },
    },
    {
      name: 'dragging the track scrubs, and restores what it interrupted',
      run: async () => {
        await pressTourPlay();
        assert((await tourState()) === 'playing', 'the run should be playing before the drag');
        const track = await evalValue<{ left: number; width: number; middle: number }>(
          'JSON.stringify((() => { const r = document.querySelector(\'[data-jeex="tour-track"]\').getBoundingClientRect();' +
            ' return { left: r.left, width: r.width, middle: r.top + r.height / 2 }; })())',
        );
        const trackX = (fraction: number): number => Math.round(track.left + track.width * fraction);
        await run(['mouse', 'move', String(trackX(0.2)), String(Math.round(track.middle))]);
        await run(['mouse', 'down']);
        await run(['mouse', 'move', String(trackX(0.5)), String(Math.round(track.middle))]);
        await run(['mouse', 'move', String(trackX(0.8)), String(Math.round(track.middle))]);
        await run(['mouse', 'up']);
        const dragged = await evalValue<number>('window.__viewerDebug.tour.progress().fraction');
        assert(dragged > 0.78 && dragged < 0.9, `a drag to 80 % should land there | fraction=${dragged}`);
        assert((await tourState()) === 'playing', 'a drag over a playing run should leave it playing');
        summary.push(`track drag 20 % -> 80 % landed at ${dragged.toFixed(3)} and kept playing`);
      },
    },
  ];

  await runSteps(steps);
}

/** The three mount-option tours, including the scroll-driven embed page. */
export async function checkTourMountModes(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, withQuery, url, cameraAt, tourState, tourBar, distance } = ctx;

  const steps: Step[] = [
    {
      name: '?tour=paused&tourBar=0 parks on the route with no bar, and the handle starts it',
      run: async () => {
        await run(['open', withQuery('view=tour&tour=paused&tourBar=0')]);
        await waitFor(ctx, 'window.__appReady === true', 'the paused mount to boot');
        assert((await tourState()) === 'paused', '?tour=paused should engage the tour without playing it');
        const hiddenBar = await tourBar();
        assert(hiddenBar.visible === 'false', `?tourBar=0 should hide the bar | ${JSON.stringify(hiddenBar)}`);
        assert(hiddenBar.state === 'paused', `the hidden bar still reports the clip | ${JSON.stringify(hiddenBar)}`);
        const parked = await cameraAt();
        await startPlaybackMeter(ctx);
        await waitForPlayback(ctx, PAUSED_MOUNT_OBSERVATION_S, 'a paused mount watched for drift');
        await stopPlaybackMeter(ctx);
        const stillParked = await cameraAt();
        assert(
          distance(parked, stillParked) < 0.01,
          `a paused mount must not drift | moved ${distance(parked, stillParked).toFixed(3)} m in 2 s of playback`,
        );
        await run(['eval', 'window.jeexViewer.tour.play()']);
        assert((await evalValue<string>(TOUR_STATE)) === 'playing', 'the handle should report the run as playing at once');
        await waitFor(ctx, movedFrom(parked, 0.1), 'the started run to move the camera off the parked pose');
        assert(distance(parked, await cameraAt()) > 0.1, 'a started tour should move the camera');
        summary.push('?tour=paused&tourBar=0: parked on the route, no bar, started through window.jeexViewer');
      },
    },
    {
      name: '?tour=off leaves the presentation camera, and the button still starts the run',
      run: async () => {
        await run(['open', withQuery('view=tour&tour=off')]);
        await waitFor(ctx, 'window.__appReady === true', 'the opted-out mount to boot');
        assert((await tourState()) === 'ready', '?tour=off should leave the tour untouched');
        const offBar = await tourBar();
        assert(offBar.visible === 'false', `an unengaged tour shows no bar | ${JSON.stringify(offBar)}`);
        const presentation = await cameraAt();
        await run(['click', '[data-jeex="reveal-controls"]']);
        await pressControl(ctx, '[data-mode="tour"]');
        assert((await evalValue<string>(TOUR_STATE)) === 'playing', 'the tour button should engage the run at once');
        await waitFor(ctx, movedFrom(presentation, 0.1), 'the run to ease out of the presentation view');
        assert(distance(presentation, await cameraAt()) > 0.1, 'the tour button should ease out of the presentation view');
      },
    },
    {
      name: 'scene input pauses the run, and the tour button resumes it',
      run: async () => {
        await run(['mouse', 'move', '640', '500']);
        await run(['mouse', 'down']);
        await run(['mouse', 'up']);
        await waitFor(ctx, `${TOUR_STATE} === 'paused'`, 'the manual input to pause the run');
        await pressControl(ctx, '[data-mode="tour"]');
        await waitFor(ctx, `${TOUR_STATE} === 'playing'`, 'the second activation to resume the run');
        summary.push('?tour=off: presentation camera, tour button starts, scene input pauses');
      },
    },
    {
      name: 'the scroll-driven embed follows the page and ignores a wheel',
      run: async () => {
        await run(['open', new URL('dev/scroll-tour.html', url).href]);
        await waitFor(ctx, 'window.__scrollTourReady === true', 'the scroll-tour page to boot');
        const scrollBar = await tourBar();
        assert(scrollBar.visible === 'false', `the embed mounts without a bar | ${JSON.stringify(scrollBar)}`);
        await run(['eval', 'window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.5)']);
        await waitFor(
          ctx,
          'Math.abs(window.jeexViewer.tour.progress().fraction - 0.5) < 0.02',
          'the scroll listener to seek the clip to half the route',
        );
        const scrolled = await evalValue<{ fraction: number; state: string }>('JSON.stringify(window.jeexViewer.tour.progress())');
        assert(Math.abs(scrolled.fraction - 0.5) < 0.02, `half the page should be half the route | fraction=${scrolled.fraction}`);
        // `pauseOnInput: false`: the page's own wheel must not wrestle the camera away.
        const afterWheel = await evalValue<{ fraction: number; state: string }>(`(() => {
    const canvas = document.querySelector('[data-jeex="scene-canvas"]');
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true }));
    return JSON.stringify(window.jeexViewer.tour.progress());
  })()`);
        assert(
          afterWheel.state === scrolled.state,
          `a wheel over the canvas must not change the state | ${scrolled.state} -> ${afterWheel.state}`,
        );
        assert(Math.abs(afterWheel.fraction - scrolled.fraction) < 1e-6, 'a wheel over the canvas must not move the clip');
        summary.push(`scroll page at 50 %: fraction ${scrolled.fraction.toFixed(3)}, bar hidden, wheel inert`);
      },
    },
  ];

  await runSteps(steps);
}
