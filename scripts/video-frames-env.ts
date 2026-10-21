/**
 * The environment `scripts/video-frames.ts` is driven by, as one Zod schema:
 * every parameter of the tool is a variable, and a typo in one fails before a
 * browser starts, naming the variable, instead of asking the viewer for
 * `NaN` frames.
 *
 * Kept apart from the tool so it can be tested without launching it.
 */

import { z } from 'zod';
import type { Aspect } from '../src/app/video-frames.js';

/** The smoke check's own frame count when `FRAMES_TO` is not given. */
export const DEFAULT_FRAME_COUNT = 12;

const ASPECT_VALUES = ['16:9', '9:16', '1:1'] as const satisfies readonly Aspect[];

const seconds = z.coerce.number().nonnegative();

const framesEnvSchema = z.object({
  FRAMES_FPS: z.optional(z.coerce.number().pipe(z.union([z.literal(24), z.literal(25), z.literal(30)]))),
  FRAMES_HEIGHT: z.optional(z.coerce.number().int().positive()),
  FRAMES_FROM: z.optional(seconds),
  FRAMES_TO: z.optional(seconds),
  FRAMES_ASPECTS: z.optional(
    z
      .string()
      .transform((raw) => raw.split(',').map((value) => value.trim()))
      .pipe(z.array(z.enum(ASPECT_VALUES)).min(1)),
  ),
  FRAMES_OUT: z.optional(z.string().min(1)),
});

/** What one run of the tool asks for. */
export type FramesEnv = {
  readonly fps: 24 | 25 | 30;
  readonly height: number;
  readonly from: number;
  readonly to: number;
  readonly aspects: readonly Aspect[];
  readonly out: string;
};

/**
 * Reads the run's parameters off `env`, with the smoke check's defaults
 * (12 frames of `9:16` and `16:9` at 24 fps, 320 px high); throws naming every
 * variable that is not what it must be.
 */
export function readFramesEnv(env: Readonly<Record<string, string | undefined>>): FramesEnv {
  const result = framesEnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`video-frames: bad environment | ${problems.join('; ')}`);
  }
  const values = result.data;
  const fps = values.FRAMES_FPS ?? 24;
  const from = values.FRAMES_FROM ?? 0;
  return {
    fps,
    height: values.FRAMES_HEIGHT ?? 320,
    from,
    to: values.FRAMES_TO ?? from + (DEFAULT_FRAME_COUNT - 1) / fps,
    aspects: values.FRAMES_ASPECTS ?? ['9:16', '16:9'],
    out: values.FRAMES_OUT ?? '/tmp/jeex-video-frames',
  };
}
