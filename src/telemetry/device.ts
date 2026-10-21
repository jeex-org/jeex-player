/**
 * The GPU class: `low`, `mid` or `high`, read from what the WebGL context
 * SUPPORTS, never from the renderer string and never from a benchmark.
 *
 * It is a capability class, not a performance ranking: a start-up timing
 * would measure the refresh rate, the CPU, the scene and the throttling as
 * much as the GPU. Three coarse classes over three capabilities carry far
 * less than the renderer string they replace.
 *
 * Pure module: no `three`, no DOM (the context is handed in).
 */

import type { GpuClass } from './vocabulary.js';

/** The part of a WebGL context this module reads; WebGL constants are passed by value. */
export type GpuProbe = {
  getParameter(name: number): unknown;
  getExtension(name: string): unknown;
};

const MAX_TEXTURE_SIZE = 0x0d33;
const MAX_SAMPLES = 0x8d57;

/** `MAX_TEXTURE_SIZE` below this is a `low` device, in texels. */
export const LOW_TEXTURE_SIZE = 8192;
/** `MAX_TEXTURE_SIZE` at least this, with MSAA and float colour buffers, is `high`, in texels. */
export const HIGH_TEXTURE_SIZE = 16_384;
/** MSAA samples a `high` device supports at least. */
export const HIGH_SAMPLES = 4;

/** The class of the context; `none` without one. `webgl2` says whether it is a WebGL 2 context. */
export function gpuClass(gl: GpuProbe | null, webgl2: boolean): GpuClass {
  if (gl === null) return 'none';
  const textureSize = Number(gl.getParameter(MAX_TEXTURE_SIZE));
  if (!webgl2 || !Number.isFinite(textureSize) || textureSize < LOW_TEXTURE_SIZE) return 'low';
  const samples = Number(gl.getParameter(MAX_SAMPLES));
  const floatColour = gl.getExtension('EXT_color_buffer_float') !== null;
  return textureSize >= HIGH_TEXTURE_SIZE && samples >= HIGH_SAMPLES && floatColour ? 'high' : 'mid';
}
