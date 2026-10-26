/**
 * The settle window after a picture that brought new GPU resources.
 *
 * On an NVIDIA GPU (Chrome, driver 610) a picture that brought a program, a
 * texture or a geometry three had not had before is not yet the final one:
 * the same draw calls, with no upload or compile after it, give a picture
 * that settles over about 100 ms (half way after one more frame, settled
 * after five). A view resting on it kept up to 0.4 % of its pixels wrong
 * until the next change: after a context restore, which uploads everything
 * again, and on the first showing of the tour-camera rig. So every tick draws
 * for `NEW_RESOURCES_SETTLE_MS` after such a picture, then the view rests.
 *
 * Pure: the resource count is read by the caller; time is the caller's `now()`.
 */

/** How long every tick draws after a picture that brought new GPU resources, ms. */
export const NEW_RESOURCES_SETTLE_MS = 250;

/** The parts of `renderer.info` the count reads (`THREE.WebGLInfo`). */
export type ResourceInfo = {
  programs?: readonly unknown[] | null;
  memory?: { textures?: number; geometries?: number };
};

/** How many programs, textures and geometries a renderer holds on the GPU. */
export function gpuResources(info: ResourceInfo): number {
  return (info.programs?.length ?? 0) + (info.memory?.textures ?? 0) + (info.memory?.geometries ?? 0);
}

export class SettleWindow {
  /** The GPU resources counted after the last display draw. */
  private seen = 0;
  /** `now()` the open window ends at, else `null`. */
  private until: number | null = null;

  /** A new context: three counts afresh, and its first picture uploads everything again. */
  reset(): void {
    this.seen = 0;
  }

  /** Whether the tick at `now` must draw; the window closes once it has passed. */
  holds(now: number): boolean {
    if (this.until === null) return false;
    if (now < this.until) return true;
    this.until = null;
    return false;
  }

  /** After a display draw at `now` with `resources` held: opens the window when they grew. */
  drawn(now: number, resources: number): void {
    if (resources > this.seen) this.until = now + NEW_RESOURCES_SETTLE_MS;
    this.seen = resources;
  }
}
