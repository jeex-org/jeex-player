/**
 * Diagnostic switches, read from a global the host page sets before it mounts:
 *
 *   globalThis.__JEEX_DEBUG_FLAGS__ = { noTransmission: true, noArm: true };
 *
 * Internal and unsupported (README, «Debug switches (internal)»): not a viewer
 * option, not exported, and free to disappear. They exist to bisect rendering
 * faults on a real device without a rebuild.
 *
 * - `noTransmission`: every material keeps `transmission` at 0, so three.js
 *   runs no transmission pass.
 * - `noArm`: a library material's packed ARM map is not attached; its
 *   roughness and occlusion scalars stay as they are.
 *
 * Read when a material is made. An absent or malformed global is all-off.
 */

import { debugFlagsSchema } from './debug-flags.schema.js';

/** The switches, every one `false` unless the page asked for it. */
export type DebugFlags = { readonly noTransmission: boolean; readonly noArm: boolean };

const OFF: DebugFlags = { noTransmission: false, noArm: false };

/** The switches in `source`, by default the page's `__JEEX_DEBUG_FLAGS__`; all off when it is absent or not of that shape. */
export function debugFlags(source: unknown = (globalThis as { __JEEX_DEBUG_FLAGS__?: unknown }).__JEEX_DEBUG_FLAGS__): DebugFlags {
  if (source === undefined) return OFF;
  const parsed = debugFlagsSchema.safeParse(source);
  if (!parsed.success) return OFF;
  return { noTransmission: parsed.data.noTransmission === true, noArm: parsed.data.noArm === true };
}
