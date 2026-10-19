/**
 * Message catalogue. Every user-visible string in the viewer comes from here
 * through `t(key, params)`; nothing is written inline in a module or in a
 * template.
 *
 * The shell template (`viewer-shell.ts`) carries the English copy as its static
 * default and marks each node with `data-i18n` (text) or `data-i18n-attr`
 * (attributes), so the markup reads correctly even if nothing translates it;
 * `applyDomMessages(fragment, messages)` re-fills it for the instance's locale
 * while the fragment is still off-page — never over the host's `document`.
 *
 * Completeness invariant: every shipped catalogue is `Record<MessageKey,
 * string>`, so the COMPILER refuses a new English key that nobody translated.
 * Seven ship — `en`, `de`, `fr`, `it`, `es`, `sr-Latn`, `ru` — all translated
 * (`DRAFT_LOCALES` is empty; it stays as the mechanism for the
 * next locale that ships English strings first). Serbian is addressed by the
 * full tag `sr-Latn`; a bare `sr` is an alias for it (`DEFAULT_SCRIPT`), and
 * `sr-Cyrl` is refused.
 * A host adds its own with `registerLocale`, which asks for the same complete
 * record — a partial one would ship English to the very users a host added
 * the language for.
 *
 * Automation must not depend on this module: `scripts/browser-check.ts` asserts
 * on ids and `data-*` attributes, never on copy.
 *
 * Pure module apart from `applyDomMessages`, which is the only DOM-touching
 * function and returns silently when `document` is unavailable.
 */

import type { ViewerMode } from '../scene/types.js';
import type { TourState } from '../camera/tour-player.js';
import { canonicalLocaleTag, DEFAULT_SCRIPT, EN, MESSAGE_KEYS, isMessageKey } from '../shared/messages.js';
import type { Locale, MessageKey, Messages } from '../shared/messages.js';
import { DE } from './locales/de.js';
import { ES } from './locales/es.js';
import { FR } from './locales/fr.js';
import { IT } from './locales/it.js';
import { RU } from './locales/ru.js';
import { SR_LATN } from './locales/sr-latn.js';

export type { Locale, MessageKey, Messages };
export { MESSAGE_KEYS, isMessageKey };

/** The control-bar hint shown for each `ViewerMode` (`ViewerUI.setHintForMode`). */
export const MODE_HINT: Readonly<Record<ViewerMode, MessageKey>> = {
  plan2d: 'hint.plan2d',
  plan3d: 'hint.plan3d',
  orbit: 'hint.orbit',
  walk: 'hint.walk',
  tour: 'hint.tour',
};

/**
 * The live region's OWN copy for each `ViewerMode`
 * (`ViewerChrome.announceMode`) — terser than `MODE_HINT`, which stays
 * mouse/keyboard-instruction text for the visible hint card.
 */
export const LIVE_MODE_LABEL: Readonly<Record<ViewerMode, MessageKey>> = {
  plan2d: 'live.mode.plan2d',
  plan3d: 'live.mode.plan3d',
  orbit: 'live.mode.orbit',
  walk: 'live.mode.walk',
  tour: 'live.mode.tour',
};

/** The `#tour-status` label shown for each `TourState` (`ViewerUI.setTourState`). */
export const TOUR_STATE_LABEL: Readonly<Record<TourState, MessageKey>> = {
  ready: 'tour.ready',
  playing: 'tour.playing',
  paused: 'tour.paused',
  ended: 'tour.ended',
};

/**
 * Every catalogue this viewer can answer from, shipped and host-registered.
 *
 * `Object.create(null)` because the keys are LOCALE CODES a host supplies:
 * `registerLocale('constructor', …)` on a plain object would write onto
 * `Object.prototype` (untrusted input).
 */
const CATALOGUES: Record<string, Record<MessageKey, string>> = Object.assign(
  Object.create(null) as Record<string, Record<MessageKey, string>>,
  {
    en: EN,
    de: DE,
    fr: FR,
    it: IT,
    es: ES,
    'sr-Latn': SR_LATN,
    ru: RU,
  },
);

/**
 * The tags this build ships a catalogue for, in catalogue order.
 *
 * Written out rather than derived from `CATALOGUES`, because it is the
 * PROMISE: `locales()` reads a live registry a host may have added to, and the
 * tests need one list that says what the BUILD carries. The two are checked
 * against each other in `messages.test.ts`.
 */
export const SHIPPED_LOCALES = ['en', 'de', 'fr', 'it', 'es', 'sr-Latn', 'ru'] as const;

/**
 * Shipped catalogues whose strings are still the English ones.
 *
 * A viewer answers from them — an English answer beats a blank one — but the
 * build never pretends they are translations: `messages.draft.test.ts` asserts
 * this list equals the set of catalogues that read like English for more than
 * 90 % of their keys, so a draft cannot be declared finished before it is, and
 * a finished one cannot stay on the list. Empty now (German, French,
 * Italian and Spanish are translated); kept for the next locale that ships English
 * strings first.
 */
export const DRAFT_LOCALES: readonly Locale[] = [];

/**
 * Adds a catalogue, or replaces one.
 *
 * The record must be COMPLETE — every `MessageKey`, no fallbacks — because a
 * host adding a language is adding it for people who do not read the one it
 * would fall back to. `code` is canonicalised whole (`canonicalLocaleTag`), so
 * `registerLocale('sr-Cyrl', …)` adds exactly that tag and `RU`/`ru` are one
 * locale.
 *
 * It takes effect for viewers mounted AFTER the call: a running instance holds
 * its own bound catalogue, and `setLocale` is how it moves.
 */
export function registerLocale(code: string, catalogue: Record<MessageKey, string>): void {
  CATALOGUES[canonicalLocaleTag(code)] = { ...catalogue };
}

/** Every locale this viewer can answer in right now, shipped and registered. */
export function locales(): readonly Locale[] {
  return Object.keys(CATALOGUES);
}

/** The catalogue key a canonical tag addresses, case-insensitively. */
function catalogueKey(canonical: string): Locale | undefined {
  if (Object.hasOwn(CATALOGUES, canonical)) return canonical;
  const lower = canonical.toLowerCase();
  for (const key of Object.keys(CATALOGUES)) {
    if (key.toLowerCase() === lower) return key;
  }
  return undefined;
}

/**
 * The catalogue a BCP-47 tag selects, named by the canonical tag it is keyed
 * by — `undefined` when this build can answer in no such language.
 *
 * Three steps, in this order:
 * 1. the tag itself, region and variants dropped: `ru-RU` → `ru`, `sr-Latn-RS`
 *    → `sr-Latn`;
 * 2. a tag that NAMES its script and matched nothing stops here — `sr-Cyrl` is
 *    refused rather than answered in the other script;
 * 3. a bare language with no catalogue of its own goes through
 *    `DEFAULT_SCRIPT`: `sr` → `sr-Latn`.
 * Case never decides: `sr-latn` in a host's markup is the same locale as
 * `sr-Latn`.
 *
 * This is what `lang=`, `?lang=`, `setLocale` and the wire protocol all ask;
 * `primarySubtag` stays pure BCP-47 grammar and selects nothing.
 */
export function resolveLocaleTag(tag: string): Locale | undefined {
  const canonical = canonicalLocaleTag(tag);
  if (canonical === '') return undefined;
  const exact = catalogueKey(canonical);
  if (exact !== undefined) return exact;
  if (canonical.includes('-')) return undefined;
  const scripted = DEFAULT_SCRIPT[canonical];
  return scripted === undefined ? undefined : catalogueKey(scripted);
}

/**
 * Binds the catalogue to one locale, under the CANONICAL tag: a viewer mounted
 * with `sr` reports `sr-Latn` from `getLocale()`, writes `sr-Latn` into the
 * shell's `lang`, and a host reading either back gets a tag it can hand to
 * `Intl`. A tag nobody ships is kept as it was given and answers in English —
 * a host that registers it a moment later then finds its own catalogue.
 */
export function createMessages(locale: Locale): Messages {
  const canonical = resolveLocaleTag(locale) ?? locale;
  return { locale: canonical, t: (key, params) => translate(canonical, key, params) };
}

/** True when `value` names a language this build can answer in, alias included. */
export function isLocale(value: string): value is Locale {
  return resolveLocaleTag(value) !== undefined;
}

/**
 * The primary language subtag of a BCP-47 tag, lower-cased: `ru-RU` → `ru`.
 *
 * HTML's `lang` is a BCP-47 tag and a host writes what its page says
 * (`lang="en-GB"`, `lang="ru-RU"`); the catalogue is keyed by language alone.
 * Anything before the first `-`, which is the subtag grammar — a tag with no
 * region is already its own primary subtag.
 */
export function primarySubtag(tag: string): string {
  return tag.trim().split('-')[0]!.toLowerCase();
}

function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  // `resolveLocaleTag` only ever names a key that exists, which is what makes
  // this index safe; an unregistered locale still answers in English rather
  // than throwing.
  const resolved = resolveLocaleTag(locale);
  const catalogue = resolved === undefined ? undefined : CATALOGUES[resolved];
  const template = catalogue?.[key] ?? EN[key] ?? key;
  if (!params) return template;
  return template.replaceAll(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Fills every `[data-i18n]` node's text and every `[data-i18n-attr]` node's
 * attributes from the catalogue.
 *
 * `data-i18n-attr` is a comma-separated list of `attribute:key` pairs, e.g.
 * `data-i18n-attr="aria-label:furniture.hide,title:furniture.label"`.
 */
export function applyDomMessages(root: ParentNode, messages: Messages): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset['i18n'];
    if (key && isMessageKey(key)) node.textContent = messages.t(key);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of (node.dataset['i18nAttr'] ?? '').split(',')) {
      const [attribute, key] = pair.split(':').map((part) => part.trim());
      if (!attribute || !key || !isMessageKey(key)) continue;
      node.setAttribute(attribute, messages.t(key));
    }
  }
}
