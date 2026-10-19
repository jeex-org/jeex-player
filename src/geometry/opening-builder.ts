/**
 * Windows, doors and passages: one group per `Opening`, built from an
 * `OpeningVariant` and replaceable in place.
 *
 * This module is the REGISTRY and the LIFECYCLE — where an opening sits on its
 * wall, which variant it wears, how it is spawned, listed, replaced and freed.
 * What each kind of opening actually looks like lives in `opening-kinds.ts`,
 * one `OpeningKind` per `OpeningType`, so nothing here branches on
 * `opening.type` any more.
 *
 * Invariant: a group owns only the materials it created (`OpeningRecord.materials`);
 * shared materials — the pick proxy and the brass handle stock — belong to this
 * builder and are freed by `dispose`, never by a rebuild. A rebuild therefore
 * touches one opening and leaves the wall faces, the skirting and every other
 * opening untouched.
 */

import * as THREE from 'three';
import type { BuilderContext } from './builder-context.js';
import { effectiveOpening } from '../plan/plan-openings.js';
import type { ArcDef } from '../plan/plan-geometry.js';
import { EPS, arcFromChord, arcLength, arcPointAt, arcTangent, dot, leftN, norm, sub } from '../plan/plan-geometry.js';
import { clamp } from '../shared/math.js';
import { defaultOpeningVariant, findOpeningVariant, variantFamily, type OpeningVariant } from '../assets/opening-variants.js';
import { OPENING_BUILDERS, type OpeningBuildContext, type OpeningPlacement } from './opening-kinds.js';
import type { Opening, OpeningType, Vec2, Vec3, Wall } from '../scene/types.js';

/** A built opening group plus everything needed to rebuild it in place. */
type OpeningRecord = {
  wall: Wall;
  opening: Opening;
  placement: OpeningPlacement;
  /** Group the opening was added to (the parametric shell). */
  parent: THREE.Group;
  variantId: string;
  group: THREE.Group;
  /** Point in group space that a click must hit to select the opening. */
  pickLocal: Vec3;
  /** Materials created for this group only; shared builder materials are not listed. */
  materials: THREE.Material[];
};

/** One row of `OpeningBuilder.list`. */
export type OpeningListEntry = {
  id: string;
  type: OpeningType;
  wallId: string;
  entrance: boolean;
  variant: string;
  /** Centre of the opening rectangle, in world metres. */
  center: Vec3;
  /** World point that reliably hits this opening's pick proxy (jamb band for doors). */
  pick: Vec3;
};

export class OpeningBuilder {
  private readonly ctx: BuilderContext;
  private readonly openingRecords = new Map<string, OpeningRecord>();
  /** Shared, fully transparent material of the opening pick proxies. */
  private readonly openingPickMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  private readonly brassMaterial = new THREE.MeshStandardMaterial({ color: '#b08d4f', roughness: 0.34, metalness: 0.88 });

  constructor(ctx: BuilderContext) {
    this.ctx = ctx;
  }

  /** Builds every opening of the scene into `root`. */
  build(root: THREE.Group): void {
    this.buildOpenings(root);
  }

  /** Frees every opening group plus the materials shared between them. */
  dispose(): void {
    for (const record of [...this.openingRecords.values()]) this.disposeOpeningGroup(record);
    this.openingRecords.clear();
    this.openingPickMaterial.dispose();
    this.brassMaterial.dispose();
  }

  // ------------------------------------------------------ doors & windows ----

  private buildOpenings(root: THREE.Group): void {
    for (const wall of this.ctx.scene.walls) {
      for (const opening of wall.openings ?? []) {
        const placement = this.openingPlacement(wall, opening);
        if (!placement) continue;
        const entrance = opening.entrance === true;
        const variant = (opening.variant ? findOpeningVariant(opening.variant) : null) ?? defaultOpeningVariant(opening.type, entrance);
        this.spawnOpening(root, wall, opening, placement, variant);
      }
    }
  }

  /** The build context one kind is handed: the placement plus the shared stock. */
  private buildContext(wall: Wall, opening: Opening, placement: OpeningPlacement, variant: OpeningVariant): OpeningBuildContext {
    return { builder: this.ctx, wall, opening, placement, variant, handleMaterial: this.brassMaterial };
  }

  /**
   * Builds one opening group and records everything `rebuildOpening` needs to
   * replace it in place: the parent, the placement, and the materials this
   * group owns (shared `materialMap` entries are never disposed).
   */
  private spawnOpening(
    parent: THREE.Group,
    wall: Wall,
    opening: Opening,
    placement: OpeningPlacement,
    variant: OpeningVariant,
  ): THREE.Group {
    const entrance = opening.entrance === true;
    const kind = OPENING_BUILDERS[opening.type];
    const context = this.buildContext(wall, opening, placement, variant);
    let pickLocal: Vec3 = { x: 0, y: (placement.sill + placement.head) / 2, z: 0 };
    const built = kind.build(context);
    const group = built.group;
    const height = placement.head - placement.sill;
    Object.assign(group.userData, {
      surface: 'opening',
      openingId: opening.id,
      wallId: wall.id,
      openingType: opening.type,
      entrance,
      isExteriorWall: this.ctx.exteriorWallIds.has(wall.id),
    });
    // Invisible pick proxies, in the group's own frame: each kind decides
    // where a click may land on it (a window over its pane, a doorway only on
    // its jambs and head, so a click travels through the opening).
    if (opening.width > EPS && height > EPS) {
      const point = kind.pickLocal(context);
      pickLocal = { x: point.x, y: point.y, z: point.z };
      for (const box of kind.pickBoxes(context)) {
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(box.width, box.height, box.depth), this.openingPickMaterial);
        proxy.name = `${opening.id}-pick`;
        proxy.position.set(box.x, box.y, box.z);
        proxy.rotation.y = box.rotationY;
        proxy.castShadow = false;
        proxy.receiveShadow = false;
        Object.assign(proxy.userData, group.userData);
        if (box.part) proxy.userData['openingPart'] = box.part;
        group.add(proxy);
      }
      // The leaf is the obvious click target of a door; tag its meshes too.
      for (const child of group.children) {
        if (!child.userData['isDoorLeaf']) continue;
        child.traverse((object) => {
          if (object instanceof THREE.Mesh) Object.assign(object.userData, group.userData);
        });
      }
    }
    parent.add(group);
    this.openingRecords.set(opening.id, {
      wall,
      opening,
      placement,
      parent,
      variantId: variant.id,
      group,
      pickLocal,
      materials: built.materials,
    });
    return group;
  }

  /** Frees the geometries of an opening group and the materials it owns. */
  private disposeOpeningGroup(record: OpeningRecord): void {
    record.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    for (const material of record.materials) {
      const standard = material as THREE.MeshStandardMaterial;
      // Colour maps are cloned per material and belong to it; `bumpMap` is a
      // shared clone owned by `finishes.ts` (see its `bumpClones` cache) and
      // must never be disposed from here.
      standard.map?.dispose();
      material.dispose();
    }
    record.group.removeFromParent();
  }

  /**
   * Replaces one window or door with another variant of the same kind. Only
   * that opening's group is rebuilt: wall faces, skirting and every other
   * opening stay untouched.
   */
  rebuildOpening(openingId: string, variantId: string): boolean {
    const record = this.openingRecords.get(openingId);
    if (!record) return false;
    const variant = findOpeningVariant(variantId);
    if (!variant || variant.for !== variantFamily(record.opening.type)) return false;
    if (record.variantId === variantId) return true;
    this.disposeOpeningGroup(record);
    this.spawnOpening(record.parent, record.wall, record.opening, record.placement, variant);
    return true;
  }

  /** `pickLocal` of a record in world coordinates. */
  private worldPickPoint(record: OpeningRecord): Vec3 {
    record.group.updateMatrixWorld();
    const point = record.group.localToWorld(new THREE.Vector3(record.pickLocal.x, record.pickLocal.y, record.pickLocal.z));
    return { x: point.x, y: point.y, z: point.z };
  }

  /** Variant id currently shown for an opening, or `null` when it is unknown. */
  variantOf(openingId: string): string | null {
    return this.openingRecords.get(openingId)?.variantId ?? null;
  }

  /** The group of one opening, so callers can re-register its pick meshes. */
  groupOf(openingId: string): THREE.Group | null {
    return this.openingRecords.get(openingId)?.group ?? null;
  }

  /** Every built opening with the data needed to find and click it. */
  list(): Array<OpeningListEntry> {
    const list: OpeningListEntry[] = [];
    for (const record of this.openingRecords.values()) {
      list.push({
        id: record.opening.id,
        type: record.opening.type,
        wallId: record.wall.id,
        entrance: record.opening.entrance === true,
        variant: record.variantId,
        center: {
          x: record.placement.point.x,
          y: (record.placement.sill + record.placement.head) / 2,
          z: record.placement.point.z,
        },
        pick: this.worldPickPoint(record),
      });
    }
    return list;
  }

  /** Centre point, orientation and heights of an opening on its centreline. */
  private openingPlacement(wall: Wall, opening: Opening): OpeningPlacement | null {
    const a = this.ctx.nodesById.get(wall.a);
    const b = this.ctx.nodesById.get(wall.b);
    if (!a || !b) return null;
    let point: Vec2;
    let tangent: Vec2;
    let arc: ArcDef | undefined;
    let span: { t0: number; t1: number } | undefined;
    if (wall.arc) {
      arc = arcFromChord(a.p, b.p, wall.arc.radius, wall.arc.ccw);
      const total = arcLength(arc);
      const angle = arc.a0 + arc.sweep * (total > EPS ? opening.center / total : 0);
      point = arcPointAt(arc, angle);
      tangent = arcTangent(arc, angle);
      span = {
        t0: clamp(opening.center - opening.width / 2, 0, total),
        t1: clamp(opening.center + opening.width / 2, 0, total),
      };
    } else {
      const direction = norm(sub(b.p, a.p));
      point = { x: a.p.x + direction.x * opening.center, z: a.p.z + direction.z * opening.center };
      tangent = direction;
    }
    // The ONE projection of an authored opening onto metres, shared with the
    // solver: re-deriving the defaults here let the frame reach the raw ceiling
    // while the wall was cut `CEILING_OPENING_MARGIN` lower.
    const { sill, head } = effectiveOpening(opening, this.ctx.scene.ceilingHeight);
    const normal = this.interiorNormalOf(wall, tangent);
    // Which side of the circle the room is on decides where the sill board goes.
    const interiorOutward: 1 | -1 | undefined = arc ? (dot(normal, norm(sub(point, arc.centre))) >= 0 ? 1 : -1) : undefined;
    return {
      point,
      angleY: Math.atan2(tangent.z, tangent.x),
      normal,
      sill,
      head,
      arc,
      t0: span?.t0,
      t1: span?.t1,
      interiorOutward,
    };
  }

  /** Normal of the room-owning side of a wall; `leftN` when both sides are facade. */
  private interiorNormalOf(wall: Wall, tangent: Vec2): Vec2 {
    const faces = this.ctx.facesByWall.get(wall.id) ?? [];
    const interior = faces.find((face) => face.roomId !== null);
    return interior ? interior.normal : leftN(tangent);
  }
}
