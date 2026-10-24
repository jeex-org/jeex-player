/**
 * The walk and tour camera white balance as one linear 3x3 matrix: a partial
 * Bradford (von Kries) chromatic adaptation of linear Rec. 709 colour from a
 * measured source white towards the display white (D65, linear RGB 1, 1, 1),
 * corrected so it keeps the luminance of every input colour.
 *
 * Luminance invariant: with `y` the Rec. 709 luminance row and `u = (1, 1, 1)`
 * (`y·u = 1`), the adapted matrix `M` becomes `M + u (y − yM)`, so `yM' = y`
 * exactly, and the source white still maps where `M` maps it. It holds before
 * clipping only: the output pass clamps negative channels to zero afterwards,
 * which raises the luminance of a very saturated colour it clips.
 *
 * Pure module: no `three`, no DOM.
 */

export type Rgb = readonly [number, number, number];
/** A 3x3 matrix, row-major. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

const LUMINANCE: Rgb = [0.2126, 0.7152, 0.0722];
/** Linear Rec. 709 to CIE XYZ (D65). */
const RGB_TO_XYZ = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041];
/** XYZ to Bradford cone responses. */
const BRADFORD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  for (let r = 0; r < 3; r += 1)
    for (let c = 0; c < 3; c += 1) out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
  return out;
}

function transform(m: readonly number[], v: readonly number[]): number[] {
  return [0, 1, 2].map((r) => m[r * 3]! * v[0]! + m[r * 3 + 1]! * v[1]! + m[r * 3 + 2]! * v[2]!);
}

/** The inverse of a 3x3 matrix (exact, so degree 0 is the identity to rounding). */
function invert(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((v) => v / det);
}

/** CIE XYZ (D65) to linear Rec. 709, and Bradford cone responses to XYZ. */
const XYZ_TO_RGB = invert(RGB_TO_XYZ);
const BRADFORD_INV = invert(BRADFORD);

/**
 * The white balance for `source` (the measured linear colour of the scene's
 * neutral surfaces) at adaptation `degree` (0 none, 1 full).
 */
export function whiteBalanceMatrix(source: Rgb, degree: number): Mat3 {
  const y = LUMINANCE[0] * source[0] + LUMINANCE[1] * source[1] + LUMINANCE[2] * source[2];
  const from = transform(BRADFORD, transform(RGB_TO_XYZ, source));
  const to = transform(BRADFORD, transform(RGB_TO_XYZ, [y, y, y]));
  const gains = [0, 1, 2].map((i) => (degree * to[i]!) / from[i]! + 1 - degree);
  const scale = [gains[0]!, 0, 0, 0, gains[1]!, 0, 0, 0, gains[2]!];
  const m = multiply(XYZ_TO_RGB, multiply(BRADFORD_INV, multiply(scale, multiply(BRADFORD, RGB_TO_XYZ))));
  // Restore the luminance row: the same amount added to every channel of each column.
  const missing = [0, 1, 2].map((c) => LUMINANCE[c]! - (LUMINANCE[0] * m[c]! + LUMINANCE[1] * m[3 + c]! + LUMINANCE[2] * m[6 + c]!));
  return m.map((value, i) => value + missing[i % 3]!) as unknown as Mat3;
}
