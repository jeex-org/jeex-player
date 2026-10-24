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
 *
 * Two more globals of the same kind serve a page that compares an apartment
 * with and without its offline light bake:
 *
 *   globalThis.__JEEX_DEBUG_LIGHT_BAKE__ = { sidecar: 'bake/sidecar.json', shell: 'bake/shell.glb' };
 *   globalThis.__JEEX_DEBUG_CAMERA__ = { mode: 'walk', position: [x, y, z], target: [x, y, z] };
 *
 * The first names one light bake (URLs, resolved against the page), which
 * every mount of a document then tries to apply (`lightmap/light-bake-wiring.ts`);
 * the second is the camera pose the viewer opens in (`app/viewer-boot.ts`), so
 * two pages can show the identical view. Absent or malformed means off.
 */

import { debugCameraSchema, debugFlagsSchema, debugLightBakeSchema } from './debug-flags.schema.js';

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

/** The light bake a page names: its sidecar and its shell file. */
export type DebugLightBake = { readonly sidecarUrl: URL; readonly shellUrl: URL };

type DebugGlobals = { __JEEX_DEBUG_LIGHT_BAKE__?: unknown; __JEEX_DEBUG_CAMERA__?: unknown };

/** The page's base URL, when there is a page. */
const pageUrl = (): string | undefined => (typeof location === 'undefined' ? undefined : location.href);

/**
 * The bake in `source`, by default the page's `__JEEX_DEBUG_LIGHT_BAKE__`, with
 * both URLs resolved against `base` (the page); `null` when it is absent, not
 * of that shape, or a URL does not resolve.
 */
export function debugLightBake(
  source: unknown = (globalThis as DebugGlobals).__JEEX_DEBUG_LIGHT_BAKE__,
  base: string | undefined = pageUrl(),
): DebugLightBake | null {
  if (source === undefined) return null;
  const parsed = debugLightBakeSchema.safeParse(source);
  if (!parsed.success) return null;
  try {
    return { sidecarUrl: new URL(parsed.data.sidecar, base), shellUrl: new URL(parsed.data.shell, base) };
  } catch {
    return null;
  }
}

/** A camera pose a page asks the viewer to open in. */
export type DebugCamera = {
  readonly mode: 'walk' | 'orbit';
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
};

/** The pose in `source`, by default the page's `__JEEX_DEBUG_CAMERA__`; `null` when absent, malformed or looking nowhere. */
export function debugCamera(source: unknown = (globalThis as DebugGlobals).__JEEX_DEBUG_CAMERA__): DebugCamera | null {
  if (source === undefined) return null;
  const parsed = debugCameraSchema.safeParse(source);
  if (!parsed.success) return null;
  const { mode, position, target } = parsed.data;
  if (position.every((value, i) => value === target[i])) return null;
  return { mode, position: [...position], target: [...target] };
}
