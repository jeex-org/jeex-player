/**
 * Dotted option paths (`'tour.start'`, `'capture.disclosure.caption'`,
 * top-level `'locale'`) and the nested records they name: the walking helpers
 * `viewer-options.ts` folds `OPTION_SCHEMA` with, plus the attribute-to-dataset
 * spelling. Split out of that file when the fullscreen-button rows
 * took it past its 700-line limit; they know nothing about any one option —
 * the section shorthands `descend` expands are a table the caller passes in.
 *
 * Pure module: no `three`, no DOM.
 */

/**
 * A dotted option path as its section and field. A path with no dot is a
 * TOP-LEVEL option (`locale`, `debug`): `section` is `null` and the field sits
 * on the options object itself.
 *
 * The LAST dot is the split, so a section may itself be nested
 * (`capture.disclosure` + `caption`); `containerFor` and `descend` are the two
 * halves that walk one, and a one-level path goes through them unchanged.
 */
export function split(path: string): { section: string | null; field: string } {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? { section: null, field: path } : { section: path.slice(0, dot), field: path.slice(dot + 1) };
}

/** The nested record a dotted SECTION names inside `root`, created as it is walked. */
export function containerFor(
  root: Record<string, unknown>,
  section: string,
  blank: () => Record<string, unknown>,
): Record<string, unknown> {
  let node = root;
  for (const part of section.split('.')) node = (node[part] ??= blank()) as Record<string, unknown>;
  return node;
}

/**
 * Sections a host may give as a bare boolean that stands for ONE of their
 * fields: `{ fullscreenButton: 'show' }` reads `fullscreenButton: true` as
 * `{ fullscreenButton: { show: true } }`, every other field at its default.
 */
export type SectionShorthands = Readonly<Record<string, string>>;

/**
 * The nested record a dotted SECTION names inside `source`, or `undefined`
 * where the walk stops. `Object.hasOwn` at every level, never a plain property
 * read: the source is a host's own object and a `__proto__` key in it must not
 * stand in for a section. A boolean met at a section listed in `shorthands` is
 * expanded to the one-field record it stands for; any other non-record is
 * handed back as it is and answers no field.
 */
export function descend(
  source: Record<string, unknown>,
  section: string,
  shorthands: SectionShorthands = {},
): Record<string, unknown> | undefined {
  let node: Record<string, unknown> | undefined = source;
  let walked = '';
  for (const part of section.split('.')) {
    if (node === undefined || !Object.hasOwn(node, part)) return undefined;
    walked = walked === '' ? part : `${walked}.${part}`;
    node = expandShorthand(node[part], Object.hasOwn(shorthands, walked) ? shorthands[walked] : undefined);
  }
  return node;
}

/** `value` itself, or — a boolean at a shorthand section — the record with `field` set to it. */
function expandShorthand(value: unknown, field: string | undefined): Record<string, unknown> | undefined {
  // Only a section that HAS a shorthand expands, and then any value that is not
  // an object stands for its one field: `fullscreenButton: true`,
  // `analytics: 'off'` (and `analytics: false`, which its resolver reads as off).
  const scalar = value === null || (typeof value !== 'object' && value !== undefined);
  if (field === undefined || !scalar) return value as Record<string, unknown> | undefined;
  const record = blankRecord();
  record[field] = value;
  return record;
}

/** A section object with no prototype: a caller-supplied id can never reach `Object.prototype` through one. */
export function blankRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

/** `tour-start` (an `attr` spelling) → `tourStart` (the `dataset` property name the browser exposes for it). */
export function toDatasetKey(attr: string): string {
  return attr.replaceAll(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
