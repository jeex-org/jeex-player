/**
 * The lamp lights of a built scene, as plain data for the lightmap bake.
 *
 * Only lights built from a variant's `lights` fact are collected (the tag
 * `assets/artificial-light.ts` names), never a bank builder's bulb nor any
 * other light. Each entry is in world space and carries the AUTHORED linear
 * colour from the artificial-light tag, not the live colour a light
 * temperature tinted, and the candela of the one shared conversion
 * (`lighting/lamp-units.ts`).
 *
 * No DOM, no renderer: it reads a three.js graph and nothing else.
 */

import * as THREE from 'three';
import { artificialColour, lampLightTag } from '../assets/artificial-light.js';
import { lampCandela } from '../lighting/lamp-units.js';

/** One fact light of a scene, as the bake reads it. */
export type CollectedLampLight = {
  /** The placement the light belongs to: the nearest `userData.assetId` above it. */
  readonly placementId: string;
  /** Its index in the variant's `lights`. */
  readonly index: number;
  /** World position, metres. */
  readonly position: readonly [number, number, number];
  /** The authored colour, linear RGB in the working colour space; never tinted. */
  readonly colour: readonly [number, number, number];
  /** Nominal lumens, as authored. */
  readonly lumens: number;
  /** Candela, `lampCandela(lumens)`. */
  readonly intensity: number;
  readonly decay: 2;
  /** Metres where the light reaches zero, as authored. */
  readonly cutoff: number;
  /** The shadow hint, false when the fact had none. */
  readonly shadow: boolean;
};

/** The placement id above `object`, or `null` outside every placement. */
function placementOf(object: THREE.Object3D): string | null {
  for (let at: THREE.Object3D | null = object; at !== null; at = at.parent) {
    const id: unknown = at.userData['assetId'];
    if (typeof id === 'string') return id;
  }
  return null;
}

/**
 * Every fact light under `root`, placements in traversal order, then by
 * `index` within a placement.
 */
export function collectLampLights(root: THREE.Object3D): CollectedLampLight[] {
  root.updateMatrixWorld(true);
  const order = new Map<string, number>();
  const entries: CollectedLampLight[] = [];
  const world = new THREE.Vector3();
  root.traverse((object) => {
    const tag = lampLightTag(object);
    const colour = tag === null ? null : artificialColour(object);
    if (tag === null || colour === null) return;
    const placementId = placementOf(object) ?? tag.placementId;
    if (!order.has(placementId)) order.set(placementId, order.size);
    object.getWorldPosition(world);
    entries.push({
      placementId,
      index: tag.index,
      position: [world.x, world.y, world.z],
      colour: [colour[0], colour[1], colour[2]],
      lumens: tag.lumens,
      intensity: lampCandela(tag.lumens),
      decay: 2,
      cutoff: tag.cutoff,
      shadow: tag.shadow,
    });
  });
  return entries.sort((a, b) => order.get(a.placementId)! - order.get(b.placementId)! || a.index - b.index);
}
