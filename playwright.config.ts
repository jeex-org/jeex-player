/**
 * The CAP of the test pyramid: the five pages a host actually
 * looks at, in a real browser, against a real server.
 *
 * It is not a replacement for `scripts/browser-check.ts`. That script stays
 * the exploratory tool — it drives the viewer through the
 * `agent-browser` CLI and knows the scene's own invariants. This suite is the
 * hermetic, parallel, retryable one CI can run: it starts its own `vite`, and
 * every spec is independent of every other.
 *
 * `webServer` rather than "remember to start the dev server": a suite that
 * needs a human to prepare it is a suite that does not run.
 */

import { defineConfig, devices } from '@playwright/test';
import { headlessWebglLaunch } from './tests/headless-webgl.js';

/**
 * The e2e server's port, from the viewer's own 3700–3709 port block
 * (3700 is the dev server's).
 * Overridable with `JEEX_E2E_PORT`: two gate runs on one machine at once
 * (for example in two worktrees) otherwise share one port, and `reuseExistingServer` lets each run
 * silently reuse — and then tear down — the other's `vite`, which reads as a
 * storm of `ERR_CONNECTION_REFUSED` failures that have nothing to do with
 * the code either run touched.
 */
export const E2E_PORT = Number(process.env['JEEX_E2E_PORT'] ?? 3701);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/**
 * WebGL2 in a headless Chromium: the software rasteriser by default, the two
 * machine knobs (`JEEX_E2E_ANGLE`, `JEEX_BROWSER_GPU`) in `tests/headless-webgl.ts`,
 * shared with `vitest.config.ts` and `scripts/video-frames.ts`.
 */
const HEADLESS_WEBGL_LAUNCH = headlessWebglLaunch();

/**
 * How many times longer than on a developer machine a test and an `expect`
 * may take here. Unset means 1; a hosted CI runner sets it in `ci.yml`.
 *
 * On SwiftShader one frame of the demo apartment costs about 1.2 s on four
 * hardware threads (0.82 fps, one page, 1280 x 720), and every Playwright
 * round trip (`evaluate`, `hover`, `click`) waits behind the frame in flight:
 * in a 10 s CPU profile of the page the main thread spends 99% in native GL
 * calls and under 1% in script. A spec that switches modes five times, or
 * scrolls, clicks and waits for the camera, needs minutes there, where a GPU
 * draws the same frame in milliseconds. The explicit budgets inside the specs
 * are not scaled: they bound one wait, not the whole test.
 */
const TIME_SCALE = Number(process.env['JEEX_E2E_TIME_SCALE'] ?? 1);
if (!Number.isFinite(TIME_SCALE) || TIME_SCALE < 1) throw new Error(`JEEX_E2E_TIME_SCALE must be a number >= 1, got ${String(TIME_SCALE)}`);

export default defineConfig({
  testDir: 'tests/e2e',
  // A scene builds on a software rasteriser; 30 s is the boot budget, not the
  // target (`READY_BUDGET_MS` in the browser check is 5 s on a real GPU).
  timeout: 60_000 * TIME_SCALE,
  expect: { timeout: 15_000 * TIME_SCALE },
  fullyParallel: true,
  // A `.only` left in a spec is a suite that silently stopped testing things.
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  // Every spec boots at least one WebGL2 context through SwiftShader, and
  // several at once starve each other into timeouts: 2 is the highest count
  // that stays green with every test well under its timeout on a loaded
  // developer machine. `JEEX_E2E_WORKERS` overrides it per machine; a small
  // 2-core CI runner sets it to 1. The 20-cycle mount/dispose canary is marked
  // `test.slow()` so it fits under this default.
  workers: Number(process.env['JEEX_E2E_WORKERS'] ?? 2),
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  /**
   * Baselines live under `__screenshots__/<platform>/`, because they are not
   * font-independent: the host pages set their copy in the system UI font, and
   * a wider font rewraps the intro paragraph of `embed-two.html` and
   * `embed-iframe.html`, which moves everything below it by one line height.
   * A shared image would need a tolerance wide enough to hide a moved viewer,
   * so each platform keeps its own baselines and the tolerances in
   * `support.ts` stay tight. A platform's baselines carry that machine's font
   * stack; only `linux` baselines are kept in the repository.
   */
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{testFilePath}/{arg}{ext}',
  /**
   * Screenshot comparisons are local-only: with `CI` set every
   * `toHaveScreenshot` is skipped (the rest of each spec still runs), because
   * the baselines are rendered on the maintainers' machines and a hosted
   * runner's fonts and rasteriser differ from them.
   */
  ignoreSnapshots: !!process.env['CI'],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: HEADLESS_WEBGL_LAUNCH },
    },
  ],
  webServer: {
    // `--strictPort` on purpose: a server that quietly moved to another port
    // would leave every spec pointing at whatever else is on 3701.
    command: `vite --port ${E2E_PORT} --strictPort --host 127.0.0.1`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
