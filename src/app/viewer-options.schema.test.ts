import { describe, expect, test } from 'bun:test';
import { z } from 'zod/mini';
import { judgeOption, viewerOptionsSchema, type OptionSpec } from './viewer-options.schema.js';
import { optionsFromQuery, resolveViewerOptions, type ViewerOptions } from './viewer-options.js';
import { MESSAGE_KEYS, registerLocale, type MessageKey } from '../ui/messages.js';

const enumSpec: OptionSpec = { kind: 'enum', values: ['a', 'b', 'c'], default: 'a', query: 'q', attr: 'q' };
const flagSpec: OptionSpec = { kind: 'flag', default: true, query: 'q', attr: 'q' };
const fractionSpec: OptionSpec = { kind: 'fraction', default: 0, query: 'q', attr: 'q' };
const stringSpec: OptionSpec = { kind: 'string', default: undefined, query: 'q', attr: 'q' };
const localeSpec: OptionSpec = { kind: 'locale', default: 'en', query: 'lang', attr: 'lang' };
const listSpec: OptionSpec = { kind: 'list', values: ['a', 'b'], default: [], query: 'q', attr: 'q' };

/**
 * The kind x value matrix: one good, one bad and the
 * documented edge values per `OptionKind`, judged directly against the
 * schema rather than against `option-resolvers.ts` (which, after this task,
 * IS `judgeOption` plus fallback-and-warn — comparing the two would be
 * circular). `viewer-options.test.ts`'s 742 unedited lines are what proves
 * the resolvers still behave the documented way end to end.
 */
describe('judgeOption — kind x value matrix', () => {
  test('enum: accepts a listed value, refuses a stranger and a non-string', () => {
    expect(judgeOption(enumSpec, 'b')).toEqual({ ok: true });
    expect(judgeOption(enumSpec, 'z')).toEqual({ ok: false });
    expect(judgeOption(enumSpec, 5)).toEqual({ ok: false });
  });

  test('enum: a single-value row still accepts its one member and refuses everything else', () => {
    const single: OptionSpec = { kind: 'enum', values: ['only'], default: 'only', query: 'q', attr: 'q' };
    expect(judgeOption(single, 'only')).toEqual({ ok: true });
    expect(judgeOption(single, 'other')).toEqual({ ok: false });
  });

  test('flag: accepts real booleans only', () => {
    expect(judgeOption(flagSpec, true)).toEqual({ ok: true });
    expect(judgeOption(flagSpec, false)).toEqual({ ok: true });
    expect(judgeOption(flagSpec, 'true')).toEqual({ ok: false });
    expect(judgeOption(flagSpec, 1)).toEqual({ ok: false });
  });

  test('fraction: the closed [0, 1] interval, never NaN or an infinity', () => {
    expect(judgeOption(fractionSpec, 0)).toEqual({ ok: true });
    expect(judgeOption(fractionSpec, 1)).toEqual({ ok: true });
    expect(judgeOption(fractionSpec, -0.0001)).toEqual({ ok: false });
    expect(judgeOption(fractionSpec, 1.0001)).toEqual({ ok: false });
    expect(judgeOption(fractionSpec, Number.NaN)).toEqual({ ok: false });
    expect(judgeOption(fractionSpec, Number.POSITIVE_INFINITY)).toEqual({ ok: false });
    expect(judgeOption(fractionSpec, Number.NEGATIVE_INFINITY)).toEqual({ ok: false });
    // `Number('x')` is NaN, so a non-numeric raw string never reaches here as
    // a number in the first place — `convertRaw` already turned it into NaN.
    expect(judgeOption(fractionSpec, '0.5')).toEqual({ ok: false });
  });

  test('string: accepts any string, including empty, refuses a non-string', () => {
    expect(judgeOption(stringSpec, '')).toEqual({ ok: true });
    expect(judgeOption(stringSpec, 'x')).toEqual({ ok: true });
    expect(judgeOption(stringSpec, 5)).toEqual({ ok: false });
    expect(judgeOption(stringSpec, { nope: true })).toEqual({ ok: false });
  });

  test('locale: a BCP-47 tag is judged by its primary subtag, not the whole tag', () => {
    // The tag is the region-qualified spelling an HTML page writes; `ru` ships.
    expect(judgeOption(localeSpec, 'ru-RU')).toEqual({ ok: true });
    expect(judgeOption(localeSpec, 'en')).toEqual({ ok: true });
    expect(judgeOption(localeSpec, '')).toEqual({ ok: false });
    expect(judgeOption(localeSpec, 'x-test')).toEqual({ ok: false });
    expect(judgeOption(localeSpec, 5)).toEqual({ ok: false });
  });

  test('the locale schema is rebuilt every call: a locale registered between two judgements is accepted on the second', () => {
    expect(judgeOption(localeSpec, 'jeexp4')).toEqual({ ok: false });
    const catalogue = Object.fromEntries(MESSAGE_KEYS.map((key) => [key, `jeexp4:${key}`])) as Record<MessageKey, string>;
    registerLocale('jeexp4', catalogue);
    expect(judgeOption(localeSpec, 'jeexp4')).toEqual({ ok: true });
  });

  test('list: an array of listed values, and nothing else', () => {
    expect(judgeOption(listSpec, [])).toEqual({ ok: true });
    expect(judgeOption(listSpec, ['a'])).toEqual({ ok: true });
    expect(judgeOption(listSpec, ['a', 'b'])).toEqual({ ok: true });
    expect(judgeOption(listSpec, ['c'])).toEqual({ ok: false });
    // A bare string is the mistake a host writing `slots="bottom-center"` in
    // an object literal makes; it is a LIST, not an enum.
    expect(judgeOption(listSpec, 'a')).toEqual({ ok: false });
    expect(judgeOption(listSpec, [1])).toEqual({ ok: false });
    expect(judgeOption(listSpec, [null])).toEqual({ ok: false });
    expect(judgeOption(listSpec, undefined)).toEqual({ ok: false });
  });

  test('the schema cache for the other four kinds does not stand in the way of a fresh row', () => {
    // A DIFFERENT row of the same kind is judged on its own values, not on
    // whatever the cache built for the first row it saw.
    const other: OptionSpec = { kind: 'enum', values: ['x', 'y'], default: 'x', query: 'q2', attr: 'q2' };
    expect(judgeOption(enumSpec, 'x')).toEqual({ ok: false });
    expect(judgeOption(other, 'x')).toEqual({ ok: true });
  });
});

/**
 * The whole resolved object, judged at once — the compile-time agreement
 * contract, and the same two inputs `scripts/schema-check.test.ts`
 * already exercises for the published JSON Schema.
 */
describe('viewerOptionsSchema', () => {
  test('the documented default resolves to something the schema accepts', () => {
    expect(z.safeParse(viewerOptionsSchema, resolveViewerOptions()).success).toBe(true);
  });

  test('a resolved object carrying slots and edits is accepted', () => {
    const resolved = resolveViewerOptions({ slots: ['bottom-center', 'selection-anchor'], edits: 'emit' });
    expect(z.safeParse(viewerOptionsSchema, resolved).success).toBe(true);
  });

  test('a representative partial resolves to something the schema accepts', () => {
    const resolved = resolveViewerOptions({ view: { mode: 'tour' }, locale: 'ru', chrome: { brand: false } });
    expect(z.safeParse(viewerOptionsSchema, resolved).success).toBe(true);
  });

  test('every overlay preset resolves to something the schema accepts', () => {
    for (const overlay of ['none', 'kiosk', 'embed', 'unbranded'] as const) {
      const resolved = resolveViewerOptions(optionsFromQuery(`?overlay=${overlay}`));
      expect({ overlay, ok: z.safeParse(viewerOptionsSchema, resolved).success }).toEqual({ overlay, ok: true });
    }
  });

  test('the chrome section carries autoHide, demands it, and still ignores a stranger key', () => {
    const resolved = resolveViewerOptions({ chrome: { autoHide: false } });
    expect(resolved.chrome.autoHide).toBe(false);
    expect(z.safeParse(viewerOptionsSchema, resolved).success).toBe(true);
    // The key is part of the closed shape, not an optional extra: a chrome
    // section without it is no longer a resolved `ViewerOptions`.
    const { autoHide: _dropped, ...withoutAutoHide } = resolved.chrome;
    expect(z.safeParse(viewerOptionsSchema, { ...resolved, chrome: withoutAutoHide }).success).toBe(false);
    expect(z.safeParse(viewerOptionsSchema, { ...resolved, chrome: { ...resolved.chrome, autoHide: 'yes' } }).success).toBe(false);
    // Unknown keys are refused the way they always were: the resolver drops
    // them before the schema ever sees the section.
    expect(resolveViewerOptions({ chrome: { nowhere: true } } as never).chrome).toEqual({
      brand: true,
      controls: true,
      status: true,
      modeSwitcher: true,
      hint: true,
      autoHide: true,
    });
  });

  test('the fullscreenButton shorthand resolves to the full section the schema demands', () => {
    // `ViewerOptionsInput` widens the INPUT only; the resolved shape — and so
    // the schema and the agreement check below — stays the three-field object.
    const resolved = resolveViewerOptions({ fullscreenButton: true });
    expect(resolved.fullscreenButton).toEqual({ show: true, right: 32, top: 32 });
    expect(z.safeParse(viewerOptionsSchema, resolved).success).toBe(true);
    expect(z.safeParse(viewerOptionsSchema, { ...resolved, fullscreenButton: true }).success).toBe(false);
  });

  /**
   * The schema's inferred type and the public
   * `ViewerOptions` contract (minus `onLog`, `scene` and `offers`, which no schema can
   * usefully describe — the module header) must accept each other. A drift
   * fails `tsc`, not the assertion: `BothWays` collapses to `false` and the
   * `const agree: BothWays = true` line stops compiling.
   */
  test('the schema and the public contract type-check as the same shape', () => {
    type SchemaShape = z.infer<typeof viewerOptionsSchema>;
    type PublicShape = Omit<ViewerOptions, 'onLog' | 'scene' | 'offers'>;
    type BothWays = SchemaShape extends PublicShape ? (PublicShape extends SchemaShape ? true : false) : false;
    const agree: BothWays = true;
    expect(agree).toBe(true);
  });
});
