/**
 * Shared machinery for the e2e suite: waiting for a boot, the accessibility
 * scan and its ratchet, and the two screenshot shapes.
 */

import { writeFileSync } from 'node:fs';
import { expect, test, type FrameLocator, type Locator, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { scaled } from './time-scale.js';

/** The WCAG levels the viewer commits to. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag22aa'];

/**
 * Screenshot tolerance for the CHROME region.
 *
 * The chrome is CSS over an opaque backdrop and is masked away from the canvas,
 * so the only movement is font rasterisation. Measured on macOS
 * Chromium: 0 differing pixels between consecutive runs; the budget below is
 * headroom for a CI runner's different font stack, not an observed number.
 */
export const CHROME_DIFF_RATIO = 0.02;

/**
 * Screenshot tolerance for a CANVAS baseline.
 *
 * Deliberately loose. The scene is rendered by SwiftShader with soft shadows
 * and a PMREM environment, and consecutive runs on the same machine differ in
 * the low single-digit percent of pixels; a different Chromium build differs
 * more. The baseline is here to catch "the apartment stopped rendering" and
 * "the camera is pointing somewhere else entirely", not a shading change —
 * that is what the chrome baselines and the functional assertions are for.
 * Measured on macOS, Chromium 153 headless shell.
 */
export const CANVAS_DIFF_RATIO = 0.35;

/**
 * How long ONE screenshot comparison may take, overriding the suite's 15 s
 * `expect` budget (`playwright.config.ts`).
 *
 * `toHaveScreenshot` does not compare once: it captures the target repeatedly
 * until two consecutive captures are identical, and only then diffs against the
 * baseline. Every page here holds a live WebGL2 canvas painting through
 * SwiftShader, so a single capture costs seconds — and masking the canvas hides
 * it from the COMPARISON, not from the capture. Under 15 s the assertion can
 * therefore run out of budget before it ever reaches a verdict, and the failure
 * reads `Timeout 15000ms exceeded` with no pixel numbers at all.
 *
 * Observed: the same tree both failed and passed this way on
 * `unbranded.spec.ts:96` across repeated full gates, while the spec run alone
 * was green every time. `retries` is 0 off CI, so one such timeout
 * reddens a whole local gate with nothing wrong in the code.
 *
 * Overridable with `JEEX_E2E_SCREENSHOT_TIMEOUT_MS` for a machine whose
 * software GL paints about one frame a second (on such a machine a resting,
 * byte-identical canvas took 20-30 s per capture alone and ran past 40 s in
 * the gate, before any comparison). The default stays 40 s.
 */
export const SCREENSHOT_TIMEOUT_MS = positiveMs(process.env['JEEX_E2E_SCREENSHOT_TIMEOUT_MS'], 40_000);

/**
 * A millisecond override read from the environment: a finite number above
 * zero, or the default. An empty value would read as 0, which Playwright
 * takes as «no timeout», and a typo as NaN.
 */
function positiveMs(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** How long a viewer boot may take on a software rasteriser. */
export const BOOT_TIMEOUT_MS = scaled(45_000);

/** The viewer's own root, wherever the page put it. */
export function viewerRoot(page: Page): Locator {
  return page.locator('[data-jeex="viewer"]');
}

/**
 * One of the five mode buttons.
 *
 * Scoped to the control bar, exactly as `viewer-chrome.ts` scopes its own
 * lookup: `[data-mode]` alone also matches the mini-map card, whose
 * `data-mode` reports which mode it is showing FOR.
 */
export function modeButton(scope: Page | Locator, mode: string): Locator {
  return scope.locator(`[data-jeex="control-bar"] [data-mode="${mode}"]`);
}

/**
 * Wakes the chrome, PINS it open, then presses a mode button.
 *
 * The control bar auto-hides after 4.2 s of idle: it goes `inert` with
 * `pointer-events: none`, so the canvas below becomes the hit target and every
 * pointer action on a mode button fails with "canvas intercepts pointer
 * events". Playwright's own retries cannot break out of that, because they
 * re-run the hit test WITHOUT moving the mouse — nothing wakes the bar, and
 * the click retries until the test times out. `toBeVisible()` does not catch
 * it either: a collapsed bar is `opacity: 0`, which Playwright counts as
 * visible.
 *
 * The 4.2 s deadline is removed rather than raced:
 *
 * 1. A `pointermove` dispatched ON the viewer root wakes the bar. The chrome
 *    binds its wake listener to the root itself, so the event needs no hit
 *    test and no visible pointer — the one thing a collapsed bar cannot
 *    swallow. (It is untrusted, which is exactly right: mirror arming is
 *    trusted-input-only by design and must stay unarmed by a test's wake.)
 * 2. Focusing the button makes the chrome wake with `force`, which arms NO
 *    hide timer: the bar is now pinned open for as long as focus stays in it.
 * 3. Only then the button is activated, with Enter on the keyboard: a trusted
 *    key press on the focused button, which a `<button>` turns into its own
 *    click. Not `click()`: its actionability checks (stable over two frames,
 *    then a hit test) each wait behind a SwiftShader frame, and on a hosted
 *    runner at under one frame per second a single click outlasted a 180 s
 *    test budget. The key press needs no hit test and no frame.
 *
 * Steps 1 and 2 run in ONE in-page task. Every separate protocol call waits
 * for the page's main thread, which a SwiftShader frame holds for its whole
 * length; at 1-2 fps the gap between a separate wake and focus call can
 * exceed the idle deadline, so the bar would be `inert` again before focus
 * reached it. One task has no gap: the idle timer is a macrotask and cannot
 * fire between the dispatch and the `focus()`, so the outcome does not depend
 * on the frame rate.
 *
 * `data-collapsed` is the chrome's own machine-readable mirror of the collapse
 * state (`viewer-chrome.ts`: "a browser check reads this, never the CSS
 * class"). It is read AFTER the focus, together with the focus itself and in
 * the same task (both are set synchronously by the chrome's listeners): an
 * `inert` button cannot take focus at all, so the pair proves the bar is
 * pinned and not merely awake. A pin that does not hold is a real failure,
 * so there is no retry loop to hide it.
 *
 * Two protocol calls in all, the read and the key press: on a hosted runner
 * each call waited 10 to 40 s behind SwiftShader frames, and the five calls
 * this helper used to make (a handle, the wake, two assertions, the click)
 * let a spec that switches modes five times run out of a 180 s budget.
 */
export async function pressMode(root: Locator, mode: string): Promise<void> {
  const pinned = await modeButton(root, mode).evaluate((element: HTMLElement) => {
    element.closest('[data-jeex="viewer"]')?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    element.focus();
    const bar = element.closest<HTMLElement>('[data-jeex="control-bar"]');
    const scope = element.getRootNode() as Document | ShadowRoot;
    return { collapsed: bar?.dataset['collapsed'] ?? null, focused: scope.activeElement === element };
  });
  expect(pinned, `the ${mode} button is pinned open and focused`).toEqual({ collapsed: 'false', focused: true });
  await root.page().keyboard.press('Enter');
}

/**
 * Waits until the page's viewer has published its ready flag.
 *
 * Every demo page sets a different flag — `__appReady` on `index.html`,
 * `__embedTwoReady`, `__scrollTourReady` — because each owns a different number
 * of viewers. The predicate is passed in rather than guessed at.
 *
 * It does NOT mean a frame has been rendered: `ViewerApp.boot` calls `globals.publishReady()` before `startView()`
 * and before `stage.start(...)` arms the render loop
 * (`src/app/viewer-app.ts:304-312`), deliberately, so that an embedding page
 * reading the boot card in the same task sees the final state. A test that
 * needs the CAMERA — anything that projects a world point to a screen point —
 * must additionally wait on `waitForProjectionSettled`.
 */
export async function waitForBoot(page: Page, predicate: string, timeout = BOOT_TIMEOUT_MS): Promise<void> {
  await page.waitForFunction(predicate, undefined, { timeout });
}

/**
 * Where the stability probe is taken, in metres above the floor.
 *
 * Any point inside the apartment answers the question «has the camera stopped
 * moving», so this height is a free choice and is deliberately NOT tied to the
 * height a spec clicks at (`selection.spec.ts` uses 1.25 m for its wall probes,
 * `__viewerDebug.selectionPoint` uses 1.2 m for its own): the two may drift
 * apart without weakening this wait by one frame. Named because a bare literal
 * in a shared helper invites exactly the opposite conclusion.
 */
const PROBE_HEIGHT_M = 1.25;

/**
 * Waits until projecting a world point gives the same screen point twice.
 *
 * The camera is fitted to the apartment by the render loop, not by the boot, so
 * between `__appReady` and the first frame `__viewerDebug.projectPoint` answers
 * from an unfitted camera, which can put a probe point outside the viewport:
 * a spec that projected right after `waitForBoot` would pick screen points
 * below its own window and find no wall.
 *
 * A stability condition rather than a frame count or a sleep: `polling: 'raf'`
 * puts a rendered frame between two consecutive samples, so agreement proves
 * both that a frame has happened and that the camera has stopped moving. The
 * unfitted pose is static too, which is why one sample is not enough.
 */
export async function waitForProjectionSettled(page: Page, timeout = BOOT_TIMEOUT_MS): Promise<void> {
  await page.waitForFunction(
    // The predicate runs in the page, so the height travels as an argument
    // rather than as a closure over the module constant.
    (height: number) => {
      const debug = window.__viewerDebug;
      const room = debug?.plan().rooms[0];
      if (!debug || !room) return false;
      const point = debug.projectPoint((room.bbox.minX + room.bbox.maxX) / 2, height, (room.bbox.minZ + room.bbox.maxZ) / 2);
      if (!point) return false;
      const store = window as unknown as { __jeexProjectionProbe?: { x: number; y: number } };
      const previous = store.__jeexProjectionProbe;
      store.__jeexProjectionProbe = point;
      // Sub-pixel, because the settled value repeats exactly and a moving
      // camera moves by tens of pixels per frame — there is no near miss here.
      return previous !== undefined && Math.abs(previous.x - point.x) < 0.5 && Math.abs(previous.y - point.y) < 0.5;
    },
    PROBE_HEIGHT_M,
    { timeout, polling: 'raf' },
  );
}

/**
 * The names of the objects the builder put in the scene root.
 *
 * "Is the apartment there" asked of the SCENE rather than of the framebuffer.
 * `gl.readPixels` cannot answer it: the drawing buffer is not preserved after
 * a composite, so a read from outside the frame returns the clear colour
 * whatever was drawn. Whether the pixels are right is the canvas baseline's
 * question (`expectCanvasScreenshot`).
 */
export async function sceneChildren(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__viewerDebug?.children() ?? []);
}

export type AxeViolation = { id: string; impact: string; nodes: number; help: string; targets: string[] };

/**
 * Runs axe over the page and returns the violations, sorted for a stable
 * report.
 *
 * `disableRules` is empty on purpose: a rule turned off here would hide a
 * finding that still has to be fixed. The RATCHET below is how the suite stays
 * green while those fixes land.
 */
export async function axeScan(page: Page): Promise<AxeViolation[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      nodes: violation.nodes.length,
      help: violation.help,
      // The selectors, so the report a fix works from names an element,
      // not just a rule id.
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The accessibility ratchet.
 *
 * `expected` is the number of `critical` + `serious` violations MEASURED when
 * the ratchet was set. The assertion is `<=`, so a fix makes the number go
 * down and the suite still passes, and a regression makes it go up and the
 * suite fails. Once every finding is fixed, the numbers come down to 0 and
 * this becomes an ordinary assertion.
 *
 * Every violation is attached to the test as a JSON artefact whether or not it
 * fails, so the report is generated rather than transcribed.
 */
export async function expectNoNewA11yViolations(page: Page, testInfo: TestInfo, expected: number): Promise<AxeViolation[]> {
  const violations = await axeScan(page);
  // Attached BY PATH, not by body: an attachment with a body lives only inside
  // a report, and the point of this file is that the numbers in the specs are
  // regenerated from a run rather than transcribed by hand.
  const path = testInfo.outputPath('axe-violations.json');
  writeFileSync(path, JSON.stringify({ url: page.url(), tags: WCAG_TAGS, violations }, null, 2));
  await testInfo.attach('axe-violations.json', { path, contentType: 'application/json' });
  const blocking = violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
  expect(
    blocking.map((violation) => `${violation.impact} ${violation.id} (${violation.nodes})`).length,
    blocking.map((v) => v.id).join(', '),
  ).toBeLessThanOrEqual(expected);
  return violations;
}

/**
 * Buys the CURRENT test one screenshot comparison's worth of headroom.
 *
 * Two budgets have to agree or the larger one is decoration. A test may spend
 * up to `BOOT_TIMEOUT_MS` getting a scene on screen before it ever reaches its
 * baseline, and the suite gives each test 60 s (`playwright.config.ts`), so an
 * assertion allowed `SCREENSHOT_TIMEOUT_MS` can be cut short by the TEST timing
 * out first — and that failure reads `Test timeout of 60000ms exceeded`, which
 * names neither the pixels nor the real cost, exactly the blind alley this
 * change exists to close.
 *
 * Bought per call rather than per test: two baselines in one test buy twice,
 * and a test that takes no screenshot keeps the suite's budget untouched. The
 * assertion's own timeout still bounds each comparison, so a genuinely stuck
 * capture fails on its own terms instead of running to the test's ceiling.
 */
function allowOneScreenshot(): void {
  test.setTimeout(test.info().timeout + SCREENSHOT_TIMEOUT_MS);
}

/**
 * A baseline of the page's CHROME with the scene masked out.
 *
 * The canvas is masked rather than cropped around: the chrome is positioned
 * over it, so a crop would lose the very thing being compared. Playwright
 * paints the mask a flat colour, which makes the comparison deterministic
 * without hiding a single control.
 */
export async function expectChromeScreenshot(page: Page, name: string): Promise<void> {
  allowOneScreenshot();
  await expect(page).toHaveScreenshot(name, {
    mask: [page.locator('canvas')],
    maxDiffPixelRatio: CHROME_DIFF_RATIO,
    animations: 'disabled',
    caret: 'hide',
    timeout: SCREENSHOT_TIMEOUT_MS,
  });
}

/**
 * The one canvas baseline per page.
 *
 * Loose (`CANVAS_DIFF_RATIO`) and deliberately so — see the constant. It
 * answers one question the chrome baselines cannot: is the apartment still on
 * screen at all.
 */
export async function expectCanvasScreenshot(canvas: Locator, name: string): Promise<void> {
  allowOneScreenshot();
  await expect(canvas).toHaveScreenshot(name, {
    maxDiffPixelRatio: CANVAS_DIFF_RATIO,
    animations: 'disabled',
    timeout: SCREENSHOT_TIMEOUT_MS,
  });
}

/**
 * A canvas baseline used to prove the viewer draws AGAIN after some runtime
 * event — a real `WEBGL_lose_context` loss/restore cycle, here
 * (`context-loss.spec.ts`) — rather than to catch ordinary visual drift.
 *
 * Same mechanism as `expectCanvasScreenshot` (Playwright's own compositor
 * capture, not `gl.readPixels`, for the reason documented on
 * `CANVAS_DIFF_RATIO` above) and the same loose tolerance, just named for
 * what the caller is actually asking: is the restored context painting the
 * apartment again, not merely present in the DOM.
 */
export async function expectCanvasStillRendering(canvas: Locator, name: string): Promise<void> {
  await expectCanvasScreenshot(canvas, name);
}

/**
 * Waits until the control bar has collapsed on its own idle timer.
 *
 * A canvas baseline of a viewer whose chrome auto-hides otherwise records
 * whichever state the bar was in at capture time, and that is a race between
 * a wall-clock idle timer (`viewer-chrome.ts`) and the frame rate: the same
 * page can come out collapsed in the baseline and open in a later run when
 * the capture does not wait out a flight. Nothing touches the page, so the collapse must
 * come; the budget is two idle deadlines plus a slow SwiftShader frame.
 */
export async function waitForChromeIdle(root: Page | FrameLocator): Promise<void> {
  await expect(root.locator('[data-jeex="control-bar"]')).toHaveAttribute('data-collapsed', 'true', { timeout: scaled(15_000) });
}

/**
 * Waits until the camera has stopped moving.
 *
 * A screenshot of a camera mid-flight is a screenshot of a different pose
 * every run. `toHaveScreenshot` waits for two identical frames on its own, but
 * an easing that lasts longer than its budget just times out — so the pose is
 * settled first, on a predicate rather than a sleep.
 */
export async function waitForCameraStill(page: Page, tolerance = 1e-3): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (limit: number) => {
          const read = (): { x: number; y: number; z: number } | null | undefined => window.__viewerDebug?.camera();
          const before = read();
          await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          });
          const after = read();
          if (!before || !after) return false;
          return Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) < limit;
        }, tolerance),
      { timeout: scaled(30_000) },
    )
    .toBe(true);
}
