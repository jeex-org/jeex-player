/**
 * Everything DERIVED from a document, re-seeded in one pass.
 *
 * It runs after every mount and after every plan-level rebuild: the brand line,
 * the dollhouse shell, the camera stack (obstacles, orbit home, tour route),
 * the doors, the interiors selector, the furniture toggle and the debug API.
 *
 * Atomicity invariant, and the reason this is one function rather than a
 * scattering of listeners: a ceiling-, opening- or plan-changing revision
 * re-seeds EVERY consumer of the plan together (one owner of the data). A
 * consumer re-seeded a frame late is a consumer holding a route
 * through a doorway that no longer exists.
 *
 * The `scene` event is emitted last, so a host that reads the viewer back on
 * hearing it sees a viewer that has finished changing.
 */

import { effectiveEditsMode } from './edits-wiring.js';
import { debugHostFor } from './debug-parts.js';
import { replayPendingTourCommand, type TourControls } from '../camera/tour-controls.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import type { DoorController } from './door-controller.js';
import type { Messages } from '../ui/messages.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { SceneMount } from './scene-mount.js';
import type { ViewerOptions } from './viewer-options.js';
import type { ViewerPageGlobals } from './viewer-page-globals.js';
import type { ViewerStage } from './viewer-stage.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { FullscreenController } from '../ui/fullscreen-controller.js';
import type { ProjectLibraryManifest } from '../assets/project-manifest.js';

/** What re-seeding needs of the running viewer. */
type DocumentWiringDeps = {
  ui: ViewerUI;
  options: ViewerOptions;
  dollhouse: Dollhouse;
  /** `undefined` between `teardown()` and the next boot. */
  stage: () => ViewerStage | undefined;
  doors: DoorController;
  shell: FullscreenController;
  mount: SceneMount;
  tour: TourControls;
  globals: ViewerPageGlobals;
  messages: () => Messages;
  furnitureVisible: () => boolean;
  /** The loaded bake's object bank for the debug layout linter; absent for a bare scene. */
  projectLibrary: () => ProjectLibraryManifest | undefined;
  /** Pushes the authoritative furniture state onto a freshly built group. */
  reapplyFurniture: () => void;
  emitScene: (info: { sceneId: string; rev: number }) => void;
};

export function seedForDocument(deps: DocumentWiringDeps, model: SceneModel): void {
  const stage = deps.stage();
  deps.ui.setSceneName(model.scene.name);
  // The canvas's screen-reader description, rebuilt on every
  // document — a scene swap must not leave the previous apartment's room
  // list describing the one now on screen.
  deps.ui.setCanvasDescription(
    model.scene.name,
    model.scene.rooms.map((room) => room.name),
  );
  deps.dollhouse.setState(deps.dollhouse.state, stage?.camera);
  stage?.setDocument(model, () => deps.mount.sceneRoot);
  deps.doors.seed();
  // A host may have driven the tour before there was a clip to drive.
  replayPendingTourCommand(deps.tour);
  // The selector exists only where all three agree: the host asked for it, the
  // scene ships interiors to choose between, and `edits` allows a panel at all
  // (under `'off'` the affordance itself is hidden, not only its effect — the
  // chrome is a view, so the decision is pushed in here).
  // `readonly` counts as `'off'` (`effectiveEditsMode`).
  deps.ui.setInteriorsAvailable(
    deps.options.interiors.selector && effectiveEditsMode(deps.options) !== 'off' && (model.scene.interiors?.length ?? 0) > 0,
  );
  deps.reapplyFurniture();
  installDebugApi(deps, model);
  deps.emitScene({ sceneId: model.scene.id, rev: model.rev });
}

/** `window.__viewerDebug` for the document now on screen (`viewer-debug.ts`). */
function installDebugApi(deps: DocumentWiringDeps, model: SceneModel): void {
  deps.globals.installDebug(
    debugHostFor(model, {
      options: deps.options,
      mount: deps.mount,
      doors: deps.doors,
      shell: deps.shell,
      tour: deps.tour,
      messages: deps.messages,
      stage: deps.stage,
      furnitureVisible: deps.furnitureVisible,
      projectLibrary: deps.projectLibrary,
    }),
  );
}
