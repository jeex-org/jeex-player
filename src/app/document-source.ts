/**
 * Where a mounted viewer's documents come from: the scene source of the first
 * boot, the source of the latest `loadScene`, and the baked project on screen.
 *
 * Invariant: the repository and the project change only after a document has
 * been loaded and VALIDATED, so a `loadScene` that fails leaves the previous
 * document — and so the previous project — exactly as it was. Replacements race
 * by START order: a call that a later one overtook, or that `dispose()`
 * outlived, resolves to `null` and reports nothing.
 */

import { loadDocument, type LoadedDocument, type LoadedProjectContext, type ProjectInfo } from './project-wiring.js';
import { resolveSceneSource, type SceneRepository, type SceneSource } from '../scene/scene-repository.js';
import type { Logger } from '../shared/logger.js';
import type { OffersSource } from '../assets/offers.js';

export class DocumentSource {
  private repository: SceneRepository;
  private readonly source: SceneSource;
  private readonly log: Logger;
  /** The host's offers, loaded with every document (`loadDocument`); absent when none were given. */
  private readonly offers: OffersSource | undefined;
  /** The baked project on screen, or `null` when the document is a bare scene. */
  private loaded: LoadedProjectContext | null = null;
  /** Sequence number of the last replacement started. */
  private seq = 0;

  /** Throws when `source` names no scene: the mount must refuse before it builds anything. */
  constructor(source: SceneSource, log: Logger, offers?: OffersSource) {
    this.source = source;
    this.repository = resolveSceneSource(source);
    this.log = log;
    this.offers = offers;
  }

  /** The manifest and folder of the project on screen, or `null`. */
  project(): ProjectInfo | null {
    return this.loaded?.info ?? null;
  }

  /** The document of a boot (the first one, or a Retry), from the mount's own source. */
  async boot(): Promise<LoadedDocument> {
    const loaded = await loadDocument(this.repository, this.source, this.log, undefined, this.offers);
    this.loaded = loaded.project;
    return loaded;
  }

  /**
   * A replacement from `source`. `null` when superseded or when `released()`;
   * a failure of the current call is handed to `onFailure` and rethrown.
   */
  async replace(source: SceneSource, released: () => boolean, onFailure: (error: unknown) => void): Promise<LoadedDocument | null> {
    const requestId = ++this.seq;
    const stale = () => requestId !== this.seq || released();
    const repository = resolveSceneSource(source);
    let loaded: LoadedDocument;
    try {
      loaded = await loadDocument(repository, source, this.log, undefined, this.offers);
    } catch (error) {
      if (stale()) return null;
      onFailure(error);
      throw error;
    }
    if (stale()) return null;
    this.repository = repository;
    this.loaded = loaded.project;
    return loaded;
  }
}
