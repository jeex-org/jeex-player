/**
 * The sidecar of a light bake (format 1) as a `zod/mini` schema: the boundary
 * where a bake made elsewhere enters the player.
 *
 * A light bake is the indirect light of an apartment shell, baked offline
 * into UV1 of the shell's meshes and stored as atlas pages. The sidecar binds
 * the bake to its input and tells the player how to read it:
 * - `bakeId` (UUID v7, minted by the bake), `sceneId`, `contentHash` (the
 *   bake's input) and `shellHash` (the shell GLB the bake was made for);
 * - `sun` (the direction light travels, glTF frame +Y up, unit; linear
 *   Rec.709 colour; irradiance in W/m²): the sun the bake left out of its
 *   direct term, which the player keeps live;
 * - `pages`: each atlas page and its prepared mip levels, one file per level;
 * - `bindings`: one per lightmapped mesh, by entity id, with its page and its
 *   chart rect in texels (top-down rows);
 * - `lamps`: the lamps whose light is in the bake (their live diffuse must
 *   not light a baked surface again); a lamp not listed is live;
 * - `contract`: what the player must do for the light to be right. It is
 *   closed: a contract this player does not know is refused, and so is the
 *   whole bake, never half-applied.
 *
 * Invariant: the schema JUDGES and never repairs; the value that passed flows
 * on unchanged. The player mints no ids: it only checks their grammar.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { UUID_V7_PATTERN } from '../scene/types.js';
import { LIVE_DISABLED, LIVE_KEPT, type LightBake } from './light-bake.js';

const uuid = z.string().check(z.regex(UUID_V7_PATTERN, { error: 'not a UUID v7' }));
const finite = z.number().check(z.refine(Number.isFinite, { error: 'must be finite' }));
const positive = finite.check(z.positive({ error: 'must be positive' }));
const nonNegative = finite.check(z.gte(0, { error: 'must not be negative' }));
const texels = z.int({ error: 'must be an integer' }).check(z.gte(0, { error: 'must not be negative' }));
const count = z.int({ error: 'must be an integer' }).check(z.gte(1, { error: 'must be at least 1' }));
const vec3 = z.readonly(z.tuple([finite, finite, finite]));
const hash = z.string().check(z.regex(/^sha256:[0-9a-f]{64}$/, { error: 'not a sha256 digest' }));
/** A file next to the sidecar: no directory, no scheme, nothing that climbs out. */
const file = z.string().check(z.regex(/^[a-z0-9][a-z0-9._-]*$/, { error: 'not a file name next to the sidecar' }));

/** A list that names exactly the contributions of `known`, in any order, each once. */
const policy = (known: readonly string[]) =>
  z.readonly(
    z.array(z.string()).check(
      z.refine((list) => list.length === known.length && new Set(list).size === list.length && list.every((item) => known.includes(item)), {
        error: `must name exactly: ${known.join(', ')}`,
      }),
    ),
  );

/** The closed contract of an RGBM atlas bake. */
const contractSchema = z.strictObject({
  uv: z.strictObject({ channel: z.literal(1), mode: z.literal('atlas') }),
  rows: z.literal('top-down'),
  encoding: z.strictObject({
    kind: z.literal('rgbm'),
    range: positive,
    alpha: z.literal('straight-m'),
    colour: z.literal('linear-non-colour'),
    decode: z.literal('rgb * m * range, before intensity'),
  }),
  intensity: positive,
  mips: z.strictObject({ lodLimit: texels, webp: z.literal('per-level files') }),
  upload: z.strictObject({ flipY: z.literal(false), premultiplyAlpha: z.literal(false), colorSpace: z.literal('none') }),
  live: z.strictObject({ keep: policy(LIVE_KEPT), disable: policy(LIVE_DISABLED) }),
});

const pageSchema = z.strictObject({
  width: count,
  height: count,
  levels: count,
  ktx2: z.optional(file),
  webp: z.readonly(z.array(file).check(z.minLength(1, { error: 'needs at least one level file' }))),
});

const bindingSchema = z.strictObject({
  node: uuid,
  page: texels,
  rect: z.strictObject({ x: texels, y: texels, w: count, h: count }),
});

/** The sidecar, format 1. `baker` and `calibration` are the bake's own record and are not read. */
export const lightBakeSchema = z
  .strictObject({
    format: z.literal(1),
    bakeId: uuid,
    sceneId: uuid,
    contentHash: hash,
    shellHash: hash,
    baker: z.optional(z.looseObject({})),
    sun: z.strictObject({
      direction: vec3.check(z.refine((v) => Math.abs(Math.hypot(...v) - 1) <= 1e-3, { error: 'must be a unit vector' })),
      color: z.readonly(z.tuple([nonNegative, nonNegative, nonNegative])),
      strength: nonNegative,
    }),
    sky: z.optional(z.looseObject({})),
    calibration: z.optional(z.looseObject({})),
    pages: z.readonly(z.array(pageSchema).check(z.minLength(1, { error: 'needs at least one page' }))),
    bindings: z.readonly(z.array(bindingSchema).check(z.minLength(1, { error: 'needs at least one binding' }))),
    lamps: z.readonly(z.array(z.strictObject({ id: uuid }))),
    contract: contractSchema,
  })
  .check(
    z.superRefine((bake, ctx) => {
      const seen = new Set<string>();
      for (const [i, binding] of bake.bindings.entries()) {
        if (seen.has(binding.node))
          ctx.addIssue({ code: 'custom', path: ['bindings', i, 'node'], message: `node ${binding.node} is bound twice` });
        seen.add(binding.node);
        const page = bake.pages[binding.page];
        if (!page) {
          ctx.addIssue({ code: 'custom', path: ['bindings', i, 'page'], message: `page ${String(binding.page)} does not exist` });
          continue;
        }
        const { x, y, w, h } = binding.rect;
        if (x + w > page.width || y + h > page.height)
          ctx.addIssue({ code: 'custom', path: ['bindings', i, 'rect'], message: `the rect leaves page ${String(binding.page)}` });
      }
      for (const [i, page] of bake.pages.entries()) {
        if (page.webp.length !== page.levels)
          ctx.addIssue({
            code: 'custom',
            path: ['pages', i, 'webp'],
            message: `${String(page.webp.length)} level files for ${String(page.levels)} levels`,
          });
        if (bake.contract.mips.lodLimit >= page.levels)
          ctx.addIssue({
            code: 'custom',
            path: ['contract', 'mips', 'lodLimit'],
            message: `page ${String(i)} has no level ${String(bake.contract.mips.lodLimit)}`,
          });
        if (page.levels > 1 + Math.floor(Math.log2(Math.max(page.width, page.height))))
          ctx.addIssue({ code: 'custom', path: ['pages', i, 'levels'], message: 'more levels than the page has sizes' });
      }
      const lamps = new Set<string>();
      for (const [i, lamp] of bake.lamps.entries()) {
        if (lamps.has(lamp.id)) ctx.addIssue({ code: 'custom', path: ['lamps', i, 'id'], message: `lamp ${lamp.id} is listed twice` });
        lamps.add(lamp.id);
      }
    }),
  );

/** The judged sidecar, or the sentence that names what was refused. */
export type LightBakeVerdict = { readonly ok: true; readonly value: LightBake } | { readonly ok: false; readonly message: string };

/** Judges a parsed sidecar document. */
export function judgeLightBake(input: unknown): LightBakeVerdict {
  const result = z.safeParse(lightBakeSchema, input);
  // The value that passed flows on, never `result.data`: the schema judges and never repairs.
  if (result.success) return { ok: true, value: input as LightBake };
  const issues = result.error.issues.slice(0, 8).map((issue) => {
    const keys = issue.code === 'unrecognized_keys' ? issue.keys : [];
    const where = [...issue.path.map(String), ...keys].join('.') || 'sidecar';
    return `${where}: ${issue.message}`;
  });
  return { ok: false, message: `light bake refused: ${issues.join('; ')}` };
}
