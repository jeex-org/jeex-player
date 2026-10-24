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
 * file's tests took on SwiftShader with one Vitest worker on four hardware
 * threads and no GPU (the shape of a CI runner job, simulated with
 * `taskset`; 1446 s for the whole tier, measured 2026-10-21), rounded, with
 * 1 s as the floor. A file
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
  'asset-mirror.test.ts': 10,
  'asset-move.test.ts': 137,
  'baked-shell.test.ts': 3,
  'baked-surface-walk.test.ts': 80,
  'baked-surface.test.ts': 10,
  'camera-preview.test.ts': 1,
  'capture-commands.test.ts': 68,
  'door-hud.test.ts': 1,
  'element.test.ts': 204,
  'export-glb-conformance.test.ts': 3,
  'export-gltf.test.ts': 7,
  'export-graph.test.ts': 1,
  'export-usdz.test.ts': 22,
  'first-frame.test.ts': 74,
  'focus-visible.test.ts': 1,
  'frame-boot.test.ts': 11,
  'frame-bridge.test.ts': 108,
  'fullscreen-controller.test.ts': 1,
  'gltf-body.test.ts': 1,
  'gltf-furniture.test.ts': 1,
  'host-slots.test.ts': 33,
  'ktx2.test.ts': 1,
  'lamp-lights.test.ts': 2,
  'library-material.test.ts': 2,
  'library-panel.test.ts': 4,
  'light-bake-hook.test.ts': 20,
  'light-temperature.test.ts': 120,
  'lighting-calibration.test.ts': 1,
  'lightmap-calibration.test.ts': 2,
  'lightmap-decode.test.ts': 1,
  'lightmap-page.test.ts': 1,
  'minimap.test.ts': 1,
  'no-webgl.test.ts': 1,
  'panorama.test.ts': 1,
  'plan-modes.test.ts': 1,
  'plan-raster.test.ts': 1,
  'project-finishes.test.ts': 1,
  'project-mark.test.ts': 24,
  'project-mount.test.ts': 73,
  'provenance.test.ts': 1,
  'render-on-demand.test.ts': 96,
  'render-runtime-lighting.test.ts': 1,
  'selection-highlight.test.ts': 1,
  'selection-panel.test.ts': 1,
  'selection.test.ts': 18,
  'settings-panel.test.ts': 40,
  'still-capture.test.ts': 1,
  'sun-shadow-motion.test.ts': 297,
  'sun-shadow.test.ts': 36,
  'swatch-preview.test.ts': 20,
  'target-sizes.test.ts': 1,
  'texture-prewarm.test.ts': 3,
  'tour-bar.test.ts': 1,
  'tour-cameras.test.ts': 232,
  'video-frames.test.ts': 53,
  'viewer-api.test.ts': 269,
  'viewer-chrome.test.ts': 2,
  'viewer-edits.test.ts': 115,
  'viewer-shell.test.ts': 1,
  'viewer-ui.test.ts': 1,
  'walk-keys.test.ts': 22,
  'walk-lighting.test.ts': 198,
  'walk-post.test.ts': 24,
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
