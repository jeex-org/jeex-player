import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPONENT_LAYER_FLOORS, LAYER_FLOORS, checkCoverage, coverageByLayer } from './coverage-check.js';

/** One lcov record: a file, how many lines it has and how many were hit. */
function record(file: string, found: number, hit: number): string {
  return `SF:${file}\nLF:${found}\nLH:${hit}\nend_of_record\n`;
}

function lcovFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'jeex-cov-'));
  const path = join(dir, 'lcov.info');
  writeFileSync(path, body);
  return path;
}

describe('coverageByLayer', () => {
  test('sums the lines of every file into its layer directory', () => {
    const path = lcovFile(
      record('src/plan/plan-solver.ts', 100, 95) + record('src/plan/plan-graph.ts', 100, 90) + record('src/shared/easing.ts', 10, 10),
    );
    expect(coverageByLayer(path)).toEqual({
      'src/plan': { found: 200, hit: 185 },
      'src/shared': { found: 10, hit: 10 },
    });
  });

  test('a file outside src/ has no layer and is not counted', () => {
    const path = lcovFile(record('scripts/budget-check.ts', 50, 10) + record('src/scene/types.ts', 10, 10));
    expect(coverageByLayer(path)).toEqual({ 'src/scene': { found: 10, hit: 10 } });
  });

  test('a layer with no measurable lines is dropped rather than counted as zero', () => {
    expect(coverageByLayer(lcovFile(record('src/plan/empty.ts', 0, 0)))).toEqual({});
  });
});

describe('checkCoverage', () => {
  test('a layer at or above its floor passes', () => {
    const path = lcovFile(record('src/plan/a.ts', 100, 90));
    expect(checkCoverage(path, { 'src/plan': 0.9 })).toEqual([]);
  });

  test('a layer below its floor is reported with both numbers', () => {
    const path = lcovFile(record('src/plan/a.ts', 100, 89));
    expect(checkCoverage(path, { 'src/plan': 0.9 })).toEqual([{ layer: 'src/plan', measured: 0.89, floor: 0.9 }]);
  });

  test('a layer that has a floor but no measured lines is a failure, not a pass', () => {
    const path = lcovFile(record('src/scene/a.ts', 10, 10));
    expect(checkCoverage(path, { 'src/plan': 0.9 })).toEqual([{ layer: 'src/plan', measured: 0, floor: 0.9 }]);
  });

  test('every floor is one of the layers the repository actually has', () => {
    for (const layer of Object.keys(LAYER_FLOORS)) {
      expect({ layer, prefixed: layer.startsWith('src/') }).toEqual({ layer, prefixed: true });
    }
  });
});

describe('the two floor tables', () => {
  test('the pure and the DOM tables name different layers', () => {
    const overlap = Object.keys(LAYER_FLOORS).filter((layer) => layer in COMPONENT_LAYER_FLOORS);
    // Two runners, two measurements: a layer floored in both would be held to
    // a number one of them cannot produce.
    expect(overlap).toEqual([]);
  });

  test('every DOM floor names a layer under src/', () => {
    for (const layer of Object.keys(COMPONENT_LAYER_FLOORS)) {
      expect({ layer, prefixed: layer.startsWith('src/') }).toEqual({ layer, prefixed: true });
    }
  });

  test('an absolute path is attributed to the same layer as a relative one', () => {
    // Bun writes repository-relative paths; the V8 provider writes absolute
    // ones. Both have to land in `src/ui`, or the DOM floors would read as 0 %.
    const relative = lcovFile(record('src/ui/tour-bar.ts', 10, 8));
    const absolute = lcovFile(record('/Users/someone/checkout/src/ui/tour-bar.ts', 10, 8));
    expect(coverageByLayer(absolute)).toEqual(coverageByLayer(relative));
  });

  test('a path with a nested src directory takes the LAST one', () => {
    // `node_modules/thing/src/...` must not be attributed to this project's
    // layers; taking the last `src` keeps the attribution on the real one.
    const path = lcovFile(record('/checkout/src/vendor/src/embed/host.ts', 10, 5));
    expect(coverageByLayer(path)).toEqual({ 'src/embed': { found: 10, hit: 5 } });
  });
});
