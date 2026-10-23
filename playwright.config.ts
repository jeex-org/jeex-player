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
import { scaled } from './tests/e2e/time-scale.js';
import { portEnv, positiveIntEnv } from './scripts/config-input.js';

/**
 * The e2e server's port: default 3701 (the dev server is on 3700), override
 * with `JEEX_E2E_PORT`. The override exists because two gate runs on one
 * machine at once (for example in two worktrees) otherwise share one port, and
 * `reuseExistingServer` lets each run silently reuse — and then tear down —
 * the other's `vite`, which reads as a storm of `ERR_CONNECTION_REFUSED`
 * failures that have nothing to do with the code either run touched.
 */
export const E2E_PORT = portEnv('JEEX_E2E_PORT', 3701);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/**
 * WebGL2 in a headless Chromium: the software rasteriser by default, the two
 * machine knobs (`JEEX_E2E_ANGLE`, `JEEX_BROWSER_GPU`) in `tests/headless-webgl.ts`,
 * shared with `vitest.config.ts` and `scripts/video-frames.ts`.
 */
const HEADLESS_WEBGL_LAUNCH = headlessWebglLaunch();

export default defineConfig({
  testDir: 'tests/e2e',
  // A scene builds on a software rasteriser; 30 s is the boot budget, not the
  // target (`READY_BUDGET_MS` in the browser check is 5 s on a real GPU).
  // Both stretched by `JEEX_E2E_TIME_SCALE` (`tests/e2e/time-scale.ts`).
  timeout: scaled(60_000),
  expect: { timeout: scaled(15_000) },
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
  workers: positiveIntEnv('JEEX_E2E_WORKERS', 2),
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
    // No file watcher on this server, so nothing reloads a page behind a spec's
    // back (`vite.config.ts`, `E2E_SERVER`).
    env: { JEEX_E2E_SERVER: '1' },
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
