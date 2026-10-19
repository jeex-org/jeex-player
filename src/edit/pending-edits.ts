/**
 * The asset edits the viewer emitted and the host has not answered yet: what
 * is on screen, and what a refusal puts back.
 *
 * Every edit is an absolute pose (and mirror state) computed from what the
 * person SEES: a second turn, mirror or move before the host answered the
 * first builds on the first one's result, not on the stored document, so two
 * quick turns are 30°, not 15° twice. `revertAssetEdit` puts back the state
 * before the FIRST pending edit. A new document (any committed revision)
 * answers them all.
 *
 * Pure module: no `three`, no DOM.
 */

import type { DragPose } from '../layout/asset-legality.js';
import type { Mirror, SceneData } from '../scene/types.js';

/** One body's state: its pose and, when an edit touched it, its mirror. */
export type BodyState = { readonly pose: DragPose; readonly mirror?: Mirror };

export class PendingEdits {
  private rev: number | null = null;
  private lastId: string | null = null;
  private readonly starts = new Map<string, BodyState>();
  private readonly shown = new Map<string, BodyState>();

  /** The asset of the last pending edit, `null` when none waits. */
  last(): string | null {
    return this.lastId;
  }

  /** `scene` as the screen shows it while it is still the revision the pending edits were made on. */
  sceneOf(scene: SceneData, rev: number): SceneData {
    if (this.rev !== rev || this.shown.size === 0) return scene;
    return {
      ...scene,
      assets: scene.assets.map((asset) => {
        const state = this.shown.get(asset.id);
        if (!state) return asset;
        return {
          ...asset,
          position: { ...state.pose.position },
          rotationY: state.pose.rotationY,
          ...(state.mirror === undefined ? {} : { mirror: state.mirror }),
        };
      }),
    };
  }

  /** An emitted edit on revision `rev`: each body's state before it and on screen after it. */
  record(rev: number, assetId: string, bodies: ReadonlyArray<{ id: string; before: BodyState; after: BodyState }>): void {
    if (this.rev !== rev) this.clear();
    this.rev = rev;
    this.lastId = assetId;
    for (const { id, before, after } of bodies) {
      const first = this.starts.get(id);
      // The state before the first pending edit is what a refusal restores; a mirror recorded later fills its gap.
      if (!first) this.starts.set(id, before);
      else if (first.mirror === undefined && before.mirror !== undefined) this.starts.set(id, { ...first, mirror: before.mirror });
      this.shown.set(id, { ...this.shown.get(id), ...after });
    }
  }

  /** The states to put back, and forget them; `null` when nothing waits or the document moved on. */
  take(currentRev: number | undefined): ReadonlyMap<string, BodyState> | null {
    const rev = this.rev;
    const starts = new Map(this.starts);
    this.clear();
    return rev !== null && rev === currentRev && starts.size > 0 ? starts : null;
  }

  clear(): void {
    this.rev = null;
    this.lastId = null;
    this.starts.clear();
    this.shown.clear();
  }
}
