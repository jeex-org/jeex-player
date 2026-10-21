import { describe, expect, test } from 'bun:test';
import { COUNTER_CAP } from './buckets.js';
import { MAX_ERROR_REPORTS, TelemetryCollector } from './collector.js';
import type { ErrorReport } from './error-report.js';

const ROOM_A = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e5a';
const ROOM_B = '0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e5b';
const report = (line: number): ErrorReport => ({
  code: 'exception',
  stage: 'tour',
  name: 'TypeError',
  frames: [{ file: 'jeex-viewer.js', line, column: 1 }],
});

describe('TelemetryCollector', () => {
  test('counters are capped over the whole mount, across snapshots', () => {
    const collector = new TelemetryCollector();
    let total = 0;
    for (let round = 0; round < 3; round += 1) {
      for (let index = 0; index < 25; index += 1) collector.count('mode');
      total += collector.snapshot().counts?.mode ?? 0;
    }
    expect(total).toBe(COUNTER_CAP);
  });

  test('a snapshot resets, and a second one right after has nothing', () => {
    const collector = new TelemetryCollector();
    collector.count('door');
    collector.frame(16, false);
    collector.dwell(ROOM_A, 1000);
    collector.error(report(1));
    const first = collector.snapshot();
    expect(first.counts?.door).toBe(1);
    expect(collector.snapshot()).toEqual({ counts: null, rooms: [], frames: null, errors: [] });
  });

  test('rooms: UUIDs only, sorted by id, never in visit order', () => {
    const collector = new TelemetryCollector();
    collector.dwell(ROOM_B, 40_000);
    collector.dwell('anna-bedroom', 5000);
    collector.dwell(ROOM_A, 3000);
    collector.dwell(ROOM_B, 1000);
    expect(collector.snapshot().rooms).toEqual([
      { room: ROOM_A, ms: 3000 },
      { room: ROOM_B, ms: 41_000 },
    ]);
  });

  test('rooms are capped', () => {
    const collector = new TelemetryCollector();
    for (let index = 0; index < 150; index += 1) collector.dwell(`0192f5c4-7a1b-7c3d-8e9f-${index.toString(16).padStart(12, '0')}`, 1000);
    expect(collector.snapshot().rooms.length).toBe(100);
  });

  test('frame time is weighted by duration, pauses are dropped', () => {
    const collector = new TelemetryCollector();
    for (let index = 0; index < 60; index += 1) collector.frame(1000 / 60, false); // one second at 60 fps
    collector.frame(100, true); // a 10 fps frame
    collector.frame(5000, true); // a hidden tab: not a frame
    const frames = collector.snapshot().frames!;
    expect(frames.buckets['>50']).toBeCloseTo(1000, 5);
    expect(frames.buckets['<20']).toBe(100);
    expect(frames.totalMs).toBeCloseTo(1100, 5);
    expect(frames.fullscreenMs).toBe(100);
  });

  test('errors: repeats become a count', () => {
    const collector = new TelemetryCollector();
    for (let index = 0; index < 12; index += 1) collector.error(report(1));
    expect(collector.snapshot().errors).toEqual([{ report: report(1), count: 12 }]);
  });

  test('errors: at most ten reports over the whole mount, across snapshots', () => {
    const collector = new TelemetryCollector();
    let handed = 0;
    for (let round = 0; round < 30; round += 1) {
      collector.error(report(1));
      collector.error(report(round + 2));
      handed += collector.snapshot().errors.length;
    }
    expect(handed).toBe(MAX_ERROR_REPORTS);
    collector.error(report(1));
    expect(collector.snapshot().errors).toEqual([]);
  });
});
