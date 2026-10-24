/**
 * The apartment shell as GEOMETRY: site base, floors, ceilings, one mesh per
 * `WallFace`, one joint core per node, skirting.
 *
 * What colour any of it is belongs to `shell-paint.ts`: this builder asks it
 * for the material of each face and floor as it builds, and hands the meshes
 * over so a later paint can find them. `ShellPaint` is reachable through the
 * `paint` field, which is where `SceneBuilder` re-exports the painting API
 * from.
 *
 * Construction model: one `THREE.Mesh` per `WallFace`. A face is the painting
 * unit — every quad of the face is extruded from the face plane INTO the wall
 * by `FACE_DEPTH_RATIO x thickness`, so the two faces of a wall overlap by 1 %
 * on the centreline and never leave a coplanar seam. Faces carry exactly one
 * material, so per-room, per-face and facade painting are plain material swaps.
 *
 * Watertightness: face prisms end where their face is mitred, so they cannot
 * fill the wall body AT a junction. One extra mesh per node (`joint-<nodeId>`,
 * `plan-joints.ts`) does, and inside one face the runs share their extrusion
 * direction at every polyline vertex. Together they leave no slot through a
 * wall, so the dollhouse shows no open corners from above. Floors are
 * watertight the same way: the slab of a room follows `floor-outline.ts`, which
 * notches the room polygon through every doorway, so two floors meet on the
 * wall centreline instead of leaving a band of site slab under the door.
 *
 * UV invariant: wall and floor UVs are in WORLD METRES (`u = face.t0 + t`,
 * `v = y`); the tile size lives in the material as `texture.repeat = 1/tile`.
 * That keeps a pattern continuous across the opening cuts of a face and across
 * the faces of one wall, whatever their lengths.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuilderContext } from './builder-context.js';
import { floorOutline } from '../plan/floor-outline.js';
import type { WallFace } from '../plan/plan-solver.js';
import { jointCores } from '../plan/plan-joints.js';
import type { FaceOpening, FaceQuad } from '../plan/plan-openings.js';
import { EPS, add, dist, leftN, norm, sub } from '../plan/plan-geometry.js';
import { clamp } from '../shared/math.js';
import { DEFAULT_WALL_FINISH } from '../scene/scene-ops.js';
import { ShellPaint } from './shell-paint.js';
import { resolveFinish } from '../materials/material-catalogue.js';
import { FINISH } from '../materials/finish-ids.js';
import { effectiveRoom, isDoorLike, type Vec2 } from '../scene/types.js';
import { boardUV, placeFaceLocal, quadPrism, type BoardFrame } from './builder-uv.js';
import { SKIRTING_BOX_FLAGS, capCovered, concatFlags, faceEndsCovered, flagsOf, prismFlags, recordUnseen } from './shell-unseen.js';

/** Face slab depth as a fraction of the wall thickness (1 % overlap on the centreline). */
const FACE_DEPTH_RATIO = 0.51;
/** Floor slab thickness in metres. */
const FLOOR_SLAB = 0.12;
/** Baseboard profile in metres. */
const SKIRTING_HEIGHT = 0.09;
const SKIRTING_DEPTH = 0.026;
/** The finish every ceiling wears: the bundled white plaster. */
const CEILING_FINISH = FINISH.plaster_white;

/** One straight run of a face polyline; arc faces have one per chord. */
type FaceSegment = {
  start: Vec2;
  /** Unit direction of the run. */
  tangent: Vec2;
  /** Unit normal pointing towards the room (outwards for facade faces). */
  normal: Vec2;
  /** Offset of the run from the start of the face, in face `t`. */
  t0: number;
  length: number;
};

/** Straight runs of a face polyline, with cumulative `t` offsets. */
function faceSegments(face: WallFace): FaceSegment[] {
  const segments: FaceSegment[] = [];
  let t = 0;
  for (let i = 0; i + 1 < face.polyline.length; i += 1) {
    const a = face.polyline[i]!;
    const b = face.polyline[i + 1]!;
    const length = dist(a, b);
    if (length <= EPS) continue;
    const tangent = norm(sub(b, a));
    // `leftN` of the travel direction is the face's own side, arcs included.
    segments.push({ start: a, tangent, normal: leftN(tangent), t0: t, length });
    t += length;
  }
  return segments;
}

/**
 * Extrusion direction at the two ends of every run of a face.
 *
 * A chorded arc face turns AWAY from the extrusion at each vertex, so prisms
 * extruded along their own chord normal open a wedge between them — a
 * full-height slot through the wall body, one per chord. Both prisms meeting at
 * a vertex therefore extrude along the SAME bisector there, which makes their
 * back corners coincide and the strip watertight. A straight face has one run
 * and keeps its own normal at both ends.
 */
function segmentNormals(segments: FaceSegment[]): Array<{ start: Vec2; end: Vec2 }> {
  const shared = segments.map((segment, i) => {
    const next = segments[i + 1];
    return next ? norm(add(segment.normal, next.normal)) : segment.normal;
  });
  return segments.map((segment, i) => ({
    start: i === 0 ? segment.normal : shared[i - 1]!,
    end: shared[i]!,
  }));
}

export class ShellBuilder {
  private readonly ctx: BuilderContext;
  /** The paint state of everything this builder makes; see `shell-paint.ts`. */
  readonly paint: ShellPaint;
  private readonly ceilingMaterial: THREE.MeshStandardMaterial;
  private readonly trimMaterial: THREE.MeshStandardMaterial;
  /** Wall core at the junctions and — through the face prisms — the wall top. */
  private readonly jointMaterial: THREE.MeshStandardMaterial;
  /** Materials this builder created outside a mesh; freed by `dispose`. */
  private readonly ownedMaterials: THREE.Material[] = [];
  /** Group the last `build` filled; `dispose` frees every mesh under it. */
  private builtRoot: THREE.Group | null = null;

  constructor(ctx: BuilderContext) {
    this.ctx = ctx;
    this.paint = new ShellPaint(ctx);
    const scene = ctx.scene;
    // The ceiling is a flat paint, resolved through the one catalogue entry
    // point, so it reads exactly the colour the catalogue gives that plaster.
    const ceiling = resolveFinish(CEILING_FINISH, scene.materials);
    this.ceilingMaterial = new THREE.MeshStandardMaterial({
      color: ceiling?.color ?? '#eee9df',
      roughness: ceiling?.roughness ?? 0.9,
      metalness: ceiling?.metalness ?? 0,
    });
    this.trimMaterial = new THREE.MeshStandardMaterial({ color: '#eae2d2', roughness: 0.7 });
    // The core of a junction belongs to no room, so it wears the plaster every
    // unpainted wall starts from — the same tone the face prisms show on the
    // wall top. `polygonOffset` pushes it BEHIND anything coplanar: a core edge
    // that lies in a room's wall plane must never win the depth test against
    // the painted face in front of it.
    this.jointMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.paint.paintWall(this.jointMaterial, this.ctx.findFinish(DEFAULT_WALL_FINISH)!);
    this.ownedMaterials.push(this.ceilingMaterial, this.trimMaterial, this.jointMaterial);
  }

  /** Builds the whole shell into `root` and applies the authored face overrides. */
  build(root: THREE.Group): void {
    this.builtRoot = root;
    this.buildSiteBase(root);
    this.buildFloors(root);
    this.buildCeilings(root);
    for (const face of this.ctx.plan.faces.values()) {
      this.buildFace(root, face);
      this.buildSkirting(root, face);
    }
    this.buildJoints(root);
    for (const { finish, ...face } of this.ctx.scene.finishes?.faces ?? []) this.paint.setFaceWall(face, finish);
  }

  /**
   * Frees every geometry and material this builder created: everything under
   * the group it built, plus the materials it holds outside a mesh. Textures
   * shared by `finishes.ts` (bump clones) are never disposed here.
   */
  dispose(): void {
    const materials = new Set<THREE.Material>(this.ownedMaterials);
    this.paint.collectMaterials(materials);
    // Library surfaces give their maps back to the texture source and free
    // their own materials; the pass below must not dispose a shared map.
    const released = this.paint.releaseLibrary();
    for (const material of released) materials.delete(material);
    this.builtRoot?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!released.has(material)) materials.add(material);
      }
    });
    for (const material of materials) disposeMaterial(material);
    this.ownedMaterials.length = 0;
    this.paint.clear();
    this.builtRoot = null;
  }

  // ---------------------------------------------------------------- site ----

  private buildSiteBase(root: THREE.Group): void {
    const bounds = this.ctx.plan.bounds;
    const width = bounds.maxX - bounds.minX + 2.6;
    const depth = bounds.maxZ - bounds.minZ + 2.6;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.34, depth),
      new THREE.MeshStandardMaterial({ color: '#9d8f7c', roughness: 0.9 }),
    );
    slab.position.set((bounds.minX + bounds.maxX) / 2, -0.171, (bounds.minZ + bounds.maxZ) / 2);
    slab.name = 'site-slab';
    slab.receiveShadow = true;
    root.add(slab);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(36, 48), new THREE.MeshStandardMaterial({ color: '#b7a893', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((bounds.minX + bounds.maxX) / 2, -0.462, (bounds.minZ + bounds.maxZ) / 2);
    ground.name = 'site-ground';
    ground.receiveShadow = true;
    root.add(ground);
  }

  // -------------------------------------------------- floors and ceilings ----

  private buildFloors(root: THREE.Group): void {
    for (const roomFace of this.ctx.plan.rooms) {
      const room = this.ctx.roomsById.get(roomFace.roomId);
      if (!room) continue;
      // Notched through the doorways (`floor-outline.ts`), so no strip of site
      // slab shows under a door and the two floors meet on the centreline.
      const outline = floorOutline(this.ctx.plan, this.ctx.scene, room.id);
      // The slab sits in the site slab: only its top can be seen (`shell-unseen.ts`).
      const geometry = this.slabGeometry(outline, 0, FLOOR_SLAB, { bottom: true, sides: true });
      const material = geometry ? this.paint.floorMaterialForRoom(room.id, outline) : null;
      if (!geometry || !material) {
        geometry?.dispose();
        continue;
      }
      const floor = new THREE.Mesh(geometry, material);
      floor.name = `floor-${room.id}`;
      floor.userData['roomId'] = room.id;
      floor.userData['surface'] = 'floor';
      floor.userData['navigable'] = true;
      floor.receiveShadow = true;
      root.add(floor);
      this.paint.registerFloor(room.id, floor, outline);
    }
  }

  private buildCeilings(root: THREE.Group): void {
    for (const roomFace of this.ctx.plan.rooms) {
      const room = this.ctx.roomsById.get(roomFace.roomId);
      if (!room || effectiveRoom(room).kind === 'loggia') continue;
      const geometry = this.polygonCap(roomFace.polygon, this.ctx.scene.ceilingHeight, false);
      if (!geometry) continue;
      // A room that names a ceiling finish gets its own material; every other one shares the plaster.
      const ceiling = new THREE.Mesh(geometry, this.paint.ceilingMaterialFor(room.id) ?? this.ceilingMaterial);
      this.paint.registerCeiling(room.id, ceiling, this.ceilingMaterial);
      ceiling.name = `ceiling-${room.id}`;
      ceiling.visible = false;
      ceiling.userData['isCeiling'] = true;
      ceiling.userData['roomId'] = room.id;
      root.add(ceiling);
    }
  }

  /**
   * Triangulated plan polygon laid flat at `y`. `ShapeGeometry` already emits
   * world-metre UVs, and mapping its `(x, y)` onto `(x, z)` reverses
   * orientation, so an up-facing cap gets its triangles swapped back.
   */
  private polygonCap(polygon: readonly Vec2[], y: number, up: boolean): THREE.BufferGeometry | null {
    if (polygon.length < 3) return null;
    const shape = new THREE.Shape(polygon.map((point) => new THREE.Vector2(point.x, point.z)));
    const source = new THREE.ShapeGeometry(shape);
    const flat = source.toNonIndexed();
    source.dispose();
    const position = flat.getAttribute('position');
    const uv = flat.getAttribute('uv');
    const positions: number[] = [];
    const uvs: number[] = [];
    const order = up ? [0, 2, 1] : [0, 1, 2];
    for (let i = 0; i + 2 < position.count; i += 3) {
      for (const k of order) {
        const j = i + k;
        positions.push(position.getX(j), y, position.getY(j));
        uvs.push(uv.getX(j), uv.getY(j));
      }
    }
    flat.dispose();
    if (positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }

  /** Solid slab: top cap at `yTop`, bottom cap below it, and the side quads; `unseen` names the parts no walk sees. */
  private slabGeometry(
    polygon: readonly Vec2[],
    yTop: number,
    thickness: number,
    unseen: { bottom: boolean; sides: boolean },
  ): THREE.BufferGeometry | null {
    const parts: THREE.BufferGeometry[] = [];
    const flags: Uint8Array[] = [];
    const top = this.polygonCap(polygon, yTop, true);
    const bottom = this.polygonCap(polygon, yTop - thickness, false);
    const sides = this.slabSides(polygon, yTop, thickness);
    for (const [part, hidden] of [
      [top, false],
      [bottom, unseen.bottom],
      [sides, unseen.sides],
    ] as const) {
      if (!part) continue;
      parts.push(part);
      flags.push(flagsOf(part.getAttribute('position').count / 3, hidden ? 1 : 0));
    }
    if (parts.length === 0) return null;
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (merged) recordUnseen(merged, concatFlags(flags));
    return merged;
  }

  private slabSides(polygon: readonly Vec2[], yTop: number, thickness: number): THREE.BufferGeometry | null {
    const positions: number[] = [];
    const uvs: number[] = [];
    const yBottom = yTop - thickness;
    let u = 0;
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      const length = dist(a, b);
      if (length <= EPS) continue;
      const u0 = u;
      const u1 = u + length;
      u = u1;
      // Room loops are positively oriented, so this winding faces -leftN, i.e.
      // away from the room and out of the slab.
      positions.push(a.x, yTop, a.z, b.x, yTop, b.z, b.x, yBottom, b.z);
      uvs.push(u0, yTop, u1, yTop, u1, yBottom);
      positions.push(a.x, yTop, a.z, b.x, yBottom, b.z, a.x, yBottom, a.z);
      uvs.push(u0, yTop, u1, yBottom, u0, yBottom);
    }
    if (positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }

  // ----------------------------------------------------------- wall faces ----

  private buildFace(root: THREE.Group, face: WallFace): void {
    const wall = this.ctx.wallsById.get(face.wallId);
    if (!wall) return;
    const depth = FACE_DEPTH_RATIO * wall.thickness;
    const segments = faceSegments(face);
    const normals = segmentNormals(segments);
    const parts: THREE.BufferGeometry[] = [];
    const flags: Uint8Array[] = [];
    const ends = faceEndsCovered(face, this.ctx.scene, this.ctx.plan);
    segments.forEach((segment, index) => {
      for (const quad of face.quads) {
        const from = Math.max(quad.t0, segment.t0);
        const to = Math.min(quad.t1, segment.t0 + segment.length);
        if (to - from <= EPS) continue;
        const local: FaceQuad = { ...quad, t0: from - segment.t0, t1: to - segment.t0 };
        parts.push(this.prismGeometry(local, face.t0 + segment.t0, depth, segment, normals[index]!, face));
        // A cap where a chord boundary cuts the quad is covered by the same quad's next prism.
        flags.push(
          prismFlags(quad, {
            start: from > quad.t0 + EPS || capCovered(face, quad, 'start', ends.start),
            end: to < quad.t1 - EPS || capCovered(face, quad, 'end', ends.end),
          }),
        );
      }
    });
    for (const opening of face.openings) {
      if (opening.shape !== 'arch') continue;
      const spandrel = this.archSpandrel(face, opening, segments);
      if (!spandrel) continue;
      parts.push(spandrel);
      flags.push(flagsOf(spandrel.getAttribute('position').count / 3, 0));
    }
    if (parts.length === 0) return;
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) return;
    recordUnseen(geometry, concatFlags(flags));
    const mesh = new THREE.Mesh(geometry, this.paint.materialForFace(face));
    mesh.name = 'wall-face';
    const outward = face.roomId === null ? face.normal : { x: -face.normal.x, z: -face.normal.z };
    mesh.userData['surface'] = 'wall';
    mesh.userData['face'] = face.key;
    mesh.userData['wallId'] = face.wallId;
    mesh.userData['roomId'] = face.roomId ?? undefined;
    mesh.userData['isExteriorWall'] = face.roomId === null;
    mesh.userData['outwardNormal'] = { x: outward.x, z: outward.z };
    mesh.userData['resolveRoomId'] = () => face.roomId;
    mesh.userData['resolveFace'] = () => face.key;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    this.paint.registerFace(face.key, mesh);
  }

  /**
   * The solid core of every junction, full height.
   *
   * Face prisms stop at the mitred ends of their face, so the wall body around
   * a node — the slice a partition cuts out of a through-wall's face at a
   * T-junction, the wedge between two mitred ends at a corner — is built by no
   * face. `plan-joints` returns exactly that polygon per node; extruded from
   * the floor to the ceiling it makes the junction watertight, which is what
   * the dollhouse view shows on the wall tops.
   *
   * A core is not a painting unit: it carries no `surface`, so it is not
   * pickable and no finish can be scoped to it. `wallIds` names every wall
   * meeting there, which is how the dollhouse decides to hide it.
   */
  private buildJoints(root: THREE.Group): void {
    const height = this.ctx.scene.ceilingHeight;
    for (const core of jointCores(this.ctx.scene)) {
      const geometry = this.slabGeometry(core.polygon, height, height, { bottom: true, sides: false });
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.jointMaterial);
      mesh.name = `joint-${core.nodeId}`;
      mesh.userData['wallJoint'] = true;
      mesh.userData['nodeId'] = core.nodeId;
      mesh.userData['wallIds'] = [...core.wallIds];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
  }

  /**
   * One quad extruded into the wall and placed in the world.
   *
   * A `jog` step (two collinear walls of different thickness) leaves the
   * thicker wall's end exposed towards the thinner one. No extra cap is needed:
   * the prism is a CLOSED box, so its start cap already covers the step over
   * the full `FACE_DEPTH_RATIO x thickness` depth, which is wider than the
   * step itself (half the thickness difference).
   */
  private prismGeometry(
    quad: FaceQuad,
    faceT0: number,
    depth: number,
    segment: FaceSegment,
    ends: { start: Vec2; end: Vec2 },
    face: WallFace,
  ): THREE.BufferGeometry {
    const prism = quadPrism(quad, faceT0, depth);
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(prism.positions, 3));
    indexed.setAttribute('uv', new THREE.Float32BufferAttribute(prism.uvs, 2));
    indexed.setIndex(prism.indices);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    this.placeGeometry(geometry, segment, ends);
    if (face.arc) this.applyArcNormals(geometry, face);
    return geometry;
  }

  /**
   * Face-local geometry to world. Normals are computed AFTER the placement:
   * the local frame is mirrored (`+z` into the wall), so a normal computed in
   * face-local space would come out inverted.
   *
   * The extrusion direction is interpolated between the run's two end normals
   * (`segmentNormals`), so two prisms that meet at a polyline vertex — the
   * chords of an arc, or two quads split by an opening — push their back
   * corners to the same point and leave no slot between them.
   */
  private placeGeometry(
    geometry: THREE.BufferGeometry,
    segment: FaceSegment,
    ends: { start: Vec2; end: Vec2 } = { start: segment.normal, end: segment.normal },
  ): void {
    const position = geometry.getAttribute('position');
    const mitred = dist(ends.start, ends.end) > EPS;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      let normal = ends.start;
      if (mitred) {
        const k = clamp(x / segment.length, 0, 1);
        normal = norm({
          x: ends.start.x + (ends.end.x - ends.start.x) * k,
          z: ends.start.z + (ends.end.z - ends.start.z) * k,
        });
      }
      const world = placeFaceLocal({ x, y: position.getY(i), z: position.getZ(i) }, segment.start, segment.tangent, normal);
      position.setXYZ(i, world.x, world.y, world.z);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /**
   * Smooth shading for curved walls: the first six vertices of a placed prism
   * are its front plane and the next six its back plane (see `quadPrism`'s
   * index order). Both get the analytic radial normal of `face.arc`, so
   * neighbouring chords share it exactly and the bay reads as a cylinder.
   */
  private applyArcNormals(geometry: THREE.BufferGeometry, face: WallFace): void {
    const arc = face.arc;
    if (!arc) return;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    // `plan-solver` builds the face normal as `radial * -sign(sweep)`.
    const sign = -(Math.sign(arc.sweep) || 1);
    const count = Math.min(12, position.count);
    for (let i = 0; i < count; i += 1) {
      const dx = position.getX(i) - arc.centre.x;
      const dz = position.getZ(i) - arc.centre.z;
      const length = Math.hypot(dx, dz);
      if (length <= EPS) continue;
      const s = i < 6 ? sign : -sign;
      normal.setXYZ(i, (dx / length) * s, 0, (dz / length) * s);
    }
    normal.needsUpdate = true;
  }

  /**
   * Spandrels of an arched opening: the rectangle the quad decomposition cut
   * out, minus the semicircular void. Front plane only — an arch gets no
   * reveal geometry (a deliberate fallback).
   */
  private archSpandrel(face: WallFace, opening: FaceOpening, segments: FaceSegment[]): THREE.BufferGeometry | null {
    const width = opening.t1 - opening.t0;
    const spring = opening.head - width / 2;
    if (width <= EPS || spring <= opening.sill + EPS) return null;
    const middle = (opening.t0 + opening.t1) / 2;
    const segment = segments.find((s) => middle >= s.t0 - EPS && middle <= s.t0 + s.length + EPS) ?? segments[0];
    if (!segment) return null;
    const x0 = opening.t0 - segment.t0;
    const x1 = opening.t1 - segment.t0;
    const shape = new THREE.Shape();
    shape.moveTo(x0, opening.sill);
    shape.lineTo(x1, opening.sill);
    shape.lineTo(x1, opening.head);
    shape.lineTo(x0, opening.head);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(x0, opening.sill);
    hole.lineTo(x0, spring);
    hole.absarc((x0 + x1) / 2, spring, width / 2, Math.PI, 0, true);
    hole.lineTo(x1, opening.sill);
    hole.closePath();
    shape.holes.push(hole);
    const source = new THREE.ShapeGeometry(shape, 24);
    const geometry = source.toNonIndexed();
    source.dispose();
    // ShapeGeometry UVs are the shape's own (x, y); shift them into face UVs.
    const uv = geometry.getAttribute('uv');
    const shift = face.t0 + segment.t0;
    for (let i = 0; i < uv.count; i += 1) uv.setX(i, uv.getX(i) + shift);
    uv.needsUpdate = true;
    this.placeGeometry(geometry, segment);
    return geometry;
  }

  // ------------------------------------------------------------ baseboard ----

  /** Baseboard along an interior face, broken at its doorways. */
  private buildSkirting(root: THREE.Group, face: WallFace): void {
    if (face.roomId === null) return;
    const segments = faceSegments(face);
    // A room that names a trim finish gets its own baseboard material; every other one shares the default.
    const trim = this.paint.trimMaterialFor(face.roomId) ?? this.trimMaterial;
    const parts: THREE.BufferGeometry[] = [];
    for (const [from, to] of this.skirtingSpans(face)) {
      for (const segment of segments) {
        const a = Math.max(from, segment.t0);
        const b = Math.min(to, segment.t0 + segment.length);
        if (b - a <= 0.02) continue;
        const centre = placeFaceLocal(
          { x: (a + b) / 2 - segment.t0, y: SKIRTING_HEIGHT / 2, z: -SKIRTING_DEPTH / 2 },
          segment.start,
          segment.tangent,
          segment.normal,
        );
        const box = new THREE.BoxGeometry(b - a, SKIRTING_HEIGHT, SKIRTING_DEPTH);
        metreBoardUVs(box, { centreU: face.t0 + (a + b) / 2, height: SKIRTING_HEIGHT, depth: SKIRTING_DEPTH });
        // rotation.y = t maps local +X to (cos t, 0, -sin t) and local +Z to the
        // face normal, so the board stands in front of the wall.
        const matrix = new THREE.Matrix4().makeRotationY(Math.atan2(-segment.tangent.z, segment.tangent.x));
        matrix.setPosition(centre.x, centre.y, centre.z);
        box.applyMatrix4(matrix);
        parts.push(box);
      }
    }
    if (parts.length === 0) return;
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) return;
    recordUnseen(geometry, concatFlags(parts.map(() => SKIRTING_BOX_FLAGS)));
    const board = new THREE.Mesh(geometry, trim);
    board.name = 'wall-face-skirting';
    // No `surface` key: the baseboard is not a paintable pick target.
    board.userData['face'] = face.key;
    board.userData['wallId'] = face.wallId;
    board.castShadow = false;
    board.receiveShadow = true;
    root.add(board);
    this.paint.registerTrim(face.roomId, board, this.trimMaterial);
  }

  /** `[from, to]` runs of the face that carry a baseboard (doorways removed). */
  private skirtingSpans(face: WallFace): Array<[number, number]> {
    const doors = face.openings.filter((opening) => isDoorLike(opening.type)).sort((a, b) => a.t0 - b.t0);
    const spans: Array<[number, number]> = [];
    let cursor = 0;
    for (const door of doors) {
      if (door.t0 - cursor > EPS) spans.push([cursor, Math.min(door.t0, face.length)]);
      cursor = Math.max(cursor, door.t1);
    }
    if (face.length - cursor > EPS) spans.push([cursor, face.length]);
    return spans;
  }
}

/**
 * Replaces a baseboard box's normalised UVs with metre ones (`boardUV`), in
 * the box's own frame before it is placed, so a trim material tiles at its
 * `tileM` like every other room surface.
 */
function metreBoardUVs(box: THREE.BoxGeometry, frame: BoardFrame): void {
  const position = box.getAttribute('position');
  const normal = box.getAttribute('normal');
  const uv = box.getAttribute('uv');
  for (let index = 0; index < uv.count; index += 1) {
    const [u, v] = boardUV(
      { x: position.getX(index), y: position.getY(index), z: position.getZ(index) },
      { x: normal.getX(index), y: normal.getY(index), z: normal.getZ(index) },
      frame,
    );
    uv.setXY(index, u, v);
  }
  uv.needsUpdate = true;
}

/** Frees a material and the colour map cloned for it; shared bump clones stay. */
function disposeMaterial(material: THREE.Material): void {
  const standard = material as THREE.MeshStandardMaterial;
  standard.map?.dispose();
  material.dispose();
}
