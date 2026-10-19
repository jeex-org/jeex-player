/**
 * The Trusted Types mount, as a Playwright gate.
 *
 * `scripts/browser-check/lifecycle.ts`'s `checkTrustedTypes` already proves
 * two viewers mount under `dev/embed-tt.html`'s
 * `require-trusted-types-for 'script'` CSP, but only as an exploratory tool
 * CI never runs. This file mirrors it exactly — same page, same assertions —
 * as a test `check.sh`'s e2e step actually runs. `lifecycle.ts` keeps its own
 * copy: it is the exploratory tool, not a duplicate of this gate.
 */

import { expect, test } from '@playwright/test';
import { BOOT_TIMEOUT_MS, expectCanvasScreenshot } from './support.js';

test('two viewers mount under require-trusted-types-for, no TypeError, one adopted sheet, both render', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/dev/embed-tt.html');
  // A FUNCTION, not `waitForBoot`'s string predicate: Playwright evaluates a
  // string predicate with `eval` inside the page on every poll after the first,
  // and this page's `require-trusted-types-for 'script'` blocks exactly that
  // («EvalError: Evaluating a string as JavaScript violates this document's
  // Trusted Type assignment requirements»). It passed only when the flag was
  // already up at the first check, so it failed on whichever renderer booted
  // slower than the first poll (first seen on a GPU-rendered run).
  await page.waitForFunction(() => window.__embedTwoReady === true, undefined, { timeout: BOOT_TIMEOUT_MS });

  // Proof the policy is ENFORCED, not merely that the API exists:
  // `window.trustedTypes` is present in Chromium whatever the CSP says, so
  // the check is an actual assignment to a sink, which must throw here.
  const enforced = await page.evaluate(() => {
    try {
      document.createElement('div').innerHTML = '<b>x</b>';
      return false;
    } catch (error) {
      return error instanceof TypeError;
    }
  });
  expect(enforced, 'the Trusted Types page must actually block a string assigned to innerHTML').toBe(true);

  await expect(page.locator('.jeex-viewer')).toHaveCount(2);
  await expect(page.locator('[data-jeex="scene-canvas"]')).toHaveCount(2);
  expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(1);

  const combinedErrors = [...consoleErrors, ...pageErrors].join('\n');
  expect(combinedErrors, `no TypeError may reach the page under Trusted Types | ${combinedErrors.slice(0, 400)}`).not.toContain(
    'TypeError',
  );

  // Both canvases are actually DRAWING, not merely present in the DOM — same
  // mechanism and tolerance as every other canvas baseline.
  const canvases = page.locator('[data-jeex="scene-canvas"]');
  await expectCanvasScreenshot(canvases.first(), 'trusted-types-first-canvas.png');
  await expectCanvasScreenshot(canvases.nth(1), 'trusted-types-second-canvas.png');
});

declare global {
  interface Window {
    __embedTwoReady?: boolean;
  }
}
