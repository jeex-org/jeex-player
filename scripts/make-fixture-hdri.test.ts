import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HDRI_FIXTURE_DIR,
  HDRI_FIXTURE_FILES,
  HDRI_SKY_SIZE_LIMIT,
  HDRI_ENVIRONMENT_SIZE_LIMIT,
  panoramaDirection,
  proceduralRadiance,
  FIXTURE_SUN,
} from './make-fixture-hdri.ts';

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(import.meta.dirname, '..', HDRI_FIXTURE_DIR, name)));
const ascii = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

describe('make-fixture-hdri', () => {
  test('the environment is a small gain-map JPEG: SOI, an hdrgm XMP packet (what three r186 reads) and an MPF segment', () => {
    const bytes = read(HDRI_FIXTURE_FILES.environment);
    expect(bytes.byteLength).toBeLessThanOrEqual(HDRI_ENVIRONMENT_SIZE_LIMIT);
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    const text = ascii(bytes);
    expect(text).toContain('hdrgm:Version');
    expect(text).toContain('MPF\0');
  });

  test('the sky is a small AVIF', () => {
    const bytes = read(HDRI_FIXTURE_FILES.sky);
    expect(bytes.byteLength).toBeLessThanOrEqual(HDRI_SKY_SIZE_LIMIT);
    expect(ascii(bytes.subarray(4, 12))).toBe('ftypavif');
  });

  test('the sidecar carries the sun facts and the reference radiance', () => {
    const sidecar = JSON.parse(new TextDecoder().decode(read(HDRI_FIXTURE_FILES.sidecar))) as {
      sun: { azimuthDeg: number; elevationDeg: number; colourLinear: number[]; horizontalIrradianceShare: number };
      reference: { skyMeanLuminance: number; skyHorizontalIrradiance: number; coneResidual: number };
      width: number;
      height: number;
    };
    expect(sidecar.width).toBe(1024);
    expect(sidecar.height).toBe(512);
    expect(sidecar.sun.azimuthDeg).toBeCloseTo(FIXTURE_SUN.azimuthDeg, 0);
    expect(sidecar.sun.elevationDeg).toBeCloseTo(FIXTURE_SUN.elevationDeg, 0);
    expect(Math.max(...sidecar.sun.colourLinear)).toBe(1);
    expect(sidecar.sun.horizontalIrradianceShare).toBeGreaterThan(0.2);
    expect(sidecar.sun.horizontalIrradianceShare).toBeLessThan(0.9);
    expect(sidecar.reference.skyMeanLuminance).toBeGreaterThan(0);
    expect(sidecar.reference.skyHorizontalIrradiance).toBeGreaterThan(0);
  });

  test('pixel directions follow three’s equirect mapping: row 0 is up, azimuth clockwise from +Z towards +X', () => {
    const up = panoramaDirection(512, 0, 1024, 512);
    expect(up.y).toBeGreaterThan(0.99);
    // u = 0.5 is atan2(z, x) = 0: +X, clockwise azimuth 90.
    const east = panoramaDirection(512, 256, 1024, 512);
    expect(east.x).toBeGreaterThan(0.99);
  });

  test('the red marker stands 90° clockwise of the sun and nowhere on the other side', () => {
    const at = (azimuthCw: number, elevation: number): readonly [number, number, number] => {
      const a = (azimuthCw * Math.PI) / 180;
      const e = (elevation * Math.PI) / 180;
      return proceduralRadiance({ x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: Math.cos(a) * Math.cos(e) });
    };
    const marker = at(FIXTURE_SUN.azimuthDeg + 90, 12);
    const mirror = at(FIXTURE_SUN.azimuthDeg - 90, 12);
    expect(marker[0]).toBeGreaterThan(marker[1] * 5);
    expect(mirror[0]).toBeLessThan(mirror[2] * 2);
  });
});
