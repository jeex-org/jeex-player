/**
 * Rule 5 (hard): a wall-hung object is flat against its face, inside its span,
 * clear of every opening, and at the height its archetype belongs at.
 *
 * The heights are catalogue facts (`CatalogueObject.layout.mount`), not a
 * table here: a nominal centre or bottom edge, with one tolerance either side.
 * A mounting table in the linter is how `tv_panel` — an archetype the bank
 * never had — kept a row for years.
 *
 * Pure module: no `three`, no DOM.
 */

import {
  faceLabel,
  faceSpan,
  nearestFace,
  positionOf,
  type LayoutIssue,
  type LayoutRuleModule,
  type LintContext,
  type LintItem,
} from './context.js';

/** A wall-hung back plane may sit this far off its face, metres. */
const WALL_HUNG_GAP_M = 0.02;
/** A back plane sunk deeper than this into the wall is an error too, metres. */
const WALL_HUNG_SINK_M = 0.005;
/** How far either side of a nominal mounting height still counts as right, metres. */
const MOUNT_TOL_M = 0.05;
/** A hung object must leave this much of the face at either end, metres. */
const FACE_END_MARGIN_M = 0.02;

/**
 * The band a nominal mounting height allows, metres.
 *
 * The bounds are computed ONCE and compared against, never re-derived as
 * `|y - nominal| > tol`: the two differ by a float ulp, and a mirror authored
 * at exactly the low edge (1.55 m of a 1.60 ± 0.05 band) fails the second
 * form and passes the first.
 */
function band(nominal: number): { low: number; high: number; text: string } {
  const low = nominal - MOUNT_TOL_M;
  const high = nominal + MOUNT_TOL_M;
  return { low, high, text: `${low.toFixed(2)}..${high.toFixed(2)}` };
}

function ruleWallHung(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) itemWallHung(ctx, item, out);
}

function itemWallHung(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  if (item.anchor !== 'wall') return;
  const centre = positionOf(item);
  const near = nearestFace(ctx.plan, item.roomId, centre) ?? nearestFace(ctx.plan, null, centre);
  if (!near) return;
  const gap = near.distance - item.dims[2] / 2;
  if (gap < -WALL_HUNG_SINK_M || gap > WALL_HUNG_GAP_M) {
    out.push({
      rule: 'wall-hung',
      severity: 'error',
      ids: [item.placement.id, near.face.wallId],
      message: `${item.placement.id} hangs ${gap.toFixed(3)} m off ${faceLabel(near.face)} (allowed 0..${WALL_HUNG_GAP_M})`,
      at: centre,
    });
  }

  const [t0, t1] = faceSpan(item, near.face, centre);
  if (t0 < FACE_END_MARGIN_M || t1 > near.face.length - FACE_END_MARGIN_M) {
    out.push({
      rule: 'wall-hung',
      severity: 'error',
      ids: [item.placement.id, near.face.wallId],
      message: `${item.placement.id} runs off the end of ${faceLabel(near.face)} (${t0.toFixed(2)}..${t1.toFixed(2)} of ${near.face.length.toFixed(2)} m)`,
      at: centre,
    });
  }
  const low = item.y - item.dims[1] / 2;
  const high = item.y + item.dims[1] / 2;
  for (const opening of near.face.openings) {
    if (opening.head <= low || opening.sill >= high) continue;
    if (opening.t1 <= t0 || opening.t0 >= t1) continue;
    out.push({
      rule: 'wall-hung',
      severity: 'error',
      ids: [item.placement.id, opening.id],
      message: `${item.placement.id} hangs across opening ${opening.id}`,
      at: centre,
    });
  }

  const mount = item.layout?.mount;
  if (mount?.centre !== undefined) {
    const allowed = band(mount.centre);
    if (item.y < allowed.low || item.y > allowed.high) {
      out.push({
        rule: 'wall-hung',
        severity: 'error',
        ids: [item.placement.id],
        message: `${item.placement.id} hangs at ${item.y.toFixed(2)} m; ${item.archetype} centres belong in ${allowed.text} m`,
        at: centre,
      });
    }
  }
  if (mount?.bottom !== undefined) {
    const allowed = band(mount.bottom);
    if (low < allowed.low || low > allowed.high) {
      out.push({
        rule: 'wall-hung',
        severity: 'error',
        ids: [item.placement.id],
        message: `${item.placement.id} has its bottom at ${low.toFixed(2)} m; ${item.archetype} belongs in ${allowed.text} m`,
        at: centre,
      });
    }
  }
}

export const WALL_HUNG: LayoutRuleModule = { id: 'wall-hung', severity: 'error', run: ruleWallHung, item: itemWallHung };
