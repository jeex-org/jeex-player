/**
 * What changed between two committed documents, in the vocabulary a commit
 * already speaks: the touched entities (`scene/ops/context.ts`).
 *
 * A host that keeps its own document (an editor host) hands the viewer the whole
 * NEXT document after every edit it committed, through `loadScene`. Treated
 * as a new scene, one turned sofa rebuilt every placement and downloaded every
 * model again. `SceneModel.replaceDocument` commits
 * the next document as a revision instead, and this module is how that
 * revision says what it touched, so the same consumers that follow an
 * operation (`SceneBuilder.applyRevision`, `ViewerEditor.applyRevision`)
 * follow a document diff without knowing the difference.
 *
 * Precision where it pays, safety everywhere else: a placement is diffed by
 * id, the camera-, tour- and route-only parts name their own entity, a change
 * that draws nothing (the name, the interior presets) names nothing, and
 * every other part of the document — walls, rooms, openings, finishes,
 * materials, and any key this file does not know — is `shell`, the plan-level
 * rebuild a structural operation takes. A diff can therefore be coarse, never
 * wrong.
 *
 * Pure module: no `three`, no DOM.
 */

import type { DemoAsset, SceneData } from './types.js';
import {
  TOUCHED_AUTOTOUR,
  TOUCHED_NAVIGATION,
  TOUCHED_SHELL,
  TOUCHED_TOUR_CHECKPOINTS,
  touchedAsset,
  touchedCamera,
  type TouchedEntity,
} from './ops/context.js';

/** Plain-data equality: what two validated documents (JSON trees) compare by. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameData(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return keys.length === otherKeys.length && keys.every((key) => sameData(left[key], right[key]));
}

/**
 * The fields that decide what a placement's BODY is: the archetype, the
 * variant and the finishes. Everything else — position, yaw, scale, mirror,
 * room, collision — is where and how that body stands, and is applied to the
 * body already on screen (`ViewerEditor`), never by building it again.
 */
const BODY_FIELDS = ['type', 'asset', 'variant', 'finishes', 'material'] as const satisfies ReadonlyArray<keyof DemoAsset>;

/** True when `a` and `b` draw the same body, wherever each of them stands. */
export function sameBody(a: DemoAsset, b: DemoAsset): boolean {
  return BODY_FIELDS.every((field) => sameData(a[field], b[field]));
}

/** Document keys whose change touches an entity of its own (or nothing at all), never the plan. */
const OWN_ENTITY: Partial<Record<keyof SceneData, (prev: SceneData, next: SceneData) => TouchedEntity[]>> = {
  assets: (prev, next) => diffAssets(prev.assets, next.assets),
  name: () => [],
  interiors: () => [],
  navigation: () => [TOUCHED_NAVIGATION],
  autotour: () => [TOUCHED_AUTOTOUR],
  tourCheckpoints: () => [TOUCHED_TOUR_CHECKPOINTS],
  presentationCamera: () => [touchedCamera('presentation')],
  walkSpawn: () => [touchedCamera('walkSpawn')],
  roomCameras: (prev, next) => {
    const rooms = new Set([...Object.keys(prev.roomCameras), ...Object.keys(next.roomCameras)]);
    return [...rooms].filter((room) => !sameData(prev.roomCameras[room], next.roomCameras[room])).map((room) => touchedCamera({ room }));
  },
};

/** One `asset` entity per placement that was added, removed or changed in any way, in document order. */
function diffAssets(prev: readonly DemoAsset[], next: readonly DemoAsset[]): TouchedEntity[] {
  const before = new Map(prev.map((asset) => [asset.id, asset]));
  const touched: TouchedEntity[] = [];
  for (const asset of next) {
    const old = before.get(asset.id);
    before.delete(asset.id);
    if (!old || !sameData(old, asset)) touched.push(touchedAsset(asset.id));
  }
  for (const id of before.keys()) touched.push(touchedAsset(id));
  return touched;
}

/**
 * The touched entities that turn `prev` into `next`; empty when the two are
 * the same document. `shell` appears at most once, and alone it already means
 * the whole plan is rebuilt.
 */
export function diffScenes(prev: SceneData, next: SceneData): TouchedEntity[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)] as Array<keyof SceneData>);
  const touched: TouchedEntity[] = [];
  let shell = false;
  for (const key of keys) {
    if (sameData(prev[key], next[key])) continue;
    const own = OWN_ENTITY[key];
    if (own) touched.push(...own(prev, next));
    else shell = true;
  }
  return shell ? [TOUCHED_SHELL, ...touched] : touched;
}
