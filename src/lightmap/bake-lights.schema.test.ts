/**
 * The bake-lights boundary: a well-formed answer passes as it is, and every
 * field the bake tool would misread is refused with a sentence naming it.
 */

import { describe, expect, test } from 'bun:test';
import { judgeBakeLights } from './bake-lights.schema.js';

const LAMP_A = '01a15f1b-dbbd-764a-90b8-84dbe9962bfc';
const LAMP_B = '01a15f1b-dbbd-765c-b4e2-1e8089a6c213';

function valid(): any {
  return {
    recipe: 'jeex-bake-lights@1',
    standardVersion: 1,
    sun: { direction: [0, -1, 0], color: [1, 0.9, 0.8], strength: 3 },
    sky: { recipe: 'jeex-sky-hemisphere@1', upper: [0.28, 0.28, 0.27], lower: [0.03, 0.03, 0.03] },
    lamps: [
      { id: LAMP_A, index: 0, position: [1, 2, 3], intensity: 1.2, power: 4 * Math.PI * 1.2, color: [1, 0.7, 0.4] },
      { id: LAMP_B, index: 0, position: [4, 1, 2], intensity: 3.4, power: 4 * Math.PI * 3.4, color: [1, 0.7, 0.4] },
    ],
  };
}

function refusal(edit: (doc: any) => void): string {
  const doc = valid();
  edit(doc);
  const verdict = judgeBakeLights(doc);
  if (verdict.ok) throw new Error('expected a refusal');
  return verdict.message;
}

describe('judgeBakeLights', () => {
  test('accepts a well-formed answer and hands back the same value', () => {
    const doc = valid();
    const verdict = judgeBakeLights(doc);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.value).toBe(doc);
  });

  test('accepts a scene without lamps', () => {
    const doc = valid();
    doc.lamps = [];
    expect(judgeBakeLights(doc).ok).toBe(true);
  });

  test('refuses an unknown recipe, sky recipe or extra key', () => {
    expect(refusal((d) => (d.recipe = 'jeex-bake-lights@2'))).toContain('recipe');
    expect(refusal((d) => (d.sky.recipe = 'hdri@1'))).toContain('sky');
    expect(refusal((d) => (d.sun.distance = 4))).toContain('sun');
  });

  test('refuses a sun that is not a unit direction or has a negative colour', () => {
    expect(refusal((d) => (d.sun.direction = [0, -2, 0]))).toContain('sun.direction');
    expect(refusal((d) => (d.sun.color = [1, -0.1, 1]))).toContain('sun.color');
    expect(refusal((d) => (d.sun.strength = -1))).toContain('sun.strength');
  });

  test('refuses negative sky radiance', () => {
    expect(refusal((d) => (d.sky.lower = [0, -0.1, 0]))).toContain('sky.lower');
  });

  test('refuses a lamp id that is not a UUID v7, or a placement light listed twice', () => {
    expect(refusal((d) => (d.lamps[0].id = 'lamp-1'))).toContain('lamps.0.id');
    expect(refusal((d) => (d.lamps[1].id = LAMP_A))).toContain('lamps.1');
  });

  test('accepts several lights of one placement by index, and refuses a negative or fractional index', () => {
    const doc = valid();
    doc.lamps[1] = { ...doc.lamps[1], id: LAMP_A, index: 1 };
    expect(judgeBakeLights(doc).ok).toBe(true);
    expect(refusal((d) => (d.lamps[0].index = -1))).toContain('lamps.0.index');
    expect(refusal((d) => (d.lamps[0].index = 0.5))).toContain('lamps.0.index');
  });

  test('refuses a lamp whose power is not 4π times its intensity', () => {
    expect(refusal((d) => (d.lamps[0].power = 1.2))).toContain('lamps.0.power');
  });

  test('refuses a non-finite lamp position', () => {
    expect(refusal((d) => (d.lamps[0].position = [1, Number.NaN, 3]))).toContain('lamps.0.position');
  });
});
