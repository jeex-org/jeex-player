/**
 * The coarse intervals every measured number is reduced to before it may
 * leave the player: time, frame rate, width, shares and counts.
 *
 * Invariant: a send never carries a raw measurement. Every number that is not
 * a plain capped count goes through one of these functions, and each returns
 * a member of a closed vocabulary that `telemetry.schema.ts` names. An edge
 * value belongs to the bucket ABOVE it (`5 s` is `5-30s`).
 *
 * Pure module: no `three`, no DOM.
 */

/** The highest value an action counter reports; more is reported as this. */
export const COUNTER_CAP = 50;

export const DWELL_BUCKETS = ['<5s', '5-30s', '30s-2m', '2-10m', '>10m'] as const;
export const LOAD_BUCKETS = ['<1s', '1-3s', '3-10s', '10-30s', '>30s'] as const;
export const FPS_BUCKETS = ['<20', '20-30', '30-50', '>50'] as const;
export const WIDTH_BUCKETS = ['<480', '480-1024', '1024-1600', '>1600'] as const;

export type DwellBucket = (typeof DWELL_BUCKETS)[number];
export type LoadBucket = (typeof LOAD_BUCKETS)[number];
export type FpsBucket = (typeof FPS_BUCKETS)[number];
export type WidthBucket = (typeof WIDTH_BUCKETS)[number];

/** The label of the first edge `value` is below, or the last label. */
function bucket<T extends string>(value: number, edges: readonly number[], labels: readonly T[]): T {
  const index = edges.findIndex((edge) => value < edge);
  return labels[index === -1 ? labels.length - 1 : index]!;
}

/** Time spent in a room, in seconds. */
export const dwellBucket = (seconds: number): DwellBucket => bucket(seconds, [5, 30, 120, 600], DWELL_BUCKETS);
/** Time from mount to a lifecycle step, in seconds. */
export const loadBucket = (seconds: number): LoadBucket => bucket(seconds, [1, 3, 10, 30], LOAD_BUCKETS);
/** Frames per second over one frame interval. */
export const fpsBucket = (fps: number): FpsBucket => bucket(fps, [20, 30, 50], FPS_BUCKETS);
/** The player's width, in CSS pixels. */
export const widthBucket = (pixels: number): WidthBucket => bucket(pixels, [480, 1024, 1600], WIDTH_BUCKETS);

/** A share in `0..1` as a whole tenth in percent: `0, 10, …, 100`. Anything not a share is `0`. */
export function shareBucket(share: number): number {
  if (!Number.isFinite(share) || share <= 0) return 0;
  return Math.min(100, Math.round(share * 10) * 10);
}

/** A count as a whole number in `0..COUNTER_CAP`. */
export function cappedCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(COUNTER_CAP, Math.floor(count));
}
