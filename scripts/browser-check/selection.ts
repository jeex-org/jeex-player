/**
 * `options.select`: what a click reports in 360 and in the 2D plan, what the
 * host's own `setSelection` highlights, and that a viewer without the option
 * reports nothing at all.
 *
 * Opens its own page with `?select=1&tour=off`; leaves the page on the plain
 * URL for whatever runs next.
 */

import { DEMO } from '../../src/demo/demo-ids.js';
import type { CheckContext } from './context.js';
import { HELPERS } from './page-code.js';
import { pressControl, waitForCameraStill } from './step.js';

type Reported = { kind: string; id?: string; wallId?: string; roomId?: string; mode: string; point?: { x: number; z: number } };

/** The select event, the 2D plan pick and the host-driven highlight. */
export async function checkSelection(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, literal, withQuery } = ctx;

  // ---- 1. The option off: a click reports nothing ----
  await run(['open', ctx.url]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const silent = await evalValue<Reported | null>(`(() => {${HELPERS}
    CLICK(innerWidth / 2, innerHeight / 2);
    return JSON.stringify(D.selection().last);
  })()`);
  assert(silent === null, `a viewer without ?select=1 must report nothing | ${JSON.stringify(silent)}`);

  // ---- 2. 360: a click on a real wall face reports its wallId ----
  await run(['open', withQuery('?select=1&tour=off')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  // The pick casts through the camera of the next frame: click only once the
  // opening view has landed, or a projected point drifts off its wall.
  await waitForCameraStill(ctx, 'the opening view to land');
  const wall = await evalValue<{ hit: boolean; report?: Reported; reason?: string }>(`(() => {${HELPERS}
    const room = D.plan().rooms.find((r) => r.id === ${literal(DEMO.room.kitchen)}) ?? D.plan().rooms[0];
    const poly = room.polygon;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.4) continue;
      const nx = -dz / len;
      const nz = dx / len;
      for (const s of [0.5, 0.35, 0.65]) {
        for (const y of [1.25, 1.9, 0.95]) {
          const p = D.projectPoint(a.x + dx * s + nx * 0.03, y, a.z + dz * s + nz * 0.03);
          if (!ONSCREEN(p)) continue;
          CLICK(p.x, p.y);
          const report = D.selection().last;
          if (report && report.kind === 'wall') return JSON.stringify({ hit: true, report });
        }
      }
    }
    return JSON.stringify({ hit: false, reason: 'no visible wall face to click' });
  })()`);
  assert(wall.hit, `a click on a wall in 360 must report kind=wall | ${wall.reason ?? ''}`);
  assert(
    typeof wall.report?.wallId === 'string' && wall.report.wallId.length > 0,
    `the wall report must name a wallId | ${JSON.stringify(wall.report)}`,
  );
  assert(wall.report?.mode === 'orbit', `the report must carry the mode it happened in | ${wall.report?.mode}`);
  assert(
    typeof wall.report?.point?.x === 'number' && typeof wall.report.point.z === 'number',
    `the report must carry the plan point of the click | ${JSON.stringify(wall.report?.point)}`,
  );
  summary.push(`select in 360: wall ${wall.report?.wallId} at (${wall.report?.point?.x.toFixed(2)}, ${wall.report?.point?.z.toFixed(2)})`);

  // ---- 3. setSelection highlights, and null clears ----
  const highlighted = await evalValue<{ on: string | null; off: string | null }>(`(() => {${HELPERS}
    const id = D.selection().last.wallId;
    window.jeexViewer.setSelection({ kind: 'wall', id });
    const on = D.selection().highlight ? D.selection().highlight.id : null;
    window.jeexViewer.setSelection(null);
    return JSON.stringify({ on, off: D.selection().highlight ? D.selection().highlight.id : null });
  })()`);
  assert(highlighted.on === wall.report?.wallId, `setSelection must highlight the wall it was given | ${JSON.stringify(highlighted)}`);
  assert(highlighted.off === null, `setSelection(null) must clear the highlight | ${JSON.stringify(highlighted)}`);
  summary.push(`setSelection: highlight ${highlighted.on} on, null off`);

  // ---- 4. plan2d: the pick follows the DRAWING, not the frozen 360 rig ----
  await pressControl(ctx, '[data-jeex="control-bar"] [data-mode="plan2d"]');
  await run(['wait', '--fn', 'window.__viewerDebug.mode() === "plan2d"']);
  const rooms = await evalValue<Array<{ id: string; ok: boolean; got: string | null }>>(`(() => {${HELPERS}
    return JSON.stringify(D.plan().rooms.slice(0, 2).map((room) => {
      const cx = (room.bbox.minX + room.bbox.maxX) / 2;
      const cz = (room.bbox.minZ + room.bbox.maxZ) / 2;
      const p = D.selectionPoint(cx, cz);
      if (!ONSCREEN(p)) return { id: room.id, ok: false, got: 'offscreen' };
      CLICK(p.x, p.y);
      const report = D.selection().last;
      return { id: room.id, ok: Boolean(report) && report.mode === 'plan2d', got: report ? (report.roomId ?? report.kind) : null };
    }));
  })()`);
  for (const room of rooms) {
    assert(room.ok, `a plan2d click must report in plan2d | ${JSON.stringify(room)}`);
  }
  assert(
    rooms.some((room) => room.got === room.id),
    `at least one plan2d click must land on the room the drawing shows there | ${JSON.stringify(rooms)}`,
  );
  summary.push(`select in plan2d: ${rooms.map((r) => `${r.id}->${r.got}`).join(', ')}`);

  // Leaves the plain page for whatever runs next.
  await run(['open', ctx.url]);
  await run(['wait', '--fn', 'window.__appReady === true']);
}
