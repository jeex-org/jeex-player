/**
 * The shape of the page's `__JEEX_DEBUG_FLAGS__` global (`debug-flags.ts`): two
 * optional booleans; unknown keys are ignored.
 */

import { z } from 'zod/mini';

export const debugFlagsSchema = z.object({
  noTransmission: z.optional(z.boolean()),
  noArm: z.optional(z.boolean()),
});
