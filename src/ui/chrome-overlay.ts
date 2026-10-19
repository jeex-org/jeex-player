/**
 * Which portal-embed layout the current chrome flags amount to, and the one
 * place that stamps the shell root with it.
 *
 * A separate module from `viewer-shell.ts` on purpose: that file sits at its
 * own 700-line ceiling (`scripts/size-check.ts`), and this concern is small,
 * self-contained and has exactly one caller (`ViewerChrome.setChrome`).
 *
 * `app/viewer-options.ts` (PURE, `purity.test.ts`) cannot be imported here —
 * the module flow runs `app` -> `ui`, never the reverse — so the shape
 * `OVERLAY_PRESETS.unbranded.chrome` resolves to is repeated below as a plain
 * literal, kept in sync by hand and pinned by this file's own test.
 */

/** The LAYOUT half of the `chrome` flags `ViewerChrome.setChrome` is given (`options.chrome`, `app/viewer-options.ts`): what is on screen. `chrome.autoHide` says how the bar BEHAVES and is not one of them — it never decides the overlay layout (`ChromeFlags`, `viewer-chrome.ts`). */
export type ShellChromeFlags = { brand: boolean; controls: boolean; status: boolean; modeSwitcher: boolean; hint: boolean };

/** The exact shape `OVERLAY_PRESETS.unbranded.chrome` resolves to. */
const UNBRANDED_CHROME_SHAPE: ShellChromeFlags = { brand: false, controls: true, status: false, modeSwitcher: false, hint: false };

/**
 * `'unbranded'` only when `chrome` is EXACTLY `UNBRANDED_CHROME_SHAPE`,
 * `'none'` otherwise (default, `kiosk`, `embed`, or a host's own custom
 * mix): the attribute names the effective LAYOUT, not the preset token a
 * caller asked for.
 */
export function chromeOverlayMode(chrome: ShellChromeFlags): 'unbranded' | 'none' {
  const keys = Object.keys(UNBRANDED_CHROME_SHAPE) as (keyof ShellChromeFlags)[];
  return keys.every((key) => chrome[key] === UNBRANDED_CHROME_SHAPE[key]) ? 'unbranded' : 'none';
}

/** Stamps the shell root with `chromeOverlayMode(chrome)`, so `viewer.css` can give `[data-overlay="unbranded"]` its own compact layout. */
export function applyChromeOverlay(root: HTMLElement, chrome: ShellChromeFlags): void {
  root.dataset['overlay'] = chromeOverlayMode(chrome);
}
