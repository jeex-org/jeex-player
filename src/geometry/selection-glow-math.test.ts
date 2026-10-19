import { describe, expect, test } from 'bun:test';
import {
  AURA_MAX_PARTS,
  AURA_MAX_RADIUS,
  AURA_MIN_EXTENT,
  AURA_PADDING,
  AURA_ROUNDNESS,
  BREATH_DEPTH,
  BREATH_SCALE_DEPTH,
  DRIFT_GAIN,
  FADE_SCALE_FROM,
  GLOW_COLORS,
  HAZE_ABSORPTION,
  HAZE_DENSITY,
  HAZE_EDGE_SOFTNESS,
  HAZE_NOISE_SCALE,
  HAZE_NOISE_SPEED,
  HAZE_PEAK_OPACITY,
  HAZE_STEPS,
  MIN_SWEEP_LENGTH,
  auraBoxContains,
  auraBoxVolume,
  auraCornerRadiusFor,
  auraEnvelopeFor,
  breathAt,
  breathScaleAt,
  fadeEase,
  fadeProgress,
  fadeScaleAt,
  gradientStopsAt,
  hazeDensityAt,
  hazeProxySize,
  iridescentAt,
  padAuraBox,
  reduceAuraBoxes,
  sweepLengthFor,
  unionAuraBox,
  type AuraBox,
} from './selection-glow-math.js';

describe('selection glow gradient', () => {
  test('walks blue then cyan then violet and wraps back to blue', () => {
    expect(gradientStopsAt(0)).toEqual({ from: 0, to: 1, mix: 0 });
    expect(gradientStopsAt(1 / 3)).toEqual({ from: 1, to: 2, mix: 0 });
    expect(gradientStopsAt(2 / 3)).toEqual({ from: 2, to: 0, mix: 0 });
  });

  test('is cyclic, so the flowing hue never jumps', () => {
    for (const t of [0.07, 0.31, 0.5, 0.82, 0.99]) {
      const base = gradientStopsAt(t);
      for (const shifted of [gradientStopsAt(t + 1), gradientStopsAt(t - 3)]) {
        expect(shifted.from).toBe(base.from);
        expect(shifted.to).toBe(base.to);
        expect(shifted.mix).toBeCloseTo(base.mix, 12);
      }
    }
  });

  test('blend weight is eased and stays inside 0..1', () => {
    for (let i = 0; i <= 60; i += 1) {
      const { mix } = gradientStopsAt(i / 60);
      expect(mix).toBeGreaterThanOrEqual(0);
      expect(mix).toBeLessThanOrEqual(1);
    }
    // smoothstep, not linear: the midpoint of a segment sits at exactly 0.5 but the
    // quarter point is pulled below it.
    expect(gradientStopsAt(1 / 6).mix).toBeCloseTo(0.5, 6);
    expect(gradientStopsAt(1 / 12).mix).toBeLessThan(0.25);
  });

  test('lands exactly on the palette colours at the stops', () => {
    const asBytes = (t: number): string =>
      iridescentAt(t)
        .map((channel) =>
          Math.round(channel * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    expect(asBytes(0)).toBe(GLOW_COLORS[0].slice(1));
    expect(asBytes(1 / 3)).toBe(GLOW_COLORS[1].slice(1));
    expect(asBytes(2 / 3)).toBe(GLOW_COLORS[2].slice(1));
  });
});

describe('selection glow haze density profile', () => {
  test('is full inside the core envelope and gone a feather beyond it', () => {
    expect(hazeDensityAt(-0.4)).toBe(1);
    expect(hazeDensityAt(0)).toBe(1);
    expect(hazeDensityAt(HAZE_EDGE_SOFTNESS)).toBe(0);
    expect(hazeDensityAt(HAZE_EDGE_SOFTNESS * 4)).toBe(0);
  });

  test('falls off monotonically, so the mist never gains a contour line', () => {
    let previous = 2;
    for (let i = 0; i <= 200; i += 1) {
      const value = hazeDensityAt((i / 200) * HAZE_EDGE_SOFTNESS * 1.5);
      expect(value).toBeLessThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(0);
      previous = value;
    }
  });

  test('feathers over a hand-width, not over a hairline', () => {
    // Halfway out the mist is exactly half-dense, and the ramp is eased at both ends.
    expect(hazeDensityAt(HAZE_EDGE_SOFTNESS / 2)).toBeCloseTo(0.5, 12);
    expect(hazeDensityAt(HAZE_EDGE_SOFTNESS * 0.25)).toBeGreaterThan(0.75);
    expect(hazeDensityAt(HAZE_EDGE_SOFTNESS * 0.75)).toBeLessThan(0.25);
    // Wide enough to read as a gradient at furniture scale: 10 cm or more of fade.
    expect(HAZE_EDGE_SOFTNESS).toBeGreaterThanOrEqual(0.1);
    expect(HAZE_EDGE_SOFTNESS).toBeLessThanOrEqual(0.3);
    // A tight feather would be far denser at the same distance — a hard shell, not a haze.
    expect(hazeDensityAt(0.08, 0.02)).toBe(0);
    expect(hazeDensityAt(0.08, HAZE_EDGE_SOFTNESS)).toBeGreaterThan(0.3);
  });

  test('a zero feather degenerates to a hard edge, which is why it must never be zero', () => {
    expect(hazeDensityAt(-0.01, 0)).toBe(1);
    expect(hazeDensityAt(0.01, 0)).toBe(0);
  });
});

describe('selection glow haze tunables', () => {
  test('the noise eats most of the density, so the mist is never a uniform film', () => {
    expect(HAZE_DENSITY).toBeGreaterThan(0.5);
    expect(HAZE_DENSITY).toBeLessThanOrEqual(1);
    // Thinnest point of the haze, as a fraction of the peak (mirrors the shader's `density` mix).
    expect(1 - HAZE_DENSITY).toBeLessThan(0.5);
  });

  test('peak opacity stays low enough to read as haze rather than a shell', () => {
    expect(HAZE_PEAK_OPACITY).toBeGreaterThan(0);
    expect(HAZE_PEAK_OPACITY).toBeLessThanOrEqual(0.7);
  });

  test('absorption needs a real path length before the mist turns opaque', () => {
    // Beer-Lambert: a 10 cm path may not exceed a third of full opacity, or the halo hugging the
    // object would read as an outline again.
    expect(1 - Math.exp(-0.1 * HAZE_ABSORPTION)).toBeLessThan(0.34);
    // Half a metre of mist, on the other hand, must be clearly visible.
    expect(1 - Math.exp(-0.5 * HAZE_ABSORPTION)).toBeGreaterThan(0.5);
  });

  test('the noise is on a furniture scale and drifts slowly', () => {
    // Roughly one wisp per half metre: fine enough to vary across a console, coarse enough to see.
    expect(HAZE_NOISE_SCALE).toBeGreaterThan(0.8);
    expect(HAZE_NOISE_SCALE).toBeLessThan(4);
    expect(HAZE_NOISE_SPEED).toBeGreaterThan(0);
    expect(HAZE_NOISE_SPEED).toBeLessThan(0.5);
    expect(DRIFT_GAIN).toBeGreaterThan(0);
    expect(DRIFT_GAIN).toBeLessThan(1);
  });

  test('the march has enough steps to stay smooth and few enough to stay cheap', () => {
    expect(HAZE_STEPS).toBeGreaterThanOrEqual(6);
    expect(HAZE_STEPS).toBeLessThanOrEqual(16);
    expect(Number.isInteger(HAZE_STEPS)).toBe(true);
  });

  test('the proxy box covers the whole feathered field on every side', () => {
    const core: [number, number, number] = [1.2, 0.95, 0.4];
    const proxy = hazeProxySize(core, 0.17);
    expect(proxy[0]).toBeCloseTo(1.54, 12);
    expect(proxy[1]).toBeCloseTo(1.29, 12);
    expect(proxy[2]).toBeCloseTo(0.74, 12);
    // Literal indices, so the 3-tuples resolve to `number` rather than
    // `number | undefined`.
    for (const axis of [0, 1, 2] as const) {
      expect(proxy[axis] - core[axis]).toBeCloseTo(2 * 0.17, 12);
    }
  });

  test('a nonsensical feather still yields a usable proxy', () => {
    const proxy = hazeProxySize([0.4, 0.4, 0.4], -5);
    for (const extent of proxy) expect(extent).toBeGreaterThan(0);
  });
});

describe('selection glow breathing', () => {
  test('intensity stays within one dim step of full and never reaches zero', () => {
    for (let i = 0; i <= 400; i += 1) {
      const value = breathAt(i / 40);
      expect(value).toBeGreaterThanOrEqual(1 - BREATH_DEPTH - 1e-9);
      expect(value).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  test('is slow enough to read as breathing rather than flicker', () => {
    // Under two full cycles per second keeps it well clear of flicker territory.
    let crossings = 0;
    let previous = breathAt(0);
    for (let i = 1; i <= 1000; i += 1) {
      const value = breathAt(i / 1000);
      if ((value - 0.94) * (previous - 0.94) < 0) crossings += 1;
      previous = value;
    }
    expect(crossings).toBeLessThanOrEqual(2);
  });

  test('hull swell is centred on 1 and tiny', () => {
    expect(breathScaleAt(0)).toBeCloseTo(1, 12);
    for (let i = 0; i <= 200; i += 1) {
      const value = breathScaleAt(i / 20);
      expect(Math.abs(value - 1)).toBeLessThanOrEqual(BREATH_SCALE_DEPTH + 1e-9);
    }
  });
});

describe('selection glow sizing', () => {
  test('the sweep spans the object but never collapses on small props', () => {
    expect(sweepLengthFor(2.1)).toBeCloseTo(2.35, 6);
    expect(sweepLengthFor(0)).toBe(MIN_SWEEP_LENGTH);
    expect(sweepLengthFor(-5)).toBe(MIN_SWEEP_LENGTH);
  });
});

describe('selection glow fade', () => {
  test('eases from nothing to full and sits exactly halfway at the midpoint', () => {
    expect(fadeEase(0)).toBe(0);
    expect(fadeEase(0.5)).toBeCloseTo(0.5, 12);
    expect(fadeEase(1)).toBe(1);
  });

  test('is eased rather than linear at the quarter points', () => {
    // easeInOutCubic: slow start, slow end.
    expect(fadeEase(0.25)).toBeLessThan(0.25);
    expect(fadeEase(0.75)).toBeGreaterThan(0.75);
  });

  test('is monotonic and clamped outside 0..1', () => {
    expect(fadeEase(-3)).toBe(0);
    expect(fadeEase(7)).toBe(1);
    let previous = -1;
    for (let i = 0; i <= 100; i += 1) {
      const value = fadeEase(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  test('progress is clamped, and a zero-length fade is already over', () => {
    expect(fadeProgress(0, 0.4)).toBe(0);
    expect(fadeProgress(0.2, 0.4)).toBeCloseTo(0.5, 12);
    expect(fadeProgress(9, 0.4)).toBe(1);
    expect(fadeProgress(-2, 0.4)).toBe(0);
    expect(fadeProgress(0, 0)).toBe(1);
  });

  test('the aura swells from a slightly smaller envelope as it lights up', () => {
    expect(fadeScaleAt(0)).toBeCloseTo(FADE_SCALE_FROM, 12);
    expect(fadeScaleAt(1)).toBeCloseTo(1, 12);
    expect(fadeScaleAt(0.5)).toBeCloseTo((FADE_SCALE_FROM + 1) / 2, 12);
    expect(fadeScaleAt(-4)).toBeCloseTo(FADE_SCALE_FROM, 12);
    expect(fadeScaleAt(4)).toBeCloseTo(1, 12);
    expect(FADE_SCALE_FROM).toBeLessThan(1);
    expect(FADE_SCALE_FROM).toBeGreaterThan(0.5);
  });
});

describe('selection glow envelope sizing', () => {
  const slab: AuraBox = { min: [-1, 0, -0.5], max: [1, 0.4, 0.5] };

  test('pads the bounding box on every side', () => {
    const padded = padAuraBox(slab, 0.1);
    expect(padded.min).toEqual([-1.1, -0.1, -0.6]);
    expect(padded.max).toEqual([1.1, 0.5, 0.6]);
  });

  test('sizes the envelope to the padded box and centres it on the box', () => {
    const { centre, size } = auraEnvelopeFor(slab, 0.12, 0);
    expect(size[0]).toBeCloseTo(2.24, 12);
    expect(size[1]).toBeCloseTo(0.64, 12);
    expect(size[2]).toBeCloseTo(1.24, 12);
    expect(centre[0]).toBeCloseTo(0, 12);
    expect(centre[1]).toBeCloseTo(0.2, 12);
    expect(centre[2]).toBeCloseTo(0, 12);
  });

  test('the aura reaches a hand-width past the object without swallowing it', () => {
    // Roughly 8-10 cm of haze: enough to read, tight enough not to swallow the object.
    expect(AURA_PADDING).toBeGreaterThanOrEqual(0.08);
    expect(AURA_PADDING).toBeLessThanOrEqual(0.1);
    const { size } = auraEnvelopeFor(slab);
    expect(size[1] - 0.4).toBeCloseTo(2 * AURA_PADDING, 12);
  });

  test('a flat part still gets a cloud rather than a sheet', () => {
    const rug: AuraBox = { min: [-1.2, 0, -0.9], max: [1.2, 0.004, 0.9] };
    const { size } = auraEnvelopeFor(rug, 0, 0.18);
    expect(size[1]).toBeCloseTo(0.18, 12);
    expect(AURA_MIN_EXTENT).toBeGreaterThan(0);
  });

  test('a floor-standing part keeps its halo above the floor', () => {
    const base: AuraBox = { min: [-0.9, 0, -1.1], max: [0.9, 0.3, 1.1] };
    const { centre, size } = auraEnvelopeFor(base, 0.13, 0, 0);
    expect(size[1]).toBeCloseTo(0.43, 12);
    expect(centre[1] - size[1] / 2).toBeCloseTo(0, 12);
    // Sideways padding is untouched by the ground clamp.
    expect(size[0]).toBeCloseTo(2.06, 12);
  });

  test('a hanging part is padded downwards like everything else', () => {
    const pendant: AuraBox = { min: [-0.2, 1.9, -0.2], max: [0.2, 2.4, 0.2] };
    const { centre, size } = auraEnvelopeFor(pendant, 0.13, 0);
    expect(size[1]).toBeCloseTo(0.76, 12);
    expect(centre[1] - size[1] / 2).toBeCloseTo(1.77, 12);
  });

  test('the corner radius is a fraction of the smallest extent, in metres', () => {
    // A console-sized envelope: 16 % of the 0.4 m depth is a 6.4 cm fillet.
    expect(auraCornerRadiusFor([1.2, 0.95, 0.4], 0.16, 0.07)).toBeCloseTo(0.064, 12);
    // A thin slab rounds by a fraction of its thinnest side, so it never becomes a pill.
    expect(auraCornerRadiusFor([2.4, 0.2, 1.8], 0.16, 0.07)).toBeCloseTo(0.032, 12);
  });

  test('the radius is capped in absolute terms so a big object keeps its silhouette', () => {
    // A bed envelope: 16 % of 2 m would be 32 cm of pill; the cap holds it at 7 cm.
    expect(auraCornerRadiusFor([2.1, 0.8, 2.4], 0.16, 0.07)).toBeCloseTo(0.07, 12);
    expect(auraCornerRadiusFor([9, 9, 9], 0.5, 0.07)).toBeCloseTo(0.07, 12);
    expect(AURA_MAX_RADIUS).toBeGreaterThanOrEqual(0.06);
    expect(AURA_MAX_RADIUS).toBeLessThanOrEqual(0.08);
  });

  test('the radius never reaches half the smallest extent, where the geometry degenerates', () => {
    for (const extent of [0.02, 0.05, 0.18, 0.4, 1, 3]) {
      const radius = auraCornerRadiusFor([extent, extent * 2, extent * 5], 0.5, 99);
      expect(radius).toBeLessThan(extent / 2);
      expect(radius).toBeGreaterThan(0);
    }
    expect(auraCornerRadiusFor([0, 1, 1])).toBe(0);
    expect(auraCornerRadiusFor([1, 1, 1], -3)).toBe(0);
    expect(auraCornerRadiusFor([1, 1, 1], 0.2, -3)).toBe(0);
  });

  test('the default roundness is only a hint of a fillet, not a capsule', () => {
    expect(AURA_ROUNDNESS).toBeGreaterThanOrEqual(0.12);
    expect(AURA_ROUNDNESS).toBeLessThanOrEqual(0.2);
    // On every real furniture envelope the fillet stays a small fraction of the thinnest side, so
    // the silhouette still follows the object's overall shape.
    const envelopes: AuraBox['min'][] = [
      [1.2, 0.95, 0.4],
      [2.1, 0.8, 2.4],
      [2.9, 0.9, 1.1],
      [0.55, 0.6, 0.5],
    ];
    for (const size of envelopes) {
      const radius = auraCornerRadiusFor(size);
      expect(radius).toBeLessThanOrEqual(AURA_MAX_RADIUS);
      expect(radius).toBeLessThan(Math.min(size[0], size[1], size[2]) / 5);
    }
  });
});

describe('selection glow envelope merging', () => {
  const outer: AuraBox = { min: [0, 0, 0], max: [2, 1, 1] };
  const inner: AuraBox = { min: [0.2, 0.2, 0.2], max: [0.6, 0.6, 0.6] };
  const far: AuraBox = { min: [5, 0, 0], max: [6, 1, 1] };

  test('containment and volume behave', () => {
    expect(auraBoxContains(outer, inner)).toBe(true);
    expect(auraBoxContains(inner, outer)).toBe(false);
    expect(auraBoxContains(outer, far)).toBe(false);
    expect(auraBoxVolume(outer)).toBeCloseTo(2, 12);
    expect(auraBoxVolume({ min: [1, 1, 1], max: [0, 0, 0] })).toBe(0);
  });

  test('the union spans both boxes', () => {
    const merged = unionAuraBox(outer, far);
    expect(merged.min).toEqual([0, 0, 0]);
    expect(merged.max).toEqual([6, 1, 1]);
  });

  test('drops parts that already sit inside another part', () => {
    const reduced = reduceAuraBoxes([inner, outer, far], 8);
    expect(reduced).toHaveLength(2);
    expect(reduced).toContainEqual(outer);
    expect(reduced).toContainEqual(far);
  });

  test('keeps one survivor for duplicated parts', () => {
    const reduced = reduceAuraBoxes([outer, { ...outer }, { ...outer }], 8);
    expect(reduced).toHaveLength(1);
  });

  test('merges the cheapest pair first until the part budget is met', () => {
    const a: AuraBox = { min: [0, 0, 0], max: [1, 1, 1] };
    const b: AuraBox = { min: [1, 0, 0], max: [2, 1, 1] };
    const distant: AuraBox = { min: [40, 0, 0], max: [41, 1, 1] };
    const reduced = reduceAuraBoxes([a, b, distant], 2);
    expect(reduced).toHaveLength(2);
    // a and b touch, so merging them wastes nothing; the distant box is left alone.
    expect(reduced).toContainEqual(distant);
    expect(reduced).toContainEqual({ min: [0, 0, 0], max: [2, 1, 1] });
  });

  test('never returns more than the budget, and never returns nothing for a real object', () => {
    const boxes: AuraBox[] = [];
    for (let i = 0; i < 15; i += 1) {
      boxes.push({ min: [i * 0.3, 0, 0], max: [i * 0.3 + 0.25, 0.4 + i * 0.01, 0.5] });
    }
    const reduced = reduceAuraBoxes(boxes);
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced.length).toBeLessThanOrEqual(AURA_MAX_PARTS);
    // The merged cloud still covers every original part.
    for (const box of boxes) {
      expect(reduced.some((candidate) => auraBoxContains(candidate, box))).toBe(true);
    }
  });

  test('a budget below one is treated as one', () => {
    expect(reduceAuraBoxes([outer, far], 0)).toHaveLength(1);
  });
});
