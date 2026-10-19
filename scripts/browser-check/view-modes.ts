/**
 * The five view modes: the bar offers them in order, the 2D drawing paints over
 * the viewport, the top view looks straight down, and the round trip back to
 * 360 restores the rig it interrupted.
 */

import type { CheckContext } from './context.js';
import { HELPERS } from './page-code.js';
import { pressControl, waitFor, waitForCameraStill } from './step.js';

/** The 2D drawing has taken the viewport, as a page-side expression. */
const PLAN_OVERLAY_SHOWN = 'document.querySelector(\'[data-jeex="plan-canvas"]\').dataset.visible === "true"';
/** …and has given it back. */
const PLAN_OVERLAY_HIDDEN = 'document.querySelector(\'[data-jeex="plan-canvas"]\').dataset.visible === "false"';

/** The five view modes, the 2D drawing, the top view and the round trip. */
export async function checkViewModes(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, withQuery, url, shotDir, cameraAt, tourState, tourBar, distance } = ctx;
  // ---- View modes 1: the bar offers all five, in order, and 360 is the default ----
  await run(['open', url]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const modeBar = await evalValue<{ modes: string[]; active: string[] }>(`(() => {
    const buttons = [...document.querySelectorAll('[data-jeex="control-bar"] [data-mode]')];
    return JSON.stringify({
      modes: buttons.map((b) => b.dataset.mode),
      active: buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.mode),
    });
  })()`);
  assert(
    modeBar.modes.join(',') === 'plan2d,plan3d,orbit,walk,tour',
    `the mode bar must offer 2D/3D/360/Walk/Tour in that order | ${modeBar.modes.join(',')}`,
  );
  assert(modeBar.active.join(',') === 'orbit', `a plain load opens on 360 | active=${modeBar.active.join(',')}`);
  const barOrder = await evalValue<{ order: string[]; interiorsAfterModes: boolean }>(`(() => {
    const ids = [...document.querySelectorAll('[data-jeex="control-bar"] [data-mode], [data-jeex="control-bar"] .icon-button')]
      .map((el) => el.dataset.jeex || el.dataset.mode);
    return JSON.stringify({ order: ids, interiorsAfterModes: ids.indexOf('interiors-button') > ids.indexOf('tour') });
  })()`);
  assert(barOrder.interiorsAfterModes, `the interiors button must sit after the five mode buttons | ${barOrder.order.join(',')}`);
  const opened = await evalValue<{ mode: string; overlay: string; render: string; camera: { x: number; y: number; z: number } }>(`(() => {
    const D = window.__viewerDebug;
    const shot = D.renderCamera();
    return JSON.stringify({ mode: D.mode(), overlay: document.querySelector('[data-jeex="plan-canvas"]').dataset.visible, render: shot.type, camera: shot.position });
  })()`);
  assert(opened.mode === 'orbit', `a plain load is in 360 mode | ${opened.mode}`);
  assert(opened.overlay === 'false', 'the 2D overlay is hidden on a plain load');
  assert(opened.render === 'PerspectiveCamera', `a plain load renders through the perspective rig | ${opened.render}`);
  assert((await tourState()) === 'ready', 'a plain load must not engage the tour any more');
  // The presentation camera, and nothing has moved it: a reset is a no-op.
  await run(['click', '[data-jeex="reveal-controls"]']);
  await pressControl(ctx, '[data-jeex="reset-button"]');
  await waitForCameraStill(ctx, 'the reset flight to land');
  const afterReset = await cameraAt();
  assert(
    distance(afterReset, opened.camera) < 0.05,
    `a plain load opens ON the presentation camera | ${JSON.stringify(opened.camera)} -> ${JSON.stringify(afterReset)}`,
  );
  summary.push(`mode bar: ${modeBar.modes.join('/')} then #interiors-button, default load 360 on the presentation camera`);

  // ---- View modes 1b: the interior selector belongs to the 3D modes ----
  // It opens in 360, and entering a plan mode both closes the panel and takes
  // the button away: a preset dresses the scene, not the drawing.
  await pressControl(ctx, '[data-jeex="interiors-button"]');
  const presetsIn360 = await evalValue<{ kind: string; hidden: boolean }>(`(() => {
    const panel = document.querySelector('[data-jeex="finish-panel"]');
    return JSON.stringify({ kind: panel.dataset.kind ?? '', hidden: panel.classList.contains('is-hidden') });
  })()`);
  assert(
    presetsIn360.kind === 'interior' && !presetsIn360.hidden,
    `the interior panel should still open in 360 | ${JSON.stringify(presetsIn360)}`,
  );
  await pressControl(ctx, '[data-mode="plan2d"]');
  await waitFor(ctx, PLAN_OVERLAY_SHOWN, 'the 2D overlay to take the viewport');
  const presetsIn2d = await evalValue<{ kind: string; hidden: boolean; button: boolean }>(`(() => {
    const panel = document.querySelector('[data-jeex="finish-panel"]');
    return JSON.stringify({
      kind: panel.dataset.kind ?? '',
      hidden: panel.classList.contains('is-hidden'),
      button: !document.querySelector('[data-jeex="interiors-button"]').classList.contains('is-hidden'),
    });
  })()`);
  assert(presetsIn2d.hidden && presetsIn2d.kind === '', `2D must close the interior panel | ${JSON.stringify(presetsIn2d)}`);
  assert(!presetsIn2d.button, '2D must take the interior selector out of the bar');
  await pressControl(ctx, '[data-mode="orbit"]');
  await waitFor(ctx, PLAN_OVERLAY_HIDDEN, 'the 2D overlay to give the viewport back');
  const presetsBack = await evalValue<boolean>(
    "!document.querySelector('[data-jeex=\"interiors-button\"]').classList.contains('is-hidden')",
  );
  assert(presetsBack, 'leaving 2D brings the interior selector back');
  summary.push('interior selector: opens in 360, closed and hidden in 2D, back on 360');

  // ---- View modes 2: ?view=plan2d paints the drawing over the viewport ----
  await run(['open', withQuery('view=plan2d')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const plan2d = await evalValue<{
    mode: string;
    visible: string;
    view: string;
    counts: Record<string, number>;
    bar: string;
    panel: boolean;
    hud: boolean;
    ink: number;
  }>(`(() => {
    const D = window.__viewerDebug;
    const overlay = document.querySelector('[data-jeex="plan-canvas"]');
    // Count the dark pixels: an overlay that is present but blank would pass
    // every attribute assertion and show the user nothing.
    const ctx = overlay.getContext('2d');
    const data = ctx.getImageData(0, 0, overlay.width, overlay.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) ink += 1;
    return JSON.stringify({
      mode: D.mode(),
      visible: overlay.dataset.visible,
      view: overlay.dataset.view,
      counts: D.planDrawing(),
      bar: document.querySelector('[data-jeex="tour-bar"]').dataset.visible,
      panel: !document.querySelector('[data-jeex="finish-panel"]').classList.contains('is-hidden'),
      hud: document.querySelector('[data-jeex="door-hud"]')?.dataset.visible === 'true',
      ink,
    });
  })()`);
  assert(plan2d.mode === 'plan2d', `?view=plan2d should open in 2D | ${plan2d.mode}`);
  assert(plan2d.visible === 'true', `#plan-canvas should be visible in 2D | ${JSON.stringify(plan2d)}`);
  assert(plan2d.view === 'plan2d', `#plan-canvas should report its mode | ${plan2d.view}`);
  for (const kind of ['wall', 'opening', 'window', 'leaf', 'swing', 'fixture', 'room']) {
    assert((plan2d.counts[kind] ?? 0) > 0, `the drawing should have ${kind} primitives | ${JSON.stringify(plan2d.counts)}`);
  }
  assert(plan2d.ink > 5000, `the drawing should actually be painted | ${plan2d.ink} dark pixels`);
  assert(plan2d.bar === 'false', '2D hides the tour bar');
  assert(!plan2d.panel && !plan2d.hud, '2D shows no finish panel and no door HUD');
  await run(['screenshot', `${shotDir}/view-modes-plan2d.png`]);
  // A click on the scene must not pick anything while the drawing is up.
  const picked2d = await evalValue<{ panel: boolean; mode: string }>(`(() => {${HELPERS}
    CLICK(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
    return JSON.stringify({ panel: Boolean(PANEL().kind), mode: D.mode() });
  })()`);
  assert(!picked2d.panel, 'a click in 2D must not open a panel: there is no picking in plan modes');
  assert(picked2d.mode === 'plan2d', 'a click in 2D must not change the mode');
  summary.push(`?view=plan2d: overlay visible, ${JSON.stringify(plan2d.counts)}, ${plan2d.ink} dark px, no picking`);

  // ---- View modes 3: ?view=plan3d is the scene from straight above ----
  await run(['open', withQuery('view=plan3d')]);
  await waitFor(ctx, 'window.__appReady === true', 'the ?view=plan3d page to boot');
  await waitFor(
    ctx,
    "window.__viewerDebug.renderCamera().type === 'OrthographicCamera'",
    'the top view to be installed in front of the renderer',
  );
  const plan3d = await evalValue<{
    mode: string;
    overlay: string;
    bar: string;
    camera: {
      type: string;
      position: { x: number; y: number; z: number };
      direction: { x: number; y: number; z: number };
      up: { x: number; y: number; z: number };
    };
  }>(`(() => {
    const D = window.__viewerDebug;
    return JSON.stringify({
      mode: D.mode(),
      overlay: document.querySelector('[data-jeex="plan-canvas"]').dataset.visible,
      bar: document.querySelector('[data-jeex="tour-bar"]').dataset.visible,
      camera: D.renderCamera(),
    });
  })()`);
  assert(plan3d.mode === 'plan3d', `?view=plan3d should open in 3D | ${plan3d.mode}`);
  assert(plan3d.overlay === 'false', '3D renders the real scene, not the drawing');
  assert(plan3d.bar === 'false', '3D hides the tour bar');
  assert(plan3d.camera.type === 'OrthographicCamera', `3D renders through an orthographic camera | ${plan3d.camera.type}`);
  assert(
    Math.abs(plan3d.camera.direction.x) < 1e-6 && plan3d.camera.direction.y < -0.999 && Math.abs(plan3d.camera.direction.z) < 1e-6,
    `the top view looks straight down | ${JSON.stringify(plan3d.camera.direction)}`,
  );
  assert(plan3d.camera.up.z < -0.999, `north is up in the top view | ${JSON.stringify(plan3d.camera.up)}`);
  assert(plan3d.camera.position.y > 10, `the top view stands above the flat | y=${plan3d.camera.position.y}`);
  await run(['screenshot', `${shotDir}/view-modes-plan3d.png`]);
  summary.push(`?view=plan3d: ${plan3d.camera.type} at y=${plan3d.camera.position.y}, looking straight down, north up`);

  // ---- View modes 4: the round trip back to 360 restores the rig ----
  const modeRoundTrip = await evalValue<{
    before: { x: number; y: number; z: number };
    after: { x: number; y: number; z: number };
    mode: string;
    type: string;
    overlay: string;
  }>(`(async () => {
    const D = window.__viewerDebug;
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector('[data-mode="orbit"]').click();
    await pause(400);
    const before = D.camera();
    document.querySelector('[data-mode="plan2d"]').click();
    await pause(250);
    document.querySelector('[data-mode="plan3d"]').click();
    await pause(250);
    document.querySelector('[data-mode="orbit"]').click();
    await pause(400);
    return JSON.stringify({ before, after: D.camera(), mode: D.mode(), type: D.renderCamera().type, overlay: document.querySelector('[data-jeex="plan-canvas"]').dataset.visible });
  })()`);
  assert(modeRoundTrip.mode === 'orbit', `the 360 button leaves the plan modes | ${modeRoundTrip.mode}`);
  assert(modeRoundTrip.type === 'PerspectiveCamera', `360 restores the perspective camera | ${modeRoundTrip.type}`);
  assert(modeRoundTrip.overlay === 'false', '360 hides the 2D overlay again');
  assert(
    distance(modeRoundTrip.before, modeRoundTrip.after) < 0.05,
    `the orbit pose must survive a detour through 2D and 3D | moved ${distance(modeRoundTrip.before, modeRoundTrip.after).toFixed(3)} m`,
  );
  summary.push('2D -> 3D -> 360 round trip keeps the orbit pose and the perspective camera');

  // ---- View modes 5: an engaged tour still hides its bar behind the drawing ----
  await run(['open', withQuery('view=tour&tour=paused')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const engagedBar = await tourBar();
  assert(engagedBar.visible === 'true', `?view=tour engages the tour and shows its bar | ${JSON.stringify(engagedBar)}`);
  await run(['click', '[data-jeex="reveal-controls"]']);
  await pressControl(ctx, '[data-mode="plan2d"]');
  await waitFor(ctx, PLAN_OVERLAY_SHOWN, 'the 2D overlay to take the viewport');
  const hiddenInPlan = await tourBar();
  assert(hiddenInPlan.visible === 'false', `2D hides the bar of an engaged tour | ${JSON.stringify(hiddenInPlan)}`);
  await pressControl(ctx, '[data-mode="orbit"]');
  await waitFor(ctx, PLAN_OVERLAY_HIDDEN, 'the 2D overlay to give the viewport back');
  // The tour chrome lives in the tour alone: 360 and
  // Walk keep it away even though the clip waits, paused, behind them.
  const hiddenIn360 = await tourBar();
  assert(hiddenIn360.visible === 'false', `360 keeps the bar of a paused tour away | ${JSON.stringify(hiddenIn360)}`);
  await pressControl(ctx, '[data-mode="walk"]');
  const hiddenInWalk = await tourBar();
  assert(hiddenInWalk.visible === 'false', `Walk keeps the bar of a paused tour away | ${JSON.stringify(hiddenInWalk)}`);
  await pressControl(ctx, '[data-mode="tour"]');
  await waitFor(
    ctx,
    `document.querySelector('[data-jeex="tour-bar"]').dataset.visible === "true"`,
    'the Tour button to bring the bar back',
  );
  summary.push('?view=tour: bar shown, hidden in 2D, 360 and Walk, back on Tour');
}
