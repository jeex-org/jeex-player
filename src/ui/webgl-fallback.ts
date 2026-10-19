/**
 * The flat stand-in painted into the scene canvas when there is no WebGL
 * context: a horizon gradient with one massing silhouette, so a browser that
 * cannot render the apartment still shows something deliberate rather than a
 * blank rectangle.
 *
 * Invariant: it draws with the 2D context of the SAME canvas the renderer would
 * have used, or of a replacement that keeps the canvas's shell name and class —
 * nothing above it in the shell has to know which of the two it got.
 *
 * The palette and the silhouette are data (`FALLBACK_PALETTE`,
 * `SILHOUETTE`), not literals inside the painting code.
 */

/** Horizon gradient stops, top to bottom, plus the silhouette fill. */
const FALLBACK_PALETTE = {
  skyTop: '#182526',
  horizon: '#65786b',
  ground: '#d4c3a6',
  silhouette: 'rgba(246, 236, 216, .16)',
  /** Where the horizon colour sits along the gradient, `0..1`. */
  horizonStop: 0.54,
} as const;

/** The massing outline, in fractions of the canvas box. */
const SILHOUETTE: ReadonlyArray<readonly [number, number]> = [
  [0.12, 0.74],
  [0.46, 0.42],
  [0.82, 0.62],
  [0.92, 0.9],
  [0.12, 0.9],
];

/** Backing-store floor, so the preview stays sharp on a small viewport. */
const MIN_WIDTH_PX = 900;
const MIN_HEIGHT_PX = 600;
/** The backing store is drawn at twice the CSS box; there is no animation to cost. */
const PIXEL_SCALE = 2;

type FallbackBox = { clientWidth: number; clientHeight: number };

/**
 * Replaces `canvas` with a 2D-capable one when it has already been taken by a
 * WebGL context, and returns whichever canvas the caller should keep.
 *
 * `label` is the accessible name of the replacement (`canvas.fallbackLabel`);
 * `shellName` is the `data-jeex` name the shell knows the canvas by, which the
 * replacement inherits so no lookup breaks.
 */
export function adoptFallbackCanvas(
  canvas: HTMLCanvasElement,
  shellName: string,
  label: string,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D | null } {
  const existing = canvas.getContext('2d');
  if (existing) return { canvas, context: existing };
  const replacement = canvas.ownerDocument.createElement('canvas');
  replacement.dataset['jeex'] = shellName;
  replacement.className = canvas.className;
  replacement.setAttribute('aria-label', label);
  canvas.replaceWith(replacement);
  return { canvas: replacement, context: replacement.getContext('2d') };
}

/** Paints the stand-in; a canvas with no 2D context at all is left as it is. */
export function paintWebglFallback(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, box: FallbackBox): void {
  const width = (canvas.width = Math.max(MIN_WIDTH_PX, box.clientWidth * PIXEL_SCALE));
  const height = (canvas.height = Math.max(MIN_HEIGHT_PX, box.clientHeight * PIXEL_SCALE));
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, FALLBACK_PALETTE.skyTop);
  gradient.addColorStop(FALLBACK_PALETTE.horizonStop, FALLBACK_PALETTE.horizon);
  gradient.addColorStop(1, FALLBACK_PALETTE.ground);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = FALLBACK_PALETTE.silhouette;
  context.beginPath();
  SILHOUETTE.forEach(([u, v], index) => {
    if (index === 0) context.moveTo(width * u, height * v);
    else context.lineTo(width * u, height * v);
  });
  context.closePath();
  context.fill();
}
