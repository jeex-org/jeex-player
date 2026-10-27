import { describe, expect, test } from 'bun:test';
import { EasedBalance, measureProbe, roomBalance } from './room-balance.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';
import type { Mat3, Rgb } from '../white-balance.js';

const B = T.balance;
const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const apply = (m: Mat3, c: Rgb): Rgb =>
  [0, 1, 2].map((r) => m[r * 3]! * c[0] + m[r * 3 + 1]! * c[1] + m[r * 3 + 2]! * c[2]) as unknown as Rgb;
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** One face of `texels` texels, each `[colour, count]` repeated in order. */
function face(...runs: [Rgb, number][]): Float32Array {
  const out: number[] = [];
  for (const [colour, count] of runs) for (let i = 0; i < count; i += 1) out.push(colour[0], colour[1], colour[2], 1);
  return Float32Array.from(out);
}

const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

describe('measureProbe', () => {
  test('measures a white wall under a warm lamp as warm, though a grey test would call it saturated', () => {
    const lamp: Rgb = [1, 0.62, 0.32];
    // Dark floor, the lamp-lit wall in a range of brightness, the shade's glow above the highlight quantile.
    const faces = [
      face([[0.02, 0.015, 0.01], 600], ...[0.6, 0.7, 0.8, 0.9, 1].map((k): [Rgb, number] => [scale(lamp, 0.3 * k), 80]), [[6, 4, 2], 30]),
    ];
    const light = measureProbe(faces)!;
    expect(light.white[0] / light.white[2]).toBeCloseTo(lamp[0] / lamp[2], 2);
    expect(luminance(light.white)).toBeCloseTo(1, 6);
  });

  test('keeps the sky through a window out of the white and makes it the highlight', () => {
    const walls = [0.25, 0.3, 0.35].map((k): [Rgb, number] => [[k, k, k], 120]);
    const sky: Rgb = [3, 4, 6];
    const light = measureProbe([face([[0.01, 0.01, 0.01], 600], ...walls, [sky, 40])])!;
    expect(light.white[0] / light.white[2]).toBeCloseTo(1, 6);
    expect(light.level).toBeCloseTo(0.3, 6);
    expect(light.highlight).toBeCloseTo(luminance(sky), 5);
  });

  test('leaves a saturated finish out once the cast is known', () => {
    const red: Rgb = [0.6, 0.1, 0.08];
    const walls = [0.35, 0.4, 0.45].map((k): [Rgb, number] => [[k, k, k], 80]);
    const light = measureProbe([face([[0.01, 0.01, 0.01], 650], [red, 80], ...walls, [[2, 2, 2], 30])])!;
    expect(light.white[0] / light.white[2]).toBeCloseTo(1, 2);
  });

  test('answers null for a room that reads black (an unlit room, or faces that could not be read back)', () => {
    expect(measureProbe([new Float32Array(64 * 4)])).toBeNull();
  });
});

describe('roomBalance', () => {
  const exposure = 3.5;

  test('turns the measured white into a grey with the tuned trace of warmth, at the gained luminance', () => {
    const white: Rgb = scale([1.4, 0.93, 0.49], 1 / luminance([1.4, 0.93, 0.49]));
    const level = B.targetLevel / exposure;
    const out = apply(roomBalance({ white, level, highlight: level * 2 }, exposure), white);
    expect(out[0] / out[2]).toBeCloseTo(B.tintRB, 3);
    expect(out[0] / out[1]).toBeCloseTo(out[0] / out[2], 3);
    expect(luminance(out)).toBeCloseTo(1, 3);
  });

  test('opens a dim room up to the target level, at most by the gain cap', () => {
    const grey: Rgb = [1, 1, 1];
    const dim = roomBalance({ white: grey, level: B.targetLevel / exposure / 2, highlight: 0.01 }, exposure);
    expect(luminance(apply(dim, grey))).toBeCloseTo(2, 3);
    const dark = roomBalance({ white: grey, level: B.targetLevel / exposure / 10, highlight: 0.01 }, exposure);
    expect(luminance(apply(dark, grey))).toBeCloseTo(B.maxGain, 3);
  });

  test("stops where the window's highlight would reach the cap", () => {
    const grey: Rgb = [1, 1, 1];
    const level = B.targetLevel / exposure / 2;
    const highlight = B.highlightCap / exposure / 1.3;
    const balance = roomBalance({ white: grey, level, highlight }, exposure);
    expect(luminance(apply(balance, grey))).toBeCloseTo(1.3, 3);
    expect(exposure * highlight * luminance(apply(balance, grey))).toBeCloseTo(B.highlightCap, 3);
  });

  test('never darkens a bright room', () => {
    const grey: Rgb = [1, 1, 1];
    const balance = roomBalance({ white: grey, level: (B.targetLevel / exposure) * 3, highlight: 10 }, exposure);
    expect(luminance(apply(balance, grey))).toBeCloseTo(1, 6);
  });
});

describe('EasedBalance', () => {
  const warm: Mat3 = [1.2, 0, 0, 0, 1, 0, 0, 0, 0.8];

  test('takes the first target at once', () => {
    const eased = new EasedBalance();
    expect(eased.value).toBeNull();
    expect(eased.step(warm, 0)).toBe(true);
    expect(eased.value).toBe(warm);
    expect(eased.step(warm, 16)).toBe(false);
  });

  test('eases into a new room over the blend time, then holds it exactly', () => {
    const eased = new EasedBalance();
    eased.step(IDENTITY, 0);
    expect(eased.step(warm, 16)).toBe(true);
    const first = eased.value![0];
    expect(first).toBeGreaterThan(1);
    expect(first).toBeLessThan(1.2);
    let now = 16;
    while (now < B.blendMs) eased.step(null, (now += 16));
    expect(eased.value![0]).toBeGreaterThan(1 + 0.2 * 0.9);
    for (let i = 0; i < 200 && eased.value !== warm; i += 1) eased.step(null, (now += 16));
    expect(eased.value).toBe(warm);
    expect(eased.step(null, (now += 16))).toBe(false);
  });

  test('holds the last room outside every room (a null target)', () => {
    const eased = new EasedBalance();
    eased.step(warm, 0);
    expect(eased.step(null, 16)).toBe(false);
    expect(eased.value).toBe(warm);
  });

  test('jumps after a pause of the blend time or more, and starts over after a reset', () => {
    const eased = new EasedBalance();
    eased.step(IDENTITY, 0);
    eased.step(warm, B.blendMs);
    expect(eased.value).toBe(warm);
    eased.reset();
    expect(eased.value).toBeNull();
    eased.step(IDENTITY, B.blendMs + 16);
    expect(eased.value).toBe(IDENTITY);
  });
});
