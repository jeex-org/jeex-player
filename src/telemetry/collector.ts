/**
 * What one mounted player accumulates between two sends: action counters,
 * time per room, frame time per frame-rate bucket, fullscreen time and error
 * reports.
 *
 * Invariant: nothing here records WHEN anything happened or in what ORDER.
 * Counters are sums, room time is a sum per room, frame time is a sum per
 * bucket, errors are counts per distinct report. `snapshot()` hands the sums
 * over and resets them in the same synchronous call, so two triggers that
 * arrive together can never send one piece of data twice.
 *
 * Caps are per MOUNT, not per send: a counter reports at most `COUNTER_CAP`
 * over the whole life of the mount (the allowance left is kept across
 * snapshots), and at most `MAX_ERROR_REPORTS` error reports are ever handed
 * over: a report that recurs after a snapshot is a new send and spends one.
 *
 * Pure module: no `three`, no DOM.
 */

import { COUNTER_CAP, FPS_BUCKETS, fpsBucket, type FpsBucket } from './buckets.js';
import { reportKey, type ErrorReport } from './error-report.js';
import { COUNTER_KEYS, type CounterKey } from './vocabulary.js';
import { UUID_V7_PATTERN } from '../scene/types.js';
import { MAX_ROOMS } from './telemetry.schema.js';

/** The most error sends one mount makes, over all its snapshots. */
export const MAX_ERROR_REPORTS = 10;

/** A frame interval longer than this is a pause (a hidden tab, an off-screen canvas), not a slow frame, in ms. */
export const MAX_FRAME_INTERVAL_MS = 1000;

/** What `snapshot()` hands over; every part is `null` or empty when nothing was gathered. */
export type CollectorSnapshot = {
  counts: Record<CounterKey, number> | null;
  rooms: Array<{ room: string; ms: number }>;
  frames: { buckets: Record<FpsBucket, number>; totalMs: number; fullscreenMs: number } | null;
  errors: Array<{ report: ErrorReport; count: number }>;
};

const zeroCounts = (): Record<CounterKey, number> => Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0])) as Record<CounterKey, number>;
const zeroBuckets = (): Record<FpsBucket, number> =>
  Object.fromEntries(FPS_BUCKETS.map((bucket) => [bucket, 0])) as Record<FpsBucket, number>;

export class TelemetryCollector {
  private counts = zeroCounts();
  /** What each counter has reported over the mount, sent or not; never reset. */
  private readonly spent = zeroCounts();
  private rooms = new Map<string, number>();
  private buckets = zeroBuckets();
  private drawnMs = 0;
  private fullscreenMs = 0;
  private errors = new Map<string, { report: ErrorReport; count: number }>();
  /** Error reports already handed over by `snapshot()`; never reset. */
  private errorsHanded = 0;

  /** One accepted action; beyond the mount's allowance it is not counted. */
  count(key: CounterKey): void {
    if (this.spent[key] >= COUNTER_CAP) return;
    this.spent[key] += 1;
    this.counts[key] += 1;
  }

  /** One drawn frame interval of `intervalMs`; only 3D frames count, a pause never does. */
  frame(intervalMs: number, fullscreen: boolean): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > MAX_FRAME_INTERVAL_MS) return;
    this.buckets[fpsBucket(1000 / intervalMs)] += intervalMs;
    this.drawnMs += intervalMs;
    if (fullscreen) this.fullscreenMs += intervalMs;
  }

  /** `ms` spent in `room`; a room id that is not a UUID is not kept. */
  dwell(room: string, ms: number): void {
    if (!UUID_V7_PATTERN.test(room) || !Number.isFinite(ms) || ms <= 0) return;
    if (!this.rooms.has(room) && this.rooms.size >= MAX_ROOMS) return;
    this.rooms.set(room, (this.rooms.get(room) ?? 0) + ms);
  }

  /** One error report; repeats are counted, a new one beyond the mount's allowance is dropped. */
  error(report: ErrorReport): void {
    const key = reportKey(report);
    const held = this.errors.get(key);
    if (held) {
      held.count = Math.min(COUNTER_CAP, held.count + 1);
      return;
    }
    if (this.errorsHanded + this.errors.size >= MAX_ERROR_REPORTS) return;
    this.errors.set(key, { report, count: 1 });
  }

  /** Everything gathered since the last snapshot; the sums start again from zero. */
  snapshot(): CollectorSnapshot {
    const counts = Object.values(this.counts).some((value) => value > 0) ? this.counts : null;
    const rooms = [...this.rooms].map(([room, ms]) => ({ room, ms })).sort((a, b) => (a.room < b.room ? -1 : a.room > b.room ? 1 : 0));
    const frames = this.drawnMs > 0 ? { buckets: this.buckets, totalMs: this.drawnMs, fullscreenMs: this.fullscreenMs } : null;
    const errors = [...this.errors.values()];
    this.errorsHanded += errors.length;
    this.counts = zeroCounts();
    this.rooms = new Map();
    this.buckets = zeroBuckets();
    this.drawnMs = 0;
    this.fullscreenMs = 0;
    this.errors = new Map();
    return { counts, rooms, frames, errors };
  }
}
