/**
 * Rooms merging at commit, when a batch removed the walls between them.
 *
 * A room is an anchor, not an outline (`types.Room.anchor`): take away the only
 * wall between two rooms and the final plan has one face holding two anchors,
 * which `assignRooms` refuses as `MULTI_ANCHOR`. To a person opening up the
 * kitchen that refusal looks like a bug, so `SceneModel.apply` asks this module
 * first, after the batch has run on the draft and before the draft is
 * validated: `planRoomMerges` finds the faces that hold several anchors, and
 * `applyRoomMerges` folds each group into one room.
 *
 * Why at COMMIT and not inside `remove_wall`: a batch may remove several walls
 * (three rooms into one) and existing batches pass through plans that do not
 * solve (they remove facade walls, then rebuild the boundary), so only the
 * final plan can say which rooms now share a face.
 *
 * What it must never do is hide a genuine anchor error. A group is merged only
 * when every room in it was an attached room of the COMMITTED document with the
 * same anchor; a face that gained an anchor because the batch added a room or
 * moved one is left alone and still fails as `MULTI_ANCHOR`. A plan that does
 * not build at all (`DANGLING_NODE`, `DISCONNECTED`) is left for validation to
 * report exactly as it does today.
 *
 * The survivor is the room with the largest floor area in the committed solved
 * plan (`door-swing.ts` measures rooms the same way), a tie going to the
 * smaller id, so the answer depends on the plan alone and never on array
 * order. It keeps its id, anchor, name, kind, purpose, accent, floor, room
 * finishes and camera. An absorbed room hands its objects (rebound, not moved)
 * and its painted wall faces (re-keyed) to the survivor; its camera, room
 * finishes and the preset instructions naming it are dropped. `applyRemoveRoom`
 * is deliberately not reused: it unbinds the objects and drops the paint.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Draft } from '../shared/committed.js';
import { signedArea } from '../plan/plan-geometry.js';
import { anchorsPerFace, buildGraph, type PlanGraph } from '../plan/plan-graph.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import {
  TOUCHED_SHELL,
  forgetInPresets,
  sameTouched,
  touchedAsset,
  touchedCamera,
  touchedCeiling,
  touchedFace,
  touchedFloor,
  touchedRoomWalls,
  touchedTrim,
  type TouchedEntity,
} from './ops/context.js';
import { presetNamesRoom } from './ops/rooms.js';
import { faceKey } from './types.js';
import type { SceneData } from './types.js';

/** One face's rooms folded into one: the survivor and the rooms it absorbs, the latter sorted by id. */
export type RoomMergeGroup = { readonly survivor: string; readonly absorbed: readonly string[] };

/** One absorbed room, as `ApplyOk.roomMerges` reports it: `summary` names both rooms as they were called before the merge. */
export type RoomMerge = { readonly from: string; readonly to: string; readonly summary: string };

/**
 * The merge groups of `draft`'s final plan, one per face holding the anchors
 * of several attached rooms that `base` held with the same anchors. Empty when
 * there is nothing to merge, and when the plan does not build — that refusal
 * belongs to validation.
 */
export function planRoomMerges(base: SceneData, basePlan: SolvedPlan, draft: SceneData): RoomMergeGroup[] {
  let graph: PlanGraph;
  try {
    graph = buildGraph(draft.nodes, draft.walls);
  } catch {
    return [];
  }
  const committed = new Map(base.rooms.filter((room) => room.polygon === undefined).map((room) => [room.id, room.anchor]));
  const area = new Map(basePlan.rooms.map((room) => [room.roomId, Math.abs(signedArea(room.polygon))]));

  const groups: RoomMergeGroup[] = [];
  for (const rooms of anchorsPerFace(graph, draft.rooms)) {
    if (rooms.length < 2) continue;
    const unmoved = rooms.every((room) => {
      const anchor = committed.get(room.id);
      return anchor !== undefined && anchor.x === room.anchor.x && anchor.z === room.anchor.z;
    });
    if (!unmoved) continue;
    const ranked = [...rooms].sort((a, b) => (area.get(b.id) ?? 0) - (area.get(a.id) ?? 0) || compareIds(a.id, b.id));
    groups.push({
      survivor: ranked[0]!.id,
      absorbed: ranked
        .slice(1)
        .map((room) => room.id)
        .sort(compareIds),
    });
  }
  return groups;
}

/**
 * Folds every group into its survivor, in place, and answers with the report
 * (`roomMerges`, sorted by `from`) and what changed: the shell, the rebound
 * objects, the dropped cameras, each absorbed room's floor, walls, ceiling and
 * trim, and the old and new key of every re-keyed face.
 */
export function applyRoomMerges(
  draft: Draft<SceneData>,
  groups: readonly RoomMergeGroup[],
): { merges: RoomMerge[]; touched: TouchedEntity[] } {
  const names = new Map(draft.rooms.map((room) => [room.id, room.name]));
  const merges: RoomMerge[] = [];
  const touched: TouchedEntity[] = [TOUCHED_SHELL];
  const touch = (entity: TouchedEntity): void => {
    if (!touched.some((seen) => sameTouched(seen, entity))) touched.push(entity);
  };

  for (const group of groups) {
    for (const id of group.absorbed) {
      merges.push({ from: id, to: group.survivor, summary: `${names.get(id)} merged into ${names.get(group.survivor)}` });
      draft.rooms = draft.rooms.filter((room) => room.id !== id);

      for (const asset of draft.assets) {
        if (asset.room !== id) continue;
        asset.room = group.survivor;
        touch(touchedAsset(asset.id));
      }
      if (draft.roomCameras[id] !== undefined) {
        delete draft.roomCameras[id];
        touch(touchedCamera({ room: id }));
      }
      const rooms = draft.finishes?.rooms;
      if (rooms !== undefined && Object.prototype.hasOwnProperty.call(rooms, id)) delete rooms[id];
      for (const entity of [touchedFloor(id), touchedRoomWalls(id), touchedCeiling(id), touchedTrim(id)]) touch(entity);

      rekeyFaces(draft, id, group.survivor, touch);
      forgetInPresets(draft, (op) => presetNamesRoom(op, id));
    }
  }
  merges.sort((a, b) => compareIds(a.from, b.from));
  return { merges, touched };
}

/**
 * Hands the faces painted for `from` to `to`: one face to one face, no blend.
 * Two valid rooms never own the same physical face, so a clash can only come
 * from a hand-made document; the survivor's own entry is kept then.
 */
function rekeyFaces(draft: Draft<SceneData>, from: string, to: string, touch: (entity: TouchedEntity) => void): void {
  const faces = draft.finishes?.faces;
  if (faces === undefined) return;
  const owned = (wallId: string, side: string): boolean =>
    faces.some((entry) => entry.room === to && entry.wallId === wallId && entry.side === side);
  draft.finishes!.faces = faces.filter((entry) => {
    if (entry.room !== from) return true;
    touch(touchedFace(faceKey(from, entry.wallId, entry.side)));
    if (owned(entry.wallId, entry.side)) return false;
    entry.room = to;
    touch(touchedFace(faceKey(to, entry.wallId, entry.side)));
    return true;
  });
}

/** Plain string order on ids: the tie-break of the survivor rule and the order of the report. */
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
