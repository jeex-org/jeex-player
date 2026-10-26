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

import { add, mul, norm, sub } from '../plan/plan-geometry.js';
import { roomOf } from '../plan/plan-rooms.js';
import { polylineSlabs } from './layout-geometry.js';
import { obbQuad, polylineSlice, type Obb } from '../plan/plan-geometry.js';
import { resolveDoorSwing } from '../plan/door-swing.js';
import { openingFrameWidth } from '../assets/opening-frame.js';
import { projectAssetFacts, shippedAssetFacts, type AssetFactsSource } from '../assets/asset-facts.js';
import {
  scaleSurfaces,
  type AssetLayout,
  type KneeSpace,
  type SurfaceFacts,
  type SurfaceTop,
  type TuckFacts,
} from '../assets/asset-types.js';
import { footprintOf } from '../assets/asset-footprint.js';
import { LAYOUT_RULES } from './rules/index.js';
import { clearZonesOf } from './rules/doors.js';
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

/* ------------------------------------------------------ context building --- */

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
 * `LayoutFacts` over one bank (`assets/asset-facts.ts`): the adapter every
 * layout catalogue is, so the linter, the free-space probe and the drag tool
 * read a placement exactly as the walk and the plan do — the same archetype,
 * the same size variant, the same floor footprint (`layout.footprint` as a
 * fraction, the 0.15 m blocking-height rule, the placement scale).
 *
 * `dims` stay the archetype's own (the overall box for a baked project): the
 * height and mount rules measure the whole body, only the FOOTPRINT is the
 * floor share.
 */
export function layoutCatalogueOf(source: AssetFactsSource): LayoutCatalogue {
  return (placement) => {
    const facts = source(placement);
    if (!facts) return null;
    return {
      archetype: facts.archetype,
      anchor: facts.anchor,
      wallSnap: facts.wallSnap,
      clearance: facts.clearance,
      dims: facts.dims,
      yaw: facts.yaw,
      layout: facts.layout,
      footprint: facts.anchor === 'floor' ? footprintOf(placement, source) : null,
      mirror: facts.mirror,
      surfaces: facts.surfaces,
    };
  };
}

/**
 * The catalogue facts one placement needs, read from the shipped object bank.
 *
 * Exported because it is the DEFAULT bank, and a caller that asks the bank a
 * question of its own (`free-space.ts`, which needs the facts of an asset that
 * is not in the scene yet) must be able to name the same default the linter
 * uses instead of reaching into `assets/` from the `layout` layer.
 */
export const shippedFacts: LayoutCatalogue = layoutCatalogueOf(shippedAssetFacts);

/**
 * The same facts read from a BAKED PROJECT's library, the shipped bank behind
 * it (`projectAssetFacts`).
 *
 * A project object has no legacy alias of its own (so no `yaw`), it is
 * addressed by archetype id or by variant id, and its `dims` are its overall
 * bounding box: the floor footprint is that box times `layout.footprint` when
 * the archetype declares one, and a floor object lower than 0.15 m
 * (`layout.blockingHeight` when declared) has none, exactly as in the shipped
 * bank. A placement the manifest does not carry is read against the SHIPPED
 * bank, the same fallback the render path and the validator have.
 */
export function projectLayoutCatalogue(library: {
  readonly objects: readonly {
    readonly id: string;
    readonly anchor: 'floor' | 'wall' | 'ceiling';
    readonly category?: string;
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
  return layoutCatalogueOf(projectAssetFacts(library));
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

/** One side of a door that rule 3 keeps clear: the door, the room on that side, and the rectangle. */
export type DoorClearZone = { openingId: string; roomId: string; quad: Vec2[] };

/**
 * The clear zones rule 3 (`door-clear-zone`) checks, one per door side that
 * owns a room: 0.9 m deep where the leaf swings in and on both sides of a
 * passage, 0.6 m where it swings away. A host's own cheap placement filter
 * reads these rather than sizing a door's zone itself, so it never disagrees
 * with the lint.
 */
export function doorClearZones(scene: SceneData, plan: SolvedPlan): DoorClearZone[] {
  return clearZonesOf(doorsOf(scene, plan)).map((zone) => ({ openingId: zone.door.openingId, roomId: zone.roomId, quad: [...zone.quad] }));
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
