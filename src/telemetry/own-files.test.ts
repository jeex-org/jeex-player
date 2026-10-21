import { describe, expect, test } from 'bun:test';
import { isOwnFile, ownFilePredicate } from './own-files.js';

describe('ownFilePredicate', () => {
  const own = ownFilePredicate('https://cdn.example/jeex/1.2.0/jeex-viewer.iife.js?v=1');

  test('published files in the same directory are own', () => {
    expect(own('https://cdn.example/jeex/1.2.0/jeex-viewer.iife.js')).toBe(true);
    expect(own('https://cdn.example/jeex/1.2.0/lazy-jeex-viewer-GLTFLoader-ab12CD34.js')).toBe(true);
    expect(own('https://cdn.example/jeex/1.2.0/jeex-viewer-three.core-Cu1jh-17.js#x')).toBe(true);
  });

  test('another directory, another name or no URL is not', () => {
    expect(own('https://cdn.example/jeex/1.1.0/jeex-viewer.iife.js')).toBe(false);
    expect(own('https://cdn.example/jeex/1.2.0/site.js')).toBe(false);
    expect(own('https://evil.example/jeex/1.2.0/jeex-viewer.js')).toBe(false);
    expect(own('<anonymous>')).toBe(false);
  });

  test('a player bundled into an unpublished file name owns nothing', () => {
    const bundled = ownFilePredicate('https://site.example/assets/app-3f2a1b.js');
    expect(bundled('https://site.example/assets/app-3f2a1b.js')).toBe(false);
    expect(bundled('https://site.example/assets/jeex-viewer.js')).toBe(false);
  });

  test('under the test runner the module file is not a published name, so nothing is own', () => {
    expect(isOwnFile(import.meta.url)).toBe(false);
  });
});
