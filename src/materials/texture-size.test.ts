import { describe, expect, test } from 'bun:test';
import { textureSizeFor } from './texture-size.js';

describe('textureSizeFor: the one size a device draws of a material', () => {
  const ALL = ['128', '256', '384', '512', '768'] as const;

  test('low, mid and high draw 256, 512 and 768', () => {
    expect([textureSizeFor('low', ALL), textureSizeFor('mid', ALL), textureSizeFor('high', ALL)]).toEqual(['256', '512', '768']);
  });

  test('a size the material does not list gives way to the nearest listed one', () => {
    expect(textureSizeFor('high', ['256', '512'])).toBe('512');
    expect(textureSizeFor('low', ['512', '768'])).toBe('512');
    expect(textureSizeFor('low', ['128'])).toBe('128');
  });

  test('a tie goes to the smaller size: a mid device over 384 and 768 loads 384', () => {
    expect(textureSizeFor('mid', ['384', '768'])).toBe('384');
    expect(textureSizeFor('mid', ['256', '768'])).toBe('256');
  });

  test('no context, or nothing listed, loads nothing', () => {
    expect(textureSizeFor('none', ALL)).toBeNull();
    expect(textureSizeFor('high', [])).toBeNull();
  });
});
