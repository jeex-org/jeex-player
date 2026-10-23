/**
 * `set_site`: the plan's orientation and sun preset (schema 2.3).
 *
 * A present value sets its field, `null` clears it, an omitted key keeps it.
 * `northDeg` is stored normalised to [0, 360), so an editor may hand over any
 * angle its rotation produced. When both fields end absent, `site` is removed
 * rather than left as `{}`: an empty `site` means north 0 at noon, which is not
 * the sun a document without orientation has.
 *
 * The applier checks everything the op schema checks (`types.schema.ts`) for a
 * caller that applies an operation without parsing it first, refuses a 2.2
 * document (a 2.2 document carries no `site`) and never raises the version:
 * the caller does.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Draft } from '../../shared/committed.js';
import type { SceneData, SetSiteOp, SiteSun } from '../types.js';
import { OpError, TOUCHED_SITE, type OpOutcome } from './context.js';

const SUNS: ReadonlySet<unknown> = new Set<SiteSun>(['morning', 'noon', 'evening']);

/** `degrees` in [0, 360); `-0` and a remainder that rounds up to 360 both come out as 0. */
export function normaliseNorth(degrees: number): number {
  const turned = ((degrees % 360) + 360) % 360;
  return turned === 0 ? 0 : turned;
}

export function applySetSite(scene: Draft<SceneData>, op: SetSiteOp): OpOutcome {
  const { northDeg, sun } = op as { northDeg?: unknown; sun?: unknown };
  if (northDeg === undefined && sun === undefined) throw new OpError('set_site needs northDeg or sun');
  if (northDeg !== undefined && northDeg !== null && (typeof northDeg !== 'number' || !Number.isFinite(northDeg))) {
    throw new OpError('set_site northDeg must be a finite number or null');
  }
  if (sun !== undefined && sun !== null && !SUNS.has(sun)) {
    throw new OpError("set_site sun must be 'morning', 'noon', 'evening' or null");
  }
  if (scene.schemaVersion === '2.2') throw new OpError("set_site needs schemaVersion '2.3'; a 2.2 document carries no site");

  const next: { northDeg?: number; sun?: SiteSun } = { ...scene.site };
  if (op.northDeg === null) delete next.northDeg;
  else if (op.northDeg !== undefined) next.northDeg = normaliseNorth(op.northDeg);
  if (op.sun === null) delete next.sun;
  else if (op.sun !== undefined) next.sun = op.sun;

  if (next.northDeg === undefined && next.sun === undefined) {
    delete scene.site;
    return { summary: 'Site cleared', touched: [TOUCHED_SITE] };
  }
  scene.site = next;
  return { summary: `Site: ${describe(next)}`, touched: [TOUCHED_SITE] };
}

function describe(site: { northDeg?: number; sun?: SiteSun }): string {
  const parts: string[] = [];
  if (site.northDeg !== undefined) parts.push(`north ${String(site.northDeg)}°`);
  if (site.sun !== undefined) parts.push(`sun ${site.sun}`);
  return parts.join(', ');
}
