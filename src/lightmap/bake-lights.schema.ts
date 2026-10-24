/**
 * The lights a light bake takes for a scene (`bakeLights`, recipe
 * `jeex-bake-lights@1`) as a `zod/mini` schema: the contract the bake tool
 * mirrors. Units are three.js r186 physical units in the working colour
 * space (linear Rec.709), world axes as glTF (+Y up, metres):
 * - `sun`: `direction` is the unit direction the light TRAVELS (as the
 *   sidecar's `sun`), `sun.color` linear, `strength` the irradiance in W/m² on a
 *   surface facing it, so `E = strength * sun.color`. No interior factor.
 * - `sky`: recipe `jeex-sky-hemisphere@1`, a world of uniform radiance
 *   `upper` above the horizon and `lower` below it, W/(m²·sr) per channel,
 *   split exactly at the horizon (no blend): for every normal it gives the
 *   irradiance of the live hemisphere light.
 * - `lamps`: point lamps of radius 0 at `position`; `intensity` in candela
 *   with inverse-square falloff and no cut-off distance, `power` the
 *   equivalent radiant power in watts, the lighting module's `blenderPower`
 *   of the intensity (4π × cd: a radiant power `P` spread over the sphere
 *   gives `P / (4π d²)` at distance `d`, three's light gives `I / d²`); `lamps[i].color` linear; `id` is the lamp's placement id and `index`
 *   the light's place among that placement's lights, so `(id, index)` is
 *   unique. A lamp is a light a placement declares (`render/lamp-lights.ts`);
 *   a bank builder's procedural bulb is not one and stays live.
 *
 * Axes: positions, the sun direction and the sky's up axis are in the shell
 * file's frame (glTF, +Y up); a consumer that converts the shell to another
 * frame (Blender's +Z up: `(x, y, z) -> (x, -z, y)`) converts these the same
 * way. Tolerances: the sun direction is unit to 1e-9; `power` equals
 * `blenderPower(intensity)` to 1e-9 relative (absolute below
 * 1 W).
 *
 * Into the sidecar (`light-bake.schema.ts`): its `sun` is this `sun`
 * verbatim, in the glTF frame (the unconverted value); its `sky` is `{ upper, lower }` of this `sky`; its `lights` is
 * `{ recipe, standardVersion, skyRecipe: sky.recipe }`; its `lamps` lists
 * the placement ids of the lamps whose light is in the bake (every lamp
 * here, unless one is kept live), each distinct id once. Baking or keeping
 * live is decided per placement: all lights of one placement together.
 *
 * Invariant: the schema JUDGES and never repairs; the value that passed flows
 * on unchanged.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { blenderPower } from '../lighting/lamp-units.js';
import { UUID_V7_PATTERN } from '../scene/types.js';

/** The recipe every field above belongs to; a bake records it. */
export const BAKE_LIGHTS_RECIPE = 'jeex-bake-lights@1';
/** The interim sky: two uniform hemispheres split at the horizon. */
export const BAKE_SKY_HEMISPHERE_RECIPE = 'jeex-sky-hemisphere@1';
const uuid = z.string().check(z.regex(UUID_V7_PATTERN, { error: 'not a UUID v7' }));
const finite = z.number().check(z.refine(Number.isFinite, { error: 'must be finite' }));
const nonNegative = finite.check(z.gte(0, { error: 'must not be negative' }));
const vec3 = z.readonly(z.tuple([finite, finite, finite]));
const colour = z.readonly(z.tuple([nonNegative, nonNegative, nonNegative]));
const unit = vec3.check(z.refine((v) => Math.abs(Math.hypot(...v) - 1) <= 1e-9, { error: 'must be a unit vector' }));

/** The lighting standard's appearance version the numbers were read from. */
export const standardVersionSchema = z.int({ error: 'must be an integer' }).check(z.gte(1, { error: 'must be at least 1' }));

const lampSchema = z
  .strictObject({
    id: uuid,
    index: z.int({ error: 'must be an integer' }).check(z.gte(0, { error: 'must not be negative' })),
    position: vec3,
    intensity: nonNegative,
    power: nonNegative,
    color: colour,
  })
  .check(
    z.refine((lamp) => Math.abs(lamp.power - blenderPower(lamp.intensity)) <= 1e-9 * Math.max(1, lamp.power), {
      path: ['power'],
      error: 'must be 4π times the intensity',
    }),
  );

/** The answer of `bakeLights`. */
export const bakeLightsSchema = z
  .strictObject({
    recipe: z.literal(BAKE_LIGHTS_RECIPE),
    standardVersion: standardVersionSchema,
    sun: z.strictObject({ direction: unit, color: colour, strength: nonNegative }),
    sky: z.strictObject({ recipe: z.literal(BAKE_SKY_HEMISPHERE_RECIPE), upper: colour, lower: colour }),
    lamps: z.readonly(z.array(lampSchema)),
  })
  .check(
    z.superRefine((lights, ctx) => {
      const seen = new Set<string>();
      for (const [i, lamp] of lights.lamps.entries()) {
        const key = `${lamp.id}#${String(lamp.index)}`;
        if (seen.has(key))
          ctx.addIssue({ code: 'custom', path: ['lamps', i], message: `light ${String(lamp.index)} of ${lamp.id} is listed twice` });
        seen.add(key);
      }
    }),
  );

export type BakeLights = z.infer<typeof bakeLightsSchema>;
export type BakeLamp = BakeLights['lamps'][number];

/** The judged answer, or the sentence that names what was refused. */
export type BakeLightsVerdict = { readonly ok: true; readonly value: BakeLights } | { readonly ok: false; readonly message: string };

/** Judges a bake-lights document. */
export function judgeBakeLights(input: unknown): BakeLightsVerdict {
  const result = z.safeParse(bakeLightsSchema, input);
  // The value that passed flows on, never `result.data`: the schema judges and never repairs.
  if (result.success) return { ok: true, value: input as BakeLights };
  const issues = result.error.issues.slice(0, 8).map((issue) => {
    const keys = issue.code === 'unrecognized_keys' ? issue.keys : [];
    const where = [...issue.path.map(String), ...keys].join('.') || 'lights';
    return `${where}: ${issue.message}`;
  });
  return { ok: false, message: `bake lights refused: ${issues.join('; ')}` };
}
