import { describe, expect, test } from 'bun:test';
import {
  hdriRotationY,
  hdriSunDirection,
  hdriSunIntensity,
  hdriSunNormalIrradiance,
  measureSkyIrradiance,
  panoramaSunDirection,
  storedAzimuthFromEquirect,
} from './hdri-calibration.js';
import { sunDirection } from './sun-direction.js';

const DEG = Math.PI / 180;

/** A `width` × `height` RGBA float panorama of one radiance everywhere above the horizon and black below. */
function uniformSky(width: number, height: number, radiance: number): Float32Array {
  const data = new Float32Array(width * height * 4);
  for (let j = 0; j < height / 2; j += 1) {
    for (let i = 0; i < width; i += 1) data.fill(radiance, (j * width + i) * 4, (j * width + i) * 4 + 3);
  }
  return data;
}

describe('rotation and angles', () => {
  test('rotationY is north plus preset azimuth minus the stored azimuth, in radians', () => {
    expect(hdriRotationY(30, 180, 54)).toBeCloseTo(156 * DEG, 12);
    expect(hdriRotationY(0, 90, 90)).toBeCloseTo(0, 12);
  });

  test('a three.js equirect azimuth a is stored as 90 - a, in [0, 360)', () => {
    expect(storedAzimuthFromEquirect(36)).toBe(54);
    expect(storedAzimuthFromEquirect(135)).toBe(315);
  });

  test('the sun keeps the preset world azimuth and takes the stored elevation', () => {
    const direction = hdriSunDirection(30, 180, 43);
    const preset = sunDirection({ northDeg: 30, sun: 'noon' });
    expect(Math.atan2(direction[0], direction[2]) / DEG).toBeCloseTo(Math.atan2(preset.direction[0], preset.direction[2]) / DEG, 9);
    expect(Math.asin(direction[1]) / DEG).toBeCloseTo(43, 9);
  });

  test('the stored sun in the panorama frame is a unit vector at its azimuth and elevation', () => {
    const [x, y, z] = panoramaSunDirection(54, 40);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    expect(Math.atan2(x, z) / DEG).toBeCloseTo(54, 9);
    expect(Math.asin(y) / DEG).toBeCloseTo(40, 9);
  });
});

describe('measureSkyIrradiance', () => {
  test('a uniform sky of radiance L gives a horizontal irradiance of pi L, split between the cone and the rest', () => {
    const data = uniformSky(512, 256, 1);
    const { horizontal, residual } = measureSkyIrradiance({ data, width: 512, height: 256, sun: panoramaSunDirection(54, 30), coneDeg: 6 });
    expect(Math.abs(horizontal + residual - Math.PI) / Math.PI).toBeLessThan(0.01);
    // The cone: its solid angle times the cosine to its centre.
    const cone = 2 * Math.PI * (1 - Math.cos(6 * DEG)) * Math.sin(30 * DEG);
    expect(Math.abs(residual - cone) / cone).toBeLessThan(0.05);
  });

  test('reads half floats as three stores them', () => {
    const floats = uniformSky(256, 128, 2);
    const halves = new Uint16Array(floats.length);
    const view = new Float16Array(floats);
    halves.set(new Uint16Array(view.buffer));
    const half = measureSkyIrradiance({ data: halves, width: 256, height: 128, sun: panoramaSunDirection(0, 45), coneDeg: 6 });
    const full = measureSkyIrradiance({ data: floats, width: 256, height: 128, sun: panoramaSunDirection(0, 45), coneDeg: 6 });
    expect(half.horizontal).toBeCloseTo(full.horizontal, 6);
  });

  test('weights the channels by Rec. 709 luminance', () => {
    const data = uniformSky(256, 128, 0);
    for (let k = 0; k < data.length / 2; k += 4) data[k] = 1;
    const { horizontal, residual } = measureSkyIrradiance({ data, width: 256, height: 128, sun: panoramaSunDirection(0, 45), coneDeg: 6 });
    expect(Math.abs(horizontal + residual - 0.2126 * Math.PI) / (0.2126 * Math.PI)).toBeLessThan(0.01);
  });
});

describe('the sun from the sky', () => {
  test('share 0.5 at 30 degrees: normal irradiance is (A - R) / sin 30', () => {
    expect(hdriSunNormalIrradiance({ horizontal: 3, residual: 0.5 }, 0.5, 30)).toBeCloseTo(5, 9);
  });

  test('from share 0.5 to 0.75 the sun is three times stronger when nothing is left in the cone', () => {
    const a = hdriSunNormalIrradiance({ horizontal: 2, residual: 0 }, 0.5, 40);
    const b = hdriSunNormalIrradiance({ horizontal: 2, residual: 0 }, 0.75, 40);
    expect(b / a).toBeCloseTo(3, 9);
  });

  test('a residual is subtracted: max(0, A s / (1 - s) - R) / sin E', () => {
    expect(hdriSunNormalIrradiance({ horizontal: 2, residual: 0.4 }, 0.75, 30)).toBeCloseTo((6 - 0.4) / 0.5, 9);
    expect(hdriSunNormalIrradiance({ horizontal: 1, residual: 5 }, 0.5, 30)).toBe(0);
  });

  test('a share of 1 or more is refused', () => {
    expect(() => hdriSunNormalIrradiance({ horizontal: 1, residual: 0 }, 1, 30)).toThrow();
  });

  test('intensity is the irradiance times the gain over the colour luminance', () => {
    const colour = [1, 0.5, 0.25] as const;
    const luminance = 0.2126 + 0.7152 * 0.5 + 0.0722 * 0.25;
    expect(hdriSunIntensity(2, 1.5, colour)).toBeCloseTo((2 * 1.5) / luminance, 9);
  });
});

describe('rotation against three.js', () => {
  test('rotating the fixture sun by rotationY about +Y lands it on the preset world azimuth at every north', async () => {
    const THREE = await import('three');
    for (const northDeg of [0, 30, -75, 200]) {
      const stored = panoramaSunDirection(54, 40);
      const turned = new THREE.Vector3(...stored).applyEuler(new THREE.Euler(0, hdriRotationY(northDeg, 180, 54), 0));
      const preset = sunDirection({ northDeg, sun: 'noon' });
      const azimuth = (Math.atan2(turned.x, turned.z) / DEG + 360) % 360;
      expect(azimuth).toBeCloseTo(preset.azimuth, 9);
      expect(Math.asin(turned.y) / DEG).toBeCloseTo(40, 9);
    }
  });
});
