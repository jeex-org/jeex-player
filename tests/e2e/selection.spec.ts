/**
 * `?select=1`: a click reports what it landed on, a drag does not, and the
 * 2D plan picks through the drawing rather than through the frozen 360 rig.
 */

import { expect, test } from '@playwright/test';
import { expectNoNewA11yViolations, pressMode, viewerRoot, waitForBoot, waitForProjectionSettled } from './support.js';

/** Measured against the demo page's own budget (`index.spec.ts`). */
const A11Y_BUDGET = 0;

test.beforeEach(async ({ page }) => {
  await page.goto('/?select=1&tour=off');
  await waitForBoot(page, 'window.__appReady === true');
  // Every test here turns a world point into a click, so every test needs the
  // fitted camera and not merely the ready flag — see `waitForProjectionSettled`.
  await waitForProjectionSettled(page);
});

test('a click in plan2d reports a selection in plan2d, and an empty corner reports none', async ({ page }) => {
  const root = viewerRoot(page);
  await pressMode(root, 'plan2d');
  await expect.poll(async () => page.evaluate(() => window.__viewerDebug?.mode())).toBe('plan2d');

  const report = await page.evaluate(() => {
    const debug = window.__viewerDebug!;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    const click = (x: number, y: number): void => {
      const id = Math.floor(Math.random() * 1e6);
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: id, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, pointerId: id, bubbles: true }));
    };
    const room = debug.plan().rooms[0]!;
    const point = debug.selectionPoint((room.bbox.minX + room.bbox.maxX) / 2, (room.bbox.minZ + room.bbox.maxZ) / 2);
    if (!point) return { ok: false as const };
    click(point.x, point.y);
    const hit = debug.selection().last;
    click(2, 2);
    const miss = debug.selection().last;
    return { ok: true as const, roomId: room.id, hit, miss };
  });

  expect(report.ok).toBe(true);
  expect(report.hit?.mode).toBe('plan2d');
  expect(report.hit?.kind).not.toBe('none');
  expect(report.miss?.kind).toBe('none');
});

test('a click on a wall in 360 reports its wallId, and setSelection highlights it', async ({ page }) => {
  const result = await page.evaluate(() => {
    const debug = window.__viewerDebug!;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    const click = (x: number, y: number): void => {
      const id = Math.floor(Math.random() * 1e6);
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: id, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, pointerId: id, bubbles: true }));
    };
    const room = debug.plan().rooms[0]!;
    const poly = room.polygon;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.4) continue;
      const nx = -dz / len;
      const nz = dx / len;
      for (const s of [0.5, 0.35, 0.65]) {
        const p = debug.projectPoint(a.x + dx * s + nx * 0.03, 1.25, a.z + dz * s + nz * 0.03);
        if (!p || p.x < 4 || p.y < 4 || p.x > innerWidth - 4 || p.y > innerHeight - 4) continue;
        click(p.x, p.y);
        const hit = debug.selection().last;
        if (hit?.kind === 'wall' && hit.wallId) {
          window.jeexViewer!.setSelection({ kind: 'wall', id: hit.wallId });
          const on = debug.selection().highlight?.id ?? null;
          window.jeexViewer!.setSelection(null);
          return { wallId: hit.wallId, mode: hit.mode, on, off: debug.selection().highlight?.id ?? null };
        }
      }
    }
    return null;
  });

  expect(result).not.toBeNull();
  expect(result!.mode).toBe('orbit');
  expect(result!.on).toBe(result!.wallId);
  expect(result!.off).toBeNull();
});

test('a drag never selects', async ({ page }) => {
  const seen = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    const box = canvas.getBoundingClientRect();
    const id = 7771;
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        button: 0,
        pointerId: id,
        bubbles: true,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointerup', {
        clientX: box.left + box.width / 2 + 60,
        clientY: box.top + box.height / 2,
        button: 0,
        pointerId: id,
        bubbles: true,
      }),
    );
    return window.__viewerDebug!.selection().last;
  });
  expect(seen).toBeNull();
});

test('the selection option adds no accessibility violations', async ({ page }, testInfo) => {
  await expectNoNewA11yViolations(page, testInfo, A11Y_BUDGET);
});
