/**
 * The palette of a selection option as a text-free image: the picture a host
 * card gets when no catalogue preview or render exists.
 *
 * Pure module: no DOM, no `three`.
 */

/** Colour of the chip when a catalogue entry names no usable colour at all. */
export const FALLBACK_SWATCH_COLOUR = '#b0a294';

/**
 * Only a literal CSS hex colour reaches a generated SVG; anything else is
 * dropped. The lengths are spelled out rather than `{3,8}`: `#12345` and
 * `#1234567` are not colours, and an invalid `fill` falls back to black — a
 * solid black band instead of the palette, which is worse than the default
 * chip. The filter is also what keeps markup out of the SVG, so it only ever
 * gets tighter.
 */
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The palette as a text-free image: vertical bands, one per colour.
 *
 * It exists because `SelectionOption.preview` is a URL, not a CSS value: a host
 * card has nowhere to put `linear-gradient(...)`, and an empty string would
 * make "there is a picture" a lie. Built as SVG rather than on a canvas so it
 * works with no `document` at all — under Bun, and in a viewer whose WebGL
 * context is gone.
 */
export function paletteSwatchDataURL(colours: readonly string[]): string {
  const usable = colours.filter((colour) => HEX_COLOUR.test(colour)).slice(0, 3);
  const palette = usable.length > 0 ? usable : [FALLBACK_SWATCH_COLOUR];
  const band = 12 / palette.length;
  const bands = palette
    .map((colour, index) => `<rect x="${(index * band).toFixed(4)}" y="0" width="${band.toFixed(4)}" height="12" fill="${colour}"/>`)
    .join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12">${bands}</svg>`)}`;
}
