/**
 * Which collaborator answers each role of `window.__viewerDebug`.
 *
 * The same kind of table as `director-wiring.ts`: one hop per entry, no
 * behaviour, and one judgement — `capabilities` is the mount OPTION, never a
 * read of the host page's URL, which is what keeps the authoring calls
 * (`applyOps`, `exportScene`, `loadScene`) off a production page whatever its
 * query string says (`viewer-options.ts`, `viewer-debug.ts`).
 *
 * Invariant: every entry is a GETTER, read on each call into the debug surface.
 * The stage, the built root, the editor and the document are all replaced by a
 * Retry or a `loadScene`, and anything captured when the API was installed
 * would keep answering for the viewer that used to be there. There is exactly
 * one place a value is captured — the `model` the mount was called with — and
 * it is captured because `installDebug` is re-run per document.
 */

import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { SceneModel } from '../scene/scene-model.js';
import type { Messages } from '../ui/messages.js';
import type { SceneMount } from './scene-mount.js';
import type { DoorController } from './door-controller.js';
import type { TourControls } from '../camera/tour-controls.js';
import type { ViewerDebugHost } from './viewer-debug.js';
import type { ProjectLibraryManifest } from '../assets/project-manifest.js';
import type { ViewerOptions } from './viewer-options.js';
import type { ViewerStage } from './viewer-stage.js';
import type { FullscreenController } from '../ui/fullscreen-controller.js';

type DebugPartsDeps = {
  options: ViewerOptions;
  mount: SceneMount;
  doors: DoorController;
  shell: FullscreenController;
  tour: TourControls;
  messages: () => Messages;
  stage: () => ViewerStage | undefined;
  furnitureVisible: () => boolean;
  /** The loaded bake's object bank for the layout linter; absent for a bare scene. */
  projectLibrary: () => ProjectLibraryManifest | undefined;
};

/** The composed host `ViewerPageGlobals.installDebug` installs the surface over. */
export function debugHostFor(model: SceneModel, deps: DebugPartsDeps): ViewerDebugHost {
  const stage = deps.stage;
  return {
    // ---- SceneDebug
    model: () => model,
    getScene: () => model.toJSON(),
    sceneRoot: () => deps.mount.sceneRoot,
    builder: () => deps.mount.builder,
    editor: () => deps.mount.editor,
    sun: () => deps.mount.sunShadow,
    furnitureVisible: () => deps.furnitureVisible(),
    messages: () => deps.messages(),
    projectLibrary: () => deps.projectLibrary(),

    // ---- CameraDebug
    camera: () => stage()?.camera,
    renderCamera: () => stage()?.planModes.activeCamera() ?? stage()?.camera,
    viewport: () => deps.shell,
    director: () => stage()?.director,
    routeToRoom: (roomId) => stage()?.director?.routeToRoom(roomId) ?? null,
    travelPath: (roomId) => stage()?.director?.travelPath(roomId) ?? null,
    pickCamera: () => stage()?.planModes.pickCamera(),
    checkpointOverlay: () => stage()?.overlay.group,
    selection: () => stage()?.selection.current() ?? null,
    assetMove: () => stage()?.assetMove?.debug() ?? null,

    // ---- DoorDebug
    doors: () => deps.doors.list(),
    doorAutomation: () => deps.doors.pending(),
    toggleDoor: (openingId) => deps.doors.toggle(openingId),
    doorScreenPoint: (openingId) => deps.doors.screenPoint(openingId),

    // ---- MinimapDebug
    minimap: () => stage()?.minimap.state() ?? { visible: false, camera: null, hoverRoom: null },
    minimapRoomPoint: (roomId) => stage()?.minimap.roomPoint(roomId) ?? null,

    // ---- TourDebug
    tour: () => deps.tour,

    // ---- AuthoringDebug
    capabilities: () => deps.options.debug,
    loadScene: (input) => {
      deps.mount.mount(SceneModel.load(input, CATALOGUE_REGISTRIES));
      return true;
    },
  };
}
