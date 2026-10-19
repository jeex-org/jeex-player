/**
 * `chromeOverlayMode`/`applyChromeOverlay`: the derived
 * `data-overlay` attribute the compact-layout CSS hooks onto.
 */

import { describe, expect, test } from 'bun:test';
import { applyChromeOverlay, chromeOverlayMode, type ShellChromeFlags } from './chrome-overlay.js';

/** `OVERLAY_PRESETS.unbranded.chrome` (`app/viewer-options.ts`), repeated here so a drift between the two literals fails this test loudly. */
const UNBRANDED: ShellChromeFlags = { brand: false, controls: true, status: false, modeSwitcher: false, hint: false };

describe('chromeOverlayMode', () => {
  test('the exact unbranded shape reads as unbranded', () => {
    expect(chromeOverlayMode(UNBRANDED)).toBe('unbranded');
  });

  test('the all-on default reads as none', () => {
    expect(chromeOverlayMode({ brand: true, controls: true, status: true, modeSwitcher: true, hint: true })).toBe('none');
  });

  test('kiosk (controls off too) does not read as unbranded', () => {
    expect(chromeOverlayMode({ brand: false, controls: false, status: false, modeSwitcher: false, hint: false })).toBe('none');
  });

  test('embed (status/modeSwitcher/hint left on) does not read as unbranded', () => {
    expect(chromeOverlayMode({ brand: false, controls: false, status: true, modeSwitcher: true, hint: true })).toBe('none');
  });

  test('one flag off from the unbranded shape is still none', () => {
    for (const key of Object.keys(UNBRANDED) as (keyof ShellChromeFlags)[]) {
      expect(chromeOverlayMode({ ...UNBRANDED, [key]: !UNBRANDED[key] })).toBe('none');
    }
  });
});

describe('applyChromeOverlay', () => {
  test('stamps data-overlay with what chromeOverlayMode answers', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyChromeOverlay(root, UNBRANDED);
    expect(root.dataset['overlay']).toBe('unbranded');
  });

  test('a non-unbranded chrome stamps none', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyChromeOverlay(root, { brand: true, controls: true, status: true, modeSwitcher: true, hint: true });
    expect(root.dataset['overlay']).toBe('none');
  });
});
