/**
 * The paint state of the shell and the API that changes it: which material a
 * room's walls, a single face, the facade and each floor wear.
 *
 * `shell-builder.ts` builds the geometry and hands every floor slab and face
 * mesh over as it does; this module owns the materials, the maps that point at
 * them, and every setter and getter `SceneBuilder` re-exports. Splitting the
 * two is what lets "how a wall is extruded" and "what colour it is" change
 * independently.
 *
 * Paint invariant: the paint state is a PROJECTION of the scene document, not
 * a copy of it. Setters move materials onto meshes; every getter answers from
 * `SceneData.finishes` through `scene-ops`, so the paint and the model can
 * never disagree about what colour a surface is, and an exported draft reloads
 * exactly as it was left. `bindScene` re-points the projection at the bound
 * model's committed document, which is a fresh object after every commit.
 *
 * UV invariant: wall and floor UVs are in WORLD METRES, so the tile size lives
 * in the material as `texture.repeat = 1/tile` — never a per-mesh repeat count.
 */

import * as THREE from 'three';
import type { BuilderContext } from './builder-context.js';
import { applyFinishToMaterial, finishMaterial, type Finish } from '../materials/finishes.js';
import type { WallFace } from '../plan/plan-solver.js';
import { DEFAULT_WALL_FINISH, faceFinishOf, facadeFinishOf, floorFinishOf, roomWallFinishOf } from '../scene/scene-ops.js';
import { FaceMap, type FaceKey, type SceneData } from '../scene/types.js';

/** Default tile size of a wall finish in metres. */
const WALL_TILE = 0.6;
/** Default tile size of a floor finish in metres. */
const FLOOR_TILE = 2.6;

export class ShellPaint {
  private readonly ctx: BuilderContext;
  private readonly floorMeshes = new Map<string, THREE.Mesh>();
  private readonly faceMeshes = new FaceMap<THREE.Mesh>();
  private readonly roomWallMaterials = new Map<string, THREE.MeshStandardMaterial>();
  /** Per-face overrides; a face without one wears its room's or the facade's material. */
  private readonly faceMaterials = new FaceMap<THREE.MeshStandardMaterial>();
  private readonly facadeMaterial: THREE.MeshStandardMaterial;
  /**
   * Where the paint state is READ from. It starts at the document the paint
   * was constructed with and is re-pointed at the bound model's committed
   * scene, which is a fresh object after every commit.
   */
  private source: () => SceneData;

  constructor(ctx: BuilderContext) {
    this.ctx = ctx;
    this.source = () => this.ctx.scene;
    const scene = ctx.scene;
    // Initial paint is a projection of the document: `scene.finishes` first,
    // the catalogue default second.
    const facadeFinish = ctx.findFinish(facadeFinishOf(scene)) ?? ctx.findFinish(DEFAULT_WALL_FINISH)!;
    this.facadeMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
    this.paintWall(this.facadeMaterial, facadeFinish);
    for (const room of scene.rooms) {
      const finish = ctx.findFinish(roomWallFinishOf(scene, room.id)) ?? facadeFinish;
      const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
      this.paintWall(material, finish);
      this.roomWallMaterials.set(room.id, material);
    }
  }

  /**
   * Points the paint projection at a live scene source (the bound model's
   * committed document). Until this is called the projection answers from the
   * document the paint was constructed with.
   */
  bindScene(source: () => SceneData): void {
    this.source = source;
  }

  // ------------------------------------------------------- registration ----

  /** The material a face mesh is built with: its override, else its owner's. */
  materialForFace(face: WallFace): THREE.MeshStandardMaterial {
    const override = this.faceMaterials.get(face.key);
    if (override) return override;
    if (face.roomId === null) return this.facadeMaterial;
    return this.roomWallMaterials.get(face.roomId) ?? this.facadeMaterial;
  }

  /** A floor material for one finish. Floor UVs are metres, so one tile is `1/tile` of a metre. */
  floorMaterialFor(finish: Finish): THREE.MeshStandardMaterial {
    const repeat = 1 / (finish.tile ?? FLOOR_TILE);
    return finishMaterial(finish, repeat, repeat);
  }

  /** Hands a built face mesh over, so a later paint can find it. */
  registerFace(face: FaceKey, mesh: THREE.Mesh): void {
    this.faceMeshes.set(face, mesh);
  }

  /** Hands a built floor slab over, so a later paint can find it. */
  registerFloor(roomId: string, mesh: THREE.Mesh): void {
    this.floorMeshes.set(roomId, mesh);
  }

  /** The mesh of a face, so callers can inspect or re-register it. */
  faceMesh(face: FaceKey): THREE.Mesh | null {
    return this.faceMeshes.get(face) ?? null;
  }

  /**
   * Applies a wall finish in place. UVs are in metres, so the tile size is the
   * material's repeat: `repeat = 1/tile`, never a per-mesh repeat count.
   */
  paintWall(material: THREE.MeshStandardMaterial, finish: Finish): void {
    const repeat = 1 / (finish.tile ?? WALL_TILE);
    material.map?.dispose();
    applyFinishToMaterial(material, finish, repeat, repeat);
  }

  // ----------------------------------------------------------- lifecycle ----

  /**
   * Adds every material this paint created to `into`. The shell runs ONE
   * disposal pass over its whole tree, so the materials are handed over rather
   * than freed here — freeing them twice would dispatch a second `dispose`
   * event to a listener that has already let go.
   */
  collectMaterials(into: Set<THREE.Material>): void {
    into.add(this.facadeMaterial);
    for (const material of this.roomWallMaterials.values()) into.add(material);
    for (const material of this.faceMaterials.values()) into.add(material);
  }

  /** Drops every mesh and override reference; the materials are already handed over. */
  clear(): void {
    this.faceMaterials.clear();
    this.faceMeshes.clear();
    this.floorMeshes.clear();
  }

  // -------------------------------------------------------------- floors ----

  /** Swaps one room's floor finish (`set_material` with a `<room id>` target). */
  setRoomFloor(roomId: string, finishId: string): boolean {
    const finish = this.ctx.findFinish(finishId);
    const mesh = this.floorMeshes.get(roomId);
    if (!finish || !mesh) return false;
    const old = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = this.floorMaterialFor(finish);
    old.map?.dispose();
    old.dispose();
    return true;
  }

  setAllFloors(finishId: string): void {
    for (const roomId of this.floorMeshes.keys()) this.setRoomFloor(roomId, finishId);
  }

  /** Projection, not a mirror: the effective floor finish of a room. */
  getFloorFinish(roomId: string): string | null {
    return floorFinishOf(this.source(), roomId);
  }

  // --------------------------------------------------------------- walls ----

  /** Paints every face of a room's loop and drops that room's per-face overrides. */
  setRoomWall(roomId: string, finishId: string): boolean {
    const finish = this.ctx.findFinish(finishId);
    const material = this.roomWallMaterials.get(roomId);
    if (!finish || !material) return false;
    this.paintWall(material, finish);
    for (const face of this.facesOfRoom(roomId)) this.clearFaceOverride(face, material);
    return true;
  }

  /** Projection: the effective wall finish of a room, `null` for an unknown one. */
  getRoomWall(roomId: string): string | null {
    if (!this.ctx.roomsById.has(roomId)) return null;
    return roomWallFinishOf(this.source(), roomId);
  }

  /** Paints a single face (corner to corner, or up to a T-junction). */
  setFaceWall(face: FaceKey, finishId: string): boolean {
    const finish = this.ctx.findFinish(finishId);
    const mesh = this.faceMeshes.get(face);
    if (!finish || !mesh) return false;
    let material = this.faceMaterials.get(face);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: finish.roughness });
      this.faceMaterials.set(face, material);
    }
    this.paintWall(material, finish);
    mesh.material = material;
    return true;
  }

  /**
   * Projection: the effective finish of a face — its own override, else its
   * owner's (a room, or the facade). `null` when the plan has no such face.
   */
  getFaceWall(face: FaceKey): string | null {
    if (!this.ctx.plan.faces.has(face)) return null;
    return faceFinishOf(this.source(), face);
  }

  /** Paints every outer face of the building as one area. */
  setFacadeWall(finishId: string): boolean {
    const finish = this.ctx.findFinish(finishId);
    if (!finish) return false;
    this.paintWall(this.facadeMaterial, finish);
    for (const face of this.ctx.plan.facade) this.clearFaceOverride(face.key, this.facadeMaterial);
    return true;
  }

  /** Projection: the effective facade finish. */
  getFacadeWall(): string {
    return facadeFinishOf(this.source());
  }

  /** Paints every room; the facade keeps its own finish. */
  setAllWalls(finishId: string): void {
    for (const roomId of this.roomWallMaterials.keys()) this.setRoomWall(roomId, finishId);
  }

  /**
   * Drops a per-face override so the face falls back to its room or the
   * facade. `false` when the plan has no such face.
   */
  resetFaceWall(face: FaceKey): boolean {
    if (!this.ctx.plan.faces.has(face)) return false;
    const fallback = face.room === undefined ? this.facadeMaterial : (this.roomWallMaterials.get(face.room) ?? this.facadeMaterial);
    this.clearFaceOverride(face, fallback);
    return true;
  }

  /** Faces of a room's loop, in walk order. */
  facesOfRoom(roomId: string): FaceKey[] {
    const room = this.ctx.plan.rooms.find((candidate) => candidate.roomId === roomId);
    return room ? room.loop.map((face) => face.key) : [];
  }

  /** Drops a per-face override and hands the face back to `fallback`. */
  clearFaceOverride(face: FaceKey, fallback: THREE.MeshStandardMaterial): void {
    const override = this.faceMaterials.get(face);
    if (!override) return;
    this.faceMaterials.delete(face);
    const mesh = this.faceMeshes.get(face);
    if (mesh) mesh.material = fallback;
    override.map?.dispose();
    override.dispose();
  }
}
