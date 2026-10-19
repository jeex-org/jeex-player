import { describe, expect, test } from 'bun:test';
import { DEFAULT_RATIO, cssAspectRatio, parseRatio } from './ratio.js';

describe('parseRatio', () => {
  test.each([
    ['16:9', { width: 16, height: 9 }],
    ['16/9', { width: 16, height: 9 }],
    [' 4 : 3 ', { width: 4, height: 3 }],
    ['1', { width: 1, height: 1 }],
    ['1.5', { width: 1.5, height: 1 }],
    ['2.39:1', { width: 2.39, height: 1 }],
  ])('reads %p', (raw, expected) => {
    expect(parseRatio(raw)).toEqual(expected);
  });

  test.each(['', 'wide', '0', '16:0', '-4:3', '4:3:2', '16px', '1e3', ':9', '16:'])('refuses %p', (raw) => {
    expect(parseRatio(raw)).toBeNull();
  });
});

test('cssAspectRatio spells the ratio the way aspect-ratio reads it', () => {
  expect(cssAspectRatio(DEFAULT_RATIO)).toBe('16 / 9');
  expect(cssAspectRatio({ width: 1.5, height: 1 })).toBe('1.5 / 1');
});
