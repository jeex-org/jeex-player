/**
 * Turns a built scene root into a graph an exporter can hand straight to
 * `GLTFExporter`/`USDZExporter`: JSON-safe `userData`, none of the
 * raycast-only helpers a live viewer needs but an export does not, and (from
 * `exportGraphWithRows`) which cloned mesh belongs to which row of the element
 * metadata table. The graph itself carries no glTF extension: feature ids
 * belong on mesh primitives, and the GLB export (`app/export-gltf.ts`) writes
 * them there from that map.
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
  readonly byRoomId: ReadonlyMap<string, number>;
  readonly byOpeningId: ReadonlyMap<string, number>;
  readonly byAssetId: ReadonlyMap<string, number>;
};

function rowIndexFor(userData: Record<string, unknown>, index: RowIndex): number | undefined {
  const surface = userData['surface'];
  if (surface === 'wall') {
    const face = userData['face'];
    if (isFaceKey(face)) return index.byFace.get(face);
  } else if (surface === 'floor' || userData['isCeiling'] === true) {
    const roomId = userData['roomId'];
    if (typeof roomId === 'string') return index.byRoomId.get(roomId);
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

/** One node: cloned and sanitised — children handled by the caller. */
function cloneNode(source: THREE.Object3D): THREE.Object3D {
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

/**
 * Recursively clones `source`, dropping pick-proxy helpers and shadow-only
 * casters, and records in `meshRows` the row of every cloned mesh that
 * belongs to an element: the row named by the nearest node at or above it
 * (`inherited` is the row of the nearest named ancestor, if any). The
 * opening and furniture tags sit on group nodes, so their meshes take the
 * group's row.
 */
function cloneTree(source: THREE.Object3D, index: RowIndex, meshRows: Map<THREE.Mesh, number>, inherited?: number): THREE.Object3D {
  const clone = cloneNode(source);
  const rowIndex = rowIndexFor(clone.userData as Record<string, unknown>, index) ?? inherited;
  if (rowIndex !== undefined && clone instanceof THREE.Mesh) meshRows.set(clone, rowIndex);
  for (const child of source.children) {
    if (isPickProxy(child) || isShadowOnly(child)) continue;
    clone.add(cloneTree(child, index, meshRows, rowIndex));
  }
  return clone;
}

/**
 * A deep clone of `root`, ready for `GLTFExporter`/`USDZExporter`: JSON-safe
 * `userData`, pick-proxy helpers removed, the ceiling shown regardless of the
 * live dollhouse state, plus `meshRows`: the index into `rows` of every cloned
 * mesh that belongs to an element (a wall face, a room's floor or ceiling, an
 * opening, a furniture placement). `wall` rows are reached through their face
 * rows and own no mesh. The caller disposes nothing: every geometry and
 * material in the returned graph is the SAME instance the live graph holds.
 */
export function exportGraphWithRows(
  root: THREE.Object3D,
  rows: readonly ElementRow[],
): { graph: THREE.Object3D; meshRows: ReadonlyMap<THREE.Mesh, number> } {
  const byFace = new FaceMap<number>();
  const byRoomId = new Map<string, number>();
  const byOpeningId = new Map<string, number>();
  const byAssetId = new Map<string, number>();
  rows.forEach((row, rowIndex) => {
    // A face row has no id; it is addressed by its wall, side and room.
    if (row.class === 'wallFace') {
      byFace.set(faceKey(row.roomId ?? null, row.wallId, row.side), rowIndex);
    } else if (row.class === 'room') byRoomId.set(row.id, rowIndex);
    else if (row.class === 'opening') byOpeningId.set(row.id, rowIndex);
    else if (row.class === 'furniture') byAssetId.set(row.id, rowIndex);
  });
  const meshRows = new Map<THREE.Mesh, number>();
  const graph = cloneTree(root, { byFace, byRoomId, byOpeningId, byAssetId }, meshRows);
  return { graph, meshRows };
}

/** `exportGraphWithRows`'s graph alone, for an exporter that writes no feature ids (USDZ). */
export function exportGraph(root: THREE.Object3D, rows: readonly ElementRow[]): THREE.Object3D {
  return exportGraphWithRows(root, rows).graph;
}
