/**
 * The camera director's wiring: which collaborator answers each of the
 * callbacks the camera stack raises.
 *
 * It is a table, not behaviour. Every entry is one hop — a pick goes to the
 * editor and to the doors, a hover to the doors, a tour state to the public
 * fan-out — and the only judgement in the file is the two `options` reads that
 * turn a whole callback off. `viewer-app.ts` keeps the object graph; this keeps
 * the map from it to `CameraStackDeps`, which is the part that grew every time
 * the camera learnt a new signal.
 *
 * Invariant: nothing here holds state and nothing reaches back. The composition
 * root passes the collaborators in and this returns the bag the stage forwards.
 */

import type { ViewerStageDeps } from './viewer-stage.js';
import type { ViewerOptions } from './viewer-options.js';
import { effectiveEditsMode } from './edits-wiring.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { DoorController } from './door-controller.js';
import type { SceneMount } from './scene-mount.js';
import type { TourEvents } from '../camera/tour-controls.js';
import type { Picker } from '../geometry/picker.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { ViewerEvents } from './viewer-events.js';

type DirectorWiringDeps = {
  options: ViewerOptions;
  picker: Picker;
  ui: ViewerUI;
  doors: DoorController;
  mount: SceneMount;
  tourEvents: TourEvents;
  /** The public fan-out; the walk's current camera goes to it (`walkCamera`). */
  events: ViewerEvents;
  /** The committed document; the camera stack is only ever built after one. */
  model: () => SceneModel;
};

/** The `director` half of `ViewerStageDeps`, wired to one mounted viewer. */
export function directorWiring(deps: DirectorWiringDeps): ViewerStageDeps['director'] {
  const { doors, mount, options } = deps;
  // `edits: 'off'` — a click reports through `select` and opens nothing
  // at all. The panels are never even asked, so nothing has to know how to
  // close them again. `readonly` reads as `'off'` here (`effectiveEditsMode`).
  const editable = effectiveEditsMode(options) !== 'off';
  return {
    picker: deps.picker,
    ui: deps.ui,
    scene: () => deps.model().scene,
    plan: () => deps.model().plan,
    assetFacts: () => mount.assetFacts(),
    onSurfacePicked: (pick, x, y) => {
      // A click on a door still opens the variant panel; the HUD it also raises
      // is what a touch device gets instead of a hover. `doors.showFor` is
      // deliberately OUTSIDE the `edits` gate: the door button is an
      // affordance of the door, not a panel, and `edits: 'off'` turns off the
      // viewer's own editing panels, nothing else.
      if (pick?.surface === 'opening' && pick.openingId) doors.showFor(pick.openingId);
      if (editable) mount.editor?.handleSurfacePick(pick, x, y);
    },
    onFurniturePicked: (assetId) => {
      if (editable) mount.editor?.handleFurniturePick(assetId);
    },
    onHover: options.doors.interactive ? (pick) => doors.hover(pick?.surface === 'opening' ? (pick.openingId ?? null) : null) : undefined,
    onOpeningTapped: (openingId) => doors.showFor(openingId),
    // Two sets, because a door that opens by itself stops the walker for a
    // moment without closing the way (`door-controller.ts`).
    closedDoors: () => doors.closedIds(),
    lockedDoors: () => doors.lockedIds(),
    rearmDoor: (openingId) => doors.rearm(openingId),
    pauseOnInput: options.tour.pauseOnInput,
    interaction: options.interaction,
    onTourState: (state) => deps.tourEvents.emitState(state),
    onTourProgress: (progress) => deps.tourEvents.emitProgress(progress),
    onWalkCamera: (camera) => deps.events.emit('walkCamera', camera),
  };
}
