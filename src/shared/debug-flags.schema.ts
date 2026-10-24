/**
 * The shape of the page's `__JEEX_DEBUG_FLAGS__` global (`debug-flags.ts`): two
 * optional booleans; unknown keys are ignored.
 */

import { z } from 'zod/mini';

export const debugFlagsSchema = z.object({
  noTransmission: z.optional(z.boolean()),
  noArm: z.optional(z.boolean()),
});

/** The page's `__JEEX_DEBUG_LIGHT_BAKE__` global: the sidecar and shell file of one light bake, as URLs. */
export const debugLightBakeSchema = z.object({
  sidecar: z.string().check(z.minLength(1)),
  shell: z.string().check(z.minLength(1)),
});

/** Zod 4 numbers are finite: NaN and the infinities are refused. */
const point = z.tuple([z.number(), z.number(), z.number()]);

/** The page's `__JEEX_DEBUG_CAMERA__` global: a camera pose in metres, scene frame, Y up. */
export const debugCameraSchema = z.object({
  mode: z.enum(['walk', 'orbit']),
  position: point,
  target: point,
});
