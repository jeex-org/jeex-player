/**
 * The lamp lights of a built scene: every light a placement's `lights` fact
 * declares, in world space, in the units the live view draws it with. It is
 * the one seam through which a light bake reads lamps.
 *
 * Stub: no object carries a `lights` fact yet, so no scene has such lamps and
 * the collector answers none. The bank builders' procedural bulbs are not
 * lamp lights and are never read here: they stay live on a baked shell. The
 * lighting work that introduces the fact replaces this body.
 *
 * Order contract: placements in scene order, then `index` within a
 * placement.
 */

import type * as THREE from 'three';

/** One declared light of one placement, in world space. */
export type CollectedLampLight = {
  /** The placement the light belongs to (UUID v7, from the scene). */
  readonly placementId: string;
  /** The light's position in its placement's `lights` list. */
  readonly index: number;
  /** The bulb, world metres. */
  readonly position: readonly [number, number, number];
  /** Linear colour as authored («Original»), never tinted by a colour temperature. */
  readonly colour: readonly [number, number, number];
  readonly lumens: number;
  /** three.js candela, converted from `lumens`. */
  readonly intensity: number;
  readonly decay: 2;
  /** The live light's cut-off distance, metres. */
  readonly cutoff: number;
  readonly shadow: boolean;
};

/** The lamp lights of `root`, a built scene, in the order contract above. */
export function collectLampLights(_root: THREE.Object3D): CollectedLampLight[] {
  return [];
}
