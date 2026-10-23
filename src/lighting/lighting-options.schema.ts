/**
 * The options of an apartment rig as a `zod/mini` schema: the boundary where a
 * consumer's object enters the lighting standard.
 *
 * Invariant: the schema JUDGES and never repairs. A value it refuses is a
 * `bad-options` refusal before anything is allocated or any scene changed;
 * the default and the lowering to the renderer's maximum texture size are the
 * context's, applied only to a value that passed.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { LIGHTING_STANDARD } from './lighting-standard.js';

const SHADOW = LIGHTING_STANDARD.apartment.sun.shadow;

const isPowerOfTwo = (value: number): boolean => Number.isInteger(Math.log2(value));

/** `{ shadowMapSize?, shadowCache? }`, strict: an unknown key is refused. */
export const apartmentRigOptionsSchema = z.strictObject(
  {
    shadowMapSize: z.optional(
      z
        .int({ error: 'must be an integer' })
        .check(
          z.gte(SHADOW.minMapSize, { error: `must be at least ${String(SHADOW.minMapSize)}` }),
          z.lte(SHADOW.maxMapSize, { error: `must be at most ${String(SHADOW.maxMapSize)}` }),
          z.refine(isPowerOfTwo, { error: 'must be a power of two' }),
        ),
    ),
    /** Redraw the sun's shadow map only when the rig is told it is dirty; default false (live). */
    shadowCache: z.optional(z.boolean({ error: 'must be a boolean' })),
  },
  { error: (issue) => (issue.code === 'unrecognized_keys' ? 'is not an option of the apartment rig' : 'options must be an object') },
);

/** Options of an apartment rig. */
export type ApartmentRigOptions = z.infer<typeof apartmentRigOptionsSchema>;

/** The judged options, or the sentence that names what was refused. */
export type RigOptionsVerdict =
  | { readonly ok: true; readonly value: ApartmentRigOptions }
  | { readonly ok: false; readonly message: string };

/** Judges `input`; `undefined` is no options at all. */
export function judgeApartmentRigOptions(input: unknown): RigOptionsVerdict {
  const result = z.safeParse(apartmentRigOptionsSchema, input === undefined ? {} : input);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues.map((issue) => {
    const keys = issue.code === 'unrecognized_keys' ? issue.keys : [];
    const where = [...issue.path.map(String), ...keys].join('.') || 'options';
    return `${where}: ${issue.message}`;
  });
  return { ok: false, message: `apartment rig options refused: ${issues.join('; ')}` };
}
