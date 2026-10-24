/**
 * What an export of the mounted document draws its room surfaces with: the
 * project materials and finish lookup the live view resolves them from, and
 * the live view's own texture sources (the project's, the bundled finishes').
 *
 * Answered by `SceneMount.exportSurfaces()` and handed to `exportGlb` /
 * `exportUsdz` through `ExportDeps.getSurfaces`; never part of the public
 * handle. The texture handles carry no redraw hook (an export changes nothing
 * on screen) and refuse compressed maps (the writers cannot read one back).
 */

import type { LibraryTextures } from '../geometry/library-surface.js';
import type { FinishLookup } from '../geometry/builder-context.js';
import type { ProjectMaterial } from '../materials/finish-types.js';

export type ExportSurfaces = {
  /** The project's materials, for room surfaces only; absent for a bare scene. */
  readonly surfaceMaterials?: readonly ProjectMaterial[] | undefined;
  /** The room-surface finish lookup the document is drawn with; the bundled catalogue when absent. */
  readonly findFinish?: FinishLookup | undefined;
  /** The project's texture source; `null` without a project or a WebGL context. */
  readonly textures: LibraryTextures | null;
  /** The bundled finishes' source; `null` without a WebGL context. */
  readonly builtinTextures: LibraryTextures | null;
};

/** `textures` as an export may use it: the same source and device class, no redraw hook, no compressed maps. */
export function forExport(textures: LibraryTextures | null | undefined): LibraryTextures | null {
  return textures === null || textures === undefined ? null : { source: textures.source, device: textures.device, compressed: false };
}
