import { describe, expect, test } from 'bun:test';
import type { z } from 'zod/mini';
import { hdriEntrySchema, judgeHdriOption } from './hdri-option.schema.js';
import type { HdriEntry } from '../lighting/hdri-entry.js';

const entry = (patch: Record<string, unknown> = {}, sun: Record<string, unknown> = {}): Record<string, unknown> => ({
  environmentUrl: 'https://cdn.example.test/sky/noon.jpg',
  skyUrl: 'https://cdn.example.test/sky/noon.avif',
  sun: { azimuthDeg: 54, elevationDeg: 43, colourLinear: [1, 0.94, 0.87], horizontalIrradianceShare: 0.78, ...sun },
  ...patch,
});

describe('judgeHdriOption', () => {
  test('keeps a valid entry as given and refuses nothing', () => {
    const verdict = judgeHdriOption({ noon: entry() });
    expect(verdict.refused).toEqual([]);
    expect(verdict.value).toEqual({ noon: entry() as HdriEntry });
  });

  test('undefined is no option at all', () => {
    expect(judgeHdriOption(undefined)).toEqual({ value: {}, refused: [] });
  });

  test('a value that is not an object is refused whole', () => {
    for (const value of [null, 'noon', 3, []]) {
      const verdict = judgeHdriOption(value);
      expect(verdict.value).toEqual({});
      expect(verdict.refused.map((item) => item.path)).toEqual(['lighting.hdri']);
    }
  });

  test('http, https and blob URLs pass; relative, ftp and data URLs do not', () => {
    for (const url of ['http://localhost:3700/a.jpg', 'https://a.test/b.jpg', 'blob:https://a.test/0f6d2c1e']) {
      expect(judgeHdriOption({ noon: entry({ environmentUrl: url, skyUrl: url }) }).refused).toEqual([]);
    }
    for (const url of [
      'sky.avif',
      '/sky.avif',
      'ftp://a.test/b.jpg',
      'data:image/avif;base64,AAAA',
      '',
      'HTTPS://a.test/b.jpg',
      ' https://a.test/b.jpg',
    ]) {
      const verdict = judgeHdriOption({ morning: entry({ skyUrl: url }), noon: entry() });
      expect(verdict.refused.map((item) => item.path)).toEqual(['lighting.hdri.morning']);
      expect(Object.keys(verdict.value)).toEqual(['noon']);
    }
  });

  test('elevation must be above 0 and at most 90; angles finite', () => {
    for (const elevationDeg of [0, -5, 90.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(judgeHdriOption({ noon: entry({}, { elevationDeg }) }).refused).toHaveLength(1);
    }
    expect(judgeHdriOption({ noon: entry({}, { elevationDeg: 90 }) }).refused).toEqual([]);
    expect(judgeHdriOption({ noon: entry({}, { azimuthDeg: Number.NaN }) }).refused).toHaveLength(1);
    expect(judgeHdriOption({ noon: entry({}, { azimuthDeg: -400 }) }).refused).toEqual([]);
  });

  test('the colour is three non-negative linear values whose largest is exactly 1', () => {
    for (const colourLinear of [
      [2, 1, 0.5],
      [0.5, 0.5, 0.5],
      [1, -0.1, 0.5],
      [1, 0.5],
      [1, 0.5, 0.5, 1],
    ]) {
      expect(judgeHdriOption({ noon: entry({}, { colourLinear }) }).refused).toHaveLength(1);
    }
    expect(judgeHdriOption({ noon: entry({}, { colourLinear: [0.2, 1, 0] }) }).refused).toEqual([]);
  });

  test('the share is in [0, 1)', () => {
    expect(judgeHdriOption({ noon: entry({}, { horizontalIrradianceShare: 0 }) }).refused).toEqual([]);
    for (const horizontalIrradianceShare of [1, -0.01, 1.2]) {
      expect(judgeHdriOption({ noon: entry({}, { horizontalIrradianceShare }) }).refused).toHaveLength(1);
    }
  });

  test('unknown keys are refused, on the entry and on the sun', () => {
    expect(judgeHdriOption({ noon: entry({ licence: 'CC0' }) }).refused).toHaveLength(1);
    expect(judgeHdriOption({ noon: entry({}, { intensity: 3 }) }).refused).toHaveLength(1);
  });

  test('a key that is not a sun preset is dropped alone', () => {
    const verdict = judgeHdriOption({ night: entry(), evening: entry() });
    expect(verdict.refused.map((item) => item.path)).toEqual(['lighting.hdri.night']);
    expect(Object.keys(verdict.value)).toEqual(['evening']);
  });

  test('an inherited or __proto__ key is never read as a preset', () => {
    const input = JSON.parse('{"__proto__": {"noon": 1}}') as unknown;
    const verdict = judgeHdriOption(input);
    expect(verdict.value).toEqual({});
  });

  test('a kept entry is a frozen copy', () => {
    const given = entry();
    const verdict = judgeHdriOption({ noon: given });
    const kept = verdict.value.noon!;
    expect(kept).not.toBe(given);
    expect(Object.isFrozen(kept)).toBe(true);
    expect(Object.isFrozen(kept.sun)).toBe(true);
    expect(Object.isFrozen(kept.sun.colourLinear)).toBe(true);
  });

  test('the schema and the published type agree', () => {
    type Parsed = z.infer<typeof hdriEntrySchema>;
    type BothWays = [Parsed] extends [HdriEntry] ? ([HdriEntry] extends [Parsed] ? true : false) : false;
    const agree: BothWays = true;
    expect(agree).toBe(true);
  });
});
