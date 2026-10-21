/**
 * Per-LAYER line-coverage floors. Bun's own `coverageThreshold` in `bunfig.toml` is a single number for
 * the whole run, which says nothing about the thing that matters here: the
 * pure layers — the plan solver, the scene model, navigation — are the ones
 * that must stay near-total, while the DOM layer is covered by the browser
 * check and by Vitest in a real browser.
 *
 * There are TWO reports, because there are two runners:
 * `coverage/lcov.info` from `bun test` (the pure layers) and
 * `coverage-component/lcov.info` from Vitest's browser mode (the DOM layer).
 * Both are written on every run of their runner, so this costs nothing beyond
 * the run that already happened.
 *
 * Usage: `bun run scripts/coverage-check.ts` after `bun run test`, and
 * `bun run scripts/coverage-check.ts --component` after `bun run
 * test:component`. An explicit path may be given instead, which is what the
 * tests do.
 */

import { readFileSync } from 'node:fs';

/**
 * The floor each layer must hold, as a fraction of executable lines.
 *
 * 0.9 for a pure layer that already reaches it; the measured value rounded
 * down for the two that do not, so the number can only go up. `materials` is
 * low because
 * most of it is canvas texture generation that needs a real `CanvasRenderingContext2D`
 * (those are measured under Vitest's browser mode).
 */
export const LAYER_FLOORS: Readonly<Record<string, number>> = {
  'src/assets': 0.9,
  'src/layout': 0.87,
  'src/materials': 0.43,
  'src/navigation': 0.9,
  'src/plan': 0.9,
  'src/scene': 0.9,
  'src/shared': 0.9,
  'src/telemetry': 0.9,
};

/**
 * The DOM layer's floors, measured by the OTHER runner.
 *
 * `bun test` cannot see these layers at all — they need a document, a shadow
 * root and a WebGL2 context — so they are covered by the Vitest browser level
 * (`vitest.config.ts`), which writes its own `coverage-component/lcov.info`.
 * Two tables rather than one because they are two measurements: a number here
 * says "in a real Chromium", and merging it with a Bun number would say
 * neither.
 *
 * Each floor is a measured value rounded DOWN, so the floor can only rise. The
 * blanket target for the DOM layer is 60 %; `app` is the composition root and
 * is the one layer still ratcheting towards it. This table, not a single
 * number, is the reference: no one number matches every layer. Component tests over `viewer-app.ts`'s remaining
 * untested branches (context recovery, page-globals ownership contention)
 * are what would move it next; `context-loss.spec.ts`/`trusted-types.spec.ts`
 * close the two REAL-extension gaps as Playwright e2e instead,
 * since e2e tests do not count towards this Vitest coverage figure.
 *
 * `render` and `embed` are measured here because `swatch-preview.ts`
 * draws into a render target and reads the pixels back, which only a real
 * context can exercise, and the embed page's two trust decisions
 * (`frame-page.ts`) are now driven from a document as `main-embed.ts` drives
 * them. The floors follow the measurement, one ratchet notch at a time.
 */
export const COMPONENT_LAYER_FLOORS: Readonly<Record<string, number>> = {
  'src/app': 0.57,
  'src/doors': 0.6,
  'src/embed': 0.84,
  'src/render': 0.9,
  'src/ui': 0.85,
};

/** Where each runner writes the report this script reads. */
export const BUN_LCOV = 'coverage/lcov.info';
export const COMPONENT_LCOV = 'coverage-component/lcov.info';

export type LayerLines = { found: number; hit: number };
export type CoverageShortfall = { layer: string; measured: number; floor: number };

/**
 * Executable lines and covered lines per `src/<layer>` directory.
 *
 * Only `src/` is measured: `scripts/` is the gate itself and `dev/` is
 * scaffolding, and neither has a coverage target. A layer whose files declare
 * no executable lines at all is left out rather than reported as 0 %.
 */
export function coverageByLayer(lcovPath: string): Record<string, LayerLines> {
  const totals: Record<string, LayerLines> = {};
  let layer: string | null = null;
  for (const line of readFileSync(lcovPath, 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
      // Bun writes repository-relative paths and the V8 provider writes
      // absolute ones, so the layer is found by locating `src` rather than by
      // assuming it is first.
      const parts = line.slice(3).split('/');
      const root = parts.lastIndexOf('src');
      layer = root >= 0 && parts.length > root + 2 ? `src/${parts[root + 1]}` : null;
      continue;
    }
    if (!layer) continue;
    // `LF` is the file's executable line count, `LH` how many of them ran.
    if (line.startsWith('LF:')) (totals[layer] ??= { found: 0, hit: 0 }).found += Number(line.slice(3));
    else if (line.startsWith('LH:')) (totals[layer] ??= { found: 0, hit: 0 }).hit += Number(line.slice(3));
  }
  for (const [key, value] of Object.entries(totals)) {
    if (value.found === 0) delete totals[key];
  }
  return totals;
}

/**
 * Every layer that is under its floor, with the measured fraction rounded to
 * the same two decimals the floors are written in. A layer that has a floor
 * but produced no coverage at all counts as 0 %: a layer that stopped being
 * measured is exactly the regression this guards against.
 */
export function checkCoverage(lcovPath: string, floors: Readonly<Record<string, number>> = LAYER_FLOORS): CoverageShortfall[] {
  const measured = coverageByLayer(lcovPath);
  const shortfalls: CoverageShortfall[] = [];
  for (const [layer, floor] of Object.entries(floors)) {
    const lines = measured[layer];
    const fraction = lines ? Math.floor((lines.hit / lines.found) * 100) / 100 : 0;
    if (fraction < floor) shortfalls.push({ layer, measured: fraction, floor });
  }
  return shortfalls;
}

// Run as a script, not when imported by a test.
//
// `bun run check:coverage` checks the pure layers against Bun's report;
// `bun run check:coverage --component` checks the DOM layers against Vitest's.
// A path may still be given explicitly, which is what the tests do.
if (import.meta.main) {
  const component = process.argv.includes('--component');
  const floors = component ? COMPONENT_LAYER_FLOORS : LAYER_FLOORS;
  const positional = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  const path = positional ?? (component ? COMPONENT_LCOV : BUN_LCOV);
  const label = component ? 'DOM layer' : 'pure layers';
  const shortfalls = checkCoverage(path, floors);
  if (shortfalls.length > 0) {
    console.error(`Coverage check FAILED (${label}):`);
    for (const entry of shortfalls) {
      console.error(`  ${entry.layer}  ${(entry.measured * 100).toFixed(1)} % of ${(entry.floor * 100).toFixed(0)} %`);
    }
    process.exit(1);
  }
  const measured = coverageByLayer(path);
  const report = Object.keys(floors)
    .map((layer) => {
      const lines = measured[layer];
      const percent = lines ? (100 * lines.hit) / lines.found : 0;
      return `${layer.slice(4)} ${percent.toFixed(1)}%`;
    })
    .join(', ');
  console.log(`Coverage check OK (${label}): ${report}`);
}
