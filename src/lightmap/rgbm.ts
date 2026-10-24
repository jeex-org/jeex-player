/**
 * RGBM, the light bake's encoding: linear light in [0, range] as 8-bit RGBA,
 * where the alpha byte M scales the colour, `value = rgb × M × range` (all
 * bytes over 255). Linear and non-colour: nothing here is sRGB, and the alpha
 * is straight, never premultiplied. The shader decodes the same way
 * (`lightmap-shader.ts`); this module is its reference for tests and tools.
 *
 * Pure module: no `three`, no DOM.
 */

/** Linear RGB of one RGBM texel given as four bytes. */
export function rgbmDecode(bytes: readonly [number, number, number, number], range: number): [number, number, number] {
  const scale = (bytes[3] / 255) * range;
  return [(bytes[0] / 255) * scale, (bytes[1] / 255) * scale, (bytes[2] / 255) * scale];
}
