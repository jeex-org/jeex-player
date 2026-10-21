import { describe, expect, test } from 'bun:test';
import { MAX_FRAMES, browserBucket, ownFrames, parseStack } from './stack-frames.js';

const CHROME = `TypeError: Cannot read properties of undefined (reading 'x') at https://site.example/?email=a@b
    at TourPlayer.step (https://cdn.example/jeex/jeex-viewer.iife.js?v=3:12:345)
    at https://cdn.example/jeex/lazy-jeex-viewer-GLTFLoader-ab12CD34.js:1:2
    at Object.onClick (https://site.example/js/site.js:40:7)
    at eval (eval at run (https://cdn.example/jeex/jeex-viewer.iife.js:5:6), <anonymous>:1:1)
    at chrome-extension://abcdef/content.js:3:4`;

const FIREFOX = `step@https://cdn.example/jeex/jeex-viewer.iife.js:12:345
@https://site.example/js/site.js#frag:40:7
`;

const SAFARI = `step@https://cdn.example/jeex/jeex-viewer.iife.js:12:345
global code@https://site.example/:3:9
[native code]`;

describe('parseStack', () => {
  test('reads Chrome frames, with and without a function name', () => {
    expect(parseStack(CHROME).map((frame) => frame.url)).toEqual([
      'https://cdn.example/jeex/jeex-viewer.iife.js',
      'https://cdn.example/jeex/lazy-jeex-viewer-GLTFLoader-ab12CD34.js',
      'https://site.example/js/site.js',
      'chrome-extension://abcdef/content.js',
    ]);
    expect(parseStack(CHROME)[0]).toEqual({ url: 'https://cdn.example/jeex/jeex-viewer.iife.js', line: 12, column: 345 });
  });

  test('reads Firefox and Safari frames, dropping the query and the fragment', () => {
    expect(parseStack(FIREFOX)).toEqual([
      { url: 'https://cdn.example/jeex/jeex-viewer.iife.js', line: 12, column: 345 },
      { url: 'https://site.example/js/site.js', line: 40, column: 7 },
    ]);
    expect(parseStack(SAFARI).map((frame) => frame.line)).toEqual([12, 3]);
  });

  test('the message line never yields a frame, whatever it contains', () => {
    expect(parseStack('Error: failed at https://site.example/x.js:1:2 for someone@example.org')).toEqual([]);
  });

  test('a missing or non-string stack is no frames', () => {
    expect(parseStack(undefined)).toEqual([]);
    expect(parseStack('')).toEqual([]);
  });
});

describe('ownFrames', () => {
  const own = (url: string) => url.startsWith('https://cdn.example/jeex/');

  test('keeps own frames only, as a bare file name, line and column', () => {
    expect(ownFrames(parseStack(CHROME), own)).toEqual([
      { file: 'jeex-viewer.iife.js', line: 12, column: 345 },
      { file: 'lazy-jeex-viewer-GLTFLoader-ab12CD34.js', line: 1, column: 2 },
    ]);
  });

  test('keeps at most the top frames', () => {
    const stack = Array.from({ length: 9 }, (_, index) => `    at f (https://cdn.example/jeex/jeex-viewer.js:${index + 1}:1)`).join('\n');
    const frames = ownFrames(parseStack(`Error\n${stack}`), own);
    expect(frames.length).toBe(MAX_FRAMES);
    expect(frames[0]?.line).toBe(1);
  });

  test('a stack with no own frame yields none', () => {
    expect(ownFrames(parseStack(FIREFOX).slice(1), own)).toEqual([]);
  });
});

describe('browserBucket', () => {
  test('Chromium from client hints, by the Chromium brand', () => {
    const brands = [
      { brand: 'Not.A/Brand', version: '99' },
      { brand: 'Chromium', version: '137' },
      { brand: 'Google Chrome', version: '137' },
    ];
    expect(browserBucket({ brands }, '')).toBe('chromium-13x');
  });

  test('from the user agent string when there are no client hints', () => {
    expect(browserBucket(undefined, 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0')).toBe('firefox-14x');
    expect(
      browserBucket(
        undefined,
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
      ),
    ).toBe('safari-26');
    expect(
      browserBucket(
        undefined,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      ),
    ).toBe('chromium-14x');
  });

  test('anything else is other', () => {
    expect(browserBucket(undefined, 'curl/8.0')).toBe('other');
    expect(browserBucket({ brands: [{ brand: 'Chromium', version: 'x' }] }, '')).toBe('other');
  });
});
