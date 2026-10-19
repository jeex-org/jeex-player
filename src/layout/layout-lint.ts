/**
 * Furniture layout linter: builds the context every rule reads, dispatches
 * over `LAYOUT_RULES`, and reports.
 *
 * The rules themselves live one group per file under `src/layout/rules/` —
 * the hard rules 1-7 and the soft rules 8-14, listed hard ones first in
 * `LAYOUT_RULES`. This module
 * knows how to turn a `SceneData` plus its `SolvedPlan` into the plan geometry
 * they all share (footprint OBBs from the object bank, wall slabs with the
 * door voids cut out, door records with their swings) and nothing about what
 * any single rule means.
 *
 * Invariant: an `error` is a physical impossibility (something inside a wall,
 * two solids in the same place, a door that cannot open or be reached); a
 * `warning` is a design rule a human may overrule. Both carry the ids and a
 * plan point, so a report can name and locate them.
 *
 * Pure module: no `three`, no DOM.
 */

import { add, mul, norm, pointInPolygon, sub } from '../plan/plan-geometry.js';
import { polylineSlabs } from './layout-geometry.js';
import { obbQuad, polylineSlice, type Obb } from '../plan/plan-geometry.js';
import { resolveDoorSwing } from '../plan/door-swing.js';
import { openingFrameWidth } from '../assets/opening-frame.js';
import { findCatalogueEntry, parseAssetRef } from '../assets/asset-catalogue.js';
import {
  scaleSurfaces,
  surfacesAt,
  type AssetLayout,
  type KneeSpace,
  type SurfaceFacts,
  type SurfaceTop,
  type TuckFacts,
} from '../assets/asset-types.js';
import { footprintOf } from '../assets/asset-footprint.js';
import { LAYOUT_RULES } from './rules/index.js';
import { layoutRuleOrder, LAYOUT_RULE_IDS } from './rules/context.js';
import type { DoorZone, LayoutIssue, LayoutRule, LintContext, LintItem, Solid } from './rules/context.js';
import type { SolvedPlan, WallFace } from '../plan/plan-solver.js';
import {
  effectiveAsset,
  footprintScaleOf,
  isDoorLike,
  type DemoAsset,
  type MirrorFacts,
  type SceneData,
  type Vec2,
  type Wall,
} from '../scene/types.js';
import { frontOf } from '../scene/mirror.js';

export type { LayoutIssue, LayoutRule, LintContext, LintItem } from './rules/context.js';
export { LAYOUT_RULE_IDS } from './rules/context.js';

/** A slab shorter than this along the wall is a numerical artefact, not a run. */
const RUN_EPS_M = 1e-4;
/** Comfort gap a project object that declares none asks for, metres. */
const DEFAULT_CLEARANCE_M = 0.6;

/* ------------------------------------------------------ context building --- */

/** The room a plan point stands in, `null` outside every room polygon. */
export function roomOf(plan: SolvedPlan, point: Vec2): string | null {
  for (const room of plan.rooms) {
    // The bounding box first: a drag's mask asks this for thousands of points.
    const box = room.bbox;
    if (point.x < box.minX || point.x > box.maxX || point.z < box.minZ || point.z > box.maxZ) continue;
    if (pointInPolygon(point, room.polygon)) return room.roomId;
  }
  return null;
}

/**
 * What the linter reads of the object bank for ONE placement.
 *
 * The narrowest thing every rule needs, and nothing else: the archetype it
 * belongs to, where it is anchored, how big it is, the facing compensation a
 * legacy alias carries, its layout facts, and its footprint on the floor.
 */
export type LayoutFacts = {
  archetype: string;
  anchor: 'floor' | 'wall' | 'ceiling';
  /** Rule 8: this archetype belongs with its back to a wall. */
  wallSnap: boolean;
  /** Comfort gap this archetype wants around itself, metres (`CatalogueObject.clearance`). */
  clearance: number;
  dims: readonly [number, number, number];
  yaw: number;
  layout: AssetLayout | undefined;
  /** Half-extents before rotation, scale already applied; `null` for anything not on the floor. */
  footprint: { hx: number; hz: number } | null;
  /** Mirror axes the archetype allows (`CatalogueObject.mirror`); absent allows none. */
  mirror?: MirrorFacts | undefined;
  /** Surfaces and tucking (`rules/surfaces.ts`), at the variant's size; absent = none. */
  surfaces?: SurfaceFacts;
};

/**
 * The bank the linter reads, injected.
 *
 * A baked project's objects live in its manifest, not in the shipped
 * catalogue, and a linter that resolves them against the shipped one reports
 * an empty scene rather than the truth (`projectLayoutCatalogue`). The default
 * is `shippedFacts` below, so every existing caller keeps its two arguments.
 */
export type LayoutCatalogue = (placement: DemoAsset) => LayoutFacts | null;

/**
 * The catalogue facts one placement needs, read straight from the object bank.
 *
 * `asset-resolver` would answer the same question, but it reaches `three`
 * through the finish registry, and this module must stay pure — so the layers
 * that matter here (archetype, size variant, legacy facing yaw, and the
 * archetype's own layout facts) are resolved against `asset-catalogue`
 * directly.
 *
 * Exported because it is the DEFAULT bank, and a caller that asks the bank a
 * question of its own (`free-space.ts`, which needs the facts of an asset that
 * is not in the scene yet) must be able to name the same default the linter
 * uses instead of reaching into `assets/` from the `layout` layer.
 */
export function shippedFacts(placement: DemoAsset): LayoutFacts | null {
  const ref = parseAssetRef(placement.asset ?? placement.type);
  const entry = findCatalogueEntry(ref.assetId);
  if (!entry) return null;
  const wanted = placement.variant ?? entry.variantId;
  const variant = entry.object.variants.find((candidate) => candidate.id === wanted);
  return {
    archetype: entry.object.id,
    anchor: entry.object.anchor,
    wallSnap: entry.object.wallSnap,
    clearance: entry.object.clearance,
    dims: variant?.dims ?? entry.object.dims,
    yaw: entry.yaw ?? 0,
    layout: entry.object.layout,
    footprint: entry.object.anchor === 'floor' ? footprintOf(placement) : null,
    mirror: entry.object.mirror,
    surfaces: surfacesAt(entry.object, entry.object.dims, variant?.dims ?? entry.object.dims),
  };
}

/**
 * The same facts read from a BAKED PROJECT's library.
 *
 * Three differences from the shipped bank, all of them consequences of the
 * format rather than choices: a project object has no legacy alias of its own
 * (so no `yaw`), it is addressed by archetype id or by variant id and by
 * nothing else, and it declares no per-variant collision box — so the
 * footprint is the variant's own `dims`, which is what `asset-footprint.ts`
 * falls back to for the shipped bank as well.
 *
 * A placement the manifest does not carry is read against the SHIPPED bank,
 * the same fallback the render path and the validator have: a
 * project document still holds `type`-only placements no exporter rewrote, and
 * a linter that skipped them reported half a room clear.
 */
export function projectLayoutCatalogue(library: {
  readonly objects: readonly {
    readonly id: string;
    readonly anchor: 'floor' | 'wall' | 'ceiling';
    readonly wallSnap?: boolean;
    readonly clearance?: number;
    readonly dims: readonly [number, number, number];
    readonly layout?: AssetLayout | undefined;
    readonly mirror?: MirrorFacts | undefined;
    readonly onSurface?: true;
    readonly top?: SurfaceTop;
    readonly kneeSpace?: KneeSpace;
    readonly tuck?: TuckFacts;
    readonly defaultVariant: string;
    readonly variants: readonly { readonly id: string; readonly dims?: readonly [number, number, number] | undefined }[];
  }[];
}): LayoutCatalogue {
  const byId = new Map<string, (typeof library.objects)[number]>();
  for (const object of library.objects) {
    byId.set(object.id, object);
    for (const variant of object.variants) byId.set(variant.id, object);
  }
  return (placement) => {
    const ref = parseAssetRef(placement.asset ?? placement.type);
    const object = byId.get(ref.assetId);
    if (!object) return shippedFacts(placement);
    const wanted = placement.variant ?? object.defaultVariant;
    const variant = object.variants.find((candidate) => candidate.id === wanted);
    const dims = variant?.dims ?? object.dims;
    const scale = footprintScaleOf(placement);
    const half = placement.collision ?? { hx: dims[0] / 2, hz: dims[2] / 2 };
    return {
      archetype: object.id,
      anchor: object.anchor,
      wallSnap: object.wallSnap ?? false,
      clearance: object.clearance ?? DEFAULT_CLEARANCE_M,
      dims,
      yaw: 0,
      layout: object.layout,
      footprint: object.anchor === 'floor' ? { hx: half.hx * scale, hz: half.hz * scale } : null,
      mirror: object.mirror,
      surfaces: surfacesAt(object, object.dims, dims),
    };
  };
}

/**
 * One placement as the rules read it, against a solved plan.
 *
 * Exported for `asset-legality.ts`, which judges an object at a pose it is
 * being DRAGGED to: the same reduction, so a drag and a lint can never
 * disagree about where the body is.
 */
export function lintItemOf(placement: DemoAsset, facts: LayoutFacts, plan: SolvedPlan, ceilingHeight: number): LintItem {
  const scale = footprintScaleOf(placement);
  const angle = effectiveAsset(placement).rotationY;
  const facing = angle + facts.yaw;
  const footprint = facts.footprint;
  const box: Obb | null = footprint
    ? { x: placement.position.x, z: placement.position.z, hx: footprint.hx, hz: footprint.hz, angle }
    : null;
  const dims: [number, number, number] = [facts.dims[0] * scale, facts.dims[1] * scale, facts.dims[2] * scale];
  const y = facts.anchor === 'ceiling' && placement.position.y <= 0 ? ceilingHeight : placement.position.y;
  return {
    placement,
    archetype: facts.archetype,
    anchor: facts.anchor,
    dims,
    y,
    angle,
    // A `z` mirror turns the front round.
    front: frontOf(facing, placement.mirror),
    box,
    quad: box ? obbQuad(box) : null,
    roomId: roomOf(plan, { x: placement.position.x, z: placement.position.z }),
    layout: facts.layout,
    mount: mountOf(facts.anchor, placement, dims, angle, y),
    surfaces: facts.surfaces ? scaleSurfaces(facts.surfaces, scale, scale) : {},
  };
}

/**
 * The body of a wall or ceiling item: a wall
 * item's pivot is the centre of its volume, so it spans `y ± height/2`; a
 * ceiling item's is the top of its body, so it spans `y - height .. y`.
 */
function mountOf(
  anchor: LayoutFacts['anchor'],
  placement: DemoAsset,
  dims: readonly [number, number, number],
  angle: number,
  y: number,
): LintItem['mount'] {
  if (anchor === 'floor') return null;
  const quad = obbQuad({ x: placement.position.x, z: placement.position.z, hx: dims[0] / 2, hz: dims[2] / 2, angle });
  return anchor === 'wall' ? { quad, low: y - dims[1] / 2, high: y + dims[1] / 2 } : { quad, low: y - dims[1], high: y };
}

function itemsOf(scene: SceneData, plan: SolvedPlan, catalogue: LayoutCatalogue): LintItem[] {
  const items: LintItem[] = [];
  for (const placement of scene.assets) {
    const facts = catalogue(placement);
    if (facts) items.push(lintItemOf(placement, facts, plan, scene.ceilingHeight));
  }
  return items;
}

/** Wall slabs with the door voids cut out, so a doorway is not "inside a wall". */
function wallSolids(plan: SolvedPlan): Solid[] {
  const solids: Solid[] = [];
  for (const line of plan.centrelines) {
    const cuts = [...line.doors].sort((a, b) => a.t0 - b.t0);
    let cursor = 0;
    const runs: Array<[number, number]> = [];
    for (const cut of cuts) {
      if (cut.t0 - cursor > RUN_EPS_M) runs.push([cursor, cut.t0]);
      cursor = Math.max(cursor, cut.t1);
    }
    if (line.length - cursor > RUN_EPS_M) runs.push([cursor, line.length]);
    for (const [t0, t1] of runs) {
      const slice = polylineSlice(line.polyline, line.length, t0, t1);
      for (const quad of polylineSlabs(slice, line.thickness / 2)) solids.push({ wallId: line.wallId, quad });
    }
  }
  return solids;
}

function nodePoint(scene: SceneData, nodeId: string): Vec2 {
  return scene.nodes.find((node) => node.id === nodeId)!.p;
}

function doorsOf(scene: SceneData, plan: SolvedPlan): DoorZone[] {
  const records: DoorZone[] = [];
  for (const wall of scene.walls) {
    const faces = [...plan.faces.values()].filter((face) => face.wallId === wall.id);
    for (const opening of wall.openings ?? []) {
      if (!isDoorLike(opening.type)) continue;
      const swing = opening.type === 'door' ? resolveDoorSwing(scene, plan, wall, opening, openingFrameWidth) : null;
      const tangent = swing?.tangent ?? faceTangentOf(scene, wall);
      const centre = swing?.centre ?? add(nodePoint(scene, wall.a), mul(faceTangentOf(scene, wall), opening.center));
      const sides = faces
        .filter((face): face is WallFace & { roomId: string } => face.roomId !== null)
        .map((face) => ({ roomId: face.roomId, normal: face.normal }));
      records.push({
        wall,
        openingId: opening.id,
        type: opening.type === 'passage' ? 'passage' : 'door',
        centre,
        tangent,
        width: opening.width,
        thickness: wall.thickness,
        sides,
        swing,
      });
    }
  }
  return records;
}

function faceTangentOf(scene: SceneData, wall: Wall): Vec2 {
  return norm(sub(nodePoint(scene, wall.b), nodePoint(scene, wall.a)));
}

/** Everything every rule reads, prepared once per lint. */
export function lintContext(scene: SceneData, plan: SolvedPlan, catalogue: LayoutCatalogue = shippedFacts): LintContext {
  return { items: itemsOf(scene, plan, catalogue), solids: wallSolids(plan), doors: doorsOf(scene, plan), plan, scene };
}

/* ------------------------------------------------------------------ api --- */

/**
 * Every layout issue of a scene, hard rules first, in rule order.
 *
 * `catalogue` is the object bank the placements are read against; absent, it
 * is the shipped one, which is what every caller before the baked-project
 * format had. A viewer showing a project passes
 * `projectLayoutCatalogue(manifest.library)`.
 */
export function lintLayout(scene: SceneData, plan: SolvedPlan, catalogue?: LayoutCatalogue): LayoutIssue[] {
  const ctx = lintContext(scene, plan, catalogue ?? shippedFacts);
  const issues: LayoutIssue[] = [];
  for (const rule of LAYOUT_RULES) rule.run(ctx, issues);
  return issues.sort((a, b) => layoutRuleOrder(a.rule) - layoutRuleOrder(b.rule) || a.ids.join().localeCompare(b.ids.join()));
}

export type LayoutIssueCounts = { errors: number; warnings: number; byRule: Partial<Record<LayoutRule, number>> };

export function countIssues(issues: readonly LayoutIssue[]): LayoutIssueCounts {
  const byRule: Partial<Record<LayoutRule, number>> = {};
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1;
    if (issue.severity === 'error') errors += 1;
    else warnings += 1;
  }
  return { errors, warnings, byRule };
}

/** Readable report: one line per issue plus a per-rule tally. */
export function describeIssues(issues: readonly LayoutIssue[]): string {
  const counts = countIssues(issues);
  const lines = issues.map(
    (issue) => `rule ${issue.rule} ${issue.severity.padEnd(7)} (${issue.at.x.toFixed(2)}, ${issue.at.z.toFixed(2)})  ${issue.message}`,
  );
  const tally = LAYOUT_RULE_IDS.filter((rule) => counts.byRule[rule] !== undefined)
    .map((rule) => `rule ${rule}: ${counts.byRule[rule]}`)
    .join(', ');
  lines.push(`${counts.errors} error(s), ${counts.warnings} warning(s)${tally ? ` — ${tally}` : ''}`);
  return lines.join('\n');
}
