import { describe, expect, test } from 'bun:test';
import { readOptions, type OptionSpec } from './asset-options.js';

/**
 * The option-bag reader: a manifest is DATA from a publisher, so the questions
 * are all about what happens when it says something the builder did not
 * expect.
 */

const SPEC = {
  doors: { kind: 'number', default: 2, min: 1, integer: true },
  span: { kind: 'number', default: 0.5, min: 0, max: 1 },
  seed: { kind: 'number', default: 7 },
  capping: { kind: 'flag', default: false },
  legs: { kind: 'text', values: ['none', 'tapered'], default: 'none' },
} as const satisfies Record<string, OptionSpec>;

describe('readOptions', () => {
  test('an empty bag is every default', () => {
    expect(readOptions({}, SPEC)).toEqual({ doors: 2, span: 0.5, seed: 7, capping: false, legs: 'none' });
  });

  test('an authored value wins', () => {
    expect(readOptions({ doors: 3, capping: true, legs: 'tapered' }, SPEC)).toEqual({
      doors: 3,
      span: 0.5,
      seed: 7,
      capping: true,
      legs: 'tapered',
    });
  });

  test('a value of the wrong kind is the default, not a NaN or a cast', () => {
    expect(readOptions({ doors: 'three', capping: 1, legs: 42 }, SPEC)).toEqual({
      doors: 2,
      span: 0.5,
      seed: 7,
      capping: false,
      legs: 'none',
    });
  });

  test('a text value outside the closed set is the default', () => {
    // The whole point of declaring the set: guards against `legs: 'taperd'`
    // reaching the geometry as a string nothing compares equal to and quietly
    // taking the other branch.
    expect(readOptions({ legs: 'taperd' }, SPEC).legs).toBe('none');
  });

  test('a number is clamped to its declared range', () => {
    expect(readOptions({ doors: 0 }, SPEC).doors).toBe(1);
    expect(readOptions({ span: -3 }, SPEC).span).toBe(0);
    expect(readOptions({ span: 9 }, SPEC).span).toBe(1);
  });

  test('an integer option is rounded, and rounded before it is clamped', () => {
    expect(readOptions({ doors: 3.4 }, SPEC).doors).toBe(3);
    expect(readOptions({ doors: 0.6 }, SPEC).doors).toBe(1);
    // A measurement is NOT rounded.
    expect(readOptions({ span: 0.37 }, SPEC).span).toBe(0.37);
  });

  test('a non-finite number is the default', () => {
    expect(readOptions({ seed: Number.NaN }, SPEC).seed).toBe(7);
    expect(readOptions({ seed: Number.POSITIVE_INFINITY }, SPEC).seed).toBe(7);
  });

  test('a key the spec does not declare is not in the bag', () => {
    expect(Object.keys(readOptions({ wibble: 3 }, SPEC)).sort()).toEqual(['capping', 'doors', 'legs', 'seed', 'span']);
  });
});
