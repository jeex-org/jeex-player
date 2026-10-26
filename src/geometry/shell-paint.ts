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
import {
  DEFAULT_WALL_FINISH,
  facadeFinishRefOf,
  faceFinishOf,
  facadeFinishOf,
  floorFinishOf,
  floorFinishRefOf,
  roomWallFinishOf,
  roomWallFinishRefOf,
} from '../scene/scene-ops.js';
import { FaceMap, type FaceKey, type FinishRef, type FinishSurface, type SceneData, type Vec2 } from '../scene/types.js';
import { LibrarySurface } from './library-surface.js';
import type { LibraryDraw } from '../materials/room-finish.js';
import { BUILTIN_DEFAULT_CEILING } from '../materials/builtin-library.js';
import { firstFrameColour } from '../materials/library-material.js';
import { DEFAULT_FLOOR_FINISH } from '../materials/finish-catalogue.js';
import { FINISH } from '../materials/finish-ids.js';

/** The finish every ceiling of a room that names none wears (the bank's white plaster). */
const DEFAULT_CEILING_FINISH = FINISH.plaster_white;

/** Default tile size of a wall finish in metres. */
const WALL_TILE = 0.6;
/** Default tile size of a floor finish in metres. */
const FLOOR_TILE = 2.6;

export class ShellPaint {
  private readonly ctx: BuilderContext;
  private readonly floorMeshes = new Map<string, THREE.Mesh>();
  private readonly floorOutlines = new Map<string, readonly Vec2[]>();
  private readonly faceMeshes = new FaceMap<THREE.Mesh>();
  private readonly roomWallMaterials = new Map<string, THREE.MeshStandardMaterial>();
  /** Per-face overrides; a face without one wears its room's or the facade's material. */
  private readonly faceMaterials = new FaceMap<THREE.MeshStandardMaterial>();
  private facadeMaterial: THREE.MeshStandardMaterial;
  /**
   * The junction cores' materials, one per owner: the room whose walls a core
   * wears (`null`: the facade's). Flat in the owner's colour and pushed behind
   * anything coplanar, so a core never takes a face's map or wins its depth test.
   */
  private readonly jointMaterials = new Map<string | null, THREE.MeshStandardMaterial>();
  /** The ceiling and baseboard meshes of each room, with the shared material they fall back to. */
  private readonly ceilingMeshes = new Map<string, { meshes: THREE.Mesh[]; fallback: THREE.Material }>();
  private readonly trimMeshes = new Map<string, { meshes: THREE.Mesh[]; fallback: THREE.Material }>();
  /** Per-room ceiling and baseboard materials, only for the rooms whose document names one. */
  private readonly ceilingMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly trimMaterials = new Map<string, THREE.MeshStandardMaterial>();
  /** Every library-dressed material this paint made, with the surface that owns its maps. */
  private readonly librarySurfaces = new Map<THREE.Material, LibrarySurface>();
  /**
   * The one library material every ceiling of a room that names none wears,
   * made on first ask; `null` until then, and when the default ceiling keeps
   * the builder's flat plaster.
   */
  private defaultCeiling: THREE.MeshStandardMaterial | null = null;
  /** The map loads still in flight (`mapsSettled`). */
  private readonly loads = new Set<Promise<void>>();
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
    const facadeRef = this.ctx.resolve(facadeFinishRefOf(scene)) === null ? DEFAULT_WALL_FINISH : facadeFinishRefOf(scene);
    this.facadeMaterial = this.wallMaterialFor(facadeRef, 'facade', 0.9)!;
    for (const room of scene.rooms) {
      // A room whose finish resolves nowhere wears the facade's, as it always has.
      const material =
        this.wallMaterialFor(roomWallFinishRefOf(scene, room.id), 'wall', 0.85) ?? this.wallMaterialFor(facadeRef, 'wall', 0.85)!;
      this.roomWallMaterials.set(room.id, material);
    }
  }

  /**
   * A material for a finish VALUE on a vertical or overhead surface: a
   * library surface's own material, or a standard material painted with the
   * legacy finish. `null` when nothing resolves the value.
   */
  private wallMaterialFor(ref: FinishRef, surface: FinishSurface, roughness: number): THREE.MeshStandardMaterial | null {
    const resolved = this.ctx.resolve(ref);
    if (resolved === null) return null;
    if (resolved.kind === 'library') return this.libraryMaterial(resolved.draw, surface, []);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness });
    this.paintWall(material, resolved.finish);
    return material;
  }

  /**
   * A library surface's material, flat at once, its maps asked for when there
   * is a source for them: the player's own for a bundled finish, the
   * document's for a project material.
   */
  private libraryMaterial(draw: LibraryDraw, surface: FinishSurface, outline: readonly Vec2[]): THREE.MeshStandardMaterial {
    const library = new LibrarySurface(draw, surface, outline);
    this.librarySurfaces.set(library.material, library);
    const textures = draw.builtin === true ? this.ctx.builtinTextures : this.ctx.textures;
    if (textures !== null) {
      const load = library.load(textures);
      const settle = (): void => void this.loads.delete(load);
      this.loads.add(load);
      void load.then(settle, settle);
    }
    return library.material;
  }

  /**
   * Resolves once no library map of this shell is loading any more: every map
   * asked for so far has attached or given up (a load never throws). A
   * light bake waits for it, since its bound clones would miss a later map.
   */
  async mapsSettled(): Promise<void> {
    while (this.loads.size > 0) await Promise.allSettled([...this.loads]);
  }

  /** The floor material of a room: its finish value (the painted one, else `Room.floorMaterial`), drawn on `outline`. */
  floorMaterialForRoom(roomId: string, outline: readonly Vec2[]): THREE.MeshStandardMaterial | null {
    const ref = floorFinishRefOf(this.ctx.scene, roomId);
    const resolved = ref === null ? null : this.ctx.resolve(ref);
    // A room whose floor resolves nowhere wears the default floor, through the same path.
    const drawn = resolved ?? this.ctx.resolve(DEFAULT_FLOOR_FINISH);
    if (drawn?.kind === 'library') return this.libraryMaterial(drawn.draw, 'floor', outline);
    return drawn === null ? null : this.floorMaterialFor(drawn.finish);
  }

  /**
   * The ceiling material of a room that names a ceiling finish, made on first
   * ask; `null` for a room that names none, which keeps the shared plaster.
   */
  ceilingMaterialFor(roomId: string): THREE.MeshStandardMaterial | null {
    return this.ownRoomMaterial(this.ceilingMaterials, roomId, 'ceiling', this.ctx.scene);
  }

  /** The baseboard material of a room that names a trim finish; `null` keeps the shared default trim. */
  trimMaterialFor(roomId: string): THREE.MeshStandardMaterial | null {
    return this.ownRoomMaterial(this.trimMaterials, roomId, 'trim', this.ctx.scene);
  }

  private ownRoomMaterial(
    cache: Map<string, THREE.MeshStandardMaterial>,
    roomId: string,
    surface: 'ceiling' | 'trim',
    scene: SceneData,
  ): THREE.MeshStandardMaterial | null {
    const cached = cache.get(roomId);
    if (cached) return cached;
    const rooms = scene.finishes?.rooms;
    const ref = rooms && Object.prototype.hasOwnProperty.call(rooms, roomId) ? rooms[roomId]?.[surface] : undefined;
    const material = ref === undefined ? null : this.wallMaterialFor(ref, surface, 0.9);
    if (material !== null) cache.set(roomId, material);
    return material;
  }

  /**
   * Releases every library surface this paint made — its views back to the
   * texture source, its material freed — and answers their materials, which
   * the shell's own disposal pass must then leave alone.
   */
  releaseLibrary(): Set<THREE.Material> {
    const released = new Set(this.librarySurfaces.keys());
    for (const library of this.librarySurfaces.values()) library.release();
    this.librarySurfaces.clear();
    this.defaultCeiling = null;
    return released;
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

  /** Hands a built floor slab over, with the outline a floor grain follows, so a later paint can find it. */
  registerFloor(roomId: string, mesh: THREE.Mesh, outline: readonly Vec2[] = []): void {
    this.floorMeshes.set(roomId, mesh);
    this.floorOutlines.set(roomId, outline);
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
    // A legacy material owns the map clone it wears; a library surface's
    // maps are the texture source's and never pass through here.
    if (!this.librarySurfaces.has(material)) material.map?.dispose();
    const resolved = this.ctx.resolve(finish.id);
    if (resolved?.kind !== 'library') {
      applyFinishToMaterial(material, finish, repeat, repeat);
      return;
    }
    this.paintFlat(material, resolved.draw);
  }

  /** A library finish painted into a material the builder owns (the junction cores): flat in its first-frame colour, never a generated map. */
  private paintFlat(material: THREE.MeshStandardMaterial, draw: LibraryDraw): void {
    material.map = null;
    material.bumpMap = null;
    material.color.copy(firstFrameColour(draw));
    material.roughness = draw.material.facts.pbr.roughness ?? 1;
    material.needsUpdate = true;
  }

  // ---------------------------------------------------------- joint cores ----

  /**
   * Hands a junction core over, wearing the walls of `owner` (a room id; `null`
   * for the facade) — the shell builder picks the owner, the first room by id
   * the core's walls bound. Every core of one owner shares one material, and
   * a repaint of the owner recolours it.
   */
  registerJoint(mesh: THREE.Mesh, owner: string | null): void {
    let material = this.jointMaterials.get(owner);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.85,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const scene = this.source();
      this.paintJoint(material, owner === null ? facadeFinishRefOf(scene) : roomWallFinishRefOf(scene, owner));
      this.jointMaterials.set(owner, material);
    }
    mesh.material = material;
  }

  /** `material` in the flat colour of `finish`; the unpainted plaster when nothing resolves it. */
  private paintJoint(material: THREE.MeshStandardMaterial, finish: FinishRef): void {
    const resolved = this.ctx.resolve(finish) ?? this.ctx.resolve(DEFAULT_WALL_FINISH);
    if (resolved === null) return;
    if (resolved.kind === 'library') this.paintFlat(material, resolved.draw);
    else this.paintWall(material, resolved.finish);
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
    for (const material of this.ceilingMaterials.values()) into.add(material);
    for (const material of this.trimMaterials.values()) into.add(material);
    for (const material of this.jointMaterials.values()) into.add(material);
  }

  /** Drops every mesh and override reference; the materials are already handed over. */
  clear(): void {
    this.faceMaterials.clear();
    this.faceMeshes.clear();
    this.floorMeshes.clear();
    this.floorOutlines.clear();
    this.ceilingMaterials.clear();
    this.trimMaterials.clear();
    this.ceilingMeshes.clear();
    this.trimMeshes.clear();
    this.jointMaterials.clear();
  }

  // -------------------------------------------------------------- floors ----

  /** Swaps one room's floor finish (`set_material` with a `<room id>` target). */
  setRoomFloor(roomId: string, finish: FinishRef): boolean {
    const resolved = this.ctx.resolve(finish);
    const mesh = this.floorMeshes.get(roomId);
    if (!resolved || !mesh) return false;
    const old = mesh.material as THREE.MeshStandardMaterial;
    mesh.material =
      resolved.kind === 'library'
        ? this.libraryMaterial(resolved.draw, 'floor', this.floorOutlines.get(roomId) ?? [])
        : this.floorMaterialFor(resolved.finish);
    this.release(old);
    return true;
  }

  setAllFloors(finish: FinishRef): void {
    for (const roomId of this.floorMeshes.keys()) this.setRoomFloor(roomId, finish);
  }

  /** Projection, not a mirror: the effective floor finish of a room. */
  getFloorFinish(roomId: string): string | null {
    return floorFinishOf(this.source(), roomId);
  }

  // --------------------------------------------------------------- walls ----

  /** Paints every face of a room's loop and drops that room's per-face overrides. */
  setRoomWall(roomId: string, finish: FinishRef): boolean {
    const old = this.roomWallMaterials.get(roomId);
    const material = old === undefined ? null : this.repaint(old, finish, 'wall');
    if (!old || !material) return false;
    this.roomWallMaterials.set(roomId, material);
    const joint = this.jointMaterials.get(roomId);
    if (joint) this.paintJoint(joint, finish);
    for (const face of this.facesOfRoom(roomId)) {
      this.clearFaceOverride(face, material);
      const mesh = this.faceMeshes.get(face);
      if (mesh?.material === old) mesh.material = material;
    }
    if (material !== old) this.release(old);
    return true;
  }

  /** Projection: the effective wall finish of a room, `null` for an unknown one. */
  getRoomWall(roomId: string): string | null {
    if (!this.ctx.roomsById.has(roomId)) return null;
    return roomWallFinishOf(this.source(), roomId);
  }

  /** Paints a single face (corner to corner, or up to a T-junction). */
  setFaceWall(face: FaceKey, finish: FinishRef): boolean {
    const mesh = this.faceMeshes.get(face);
    const resolved = mesh ? this.ctx.resolve(finish) : null;
    if (!mesh || !resolved) return false;
    const old = this.faceMaterials.get(face);
    const surface: FinishSurface = face.room === undefined ? 'facade' : 'wall';
    const roughness = resolved.kind === 'legacy' ? resolved.finish.roughness : 1;
    const material = old === undefined ? this.wallMaterialFor(finish, surface, roughness)! : this.repaint(old, finish, surface)!;
    this.faceMaterials.set(face, material);
    mesh.material = material;
    if (old !== undefined && material !== old) this.release(old);
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
  setFacadeWall(finish: FinishRef): boolean {
    const old = this.facadeMaterial;
    const material = this.repaint(old, finish, 'facade');
    if (!material) return false;
    this.facadeMaterial = material;
    const joint = this.jointMaterials.get(null);
    if (joint) this.paintJoint(joint, finish);
    for (const face of this.ctx.plan.facade) {
      this.clearFaceOverride(face.key, material);
      const mesh = this.faceMeshes.get(face.key);
      if (mesh?.material === old) mesh.material = material;
    }
    if (material !== old) this.release(old);
    return true;
  }

  /** Projection: the effective facade finish. */
  getFacadeWall(): string {
    return facadeFinishOf(this.source());
  }

  /** Paints every room; the facade keeps its own finish. */
  setAllWalls(finish: FinishRef): void {
    for (const roomId of this.roomWallMaterials.keys()) this.setRoomWall(roomId, finish);
  }

  // ---------------------------------------------------- ceilings and trim ----

  /** Hands a built ceiling over, so a later paint can find it; `fallback` is the shared plaster. */
  registerCeiling(roomId: string, mesh: THREE.Mesh, fallback: THREE.Material): void {
    // The builder hands its own flat plaster; a library default replaces it,
    // on the mesh and as what a cleared ceiling returns to.
    const shared = this.defaultCeilingMaterial() ?? fallback;
    if (mesh.material === fallback) mesh.material = shared;
    this.ceilingMeshes.set(roomId, { meshes: [mesh], fallback: shared });
  }

  /**
   * The default ceiling as a library material: the project's own library
   * material under the default ceiling id when it ships one, else the bundled
   * default; `null` when neither is a library material (the builder's flat
   * plaster stays).
   */
  private defaultCeilingMaterial(): THREE.MeshStandardMaterial | null {
    if (this.defaultCeiling !== null) return this.defaultCeiling;
    const own = this.ctx.resolve(DEFAULT_CEILING_FINISH);
    let draw: LibraryDraw | null = own?.kind === 'library' ? own.draw : null;
    if (draw === null && BUILTIN_DEFAULT_CEILING !== null) {
      const { material, colour, rotation } = BUILTIN_DEFAULT_CEILING;
      draw = { id: DEFAULT_CEILING_FINISH, material, ...(colour !== undefined && { colour }), rotation, builtin: true };
    }
    if (draw === null) return null;
    this.defaultCeiling = this.libraryMaterial(draw, 'ceiling', []);
    return this.defaultCeiling;
  }

  /** Hands a built baseboard over, so a later paint can find it; `fallback` is the shared default trim. */
  registerTrim(roomId: string, mesh: THREE.Mesh, fallback: THREE.Material): void {
    const entry = this.trimMeshes.get(roomId);
    if (entry) entry.meshes.push(mesh);
    else this.trimMeshes.set(roomId, { meshes: [mesh], fallback });
  }

  /** Repaints a room's ceiling from the document: its own finish, else the shared plaster. */
  setRoomCeiling(roomId: string): boolean {
    return this.repaintRoomSurface(this.ceilingMaterials, this.ceilingMeshes, roomId, 'ceiling');
  }

  /** Repaints a room's baseboards from the document: its own finish, else the shared default. */
  setRoomTrim(roomId: string): boolean {
    return this.repaintRoomSurface(this.trimMaterials, this.trimMeshes, roomId, 'trim');
  }

  private repaintRoomSurface(
    cache: Map<string, THREE.MeshStandardMaterial>,
    meshes: Map<string, { meshes: THREE.Mesh[]; fallback: THREE.Material }>,
    roomId: string,
    surface: 'ceiling' | 'trim',
  ): boolean {
    const entry = meshes.get(roomId);
    // A known room with no mesh for the surface (a loggia has no ceiling) has
    // nothing to repaint; only an unknown room is drift.
    if (!entry) return this.ctx.roomsById.has(roomId);
    const old = cache.get(roomId);
    cache.delete(roomId);
    const material = this.ownRoomMaterial(cache, roomId, surface, this.source()) ?? entry.fallback;
    for (const mesh of entry.meshes) mesh.material = material;
    if (old !== undefined) this.release(old);
    return true;
  }

  /**
   * `old` repainted with `finish`: in place when both are legacy (the shared
   * instance every face of the owner keeps), else a new material — the
   * caller swaps it onto the meshes and releases `old`. `null` when nothing
   * resolves `finish`.
   */
  private repaint(old: THREE.MeshStandardMaterial, finish: FinishRef, surface: FinishSurface): THREE.MeshStandardMaterial | null {
    const resolved = this.ctx.resolve(finish);
    if (resolved === null) return null;
    if (resolved.kind === 'legacy' && !this.librarySurfaces.has(old)) {
      this.paintWall(old, resolved.finish);
      return old;
    }
    return this.wallMaterialFor(finish, surface, old.roughness);
  }

  /** Lets go of a material that left every mesh: a library surface back to its source, a legacy one with its own map. */
  private release(material: THREE.Material): void {
    const library = this.librarySurfaces.get(material);
    if (library !== undefined) {
      this.librarySurfaces.delete(material);
      library.release();
      return;
    }
    (material as THREE.MeshStandardMaterial).map?.dispose();
    material.dispose();
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
    this.release(override);
  }
}
