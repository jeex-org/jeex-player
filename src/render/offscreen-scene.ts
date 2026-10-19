/**
 * Which DOCUMENT a capture renders: the one on screen, or the one the flat
 * shipped in before anybody painted it.
 *
 * The disclosure rules a rendered listing photo has to satisfy (California
 * AB 723, CRMLS 11.5.2) want the unaltered original
 * beside the staged image. JEEX owns the geometry, so the original is not a
 * second photo shoot: it is the SAME document with the paint taken off, and
 * this module is the one place that says what "taken off" means.
 *
 * Invariant: pure and non-mutating. It reads a committed (deep-frozen)
 * `SceneData` and answers a new one; the live document is never touched, which
 * is what lets the pair be captured without disturbing the viewer on screen.
 */

import type { DemoAsset, SceneData } from '../scene/types.js';

/** Which of the two documents a capture is of. */
export type SceneState = 'current' | 'default';

/**
 * One placement without the finish decisions painted onto it.
 *
 * Both fields go, because the document cannot tell an authored finish from a
 * painted one: `set_material` writes into exactly these two keys
 * (`scene-ops.ts`), so keeping either would keep some of the paint.
 */
function unpainted(asset: DemoAsset): DemoAsset {
  if (asset.finishes === undefined && asset.material === undefined) return asset;
  const stripped: Record<string, unknown> = { ...asset };
  delete stripped['finishes'];
  delete stripped['material'];
  return stripped as unknown as DemoAsset;
}

/**
 * The document to render for `state`.
 *
 * `'current'` is the committed document itself — the caller already holds the
 * only copy that matters. `'default'` is that document with `SceneData.finishes`
 * and every asset's `finishes`/`material` override removed, so every surface
 * and every object falls back to the catalogue default it would have had
 * before a single `set_material` (the flat "as is").
 */
export function documentForState(scene: SceneData, state: SceneState): SceneData {
  if (state === 'current') return scene;
  const stripped: Record<string, unknown> = { ...scene };
  delete stripped['finishes'];
  stripped['assets'] = scene.assets.map(unpainted);
  return stripped as unknown as SceneData;
}
