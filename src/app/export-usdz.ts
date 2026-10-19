/**
 * `exportUsdz`: turns the committed document into a USDZ for iOS Quick Look.
 *
 * Shares `export-gltf.ts`'s throwaway export ( `prepareExport`, `ExportDeps`):
 * the same solved plan, the same fresh `SceneBuilder`, the same `exportGraph`
 * clone — element metadata (`EXT_structural_metadata`) is a glTF concept with
 * no USD equivalent this phase ships, so this module reads only the graph
 * `prepareExport` returns, never its `rows`.
 *
 * `USDZExporter.parseAsync` rasterises every texture through a `<canvas>`
 * (`three/addons/exporters/USDZExporter.js`), a browser-only path — this
 * module (and its test) only run where one exists, exactly like
 * `export-gltf.ts`'s `FileReader` dependency.
 *
 * `USDZExporter` is imported behind `exportUsdz`, never at module load, so it
 * lands in its own `lazy-*` chunk (`scripts/budget-check.ts`) and a host that
 * never calls it never downloads it.
 */

import { prepareExport, type ExportDeps } from './export-gltf.js';
import { ViewerLibError } from '../shared/errors.js';
import type { ExportUsdzOptions } from './export-types.js';

// Re-exported so every existing `from './export-usdz.js'` import
// (`viewer-api.ts`, `embed/frame-bridge.ts`) keeps working; the type itself
// lives in `export-types.ts` (`export-types.ts`'s header explains why).
export type { ExportUsdzOptions } from './export-types.js';

const DEFAULT_OPTIONS: Required<ExportUsdzOptions> = { includeFurniture: true };

function notReady(action: string): ViewerLibError {
  return new ViewerLibError('not-ready', `${action}: no scene is on screen yet`);
}

/**
 * Exports the committed document as a USDZ: `USDZExporter.parseAsync` over
 * `exportGraph`'s prepared clone, `quickLookCompatible: true` so the archive
 * opens straight in iOS Quick Look. Rejects with `ViewerLibError('not-ready')`
 * before the first scene.
 */
export async function exportUsdz(deps: ExportDeps, options: ExportUsdzOptions = {}): Promise<Blob> {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const scene = deps.getScene();
  if (!scene) throw notReady('exportUsdz');

  const { graph, dispose } = prepareExport(scene, { includeFurniture: resolved.includeFurniture, state: 'current' });
  try {
    const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
    const exporter = new USDZExporter();
    // `parseAsync` hands back a `Uint8Array` (fflate's `zipSync`, despite the
    // module's own doc comment calling it an arraybuffer) whose `.buffer` is
    // typed `ArrayBufferLike`, which `BlobPart` refuses under TS 7's stricter
    // DOM lib — copied into a fresh `ArrayBuffer` the same way `exportGlb`
    // hands its patched GLB bytes to `Blob`.
    const bytes = (await exporter.parseAsync(graph, { quickLookCompatible: true })) as Uint8Array;
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return new Blob([buffer], { type: 'model/vnd.usdz+zip' });
  } finally {
    dispose();
  }
}
