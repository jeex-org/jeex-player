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
  faceSpan,
  issueFace,
  layoutIssue,
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
function band(nominal: number): { low: number; high: number } {
  return { low: nominal - MOUNT_TOL_M, high: nominal + MOUNT_TOL_M };
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
    out.push(
      layoutIssue(
        'wall_hung_off_face',
        { placement: item.placement.id, face: issueFace(near.face), gap, maxGap: WALL_HUNG_GAP_M },
        { severity: 'error', ids: [item.placement.id, near.face.wallId], at: centre },
      ),
    );
  }

  const [t0, t1] = faceSpan(item, near.face, centre);
  if (t0 < FACE_END_MARGIN_M || t1 > near.face.length - FACE_END_MARGIN_M) {
    out.push(
      layoutIssue(
        'wall_hung_past_face_end',
        { placement: item.placement.id, face: issueFace(near.face), from: t0, to: t1, length: near.face.length },
        { severity: 'error', ids: [item.placement.id, near.face.wallId], at: centre },
      ),
    );
  }
  const low = item.y - item.dims[1] / 2;
  const high = item.y + item.dims[1] / 2;
  for (const opening of near.face.openings) {
    if (opening.head <= low || opening.sill >= high) continue;
    if (opening.t1 <= t0 || opening.t0 >= t1) continue;
    out.push(
      layoutIssue(
        'wall_hung_across_opening',
        { placement: item.placement.id, opening: opening.id },
        { severity: 'error', ids: [item.placement.id, opening.id], at: centre },
      ),
    );
  }

  const mount = item.layout?.mount;
  if (mount?.centre !== undefined) {
    const allowed = band(mount.centre);
    if (item.y < allowed.low || item.y > allowed.high) {
      out.push(
        layoutIssue(
          'wall_hung_centre_height',
          { placement: item.placement.id, archetype: item.archetype, height: item.y, low: allowed.low, high: allowed.high },
          { severity: 'error', ids: [item.placement.id], at: centre },
        ),
      );
    }
  }
  if (mount?.bottom !== undefined) {
    const allowed = band(mount.bottom);
    if (low < allowed.low || low > allowed.high) {
      out.push(
        layoutIssue(
          'wall_hung_bottom_height',
          { placement: item.placement.id, archetype: item.archetype, bottom: low, low: allowed.low, high: allowed.high },
          { severity: 'error', ids: [item.placement.id], at: centre },
        ),
      );
    }
  }
}

export const WALL_HUNG: LayoutRuleModule = { id: 'wall-hung', severity: 'error', run: ruleWallHung, item: itemWallHung };
