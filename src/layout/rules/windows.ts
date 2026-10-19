/**
 * Rule 7 (hard): nothing tall stands in front of a window.
 *
 * "Tall" is the height that actually BLOCKS the glass, which is not always the
 * archetype's own `dims[1]`: a counter run's height includes its backsplash,
 * a surface on the wall rather than a volume in front of the pane. That
 * exception is a catalogue fact (`layout.blockingHeight`), so the sink under a
 * window that rule 9 asks for is not a rule 7 error.
 *
 * Pure module: no `three`, no DOM.
 */

import { add, mul, norm, sub } from '../../plan/plan-geometry.js';
import { overlapDepth, quadCentre } from '../layout-geometry.js';
import {
  TOUCH_TOL_M,
  apart,
  sideZone,
  type DoorZone,
  type LayoutIssue,
  type LayoutRuleModule,
  type LintContext,
  type LintItem,
} from './context.js';
import type { SolvedPlan } from '../../plan/plan-solver.js';
import type { SceneData, Vec2, Wall } from '../../scene/types.js';

/** Objects taller than this may not stand in front of a window, metres. */
const TALL_M = 1.2;
/** Band in front of a window that must stay clear of tall objects, metres. */
const WINDOW_CLEAR_M = 0.3;

function nodePoint(scene: SceneData, nodeId: string): Vec2 {
  return scene.nodes.find((node) => node.id === nodeId)!.p;
}

/** A window borrows the door-zone shape so `sideZone` can measure in front of it. */
function windowZone(scene: SceneData, wall: Wall, openingId: string, t: number, width: number): DoorZone {
  const a = nodePoint(scene, wall.a);
  const b = nodePoint(scene, wall.b);
  const tangent = norm(sub(b, a));
  return {
    wall,
    openingId,
    type: 'door',
    centre: add(a, mul(tangent, t)),
    tangent,
    width,
    thickness: wall.thickness,
    sides: [],
    swing: null,
  };
}

/** The band in front of one window on one of its room sides. */
type WindowBand = { openingId: string; quad: Vec2[] };

/**
 * The bands are a function of the plan (and the walls it was solved from)
 * alone; a drag judges one object against them hundreds of times, so they are
 * built once per solved plan.
 */
const bandCache = new WeakMap<SolvedPlan, WindowBand[]>();

function bandsOf(ctx: LintContext): WindowBand[] {
  const cached = bandCache.get(ctx.plan);
  if (cached) return cached;
  const bands: WindowBand[] = [];
  for (const wall of ctx.scene.walls) {
    const faces = [...ctx.plan.faces.values()].filter((face) => face.wallId === wall.id && face.roomId !== null);
    for (const opening of wall.openings ?? []) {
      if (opening.type !== 'window') continue;
      const zoneSource = windowZone(ctx.scene, wall, opening.id, opening.center, opening.width);
      for (const face of faces)
        bands.push({ openingId: opening.id, quad: sideZone(zoneSource, face.normal, opening.width, WINDOW_CLEAR_M) });
    }
  }
  bandCache.set(ctx.plan, bands);
  return bands;
}

function bandIssue(band: WindowBand, item: LintItem): LayoutIssue | null {
  const height = item.layout?.blockingHeight ?? item.dims[1];
  if (!item.quad || height <= TALL_M) return null;
  if (apart(item.quad, band.quad) || overlapDepth(item.quad, band.quad) <= TOUCH_TOL_M) return null;
  return {
    rule: 'window-clearance',
    severity: 'error',
    ids: [band.openingId, item.placement.id],
    message: `${item.placement.id} is ${height.toFixed(2)} m tall and blocks window ${band.openingId}`,
    at: quadCentre(band.quad),
  };
}

function ruleWindows(ctx: LintContext, out: LayoutIssue[]): void {
  for (const band of bandsOf(ctx)) {
    for (const item of ctx.items) {
      const issue = bandIssue(band, item);
      if (issue) out.push(issue);
    }
  }
}

function itemWindows(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  for (const band of bandsOf(ctx)) {
    const issue = bandIssue(band, item);
    if (issue) out.push(issue);
  }
}

export const WINDOW_CLEARANCE: LayoutRuleModule = { id: 'window-clearance', severity: 'error', run: ruleWindows, item: itemWindows };
