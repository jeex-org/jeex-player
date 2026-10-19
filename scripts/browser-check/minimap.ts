/**
 * The mini-map: the card carries the plan and the camera, a hover lights a
 * room, a click walks there through the doors, and the two props take it away.
 */

import { DEMO } from '../../src/demo/demo-ids.js';
import type { CheckContext } from './context.js';
import { FRAME_CLOCK, settle, waitFor, waitForCameraStill } from './step.js';

/**
 * The four durations this area still spells as numbers.
 *
 * Each is a MEASUREMENT window, not a wait for a state: the assertions are
 * about what happened DURING it — how far the camera walked in a quarter
 * second, how far it drifted in a fifth of one, how far the tour marker moved
 * in three. A predicate cannot express "watch for exactly this long".
 */
/** One sample of the walking camera; the longest step over it is the assertion. */
const TRAVEL_SAMPLE_MS = 250;
/** How far into a route the second click lands, so it is provably mid-flight. */
const MID_ROUTE_MS = 500;
/** Two frames at 60 Hz plus slack: long enough to apply an instant arrival. */
const INSTANT_ARRIVAL_MS = 80;
/** How long an arrived camera is watched for drift. */
const DRIFT_OBSERVATION_MS = 200;
/** How long the tour runs so its mini-map marker has somewhere to move to. */
const TOUR_FOLLOW_OBSERVATION_MS = 3000;
/** How long the travel past a door latched shut in its path may take, ms of the viewer's clock. */
const LATCHED_TRAVEL_BUDGET_MS = 20_000;
/**
 * The travel-speed window's smoothing width, in 100 ms samples.
 *
 * Each raw per-sample speed divides a ~0.18 m step by a `dt` read off the
 * frame clock at a ~100 ms tick; the frames land a few milliseconds either
 * side of the tick, and dividing a near-constant distance by a jittery
 * denominator manufactures speed noise the camera never actually had. Five
 * samples (±2 either side) is half a second either way — long enough to fold
 * that jitter out, short enough that the assertion still fails if the curve
 * itself has an uneven stretch spanning more than a couple of waypoints.
 */
const SPEED_SMOOTHING_WINDOW = 5;

/** A centred moving average; the window shrinks at the edges rather than pad. */
function movingAverage(values: readonly number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    const from = Math.max(0, index - half);
    const to = Math.min(values.length, index + half + 1);
    const slice = values.slice(from, to);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

/** The mini-map card: hover, click-to-walk, the travel curve and its props. */
export async function checkMinimap(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, literal, withQuery, url, shotDir, cameraAt } = ctx;
  // ---- Mini-map 1: ?view=walk puts the plan on the card, with the camera on it ----
  await run(['open', withQuery('view=walk')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const mapInWalk = await evalValue<{
    visible: string;
    mode: string;
    hover: string | null;
    size: { w: number; h: number };
    state: { visible: boolean; camera: { x: number; z: number; yaw: number } | null; hoverRoom: string | null };
    ink: number;
  }>(`(() => {
    const card = document.querySelector('[data-jeex="minimap"]');
    const canvas = card.querySelector('canvas');
    const box = card.getBoundingClientRect();
    // Count the dark pixels: a card that is up but blank would pass on the
    // attributes alone, and a blank map is worse than no map.
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) ink += 1;
    }
    return JSON.stringify({
      visible: card.dataset.visible,
      mode: card.dataset.mode,
      hover: card.dataset.hoverRoom ?? null,
      size: { w: box.width, h: box.height },
      state: window.__viewerDebug.minimap(),
      ink,
    });
  })()`);
  assert(mapInWalk.visible === 'true', `?view=walk must show the mini-map | ${JSON.stringify(mapInWalk)}`);
  assert(mapInWalk.mode === 'walk', `the card reports the mode it is showing for | ${mapInWalk.mode}`);
  assert(
    mapInWalk.size.w <= 196 && mapInWalk.size.h <= 196 && mapInWalk.size.w > 80,
    `the card is a small square, at most 196 px | ${JSON.stringify(mapInWalk.size)}`,
  );
  assert(mapInWalk.ink > 400, `the mini-map must actually draw the plan | ${mapInWalk.ink} dark px`);
  assert(mapInWalk.state.visible && mapInWalk.state.camera !== null, `minimap() reports the marker | ${JSON.stringify(mapInWalk.state)}`);
  assert(mapInWalk.hover === null, 'nothing is highlighted before the pointer arrives');
  await run(['screenshot', `${shotDir}/minimap-walk.png`]);
  summary.push(`?view=walk: mini-map ${Math.round(mapInWalk.size.w)} px, ${mapInWalk.ink} dark px, marker on the plan`);

  // ---- Mini-map 2: hovering a room lights it up ----
  const bedroomOnMap = await evalValue<{ x: number; y: number } | null>(
    `JSON.stringify(window.__viewerDebug.minimapRoomPoint(${literal(DEMO.room.bedroom)}))`,
  );
  assert(bedroomOnMap !== null, 'minimapRoomPoint must place the bedroom on the card');
  await run(['mouse', 'move', String(Math.round(bedroomOnMap!.x)), String(Math.round(bedroomOnMap!.y))]);
  const hoveredRoom = await evalValue<{ attribute: string; reported: string | null }>(`(() => JSON.stringify({
    attribute: document.querySelector('[data-jeex="minimap"]').dataset.hoverRoom ?? '',
    reported: window.__viewerDebug.minimap().hoverRoom,
  }))()`);
  assert(hoveredRoom.attribute === DEMO.room.bedroom, `hovering the bedroom sets data-hover-room | ${JSON.stringify(hoveredRoom)}`);
  assert(hoveredRoom.reported === DEMO.room.bedroom, `minimap() agrees with the attribute | ${JSON.stringify(hoveredRoom)}`);
  await run(['screenshot', `${shotDir}/minimap-hover.png`]);

  // Every room, not just the bedroom: `minimapRoomPoint` has to land INSIDE the
  // room it names, and the living room with its bay is the one whose centroid
  // does not (`minimap.interiorPointOf`).
  const roomIds = await evalValue<string[]>('JSON.stringify(window.__viewerDebug.rooms())');
  const misplaced: string[] = [];
  for (const roomId of roomIds) {
    const spot = await evalValue<{ x: number; y: number } | null>(
      `JSON.stringify(window.__viewerDebug.minimapRoomPoint(${literal(roomId)}))`,
    );
    if (!spot) {
      misplaced.push(`${roomId}: no point`);
      continue;
    }
    await run(['mouse', 'move', String(Math.round(spot.x)), String(Math.round(spot.y))]);
    const under = await evalValue<string>("document.querySelector('[data-jeex=\"minimap\"]').dataset.hoverRoom ?? ''");
    if (under !== roomId) misplaced.push(`${roomId}: hovered ${under || 'nothing'}`);
  }
  assert(misplaced.length === 0, `every room's map point must hover that room | ${misplaced.join(', ')}`);
  await run(['mouse', 'move', String(Math.round(bedroomOnMap!.x)), String(Math.round(bedroomOnMap!.y))]);
  summary.push(`mini-map hover: data-hover-room correct for all ${roomIds.length} rooms`);

  // ---- Mini-map 3: a click WALKS there, through the doors, without jumping ----
  const walkRoute = await evalValue<Array<{ x: number; z: number }>>(
    `JSON.stringify(window.__viewerDebug.routeToRoom(${literal(DEMO.room.bedroom)}))`,
  );
  assert(Array.isArray(walkRoute) && walkRoute.length >= 2, `the click has a route to follow | ${JSON.stringify(walkRoute)}`);
  const bedroomCentre = walkRoute.at(-1)!;

  // The curve the camera will actually follow (`travel-path.ts`), read before
  // anything moves: it is what the constant-speed engine is driven along.
  const travelCurve = await evalValue<{ length: number; points: Array<{ x: number; z: number }> } | null>(
    `JSON.stringify(window.__viewerDebug.travelPath(${literal(DEMO.room.bedroom)}))`,
  );
  assert(travelCurve !== null, 'travelPath must answer with the curve of the click');
  assert(travelCurve!.points.length >= 20, `the curve is sampled, not a handful of waypoints | ${travelCurve!.points.length} points`);
  let routeLength = 0;
  // `i` runs 1..length-1, so both ends of every leg are in range.
  for (let i = 1; i < walkRoute.length; i += 1) {
    routeLength += Math.hypot(walkRoute[i]!.x - walkRoute[i - 1]!.x, walkRoute[i]!.z - walkRoute[i - 1]!.z);
  }
  assert(
    travelCurve!.length <= routeLength + 1e-6 && travelCurve!.length >= routeLength * 0.85,
    `rounding shortens the polyline, never by much | curve ${travelCurve!.length.toFixed(2)} m of ${routeLength.toFixed(2)} m`,
  );

  // A sampler INSIDE the page: one CDP round trip per sample would jitter the
  // clock far more than the motion it is meant to measure. It samples on the
  // viewer's frame clock (`FRAME_CLOCK`, the capped step the walk itself
  // advances by), once per ~100 ms of it: a wall-clock `setInterval` on a 1 fps
  // software renderer took ten samples per frame, nine of them
  // standing still, and read a steady walk as a 43 % speed variation. On a
  // machine that renders at speed the two clocks are the same.
  await run([
    'eval',
    `(() => {
    const trace = [];
    window.__travelTrace = trace;
    const clock = ${FRAME_CLOCK};
    const started = clock.seconds;
    let next = 0;
    const tick = () => {
      const t = (clock.seconds - started) * 1000;
      const camera = window.__viewerDebug.camera();
      if (camera && t >= next) {
        trace.push({ t, x: camera.x, y: camera.y, z: camera.z });
        next = t + 100;
      }
      if (!window.__travelStop) requestAnimationFrame(tick);
    };
    window.__travelStop = false;
    tick();
    return 'sampling';
  })()`,
  ]);

  const startedAt = await cameraAt();
  await run(['mouse', 'down']);
  await run(['mouse', 'up']);

  let mapSample = startedAt;
  let longestJump = 0;
  let arrivedAfter = -1;
  let travelled = 0;
  for (let step = 1; step <= 48; step += 1) {
    await settle(ctx, TRAVEL_SAMPLE_MS, 'a quarter second of walking between camera samples');
    const sample = await cameraAt();
    const jump = Math.hypot(sample.x - mapSample.x, sample.z - mapSample.z);
    longestJump = Math.max(longestJump, jump);
    travelled += jump;
    mapSample = sample;
    if (step === 5) await run(['screenshot', `${shotDir}/minimap-travel.png`]);
    if (Math.hypot(sample.x - bedroomCentre.x, sample.z - bedroomCentre.z) < 0.6) {
      arrivedAfter = step * 0.25;
      break;
    }
  }
  assert(
    arrivedAfter > 0 && arrivedAfter <= 12,
    `a mini-map click must reach the bedroom within 12 s | arrived=${arrivedAfter}s at ${JSON.stringify(mapSample)}`,
  );
  assert(longestJump <= 1.5, `the camera must WALK there, not jump | longest 250 ms step ${longestJump.toFixed(2)} m`);
  assert(travelled > 5, `the walk goes round through the doors, not through the wall | ${travelled.toFixed(1)} m`);
  assert(Math.abs(mapSample.y - 1.65) < 0.01, `the eye stays at eye height the whole way | y=${mapSample.y.toFixed(2)}`);
  const stillWalking = await evalValue<string>('String(window.__viewerDebug.mode())');
  assert(stillWalking === 'walk', `travel leaves the viewer in walk mode | ${stillWalking}`);
  summary.push(
    `mini-map click: bedroom reached in ${arrivedAfter}s, ${travelled.toFixed(1)} m walked, longest 250 ms step ${longestJump.toFixed(2)} m`,
  );

  // ---- Mini-map 3b: the travel is ONE curve at ONE speed ----
  // The arrival loop breaks 0.6 m short of the centre; let the ease-out finish
  // before the trace is closed, or the last stretch is missing from it.
  await waitForCameraStill(ctx, 'the arrival ease-out to finish');
  const trace = await evalValue<Array<{ t: number; x: number; y: number; z: number }>>(`(() => {
    window.__travelStop = true;
    return JSON.stringify(window.__travelTrace ?? []);
  })()`);
  assert(trace.length > 20, `the sampler caught the travel | ${trace.length} samples`);

  // Only the moving part of the trace: the samples before the click landed and
  // after the camera settled say nothing about the motion.
  // `slice(1)` shifts the index by one, so `trace[index]` is the PREVIOUS
  // sample of `sample` and always exists.
  const steps = trace.slice(1).map((sample, index) => {
    const previous = trace[index]!;
    return {
      t: sample.t,
      dt: sample.t - previous.t,
      step: Math.hypot(sample.x - previous.x, sample.z - previous.z),
      heading: Math.atan2(sample.x - previous.x, sample.z - previous.z),
      y: sample.y,
    };
  });
  const first = steps.findIndex((sample) => sample.step > 0.01);
  const last = steps.length - 1 - [...steps].reverse().findIndex((sample) => sample.step > 0.01);
  assert(first >= 0 && last > first + 10, `the travel shows up in the trace | first=${first} last=${last}`);
  const moving = steps.slice(first, last + 1);
  const duration = (moving.at(-1)!.t - moving[0]!.t) / 1000;

  // Speeds in metres per second, so an uneven sampling clock cannot fake a
  // speed change; the window skips the eased first and last stretch. Smoothed
  // before the coefficient of variation is taken from it — see
  // `SPEED_SMOOTHING_WINDOW` — but NOT before `sortedSteps` below: the
  // "no waypoint slows the camera down" assertion wants the raw step sizes,
  // where smoothing would hide the very thing it is checking for.
  const speeds = moving.map((sample) => (sample.dt > 0 ? sample.step / (sample.dt / 1000) : 0));
  const smoothedSpeeds = movingAverage(speeds, SPEED_SMOOTHING_WINDOW);
  const windowFrom = Math.floor(moving.length * 0.15);
  const windowTo = Math.ceil(moving.length * 0.85);
  const steady = smoothedSpeeds.slice(windowFrom, windowTo);
  const mean = steady.reduce((sum, value) => sum + value, 0) / steady.length;
  const variation = Math.sqrt(steady.reduce((sum, value) => sum + (value - mean) ** 2, 0) / steady.length) / mean;
  const sortedSteps = moving
    .slice(windowFrom, windowTo)
    .map((sample) => sample.step)
    .sort((a, b) => a - b);
  const median = sortedSteps[Math.floor(sortedSteps.length / 2)];
  const slowest = sortedSteps[0];
  assert(
    variation <= 0.08,
    `the middle of a travel runs at ONE speed | coefficient of variation ${(variation * 100).toFixed(1)} %, mean ${mean.toFixed(2)} m/s`,
  );
  // `sortedSteps` is non-empty whenever the window above is, which the
  // `first`/`last` assertion already established.
  assert(
    slowest! >= median! / 2,
    `no waypoint slows the camera down | slowest step ${slowest!.toFixed(3)} m of a median ${median!.toFixed(3)} m`,
  );

  // Turn rate, normalised to the nominal 100 ms step (0.18 m at 1.8 m/s), so a
  // late sample does not read as a sharper corner than the curve has.
  let sharpest = 0;
  // Again `i` runs 1..length-1 over `moving`'s own length.
  for (let i = 1; i < moving.length; i += 1) {
    const step = moving[i]!;
    const previous = moving[i - 1]!;
    if (step.step < 0.02 || previous.step < 0.02) continue;
    let turn = step.heading - previous.heading;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    sharpest = Math.max(sharpest, ((Math.abs(turn) * 180) / Math.PI) * (0.18 / step.step));
  }
  assert(sharpest <= 25, `the camera never pivots on the spot | sharpest turn ${sharpest.toFixed(1)} deg per 100 ms`);

  const expected = travelCurve!.length / 1.8;
  assert(
    Math.abs(duration - expected) <= expected * 0.25,
    `the travel takes its length at walking pace | ${duration.toFixed(2)} s for ${travelCurve!.length.toFixed(2)} m (expected ~${expected.toFixed(2)} s)`,
  );
  assert(
    moving.every((sample) => Math.abs(sample.y - 1.65) < 0.01),
    'the eye stays at eye height for every sample of the travel',
  );
  await run(['screenshot', `${shotDir}/travel-path.png`]);
  summary.push(
    `travel trace: ${travelCurve!.length.toFixed(2)} m curve (${travelCurve!.points.length} samples) of a ${routeLength.toFixed(2)} m route, ` +
      `${duration.toFixed(2)} s at ${mean.toFixed(2)} m/s, speed CV ${(variation * 100).toFixed(1)} %, ` +
      `slowest/median step ${(slowest! / median!).toFixed(2)}, sharpest turn ${sharpest.toFixed(1)} deg/100 ms`,
  );

  // ---- Mini-map 3c: a second click on the SAME room is an instant arrival ----
  // The camera is now in the bedroom (previous section). Travel somewhere far
  // enough that 500 ms in is still mid-route, then click the same target on
  // the mini-map again: the "instant transfer" gesture.
  const instantTarget = DEMO.room.kitchen;
  const instantOnMap = await evalValue<{ x: number; y: number } | null>(
    `JSON.stringify(window.__viewerDebug.minimapRoomPoint(${literal(instantTarget)}))`,
  );
  assert(instantOnMap !== null, `minimapRoomPoint must place ${instantTarget} on the card`);
  const instantCurve = await evalValue<{ length: number; points: Array<{ x: number; z: number }> } | null>(
    `JSON.stringify(window.__viewerDebug.travelPath(${literal(instantTarget)}))`,
  );
  assert(instantCurve !== null, `travelPath must answer with the curve to ${instantTarget} before the first click`);
  const instantEnd = instantCurve!.points.at(-1)!;

  await run(['mouse', 'move', String(Math.round(instantOnMap!.x)), String(Math.round(instantOnMap!.y))]);
  await run(['mouse', 'down']);
  await run(['mouse', 'up']);
  await settle(ctx, MID_ROUTE_MS, 'half a second of the route, so the second click lands mid-flight');

  // Mid-route: the camera must be well short of the recorded end, or the
  // second click below would prove nothing.
  const midway = await cameraAt();
  const midwayDistance = Math.hypot(midway.x - instantEnd.x, midway.z - instantEnd.z);
  assert(midwayDistance > 0.6, `the first click must still be travelling at 500 ms | ${midwayDistance.toFixed(2)} m short`);

  // The second click: same pixel, so the same room. The pointer never moved,
  // so `down`/`up` alone is the gesture.
  await run(['mouse', 'down']);
  await run(['mouse', 'up']);
  await settle(ctx, INSTANT_ARRIVAL_MS, 'two frames, enough to apply the jump and not enough to hide a camera still walking');
  const arrivedInstantly = await cameraAt();
  const arrivalDistance = Math.hypot(arrivedInstantly.x - instantEnd.x, arrivedInstantly.z - instantEnd.z);
  assert(
    arrivalDistance < 0.2,
    `the second click must land within 0.2 m of the pre-recorded path end | ${arrivalDistance.toFixed(2)} m off`,
  );
  const modeAfterInstant = await evalValue<string>('String(window.__viewerDebug.mode())');
  assert(modeAfterInstant === 'walk', `an instant arrival stays in walk mode | ${modeAfterInstant}`);

  // Stable a moment later too: a camera still travelling would keep moving at
  // 1.8 m/s, which 200 ms would show as several centimetres, not a couple.
  await settle(ctx, DRIFT_OBSERVATION_MS, 'a fifth of a second of watching for drift after the instant arrival');
  const stillThere = await cameraAt();
  const drift = Math.hypot(stillThere.x - arrivedInstantly.x, stillThere.z - arrivedInstantly.z);
  assert(drift < 0.05, `the instant arrival ends the route, it does not keep walking | drifted ${drift.toFixed(2)} m`);

  await run(['screenshot', `${shotDir}/travel-instant.png`]);
  summary.push(
    `instant arrival: second click on ${instantTarget} landed ${arrivalDistance.toFixed(2)} m from the recorded curve end ` +
      `(${midwayDistance.toFixed(2)} m short when it fired), stable to ${drift.toFixed(2)} m 200 ms later`,
  );

  // ---- Mini-map 3d: a third click, on the room already arrived at, is "already here" ----
  // Before the fix this degenerated to a zero-length route and fell back to
  // the no-clear-path fly-in, switching to 360. Now it must stay in walk,
  // never route, and show its own hint instead of the stale one.
  const hintBeforeThird = await evalValue<string>('document.querySelector(\'[data-jeex="hint-text"]\').textContent');
  const positionBeforeThird = await cameraAt();
  await run(['mouse', 'down']);
  await run(['mouse', 'up']);
  await waitFor(
    ctx,
    `document.querySelector('[data-jeex="hint-text"]').textContent !== ${literal(hintBeforeThird)}`,
    'the "you are already here" hint to replace the previous one',
  );
  const modeAfterThird = await evalValue<string>('String(window.__viewerDebug.mode())');
  assert(
    modeAfterThird === 'walk',
    `a third click on the room already arrived at must stay in walk mode, not fall back to a 360 fly-in | ${modeAfterThird}`,
  );
  const hintAfterThird = await evalValue<string>('document.querySelector(\'[data-jeex="hint-text"]\').textContent');
  assert(
    hintAfterThird !== hintBeforeThird && !hintAfterThird.includes('No clear path') && hintAfterThird.toLowerCase().includes('you are in'),
    `a third click on the room already arrived at must show the already-here hint, not the no-clear-path fallback | before "${hintBeforeThird}" after "${hintAfterThird}"`,
  );
  const positionAfterThird = await cameraAt();
  const driftThird = Math.hypot(positionAfterThird.x - positionBeforeThird.x, positionAfterThird.z - positionBeforeThird.z);
  assert(driftThird < 0.05, `the already-here click must not move the camera at all | drifted ${driftThird.toFixed(2)} m`);
  summary.push(
    `instant arrival: a third click on ${instantTarget} (already there) stays in walk, does not route, hint "${hintAfterThird}"`,
  );

  // ---- Mini-map 3e: a door latched shut MID-TRAVEL holds the walker ----
  // The HUD's close button is an HTML button: the click never reaches the
  // canvas, so the route is not cancelled; this guards against the scripted
  // camera walking straight through the leaf a second later. It waits at the
  // door, the wait itself takes the latch off (`DoorStates.rearm`), the automation opens
  // it, and the travel finishes.
  const latchTarget = DEMO.room.bedroom;
  const latchDoor = await evalValue<{ id: string; centre: { x: number; z: number }; beyond: { x: number; z: number } } | null>(`(() => {
    const D = window.__viewerDebug;
    const route = D.routeToRoom(${literal(latchTarget)}) ?? [];
    const centres = new Map(D.openings().map((o) => [o.id, o.center]));
    const cam = D.camera();
    for (let i = 0; i + 1 < route.length; i += 1) {
      const near = route[i];
      const far = route[i + 1];
      if (!near.door || near.door !== far.door) continue;
      const centre = centres.get(near.door);
      // Far enough ahead that the travel is under way before it is shut, and
      // the door is still open right now.
      if (!centre || Math.hypot(cam.x - centre.x, cam.z - centre.z) < 3) continue;
      if (D.doors().find((d) => d.id === near.door)?.phase !== 'open') continue;
      return JSON.stringify({ id: near.door, centre: { x: centre.x, z: centre.z }, beyond: { x: far.x, z: far.z } });
    }
    return JSON.stringify(null);
  })()`);
  assert(latchDoor !== null, `the route to the ${latchTarget} must cross a door at least 3 m ahead`);

  const latchOnMap = await evalValue<{ x: number; y: number } | null>(
    `JSON.stringify(window.__viewerDebug.minimapRoomPoint(${literal(latchTarget)}))`,
  );
  assert(latchOnMap !== null, `minimapRoomPoint must place the ${latchTarget} on the card`);
  await run(['mouse', 'move', String(Math.round(latchOnMap!.x)), String(Math.round(latchOnMap!.y))]);
  await run(['mouse', 'down']);
  await run(['mouse', 'up']);

  // The probe shuts the door from INSIDE the page, the frame the walker comes
  // within 2.4 m of it: shut from further off, the automation would hand the
  // latch straight back (the release radius is 2.6 m) and nothing would hold.
  await run([
    'eval',
    `(() => {
    const D = window.__viewerDebug;
    const id = ${literal(latchDoor!.id)};
    const centre = ${literal(latchDoor!.centre)};
    const beyond = ${literal(latchDoor!.beyond)};
    const span = Math.hypot(beyond.x - centre.x, beyond.z - centre.z) || 1;
    const dir = { x: (beyond.x - centre.x) / span, z: (beyond.z - centre.z) / span };
    document.querySelector('[data-jeex="hint-text"]').textContent = '';
    window.__latchProbe = { samples: [], shutAt: -1, stop: false };
    const probe = window.__latchProbe;
    const tick = () => {
      const cam = D.camera();
      const door = D.doors().find((d) => d.id === id);
      const distance = Math.hypot(cam.x - centre.x, cam.z - centre.z);
      if (probe.shutAt < 0 && distance < 2.4) {
        D.toggleDoor(id);
        probe.shutAt = probe.samples.length;
      }
      probe.samples.push({
        d: distance,
        t: door.t,
        armed: door.armed,
        crossed: (cam.x - centre.x) * dir.x + (cam.z - centre.z) * dir.z > 0.1,
        x: cam.x,
        z: cam.z,
      });
      if (!probe.stop) requestAnimationFrame(tick);
    };
    tick();
    return 'probing';
  })()`,
  ]);

  await waitFor(
    ctx,
    `(() => {
    const p = window.__latchProbe;
    const goal = ${literal(bedroomCentre)};
    const last = p.samples[p.samples.length - 1];
    return p.shutAt >= 0 && last && Math.hypot(last.x - goal.x, last.z - goal.z) < 0.6;
  })()`,
    'the walker to wait out the latched door and reach the bedroom',
    LATCHED_TRAVEL_BUDGET_MS,
  );
  await run(['screenshot', `${shotDir}/travel-latched-door.png`]);
  const latched = await evalValue<{
    shutAt: number;
    blocked: boolean;
    waited: number;
    crossedShut: boolean;
    rearmed: boolean;
    reopened: boolean;
    closest: number;
    hint: string;
    mode: string;
  }>(`(() => {
    const probe = window.__latchProbe;
    probe.stop = true;
    const after = probe.samples.slice(probe.shutAt);
    // The BLOCKING window: from the frame the leaf fills the doorway
    // (t < DOOR_PASSABLE_T) to the frame it is out of it again. What the
    // walker did inside that window is the whole question.
    let blocking = false;
    let reopened = false;
    let rearmed = false;
    let waited = 0;
    let crossedShut = false;
    for (let i = 1; i < after.length; i += 1) {
      if (!blocking && after[i].t < 0.6) blocking = true;
      if (!blocking) continue;
      if (after[i].t >= 0.6) { reopened = true; break; }
      if (after[i].armed) rearmed = true;
      if (after[i].crossed) crossedShut = true;
      if (Math.hypot(after[i].x - after[i - 1].x, after[i].z - after[i - 1].z) < 0.005) waited += 1;
    }
    return JSON.stringify({
      shutAt: probe.shutAt,
      blocked: blocking,
      waited,
      rearmed,
      reopened,
      crossedShut,
      closest: Math.min(...after.map((s) => s.d)),
      hint: document.querySelector('[data-jeex="hint-text"]').textContent,
      mode: String(window.__viewerDebug.mode()),
    });
  })()`);
  assert(latched.shutAt >= 0, 'the probe must shut the door while the travel is running');
  assert(latched.blocked, `the leaf must actually fill the doorway before the walker gets there | ${JSON.stringify(latched)}`);
  assert(!latched.crossedShut, `the scripted camera must never cross a doorway the leaf is still in | ${JSON.stringify(latched)}`);
  assert(latched.waited >= 6, `the walker must WAIT at the latched leaf, not drive through it | ${latched.waited} still frames`);
  assert(latched.rearmed, `waiting at the leaf must take the latch off | ${JSON.stringify(latched)}`);
  assert(latched.reopened, `the re-armed door must open again for the walker | ${JSON.stringify(latched)}`);
  assert(latched.closest < 1.2, `the walker should reach the leaf | closest ${latched.closest.toFixed(2)} m`);
  assert(latched.mode === 'walk', `the travel stays in walk mode throughout | ${latched.mode}`);
  assert(!latched.hint.includes('door is closed'), `a door that opens itself again is not announced as shut | "${latched.hint}"`);
  const latchArrival = await cameraAt();
  assert(
    Math.hypot(latchArrival.x - bedroomCentre.x, latchArrival.z - bedroomCentre.z) < 0.6,
    `the travel must still finish in the ${latchTarget} | ${JSON.stringify(latchArrival)}`,
  );
  summary.push(
    `latched mid-travel: ${latchDoor!.id} shut at ${latched.closest.toFixed(2)} m, walker waited ${latched.waited} frames ` +
      `at the leaf, latch re-armed and the door reopened, ${latchTarget} reached`,
  );

  // ---- Mini-map 4: ?minimap=0 takes the card away ----
  await run(['open', withQuery('view=walk&minimap=0')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const mapOff = await evalValue<{ prop: boolean; visible: string; state: boolean }>(`(() => JSON.stringify({
    prop: window.jeexViewer.options.view.minimap,
    visible: document.querySelector('[data-jeex="minimap"]').dataset.visible,
    state: window.__viewerDebug.minimap().visible,
  }))()`);
  assert(!mapOff.prop, '?minimap=0 must reach the resolved options');
  assert(mapOff.visible === 'false', `?minimap=0 must hide the card | ${JSON.stringify(mapOff)}`);
  assert(!mapOff.state, 'minimap() reports the card as hidden');
  const pointWhileOff = await evalValue<unknown>(`JSON.stringify(window.__viewerDebug.minimapRoomPoint(${literal(DEMO.room.bedroom)}))`);
  assert(pointWhileOff === null, 'a hidden card has no room to point at');
  summary.push('?minimap=0: no card, prop and debug state agree');

  // ---- Mini-map 5: in the tour the map follows the camera ----
  await run(['open', withQuery('view=tour')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const tourMapStart = await evalValue<{ visible: string; mode: string; camera: { x: number; z: number; yaw: number } | null }>(
    `(() => JSON.stringify({
      visible: document.querySelector('[data-jeex="minimap"]').dataset.visible,
      mode: document.querySelector('[data-jeex="minimap"]').dataset.mode,
      camera: window.__viewerDebug.minimap().camera,
    }))()`,
  );
  assert(tourMapStart.visible === 'true', `the tour shows the mini-map too | ${JSON.stringify(tourMapStart)}`);
  assert(tourMapStart.mode === 'tour', `the card reports the tour mode | ${tourMapStart.mode}`);
  await settle(ctx, TOUR_FOLLOW_OBSERVATION_MS, 'three seconds of the tour, so the marker has somewhere to have moved to');
  const tourMapAfter = await evalValue<{ camera: { x: number; z: number; yaw: number } | null }>(
    '(() => JSON.stringify({ camera: window.__viewerDebug.minimap().camera }))()',
  );
  const before = tourMapStart.camera!;
  const after = tourMapAfter.camera!;
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  const turned = Math.abs(((after.yaw - before.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert(moved > 0.5, `the marker follows the tour camera | moved ${moved.toFixed(2)} m in 3 s`);
  assert(turned > 0.01, `the cone follows the tour heading | turned ${turned.toFixed(3)} rad in 3 s`);
  await run(['screenshot', `${shotDir}/minimap-tour.png`]);
  summary.push(`?view=tour: mini-map follows the run, ${moved.toFixed(1)} m and ${turned.toFixed(2)} rad in 3 s`);

  // ---- Mini-map 6: the plan modes and 360 have no map ----
  const mapAcrossModes = await evalValue<Record<string, string>>(`(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const card = document.querySelector('[data-jeex="minimap"]');
    const seen = {};
    for (const mode of ['orbit', 'plan2d', 'plan3d', 'walk']) {
      document.querySelector('[data-jeex="control-bar"] [data-mode="' + mode + '"]').click();
      await pause(220);
      seen[mode] = card.dataset.visible;
    }
    return JSON.stringify(seen);
  })()`);
  assert(
    mapAcrossModes['orbit'] === 'false' && mapAcrossModes['plan2d'] === 'false' && mapAcrossModes['plan3d'] === 'false',
    `the map belongs to walk and tour only | ${JSON.stringify(mapAcrossModes)}`,
  );
  assert(mapAcrossModes['walk'] === 'true', `the Walk button brings the map back | ${JSON.stringify(mapAcrossModes)}`);
  summary.push('mini-map visibility: walk and tour only, hidden in 360, 2D and 3D');

  // Back to the plain demo page, so the error report and the screenshot are of
  // the viewer this check is about.
  await run(['open', url]);
  await run(['wait', '--fn', 'window.__appReady === true']);
}
