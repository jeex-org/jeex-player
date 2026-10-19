/**
 * The widened `ViewerHandle` and the chrome props, driven the way a host would.
 *
 * Everything here goes through `window.jeexViewer` — the handle the demo page
 * publishes — rather than through `__viewerDebug`: this is the surface an
 * embedding page actually holds, and a check that only ever drove the debug
 * globals would never notice it break.
 *
 * Runs on the plain demo page and leaves it there.
 */

import { DEMO } from '../../src/demo/demo-ids.js';
import type { CheckContext } from './context.js';
import { nameSelector } from './page-code.js';
import { FRAME_CLOCK, waitForCameraStill } from './step.js';

/** How far a `focusRoom` has to move the camera to count as a fly-in. */
const FOCUS_M = 0.5;

/**
 * Tour-camera ids this check brings along. The viewer never mints an id, so
 * the two cameras it authors, the one «Add from current view» creates and the
 * one click-to-place arms are fixed literals; `UNKNOWN` names nothing in the
 * scene.
 */
const CAMERA = {
  living: '01a12fe6-af13-793d-9ca7-4d3edb4921cd',
  kitchen: '01a12fe6-af14-7461-8707-e9e161e14fa2',
  added: '01a12fe6-af15-7f3c-81b0-15fad16702d9',
  placed: '01a12fe6-af16-783f-b388-1fb02d1522b0',
} as const;
const UNKNOWN = '01a12fe6-af17-73d6-98fb-a7a07b438b9c';

export async function checkHandle(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, literal, withQuery, cameraAt, distance } = ctx;

  await run(['open', withQuery('tour=off')]);
  await run(['wait', '--fn', 'window.__appReady === true']);

  // ---- The handle is the whole surface: element, options, mode, rooms ----
  const shape = await evalValue<{ missing: string[]; element: string | null; mode: string; sceneUrl: unknown }>(`(() => {
    const handle = window.jeexViewer;
    const wanted = ['element', 'options', 'tour', 'ready', 'loadScene', 'setMode', 'getMode', 'focusRoom',
      'setFurnitureVisible', 'setLocale', 'resize', 'on', 'dispose'];
    return JSON.stringify({
      missing: wanted.filter((key) => handle[key] === undefined),
      element: handle.element ? handle.element.getAttribute('data-jeex') : null,
      mode: handle.getMode(),
      sceneUrl: handle.options.scene.url,
    });
  })()`);
  assert(shape.missing.length === 0, `the handle must carry every documented member | missing ${JSON.stringify(shape.missing)}`);
  assert(shape.element === 'viewer', `handle.element is the shell root | got ${String(shape.element)}`);
  assert(shape.mode === 'orbit', `a plain load reports orbit | got ${shape.mode}`);
  summary.push(`handle: ${13 - shape.missing.length}/13 members, element = the shell root, mode ${shape.mode}`);

  // ---- setMode moves the viewer AND tells the host ----
  const modes = await evalValue<{ events: string[]; reported: string; button: string | null }>(`(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const handle = window.jeexViewer;
    const events = [];
    const off = handle.on('mode', (mode) => events.push(mode));
    handle.setMode('walk');
    await pause(400);
    const reported = handle.getMode();
    const button = document.querySelector('[data-jeex="control-bar"] [data-mode="walk"]').getAttribute('aria-pressed');
    off();
    handle.setMode('orbit');
    await pause(400);
    return JSON.stringify({ events, reported, button });
  })()`);
  assert(modes.reported === 'walk', `setMode('walk') must be what getMode reports | ${modes.reported}`);
  assert(modes.events.includes('walk'), `setMode must emit the mode event | ${JSON.stringify(modes.events)}`);
  assert(modes.button === 'true', `the chrome must follow a mode set through the handle | ${String(modes.button)}`);
  assert(!modes.events.includes('plan2d'), 'the unsubscribe must stop delivery');
  summary.push(`handle.setMode: mode event ${JSON.stringify(modes.events)}, chrome followed, unsubscribe honoured`);

  // ---- focusRoom, setFurnitureVisible and resize ----
  const before = await cameraAt();
  const focused = await evalValue<boolean>(`window.jeexViewer.focusRoom(${literal(DEMO.room.bedroom)})`);
  assert(focused, 'focusRoom should accept a room the scene has');
  await waitForCameraStill(ctx, 'the flight the handle started to land');
  const after = await cameraAt();
  assert(distance(before, after) > FOCUS_M, `focusRoom should fly the camera | moved ${distance(before, after).toFixed(2)} m`);
  const unknown = await evalValue<boolean>(`window.jeexViewer.focusRoom(${literal(UNKNOWN)})`);
  assert(!unknown, 'focusRoom must answer false for a room the scene has not');

  const furniture = await evalValue<{ off: boolean; on: boolean }>(`(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    window.jeexViewer.setFurnitureVisible(false);
    await pause(900);
    const off = window.__viewerDebug.furnitureRendered() === false;
    window.jeexViewer.setFurnitureVisible(true);
    await pause(900);
    return JSON.stringify({ off, on: window.__viewerDebug.furniture() === true });
  })()`);
  assert(furniture.off, 'setFurnitureVisible(false) must hide the built group');
  assert(furniture.on, 'setFurnitureVisible(true) must bring it back');
  await run(['eval', '(() => { window.jeexViewer.resize(); return true; })()']);
  summary.push('handle: focusRoom flies and refuses an unknown room, furniture toggles, resize is safe');

  // ---- setLocale re-translates in place ----
  // The walk button's DESCRIPTION follows the locale; its visible name is the
  // product term `Walk` in every locale (`ui/mode-labels.ts`).
  const locales = await evalValue<{ before: string; after: string; back: string; name: string }>(`(() => {
    const button = () => document.querySelector('[data-jeex="control-bar"] [data-mode="walk"]');
    const label = () => button().title;
    const before = label();
    window.jeexViewer.setLocale('ru');
    const after = label();
    const name = button().textContent.trim();
    window.jeexViewer.setLocale('en');
    return JSON.stringify({ before, after, back: label(), name });
  })()`);
  assert(locales.before === 'Walk mode', `the demo page opens in English | "${locales.before}"`);
  assert(locales.after === 'Режим прогулки', `setLocale('ru') must re-translate in place | "${locales.after}"`);
  assert(locales.back === 'Walk mode', `setLocale('en') must put it back | "${locales.back}"`);
  assert(locales.name === 'Walk', `the mode name is never translated | "${locales.name}"`);
  summary.push(`handle.setLocale: "${locales.before}" -> "${locales.after}" -> "${locales.back}", no reload`);

  // ---- loadScene: a bad document leaves the good one standing ----
  const reload = await evalValue<{ rev: number; sceneId: string; code: string; kept: number; events: string[] }>(`(async () => {
    const handle = window.jeexViewer;
    const events = [];
    const offError = handle.on('error', (error) => events.push('error:' + error.code));
    const offReady = handle.on('ready', (info) => events.push('ready:' + info.sceneId));
    const rev = window.__viewerDebug.revision();
    const sceneId = window.__viewerDebug.plan() ? 'has-plan' : 'no-plan';
    let code = 'none';
    try {
      await handle.loadScene({ document: { schemaVersion: '2.0', id: 'broken' } });
    } catch (error) {
      code = String(error && error.message).slice(0, 40);
    }
    const kept = window.__viewerDebug.revision();
    offError();
    offReady();
    return JSON.stringify({ rev, sceneId, code, kept, events });
  })()`);
  assert(reload.code !== 'none', 'loadScene must reject an invalid document');
  assert(reload.kept === reload.rev, `a failed loadScene must not touch the revision | ${reload.rev} -> ${reload.kept}`);
  assert(
    reload.events.some((line) => line.startsWith('error:scene-invalid')),
    `a failed loadScene must emit error: scene-invalid | ${JSON.stringify(reload.events)}`,
  );
  assert(
    !reload.events.some((line) => line.startsWith('ready:')),
    `a failed loadScene must not claim readiness | ${JSON.stringify(reload.events)}`,
  );
  const alive = await evalValue<boolean>('Boolean(window.__viewerDebug.plan())');
  assert(alive, 'the scene that was already on screen must still be there');
  summary.push(`handle.loadScene: invalid document rejected, rev stayed ${reload.kept}, scene kept`);

  // ---- The walk entry and the camera steps ----
  // Without a checkpoint route, walk enters as it always did (`walkSpawn`) and
  // stands on no camera. With one, entering walk glides to camera 1 in about a
  // second and STOPS there; PageDown starts a step to camera 2 and the first
  // other key cancels it where it stands. The glide is timed on the viewer's
  // frame clock (`FRAME_CLOCK`): on a renderer that draws one frame a second a
  // one-second glide takes ten seconds of wall clock (as on a software rasteriser).
  const entry = await evalValue<{
    plain: { camera: { index: number | null; count: number }; events: Array<number | null> };
    route: {
      events: Array<number | null>;
      glideMs: number;
      onFirst: boolean;
      stayed: boolean;
      stepped: boolean;
      held: boolean;
      index: number | null;
      mode: string;
    };
  }>(`(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const handle = window.jeexViewer;
    const events = [];
    const off = handle.on('walkCamera', ({ index }) => events.push(index));
    handle.setMode('walk');
    await pause(400);
    const plain = { camera: handle.getState().walk.camera, events: events.splice(0) };
    handle.setMode('orbit');
    const scene = handle.getScene();
    const first = { id: ${literal(CAMERA.living)}, position: { x: 4.4, y: 1.55, z: 2.4 }, yaw: 0.5, pitch: -0.3 };
    scene.tourCheckpoints = [first, { id: ${literal(CAMERA.kitchen)}, position: { x: 1.1, y: 1.5, z: 5.2 }, yaw: -1.57, pitch: -0.4 }];
    await handle.loadScene({ document: scene });
    handle.setMode('orbit');
    await pause(300);
    events.splice(0);
    const gap = () => {
      const c = window.__viewerDebug.camera();
      return c === null ? Infinity : Math.hypot(c.x - first.position.x, c.y - first.position.y, c.z - first.position.z);
    };
    const clock = ${FRAME_CLOCK};
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const frames = async (n) => { for (let i = 0; i < n; i += 1) await frame(); };
    const started = clock.seconds;
    handle.setMode('walk');
    while (handle.getState().walk.camera.index !== 0 && clock.seconds - started < 8) await frame();
    const glideMs = (clock.seconds - started) * 1000;
    const onFirst = gap() < 1e-3;
    await frames(10);
    const stayed = gap() < 1e-3;
    const key = (name) => {
      handle.element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
      handle.element.dispatchEvent(new KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true }));
    };
    key('PageDown');
    const before = clock.seconds;
    while (gap() < 0.05 && clock.seconds - before < 3) await frame();
    const stepped = gap() >= 0.05;
    key('ArrowLeft');
    const c = window.__viewerDebug.camera();
    await frames(5);
    const d = window.__viewerDebug.camera();
    const held = Math.hypot(c.x - d.x, c.z - d.z) < 0.25;
    const index = handle.getState().walk.camera.index;
    const mode = handle.getMode();
    off();
    handle.setMode('orbit');
    return JSON.stringify({ plain, route: { events, glideMs: Math.round(glideMs), onFirst, stayed, stepped, held, index, mode } });
  })()`);
  assert(
    entry.plain.camera.index === null && entry.plain.camera.count === 0 && entry.plain.events.length === 0,
    `walk without a route stands on no camera | ${JSON.stringify(entry.plain)}`,
  );
  assert(entry.route.onFirst, `the glide lands on camera 1's exact place | ${JSON.stringify(entry.route)}`);
  assert(entry.route.glideMs >= 600, `the glide takes about a second, not a cut | ${JSON.stringify(entry.route)}`);
  assert(entry.route.stayed, `the walk stops on camera 1, nothing rides on | ${JSON.stringify(entry.route)}`);
  assert(entry.route.stepped, `PageDown starts a step away from camera 1 | ${JSON.stringify(entry.route)}`);
  assert(
    entry.route.held && entry.route.index === 0 && entry.route.mode === 'walk' && JSON.stringify(entry.route.events) === '[0]',
    `a key cancels the step where it stands, camera 1 stays current, still in walk | ${JSON.stringify(entry.route)}`,
  );
  summary.push(
    `walk entry: plain walkSpawn on no camera; with a route, glide ${entry.route.glideMs} ms to camera 1 and stop, PageDown steps, a key cancels`,
  );

  // ---- The camera tool ----
  // The host commands and their events: «Add from current view» reports one
  // edit on navigable floor at a level pitch, under the id the host gave it,
  // and refuses an id that is not a UUID v7; click-to-place announces both
  // edges; a look-through reads as walk, reports its start and end, commits
  // nothing on cancel and ONE edit on keep; Frame is refused for an unknown id.
  const tool = await evalValue<{
    added: { accepted: boolean; edits: number; id: string | null; y: number; pitch: number };
    refused: { accepted: boolean; edits: number };
    placing: boolean[];
    placingState: boolean;
    look: {
      mode: string;
      state: string | null;
      afterCancel: string;
      editsAfterCancel: number;
      kept: number;
      lifted: boolean;
      events: Array<string | null>;
    };
    frame: { known: boolean; unknown: boolean };
  }>(`(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const handle = window.jeexViewer;
    handle.setCheckpointOverlay(true);
    handle.setMode('orbit');
    await pause(200);
    const edits = [];
    const placing = [];
    const look = [];
    const offs = [
      handle.on('checkpointEdit', (edit) => edits.push(edit)),
      handle.on('checkpointPlacing', ({ active }) => placing.push(active)),
      handle.on('checkpointLookThrough', ({ id }) => look.push(id)),
    ];
    const accepted = handle.addCheckpoint({ id: ${literal(CAMERA.added)} });
    const created = edits.at(-1)?.checkpoints.at(-1);
    const added = { accepted, edits: edits.length, id: created?.id ?? null, y: created?.position.y ?? -1, pitch: created?.pitch ?? 99 };
    handle.revertCheckpointEdit();
    edits.length = 0;
    const refused = { accepted: handle.addCheckpoint({ id: 'cam-1' }), edits: edits.length };
    handle.startCheckpointPlacement({ id: ${literal(CAMERA.placed)} });
    const placingState = handle.getState().checkpoints.placing;
    handle.cancelCheckpointPlacement();
    edits.length = 0;
    handle.lookThroughCheckpoint(${literal(CAMERA.living)});
    const mode = handle.getMode();
    const state = handle.getState().checkpoints.lookThrough;
    handle.endLookThrough(false);
    const afterCancel = handle.getMode();
    const editsAfterCancel = edits.length;
    handle.lookThroughCheckpoint(${literal(CAMERA.living)});
    for (let press = 0; press < 4; press += 1) {
      handle.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }));
    }
    await pause(100);
    handle.endLookThrough(true);
    const kept = edits.length;
    const lifted = (edits.at(-1)?.checkpoints.find((c) => c.id === ${literal(CAMERA.living)})?.position.y ?? 0) > 1.6;
    handle.revertCheckpointEdit();
    const frame = { known: handle.frameCheckpoint(${literal(CAMERA.kitchen)}), unknown: handle.frameCheckpoint(${literal(UNKNOWN)}) };
    for (const off of offs) off();
    handle.setCheckpointOverlay(false);
    return JSON.stringify({ added, refused, placing, placingState, look: { mode, state, afterCancel, editsAfterCancel, kept, lifted, events: look }, frame });
  })()`);
  assert(
    tool.added.accepted && tool.added.edits === 1 && tool.added.id === CAMERA.added,
    `addCheckpoint reports exactly one edit, under the id it was given | ${JSON.stringify(tool.added)}`,
  );
  assert(
    !tool.refused.accepted && tool.refused.edits === 0,
    `addCheckpoint refuses an id that is not a UUID v7 and creates nothing | ${JSON.stringify(tool.refused)}`,
  );
  assert(
    Math.abs(tool.added.y - 1.65) < 1e-6 && tool.added.pitch < 0 && tool.added.pitch > -0.18,
    `a new camera stands at eye height, level | ${JSON.stringify(tool.added)}`,
  );
  assert(
    JSON.stringify(tool.placing) === '[true,false]' && tool.placingState,
    `click-to-place announces both edges | ${JSON.stringify(tool)}`,
  );
  assert(tool.look.mode === 'walk' && tool.look.state === CAMERA.living, `a look-through reads as walk | ${JSON.stringify(tool.look)}`);
  assert(
    tool.look.afterCancel === 'orbit' && tool.look.editsAfterCancel === 0,
    `a cancelled look-through commits nothing | ${JSON.stringify(tool.look)}`,
  );
  assert(
    tool.look.kept === 1 && tool.look.lifted,
    `a kept look-through commits one edit with the new height | ${JSON.stringify(tool.look)}`,
  );
  assert(
    JSON.stringify(tool.look.events) === JSON.stringify([CAMERA.living, null, CAMERA.living, null]),
    `checkpointLookThrough reports each start and end | ${JSON.stringify(tool.look.events)}`,
  );
  assert(tool.frame.known && !tool.frame.unknown, `frameCheckpoint answers for known ids only | ${JSON.stringify(tool.frame)}`);
  summary.push(
    'camera tool: add from view at eye height under the host id, a non-UUID id refused, click-to-place edges, look-through cancel/keep, frame',
  );

  // ---- chrome.controls and chrome.brand are props ----
  await run(['open', withQuery('controls=0')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const bare = await evalValue<{ bar: boolean; hint: boolean; canvas: boolean }>(`(() => {
    const hidden = (name) => document.querySelector('[data-jeex="' + name + '"]').hidden === true;
    return JSON.stringify({
      bar: hidden('control-bar'),
      hint: hidden('hint-card'),
      canvas: Boolean(document.querySelector('${nameSelector('scene-canvas')}')),
    });
  })()`);
  assert(bare.bar, 'chrome.controls=false must hide the control bar');
  // The hint does not ride on controls: it is its own flag.
  assert(!bare.hint, 'chrome.controls=false must leave the hint card alone (chrome.hint is its own flag)');
  assert(bare.canvas, 'chrome.controls=false must leave the scene itself alone');
  // The playback is still fully drivable: the chrome is a view of the options,
  // never the only way to reach them.
  const scriptable = await evalValue<number>(`(() => {
    window.jeexViewer.tour.seek(0.4);
    return window.jeexViewer.tour.progress().fraction;
  })()`);
  assert(Math.abs(scriptable - 0.4) < 0.02, `a bare viewer is still scriptable | fraction ${scriptable}`);

  await run(['open', withQuery('brand=0')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const unbranded = await evalValue<{ brand: boolean; bar: boolean }>(`(() => {
    return JSON.stringify({
      brand: document.querySelector('[data-jeex="brand-lockup"]').hidden === true,
      bar: document.querySelector('[data-jeex="control-bar"]').hidden === false,
    });
  })()`);
  assert(unbranded.brand, 'chrome.brand=false must hide the brand lockup');
  assert(unbranded.bar, 'chrome.brand=false must leave the rest of the bar alone');
  summary.push('chrome props: controls=0 hides only the bar (hint is its own flag), brand=0 hides only the lockup');

  // ---- chrome.status, chrome.modeSwitcher, chrome.hint ----
  await run(['open', withQuery('chromeStatus=0&chromeModeSwitcher=0&chromeHint=0&tour=paused&view=tour')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const threeFlags = await evalValue<{ status: boolean; modeSwitcher: boolean; hint: boolean; bar: boolean }>(`(() => {
    const hidden = (name) => document.querySelector('[data-jeex="' + name + '"]').hidden === true;
    const statusHidden = document.querySelector('[data-jeex="tour-status"]').classList.contains('is-hidden');
    return JSON.stringify({
      status: statusHidden,
      modeSwitcher: hidden('mode-switcher'),
      hint: hidden('hint-card'),
      bar: hidden('control-bar'),
    });
  })()`);
  assert(threeFlags.status, 'chromeStatus=0 must hide the tour-status pill even while a tour is engaged');
  assert(threeFlags.modeSwitcher, 'chromeModeSwitcher=0 must hide the mode switcher');
  assert(threeFlags.hint, 'chromeHint=0 must hide the hint card');
  assert(!threeFlags.bar, 'none of the three flags touches the control bar');
  summary.push('chrome.status/modeSwitcher/hint: each hides exactly its own element');

  // ---- The reveal-controls pill follows chrome.controls ----
  await run(['open', withQuery('controls=0')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const revealHidden = await evalValue<boolean>(`(() => {
    // A focusin on the shell root is what wake(true) answers in production
    // (a Tab into the viewer); reveal-controls must stay hidden regardless.
    document.querySelector('${nameSelector('viewer')}').dispatchEvent(new Event('focusin', { bubbles: true }));
    return document.querySelector('[data-jeex="reveal-controls"]').hidden === true;
  })()`);
  assert(revealHidden, 'reveal-controls must stay hidden after wake(true) while controls=false');
  summary.push('reveal-controls: stays hidden after a focus-triggered wake() while controls=false');

  // ---- the compound chrome attribute ----
  await run(['open', withQuery('chrome=0&chromeStatus=1&tour=paused&view=tour')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const compound = await evalValue<{ bar: boolean; brand: boolean; hint: boolean; modeSwitcher: boolean; status: boolean }>(`(() => {
    const hidden = (name) => document.querySelector('[data-jeex="' + name + '"]').hidden === true;
    return JSON.stringify({
      bar: hidden('control-bar'),
      brand: hidden('brand-lockup'),
      hint: hidden('hint-card'),
      modeSwitcher: hidden('mode-switcher'),
      status: document.querySelector('[data-jeex="tour-status"]').classList.contains('is-hidden'),
    });
  })()`);
  assert(compound.bar && compound.brand && compound.hint && compound.modeSwitcher, 'chrome=0 must zero every chrome.* flag');
  assert(!compound.status, 'chromeStatus=1 after chrome=0 must still win (individual attributes override)');
  summary.push('compound chrome=0: all: unset, chromeStatus=1 after it still wins');

  // ---- interaction ----
  await run(['open', withQuery('interaction=none')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const none = await evalValue<string>(`document.querySelector('${nameSelector('scene-canvas')}').style.pointerEvents`);
  assert(none === 'none', `interaction=none must set pointer-events: none on the canvas | got "${none}"`);
  summary.push(`interaction=none: canvas style.pointerEvents = "${none}"`);

  // ---- overlay presets ----
  await run(['open', withQuery('overlay=kiosk')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const kiosk = await evalValue<{ bar: boolean; brand: boolean; hint: boolean; modeSwitcher: boolean; pointerEvents: string }>(`(() => {
    const hidden = (name) => document.querySelector('[data-jeex="' + name + '"]').hidden === true;
    return JSON.stringify({
      bar: hidden('control-bar'),
      brand: hidden('brand-lockup'),
      hint: hidden('hint-card'),
      modeSwitcher: hidden('mode-switcher'),
      pointerEvents: document.querySelector('${nameSelector('scene-canvas')}').style.pointerEvents,
    });
  })()`);
  assert(
    kiosk.bar && kiosk.brand && kiosk.hint && kiosk.modeSwitcher && kiosk.pointerEvents === 'none',
    `overlay=kiosk must show no chrome at all and set pointer-events: none | ${JSON.stringify(kiosk)}`,
  );
  summary.push('overlay=kiosk: no chrome at all, pointer-events: none');

  // ---- The brand context line is the scene name, never a literal ----
  await run(['open', withQuery('tour=off')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const brand = await evalValue<{ context: string; sceneName: string }>(`(() => {
    return JSON.stringify({
      context: document.querySelector('[data-jeex="brand-context"]').textContent.trim(),
      sceneName: window.__viewerDebug.exportScene ? window.__viewerDebug.exportScene().name : '',
    });
  })()`);
  assert(brand.context.length > 0, 'the brand context line must say which apartment is on screen');
  assert(
    brand.sceneName === '' || brand.context === brand.sceneName,
    `the brand context must be scene.name | "${brand.context}" vs "${brand.sceneName}"`,
  );
  assert(!brand.context.includes('2-ROOM'), 'the hard-coded demo caption must be gone');
  summary.push(`brand context: "${brand.context}" from scene.name`);
}
