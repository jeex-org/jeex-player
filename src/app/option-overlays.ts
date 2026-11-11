/**
 * The compound attributes `chrome`, `overlay` and `unbranded`: sugar over
 * other options, none of them a `ViewerOptions` field. `overlay` merges one
 * preset row onto the parsed record, `unbranded` aliases `overlay=unbranded`,
 * and `chrome="false"` zeroes the chrome's visibility rows, in that order,
 * before `optionsFromRecord`'s per-field loop (`viewer-options.ts`), so an
 * individual attribute given beside them still wins.
 *
 * Invariant: this module is syntactic like `optionsFromRecord`: it moves raw
 * values into place and reports an invalid compound value through the logger
 * it is given; the one validator stays `resolveViewerOptions`.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Logger } from '../shared/logger.js';
import { warnInvalid } from './option-resolvers.js';
import type { OptionSpec } from './viewer-options.schema.js';
import { split, toDatasetKey } from './option-paths.js';
import { asFlag } from './option-raw.js';

/** `overlay="kiosk"`/`"embed"`/`"unbranded"`: sugar over other options, not itself a `ViewerOptions` field. */
export type Overlay = (typeof OVERLAY_MODES)[number];
const OVERLAY_MODES = ['none', 'kiosk', 'embed', 'unbranded'] as const;

/** The compound `chrome`/`overlay`/`unbranded` attributes; none is a `ViewerOptions` field, so all three live here, not as an `OPTION_SCHEMA` row. `unbranded` aliases `overlay=unbranded` (MLS-feed spelling, README); an explicit `overlay=` always wins — `applyOverlayPreset`. */
export const COMPOUND_SCHEMA = {
  chrome: { kind: 'flag', default: true, query: 'chrome', attr: 'chrome' },
  overlay: { kind: 'enum', values: OVERLAY_MODES, default: 'none', query: 'overlay', attr: 'overlay' },
  unbranded: { kind: 'flag', default: false, query: 'unbranded', attr: 'unbranded' },
} as const satisfies Record<'chrome' | 'overlay' | 'unbranded', OptionSpec>;

/** One preset per `Overlay`, merged onto the result before the compound `chrome` and the individual attributes (order: overlay -> chrome -> individual). `kiosk` also zeroes `chrome.hint`. `unbranded` is the strictest portal rule set (Idealista): brand/status/switcher/hint off, controls and minimap kept, tour paused at its start rather than playing before input, full pointer interaction. */
export const OVERLAY_PRESETS = {
  none: {},
  kiosk: {
    chrome: { controls: false, brand: false, status: false, modeSwitcher: false, hint: false },
    interaction: 'none',
  },
  embed: {
    chrome: { controls: false, brand: false },
    tour: { progressBar: true, pauseOnInput: false },
  },
  unbranded: {
    chrome: { brand: false, status: false, modeSwitcher: false, hint: false, controls: true },
    tour: { mode: 'paused', progressBar: true, pauseOnInput: true },
    view: { minimap: true },
    interaction: 'full',
  },
} as const;

/**
 * `chrome="false"`/`chrome=0` zeroes every path in `flagPaths` (the chrome's
 * visibility rows, `CHROME_FLAG_PATHS` in `viewer-options.ts`) before
 * the per-field loop runs, so `chrome-status="true"` alongside it still
 * wins. Reported through the LOGGER GIVEN — not the module `sink` — because
 * parsing runs before a host's `onLog` is known to `resolveViewerOptions`.
 */
function applyChromeCompound(
  result: Record<string, unknown>,
  read: (key: string) => string | undefined,
  keyOf: 'query' | 'attr',
  log: Logger,
  flagPaths: readonly string[],
): void {
  const spec = COMPOUND_SCHEMA.chrome;
  const raw = read(keyOf === 'query' ? spec.query : toDatasetKey(spec.attr));
  if (raw === undefined) return;
  const value = asFlag(raw);
  if (typeof value !== 'boolean') {
    warnInvalid(log, 'chrome', raw, spec.default);
    return;
  }
  if (value) return; // `chrome="true"` (or `1`) is a no-op.
  const chrome = (result['chrome'] ??= {}) as Record<string, unknown>;
  for (const path of flagPaths) chrome[split(path).field] = false;
}

/** Merges one section-shaped partial — a row of `OVERLAY_PRESETS` — onto `result`, one level deep. */
function mergeSections(result: Record<string, unknown>, partial: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(partial)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign((result[key] ??= {}) as Record<string, unknown>, value);
    } else {
      result[key] = value;
    }
  }
}

/** `overlay="kiosk"`/`"embed"`/`"unbranded"` merges its `OVERLAY_PRESETS` row before `chrome` and the per-field loop. An explicit `overlay=` is decided on its own, valid or not, without ever looking at `unbranded` — so it wins in either order (`?unbranded=1&overlay=kiosk` and the reverse both resolve to plain `kiosk`). With no `overlay=` given, only `unbranded=true` does anything; `unbranded=0` is a no-op, not a request for `'none'`. */
function applyOverlayPreset(
  result: Record<string, unknown>,
  read: (key: string) => string | undefined,
  keyOf: 'query' | 'attr',
  log: Logger,
): void {
  const overlaySpec = COMPOUND_SCHEMA.overlay;
  const rawOverlay = read(keyOf === 'query' ? overlaySpec.query : toDatasetKey(overlaySpec.attr));
  if (rawOverlay !== undefined) {
    if (!(overlaySpec.values as readonly string[]).includes(rawOverlay)) {
      warnInvalid(log, 'overlay', rawOverlay, overlaySpec.default);
      return;
    }
    mergeSections(result, OVERLAY_PRESETS[rawOverlay as Overlay]);
    return;
  }
  const unbrandedSpec = COMPOUND_SCHEMA.unbranded;
  const rawUnbranded = read(keyOf === 'query' ? unbrandedSpec.query : toDatasetKey(unbrandedSpec.attr));
  if (rawUnbranded === undefined) return;
  const unbranded = asFlag(rawUnbranded);
  if (typeof unbranded !== 'boolean') {
    warnInvalid(log, 'unbranded', rawUnbranded, unbrandedSpec.default);
    return;
  }
  if (unbranded) mergeSections(result, OVERLAY_PRESETS.unbranded);
}

/**
 * The chrome's VISIBILITY rows among `paths` (every `OPTION_SCHEMA` path):
 * every `chrome.*` row but `behaviour`. `chrome.autoHide` is deliberately not
 * one of them: `chrome` says what is on screen, and `chrome="false"
 * controls="true"` must give back exactly the bar the default gives, idle
 * behaviour included.
 */
export function chromeFlagPaths(paths: readonly string[], behaviour: string): string[] {
  return paths.filter((path) => path.startsWith('chrome.') && path !== behaviour);
}

/**
 * The compound pre-pass of `optionsFromRecord`: overlay, then chrome, both
 * before the per-field loop. That order is what lets `overlay="kiosk"
 * chrome-status="true"` still turn the status pill back on, and
 * `overlay="embed" chrome="false"` still zero every `chrome.*` field embed's
 * own preset left alone.
 */
export function applyCompounds(
  result: Record<string, unknown>,
  read: (key: string) => string | undefined,
  keyOf: 'query' | 'attr',
  log: Logger,
  chromeFlags: readonly string[],
): void {
  applyOverlayPreset(result, read, keyOf, log);
  applyChromeCompound(result, read, keyOf, log, chromeFlags);
}
