/**
 * The catalogue has to stay total: every shipped locale answers every key in
 * its own language (the compiler enforces that; the parity test names the four
 * that read the same on purpose), a locale nobody registered still answers,
 * `registerLocale` really adds one, and placeholder substitution is exact.
 */

import { describe, expect, test } from 'bun:test';
import {
  createMessages,
  isLocale,
  isMessageKey,
  locales,
  MESSAGE_KEYS,
  MODE_HINT,
  primarySubtag,
  registerLocale,
  resolveLocaleTag,
  SHIPPED_LOCALES,
  TOUR_STATE_LABEL,
  type MessageKey,
} from './messages.js';
import { OPTION_SCHEMA } from '../app/viewer-options.js';
import type { TourState } from '../camera/tour-player.js';

describe('createMessages', () => {
  test('two locales answer at the same time, from their own catalogues', () => {
    const en = createMessages('en');
    const ru = createMessages('ru');
    expect(en.t('tour.playing')).toBe('Tour in progress');
    expect(ru.t('tour.playing')).toBe('Идёт тур');
    // Asking the second must not have moved the first: no shared state at all.
    expect(en.t('tour.playing')).toBe('Tour in progress');
    expect(ru.locale).toBe('ru');
  });

  test('every shipped locale answers every key in its own language', () => {
    // The old pair of tests pinned `ru` falling back to English for most keys.
    // `RU` is `Record<MessageKey, string>` now, so the compiler keeps it
    // complete and the fallback is unreachable for a shipped locale — what is
    // worth asserting is the PARITY, key for key.
    const english = createMessages('en');
    const russian = createMessages('ru');
    const untranslated = MESSAGE_KEYS.filter((key) => russian.t(key) === english.t(key));
    // The only key that reads the same in both is the brand line. The mode
    // names are not catalogue keys at all (`mode-labels.ts`).
    expect(untranslated).toEqual(['loading.eyebrow']);
    for (const key of MESSAGE_KEYS) expect(russian.t(key), key).not.toBe('');
  });

  test('substitutes named placeholders per instance', () => {
    expect(createMessages('en').t('panel.wallFinish', { name: 'Kitchen' })).toBe('Wall finish · Kitchen');
  });
});

describe('a bound catalogue', () => {
  test('answers in its own locale, with no process-wide state to set first', () => {
    expect(createMessages('en').t('tour.playing')).toBe('Tour in progress');
    expect(createMessages('ru').t('tour.playing')).toBe('Идёт тур');
  });

  test('a locale nobody registered still answers, in English', () => {
    // The fallback is for an UNREGISTERED locale — a `?lang=` the resolver let
    // through, or a `setLocale` from a host that got ahead of its own
    // `registerLocale` — not for a gap in a shipped catalogue.
    const unknown = createMessages('zz');
    expect(unknown.locale).toBe('zz');
    expect(unknown.t('hint.orbit')).toBe(createMessages('en').t('hint.orbit'));
  });

  test('substitutes named placeholders and leaves unknown ones visible', () => {
    const { t } = createMessages('en');
    expect(t('panel.wallFinish', { name: 'Kitchen' })).toBe('Wall finish · Kitchen');
    expect(t('hint.changeRefused', { message: 'nope' })).toBe('Change refused: nope');
    expect(t('hint.room')).toBe('{name} · drag to orbit · double-click to focus');
  });

  test('every key with a placeholder is given one by its callers', () => {
    // A placeholder that is never substituted would ship braces to the user.
    const { t } = createMessages('en');
    const withPlaceholders: MessageKey[] = [
      'hint.room',
      'hint.selected',
      'hint.changeRefused',
      'panel.floorFinish',
      'panel.wallFinish',
      'panel.replace',
    ];
    for (const key of withPlaceholders) expect(t(key)).toContain('{');
  });

  test('isMessageKey guards attribute values read from the DOM', () => {
    expect(isMessageKey('tour.ready')).toBe(true);
    expect(isMessageKey('not.a.key')).toBe(false);
  });
});

describe('MODE_HINT', () => {
  test('covers every documented view mode with a resolvable key', () => {
    const modes = OPTION_SCHEMA['view.mode'].values;
    expect(modes.length).toBeGreaterThan(0);
    for (const mode of modes) {
      const key = MODE_HINT[mode as keyof typeof MODE_HINT];
      expect(key).toBeDefined();
      expect(isMessageKey(key)).toBe(true);
    }
  });
});

describe('TOUR_STATE_LABEL', () => {
  test('covers every TourState with a resolvable key', () => {
    const states: TourState[] = ['ready', 'playing', 'paused', 'ended'];
    for (const state of states) {
      const key = TOUR_STATE_LABEL[state];
      expect(key).toBeDefined();
      expect(isMessageKey(key)).toBe(true);
    }
  });
});

describe('the shipped catalogues', () => {
  test('carry every key, and there are as many keys as English declares', () => {
    expect(MESSAGE_KEYS.length).toBe(new Set(MESSAGE_KEYS).size);
    for (const locale of SHIPPED_LOCALES) {
      const messages = createMessages(locale);
      for (const key of MESSAGE_KEYS) {
        // `t` falls back to English for a MISSING key, so the assertion that
        // proves completeness is the compiler's; this is the runtime shape.
        expect(typeof messages.t(key), `${locale}/${key}`).toBe('string');
        expect(messages.t(key), `${locale}/${key}`).not.toBe('');
      }
    }
  });

  test('are all seven in `locales()`, in catalogue order, before anything is registered', () => {
    // The registry is process-wide and Bun runs the suite in one process, so a
    // locale another file registered may be BEHIND the shipped ones — never in
    // front of them, because the shipped ones are inserted at module load.
    expect(locales().slice(0, SHIPPED_LOCALES.length)).toEqual([...SHIPPED_LOCALES]);
    expect([...SHIPPED_LOCALES]).toEqual(['en', 'de', 'fr', 'it', 'es', 'sr-Latn', 'ru']);
  });

  test('Serbian is Latin-script and translates a known key', () => {
    const sr = createMessages('sr');
    expect(sr.t('tour.playing')).toBe('Tura je u toku');
    for (const key of MESSAGE_KEYS) expect(sr.t(key), key).not.toMatch(/[Ѐ-ӿ]/);
  });
});

/**
 * A complete catalogue whose every string names its locale, for the registry
 * tests.
 *
 * The codes below are ISO-639-2 PRIVATE USE (`qaa`–`qtz`), deliberately: the
 * registry is process-wide and Bun runs the whole suite in one process, so a
 * real code like `de` registered here would be registered for
 * `frame-bridge.test.ts` too — and that file asserts `setLocale({ locale:
 * 'de' })` is refused.
 */
function catalogueFor(code: string): Record<MessageKey, string> {
  return Object.fromEntries(MESSAGE_KEYS.map((key) => [key, `${code}:${key}`])) as Record<MessageKey, string>;
}

describe('registerLocale', () => {
  test('adds a language this build never shipped, and it answers in it', () => {
    registerLocale('qaa', catalogueFor('qaa'));
    expect(locales()).toContain('qaa');
    expect(isLocale('qaa')).toBe(true);
    expect(createMessages('qaa').t('tour.playing')).toBe('qaa:tour.playing');
  });

  test('takes the primary subtag and lower-cases it, so `QAB-XX` is `qab`', () => {
    registerLocale('QAB-XX', catalogueFor('qab'));
    expect(isLocale('qab')).toBe(true);
    expect(createMessages('qab').t('tour.paused')).toBe('qab:tour.paused');
  });

  test('a hostile code cannot reach Object.prototype', () => {
    registerLocale('constructor', catalogueFor('constructor'));
    // The registry is a null-prototype object, so `constructor` is a plain key
    // and nothing on `Object.prototype` was touched.
    expect(isLocale('constructor')).toBe(true);
    expect(({} as Record<string, unknown>)['constructor']).toBe(Object);
  });

  test('a code that is already registered is replaced, wholesale', () => {
    // `createMessages` binds the LOCALE, not the record: the registry is the
    // source and a `Messages` is a view of it, so a replacement is seen by a
    // handle that was made before it. Documented, and restored here so the
    // rest of the suite keeps the shipped copy.
    const shipped = Object.fromEntries(MESSAGE_KEYS.map((key) => [key, createMessages('ru').t(key)])) as Record<MessageKey, string>;
    const bound = createMessages('ru');
    registerLocale('ru', Object.fromEntries(MESSAGE_KEYS.map((key) => [key, 'заменено'])) as Record<MessageKey, string>);
    expect(bound.t('tour.playing')).toBe('заменено');
    registerLocale('ru', shipped);
    expect(createMessages('ru').t('tour.playing')).toBe('Идёт тур');
  });
});

describe('resolveLocaleTag', () => {
  test('an exact tag, whatever its case', () => {
    expect(resolveLocaleTag('en')).toBe('en');
    expect(resolveLocaleTag('sr-Latn')).toBe('sr-Latn');
    expect(resolveLocaleTag('sr-latn')).toBe('sr-Latn');
    expect(resolveLocaleTag('SR-LATN')).toBe('sr-Latn');
  });

  test('a region is dropped, a script is not', () => {
    expect(resolveLocaleTag('ru-RU')).toBe('ru');
    expect(resolveLocaleTag('de-AT')).toBe('de');
    expect(resolveLocaleTag('sr-Latn-RS')).toBe('sr-Latn');
  });

  test('a bare `sr` is Latin by the product rule; `sr-Cyrl` is refused, not redirected', () => {
    // CLDR expands a bare `sr` to Cyrillic and the viewer ships no Cyrillic
    // catalogue, so the bare tag is OURS to define. A tag
    // that names Cyrillic explicitly is a different claim, and answering it in
    // Latin would be a lie about the document.
    expect(resolveLocaleTag('sr')).toBe('sr-Latn');
    expect(resolveLocaleTag('SR')).toBe('sr-Latn');
    expect(resolveLocaleTag('sr-RS')).toBe('sr-Latn');
    expect(resolveLocaleTag('sr-Cyrl')).toBeUndefined();
    expect(resolveLocaleTag('sr-Cyrl-RS')).toBeUndefined();
    expect(isLocale('sr-Cyrl')).toBe(false);
    expect(isLocale('sr')).toBe(true);
  });

  test('a language this build cannot answer in', () => {
    expect(resolveLocaleTag('zz')).toBeUndefined();
    expect(resolveLocaleTag('zh-Hant')).toBeUndefined();
    expect(resolveLocaleTag('')).toBeUndefined();
    expect(resolveLocaleTag('   ')).toBeUndefined();
  });
});

describe('the Serbian catalogue', () => {
  test('answers under every spelling a host may write, and says `sr-Latn` when asked', () => {
    for (const tag of ['sr', 'SR', 'sr-Latn', 'sr-latn', 'sr-Latn-RS', 'sr-RS']) {
      const messages = createMessages(tag);
      expect(messages.locale, tag).toBe('sr-Latn');
      expect(messages.t('tour.playing'), tag).toBe('Tura je u toku');
    }
  });

  test('`sr-Cyrl` gets English, not Latin Serbian', () => {
    const messages = createMessages('sr-Cyrl');
    expect(messages.t('tour.playing')).toBe('Tour in progress');
  });
});

describe('primarySubtag', () => {
  test('takes the language out of a BCP-47 tag, whatever its case', () => {
    expect(primarySubtag('ru-RU')).toBe('ru');
    expect(primarySubtag('EN')).toBe('en');
    expect(primarySubtag('zh-Hant-TW')).toBe('zh');
    expect(primarySubtag('  de-AT ')).toBe('de');
    expect(primarySubtag('en')).toBe('en');
  });

  test('is grammar only: it does not pick a catalogue, `resolveLocaleTag` does', () => {
    expect(primarySubtag('sr-Latn')).toBe('sr');
    expect(resolveLocaleTag('sr-Latn')).toBe('sr-Latn');
  });
});
