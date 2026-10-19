/**
 * Which parts of the viewer's own chrome are on screen: the embedding's
 * `chrome` options, plus the two VIEW states that override them.
 *
 * - Fullscreen shows the control bar even when the embedding turned it off
 *   (`chrome.controls: false`): the bar is how a visitor leaves fullscreen and
 *   toggles furniture. It overrides the bar itself only, never a part of it
 *   the embedding switched off.
 * - The floating fullscreen button is on whenever `fullscreenButton.show` is
 *   and the viewer is not fullscreen, whatever the bar does.
 * - Read-only hides the brand lockup (the Interior styles button goes
 *   through `setInteriorsAvailable`, which the effective `edits` mode already
 *   decides). Reset camera is a viewing action and stays.
 *
 * Invariant: derived, never written back. The options a host set are the
 * input; a handle read of `chrome.controls` during fullscreen still answers
 * the embedding's value.
 *
 * Pure module: no DOM.
 */

import type { ShellChromeFlags } from './chrome-overlay.js';

export type ChromeLayoutInput = {
  /** The embedding's `options.chrome` layout flags. */
  chrome: ShellChromeFlags;
  /** `options.fullscreenButton.show`. */
  fullscreenButton: boolean;
  /** `options.readonly`. */
  readonly: boolean;
  /** Whether this viewer is fullscreen right now. */
  fullscreen: boolean;
};

/** One flag per node the chrome shows or hides; `true` is on screen. */
export type ChromeLayout = {
  brand: boolean;
  /** The control bar and, with it, its reveal pill. */
  controls: boolean;
  modeSwitcher: boolean;
  hint: boolean;
  floatingFullscreen: boolean;
};

export function chromeLayout(input: ChromeLayoutInput): ChromeLayout {
  const { chrome, readonly, fullscreen } = input;
  return {
    brand: chrome.brand && !readonly,
    controls: chrome.controls || fullscreen,
    modeSwitcher: chrome.modeSwitcher,
    hint: chrome.hint,
    floatingFullscreen: input.fullscreenButton && !fullscreen,
  };
}
