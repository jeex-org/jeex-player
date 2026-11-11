/**
 * What a document's libraries delivered: the `assets` event a host reads to
 * learn that a tour loaded only in part (a model that fell back to its
 * procedural stand-in, a surface left flat, the byte budget reached), which
 * `ready` alone cannot say.
 *
 * Invariant: one event per document, raised when its first model pass settles
 * (`SceneMount.onModelsSettled`). Texture failures are counted from the
 * instance's log, by the codes a texture leaves when its surface stays flat
 * (`materials/texture-source.ts`), from the moment the document was mounted;
 * a revision of the same document keeps the count.
 */

import type { UpgradeResult } from '../geometry/scene-builder.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { LogEntry } from '../shared/logger.js';
import type { ViewerAssetsInfo } from './viewer-events.js';

/** The warnings of a texture whose surface stays flat. */
const TEXTURE_FAILURES: ReadonlySet<string> = new Set([
  'texture-decode',
  'texture-size-mismatch',
  'texture-ktx2',
  'texture-deadline',
  'texture-too-large',
  'texture-fetch',
  'texture-location',
]);

export class AssetsReport {
  private readonly emit: (info: ViewerAssetsInfo) => void;
  /** The document the count belongs to; a different model is a new mount. */
  private model: SceneModel | null = null;
  private texturesFailed = 0;

  constructor(emit: (info: ViewerAssetsInfo) => void) {
    this.emit = emit;
  }

  /** Every entry of the instance's log passes here first. */
  observe(entry: LogEntry): void {
    if (TEXTURE_FAILURES.has(entry.code)) this.texturesFailed += 1;
  }

  /** A document is on screen: a new one starts its count from zero, a revision keeps it. */
  document(model: SceneModel): void {
    if (model === this.model) return;
    this.model = model;
    this.texturesFailed = 0;
  }

  /** The first model pass of the document on screen settled. */
  settled(result: UpgradeResult): void {
    const { upgraded, failed, budget } = result;
    this.emit({ models: { upgraded, failed, budget }, textures: { failed: this.texturesFailed } });
  }
}
