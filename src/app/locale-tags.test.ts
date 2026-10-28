/**
 * The locale a host names reaches the catalogue the same way on every path:
 * the options object, `?lang=`, the element's `lang` attribute and the wire
 * protocol. This file covers the two that go through `resolveViewerOptions`;
 * `embed/protocol.schema.test.ts` covers the wire and `embed/element.test.ts`
 * the attribute.
 *
 * The interesting cases are Serbian's: the bare alias has to arrive as
 * `sr-Latn`, and the Cyrillic tag has to be refused with a warning rather than
 * answered in Latin.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { optionsFromQuery } from './option-adapters.js';
import { resolveViewerOptions, type DeepPartial, type ViewerOptions } from './viewer-options.js';
import { collectLog } from '../fixtures/stubs.js';
import { SHIPPED_LOCALES } from '../ui/messages.js';

const logged = collectLog();

beforeEach(logged.clear);

/** `resolveViewerOptions` with this file's sink attached, answering the locale it settled on. */
function localeOf(partial: DeepPartial<ViewerOptions>): string {
  return resolveViewerOptions({ ...partial, onLog: logged.sink }).locale;
}

describe('the locale option over seven locales', () => {
  test('every shipped tag survives the resolver unchanged', () => {
    for (const locale of SHIPPED_LOCALES) expect(localeOf({ locale }), locale).toBe(locale);
    expect(logged.codes()).toEqual([]);
  });

  test('a bare `sr` and a regional tag arrive as the canonical tag', () => {
    expect(localeOf({ locale: 'sr' })).toBe('sr-Latn');
    expect(localeOf(optionsFromQuery('?lang=sr'))).toBe('sr-Latn');
    expect(localeOf(optionsFromQuery('?lang=sr-latn'))).toBe('sr-Latn');
    expect(localeOf(optionsFromQuery('?lang=de-AT'))).toBe('de');
    expect(logged.codes()).toEqual([]);
  });

  test('`sr-Cyrl` falls back to English with one `option-invalid`', () => {
    expect(localeOf(optionsFromQuery('?lang=sr-Cyrl'))).toBe('en');
    expect(logged.codes()).toEqual(['option-invalid']);
    expect(logged.messages()[0]).toContain('locale');
  });
});
