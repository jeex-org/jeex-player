/**
 * How `vitest run --shard=<index>/<count>` splits the component tier: by
 * measured cost, not by file count.
 *
 * Vitest's own `BaseSequencer.shard` sorts the files by a hash of their path
 * and cuts the list into equal COUNTS. On this tier that is badly unbalanced:
 * the files range from a few milliseconds (a DOM-only shell test) to minutes
 * (a file that mounts the demo apartment fifty times on the software
 * rasteriser), so two shards of twenty files each can differ by a factor of
 * three in wall clock, and the slowest shard decides how long CI takes.
 *
 * So the sequencer below hands every shard the same list of files and lets
 * `assignShards` place them with the longest-processing-time rule: heaviest
 * file first, each onto the shard with the least cost so far. Every shard
 * computes the same assignment from the same inputs, so the shards never
 * overlap and never miss a file.
 *
 * `COMPONENT_FILE_COST_S` is a measurement, not a guess: the seconds each
 * file took in the hosted runner jobs of the "Browser tests" workflow
 * (run 40102002308 on main, 2026-10-24: one Vitest worker per job,
 * SwiftShader, no GPU; 4931 s for 65 of the 66 files), rounded, with 1 s as
 * the floor. A file that failed counts what it cost, timeouts included, since
 * that is what its shard waited for. `export-library.test.ts` was added after
 * that run and keeps its earlier value (a simulated runner, 2026-10-21) until
 * the next measurement; `lamp-scope.test.ts` was added later still and
 * keeps a local software-rasteriser measurement the same way. The runner is two to fourteen times slower per file
 * than that simulation was. A file
 * missing from the table (a new one) costs `UNKNOWN_FILE_COST_S`, which is
 * deliberately above the median, so a new heavy file cannot pile onto an
 * already full shard unnoticed. The table only steers the balance; a stale
 * entry makes a shard slower, never skips a test. Re-measure and rewrite it
 * when the tier changes shape (`scripts/component-shards.test.ts` lists the
 * files the table misses).
 *
 * Without `--shard` Vitest never calls `shard()`, so a local run and the
 * gate are untouched by this file.
 */

import { basename } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/** Measured seconds per component test file (module comment). */
export const COMPONENT_FILE_COST_S: Readonly<Record<string, number>> = {
  'asset-mirror.test.ts': 42,
  'asset-move.test.ts': 266,
  'baked-shell.test.ts': 6,
  'baked-surface.test.ts': 39,
  'baked-surface-walk.test.ts': 216,
  'camera-preview.test.ts': 1,
  'capture-commands.test.ts': 44,
  // Measured on this machine's SwiftShader with one worker (2026-10-26), not on the hosted runner.
  'compact-hint.test.ts': 1,
  'door-hud.test.ts': 1,
  'element.test.ts': 355,
  'export-glb-conformance.test.ts': 2,
  'export-gltf.test.ts': 5,
  'export-graph.test.ts': 1,
  'export-library.test.ts': 40,
  'export-usdz.test.ts': 34,
  'first-frame.test.ts': 219,
  'focus-visible.test.ts': 1,
  'frame-boot.test.ts': 24,
  'frame-bridge.test.ts': 84,
  'fullscreen-controller.test.ts': 1,
  'gltf-body.test.ts': 1,
  'gltf-furniture.test.ts': 1,
  // Measured on this machine's SwiftShader with one worker (2026-10-25), not on the hosted runner.
  'hdri-assets.test.ts': 1,
  'hdri-walk.test.ts': 102,
  'host-slots.test.ts': 27,
  'ktx2.test.ts': 1,
  'lamp-lights.test.ts': 3,
  // Measured on this machine's SwiftShader, 2026-10-25 (291 s), until the next runner measurement.
  'lamp-scope.test.ts': 291,
  'lamp-shade-emissive.test.ts': 200,
  'library-material.test.ts': 1,
  'library-panel.test.ts': 12,
  'light-bake-hook.test.ts': 22,
  'lighting-calibration.test.ts': 1,
  'lightmap-calibration.test.ts': 2,
  'lightmap-decode.test.ts': 1,
  'lightmap-page.test.ts': 1,
  'light-temperature.test.ts': 370,
  'minimap.test.ts': 1,
  'no-webgl.test.ts': 1,
  'panorama.test.ts': 1,
  'plan-modes.test.ts': 22,
  'plan-raster.test.ts': 1,
  'project-finishes.test.ts': 1,
  'project-mark.test.ts': 32,
  'project-mount.test.ts': 52,
  'provenance.test.ts': 1,
  'render-on-demand.test.ts': 292,
  'render-runtime-lighting.test.ts': 2,
  'replace-popup.test.ts': 40,
  'selection-highlight.test.ts': 1,
  'selection-panel.test.ts': 1,
  'selection.test.ts': 59,
  'settings-panel.test.ts': 558,
  'still-capture.test.ts': 2,
  'sun-shadow-motion.test.ts': 468,
  'sun-shadow.test.ts': 102,
  'swatch-preview.test.ts': 116,
  'target-sizes.test.ts': 1,
  'texture-prewarm.test.ts': 21,
  'tour-bar.test.ts': 1,
  'tour-cameras.test.ts': 267,
  'video-frames.test.ts': 41,
  'viewer-api.test.ts': 664,
  'viewer-chrome.test.ts': 2,
  'viewer-edits.test.ts': 91,
  'viewer-shell.test.ts': 1,
  // Measured on this machine's SwiftShader with one worker (2026-10-26), not on the hosted runner.
  'viewer-theme.test.ts': 1,
  'viewer-ui.test.ts': 1,
  // Skipped on the software rasteriser it is measured on: GPU measurements only.
  'walk-glossy.test.ts': 1,
  'walk-keys.test.ts': 37,
  'walk-lighting.test.ts': 276,
  'walk-post.test.ts': 46,
  'webgl-probe.test.ts': 1,
  'wheel-ownership.test.ts': 1,
};

/** What a file the table does not name is assumed to cost (module comment). */
export const UNKNOWN_FILE_COST_S = 60;

/** The cost `assignShards` uses for one file, by its base name. */
export function fileCost(file: string, costs: Readonly<Record<string, number>> = COMPONENT_FILE_COST_S): number {
  return costs[basename(file)] ?? UNKNOWN_FILE_COST_S;
}

/**
 * The files of shard `index` (1-based, as `--shard` spells it) out of `count`.
 *
 * Longest processing time first: sort by cost, heaviest first, ties by path
 * so the order never depends on the order the files were found in; then put
 * each file on the shard with the smallest total so far, ties to the lowest
 * shard number. Deterministic, so every shard derives the same split.
 */
export function assignShards<T>(
  files: readonly T[],
  index: number,
  count: number,
  pathOf: (file: T) => string,
  costOf: (path: string) => number = fileCost,
): T[] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`shard count must be a positive integer, got ${count}`);
  if (!Number.isInteger(index) || index < 1 || index > count) throw new Error(`shard index must be 1..${count}, got ${index}`);
  const ordered = files
    .map((file) => ({ file, path: pathOf(file), cost: costOf(pathOf(file)) }))
    .sort((a, b) => b.cost - a.cost || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const totals = Array.from({ length: count }, () => 0);
  const picked: T[] = [];
  for (const entry of ordered) {
    let target = 0;
    for (let shard = 1; shard < count; shard += 1) {
      if (totals[shard]! < totals[target]!) target = shard;
    }
    totals[target] = totals[target]! + entry.cost;
    if (target === index - 1) picked.push(entry.file);
  }
  return picked;
}

/** Vitest's sequencer with `shard()` replaced by `assignShards`; sorting is Vitest's own. */
export class CostShardSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    return assignShards(files, index, count, (spec) => spec.moduleId);
  }
}
