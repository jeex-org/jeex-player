/**
 * Whether a tick of the frame loop draws a new picture: the on-demand gate of
 * `walk`, `tour`, `orbit` and `plan3d`.
 *
 * In those modes nothing changes on screen while the camera rests and nothing
 * in the scene moves, so the runtime keeps the last presented picture instead
 * of drawing the same one again (a tick with no draw call presents nothing
 * new, and the compositor keeps showing the last frame). The frame hooks still
 * run on every tick; only the display draw is gated. `plan2d` is outside the
 * gate: the opaque plan drawing covers the scene there, and the runtime holds
 * it to its keep-warm heartbeat (`KEEP_WARM_MS`) so the way back to a 3D view
 * does not stall.
 *
 * Every visible change that is not a camera move must reach the gate: call
 * `invalidate()`, or report the change through a frame hook that does. A
 * change that does neither stays off screen until something else draws.
 *
 * A tick draws when something visible was reported since the last display
 * draw (`invalidate`), or when the camera differs from the one that picture
 * was drawn with: another camera object, a world matrix further than
 * `POSE_TOLERANCE` from it in any element, another projection, other layers,
 * or another mode. The comparison is against the LAST DISPLAYED camera, so a
 * slow drift below the tolerance per tick still draws once it adds up. The
 * snapshot and the demand are committed only after a draw succeeded
 * (`commit`): a draw that throws leaves the demand for the next tick.
 *
 * The first picture of a change is not always the steady one, so the picture
 * the view RESTS on is drawn once more: after a draw that answered
 * `invalidate`, or another camera object, projection, layers or mode, the
 * `STEADY_AFTER_IDLE_TICKS`th tick with nothing to draw draws the same inputs
 * again (`commit`). A change before then draws anyway and starts the count
 * again, so a drag that reports its changes draws as they come, plus one draw
 * at its end; a camera move alone owes nothing. A draw asked for by
 * `repeat` (the settle window drawing the picture again) is such a second draw
 * of unchanged inputs: it pays the debt instead of adding one.
 *
 * Pure: no `three` and no DOM; the camera is read through its matrices.
 */

/**
 * Ticks with nothing to draw before the steady draw of a change: the third
 * idle tick draws it. Two idle ticks between changes (a pointer moving every
 * third tick) never reach it, so a sparse drag draws only its changes.
 */
export const STEADY_AFTER_IDLE_TICKS = 3;

/** The modes that draw on demand. */
const ON_DEMAND_MODES: ReadonlySet<string> = new Set(['walk', 'tour', 'orbit', 'plan3d']);

/**
 * Largest change of any world-matrix element that does not count as a move:
 * a tenth of a millimetre of translation, a ten-thousandth of a radian of
 * rotation. The camera rigs' damping ends in an exponential tail that never
 * quite stops; the tail below this is invisible and is not redrawn.
 */
export const POSE_TOLERANCE = 1e-4;

/** What the gate reads of a camera (a `THREE.Camera` fits). */
export type DemandCamera = {
  readonly matrixWorld: { readonly elements: ArrayLike<number> };
  readonly projectionMatrix: { readonly elements: ArrayLike<number> };
  readonly layers: { readonly mask: number };
  updateMatrixWorld(): void;
};

/** The camera a picture was displayed with. */
type Shown = { camera: DemandCamera; world: number[]; projection: number[]; layers: number; mode: string | undefined };

/**
 * Cumulative counters, for the debug surface: frame-loop ticks, display draws,
 * and draws of the camera-preview inset (which follow display draws only).
 */
export type DemandCounters = { readonly ticks: number; readonly draws: number; readonly insetDraws: number };

export class RenderDemand {
  private dirty = true;
  /** One more draw of unchanged inputs is owed once the view rests: the last draw answered a change (`commit`). */
  private steady = false;
  /** Ticks with nothing to draw since the last draw, counted while the steady draw is owed. */
  private idle = 0;
  /** Whether the draw `shouldDraw` last allowed answers `invalidate`. */
  private answering = false;
  /** The next tick draws the unchanged inputs again (`repeat`). */
  private repeating = false;
  private shown: Shown | null = null;
  /** The mode of the last `shouldDraw`, which `commit` records. */
  private asked: string | undefined;
  private ticks = 0;
  private draws = 0;
  private insetDraws = 0;

  /** Something visible changed: the next tick draws. */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * Nothing changed, but the next tick draws the same inputs again (the
   * runtime's settle window, `settle-window.ts`). Such a draw owes no steady
   * draw, and pays one that is owed.
   */
  repeat(): void {
    this.repeating = true;
  }

  /**
   * Whether this tick draws, with `camera` in `mode`. Called once per tick,
   * after the frame hooks; brings the camera's world matrix up to date first.
   */
  shouldDraw(camera: DemandCamera, mode: string | undefined): boolean {
    this.ticks += 1;
    this.asked = mode;
    if (mode === undefined || !ON_DEMAND_MODES.has(mode)) {
      this.answering = false;
      return true;
    }
    camera.updateMatrixWorld();
    const shown = this.shown;
    this.answering = this.dirty;
    if (this.dirty || this.repeating || shown === null) return true;
    const changed =
      shown.camera !== camera ||
      shown.mode !== mode ||
      shown.layers !== camera.layers.mask ||
      !within(shown.projection, camera.projectionMatrix.elements, 0) ||
      !within(shown.world, camera.matrixWorld.elements, POSE_TOLERANCE);
    if (changed || !this.steady) return changed;
    this.idle += 1;
    return this.idle >= STEADY_AFTER_IDLE_TICKS;
  }

  /**
   * The tick drew successfully with `camera`: that is the picture on screen now.
   *
   * The first picture of a change is not always the steady one. After the
   * render camera itself changed (a mode switch to or from the top view) the
   * top view's first frame differed on wall tops and glazing from the next
   * frame drawn from identical inputs, in 7 runs of 10. After any other change
   * (`invalidate`) the same happens more rarely: on ANGLE's OpenGL backend on
   * NVIDIA, about one change in 150 left a first picture whose antialiased
   * edges (0.1 to 0.3 % of the pixels, up to 50 levels) differed from every
   * later draw of the same inputs, while the second and every later draw
   * agreed. A resting view would keep that picture until the next change. So
   * a draw that answered either, or another projection or other layers (they
   * change what is drawn, like a scene change), owes one more draw, drawn only
   * once the view rests (`STEADY_AFTER_IDLE_TICKS`), and that steady draw owes
   * nothing. Any draw before then replaces the debt with its own: a change
   * owes again, a camera move owes nothing, as its sub-tolerance tail is not
   * redrawn either.
   */
  commit(camera: DemandCamera): void {
    this.draws += 1;
    const shown = this.shown;
    const switched =
      shown !== null &&
      (shown.camera !== camera ||
        shown.mode !== this.asked ||
        shown.layers !== camera.layers.mask ||
        !within(shown.projection, camera.projectionMatrix.elements, 0));
    this.steady = switched || this.answering;
    this.idle = 0;
    this.answering = false;
    this.repeating = false;
    this.dirty = false;
    this.shown = {
      camera,
      world: Array.from(camera.matrixWorld.elements),
      projection: Array.from(camera.projectionMatrix.elements),
      layers: camera.layers.mask,
      mode: this.asked,
    };
  }

  /** The camera-preview inset was drawn over the last display draw. */
  insetDrawn(): void {
    this.insetDraws += 1;
  }

  counters(): DemandCounters {
    return { ticks: this.ticks, draws: this.draws, insetDraws: this.insetDraws };
  }
}

/** Whether every element of `next` is within `tolerance` of `shown`. */
function within(shown: readonly number[], next: ArrayLike<number>, tolerance: number): boolean {
  for (let index = 0; index < shown.length; index += 1) {
    if (Math.abs(shown[index]! - next[index]!) > tolerance) return false;
  }
  return true;
}
