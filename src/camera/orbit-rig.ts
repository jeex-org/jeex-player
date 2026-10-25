/**
 * The dollhouse rig: a camera on a sphere around a target on the floor plane.
 *
 * State is spherical (`theta`, `phi`, `radius`) plus the target, and the
 * camera position is DERIVED from it every frame and smoothed towards, so a
 * gesture never fights the tween and a tween never fights a gesture — starting
 * one cancels the other.
 *
 * The one rule its gestures obey is THE SCENE FOLLOWS THE FINGERS: drag right
 * and the near half of
 * the scene goes right, pan and the point under the pointer stays under it,
 * the target holds the screen centre through a rotation, and a wheel or a
 * pinch closes in on the scene point under the cursor (or between the
 * fingers), which stays where it is on screen.
 * The signs here are verified by projecting a fixed world point through the
 * real camera in `orbit-rig.test.ts`, never argued about — a state-only
 * assertion ("the camera moved") passes happily on an inverted control.
 */

import * as THREE from 'three';
import { smoothstep } from '../shared/math.js';
import { CAMERA_TUNING } from './camera-tuning.js';
import { MOVE_KEYS, keyDirection } from './camera-input.js';
import type { Picker, SurfacePick } from '../geometry/picker.js';

const { orbit: ORBIT } = CAMERA_TUNING;

// Module-level scratch vectors: `update()` runs every frame and
// `pan()` runs on every drag/wheel event; none of these values are ever
// retained beyond the call that computes them.
/** Scratch: `update()`'s eased camera position, recomputed every frame. */
const SCRATCH_NEXT = new THREE.Vector3();
/** Scratch: `pan()`'s camera-relative basis, recomputed every pan. */
const SCRATCH_FORWARD = new THREE.Vector3();
const SCRATCH_RIGHT = new THREE.Vector3();
/** Scratch: `focusAt()`'s fly-to point and direction, recomputed once per double-click. */
const SCRATCH_FOCUS = new THREE.Vector3();
const SCRATCH_FOCUS_DIR = new THREE.Vector3();
const SCRATCH_FOCUS_POSITION = new THREE.Vector3();
/** Scratch: the camera standing at the rig's own pose, which a zoom casts its cursor ray from. */
const SCRATCH_POSE_CAMERA = new THREE.PerspectiveCamera();
/** Scratch: the scene point a zoom closes in on, and the level it falls back to. */
const SCRATCH_ANCHOR = new THREE.Vector3();
const SCRATCH_LEVEL = new THREE.Plane();
const UP = new THREE.Vector3(0, 1, 0);
/** Scratch: the cursor in normalised device coordinates, and the correction pass's vectors. */
const SCRATCH_NDC = new THREE.Vector3();
const SCRATCH_FORWARD_EYE = new THREE.Vector3();
const SCRATCH_ALONG = new THREE.Vector3();
const SCRATCH_ON_RAY = new THREE.Vector3();
/** Passes of the field-of-view correction; each shrinks the residual by far more than ten. */
const FOV_CORRECTION_PASSES = 3;

/** A pointer position in client pixels, the way `camera-input.ts` reports it. */
export type ClientPoint = { readonly x: number; readonly y: number };

/**
 * The clamped spherical pose (`radius`, `phi`, `theta`) `position` has around
 * `target` — what `flyTo`'s tween end state and `snapTo`'s one-frame jump
 * both derive their final pose from, so the two answer the SAME clamps the
 * same way.
 */
function sphericalPose(position: THREE.Vector3, target: THREE.Vector3): { radius: number; phi: number; theta: number } {
  const offset = position.clone().sub(target);
  const radius = THREE.MathUtils.clamp(offset.length(), ORBIT.minRadiusM, ORBIT.maxRadiusM);
  const phi = THREE.MathUtils.clamp(
    Math.acos(THREE.MathUtils.clamp(offset.y / Math.max(offset.length(), 0.001), -1, 1)),
    ORBIT.phiMin,
    ORBIT.phiMax,
  );
  const theta = Math.atan2(offset.x, offset.z);
  return { radius, phi, theta };
}

/** A flight from the pose the rig has to the pose it was asked for. */
type OrbitTween = {
  elapsed: number;
  duration: number;
  fromTheta: number;
  toTheta: number;
  fromPhi: number;
  toPhi: number;
  fromRadius: number;
  toRadius: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
};

/** What a 360-mode tap tells the application; a subset of the controller's own. */
type OrbitCallbacks = {
  onSurfacePicked?: ((pick: SurfacePick | null, clientX: number, clientY: number) => void) | undefined;
  onFurniturePicked?: ((assetId: string | null) => void) | undefined;
};

type OrbitDeps = {
  camera: THREE.PerspectiveCamera;
  picker: Picker;
  callbacks: OrbitCallbacks;
  /**
   * The vertical field of view, degrees, the controller gives a camera standing
   * `heightM` above the floor (`fieldOfViewFor`: wider near eye level). A zoom
   * that changes the height changes the view, and the point under the cursor
   * is held through both. Absent: the camera's field of view never changes.
   */
  fieldOfView?: ((heightM: number) => number) | undefined;
};

export class OrbitRig {
  private readonly deps: OrbitDeps;
  private readonly camera: THREE.PerspectiveCamera;
  /**
   * What the rig orbits, and what the camera looks at every frame. Live, so a
   * caller may read it without allocating; write it through `setTarget`.
   */
  readonly target = new THREE.Vector3();
  private radius = ORBIT.startRadiusM;
  private theta = ORBIT.startThetaRad;
  private phi = ORBIT.startPhiRad;
  private tween: OrbitTween | null = null;
  /** Whether the drag in progress moves the target instead of turning the rig. */
  private panning = false;
  /** Movement keys held down: WASD/arrows pan the target. */
  private readonly keys = new Set<string>();

  constructor(deps: OrbitDeps) {
    this.deps = deps;
    this.camera = deps.camera;
  }

  /**
   * A tap: hands the picker's answer to the application, through exactly ONE
   * callback. Selecting an object already drops the previous selection, so no
   * leading `null` call is needed to clear the other kind — and such a call
   * would clear the selection before the editor could tell a second tap on
   * the selected object (which deselects it) from a first. A miss reports
   * `null` to both.
   */
  tap(clientX: number, clientY: number): void {
    const { callbacks } = this.deps;
    const pick: SurfacePick | null = this.deps.picker.pickSurface(clientX, clientY, this.camera);
    if (!pick) {
      callbacks.onSurfacePicked?.(null, clientX, clientY);
      callbacks.onFurniturePicked?.(null);
      return;
    }
    if (pick.surface === 'furniture') {
      callbacks.onFurniturePicked?.(pick.assetId ?? null);
      return;
    }
    callbacks.onSurfacePicked?.(pick, clientX, clientY);
  }

  setTarget(point: THREE.Vector3): void {
    this.target.copy(point);
  }

  /** Drops any flight in progress; a gesture always outranks a tween. */
  cancelTween(): void {
    this.tween = null;
  }

  /** Puts the camera at `position` looking at `target`, and reads the rig back off it. */
  reset(position: THREE.Vector3, target: THREE.Vector3): void {
    this.tween = null;
    this.camera.position.copy(position);
    this.target.copy(target);
    this.camera.lookAt(this.target);
    this.syncFromCamera();
  }

  /**
   * Reads the spherical state back off the camera, so the rig picks up
   * wherever another mode left the camera standing instead of snapping it back
   * to the pose it had before.
   */
  syncFromCamera(): void {
    const offset = this.camera.position.clone().sub(this.target);
    this.radius = THREE.MathUtils.clamp(offset.length(), ORBIT.minRadiusM, ORBIT.maxRadiusM);
    this.phi = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(offset.y / this.radius, -1, 1)), ORBIT.phiMin, ORBIT.phiMax);
    this.theta = Math.atan2(offset.x, offset.z);
  }

  /**
   * Smoothly flies to a pose (room focus, double click, `flyToRoom`). The
   * azimuth is unwrapped to the shorter way round, so a flight across the
   * ±π seam does not spin the whole way back.
   */
  flyTo(position: THREE.Vector3, target: THREE.Vector3, duration: number): void {
    const { radius, phi, theta } = sphericalPose(position, target);
    const fromTheta = this.theta;
    let deltaTheta = theta - fromTheta;
    while (deltaTheta > Math.PI) deltaTheta -= Math.PI * 2;
    while (deltaTheta < -Math.PI) deltaTheta += Math.PI * 2;
    this.tween = {
      elapsed: 0,
      duration,
      fromTheta,
      toTheta: fromTheta + deltaTheta,
      fromPhi: this.phi,
      toPhi: phi,
      fromRadius: this.radius,
      toRadius: radius,
      fromTarget: this.target.clone(),
      toTarget: target.clone(),
    };
  }

  /**
   * Puts the camera exactly where a COMPLETED `flyTo` would leave it, in one
   * call (reduced motion). The position is derived FORWARD
   * from the same clamped spherical pose `update()` itself derives from every
   * frame, so the very next `update()` finds `next` already equal to
   * `camera.position` and its smoothing filter has nothing left to close —
   * unlike `reset()`, whose `syncFromCamera` reads the pose BACK off a raw
   * position and can drift from it the moment a clamp applies, which is
   * exactly the visible one-frame jump this method exists to avoid.
   */
  snapTo(position: THREE.Vector3, target: THREE.Vector3): void {
    this.tween = null;
    const { radius, phi, theta } = sphericalPose(position, target);
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
    this.target.copy(target);
    const sinPhi = Math.sin(phi);
    this.camera.position.set(
      target.x + radius * sinPhi * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * sinPhi * Math.cos(theta),
    );
    this.camera.lookAt(this.target);
  }

  /**
   * Double click: fly in on a point on the floor, keeping the bearing the rig
   * already has, so the view closes in rather than swinging round.
   */
  focusAt(point: THREE.Vector3): void {
    const focus = SCRATCH_FOCUS.set(point.x, ORBIT.focusHeightM, point.z);
    const direction = SCRATCH_FOCUS_DIR.set(Math.sin(this.theta), 0, Math.cos(this.theta));
    const radius = Math.max(ORBIT.focusMinRadiusM, this.radius * ORBIT.focusRadiusFactor);
    // `flyTo` clones both arguments internally, so handing it the scratch
    // vectors directly is safe — neither is retained past this call.
    this.flyTo(SCRATCH_FOCUS_POSITION.copy(focus).addScaledVector(direction, radius), focus, ORBIT.focusDurationS);
  }

  /**
   * A press latches what the drag will be: the button cannot be read off a
   * move. `move` is the secondary button, Shift or Space held at the press
   * (`camera-input.ts`): all three pan.
   */
  press(move: boolean): void {
    this.panning = move;
  }

  release(): void {
    this.panning = false;
  }

  /**
   * One pointer's travel. A two-finger gesture pans by the movement of its
   * CENTROID, not by this pointer's: each finger fires its own `pointermove`,
   * so panning by `dx`/`dy` here applied the full finger travel twice per
   * visual step.
   */
  drag(dx: number, dy: number, pointers: number, centroid: { dx: number; dy: number } | null): void {
    if (pointers >= 2) {
      if (centroid) this.pan(centroid.dx, centroid.dy);
      return;
    }
    if (this.panning) {
      this.pan(dx, dy);
      return;
    }
    this.theta -= dx * ORBIT.dragRadPerPx;
    this.phi = THREE.MathUtils.clamp(this.phi - dy * ORBIT.dragRadPerPx, ORBIT.phiMin, ORBIT.phiMax);
    this.tween = null;
  }

  /**
   * Two fingers changing their separation: the distance follows them, closing
   * in on the scene point between the fingers (`at`) when there is one.
   */
  pinch(scale: number, at?: ClientPoint): void {
    this.tween = null;
    this.dolly(this.radius * scale, at);
  }

  /**
   * Camera-relative panning so the scene always follows the pointer, whatever
   * the azimuth. `dx`/`dy` are POINTER pixels — where the finger went, +y down
   * — and `camera-input.ts` has already negated the scroll deltas of a wheel
   * gesture, which are the negative of the finger travel.
   *
   * The rig moves the OPPOSITE way to the picture: sliding it right pushes the
   * scene left, and sliding it FORWARD (`+dy`, the finger going down the
   * screen) brings the scene down towards the viewer. Hence `-dx` on `right`
   * and `+dy` on `forward`.
   */
  pan(dx: number, dy: number): void {
    this.tween = null;
    const scale = this.radius * ORBIT.panScalePerRadius;
    const forward = SCRATCH_FORWARD.set(-Math.sin(this.theta), 0, -Math.cos(this.theta));
    const right = SCRATCH_RIGHT.set(Math.cos(this.theta), 0, -Math.sin(this.theta));
    this.target.addScaledVector(right, -dx * scale).addScaledVector(forward, dy * scale);
  }

  /**
   * Multiplicative zoom: every scroll notch scales the radius by a constant
   * factor, so zooming stays equally quick at any distance. `dy < 0` — wheel
   * forward, or a pinch spreading — comes in, toward the scene point under
   * the cursor `at`;
   * without `at` it closes in on the screen centre.
   */
  zoom(dy: number, at?: ClientPoint): void {
    this.tween = null;
    this.dolly(this.radius * Math.exp(dy * ORBIT.zoomRatePerPx), at);
  }

  /**
   * Sets the radius (clamped) and, when a pointer is given, scales the whole
   * pose about the scene point under it: target and camera both slide along
   * their offsets from that point by the same factor as the radius, so the
   * orientation is unchanged and every point on the cursor ray — the anchor
   * included — projects to the same pixel once the camera settles. At a clamp
   * the factor is one and nothing slides.
   */
  private dolly(wanted: number, at: ClientPoint | undefined): void {
    const radius = THREE.MathUtils.clamp(wanted, ORBIT.minRadiusM, ORBIT.maxRadiusM);
    const factor = radius / this.radius;
    const anchor = at && factor !== 1 ? this.anchorUnder(at) : null;
    this.radius = radius;
    if (!anchor) return;
    this.target.sub(anchor).multiplyScalar(factor).add(anchor);
    if (this.deps.fieldOfView) this.holdThroughFieldOfView(anchor);
  }

  /**
   * The scaling above is exact for a fixed field of view, but the controller widens
   * the view as the camera comes down (`fieldOfView`), which pulls the anchor
   * towards the centre. Each pass puts the anchor back on the cursor's ray as
   * the NEW view casts it, by sliding the target sideways at the anchor's
   * depth; the slide moves the camera's height a little, so a few passes
   * settle the coupled pair.
   */
  private holdThroughFieldOfView(anchor: THREE.Vector3): void {
    for (let pass = 0; pass < FOV_CORRECTION_PASSES; pass += 1) {
      const eye = this.poseEye();
      const forward = eye.getWorldDirection(SCRATCH_FORWARD_EYE);
      const depth = SCRATCH_ON_RAY.copy(anchor).sub(eye.position).dot(forward);
      const along = SCRATCH_ALONG.copy(SCRATCH_NDC).setZ(0.5).unproject(eye).sub(eye.position);
      const onRay = SCRATCH_ON_RAY.copy(eye.position).addScaledVector(along, depth / along.dot(forward));
      this.target.add(onRay.negate().add(anchor));
    }
  }

  /**
   * A camera standing at the rig's OWN pose — not the smoothed one — with the
   * field of view the controller gives that pose.
   */
  private poseEye(): THREE.PerspectiveCamera {
    const eye = SCRATCH_POSE_CAMERA.copy(this.camera, false);
    this.posePosition(eye.position);
    if (this.deps.fieldOfView) {
      eye.fov = this.deps.fieldOfView(eye.position.y);
      eye.updateProjectionMatrix();
    }
    eye.lookAt(this.target);
    eye.updateMatrixWorld(true);
    return eye;
  }

  /**
   * The scene point under a pointer, seen from the rig's OWN pose rather than
   * the smoothed camera, so several notches in one glide compose exactly: the
   * visible surface the ray meets first, else the ray's crossing of the
   * target's level (a pointer over the void around the model), else `null`
   * (a ray above the horizon) and the zoom closes in on the centre.
   */
  private anchorUnder(at: ClientPoint): THREE.Vector3 | null {
    const eye = this.poseEye();
    const hit = this.deps.picker.pickSelection(at.x, at.y, eye);
    const anchor = hit
      ? SCRATCH_ANCHOR.copy(hit.point)
      : this.deps.picker.pointerRay(at.x, at.y, eye).intersectPlane(SCRATCH_LEVEL.set(UP, -this.target.y), SCRATCH_ANCHOR);
    // Where the cursor sits in the view, read back off the anchor it found:
    // the field-of-view correction aims the new view's ray through it.
    if (anchor) SCRATCH_NDC.copy(anchor).project(eye);
    return anchor;
  }

  /** Where the spherical pose puts the camera; `update()` eases towards it. */
  private posePosition(out: THREE.Vector3): THREE.Vector3 {
    const sinPhi = Math.sin(this.phi);
    return out.set(
      this.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinPhi * Math.cos(this.theta),
    );
  }

  /**
   * A key went down; `true` when it is a movement key, which the rig takes (and
   * the page must not also scroll with).
   */
  keyDown(code: string): boolean {
    if (!MOVE_KEYS.has(code)) return false;
    this.keys.add(code);
    this.tween = null;
    return true;
  }
  keyUp(code: string): void {
    this.keys.delete(code);
  }
  clearKeys(): void {
    this.keys.clear();
  }

  /**
   * The held keys pan the target on the floor plane, camera-relative: W takes
   * the view forward (the model slides towards and under the viewer), D to the
   * right. Speed scales with the radius, like the drag pan, so the model moves
   * across the screen at the same pace whatever the zoom.
   */
  private keyPan(delta: number): void {
    const { forward, right } = keyDirection(this.keys);
    if (forward === 0 && right === 0) return;
    const metres = this.radius * ORBIT.keyPanRadiiPerS * Math.min(delta, CAMERA_TUNING.maxFrameStepS);
    const length = Math.hypot(forward, right);
    const ahead = SCRATCH_FORWARD.set(-Math.sin(this.theta), 0, -Math.cos(this.theta));
    const side = SCRATCH_RIGHT.set(Math.cos(this.theta), 0, -Math.sin(this.theta));
    this.target.addScaledVector(ahead, (forward / length) * metres).addScaledVector(side, (right / length) * metres);
  }

  /** One frame: advance any flight, then ease the camera onto the rig's pose. */
  update(delta: number): void {
    this.keyPan(delta);
    if (this.tween) {
      this.tween.elapsed += delta;
      const raw = Math.min(1, this.tween.elapsed / this.tween.duration);
      const progress = smoothstep(raw);
      this.theta = THREE.MathUtils.lerp(this.tween.fromTheta, this.tween.toTheta, progress);
      this.phi = THREE.MathUtils.lerp(this.tween.fromPhi, this.tween.toPhi, progress);
      this.radius = THREE.MathUtils.lerp(this.tween.fromRadius, this.tween.toRadius, progress);
      this.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, progress);
      if (raw >= 1) this.tween = null;
    }
    const next = this.posePosition(SCRATCH_NEXT);
    const smoothing = 1 - Math.pow(1 - ORBIT.smoothing, Math.min(delta, CAMERA_TUNING.maxFrameStepS) * 60);
    this.camera.position.lerp(next, smoothing);
    this.camera.lookAt(this.target);
  }
}
