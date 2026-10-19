/**
 * Procedural surface textures: the entry point the rest of the app imports.
 *
 * Mineral, plaster, wallpaper and fabric patterns live here; the wooden floors
 * are in `textures-wood.ts` and the canvas/noise plumbing in
 * `texture-canvas.ts`, both re-exported below so callers only need this module.
 *
 * Invariant: every texture used with `RepeatWrapping` is drawn on a torus -
 * shapes crossing the tile border are painted again one tile away, tile grids
 * divide the canvas exactly, and all noise is periodic value noise with integer
 * lattice frequencies (see `texture-noise.ts`, unit-tested headlessly). Nothing
 * uses `Math.random`, so renders are reproducible. Generators return `null`
 * when there is no `document` (bun test, SSR).
 */

import * as THREE from 'three';
import {
  GRAIN_FABRIC,
  GRAIN_MINERAL,
  GRAIN_PAPER,
  cached,
  drawWrapped,
  grainTile,
  noiseTile,
  overlayNoise,
  type Ctx,
} from './texture-canvas.js';
import {
  adjustHsl,
  hash2,
  makeRandom,
  periodicFbm,
  periodicNoise2D,
  periodicRidge,
  rgba,
  shadeHex,
  terrazzoPalette,
  tileGrid,
} from './texture-noise.js';

export { getTextureAnisotropy, resetTextureCache, setTextureAnisotropy } from './texture-canvas.js';
export { chevronTexture, planksBumpTexture, planksTexture, woodGrainBumpTexture, woodGrainTexture } from './textures-wood.js';
/* ---------------------------------------------------------------- terrazzo */

/** Terrazzo: graded chips over a polished slab, every chip drawn on all wrapped copies. */
export function terrazzoTexture(base = '#a7b5a6', seed = 7): THREE.Texture | null {
  return cached(
    `terrazzo:${base}:${seed}`,
    (ctx, size) => {
      const random = makeRandom(seed * 40503 + 11);
      const palette = terrazzoPalette(base);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      overlayNoise(ctx, size, grainTile(GRAIN_MINERAL, 0.7, 256), 0.5);

      // Three size classes, from fine grit to statement chips. Fractions are of
      // the tile, which covers TERRAZZO_TILE metres: roughly 0.7 cm to 4.5 cm.
      const classes = [
        { count: 2600, min: size * 0.003, max: size * 0.0065, alpha: 0.55 },
        { count: 700, min: size * 0.0065, max: size * 0.0125, alpha: 0.8 },
        { count: 190, min: size * 0.0125, max: size * 0.019, alpha: 0.9 },
      ];
      for (const group of classes) {
        for (let index = 0; index < group.count; index += 1) {
          const cx = random() * size;
          const cy = random() * size;
          const radius = group.min + random() * (group.max - group.min);
          // `random()` is in [0, 1) and a terrazzo palette always has chips.
          const colour = palette[Math.floor(random() * palette.length)]!;
          const points = 5 + Math.floor(random() * 4);
          const shape: { x: number; y: number }[] = [];
          const squash = 0.65 + random() * 0.6;
          const spin = random() * Math.PI;
          for (let point = 0; point < points; point += 1) {
            const angle = (point / points) * Math.PI * 2 + random() * 0.5;
            const distance = radius * (0.62 + random() * 0.55);
            shape.push({
              x: Math.cos(angle + spin) * distance,
              y: Math.sin(angle + spin) * distance * squash,
            });
          }
          const alpha = group.alpha * (0.7 + random() * 0.3);
          const edge = rgba(colour, Math.min(1, alpha * 0.5));
          drawWrapped(ctx, size, { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 }, (target) => {
            target.translate(cx, cy);
            target.beginPath();
            shape.forEach((point, order) => {
              if (order === 0) target.moveTo(point.x, point.y);
              else target.lineTo(point.x, point.y);
            });
            target.closePath();
            target.fillStyle = rgba(colour, alpha);
            target.fill();
            target.strokeStyle = edge;
            target.lineWidth = 0.6;
            target.stroke();
          });
        }
      }
      // Polished sheen: broad, very low contrast, periodic.
      overlayNoise(
        ctx,
        size,
        noiseTile('terrazzo-sheen', 512, (x, y) => 0.5 + (periodicFbm(x, y, { octaves: 2, freq: 2, gain: 0.5, seed: 707 }) - 0.5) * 0.3),
        0.35,
      );
    },
    { size: 1024 },
  );
}

/* ------------------------------------------------------------------- tiles */

/** How a tile face is painted. One `TILE_PAINTERS` row each. */
export type TileStyle = 'ceramic' | 'stone';

export type TileOptions = {
  size?: number;
  /** Tiles per axis inside one texture tile. */
  grid?: number;
  /** `ceramic` gets a glaze gradient, `stone` gets soft veining. */
  style?: TileStyle;
  /** Grout width as a fraction of one tile. */
  grout?: number;
};

const TILE_DEFAULTS: Required<TileOptions> = { size: 512, grid: 2, style: 'ceramic', grout: 0.035 };

/** The rectangle one tile is painted into, in canvas pixels. */
type TileBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/**
 * How one `TileStyle` fills a tile face, on top of the flat body colour and
 * under the fired edge.
 *
 * `body` is the tone-shifted base the painter varies around; `random` is the
 * per-tile stream, so a painter may take as many samples as it likes without
 * disturbing the next tile.
 */
type TilePainter = (ctx: Ctx, box: TileBox, body: string, random: () => number) => void;

/** How far a style spreads the per-tile lightness; stone varies far more than glaze. */
const TILE_TONE_SPREAD: Readonly<Record<TileStyle, number>> = { stone: 0.075, ceramic: 0.03 };

/** Cloudy bedding, drifting veins and mineral specks. */
const paintStoneFace: TilePainter = (ctx, box, body, random) => {
  const { x, y, width, height } = box;
  const clouds = 4 + Math.floor(random() * 3);
  for (let cloud = 0; cloud < clouds; cloud += 1) {
    const cx = x + random() * width;
    const cy = y + random() * height;
    const radius = width * (0.25 + random() * 0.45);
    const wash = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
    const warm = random() > 0.5;
    wash.addColorStop(0, rgba(adjustHsl(body, warm ? 0.012 : -0.01, 0.03, warm ? 0.05 : -0.045), 0.4));
    wash.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = wash;
    ctx.fillRect(x, y, width, height);
  }
  const veins = 2 + Math.floor(random() * 3);
  for (let vein = 0; vein < veins; vein += 1) {
    const light = random() > 0.5;
    const colour = light ? adjustHsl(body, 0, -0.2, 0.12) : adjustHsl(body, 0.012, 0.08, -0.11);
    const startX = x - width * 0.2 + random() * width * 1.2;
    const startY = y - height * 0.2 + random() * height * 1.2;
    const angle = random() * Math.PI;
    const length = width * (1 + random() * 0.9);
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      const steps = 14;
      let px = startX;
      let py = startY;
      let heading = angle;
      let drift = 0;
      for (let step = 0; step < steps; step += 1) {
        drift += (hash2(vein * 37 + step, Math.round(startY), Math.round(startX)) - 0.5) * 0.5;
        heading += drift * 0.35;
        px += Math.cos(heading) * (length / steps);
        py += Math.sin(heading) * (length / steps);
        ctx.lineTo(px, py);
      }
    };
    // A soft halo under a crisper core reads as mineral, not as ink.
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(colour, 0.14);
    ctx.lineWidth = 7 + random() * 9;
    trace();
    ctx.stroke();
    ctx.strokeStyle = rgba(colour, 0.3 + random() * 0.2);
    ctx.lineWidth = 1.4 + random() * 2.2;
    trace();
    ctx.stroke();
  }
  const specks = Math.round(width * height * 0.005);
  for (let speck = 0; speck < specks; speck += 1) {
    ctx.fillStyle = random() > 0.5 ? rgba(adjustHsl(body, 0, 0, 0.14), 0.24) : rgba(adjustHsl(body, 0, 0, -0.14), 0.22);
    ctx.fillRect(x + random() * width, y + random() * height, 1.3, 1.3);
  }
};

/** A soft off-centre glaze sheen with a few dust specks. */
const paintCeramicFace: TilePainter = (ctx, box, body, random) => {
  const { x, y, width, height } = box;
  // Deltas stay small so dark tiles do not develop a visible ring where the
  // gradient falls off.
  const glaze = ctx.createRadialGradient(
    x + width * (0.35 + random() * 0.3),
    y + height * (0.3 + random() * 0.3),
    width * 0.02,
    x + width / 2,
    y + height / 2,
    width * 0.95,
  );
  glaze.addColorStop(0, rgba(adjustHsl(body, 0, -0.06, 0.035), 0.22));
  glaze.addColorStop(0.75, 'rgba(255, 255, 255, 0)');
  glaze.addColorStop(1, rgba(adjustHsl(body, 0, 0.02, -0.03), 0.12));
  ctx.fillStyle = glaze;
  ctx.fillRect(x, y, width, height);
  const specks = Math.round(width * height * 0.0016);
  for (let speck = 0; speck < specks; speck += 1) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255, 255, 255, 0.07)' : 'rgba(60, 56, 50, 0.05)';
    ctx.fillRect(x + random() * width, y + random() * height, 1.6, 1.1);
  }
};

/**
 * One painter per `TileStyle`. Adding a style is adding a painter and one row,
 * never another branch inside `paintTileFace` — the shape this replaced was
 * `if (style === 'stone') { 50 lines } else { 20 lines }`.
 */
const TILE_PAINTERS: Readonly<Record<TileStyle, TilePainter>> = { stone: paintStoneFace, ceramic: paintCeramicFace };

/**
 * One tile: the body colour, the style's own pattern, and the fired edge that
 * every style shares.
 *
 * Clipped to its own rectangle, so a painter may draw past the tile (a vein
 * starts outside it on purpose) without bleeding into its neighbours.
 */
function paintTileFace(ctx: Ctx, box: TileBox, base: string, style: TileStyle, tone: number, random: () => number): void {
  const { x, y, width, height } = box;
  const spread = TILE_TONE_SPREAD[style];
  const body = adjustHsl(base, (tone - 0.5) * 0.012, (tone - 0.5) * 0.03, (tone - 0.5) * spread);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = body;
  ctx.fillRect(x, y, width, height);

  TILE_PAINTERS[style](ctx, box, body, random);

  // Fired edge: tiles are very slightly darker where they curve down to the grout.
  const edge = ctx.createLinearGradient(x, y, x, y + height);
  edge.addColorStop(0, 'rgba(255, 255, 255, 0.07)');
  edge.addColorStop(0.12, 'rgba(255, 255, 255, 0)');
  edge.addColorStop(0.9, 'rgba(0, 0, 0, 0)');
  edge.addColorStop(1, 'rgba(0, 0, 0, 0.06)');
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

/**
 * Ceramic or stone tiles with grout.
 *
 * The grout band on the tile border is half width on each side, so two adjacent
 * texture repeats form one full-width joint - the border joint is identical to
 * the interior ones and the seam disappears.
 */
export function tilesTexture(base: string, grout: string, seed = 11, options: TileOptions = {}): THREE.Texture | null {
  const settings = { ...TILE_DEFAULTS, ...options };
  const key = `tiles:${base}:${grout}:${seed}:${settings.size}:${settings.grid}:${settings.style}:${settings.grout}`;
  return cached(
    key,
    (ctx, size) => {
      const random = makeRandom(seed * 7717 + 29);
      const step = size / settings.grid;
      const groutWidth = Math.max(2, step * settings.grout);
      ctx.fillStyle = grout;
      ctx.fillRect(0, 0, size, size);
      overlayNoise(ctx, size, grainTile(GRAIN_MINERAL, 0.7, 256), 0.5);

      for (const cell of tileGrid(size, settings.grid, seed)) {
        const box = {
          x: cell.x + groutWidth / 2,
          y: cell.y + groutWidth / 2,
          width: cell.width - groutWidth,
          height: cell.height - groutWidth,
        };
        paintTileFace(ctx, box, base, settings.style, cell.tone, random);
      }

      // Grout shading: a slight shadow where the tile meets the joint.
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.lineWidth = 1;
      for (const cell of tileGrid(size, settings.grid, seed)) {
        const x = cell.x + groutWidth / 2;
        const y = cell.y + groutWidth / 2;
        ctx.strokeRect(x - 0.5, y - 0.5, cell.width - groutWidth + 1, cell.height - groutWidth + 1);
      }
      ctx.restore();
      // High enough frequency that the sheen reads as surface, not as a blotch
      // sitting on individual tiles.
      overlayNoise(
        ctx,
        size,
        noiseTile('tile-sheen', size, (x, y) => 0.5 + (periodicFbm(x, y, { octaves: 3, freq: 12, gain: 0.5, seed: 133 }) - 0.5) * 0.18),
        0.3,
      );
    },
    { size: settings.size },
  );
}

/** Height detail for tiles: faces raised and slightly domed, grout recessed. */
export function tilesBumpTexture(seed = 11, options: TileOptions = {}): THREE.Texture | null {
  const settings = { ...TILE_DEFAULTS, ...options };
  const key = `tiles-bump:${seed}:${settings.grid}:${settings.grout}`;
  return cached(
    key,
    (ctx, size) => {
      const step = size / settings.grid;
      const groutWidth = Math.max(2, step * settings.grout);
      ctx.fillStyle = '#2e2e2e';
      ctx.fillRect(0, 0, size, size);
      for (const cell of tileGrid(size, settings.grid, seed)) {
        const x = cell.x + groutWidth / 2;
        const y = cell.y + groutWidth / 2;
        const width = cell.width - groutWidth;
        const height = cell.height - groutWidth;
        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, '#d0d0d0');
        gradient.addColorStop(0.5, '#ffffff');
        gradient.addColorStop(1, '#cccccc');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, width, height);
      }
    },
    { size: 256, kind: 'data' },
  );
}

/* ----------------------------------------------------------------- plaster */

/**
 * Painted plaster: a flat base modulated by fine periodic noise.
 * The noise lattice frequencies are integers, so no tiling grid appears even at
 * the low repeat counts walls use.
 */
export function plasterTexture(base: string, seed = 5): THREE.Texture | null {
  return cached(
    `plaster:${base}:${seed}`,
    (ctx, size) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      // Trowel-scale undulation, then a fine tooth: both periodic, both subtle.
      overlayNoise(
        ctx,
        size,
        noiseTile('plaster-broad', size, (x, y) => 0.5 + (periodicFbm(x, y, { octaves: 4, freq: 3, gain: 0.55, seed: 21 }) - 0.5) * 0.34),
        0.5,
      );
      overlayNoise(
        ctx,
        size,
        noiseTile('plaster-tooth', 256, (x, y) => {
          const fine = periodicFbm(x, y, { octaves: 3, freq: 32, gain: 0.5, seed: 55 });
          return 0.5 + (fine - 0.5) * 0.5;
        }),
        0.28,
      );
    },
    { size: 512 },
  );
}

/* -------------------------------------------------------------- wallpapers */

export type StripeOptions = { size?: number; periods?: number; seed?: number };

/**
 * Striped wallpaper: an integer number of stripe periods per tile, so the
 * pattern repeats exactly at the border. Each period carries one wide band and
 * a pair of pinstripes over a lightly textured paper ground.
 */
export function stripesTexture(base: string, stripe: string, options: StripeOptions = {}): THREE.Texture | null {
  const periods = Math.max(1, Math.round(options.periods ?? 4));
  const seed = options.seed ?? 9;
  const size = options.size ?? 512;
  return cached(
    `stripes:${base}:${stripe}:${periods}:${seed}:${size}`,
    (ctx, canvasSize) => {
      const period = canvasSize / periods;
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, canvasSize, canvasSize);
      // Paper ground: a fine linen tooth with a slight vertical bias.
      overlayNoise(
        ctx,
        canvasSize,
        noiseTile('paper', 256, (x, y) => {
          const weave = periodicNoise2D(x, y, 96, 12) * 0.6 + periodicNoise2D(x, y, 24, 34) * 0.4;
          return 0.5 + (weave - 0.5) * 0.42;
        }),
        0.45,
      );

      for (let index = 0; index < periods; index += 1) {
        const x = index * period;
        const wide = period * 0.42;
        const pin = Math.max(1.5, period * 0.035);
        const bands: { x: number; w: number; color: string; alpha: number }[] = [
          { x: x + period * 0.06, w: wide, color: stripe, alpha: 1 },
          { x: x + period * 0.06 + wide + period * 0.06, w: pin, color: stripe, alpha: 0.75 },
          { x: x + period * 0.06 + wide + period * 0.12, w: pin * 0.6, color: stripe, alpha: 0.5 },
        ];
        for (const band of bands) {
          drawWrapped(
            ctx,
            canvasSize,
            { x: ((band.x % canvasSize) + canvasSize) % canvasSize, y: 0, w: band.w, h: canvasSize },
            (target) => {
              const bx = ((band.x % canvasSize) + canvasSize) % canvasSize;
              target.globalAlpha = band.alpha;
              target.fillStyle = band.color;
              target.fillRect(bx, 0, band.w, canvasSize);
              // Soft edges: printed stripes are never razor sharp.
              const edge = target.createLinearGradient(bx, 0, bx + band.w, 0);
              edge.addColorStop(0, 'rgba(0, 0, 0, 0.06)');
              edge.addColorStop(0.08, 'rgba(0, 0, 0, 0)');
              edge.addColorStop(0.92, 'rgba(0, 0, 0, 0)');
              edge.addColorStop(1, 'rgba(0, 0, 0, 0.06)');
              target.fillStyle = edge;
              target.fillRect(bx, 0, band.w, canvasSize);
              target.globalAlpha = 1;
            },
          );
        }
      }
      overlayNoise(ctx, canvasSize, grainTile(GRAIN_PAPER, 0.35, 256), 0.3);
    },
    { size },
  );
}

/* ------------------------------------------------------------------ fabric */

export type WeaveOptions = {
  size?: number;
  /** Threads per axis inside one texture tile; divides the canvas exactly. */
  threads?: number;
  /** 0..1 spread between warp and weft tone, plus per-thread jitter. */
  variance?: number;
  seed?: number;
};

const WEAVE_DEFAULTS: Required<WeaveOptions> = { size: 256, threads: 64, variance: 0.1, seed: 5 };

/**
 * Plain-weave upholstery: alternating warp and weft threads over a dyed ground.
 *
 * Seamless by construction: `size / threads` is exact, so the thread that owns
 * the tile border is continued by its wrapped copy, thread tones come from the
 * lattice hash (identical for column `0` and column `threads`), and the slubs
 * are periodic noise rather than scattered dots.
 */
export function fabricTexture(base: string, options: WeaveOptions = {}): THREE.Texture | null {
  const settings = { ...WEAVE_DEFAULTS, ...options };
  const key = `fabric:${base}:${settings.size}:${settings.threads}:${settings.variance}:${settings.seed}`;
  return cached(
    key,
    (ctx, size) => {
      const { threads, variance, seed } = settings;
      const step = size / threads;
      const warpTone = adjustHsl(base, 0, -0.02, variance * 0.55);
      const weftTone = adjustHsl(base, 0, 0.02, -variance * 0.55);
      ctx.fillStyle = adjustHsl(base, 0, 0.01, -variance * 0.9);
      ctx.fillRect(0, 0, size, size);

      // One pass per direction so the over/under alternation is visible at grazing angles.
      for (let row = 0; row < threads; row += 1) {
        for (let col = 0; col < threads; col += 1) {
          const warp = (row + col) % 2 === 0;
          const jitter = (hash2(col, row, seed) - 0.5) * variance;
          const tone = adjustHsl(warp ? warpTone : weftTone, 0, 0, jitter);
          ctx.fillStyle = rgba(tone, warp ? 0.85 : 0.8);
          // Threads overlap their cell slightly, so no ground shows through the weave.
          if (warp) ctx.fillRect(col * step, row * step - step * 0.05, step * 1.02, step * 0.62);
          else ctx.fillRect(col * step - step * 0.05, row * step, step * 0.62, step * 1.02);
        }
      }

      // Slubs and nap: periodic fields, so the cloth never shows a repeat grid.
      overlayNoise(
        ctx,
        size,
        noiseTile(`weave-slub:${seed}`, 256, (x, y) => {
          const slub = periodicFbm(x, y, { octaves: 3, freq: 6, gain: 0.55, seed: seed * 7 + 3 });
          return 0.5 + (slub - 0.5) * 0.55;
        }),
        0.4,
      );
      overlayNoise(ctx, size, grainTile(GRAIN_FABRIC, 0.55, 256), 0.42);
    },
    { size: settings.size },
  );
}

/** Height detail for `fabricTexture`: the same weave as a light/dark relief. */
export function fabricBumpTexture(options: WeaveOptions = {}): THREE.Texture | null {
  const settings = { ...WEAVE_DEFAULTS, ...options };
  const key = `fabric-bump:${settings.threads}:${settings.seed}`;
  return cached(
    key,
    (ctx, size) => {
      const { threads, seed } = settings;
      const step = size / threads;
      ctx.fillStyle = '#4a4a4a';
      ctx.fillRect(0, 0, size, size);
      for (let row = 0; row < threads; row += 1) {
        for (let col = 0; col < threads; col += 1) {
          const warp = (row + col) % 2 === 0;
          const level = Math.round(150 + hash2(col, row, seed) * 90);
          ctx.fillStyle = `rgb(${level}, ${level}, ${level})`;
          if (warp) ctx.fillRect(col * step, row * step, step * 1.02, step * 0.6);
          else ctx.fillRect(col * step, row * step, step * 0.6, step * 1.02);
        }
      }
    },
    { size: 256, kind: 'data' },
  );
}

/* --------------------------------------------------------------------- sky */

/** Soft vertical gradient used as the viewer sky. */
export function skyTexture(top: string, horizon: string): THREE.Texture | null {
  return cached(
    `sky:${top}:${horizon}`,
    (ctx, size) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, size);
      gradient.addColorStop(0, top);
      gradient.addColorStop(0.62, horizon);
      gradient.addColorStop(1, shadeHex(horizon, 14));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      // A whisper of cloud keeps the large flat gradient from banding.
      overlayNoise(
        ctx,
        size,
        noiseTile('sky-veil', 128, (x, y) => 0.5 + (periodicRidge(x, y, { octaves: 3, freq: 2, gain: 0.5, seed: 3 }) - 0.5) * 0.25),
        0.3,
      );
    },
    { size: 256, repeatWrap: false },
  );
}
