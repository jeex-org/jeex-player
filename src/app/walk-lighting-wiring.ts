/**
 * Ties the walk lighting controller to the document on screen: which
 * document it lights, and which edits it refreshes after.
 *
 * Invariant: a plan-level commit is not an edit here. It ends in a rebuild and
 * a new `setDocument`, which loads the lighting afresh; every other commit is
 * turned into a refresh scope (`walk-lighting-scope.ts`).
 */

import * as THREE from 'three';
import type { SceneModel } from '../scene/scene-model.js';
import type { WalkDocument } from '../render/walk-lighting/walk-lighting.js';
import type { Rect, VolumeInput } from '../render/walk-lighting/room-volumes.js';
import { doorSwings } from '../plan/door-swing.js';
import { openingFrameWidth } from '../assets/opening-frame.js';
import { FURNITURE_GROUP_NAME } from '../geometry/scene-builder.js';
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

/** The rooms, the doors and the furniture footprints of `model` built under `root`, as the volumes read them. */
function volumeInput(model: SceneModel, root: THREE.Object3D): VolumeInput {
  const { plan, scene } = model;
  const thickness = new Map(plan.centrelines.map((line) => [line.wallId, line.thickness]));
  const rooms = plan.rooms.map((room) => ({
    roomId: room.roomId,
    polygon: room.polygon,
    halfWall: Math.max(0, ...room.loop.map((face) => (thickness.get(face.wallId) ?? 0) / 2)),
  }));
  const roomsOfWall = new Map<string, string[]>();
  for (const face of plan.faces.values()) {
    if (face.roomId !== null) roomsOfWall.set(face.wallId, [...(roomsOfWall.get(face.wallId) ?? []), face.roomId]);
  }
  // The room a door leaf swings into is listed first: a frame on the centreline belongs to it.
  const doors = doorSwings(scene, plan, openingFrameWidth).flatMap((swing) => {
    if (swing.roomId === null) return [];
    const other = (roomsOfWall.get(swing.wallId) ?? []).find((room) => room !== swing.roomId) ?? null;
    return [{ into: swing.roomId, other }];
  });
  const furniture: Rect[] = [];
  const box = new THREE.Box3();
  for (const item of root.getObjectByName(FURNITURE_GROUP_NAME)?.children ?? []) {
    box.setFromObject(item);
    if (!box.isEmpty()) furniture.push({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
  }
  return { rooms, ceilingHeight: scene.ceilingHeight, doors, furniture };
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
      return built ? { volumes: volumeInput(model, built), furniture: built.getObjectByName(FURNITURE_GROUP_NAME) ?? null } : null;
    },
    off,
  };
}
