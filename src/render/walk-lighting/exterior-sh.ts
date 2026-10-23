/**
 * The exterior grid's light as L2 spherical harmonics, computed on the CPU:
 * the lighting standard's hemisphere light and its shadowless fill, which
 * walk and tour switch off as lights (they reach through walls) and give back
 * to everything outside the rooms through a fixed, unbaked grid.
 *
 * Basis and evaluation are three r186's (`lightprobes_pars_fragment`): the
 * coefficients are radiance coefficients in three's basis, and
 * `evaluateSH` is the shader's irradiance polynomial, so what is tested here is
 * what the shader computes.
 *
 * Pure module: no `three`, no DOM.
 */

export type Rgb = readonly [number, number, number];
type Direction = { x: number; y: number; z: number };

/** three's shader constants: band-wise cosine-lobe factors times the basis normalisation. */
const K0 = 0.886227;
const K1 = 2 * 0.511664;
const K2 = 2 * 0.429043;

/** The basis functions in three's order (`LightProbeGridWebGL`'s projection shader). */
function basis(d: Direction): number[] {
  return [
    0.282095,
    0.488603 * d.y,
    0.488603 * d.z,
    0.488603 * d.x,
    1.092548 * d.x * d.y,
    1.092548 * d.y * d.z,
    0.315392 * (3 * d.z * d.z - 1),
    1.092548 * d.x * d.z,
    0.546274 * (d.x * d.x - d.y * d.y),
  ];
}

/** Irradiance at normal `n`, exactly as three's grid shader evaluates `coefficients`. */
export function evaluateSH(coefficients: readonly Rgb[], n: Direction): number[] {
  const { x, y, z } = n;
  const weights = [K0, K1 * y, K1 * z, K1 * x, K2 * x * y, K2 * y * z, 0.743125 * z * z - 0.247708, K2 * x * z, 0.429043 * (x * x - y * y)];
  return [0, 1, 2].map((c) =>
    Math.max(
      0,
      weights.reduce((sum, w, i) => sum + w * coefficients[i]![c]!, 0),
    ),
  );
}

/** Coefficients whose irradiance is three's hemisphere light: `mix(ground, sky, 0.5 n.y + 0.5)`. */
export function hemisphereSH(sky: Rgb, ground: Rgb): Rgb[] {
  const out: Rgb[] = Array.from({ length: 9 }, () => [0, 0, 0] as Rgb);
  out[0] = [0, 1, 2].map((c) => (sky[c]! + ground[c]!) / 2 / K0) as unknown as Rgb;
  out[1] = [0, 1, 2].map((c) => (sky[c]! - ground[c]!) / 2 / K1) as unknown as Rgb;
  return out;
}

/** Coefficients of a directional light of `colour` from `direction`: its clamped cosine projected onto L2. */
export function directionalSH(colour: Rgb, direction: Direction): Rgb[] {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const values = basis({ x: direction.x / length, y: direction.y / length, z: direction.z / length });
  return values.map((value) => colour.map((c) => c * value) as unknown as Rgb);
}

/** The sRGB transfer function undone: a display-encoded channel in linear light. */
export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** `#rrggbb` as linear light, scaled by `intensity`. */
function linearColour(hex: string, intensity: number): Rgb {
  return [1, 3, 5].map((at) => srgbToLinear(parseInt(hex.slice(at, at + 2), 16) / 255) * intensity) as unknown as Rgb;
}

/** What the exterior grid needs of the apartment rig's description. */
export type ExteriorLights = {
  readonly hemisphere: { readonly sky: string; readonly ground: string; readonly intensity: number };
  readonly fill: { readonly colour: string; readonly intensity: number; readonly position: readonly [number, number, number] };
};

/** The hemisphere and the fill of the apartment rig as one set of coefficients. */
export function exteriorSH(lights: ExteriorLights): Rgb[] {
  const { hemisphere, fill } = lights;
  const sky = hemisphereSH(linearColour(hemisphere.sky, hemisphere.intensity), linearColour(hemisphere.ground, hemisphere.intensity));
  const [x, y, z] = fill.position;
  const light = directionalSH(linearColour(fill.colour, fill.intensity), { x, y, z });
  return sky.map((a, i) => [0, 1, 2].map((c) => a[c]! + light[i]![c]!) as unknown as Rgb);
}

/**
 * The coefficients as three's probe-grid atlas for a grid of `size` probes per
 * side: seven RGBA sub-volumes stacked along z, each `size + 2` slices deep
 * (one padding slice at each end), every texel of a sub-volume the same.
 */
export function packAtlas(
  coefficients: readonly Rgb[],
  size: number,
): { data: Float32Array; width: number; height: number; depth: number } {
  const c = coefficients;
  const packs = [
    [c[0]![0], c[0]![1], c[0]![2], c[1]![0]],
    [c[1]![1], c[1]![2], c[2]![0], c[2]![1]],
    [c[2]![2], c[3]![0], c[3]![1], c[3]![2]],
    [c[4]![0], c[4]![1], c[4]![2], c[5]![0]],
    [c[5]![1], c[5]![2], c[6]![0], c[6]![1]],
    [c[6]![2], c[7]![0], c[7]![1], c[7]![2]],
    [c[8]![0], c[8]![1], c[8]![2], 0],
  ];
  const padded = size + 2;
  const depth = 7 * padded;
  const data = new Float32Array(size * size * depth * 4);
  for (let z = 0; z < depth; z += 1) {
    const pack = packs[Math.floor(z / padded)]!;
    for (let i = 0; i < size * size; i += 1) data.set(pack, (z * size * size + i) * 4);
  }
  return { data, width: size, height: size, depth };
}
