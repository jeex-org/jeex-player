/**
 * Turns a built scene root into a graph an exporter can hand straight to
 * `GLTFExporter`/`USDZExporter`: JSON-safe `userData`, an `EXT_mesh_features`
 * pointer into the element metadata table on every mesh a row names, and none
 * of the raycast-only helpers a live viewer needs but an export does not.
 *
 * Invariant: THE CALLER DISPOSES NOTHING. `THREE.Mesh.copy` shares `geometry`
 * and `material` by reference (three's own contract, `Object3D.js`), and this
 * module clones NODES, never buffers — so the returned graph can be handed to
 * an exporter and dropped without a single `dispose()` call, and the live
 * graph it was built from is untouched.
 *
 * Why a hand-rolled recursive clone instead of `root.clone(true)`: three's own
 * `Object3D.copy()` already runs `this.userData = JSON.parse(JSON.stringify(source.userData))`
 * at EVERY node, recursive or not (`node_modules/three/src/core/Object3D.js`).
 * That drops `resolveRoomId`/`resolveFace` (`geometry/shell-builder.ts`)
 * before this module ever sees the clone — the VALUE those functions would
 * have returned is gone, not just the function. So each node is cloned one at
 * a time here, and the resolvers are called on the ORIGINAL immediately
 * before its userData is thrown away, their answers written onto the new
 * node's (already JSON-safe) `userData` alongside it.
 */

import * as THREE from 'three';
import type { ElementRow } from '../scene/metadata-table.js';
import { FaceMap, faceKey, isFaceKey } from '../scene/types.js';

/**
 * A raycast-only helper mesh (`geometry/opening-builder.ts`'s pick proxies):
 * fully transparent, never meant to be seen, and not something an exported
 * asset should carry. Nothing else in the built scene is both `transparent`
 * and `opacity === 0`.
 */
function isPickProxy(object: THREE.Object3D): boolean {
  if (!(object instanceof THREE.Mesh)) return false;
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  return material instanceof THREE.Material && material.transparent && material.opacity === 0;
}

type RowIndex = {
  readonly byFace: FaceMap<number>;
  readonly byOpeningId: ReadonlyMap<string, number>;
  readonly byAssetId: ReadonlyMap<string, number>;
};

function rowIndexFor(userData: Record<string, unknown>, index: RowIndex): number | undefined {
  const surface = userData['surface'];
  if (surface === 'wall') {
    const face = userData['face'];
    if (isFaceKey(face)) return index.byFace.get(face);
  } else if (surface === 'opening') {
    const openingId = userData['openingId'];
    if (typeof openingId === 'string') return index.byOpeningId.get(openingId);
  }
  // Furniture bodies carry `assetId` on the placement's own group whether or
  // not a picker has tagged them `surface: 'furniture'` (`asset-loader.ts`
  // tags the group; `picker.ts` tags its meshes only once a live viewer
  // registers it) — checked unconditionally so an export built with no
  // picker at all still gets the row.
  const assetId = userData['assetId'];
  if (typeof assetId === 'string') return index.byAssetId.get(assetId);
  return undefined;
}

/** `{ featureIds: [{ constant: rowIndex }] }` — one constant feature id per node, no attribute or texture needed. */
function meshFeaturesExtension(rowIndex: number): Record<string, unknown> {
  return { EXT_mesh_features: { featureIds: [{ featureCount: 1, propertyTable: 0, nullFeatureId: -1, constant: rowIndex }] } };
}

/** One node: cloned, sanitised, tagged — children handled by the caller. */
function cloneNode(source: THREE.Object3D, index: RowIndex): THREE.Object3D {
  // `false`: this call clones ONE node; children are added by the caller so
  // each of them goes through this same filtering and tagging pass.
  const clone = source.clone(false);
  const original = source.userData as Record<string, unknown>;
  const userData = clone.userData as Record<string, unknown>;

  if (userData['roomId'] === undefined) {
    const resolveRoomId = original['resolveRoomId'];
    if (typeof resolveRoomId === 'function') {
      const value = (resolveRoomId as () => string | null)();
      if (typeof value === 'string') userData['roomId'] = value;
    }
  }
  if (userData['face'] === undefined) {
    const resolveFace = original['resolveFace'];
    if (typeof resolveFace === 'function') {
      const value: unknown = (resolveFace as () => unknown)();
      if (isFaceKey(value)) userData['face'] = { ...value };
    }
  }

  // The dollhouse hides the ceiling for a camera above it; an exported asset
  // is not looked at from any particular angle, so the ceiling this shell
  // builds `visible = false` by default is forced back on here.
  if (userData['isCeiling'] === true) clone.visible = true;

  const rowIndex = rowIndexFor(userData, index);
  if (rowIndex !== undefined) userData['gltfExtensions'] = meshFeaturesExtension(rowIndex);

  return clone;
}

/**
 * A caster that exists only for the sun's shadow (`geometry/ceiling-casters.ts`):
 * on the shadow-only layer, never drawn, and not part of the flat. An export
 * builds its own root and never meets one; a graph that does carry one (a
 * live root handed in) still leaves it out.
 */
function isShadowOnly(object: THREE.Object3D): boolean {
  return object.userData['shadowOnly'] === true;
}

/** Recursively clones `source`, dropping pick-proxy helpers and shadow-only casters, and tagging every node a row names. */
function cloneTree(source: THREE.Object3D, index: RowIndex): THREE.Object3D {
  const clone = cloneNode(source, index);
  for (const child of source.children) {
    if (isPickProxy(child) || isShadowOnly(child)) continue;
    clone.add(cloneTree(child, index));
  }
  return clone;
}

/**
 * A deep clone of `root`, ready for `GLTFExporter`/`USDZExporter`: JSON-safe
 * `userData`, `userData.gltfExtensions.EXT_mesh_features` on every mesh a row
 * in `rows` names (picked up by `GLTFExporter`'s own `includeCustomExtensions`
 * handling), pick-proxy helpers removed, the ceiling shown regardless of the
 * live dollhouse state. The caller disposes nothing: every geometry and
 * material in the returned graph is the SAME instance the live graph holds.
 */
export function exportGraph(root: THREE.Object3D, rows: readonly ElementRow[]): THREE.Object3D {
  const byFace = new FaceMap<number>();
  const byOpeningId = new Map<string, number>();
  const byAssetId = new Map<string, number>();
  rows.forEach((row, rowIndex) => {
    // A face row has no id; it is addressed by its wall, side and room.
    if (row.class === 'wallFace') {
      byFace.set(faceKey(row.roomId ?? null, row.wallId, row.side), rowIndex);
    } else if (row.class === 'opening') byOpeningId.set(row.id, rowIndex);
    else if (row.class === 'furniture') byAssetId.set(row.id, rowIndex);
  });
  return cloneTree(root, { byFace, byOpeningId, byAssetId });
}
