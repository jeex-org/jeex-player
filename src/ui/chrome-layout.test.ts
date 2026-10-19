/**
 * What of the chrome is on screen, as a pure function of the embedding's
 * options and the two view states that override them.
 */

import { describe, expect, test } from 'bun:test';
import { chromeLayout, type ChromeLayoutInput } from './chrome-layout.js';

const ALL_ON = { brand: true, controls: true, status: true, modeSwitcher: true, hint: true };

function input(overrides: Partial<ChromeLayoutInput> = {}): ChromeLayoutInput {
  return { chrome: ALL_ON, fullscreenButton: false, readonly: false, fullscreen: false, ...overrides };
}

describe('chromeLayout', () => {
  test('the default mount shows the whole bar and no floating button', () => {
    expect(chromeLayout(input())).toEqual({
      brand: true,
      controls: true,
      modeSwitcher: true,
      hint: true,
      floatingFullscreen: false,
    });
  });

  test('the floating button shows outside fullscreen and hides inside it', () => {
    expect(chromeLayout(input({ fullscreenButton: true })).floatingFullscreen).toBe(true);
    expect(chromeLayout(input({ fullscreenButton: true, fullscreen: true })).floatingFullscreen).toBe(false);
  });

  test('the floating button ignores chrome.controls: it is on its own', () => {
    expect(chromeLayout(input({ chrome: { ...ALL_ON, controls: false }, fullscreenButton: true })).floatingFullscreen).toBe(true);
  });

  test('fullscreen brings the bar back when the embedding turned it off, and exit restores it', () => {
    const chrome = { ...ALL_ON, controls: false };
    expect(chromeLayout(input({ chrome })).controls).toBe(false);
    expect(chromeLayout(input({ chrome, fullscreen: true })).controls).toBe(true);
    expect(chromeLayout(input({ chrome, fullscreen: false })).controls).toBe(false);
  });

  test('fullscreen overrides only the bar itself, never the parts the embedding switched off', () => {
    const chrome = { ...ALL_ON, controls: false, modeSwitcher: false, hint: false };
    const layout = chromeLayout(input({ chrome, fullscreen: true }));
    expect(layout).toMatchObject({ controls: true, modeSwitcher: false, hint: false });
  });

  test('read-only hides the brand, and keeps Reset camera, the mode switcher and the bar', () => {
    expect(chromeLayout(input({ readonly: true }))).toEqual({
      brand: false,
      controls: true,
      modeSwitcher: true,
      hint: true,
      floatingFullscreen: false,
    });
  });

  test('read-only applies inside fullscreen too', () => {
    const layout = chromeLayout(
      input({ chrome: { ...ALL_ON, controls: false }, readonly: true, fullscreen: true, fullscreenButton: true }),
    );
    expect(layout).toEqual({ brand: false, controls: true, modeSwitcher: true, hint: true, floatingFullscreen: false });
  });

  test('chrome.brand off hides the brand without read-only', () => {
    expect(chromeLayout(input({ chrome: { ...ALL_ON, brand: false } })).brand).toBe(false);
  });
});
