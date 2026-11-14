/**
 * What a resting walk or tour view changes from one rest frame to the next,
 * so that the running mean of its frames converges (`render-demand.ts` counts
 * the rest frames, `rest-accumulate-pass.ts` keeps the mean, `walk-post.ts`
 * draws them).
 *
 * Frame 0 of a rest is today's picture: no jitter and three's own GTAO noise.
 * Every later frame moves the projection by a sub-pixel offset from the
 * Halton(2, 3) sequence, centred on the pixel, so the mean antialiases every
 * edge, and turns the GTAO noise by another angle, so the occlusion's noise
 * pattern averages out. Nothing here moves the camera's pose.
 *
 * Pure: no `three` and no DOM; matrices are column-major arrays as three keeps them.
 */

/** The camera modes whose resting view accumulates: the two where nothing is edited. */
const ACCUMULATING_MODES: ReadonlySet<string> = new Set(['walk', 'tour']);

/** Whether a resting view in `mode` draws rest frames. */
export function accumulatesIn(mode: string | undefined): boolean {
  return mode !== undefined && ACCUMULATING_MODES.has(mode);
}

/** The `index`th element (from 1) of the van der Corput sequence in `base`, in [0, 1). */
export function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  for (let rest = index; rest > 0; rest = Math.floor(rest / base)) {
    result += (rest % base) * fraction;
    fraction /= base;
  }
  return result;
}

/** Rest frame `frame`'s offset in device pixels, x right and y up, each in (-0.5, 0.5); frame 0 is not moved. */
export function restJitter(frame: number): readonly [number, number] {
  if (frame === 0) return [0, 0];
  return [halton(frame, 2) - 0.5, halton(frame, 3) - 0.5];
}

/**
 * Moves what `elements` (a column-major projection matrix) projects by `dx`
 * and `dy` device pixels on a `width` x `height` buffer: a translation in
 * clip space applied after the projection, so a perspective and an
 * orthographic view move alike at every depth.
 */
export function jitterProjection(elements: number[], dx: number, dy: number, width: number, height: number): void {
  const x = (2 * dx) / width;
  const y = (2 * dy) / height;
  for (let column = 0; column < 4; column += 1) {
    const w = elements[column * 4 + 3]!;
    elements[column * 4] = elements[column * 4]! + x * w;
    elements[column * 4 + 1] = elements[column * 4 + 1]! + y * w;
  }
}

/** The golden angle: successive multiples of it spread over the circle as evenly as any sequence can. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** The angle rest frame `frame` turns the GTAO noise by, radians in [0, 2π); frame 0 keeps it. */
export function restNoiseAngle(frame: number): number {
  return (frame * GOLDEN_ANGLE) % (2 * Math.PI);
}

/**
 * Writes into `out` three's GTAO noise `base` (RGBA bytes, a unit direction
 * in red and green) with every direction turned by `angle`; blue and alpha
 * are copied.
 */
export function rotateNoise(base: Uint8Array, angle: number, out: Uint8Array): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let index = 0; index < base.length; index += 4) {
    if (angle === 0) {
      out[index] = base[index]!;
      out[index + 1] = base[index + 1]!;
    } else {
      const x = base[index]! / 127.5 - 1;
      const y = base[index + 1]! / 127.5 - 1;
      out[index] = Math.round(((cos * x - sin * y) * 0.5 + 0.5) * 255);
      out[index + 1] = Math.round(((sin * x + cos * y) * 0.5 + 0.5) * 255);
    }
    out[index + 2] = base[index + 2]!;
    out[index + 3] = base[index + 3]!;
  }
}

/**
 * The weight rest frame `frame` (from 0) gets in the running mean, which the
 * accumulation mixes in as `mean + (sample - mean) * weight`: 1 at frame 0,
 * which starts the mean again, then 1 / (frame + 1), so after frame `k` the
 * mean holds frames 0 to `k` in equal parts.
 */
export function restMeanWeight(frame: number): number {
  return 1 / (frame + 1);
}
