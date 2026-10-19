/**
 * The one way to obtain a 2D drawing surface, and the one null policy behind
 * it: every procedural texture, swatch and preview in the library goes through
 * `createCanvas2D`.
 *
 * Invariant: `null` means "there is no 2D canvas here" — no `document`, a
 * document stubbed down to less than `createElement`, or a browser that
 * refuses a `'2d'` context — and it is never an error. A null texture means "no
 * procedural texture": the material keeps its flat colour and a swatch is not
 * drawn. That is what lets the pure catalogue tests run under Bun, where there
 * is no DOM at all, and it is why this policy lives in ONE place instead of
 * being re-decided at each of the eight canvas sites.
 *
 * Three.js-free by design, so a pure module (`assets/opening-variants.ts`) can
 * draw a swatch without reaching a renderer; the Three.js side of the same
 * plumbing is `texture-canvas.ts`.
 */

export type Ctx = CanvasRenderingContext2D;

/** A canvas and its 2D context; the two are only ever handed out together. */
export type Canvas2D = { canvas: HTMLCanvasElement; ctx: Ctx };

/**
 * A `width x height` canvas with a high-quality 2D context, or `null` when this
 * runtime has none to give.
 *
 * `'createElement' in document` and not just `typeof document`: the unit
 * harnesses stub `document` down to the one surface they drive, and a
 * half-document is as unavailable as none at all.
 */
export function createCanvas2D(width: number, height: number = width): Canvas2D | null {
  if (typeof document === 'undefined' || !('createElement' in document)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}
