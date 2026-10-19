/**
 * A DRAFT catalogue must not be able to ship as a finished one.
 *
 * `de`, `fr`, `it` and `es` were first added filled with the ENGLISH strings, so
 * the seven-locale surface (the tag resolution, the option paths, the wire
 * protocol) could be built and tested before a single word was translated.
 * Real translations later replaced all four and emptied
 * `DRAFT_LOCALES`; the mechanism stays for the next locale that ships English
 * strings first, and this test is what keeps it honest: an untranslated
 * catalogue answers, looks alive, and would otherwise ship as «done».
 *
 * Two halves, and the test refuses either one alone:
 * - `DRAFT_LOCALES` is the DECLARATION — what the build says is unfinished;
 * - the English-identity share is the MEASUREMENT — what the strings actually
 *   are.
 * A change that replaces a language's strings must drop its tag from
 * `DRAFT_LOCALES` in the same change; doing one without the other fails right
 * here.
 */

import { describe, expect, test } from 'bun:test';
import { MESSAGE_KEYS } from '../shared/messages.js';
import { createMessages, DRAFT_LOCALES, SHIPPED_LOCALES } from './messages.js';

/**
 * Past this share of keys reading exactly like English, a catalogue is English
 * wearing another tag rather than a translation.
 *
 * 0.9 and not 1.0 because a finished catalogue keeps a few English strings on
 * purpose — `2D`, `3D`, `360` and the brand line read the same in every
 * language the viewer ships. Measured on the six translated catalogues: `ru`
 * and `sr-Latn` are each 4/104 = 3.8 % identical, `de` and `es` 7/104 = 6.7 %,
 * `fr` and `it` 6/104 = 5.8 %, so the threshold has over 80 points of headroom
 * on one side and 0 on the other (a draft is 100 %).
 */
const DRAFT_SHARE = 0.9;

/** The share of keys whose string is byte-identical to the English one. */
function englishShare(locale: string): number {
  const english = createMessages('en');
  const catalogue = createMessages(locale);
  const identical = MESSAGE_KEYS.filter((key) => catalogue.t(key) === english.t(key));
  return identical.length / MESSAGE_KEYS.length;
}

describe('DRAFT_LOCALES', () => {
  test('names exactly the shipped catalogues that are still English', () => {
    const measured: string[] = SHIPPED_LOCALES.filter((locale) => locale !== 'en' && englishShare(locale) > DRAFT_SHARE);
    expect([...measured].sort()).toEqual([...DRAFT_LOCALES].sort());
  });

  test('every draft is a shipped locale, and English is never one', () => {
    const shipped: readonly string[] = SHIPPED_LOCALES;
    for (const locale of DRAFT_LOCALES) expect(shipped).toContain(locale);
    expect(DRAFT_LOCALES).not.toContain('en');
  });

  test('every catalogue NOT on the list is nowhere near the threshold', () => {
    // The margin the threshold was chosen against, pinned so a future edit that
    // guts a translation is seen here rather than in a user's face: the two
    // translated catalogues sit at 4/104 = 3.8 %, the drafts at 100 %.
    const translated = SHIPPED_LOCALES.filter((locale) => locale !== 'en' && !DRAFT_LOCALES.includes(locale));
    expect(translated.length).toBeGreaterThan(0);
    for (const locale of translated) expect(englishShare(locale), locale).toBeLessThan(0.1);
  });

  test('a draft still answers every key, in English, rather than blank', () => {
    for (const locale of DRAFT_LOCALES) {
      const catalogue = createMessages(locale);
      for (const key of MESSAGE_KEYS) expect(catalogue.t(key), `${locale}/${key}`).not.toBe('');
    }
  });
});
