/**
 * One committed placement, brought on screen by the least work that is true to
 * it, so turning ONE object does not redraw ALL objects.
 * `ViewerEditor.applyRevision` routes every touched `asset` here.
 *
 * Gone from the document: its group leaves. New: its body is built. The same
 * body (`sameBody`: archetype, variant, finishes) standing elsewhere — a move,
 * a turn, a mirror, a new scale or room — is stood anew and keeps its meshes,
 * its materials and its loaded model. Anything else is a body of its own,
 * built with the swap tween. No other placement is looked at.
 */

import * as THREE from 'three';
import { sameBody } from '../scene/scene-diff.js';
import type { DemoAsset, SceneData } from '../scene/types.js';
import type { SceneBuilder } from '../geometry/scene-builder.js';
import type { Picker } from '../geometry/picker.js';
import type { FurnitureAnimator } from '../geometry/furniture-animator.js';

export type PlacementFollowDeps = {
  /** The group that is each placement's body now (the editor's registry). */
  bodies: Map<string, THREE.Group>;
  /** Each placement as its body was last built or stood for it: what a commit is compared against. */
  shown: Map<string, DemoAsset>;
  /** The furniture container of the root on screen. */
  container: () => THREE.Group | null;
  builder: Pick<SceneBuilder, 'buildFurnitureVariant' | 'poseFurniture'>;
  picker: Pick<Picker, 'registerFurniture' | 'unregister'>;
  animator: Pick<FurnitureAnimator, 'moved' | 'removed' | 'register'>;
  /** A placement is leaving: whatever the editor shows for it (aura, panel) goes first. */
  release: (assetId: string) => void;
  /** Builds the placement's body anew with the swap tween (`ViewerEditor.swapFurniture`). */
  swap: (assetId: string, variantId: string | undefined) => void;
};

/**
 * The placement id a furniture group answers to: `userData.assetId` is the
 * contract (`geometry/asset-loader.ts` writes it), the group's name the
 * fallback for a group nobody tagged.
 *
 * One function rather than the expression twice: `adoptPlacements` and
 * `ViewerEditor.adoptUpgradedBody` key the SAME registry, and a registry keyed
 * two ways is a registry that misses.
 */
export function assetIdOf(group: THREE.Object3D): string {
  return typeof group.userData['assetId'] === 'string' ? group.userData['assetId'] : group.name;
}

/** A freshly built root: both registries start again from its furniture container and the document. */
export function adoptPlacements(deps: PlacementFollowDeps, assets: readonly DemoAsset[]): void {
  deps.bodies.clear();
  deps.shown.clear();
  for (const placement of assets) deps.shown.set(placement.id, placement);
  for (const child of deps.container()?.children ?? []) {
    if (!(child instanceof THREE.Group)) continue;
    const assetId = assetIdOf(child);
    deps.bodies.set(assetId, child);
    deps.picker.registerFurniture(child, assetId);
  }
}

export function followPlacement(deps: PlacementFollowDeps, scene: SceneData, assetId: string): void {
  const placement = scene.assets.find((asset) => asset.id === assetId);
  const shown = deps.shown.get(assetId);
  const group = deps.bodies.get(assetId);
  if (!placement) {
    removePlacement(deps, assetId);
    return;
  }
  deps.shown.set(assetId, placement);
  if (!group) {
    addPlacement(deps, placement);
    return;
  }
  if (shown && sameBody(shown, placement) && deps.animator.moved(group, () => deps.builder.poseFurniture(group, placement))) return;
  deps.swap(assetId, placement.variant);
}

/** A placement the document no longer carries: its group leaves the graph and every registry. */
function removePlacement(deps: PlacementFollowDeps, assetId: string): void {
  deps.shown.delete(assetId);
  const group = deps.bodies.get(assetId);
  if (!group) return;
  deps.release(assetId);
  deps.bodies.delete(assetId);
  deps.picker.unregister(group);
  deps.animator.removed(group);
  group.removeFromParent();
}

/** A placement new to the document: its body is built and registered like one of the first build's. */
function addPlacement(deps: PlacementFollowDeps, placement: DemoAsset): void {
  const container = deps.container();
  const group = container ? deps.builder.buildFurnitureVariant(placement) : null;
  if (!container || !group) return;
  container.add(group);
  deps.bodies.set(placement.id, group);
  deps.picker.registerFurniture(group, placement.id);
  deps.animator.register(group);
}
