/**
 * How the camera FEELS, as one named record.
 *
 * Every interaction literal the camera modes use lives here: sensitivities,
 * clamps, speeds, the double-tap window, the field-of-view policy and the
 * smoothing constants. Spread through the rigs as bare numbers they were
 * unfindable — `0.008` and `0.006` are the same kind of thing on two different
 * axes of two different modes — and two of them (the orbit φ clamp) were
 * written out three times, so a tuning pass could move one and leave the
 * others behind.
 *
 * Invariant: nothing here is derived from the scene. A value that depends on
 * the apartment (eye height, room centres, obstacle sizes) belongs to
 * `navigation.ts` and the plan, not to the feel.
 *
 * Pure module: no `three`, no DOM.
 */

type CameraTuning = {
  orbit: {
    /** Radians the rig turns per pointer pixel of drag, both axes. */
    dragRadPerPx: number;
    /** Metres the target pans per pointer pixel, per metre of orbit radius. */
    panScalePerRadius: number;
    /** Exponential zoom rate per wheel pixel: `radius *= exp(deltaY * rate)`. */
    zoomRatePerPx: number;
    /** Share of the remaining distance the camera closes per 1/60 s frame. */
    smoothing: number;
    /** Polar-angle clamp, radians: straight down is 0, the horizon is π/2. */
    phiMin: number;
    phiMax: number;
    /** Closest a double-click focus may pull the camera in, metres. */
    focusMinRadiusM: number;
    /** Share of the current radius a focus keeps, before the minimum applies. */
    focusRadiusFactor: number;
    /** Length of the focus flight, seconds. */
    focusDurationS: number;
    /** Height above the floor a focus aims at, metres (roughly a table top). */
    focusHeightM: number;
    /** Orbit distance clamp, metres. */
    minRadiusM: number;
    maxRadiusM: number;
    /** The rig's own starting spherical coordinates, before the first sync. */
    startRadiusM: number;
    startThetaRad: number;
    startPhiRad: number;
    /** Default length of `flyTo`, and of the fly-in to a room camera, seconds. */
    flyDurationS: number;
    roomFlyDurationS: number;
    /** WASD/arrows pan the target this many orbit radii per second. */
    keyPanRadiiPerS: number;
  };
  walk: {
    /** Radians of yaw per pointer pixel dragged sideways. */
    lookRadPerPx: number;
    /** Radians of pitch per pointer pixel dragged up or down. */
    pitchRadPerPx: number;
    /** Pitch clamp, radians; negative is looking down. */
    pitchMin: number;
    pitchMax: number;
    /** Walking and running speeds, metres per second. */
    speedMps: number;
    runSpeedMps: number;
    /** How far ahead of the eye the gaze point sits, metres. */
    gazeDistanceM: number;
    /** How close a tapped destination counts as reached, metres. */
    arriveM: number;
    /** How long pushing at a latched door reads as intent, seconds. */
    doorPushS: number;
    /** Shortest gap between two "the door is closed" hints, milliseconds. */
    doorHintThrottleMs: number;
    /** A MOVE drag (Space/Shift/right button, two fingers): metres per pointer pixel. */
    dragMoveMPerPx: number;
    /** One mouse-wheel notch (`wheelNotchPx`) walks this far, metres. */
    wheelStepM: number;
    /** A wheel delta this large is one notch; a larger one is still one step. */
    wheelNotchPx: number;
    /** A sideways trackpad swipe or a shift-wheel: metres per scrolled pixel. */
    wheelPanMPerPx: number;
    /** Share of a wheel step's remainder glided out per second (the tap approach's shape). */
    wheelGlideRate: number;
    /** A touch pinch walks this far per e-fold of finger spread, metres. */
    pinchMPerLog: number;
    /** `+`/`-` change the walk field of view by this much per press, degrees. */
    fovStepDeg: number;
    /** The walk field of view `+`/`-` may reach, degrees. */
    fovMinDeg: number;
    fovMaxDeg: number;
  };
  tap: {
    /** Longest gap between two taps for the second to be a double tap, ms. */
    doubleWindowMs: number;
    /** How near the first tap the second has to land to be a double, metres. */
    doubleRadiusM: number;
    /** Exponential approach rate of a single and of a double tap, per second. */
    singleRate: number;
    doubleRate: number;
  };
  fov: {
    /** Vertical field of view of the dollhouse overview, degrees. */
    wide: number;
    /** Vertical field of view on a portrait viewport, degrees. */
    portrait: number;
    /** Aspect ratio below which the viewport counts as portrait. */
    portraitAspect: number;
    /** Extra degrees blended in as the camera drops to eye level. */
    eyeLevelBoost: number;
    /** Height the boost starts from and the span it is spread over, metres. */
    boostTopM: number;
    boostSpanM: number;
  };
  travel: {
    /** Pace of a scripted travel, metres per second: one steady walk. */
    speedMps: number;
    /** Two route waypoints closer than this are one waypoint, metres. */
    mergeM: number;
    /** How far from each end the travel eases in and out, metres. */
    easeM: number;
    /** Speed at the first and last frame, as a share of `speedMps`. */
    easeFloor: number;
    /** Share of a SHORT path each ease may take, so the middle is full speed. */
    easeSpan: number;
    /** How far ahead on the curve the scripted gaze aims, metres. */
    lookAheadM: number;
    /** Time constant of the scripted yaw and pitch easing, seconds. */
    lookTauS: number;
    /** How long a travel waits at a door that will not open, seconds. */
    doorWaitS: number;
  };
  hover: {
    /** How often a RESTING pointer is re-tested against the scene, ms. */
    heartbeatMs: number;
  };
  wheel: {
    /** One line of wheel travel in CSS pixels (`WheelEvent.DOM_DELTA_LINE`). */
    linePx: number;
    /** Viewport height assumed for a page-mode wheel with no canvas size yet. */
    pageFallbackPx: number;
  };
  pointer: {
    /** Pixels of travel beyond which a press is a drag and not a click. */
    dragThresholdPx: number;
  };
  /** Longest frame any rig integrates, seconds: a stalled tab must not teleport. */
  maxFrameStepS: number;
};

/**
 * Camera frustum, metres: near enough for a doorway, far enough for the site.
 * Lived as private constants of `app/viewer-stage.ts` until the camera-preview
 * needed the same two numbers for its own camera — a second copy of a frustum
 * is a preview that clips where the main view does not.
 */
export const NEAR_PLANE_M = 0.1;
export const FAR_PLANE_M = 160;

export const CAMERA_TUNING: Readonly<CameraTuning> = Object.freeze({
  orbit: Object.freeze({
    dragRadPerPx: 0.008,
    panScalePerRadius: 0.0012,
    zoomRatePerPx: 0.0016,
    smoothing: 0.22,
    phiMin: 0.3,
    phiMax: 1.45,
    focusMinRadiusM: 3.4,
    focusRadiusFactor: 0.6,
    focusDurationS: 0.9,
    focusHeightM: 0.6,
    minRadiusM: 2.2,
    maxRadiusM: 46,
    startRadiusM: 27,
    startThetaRad: Math.PI / 4,
    startPhiRad: 1.03,
    keyPanRadiiPerS: 0.35,
    flyDurationS: 1.1,
    roomFlyDurationS: 1.15,
  }),
  walk: Object.freeze({
    lookRadPerPx: 0.006,
    pitchRadPerPx: 0.004,
    pitchMin: -0.72,
    pitchMax: 0.65,
    speedMps: 2.35,
    runSpeedMps: 4.1,
    gazeDistanceM: 4,
    arriveM: 0.05,
    doorPushS: 0.4,
    doorHintThrottleMs: 1200,
    dragMoveMPerPx: 0.01,
    wheelStepM: 0.5,
    wheelNotchPx: 100,
    wheelPanMPerPx: 0.005,
    wheelGlideRate: 9,
    pinchMPerLog: 2.5,
    fovStepDeg: 5,
    fovMinDeg: 25,
    fovMaxDeg: 95,
  }),
  tap: Object.freeze({
    doubleWindowMs: 340,
    doubleRadiusM: 1,
    singleRate: 2.9,
    doubleRate: 6.8,
  }),
  fov: Object.freeze({
    wide: 42,
    portrait: 58,
    portraitAspect: 0.8,
    eyeLevelBoost: 11,
    boostTopM: 5.2,
    boostSpanM: 3.4,
  }),
  travel: Object.freeze({
    speedMps: 1.8,
    mergeM: 0.12,
    easeM: 0.6,
    easeFloor: 0.18,
    easeSpan: 0.3,
    lookAheadM: 0.8,
    lookTauS: 0.18,
    doorWaitS: 2.0,
  }),
  hover: Object.freeze({ heartbeatMs: 150 }),
  wheel: Object.freeze({ linePx: 16, pageFallbackPx: 400 }),
  pointer: Object.freeze({ dragThresholdPx: 3 }),
  maxFrameStepS: 0.1,
});

/**
 * Vertical field of view for a camera at `heightM` on a viewport of `aspect`,
 * degrees.
 *
 * Wider at eye level: interiors feel less zoomed-in, and the transition from
 * the dollhouse overview to the walkthrough is gradual rather than a cut. A
 * portrait viewport starts wider still, because a narrow frame crops the room.
 */
export function fieldOfViewFor(aspect: number, heightM: number): number {
  const { fov } = CAMERA_TUNING;
  const base = aspect < fov.portraitAspect ? fov.portrait : fov.wide;
  const blend = Math.min(1, Math.max(0, (fov.boostTopM - heightM) / fov.boostSpanM));
  return base + blend * fov.eyeLevelBoost;
}
