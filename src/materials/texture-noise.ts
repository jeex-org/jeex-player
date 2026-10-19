/**
 * Pure, DOM-free building blocks for the procedural surface textures.
 *
 * Everything here is deterministic (seeded, never `Math.random`) and defined on
 * a torus: the layout helpers describe patterns whose content at coordinate
 * `size` continues the content at coordinate `0`, and the noise is periodic
 * with period 1 in both axes. Keeping the maths in this module lets the seam
 * guarantees be unit-tested headlessly, without a canvas.
 */

import { clamp01, lerp } from '../shared/math.js';

/** Deterministic 32-bit PRNG (mulberry32). Same seed always yields the same stream. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of an integer lattice point to [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x85ebca6b) ^ Math.imul((seed | 0) + 0x9e3779b9, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Stable hash of a single integer to [0, 1). */
export function hash1(x: number, seed = 0): number {
  return hash2(x, 0x5f3a, seed);
}

export const wrapIndex = (value: number, count: number): number => ((value % count) + count) % count;

/** Quintic fade curve; C2-continuous so noise has no lattice creases. */
export const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Value noise on an integer lattice of `freq` cells per unit. Because the
 * lattice indices are wrapped modulo `freq` (an integer), the field is exactly
 * periodic: `noise(x, y) === noise(x + 1, y) === noise(x, y + 1)`.
 */
export function periodicNoise2D(x: number, y: number, freq: number, seed = 0): number {
  const cells = Math.max(1, Math.round(freq));
  const gx = x * cells;
  const gy = y * cells;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = fade(gx - x0);
  const ty = fade(gy - y0);
  const xa = wrapIndex(x0, cells);
  const xb = wrapIndex(x0 + 1, cells);
  const ya = wrapIndex(y0, cells);
  const yb = wrapIndex(y0 + 1, cells);
  const n00 = hash2(xa, ya, seed);
  const n10 = hash2(xb, ya, seed);
  const n01 = hash2(xa, yb, seed);
  const n11 = hash2(xb, yb, seed);
  return lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty);
}

export type FbmOptions = {
  /** Number of octaves; each doubles the lattice frequency (still integer, still periodic). */
  octaves?: number;
  /** Lattice cells per unit for the first octave. */
  freq?: number;
  /** Amplitude falloff per octave. */
  gain?: number;
  seed?: number;
};

/** Periodic fractal noise in [0, 1]; all octave frequencies are integers, so the sum still wraps. */
export function periodicFbm(x: number, y: number, options: FbmOptions = {}): number {
  const octaves = options.octaves ?? 4;
  const freq = options.freq ?? 4;
  const gain = options.gain ?? 0.5;
  const seed = options.seed ?? 0;
  let amplitude = 1;
  let total = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += amplitude * periodicNoise2D(x, y, freq * 2 ** octave, seed + octave * 1013);
    norm += amplitude;
    amplitude *= gain;
  }
  return total / norm;
}

/** Billowy 0..1 field with ridges, useful for stone veining. */
export function periodicRidge(x: number, y: number, options: FbmOptions = {}): number {
  return 1 - Math.abs(periodicFbm(x, y, options) * 2 - 1);
}

/* ------------------------------------------------------------------ layout */

export type PlankSpan = {
  /** Start along the row, always inside [0, size); the span may run past `size` and wrap. */
  start: number;
  length: number;
  row: number;
  index: number;
  /** Per-plank variation seeds in [0, 1): tone (lightness), hue, grain. */
  tone: number;
  hue: number;
  grain: number;
};

/**
 * Row offset of a plank course. Offsets follow a jittered running bond so no
 * two neighbouring rows (including the wrap pair `rows - 1` and `0`) line up.
 */
export function plankRowOffset(row: number, size: number, plankLength: number, seed = 0): number {
  // The phase keeps row 0 off the tile border, so no course has a joint sitting
  // exactly on the seam (where a rounding slip would show as a hairline).
  const phase = 0.17 + hash1(seed, 313) * 0.5;
  const bond = 0.37 + hash1(row, seed + 77) * 0.26;
  return wrapIndex((phase + row * bond) * plankLength, size);
}

/**
 * Plank layout of one course, defined on the circle of circumference `size`.
 *
 * The joints are `size / n` apart with a bounded jitter, and the last span is
 * closed back onto the first, so the spans tile the circle exactly once. The
 * span that contains the tile border is returned once, starting before the
 * border and running past it: the drawing code renders it twice (once shifted
 * by `-size`) which is what makes the border invisible.
 */
export function plankRowSpans(row: number, size: number, plankLength: number, seed = 0, jitter = 0.26): PlankSpan[] {
  const count = Math.max(2, Math.round(size / plankLength));
  const step = size / count;
  const offset = plankRowOffset(row, size, step, seed);
  const joints: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const wobble = index === 0 ? 0 : (hash2(row, index, seed) - 0.5) * step * jitter;
    joints.push(offset + index * step + wobble);
  }
  joints.push(offset + size);
  const spans: PlankSpan[] = [];
  // `joints` was filled with `count` entries plus the closing one, so `index`
  // and `index + 1` are both in range for `index < count`.
  for (let index = 0; index < count; index += 1) {
    spans.push({
      start: wrapIndex(joints[index]!, size),
      length: joints[index + 1]! - joints[index]!,
      row,
      index,
      tone: hash2(row * 131 + index, 17, seed),
      hue: hash2(row * 131 + index, 29, seed),
      grain: hash2(row * 131 + index, 43, seed),
    });
  }
  return spans;
}

export type GridCell = {
  x: number;
  y: number;
  width: number;
  height: number;
  col: number;
  row: number;
  /** Per-cell variation seed in [0, 1). */
  tone: number;
};

/**
 * Regular tile grid with `count` cells per axis. `size / count` is exact, so
 * the grout line that sits on the tile border is shared by the wrapped copy.
 */
export function tileGrid(size: number, count: number, seed = 0): GridCell[] {
  const cells = Math.max(1, Math.round(count));
  const step = size / cells;
  const grid: GridCell[] = [];
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      grid.push({
        x: col * step,
        y: row * step,
        width: step,
        height: step,
        col,
        row,
        tone: hash2(col, row, seed),
      });
    }
  }
  return grid;
}

/**
 * Horizontal shift of a chevron course. With `rowHeight = size / rows` and a
 * 45-degree slope the shift after `rows` courses is exactly `size`, so the
 * pattern re-enters itself at the tile border.
 */
export function chevronRowShift(row: number, rowHeight: number): number {
  return row * rowHeight;
}

/** Number of chevron courses that fit one tile; always an integer by construction. */
export function chevronRowCount(size: number, rowHeight: number): number {
  return Math.round(size / rowHeight);
}

/**
 * Offsets a shape needs to be drawn at so it survives the tile border.
 * A shape at [start, start + length) inside [0, size) also has to be drawn at
 * `-size` when it runs off the far edge (and at `+size` when it starts before 0).
 */
export function wrapOffsets(start: number, length: number, size: number): number[] {
  const offsets = [0];
  if (start + length > size) offsets.push(-size);
  if (start < 0) offsets.push(size);
  return offsets;
}

/* ------------------------------------------------------------------ colour */

export type RGB = { r: number; g: number; b: number };

const clamp255 = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

export function parseHex(hex: string): RGB {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const base = parseInt(full, 16);
  return { r: (base >> 16) & 0xff, g: (base >> 8) & 0xff, b: base & 0xff };
}

export function toHex({ r, g, b }: RGB): string {
  const channel = (v: number) => clamp255(v).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Lightens (positive) or darkens (negative) every channel by `amount` (0..255 scale). */
export function shadeHex(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  return toHex({ r: r + amount, g: g + amount, b: b + amount });
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return toHex({ r: lerp(ca.r, cb.r, t), g: lerp(ca.g, cb.g, t), b: lerp(ca.b, cb.b, t) });
}

/** HSL of an RGB triple. Internal: `adjustHsl` is the exported entry point. */
function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

/** Inverse of `rgbToHsl`. Internal: see `adjustHsl`. */
function hslToRgb(h: number, s: number, l: number): RGB {
  const hue = ((h % 1) + 1) % 1;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: channel(hue + 1 / 3) * 255, g: channel(hue) * 255, b: channel(hue - 1 / 3) * 255 };
}

/** Shifts a colour in HSL space; deltas are in [0,1] units (hue wraps). */
export function adjustHsl(hex: string, dh: number, ds: number, dl: number): string {
  const { h, s, l } = rgbToHsl(parseHex(hex));
  const next = hslToRgb(h + dh, clamp01(s + ds), clamp01(l + dl));
  return toHex(next);
}

/** `rgba()` string from a hex colour plus alpha - handy for low-opacity strokes. */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Deterministic per-plank wood colour: small hue/saturation/lightness spread around the base. */
export function woodPlankColor(base: string, span: { tone: number; hue: number }): string {
  const dl = (span.tone - 0.5) * 0.085;
  const dh = (span.hue - 0.5) * 0.018;
  const ds = (span.hue - 0.5) * 0.06;
  return adjustHsl(base, dh, ds, dl);
}

/** Terrazzo chip palette derived from the slab colour, so every base stays coherent. */
export function terrazzoPalette(base: string): string[] {
  return [
    adjustHsl(base, 0, -0.35, 0.28),
    adjustHsl(base, 0, -0.2, 0.18),
    adjustHsl(base, 0.02, 0.05, -0.16),
    adjustHsl(base, -0.04, 0.1, -0.05),
    // One near-complementary chip for interest, desaturated so it reads as
    // aggregate rather than confetti.
    adjustHsl(base, 0.45, -0.22, 0.06),
    adjustHsl(base, 0, -0.4, -0.28),
    adjustHsl(base, 0.08, 0.06, 0.02),
  ];
}
