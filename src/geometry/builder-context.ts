/**
 * The read-only lookups every geometry builder needs from a solved scene:
 * nodes, walls and rooms by id, the faces of each wall, and which walls carry
 * a facade face. Built once and shared, so `shell-builder` and
 * `opening-builder` cannot disagree about the plan.
 *
 * It also carries the one lookup that is a property of the DOCUMENT rather
 * than of a module: where a room surface's finish comes from. A bare scene
 * reads the bundled catalogue; a baked project reads its own `materials[]`.
 * Handing it through the context is what stops `shell-builder`
 * and `shell-paint` importing a catalogue apiece and disagreeing about which
 * one the document on screen is painted from.
 *
 * No DOM. Not `three`-free, because that default lookup is the bundled
 * catalogue's: this module is inside the geometry layer and has never been on
 * `purity.test.ts`'s list.
 */

import type { SolvedPlan, WallFace } from '../plan/plan-solver.js';
import type { FinishRef, PlanNode, Room, SceneData, Wall } from '../scene/types.js';
import { findFinish as catalogueFinish, type Finish } from '../materials/finishes.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import { resolveRoomFinish, type RoomFinishDraw } from '../materials/room-finish.js';
import type { LibraryTextures } from './library-surface.js';

/** How a room-surface finish id is turned into a finish: the seam a project fills. */
export type FinishLookup = (id: string) => Finish | null;

export type BuilderContext = {
  scene: SceneData;
  plan: SolvedPlan;
  nodesById: Map<string, PlanNode>;
  wallsById: Map<string, Wall>;
  roomsById: Map<string, Room>;
  /** Every solved face of a wall, both sides, in solver order. */
  facesByWall: Map<string, WallFace[]>;
  /** Walls with at least one facade face; the dollhouse hides objects by this. */
  exteriorWallIds: Set<string>;
  /**
   * Where a room surface's finish comes from.
   *
   * The bundled catalogue for a bare scene, and the loaded project's own
   * `materials[]` (falling back to the bundle) for a bake — injected rather
   * than imported by `shell-builder` and `shell-paint`, because those two ask
   * the question a dozen times and the answer is a property of the DOCUMENT,
   * not of the module.
   */
  findFinish: FinishLookup;
  /**
   * What a room surface's finish VALUE is drawn as: a library draw for a
   * project library material, else the legacy finish `findFinish` gives.
   */
  resolve: (ref: FinishRef) => RoomFinishDraw | null;
  /** Where library materials take their maps from; `null` without a project or a WebGL context. */
  textures: LibraryTextures | null;
};

export function createBuilderContext(
  scene: SceneData,
  plan: SolvedPlan,
  findFinish?: FinishLookup,
  projectMaterials?: readonly ProjectMaterial[],
  textures: LibraryTextures | null = null,
): BuilderContext {
  const lookup = findFinish ?? catalogueFinish;
  const facesByWall = new Map<string, WallFace[]>();
  for (const face of plan.faces.values()) {
    const list = facesByWall.get(face.wallId);
    if (list) list.push(face);
    else facesByWall.set(face.wallId, [face]);
  }
  const exteriorWallIds = new Set<string>();
  for (const face of plan.facade) exteriorWallIds.add(face.wallId);
  return {
    scene,
    plan,
    nodesById: new Map(scene.nodes.map((node) => [node.id, node])),
    wallsById: new Map(scene.walls.map((wall) => [wall.id, wall])),
    roomsById: new Map(scene.rooms.map((room) => [room.id, room])),
    facesByWall,
    exteriorWallIds,
    findFinish: lookup,
    resolve: (ref) => resolveRoomFinish(ref, projectMaterials, lookup),
    textures,
  };
}
