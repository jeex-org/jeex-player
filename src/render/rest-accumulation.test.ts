import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { accumulatesIn, halton, jitterProjection, restJitter, restNoiseAngle, rotateNoise, restMeanWeight } from './rest-accumulation.js';

describe('the rest frames accumulate in walk and tour only', () => {
  test('walk and tour accumulate; orbit, plan3d, plan2d and an unknown mode do not', () => {
    expect(accumulatesIn('walk')).toBe(true);
    expect(accumulatesIn('tour')).toBe(true);
    for (const mode of ['orbit', 'plan3d', 'plan2d', undefined]) expect(accumulatesIn(mode)).toBe(false);
  });
});

describe('restJitter', () => {
  test('frame 0 is not jittered: the first picture after a change is the one drawn today', () => {
    expect(restJitter(0)).toEqual([0, 0]);
  });

  test('every offset stays inside one pixel, and the first 256 offsets are all different', () => {
    const seen = new Set<string>();
    for (let frame = 1; frame <= 256; frame += 1) {
      const [x, y] = restJitter(frame);
      expect(Math.abs(x)).toBeLessThan(0.5);
      expect(Math.abs(y)).toBeLessThan(0.5);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(256);
  });

  test('is Halton(2, 3) centred on the pixel: low discrepancy, so any prefix covers the pixel evenly', () => {
    expect(halton(1, 2)).toBe(0.5);
    expect(halton(2, 2)).toBe(0.25);
    expect(halton(3, 2)).toBe(0.75);
    expect(halton(1, 3)).toBeCloseTo(1 / 3, 12);
    expect(halton(2, 3)).toBeCloseTo(2 / 3, 12);
    expect(halton(3, 3)).toBeCloseTo(1 / 9, 12);
    expect(restJitter(1)).toEqual([halton(1, 2) - 0.5, halton(1, 3) - 0.5]);
    // Eight frames: the mean offset is near the pixel centre on both axes.
    const offsets = Array.from({ length: 8 }, (_, index) => restJitter(index + 1));
    expect(Math.abs(offsets.reduce((sum, [x]) => sum + x, 0) / 8)).toBeLessThan(0.07);
    expect(Math.abs(offsets.reduce((sum, [, y]) => sum + y, 0) / 8)).toBeLessThan(0.07);
  });
});

describe('jitterProjection', () => {
  /** Where `point` (view space) lands in device pixels through `projection` on a `width` x `height` buffer. */
  function pixel(projection: THREE.Matrix4, point: THREE.Vector3, width: number, height: number): [number, number] {
    const ndc = point.clone().applyMatrix4(projection);
    return [((ndc.x + 1) / 2) * width, ((ndc.y + 1) / 2) * height];
  }

  test('moves every point of a perspective view by the offset in device pixels, at any depth', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
    camera.updateProjectionMatrix();
    const jittered = camera.projectionMatrix.clone();
    jitterProjection(jittered.elements, 0.25, -0.375, 1600, 900);
    for (const point of [new THREE.Vector3(0.3, -0.2, -1), new THREE.Vector3(-2, 1, -7.5)]) {
      const [x0, y0] = pixel(camera.projectionMatrix, point, 1600, 900);
      const [x1, y1] = pixel(jittered, point, 1600, 900);
      expect(x1 - x0).toBeCloseTo(0.25, 6);
      expect(y1 - y0).toBeCloseTo(-0.375, 6);
    }
  });

  test('moves every point of an orthographic view by the offset too', () => {
    const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 50);
    camera.updateProjectionMatrix();
    const jittered = camera.projectionMatrix.clone();
    jitterProjection(jittered.elements, -0.5, 0.125, 800, 600);
    const point = new THREE.Vector3(1, 2, -10);
    const [x0, y0] = pixel(camera.projectionMatrix, point, 800, 600);
    const [x1, y1] = pixel(jittered, point, 800, 600);
    expect(x1 - x0).toBeCloseTo(-0.5, 6);
    expect(y1 - y0).toBeCloseTo(0.125, 6);
  });

  test('a zero offset leaves the projection exactly as it was', () => {
    const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 80);
    const before = [...camera.projectionMatrix.elements];
    jitterProjection(camera.projectionMatrix.elements, 0, 0, 640, 480);
    expect([...camera.projectionMatrix.elements]).toEqual(before);
  });
});

describe('restMeanWeight', () => {
  /** The mean after `samples` as the accumulation mixes them: `mean + (sample - mean) * weight`, per frame. */
  function mean(samples: readonly number[]): number[] {
    const means: number[] = [];
    let value = Number.NaN;
    samples.forEach((sample, frame) => {
      value = frame === 0 ? sample : value + (sample - value) * restMeanWeight(frame);
      means.push(value);
    });
    return means;
  }

  test('frame 0 weighs 1: it starts the mean again', () => {
    expect(restMeanWeight(0)).toBe(1);
  });

  test('a constant input converges to itself, exactly at every step', () => {
    for (const value of mean(Array.from({ length: 32 }, () => 0.4))) expect(value).toBeCloseTo(0.4, 12);
  });

  test('two alternating inputs converge to their average', () => {
    expect(mean(Array.from({ length: 32 }, (_, frame) => (frame % 2 === 0 ? 0.2 : 1.4))).at(-1)).toBeCloseTo(0.8, 12);
  });

  test('is the arithmetic mean of every sample so far', () => {
    const samples = [0.1, 3, 0.5, 2.25, 0, 7];
    mean(samples).forEach((value, frame) => {
      const prefix = samples.slice(0, frame + 1);
      expect(value).toBeCloseTo(prefix.reduce((sum, sample) => sum + sample, 0) / prefix.length, 12);
    });
  });
});

describe('the GTAO noise rotation', () => {
  test('frame 0 keeps three`s noise; later frames turn it by a different angle each', () => {
    expect(restNoiseAngle(0)).toBe(0);
    const angles = new Set<number>();
    for (let frame = 1; frame <= 32; frame += 1) {
      const angle = restNoiseAngle(frame);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(2 * Math.PI);
      angles.add(Math.round(angle * 1e6));
    }
    expect(angles.size).toBe(32);
  });

  test('rotateNoise turns each texel`s direction by the angle and keeps its other channels', () => {
    // Two texels as three encodes them: a unit direction in red and green, 127 in blue, 255 in alpha.
    const encode = (angle: number): number[] => [(Math.cos(angle) * 0.5 + 0.5) * 255, (Math.sin(angle) * 0.5 + 0.5) * 255, 127, 255];
    const base = Uint8Array.from([...encode(0), ...encode(Math.PI / 2)]);
    const out = new Uint8Array(base.length);
    rotateNoise(base, Math.PI / 2, out);
    const decode = (index: number): number => Math.atan2(out[index * 4 + 1]! / 127.5 - 1, out[index * 4]! / 127.5 - 1);
    expect(decode(0)).toBeCloseTo(Math.PI / 2, 1);
    expect(Math.abs(decode(1))).toBeCloseTo(Math.PI, 1);
    expect([out[2], out[3], out[6], out[7]]).toEqual([127, 255, 127, 255]);
    rotateNoise(base, 0, out);
    expect([...out]).toEqual([...base]);
  });
});
