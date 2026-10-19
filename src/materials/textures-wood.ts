/**
 * Wooden floor textures: plank courses and chevron parquet.
 *
 * Invariant: both patterns are defined on a torus. Plank courses come from
 * `plankRowSpans`, which tiles the circle of circumference `size`, and the one
 * board that owns the border is painted twice by `drawWrapped`. Chevron courses
 * use an even column count and a 45-degree slope, so the mitre offsets return
 * to zero at the border and the courses re-enter the tile after one period.
 */

import * as THREE from 'three';
import { GRAIN_WOOD, cached, drawWrapped, grainTile, noiseTile, overlayNoise, type Ctx } from './texture-canvas.js';
import {
  adjustHsl,
  chevronRowCount,
  hash2,
  makeRandom,
  periodicFbm,
  periodicNoise2D,
  plankRowSpans,
  rgba,
  shadeHex,
  woodPlankColor,
  wrapIndex,
  type PlankSpan,
} from './texture-noise.js';

/* ------------------------------------------------------------------ planks */

export type PlankOptions = {
  /** Texture resolution; 1024 keeps the grain crisp on large floors. */
  size?: number;
  /** Plank courses across one tile. */
  rows?: number;
  /** Planks along one course. */
  columns?: number;
  /** Gap between boards, in pixels of the texture. */
  gap?: number;
  /** 0..1 multiplier for how strongly boards differ from each other. */
  variation?: number;
};

const PLANK_DEFAULTS: Required<PlankOptions> = { size: 1024, rows: 12, columns: 3, gap: 2.4, variation: 1 };

function plankSettings(options: PlankOptions): Required<PlankOptions> {
  return { ...PLANK_DEFAULTS, ...options };
}

/** Draws one board in local coordinates: (0,0) is the board's top-left corner. */
function paintPlank(ctx: Ctx, span: PlankSpan, width: number, height: number, base: string, seed: number, variation: number): void {
  const random = makeRandom(Math.round((span.row * 733 + span.index * 37 + seed) * 101) >>> 0);
  const body = woodPlankColor(base, { tone: (span.tone - 0.5) * variation + 0.5, hue: (span.hue - 0.5) * variation + 0.5 });
  const dark = adjustHsl(body, 0.004, 0.05, -0.1);
  const light = adjustHsl(body, -0.004, -0.03, 0.075);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  ctx.fillStyle = body;
  ctx.fillRect(0, 0, width, height);

  // Length-wise tone sweep: boards are never uniformly lit end to end.
  const sweep = ctx.createLinearGradient(0, 0, width, height * 0.4);
  const flip = span.grain > 0.5;
  sweep.addColorStop(0, rgba(flip ? light : dark, 0.22));
  sweep.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
  sweep.addColorStop(1, rgba(flip ? dark : light, 0.2));
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, width, height);

  // Cathedral figure: a few nested arcs sweeping along the board.
  const figures = 1 + Math.floor(random() * 2);
  for (let figure = 0; figure < figures; figure += 1) {
    const cx = width * (0.15 + random() * 0.7);
    const cy = height * (0.2 + random() * 0.6);
    const rings = 3 + Math.floor(random() * 4);
    for (let ring = 0; ring < rings; ring += 1) {
      const rx = width * (0.06 + ring * 0.035 + random() * 0.02);
      const ry = height * (0.16 + ring * 0.11);
      ctx.strokeStyle = rgba(dark, 0.06 + random() * 0.05);
      ctx.lineWidth = 0.8 + random() * 1.1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, Math.PI / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Grain lines: long, near-horizontal, gently waving.
  const lines = Math.round(26 + random() * 16);
  for (let line = 0; line < lines; line += 1) {
    const y = random() * height;
    const amplitude = 0.6 + random() * 2.4;
    const waves = 1 + Math.floor(random() * 3);
    const phase = random() * Math.PI * 2;
    const tint = random();
    ctx.strokeStyle = tint > 0.62 ? rgba(light, 0.1 + random() * 0.1) : rgba(dark, 0.08 + random() * 0.14);
    ctx.lineWidth = 0.55 + random() * 0.9;
    ctx.beginPath();
    const steps = 12;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const px = t * width;
      const py = y + Math.sin(phase + t * Math.PI * 2 * waves) * amplitude + (random() - 0.5) * 0.35;
      if (step === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Open pores: short dashes following the grain direction.
  const pores = Math.round(width * height * 0.0016);
  for (let pore = 0; pore < pores; pore += 1) {
    ctx.fillStyle = random() > 0.55 ? rgba(dark, 0.16) : rgba(light, 0.12);
    ctx.fillRect(random() * width, random() * height, 1.4 + random() * 3.6, 0.7);
  }

  // Micro-bevel: light along the top/left, shadow along the bottom/right.
  ctx.fillStyle = rgba(light, 0.4);
  ctx.fillRect(0, 0, width, 1);
  ctx.fillStyle = rgba(dark, 0.42);
  ctx.fillRect(0, height - 1.2, width, 1.2);
  ctx.fillStyle = rgba(light, 0.24);
  ctx.fillRect(0, 0, 1, height);
  ctx.fillStyle = rgba(dark, 0.3);
  ctx.fillRect(width - 1.2, 0, 1.2, height);
  ctx.restore();
}

/** Plank flooring: staggered boards with per-board colour, grain and bevelled joints. */
export function planksTexture(base: string, seed = 1, options: PlankOptions = {}): THREE.Texture | null {
  const settings = plankSettings(options);
  const key = `planks:${base}:${seed}:${settings.size}:${settings.rows}:${settings.columns}:${settings.variation}`;
  return cached(
    key,
    (ctx, size) => {
      const { rows, columns, gap, variation } = settings;
      const rowHeight = size / rows;
      const plankLength = size / columns;
      const joint = shadeHex(adjustHsl(base, 0, 0.03, -0.16), -18);

      ctx.fillStyle = joint;
      ctx.fillRect(0, 0, size, size);

      for (let row = 0; row < rows; row += 1) {
        const y = row * rowHeight;
        for (const span of plankRowSpans(row, size, plankLength, seed)) {
          const width = span.length - gap;
          const height = rowHeight - gap;
          drawWrapped(ctx, size, { x: span.start, y, w: span.length, h: rowHeight }, (target) => {
            target.translate(span.start + gap / 2, y + gap / 2);
            paintPlank(target, span, width, height, base, seed, variation);
          });
        }
      }

      // Board joints read as thin dark channels; a faint highlight sells the bevel.
      for (let row = 0; row < rows; row += 1) {
        const y = row * rowHeight;
        drawWrapped(ctx, size, { x: 0, y: y - gap / 2, w: size, h: gap }, (target) => {
          target.fillStyle = rgba(joint, 0.55);
          target.fillRect(0, y - gap / 2, size, gap);
        });
      }

      // Whole-floor wear: very low contrast, periodic, so it never shows a grid.
      overlayNoise(ctx, size, grainTile(GRAIN_WOOD, 0.5, 256), 0.5);
      overlayNoise(
        ctx,
        size,
        noiseTile('plank-wear', 512, (x, y) => 0.5 + (periodicFbm(x, y, { octaves: 3, freq: 2, gain: 0.6, seed: 401 }) - 0.5) * 0.42),
        0.35,
      );
    },
    { size: settings.size },
  );
}

/** Height detail for plank floors: boards raised, joints recessed. */
export function planksBumpTexture(base: string, seed = 1, options: PlankOptions = {}): THREE.Texture | null {
  const settings = plankSettings(options);
  const bumpSize = Math.min(512, settings.size);
  const key = `planks-bump:${base}:${seed}:${bumpSize}:${settings.rows}:${settings.columns}`;
  return cached(
    key,
    (ctx, size) => {
      const { rows, columns } = settings;
      const gap = settings.gap * (size / settings.size);
      const rowHeight = size / rows;
      const plankLength = size / columns;
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(0, 0, size, size);
      for (let row = 0; row < rows; row += 1) {
        const y = row * rowHeight;
        for (const span of plankRowSpans(row, size, plankLength, seed)) {
          drawWrapped(ctx, size, { x: span.start, y, w: span.length, h: rowHeight }, (target) => {
            const x = span.start + gap / 2;
            const width = span.length - gap;
            const height = rowHeight - gap;
            const gradient = target.createLinearGradient(0, y, 0, y + rowHeight);
            gradient.addColorStop(0, '#c8c8c8');
            gradient.addColorStop(0.5, '#ffffff');
            gradient.addColorStop(1, '#bcbcbc');
            target.fillStyle = gradient;
            target.fillRect(x, y + gap / 2, width, height);
          });
        }
      }
      overlayNoise(ctx, size, grainTile(GRAIN_WOOD, 0.5, 256), 0.55, 'overlay');
    },
    { size: bumpSize, kind: 'data' },
  );
}

/* ----------------------------------------------------------------- chevron */

export type ChevronOptions = { size?: number; columns?: number; rows?: number; gap?: number };

const CHEVRON_DEFAULTS: Required<ChevronOptions> = { size: 1024, columns: 4, rows: 12, gap: 2.6 };

/**
 * Chevron parquet: mitred boards meeting on vertical column lines.
 *
 * Geometry: inside column `c` the boards are parallelograms with vertical ends
 * and a 45-degree slope `d = +/-1`. The next column's boards start one column
 * width higher/lower, which is what makes the V meet exactly on the mitre. The
 * column count is even, so the mitre offsets return to zero at the tile border,
 * and the board pitch divides the tile height, so courses wrap vertically.
 */
export function chevronTexture(base: string, seed = 3, options: ChevronOptions = {}): THREE.Texture | null {
  const settings = { ...CHEVRON_DEFAULTS, ...options };
  const key = `chevron:${base}:${seed}:${settings.size}:${settings.columns}:${settings.rows}`;
  return cached(
    key,
    (ctx, size) => {
      const columns = Math.max(2, settings.columns % 2 === 0 ? settings.columns : settings.columns + 1);
      const columnWidth = size / columns;
      const pitch = size / settings.rows;
      const rows = chevronRowCount(size, pitch);
      const joint = shadeHex(adjustHsl(base, 0, 0.03, -0.18), -16);
      ctx.fillStyle = joint;
      ctx.fillRect(0, 0, size, size);

      // Enough courses above and below to cover the slant that leans into the tile.
      const overscan = Math.ceil((columnWidth + size) / pitch) + 2;
      for (let column = 0; column < columns; column += 1) {
        const direction = column % 2 === 0 ? 1 : -1;
        const base0 = column % 2 === 0 ? 0 : columnWidth;
        const xL = column * columnWidth;
        const xR = xL + columnWidth;
        for (let index = -overscan; index <= rows + overscan; index += 1) {
          const top = base0 + index * pitch;
          const span: PlankSpan = {
            start: xL,
            length: columnWidth,
            row: wrapIndex(index, rows),
            index: column,
            tone: hash2(column, wrapIndex(index, rows), seed),
            hue: hash2(column, wrapIndex(index, rows) + 51, seed),
            grain: hash2(column, wrapIndex(index, rows) + 97, seed),
          };
          const body = woodPlankColor(base, span);
          const dark = adjustHsl(body, 0.004, 0.05, -0.11);
          const light = adjustHsl(body, -0.004, -0.03, 0.08);
          const inset = settings.gap / 2;

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(xL + inset, top + inset);
          ctx.lineTo(xR - inset, top + direction * columnWidth + inset);
          ctx.lineTo(xR - inset, top + direction * columnWidth + pitch - inset);
          ctx.lineTo(xL + inset, top + pitch - inset);
          ctx.closePath();
          ctx.fillStyle = body;
          ctx.fill();
          ctx.clip();

          // Grain runs along the board: rotate into the board's own frame.
          const angle = Math.atan2(direction * columnWidth, columnWidth);
          ctx.translate(xL, top + pitch / 2);
          ctx.rotate(angle);
          const length = Math.hypot(columnWidth, columnWidth) + 4;
          const random = makeRandom((column * 8191 + wrapIndex(index, rows) * 131 + seed) >>> 0);
          for (let line = 0; line < 16; line += 1) {
            const y = (random() - 0.5) * pitch * 1.4;
            ctx.strokeStyle = random() > 0.6 ? rgba(light, 0.12) : rgba(dark, 0.13);
            ctx.lineWidth = 0.5 + random() * 0.9;
            ctx.beginPath();
            const steps = 8;
            for (let step = 0; step <= steps; step += 1) {
              const t = step / steps;
              const px = -2 + t * length;
              const py = y + Math.sin(t * Math.PI * 2 + random() * 0.2) * 1.1;
              if (step === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
          ctx.fillStyle = rgba(light, 0.22);
          ctx.fillRect(-2, -pitch / 2, length, 1);
          ctx.fillStyle = rgba(dark, 0.26);
          ctx.fillRect(-2, pitch / 2 - 1.2, length, 1.2);
          ctx.restore();
        }
      }
      overlayNoise(ctx, size, grainTile(GRAIN_WOOD, 0.5, 256), 0.45);
    },
    { size: settings.size },
  );
}

/* -------------------------------------------------------------- wood grain */

export type WoodGrainOptions = {
  size?: number;
  /** Grain lines across one tile; the spacing `size / lines` divides the tile exactly. */
  lines?: number;
  /** Cathedral knots per tile. */
  knots?: number;
  /** 0..1 multiplier on how strongly the grain contrasts with the body. */
  variation?: number;
};

const GRAIN_DEFAULTS: Required<WoodGrainOptions> = { size: 512, lines: 44, knots: 2, variation: 1 };

/**
 * Solid wood for furniture panels: grain without plank joints.
 *
 * Unlike `planksTexture` this is one continuous board, so cabinet doors and
 * table tops never show a floor-like joint grid. Every grain line is a periodic
 * wave of `x` (integer lattice frequencies), the line spacing divides the tile
 * exactly, and knots are painted through `drawWrapped` - so the tile is
 * seamless in both axes.
 */
export function woodGrainTexture(base: string, seed = 1, options: WoodGrainOptions = {}): THREE.Texture | null {
  const settings = { ...GRAIN_DEFAULTS, ...options };
  const key = `wood-grain:${base}:${seed}:${settings.size}:${settings.lines}:${settings.knots}:${settings.variation}`;
  return cached(
    key,
    (ctx, size) => {
      const { lines, knots, variation } = settings;
      const random = makeRandom(seed * 9176 + 13);
      const dark = adjustHsl(base, 0.004, 0.05, -0.1 * variation);
      const light = adjustHsl(base, -0.004, -0.03, 0.075 * variation);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);

      // Broad tone drift across the board; periodic, so the ends still match.
      overlayNoise(
        ctx,
        size,
        noiseTile('wood-drift', 256, (x, y) => 0.5 + (periodicFbm(x, y, { octaves: 3, freq: 2, gain: 0.55, seed: 811 }) - 0.5) * 0.3),
        0.45,
      );

      const step = size / lines;
      for (let line = 0; line < lines; line += 1) {
        const y0 = (line + 0.5) * step;
        const amplitude = step * (0.5 + random() * 1.7);
        const freq = 1 + Math.floor(random() * 3);
        const phase = random();
        const pale = random() > 0.62;
        ctx.strokeStyle = pale ? rgba(light, 0.12 + random() * 0.12) : rgba(dark, 0.1 + random() * 0.16);
        ctx.lineWidth = 0.5 + random() * 1.2;
        ctx.beginPath();
        const steps = 64;
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          // Both terms have period 1 in `t`, so the line closes onto itself at the border.
          const wobble =
            (periodicNoise2D(t, phase, freq * 2, seed + line) - 0.5) * amplitude +
            Math.sin((t + phase) * Math.PI * 2 * freq) * amplitude * 0.35;
          const px = t * size;
          const py = y0 + wobble;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // Knots: nested rings, repainted on the far side when they cross a border.
      for (let knot = 0; knot < knots; knot += 1) {
        const cx = random() * size;
        const cy = random() * size;
        const rings = 4 + Math.floor(random() * 4);
        const rx = size * (0.012 + random() * 0.012);
        const ry = size * (0.03 + random() * 0.03);
        const extent = Math.max(rx, ry) * (rings + 1);
        drawWrapped(ctx, size, { x: cx - extent, y: cy - extent, w: extent * 2, h: extent * 2 }, (target) => {
          target.translate(cx, cy);
          for (let ring = 0; ring < rings; ring += 1) {
            target.strokeStyle = rgba(dark, 0.16 - ring * 0.016);
            target.lineWidth = 0.7 + ring * 0.12;
            target.beginPath();
            target.ellipse(0, 0, rx * (1 + ring * 0.9), ry * (1 + ring * 0.75), 0, 0, Math.PI * 2);
            target.stroke();
          }
        });
      }

      overlayNoise(ctx, size, grainTile(GRAIN_WOOD, 0.42, 256), 0.5);
    },
    { size: settings.size },
  );
}

/** Height detail for solid wood: open pores stretched along the grain direction. */
export function woodGrainBumpTexture(seed = 1, options: WoodGrainOptions = {}): THREE.Texture | null {
  const settings = { ...GRAIN_DEFAULTS, ...options };
  const key = `wood-grain-bump:${seed}:${settings.lines}`;
  return cached(
    key,
    (ctx, size) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, size, size);
      overlayNoise(
        ctx,
        size,
        noiseTile('wood-pores', 256, (x, y) => {
          // Six times the lattice frequency across the grain: reads as pores, not as noise.
          const along = periodicFbm(x, y * 6, { octaves: 3, freq: 4, gain: 0.5, seed: 613 });
          return 0.5 + (along - 0.5) * 0.9;
        }),
        0.85,
        'overlay',
      );
      overlayNoise(ctx, size, grainTile(GRAIN_WOOD, 0.5, 256), 0.5, 'overlay');
    },
    { size: 256, kind: 'data' },
  );
}
