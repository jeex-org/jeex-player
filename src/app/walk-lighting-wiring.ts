/**
 * Ties the walk lighting controller to the document on screen: which
 * document it lights, and which edits it refreshes after.
 *
 * Invariant: a plan-level commit is not an edit here. It ends in a rebuild and
 * a new `setDocument`, which loads the lighting afresh; every other commit is
 * turned into a refresh scope (`walk-lighting-scope.ts`).
 */

import type * as THREE from 'three';
import type { SceneModel } from '../scene/scene-model.js';
import type { WalkDocument } from '../render/walk-lighting/walk-lighting.js';
import type { WalkLightingController } from './walk-lighting-controller.js';
import { refreshScope, type ScopeLookups } from './walk-lighting-scope.js';
import { pointInPolygon } from '../plan/plan-geometry.js';

/** The document reads a refresh scope needs, over the committed model. */
function lookupsOf(model: SceneModel): ScopeLookups {
  return {
    assetRoom: (id) => {
      const asset = model.scene.assets.find((item) => item.id === id);
      if (!asset) return null;
      if (asset.room !== undefined) return asset.room;
      const at = { x: asset.position.x, z: asset.position.z };
      return model.plan.rooms.find((room) => pointInPolygon(at, room.polygon))?.roomId ?? null;
    },
    openingRooms: (id) => {
      const wall = model.scene.walls.find((item) => (item.openings ?? []).some((opening) => opening.id === id));
      if (!wall) return [];
      const rooms = new Set<string>();
      for (const face of model.plan.faces.values()) if (face.wallId === wall.id && face.roomId !== null) rooms.add(face.roomId);
      return [...rooms];
    },
  };
}

/**
 * Hands `controller` the document of `model` built under `root`, and every
 * later non-plan commit of it as an edit; answers the unsubscribe.
 */
export function wireWalkLighting(
  controller: WalkLightingController,
  model: SceneModel,
  root: () => THREE.Object3D | undefined,
): {
  document: () => WalkDocument | null;
  off: () => void;
} {
  controller.documentChanged();
  const off = model.onRevision((_rev, touched) => {
    if (touched.some((entity) => entity.kind === 'shell')) return;
    const scope = refreshScope(touched, lookupsOf(model));
    if (scope) controller.edited(scope);
  });
  return {
    document: () => {
      const built = root();
      return built ? { plan: model.plan, scene: model.scene, root: built } : null;
    },
    off,
  };
}
