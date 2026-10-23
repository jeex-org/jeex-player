/**
 * The stage's dependency bag minus its `director` half (`director-wiring.ts`
 * owns that): which collaborator answers what the renderer, the plan modes,
 * the mini-map, the selection and the tour-camera overlay raise.
 *
 * It is a table, not behaviour, like every other wiring module on this layer —
 * the composition root keeps the object graph, this keeps the map from it to
 * `ViewerStageDeps`, which is the part that grew every time the stage learnt a
 * new collaborator.
 *
 * Invariant: nothing here holds state and nothing reaches back. Every field is
 * a collaborator handed in or a late-bound read of one.
 */

import type { UsageSink } from '../shared/usage.js';
import type { ViewerStageDeps } from './viewer-stage.js';
import type { ViewerOptions } from './viewer-options.js';
import type { ViewerRoots } from '../ui/viewer-shell.js';
import type { FullscreenController } from '../ui/fullscreen-controller.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import type { ViewerEvents } from './viewer-events.js';
import type { SceneMount } from './scene-mount.js';
import type { DoorController } from './door-controller.js';
import type { TourEvents } from '../camera/tour-controls.js';
import type { Picker } from '../geometry/picker.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { Messages } from '../ui/messages.js';
import { toViewerError } from './viewer-events.js';
import { directorWiring } from './director-wiring.js';
import { checkpointsWiring } from './checkpoints-wiring.js';

type StageWiringDeps = {
  /** Hears accepted map and camera use (`shared/usage.ts`). */
  usage?: UsageSink | undefined;
  roots: ViewerRoots;
  viewport: FullscreenController;
  messages: Messages;
  dollhouse: Dollhouse;
  options: ViewerOptions;
  events: ViewerEvents;
  mount: SceneMount;
  picker: Picker;
  ui: ViewerUI;
  doors: DoorController;
  tourEvents: TourEvents;
  /** The mount's lifetime signal (`ViewerContext.signal`). */
  signal: AbortSignal;
  onContextLost: () => void;
  onContextRestored: () => void;
  /** The late-bound stage, for the wiring bags that read the camera stack. */
  stage: () => import('./viewer-stage.js').ViewerStage | undefined;
  checkpointsVisible: () => boolean;
  /** The host commands, for the tour-camera tool's own buttons (frame, look through, done). */
  handle: () => import('./handle-commands.js').HandleCommands;
};

/**
 * The WHOLE stage dependency bag, its director half included (through
 * `director-wiring.ts`, which keeps the camera callback map).
 */
export function stageWiring(deps: StageWiringDeps): ViewerStageDeps {
  return {
    roots: deps.roots,
    viewport: deps.viewport,
    messages: deps.messages,
    dollhouse: deps.dollhouse,
    minimapEnabled: () => deps.options.view.minimap,
    // Fullscreen shows the control bar whatever `chrome.controls` says, and the
    // walk's camera buttons with it.
    walkCamerasEnabled: () => deps.options.chrome.controls || deps.viewport.isFullscreen(),
    planOptions: () => deps.options.plan,
    assetFacts: () => deps.mount.assetFacts(),
    onRoomPicked: (roomId) => {
      if (deps.stage()?.director?.travelToRoom(roomId) === true) deps.usage?.('minimap');
    },
    usage: deps.usage,
    artificialLights: (root) => deps.handle().lightTemperature.apply(root),
    onContextLost: deps.onContextLost,
    onContextRestored: deps.onContextRestored,
    signal: deps.signal,
    onFrameError: (error) => deps.events.emit('error', toViewerError('internal', error, deps.messages.t('error.unknown'))),
    selection: { listen: deps.options.select, emit: (selection) => deps.events.emit('select', selection) },
    checkpoints: checkpointsWiring({
      visible: deps.checkpointsVisible,
      events: deps.events,
      mount: () => deps.mount,
      stage: deps.stage,
      handle: deps.handle,
      ui: deps.ui,
    }),
    director: directorWiring({
      options: deps.options,
      picker: deps.picker,
      ui: deps.ui,
      doors: deps.doors,
      mount: deps.mount,
      tourEvents: deps.tourEvents,
      events: deps.events,
      model: () => deps.mount.model!,
    }),
  };
}
