/**
 * Which host sky (`lighting.hdri`) the scene on screen asks for, and how it
 * stands: the active preset from the scene's site, the entry for it, the
 * rotation and sun it needs, and what a light bake allows.
 *
 * Rules: a scene without a `site` has no sun preset and shows no sky; a site
 * without a `sun` is `noon`; a preset without an entry shows none and never
 * borrows another's. A light bake still pending (`waiting`, `loading`) holds
 * the lighting back (only the sky may load), an applied one allows the sky
 * alone, anything else lights in full.
 *
 * Pure module: no `three`, no DOM.
 */

import { hdriRotationY } from '../lighting/hdri-calibration.js';
import { LIGHTING_STANDARD } from '../lighting/lighting-standard.js';
import type { LightBakeState } from '../lightmap/light-bake-wiring.js';
import type { HdriView } from '../render/hdri/hdri-sky.js';
import type { SceneSite, SiteSun } from '../scene/types.js';
import type { HdriEntry } from '../lighting/hdri-entry.js';

/** `full`: environment, sun and sky; `sky-only`: the sky over a bake's daylight; `hold`: the sky may load, nothing shows. */
export type HdriMode = 'full' | 'sky-only' | 'hold';

/** What the scene asks the walk lighting to show. */
export type HdriTarget = {
  readonly preset: SiteSun;
  /** The host's entry; the same object while the option and the preset stay. */
  readonly entry: HdriEntry;
  readonly view: HdriView;
  readonly mode: HdriMode;
};

/** The target for `hdri` under `site` with the bake in `bake`; `null` when there is nothing to show. */
export function hdriTarget(
  hdri: Partial<Record<SiteSun, HdriEntry>>,
  site: SceneSite | undefined,
  bake: LightBakeState['state'],
): HdriTarget | null {
  if (site === undefined) return null;
  const preset = site.sun ?? 'noon';
  const entry = Object.hasOwn(hdri, preset) ? hdri[preset] : undefined;
  if (entry === undefined) return null;
  const presetAzimuth = LIGHTING_STANDARD.apartment.sun.presets[preset].azimuth;
  const view: HdriView = {
    rotationY: hdriRotationY(site.northDeg ?? 0, presetAzimuth, entry.sun.azimuthDeg),
    elevationDeg: entry.sun.elevationDeg,
    colourLinear: entry.sun.colourLinear,
  };
  const mode: HdriMode = bake === 'applied' ? 'sky-only' : bake === 'waiting' || bake === 'loading' ? 'hold' : 'full';
  return { preset, entry, view, mode };
}
