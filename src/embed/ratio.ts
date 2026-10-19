/**
 * The default BOX of a pasted embed: its aspect ratio.
 *
 * A `<jeex-viewer>` pasted into a CMS with no stylesheet of its own, and an
 * `embed.html` framed by a page that gave the iframe no height, both have to
 * come out at a sensible size rather than 0 px (the element) or 150 px (the
 * iframe default). The size they take is the host's width at this ratio.
 *
 * One spelling for both surfaces, so a snippet generator writes the same value
 * into the element's `ratio` attribute and the frame's `?ratio=` parameter.
 * Pure, DOM-free: the element and the frame page apply it, this only reads it.
 */

/** Width over height when nothing else is named: 16:9. */
export const DEFAULT_RATIO = { width: 16, height: 9 } as const;

/** A ratio as two positive finite numbers, width first. */
export type Ratio = { readonly width: number; readonly height: number };

/** `16:9`, `16/9`, `4:3`, `1`, `1.5`: two positive numbers or one. */
const RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*(?:[:/]\s*(\d+(?:\.\d+)?)\s*)?$/;

/**
 * Reads `16:9`, `16/9`, `4:3`, `1` or `1.5` into a ratio, or `null` for
 * anything else (an empty string, a zero, a negative, a unit, a third term).
 * The caller decides what a refusal means — both surfaces fall back to
 * `DEFAULT_RATIO` and say so in their log.
 */
export function parseRatio(raw: string): Ratio | null {
  const match = RATIO_PATTERN.exec(raw);
  if (!match) return null;
  const width = Number(match[1]);
  const height = match[2] === undefined ? 1 : Number(match[2]);
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

/** The CSS `aspect-ratio` value of a ratio: `16 / 9`. */
export function cssAspectRatio(ratio: Ratio): string {
  return `${ratio.width} / ${ratio.height}`;
}
