/**
 * The public tour surface (`handle.tour`) over the stage's camera director.
 *
 * It is created before the camera stack exists and defers to it, so a host can
 * hold `handle.tour` from the moment `mountViewer` returns; a command issued
 * that early is remembered and replayed after the start view
 * (`tour-controls.ts`, `viewer-boot.ts`).
 *
 * Invariant: every call reads the stage at CALL time, so the controls survive
 * a teardown and a Retry, which build a new stage behind the same object.
 */

import { createTourControls, type TourControls, type TourEvents } from '../camera/tour-controls.js';
import type { ViewerEvents } from './viewer-events.js';
import type { ViewerStage } from './viewer-stage.js';

export function stageTourControls(stage: () => ViewerStage | undefined, events: ViewerEvents, tourEvents: TourEvents): TourControls {
  return createTourControls(
    {
      engageTour: () => stage()?.director?.engageTour() ?? null,
      toggleTour: () => stage()?.director?.toggleTour(),
      player: () => stage()?.director?.tour ?? null,
      onSpeed: (speed) => events.emit('tourSpeed', { speed }),
    },
    tourEvents,
  );
}
