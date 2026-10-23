import { describe, expect, test } from 'bun:test';
import { OWN_FILE_URL, ownFileUrl } from './own-url.js';

describe('ownFileUrl', () => {
  test('an ES build answers its module URL', () => {
    expect(ownFileUrl('https://cdn.example/jeex/1.0.0/jeex-viewer-element.js', null)).toBe(
      'https://cdn.example/jeex/1.0.0/jeex-viewer-element.js',
    );
  });

  test('the IIFE has no module URL and answers its own script element', () => {
    expect(ownFileUrl(undefined, { src: 'https://cdn.example/jeex/1.0.0/jeex-viewer.iife.js' })).toBe(
      'https://cdn.example/jeex/1.0.0/jeex-viewer.iife.js',
    );
  });

  test('neither answers an empty string', () => {
    expect(ownFileUrl(undefined, null)).toBe('');
    expect(ownFileUrl('', {})).toBe('');
  });

  test('read once under the test runner: this module file', () => {
    expect(OWN_FILE_URL).toMatch(/\/src\/shared\/own-url\.ts$/);
  });
});
