/**
 * The vocabulary of user actions the player reports to its anonymous usage
 * counters, and the sink a collaborator reports one through.
 *
 * It lives in the lowest layer so the collaborator that ACCEPTS an action
 * (the editor, the door controller, the camera director, the UI) can report
 * it without knowing that telemetry exists. A report is one accepted action:
 * never set-up, never a no-op, never a repeat of the state already shown.
 * The sink is optional everywhere; absent, nothing is counted.
 *
 * Lowest layer: this module imports nothing.
 */

/** One accepted action. Every member is also a counter key of the telemetry `actions` send. */
export type UsageAction = 'interior' | 'panel' | 'door' | 'fullscreen' | 'minimap' | 'camera_step' | 'tour_complete';

/** Where a collaborator reports an accepted action. */
export type UsageSink = (action: UsageAction) => void;
