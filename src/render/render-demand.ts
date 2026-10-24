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
 * Pure: no `three` and no DOM; the camera is read through its matrices.
 */

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
   * Whether this tick draws, with `camera` in `mode`. Called once per tick,
   * after the frame hooks; brings the camera's world matrix up to date first.
   */
  shouldDraw(camera: DemandCamera, mode: string | undefined): boolean {
    this.ticks += 1;
    this.asked = mode;
    if (mode === undefined || !ON_DEMAND_MODES.has(mode)) return true;
    camera.updateMatrixWorld();
    const shown = this.shown;
    if (this.dirty || shown === null) return true;
    return (
      shown.camera !== camera ||
      shown.mode !== mode ||
      shown.layers !== camera.layers.mask ||
      !within(shown.projection, camera.projectionMatrix.elements, 0) ||
      !within(shown.world, camera.matrixWorld.elements, POSE_TOLERANCE)
    );
  }

  /** The tick drew successfully with `camera`: that is the picture on screen now. */
  commit(camera: DemandCamera): void {
    this.draws += 1;
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
