import { describe, expect, test } from 'bun:test';
import { OWN_FILE_URL, currentScriptOf, ownFileUrl } from './own-url.js';

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

describe('currentScriptOf', () => {
  /** A stand-in for the DOM's script element class, installed for one test. */
  class FakeScript {
    readonly src: string;
    constructor(src: string) {
      this.src = src;
    }
  }

  function withScriptClass<T>(run: () => T): T {
    const global = globalThis as { HTMLScriptElement?: unknown };
    const had = 'HTMLScriptElement' in global;
    const before = global.HTMLScriptElement;
    global.HTMLScriptElement = FakeScript;
    try {
      return run();
    } finally {
      if (had) global.HTMLScriptElement = before;
      else delete global.HTMLScriptElement;
    }
  }

  test('a real script element is taken', () => {
    const script = new FakeScript('https://cdn.example/jeex/1.0.0/jeex-viewer.iife.js');
    expect(withScriptClass(() => currentScriptOf({ currentScript: script }))).toBe(script);
  });

  test('a clobbered `currentScript` (an element named so by the page) is ignored', () => {
    // `<img name="currentScript" src="…">` makes `document.currentScript` that image.
    const image = { src: 'https://elsewhere.example/' };
    expect(withScriptClass(() => currentScriptOf({ currentScript: image }))).toBeNull();
  });

  test('without a script element class (no DOM) a current script is not trusted', () => {
    expect('HTMLScriptElement' in globalThis).toBe(false);
    expect(currentScriptOf({ currentScript: { src: 'https://cdn.example/jeex-viewer.iife.js' } })).toBeNull();
  });

  test('no document, or no current script, is null', () => {
    expect(withScriptClass(() => currentScriptOf(undefined))).toBeNull();
    expect(withScriptClass(() => currentScriptOf({ currentScript: null }))).toBeNull();
  });
});
