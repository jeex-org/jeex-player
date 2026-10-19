/**
 * Browser smoke-check for the viewer: drives the `agent-browser` CLI against a
 * running dev server (`VIEWER_URL`, default `http://127.0.0.1:3700/`, see
 * `browser-check/session.ts`).
 *
 * This file is the RUNNER and nothing else: it resolves the URL, builds the
 * one session every area shares, runs the areas IN ORDER, and closes the
 * browser. Each area lives in `scripts/browser-check/<area>.ts`.
 *
 * Order is part of the contract. An area leaves the page in a state its
 * successor starts from (the doc comment on each says which), so the list
 * below is a sequence, not a set.
 *
 * Invariant: every click target is derived at runtime from the solved plan
 * (`window.__viewerDebug.plan()`, `faces()`, `openings()`) instead of hard-coded
 * metres or pixels, so the check survives edits to the demo apartment. Only the
 * assertions — which room owns a face, which finish lands where — are fixed.
 *
 * Second invariant: the shell is addressed by NAME (`[data-jeex="…"]`), never
 * by id. The viewer builds its own markup and two instances may be on one page,
 * so an id would be ambiguous (`src/ui/viewer-shell.ts`, `page-code.ts`).
 *
 * Third invariant: a step that MUTATES the document (`remove_opening`,
 * `applyOps`, `applyPreset`) is idempotent or guards against re-entry —
 * `agent-browser` retries a failed `eval`, and a retried mutation compounds
 * into a false failure.
 */

import { createContext } from './browser-check/context.js';
import { requireAgentBrowser, resolveViewerUrl } from './browser-check/session.js';
import { nameSelector } from './browser-check/page-code.js';
import { pressControl, waitForCameraStill } from './browser-check/step.js';
import { checkBoot } from './browser-check/boot.js';
import { checkA11y } from './browser-check/a11y.js';
import { checkTourMountModes, checkTourPlayback } from './browser-check/tour.js';
import { checkRoomFocus, checkViewports } from './browser-check/view.js';
import { checkDoors } from './browser-check/doors.js';
import { checkFinishes } from './browser-check/finishes.js';
import { checkEditing } from './browser-check/editing.js';
import { checkPresets } from './browser-check/presets.js';
import { checkViewModes } from './browser-check/view-modes.js';
import { checkSelection } from './browser-check/selection.js';
import { checkDescribeSelection } from './browser-check/describe.js';
import { checkMinimap } from './browser-check/minimap.js';
import { checkGestures } from './browser-check/gestures.js';
import { checkHandle } from './browser-check/handle.js';
import { checkSlots } from './browser-check/slots.js';
import { checkEmbedElement, checkEmbedFrame, checkEmbedTwo } from './browser-check/embed.js';
import { checkContextLoss, checkLoadSceneReady, checkMountCycles, checkTrustedTypes } from './browser-check/lifecycle.js';
import { checkProjectLoad } from './browser-check/project.js';

/** The areas, in the order they must run. */
const AREAS = [
  checkBoot,
  checkTourPlayback,
  checkViewports,
  checkDoors,
  checkFinishes,
  checkEditing,
  checkRoomFocus,
  checkTourMountModes,
  checkPresets,
  checkViewModes,
  checkSelection,
  checkDescribeSelection,
  checkMinimap,
  checkGestures,
  checkHandle,
  checkSlots,
  checkEmbedTwo,
  checkEmbedElement,
  checkEmbedFrame,
  checkMountCycles,
  checkTrustedTypes,
  checkLoadSceneReady,
  checkProjectLoad,
  checkContextLoss,
  checkA11y,
] as const;

const PASSED =
  'Browser smoke-check passed: load, viewport, walk spawn and tap, doors (hover HUD, closing, walk blocking, ?doors=0), tour autoplay, bar and scrubbing, mount options, the scroll-driven embed, floor and per-face wall painting, facade, furniture and opening variants, interior presets and their prop, the five view modes (2D drawing, 3D top view, the 360 round trip, view/minimap props), the select event and setSelection (360 wall pick, plan2d drawing pick, highlight on and off), describeSelection under edits=off (furniture variants with previews and their ops, the floor bank with the finish in force and its scope pair, disjoint opening families, null for a plan node, for a click that landed on nothing and for an unknown id, and no panel opened), the mini-map (hover, click-to-walk, ?minimap=0, the tour following it), the 360 gesture directions, the walk drag-look directions, reset, fullscreen, the handle (modes, focusRoom, locale, loadScene, the walk entry: walkSpawn without a route, the glide to camera 1 that stops there, a PageDown step and its cancel with one) and the chrome props, host slots (none by default, named boxes, hit-test and error-card priority, drag through an empty slot, the anchor against projectPoint, the keyboard guard, edits=emit, and edits=off hiding the interiors button), two independent viewers on one page, the <jeex-viewer> custom element in a shadow root, the iframe host helper over postMessage, WebGL context loss and restore, twenty mount/dispose cycles in one container, ready after a frame of a swapped scene, a baked project by url (dims stand-in, then the GLB, handle.project(), nothing fetched outside the folder), a mount under require-trusted-types-for, no page errors.';

const shotDir = (process.env['SHOT_DIR'] ?? process.env['JEEX_SHOT_DIR'] ?? '/tmp').replace(/\/$/, '');
await Bun.$`mkdir -p ${shotDir}`.quiet();

await requireAgentBrowser();

const ctx = createContext(resolveViewerUrl(), shotDir);
const { run, assert, summary, url } = ctx;

try {
  for (const area of AREAS) {
    // One line per area, so a run that dies mid-way says where it was. The
    // areas are a SEQUENCE (each leaves the page for the next), so the last
    // line printed is the one that failed.
    console.log(`  -- ${area.name}`);
    await area(ctx);
  }

  // The last gesture left the camera in walk mode; the review screenshot
  // below is of the presentation pose, not of a half-turned walk view.
  await run(['open', url]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  await pressControl(ctx, nameSelector('reset-button'));
  // The presentation pose, not "1400 ms after the click": the screenshot is of
  // where the reset flight LANDED.
  await waitForCameraStill(ctx, 'the reset flight to land before the review screenshot');

  const errors = await run(['errors']);
  assert(!errors.output.trim(), 'page should not report browser errors');
  await run(['screenshot', `${shotDir}/jeex-browser-check.png`]);
  for (const line of summary) console.log(`  ${line}`);
  console.log(PASSED);
} catch (error) {
  // Setting the exit code (rather than only letting the throw reach the top
  // level) survives a failure mode a bare uncaught rejection does not: a
  // lingering handle from a spawned `agent-browser` session (a lagging pipe
  // read, a busy single-tenant daemon still draining a transport retry) can
  // keep the event loop alive past this script's own work, so the process
  // never gets to the point where Bun's default "uncaught rejection -> exit
  // 1" behaviour applies on its own. If something external then tears the
  // process down once it looks idle, THAT termination is what a caller
  // observes — not this failure. `process.exit()` right after `finally`
  // below removes that gap by ending the process itself, immediately, with
  // the code this run actually earned.
  process.exitCode = 1;
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  await run(['close']).catch(() => undefined);
}

process.exit(process.exitCode ?? 0);
