/**
 * The interior presets of the viewer editor: which one is in force, the
 * interiors panel's pick, and the whole-flat batch a preset commits.
 *
 * A preset does not go through the editor's `dispatch`: `applyPreset` commits
 * its batch itself (`applyPresetBatch`, `scene/interior-presets.ts`), so the
 * panel's pick (`commitPreset`) gates the `edits` mode on its own.
 *
 * Invariant: `activeId` names the preset the committed document was last
 * brought to, and nothing else: a refused preset leaves it alone, and any
 * hand edit through the editor's `dispatch` clears it (`clear`).
 */

import type { UsageSink } from '../shared/usage.js';
import { isApplyOk, type ApplyResult, type SceneModel } from '../scene/scene-model.js';
import { applyPresetBatch, findPreset, presetBatchOps } from '../scene/interior-presets.js';
import type { Messages } from '../ui/messages.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { EditsWiring } from './edits-wiring.js';

export type EditorPresetsDeps = {
  model: SceneModel;
  ui: Pick<ViewerUI, 'setPanelBusy' | 'setHint'>;
  /** The catalogue on screen now (`handle.setLocale` replaces it). */
  messages: () => Messages;
  /** What this viewer does with an edit made in its own panel (`edits-wiring.ts`). */
  edits: EditsWiring;
  /** Hears an interior preset the visitor applied (`shared/usage.ts`). */
  usage?: UsageSink | undefined;
  /** Re-opens the interiors panel in place when it is the one open, so the active ring follows a commit. */
  reopenPanel: () => void;
};

export class EditorPresets {
  private readonly deps: EditorPresetsDeps;
  /** Preset applied last; any hand edit clears it. */
  private activePresetId: string | null = null;

  constructor(deps: EditorPresetsDeps) {
    this.deps = deps;
  }

  /** The preset in force, `null` after a hand edit or before any. */
  activeId(): string | null {
    return this.activePresetId;
  }

  /** A hand edit made the document something no preset describes any more. */
  clear(): void {
    this.activePresetId = null;
  }

  /**
   * What a click in the interiors PANEL does.
   *
   * It exists because a preset does not go through `dispatch` — `applyPreset`
   * commits its batch itself, so gating `dispatch` alone would have let the
   * one panel that commits the most slip straight past `edits: 'emit'`.
   *
   * `applyPreset` itself stays UNGATED on purpose: it is also
   * `__viewerDebug.applyPreset`, an authoring surface behind `options.debug`
   * that `scripts/browser-check/presets.ts` drives and a host never sees.
   */
  commitPreset(presetId: string): void {
    // `'off'` is not `'local'`: a pick that reaches this seam anyway must
    // commit and emit nothing.
    const { edits, model } = this.deps;
    if (edits.mode === 'off') return;
    const preset = findPreset(model.scene, presetId);
    if (!preset) return;
    if (edits.mode !== 'emit') {
      // Counted once the batch is accepted: a refused preset is not an applied one.
      if (isApplyOk(this.applyPreset(presetId))) this.deps.usage?.('interior');
      return;
    }
    this.deps.usage?.('interior');
    edits.onEdit({ ops: presetBatchOps(model.scene, preset, model.registries), baseRev: model.rev });
  }

  /**
   * Applies a whole interior in one revision. Public, because it is also the
   * debug hook; a refused batch reports through the same hint sink as any other
   * refusal and leaves the active preset alone.
   */
  applyPreset(presetId: string): ApplyResult {
    const { model, ui } = this.deps;
    const messages = this.deps.messages();
    const preset = findPreset(model.scene, presetId);
    ui.setPanelBusy(true);
    let result: ApplyResult;
    try {
      result = applyPresetBatch(model, presetId, 'preset');
    } finally {
      ui.setPanelBusy(false);
    }
    if (!isApplyOk(result)) {
      ui.setHint(messages.t('hint.changeRefused', { message: result.message }));
      return result;
    }
    this.activePresetId = presetId;
    if (preset) ui.setHint(messages.t('interiors.applied', { name: preset.name }));
    // Re-open so the active ring, and the swatches themselves, match the commit.
    this.deps.reopenPanel();
    return result;
  }

  /** Presets the scene offers, with the one in force marked. */
  presets(): Array<{ id: string; name: string; active: boolean }> {
    return (this.deps.model.scene.interiors ?? []).map((preset) => ({
      id: preset.id,
      name: preset.name,
      active: preset.id === this.activePresetId,
    }));
  }
}
