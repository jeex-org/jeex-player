/**
 * The asset edits the viewer emitted and the host has not answered yet: what
 * is on screen, and what a refusal puts back.
 *
 * Every edit is an absolute pose (and mirror state) computed from what the
 * person SEES: a second turn, mirror or move before the host answered the
 * first builds on the first one's result, not on the stored document, so two
 * quick turns are 30°, not 15° twice. `revertAssetEdit` puts back the state
 * before the FIRST pending edit. A committed revision past the one they were
 * made on answers them all, and so does a different document (another scene
 * id) at any revision; the same document handed back at the same revision
 * answers nothing.
 *
 * Pure module: no `three`, no DOM.
 */

import type { DragPose } from '../layout/asset-legality.js';
import type { Mirror, SceneData } from '../scene/types.js';

/** One body's state: its pose and, when an edit touched it, its mirror. */
export type BodyState = { readonly pose: DragPose; readonly mirror?: Mirror };

/** The document the host shows: its scene (whose id names it) at a revision. */
export type OnScreen = { readonly scene: SceneData; readonly rev: number };

export class PendingEdits {
  private sceneId: string | null = null;
  private rev: number | null = null;
  private lastId: string | null = null;
  private readonly starts = new Map<string, BodyState>();
  private readonly shown = new Map<string, BodyState>();

  /** The asset of the last pending edit, `null` when none waits. */
  last(): string | null {
    return this.lastId;
  }

  /** `scene` as the screen shows it while it is still the document and revision the pending edits were made on. */
  sceneOf(scene: SceneData, rev: number): SceneData {
    if (!this.on(scene.id, rev) || this.shown.size === 0) return scene;
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

  /** An emitted edit on scene `sceneId` at revision `rev`: each body's state before it and on screen after it. */
  record(sceneId: string, rev: number, assetId: string, bodies: ReadonlyArray<{ id: string; before: BodyState; after: BodyState }>): void {
    if (!this.on(sceneId, rev)) this.clear();
    this.sceneId = sceneId;
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
  take(doc: OnScreen | null): ReadonlyMap<string, BodyState> | null {
    const current = this.on(doc?.scene.id, doc?.rev);
    const starts = new Map(this.starts);
    this.clear();
    return current && starts.size > 0 ? starts : null;
  }

  /** The document on screen is now `doc`: another scene, or a revision past the pending edits', answers them. */
  answered(doc: OnScreen | null): void {
    if (this.on(doc?.scene.id, doc?.rev)) return;
    this.clear();
  }

  clear(): void {
    this.sceneId = null;
    this.rev = null;
    this.lastId = null;
    this.starts.clear();
    this.shown.clear();
  }

  /** Whether the pending edits were made on scene `sceneId` at revision `rev`. */
  private on(sceneId: string | undefined, rev: number | undefined): boolean {
    return this.rev !== null && this.sceneId === sceneId && this.rev === rev;
  }
}
