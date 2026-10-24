/**
 * The `lighting.hdri` mount option as a `zod/mini` schema: one entry per sun
 * preset, judged entry by entry.
 *
 * Invariant: an entry is kept whole or dropped whole. A refused entry is
 * reported by its path and never reaches the walk lighting, while its
 * siblings are kept; nothing is repaired. The rules the published JSON Schema
 * spells (`scripts/schema-gen.ts`) are the same: URL schemes, elevation and
 * share bounds, a linear colour whose largest channel is exactly 1.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { SITE_SUNS } from '../scene/schema-sets.js';
import type { SiteSun } from '../scene/types.js';
import type { HdriEntry } from '../lighting/hdri-entry.js';

/** URL schemes an HDRI file may be fetched from. */
const URL_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'blob:']);

/** The published JSON Schema's `pattern` on the raw string: case and surrounding space as given. */
const SCHEME_PATTERN = /^(https?|blob):/;

function isFetchableUrl(value: string): boolean {
  if (!SCHEME_PATTERN.test(value)) return false;
  try {
    return URL_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

const urlSchema = z.string().check(z.refine(isFetchableUrl, { error: 'must be an absolute http:, https: or blob: URL' }));

const channel = z.number().check(z.gte(0), z.lte(1));

/** One preset's sky: two URLs and the sun's stored facts. */
export const hdriEntrySchema = z.strictObject({
  environmentUrl: urlSchema,
  skyUrl: urlSchema,
  sun: z.strictObject({
    azimuthDeg: z.number(),
    elevationDeg: z.number().check(z.gt(0), z.lte(90)),
    colourLinear: z
      .readonly(z.tuple([channel, channel, channel]))
      .check(z.refine((rgb) => Math.max(...rgb) === 1, { error: 'largest channel must be 1' })),
    horizontalIrradianceShare: z.number().check(z.gte(0), z.lt(1)),
  }),
});

/** The kept entries and one record per refused key (or the whole value). */
export type HdriVerdict = {
  readonly value: Partial<Record<SiteSun, HdriEntry>>;
  readonly refused: readonly { readonly path: string; readonly value: unknown; readonly message: string }[];
};

const PRESETS: ReadonlySet<string> = new Set(SITE_SUNS);
const PATH = 'lighting.hdri';

function frozenCopy(entry: HdriEntry): HdriEntry {
  const sun = entry.sun;
  return Object.freeze({
    environmentUrl: entry.environmentUrl,
    skyUrl: entry.skyUrl,
    sun: Object.freeze({
      azimuthDeg: sun.azimuthDeg,
      elevationDeg: sun.elevationDeg,
      colourLinear: Object.freeze([sun.colourLinear[0], sun.colourLinear[1], sun.colourLinear[2]] as const),
      horizontalIrradianceShare: sun.horizontalIrradianceShare,
    }),
  });
}

/** Judges `input` entry by entry; `undefined` is no option. Only own keys are read. */
export function judgeHdriOption(input: unknown): HdriVerdict {
  if (input === undefined) return { value: {}, refused: [] };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { value: {}, refused: [{ path: PATH, value: input, message: 'must be an object keyed by sun preset' }] };
  }
  const value: Partial<Record<SiteSun, HdriEntry>> = {};
  const refused: { path: string; value: unknown; message: string }[] = [];
  for (const key of Object.keys(input)) {
    const given = (input as Record<string, unknown>)[key];
    const path = `${PATH}.${key}`;
    if (!PRESETS.has(key)) {
      refused.push({ path, value: given, message: 'is not a sun preset' });
      continue;
    }
    const result = z.safeParse(hdriEntrySchema, given);
    if (result.success) value[key as SiteSun] = frozenCopy(result.data);
    else
      refused.push({
        path,
        value: given,
        message: result.error.issues.map((issue) => `${issue.path.join('.') || 'entry'}: ${issue.message}`).join('; '),
      });
  }
  return { value: Object.freeze(value), refused };
}
