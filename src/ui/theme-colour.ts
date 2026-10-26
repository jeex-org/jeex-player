/**
 * Theme colours read from the host's CSS, for the parts of the viewer CSS
 * cannot paint: the 3D backdrop is drawn by WebGL, so `--jeex-backdrop` has
 * to be resolved here and handed to the runtime (`RenderRuntime.setBackdrop`).
 *
 * A custom property's raw text may be anything a stylesheet allows —
 * `light-dark()`, `var()`, `color-mix()` — and its COMPUTED form is not
 * always `rgb()` either (a mix computes to `color(srgb …)` or `oklch(…)`). So
 * nothing is parsed by hand: the value is checked with `CSS.supports`,
 * resolved as a probe's `style.color` inside the root (where `light-dark()`
 * follows the root's own colour scheme), and painted on a 1×1 canvas, whose
 * pixel is the opaque sRGB colour the browser actually means. Alpha is
 * dropped: a backdrop behind a WebGL scene has nothing to show through it.
 *
 * Without a DOM or a 2D canvas every read answers its fallback.
 */

import { createCanvas2D } from '../materials/canvas-2d.js';

/** The neutral default horizon, mirrored from `--jeex-backdrop` in `viewer.css`. */
export const DEFAULT_BACKDROP = '#303640';

/** The neutral default of the derived `--jeex-minimap-accent`, for the mini-map's canvas. */
export const DEFAULT_MINIMAP_ACCENT = '#5c6675';

/** The backdrop pair the runtime's sky gradient is drawn from. */
export type Backdrop = { readonly top: string; readonly horizon: string };

/** `#rrggbb` of `colour`, mixed with `white` by `share` (0..1). */
function lighten(colour: string, share: number): string {
  const channel = (at: number): string => {
    const value = Number.parseInt(colour.slice(at, at + 2), 16);
    return Math.round(value + (255 - value) * share)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * The opaque `#rrggbb` the custom property `property` resolves to on `root`,
 * or `fallback` when it is unset, is not a colour, or cannot be resolved here.
 */
export function resolveThemeColour(root: HTMLElement, property: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function' || typeof CSS === 'undefined') return fallback;
  const raw = getComputedStyle(root).getPropertyValue(property).trim();
  if (raw === '' || !CSS.supports('color', raw)) return fallback;
  const surface = createCanvas2D(1);
  if (!surface) return fallback;

  const probe = root.ownerDocument.createElement('span');
  probe.hidden = true;
  probe.style.color = raw;
  root.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  // On a cleared canvas `getImageData` answers the colour itself with its
  // alpha beside it (un-premultiplied), so dropping the alpha keeps the hue.
  const { ctx } = surface;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const hex = (channel: number): string => channel.toString(16).padStart(2, '0');
  return `#${hex(r!)}${hex(g!)}${hex(b!)}`;
}

/**
 * The backdrop pair the host asks for: `--jeex-backdrop` is the horizon (and
 * the CSS background before the first frame), `--jeex-backdrop-top` the
 * zenith, a little lighter than the horizon unless the host names it. A value
 * that is not a colour falls back to the NEUTRAL default, never to the
 * runtime's own warm constants.
 */
export function resolveBackdrop(root: HTMLElement): Backdrop {
  const horizon = resolveThemeColour(root, '--jeex-backdrop', DEFAULT_BACKDROP);
  const top = resolveThemeColour(root, '--jeex-backdrop-top', lighten(horizon, 0.08));
  return { top, horizon };
}
