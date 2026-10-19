/**
 * The MIDDLE level of the test pyramid: the DOM layer, in a real
 * browser.
 *
 * `bun test` stays the base — the plan solver, the geometry, the protocol, the
 * option resolver: everything that needs no parser and no GPU. It cannot test
 * the shell, the custom element or the composition root, because those need a
 * document, a shadow root, `adoptedStyleSheets` and a WebGL2 context, and a
 * hand-rolled shim of any of them would be a test of the shim.
 *
 * So this config runs Chromium through Playwright and puts the tests INSIDE
 * it — Vitest 5's Browser Mode, GA since Vitest 4. No jsdom, no happy-dom: the
 * viewer's whole subject matter is a browser, and a fake one proves nothing
 * about it.
 *
 * Run it with `bun run test:component`. It needs `bunx playwright install
 * chromium` once.
 */

import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { headlessWebglLaunch } from './tests/headless-webgl.js';

export default defineConfig({
  // Pre-bundled up front, not on first import. Vite discovers `three` while
  // the first test file is already running and reloads the page to serve the
  // optimised copy — Vitest reports that as "Vite unexpectedly reloaded a
  // test", and a reload in the middle of a WebGL boot is a flake.
  optimizeDeps: {
    include: [
      'three',
      'three/addons/environments/RoomEnvironment.js',
      // Lazily imported by `app/export-gltf.ts` / `app/export-usdz.ts`:
      // pre-bundled here for the same
      // reason as `RoomEnvironment` above — a dynamic `import()` first seen
      // mid-test reloads the page instead of failing cleanly.
      'three/addons/exporters/GLTFExporter.js',
      'three/addons/exporters/USDZExporter.js',
    ],
  },
  test: {
    // `tests/component` only. The colocated `src/**/*.test.ts` files belong to
    // `bun test` and must never be picked up here: they import `bun:test`.
    include: ['tests/component/**/*.test.ts'],
    // A viewer boot renders a real apartment through SwiftShader, and a demo
    // mount under a full parallel run takes 20-30 s: 60 s is the light-path
    // budget, and heavy tests declare their own.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Four files at a time, not "half the cores": the tier is throughput-bound
    // on the one software rasteriser, so more pages do not shorten the run but
    // slow every test against its own timeout. Raise it only after measuring
    // both the wall clock and the per-test cost on the target machine.
    maxWorkers: 4,
    // This tier's own server, on the viewer's block port for component tests
    // (3700 dev, 3701 e2e, 3702 here, 3703 browser-check).
    // Vitest's browser default (63315, incremented per instance) is outside
    // the block, and a busy port must fail rather than quietly move: the
    // browser would then be driven against whatever else answers there.
    // `JEEX_COMPONENT_PORT` moves it inside the block (like `JEEX_E2E_PORT`),
    // for a machine where 3702 is taken; 3708 is the spare.
    api: { port: Number(process.env['JEEX_COMPONENT_PORT'] ?? 3702), strictPort: true },
    browser: {
      enabled: true,
      // `timeout` is Playwright's own launch handshake ceiling (its default,
      // spelled out): a launch that never completes, e.g. an orphaned
      // `chrome-headless-shell` still holding the software rasteriser, fails
      // with Playwright's timeout error instead of hanging. It is the second
      // line of defence; `scripts/run-component-tests.ts` reaps orphans first.
      provider: playwright({ launchOptions: { ...headlessWebglLaunch(), timeout: 30_000 } }),
      // Headless everywhere, not just in CI: a window that steals focus on a
      // developer's machine is how a suite stops being run locally.
      headless: true,
      instances: [{ browser: 'chromium' }],
      // 1024 × 768 is wide enough that the control bar is not in its collapsed
      // layout, which several tests address by name.
      viewport: { width: 1024, height: 768 },
      screenshotFailures: false,
    },
    coverage: {
      // On by every run, local and CI, exactly as `bunfig.toml` has it for the
      // base level: a drop is visible in the same output the failures are, not
      // behind a flag someone has to remember.
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Its own directory: `coverage/` belongs to `bun test`, and
      // `scripts/coverage-check.ts` reads both, one floor table each.
      //
      // This is a RELATIVE path, so Vitest resolves it against `config.root`
      // (the checkout), and `ReportsDirectoryLock` names its lock file after
      // the resolved absolute path: two checkouts never share a lock. A
      // still-alive run in the SAME checkout does, and
      // `scripts/run-component-tests.ts` (the `test:component` entry point)
      // fails fast on that foreign lock, naming the pid.
      reportsDirectory: 'coverage-component',
      // The DOM layer, and only it. Everything else is measured by `bun test`
      // and would report here as a near-zero that means nothing.
      // `include` alone is the whole policy in Vitest 5: an included file
      // that no test imported is reported at 0 % rather than left out, which
      // is the only honest way to floor a layer.
      include: ['src/ui/**', 'src/app/**', 'src/doors/**', 'src/embed/**', 'src/render/**'],
      exclude: ['**/*.test.ts'],
    },
  },
});
