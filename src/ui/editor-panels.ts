/**
 * The viewer editor's four panels: which one is open, on what, and the
 * request each opens with (`panel-requests.ts` builds the requests; this
 * module decides when, anchors them and keeps their target).
 *
 * The finish panel opens on a floor or wall click, the replace panel on a
 * furniture pick, the opening panel on a window, door or passage, and the
 * interior panel from the control bar. Every pick in a panel goes back to the
 * editor through the port's callbacks, so this module commits nothing and
 * never reads the model beyond the committed scene it is handed.
 *
 * Invariant: `target()` names what the open panel edits, and only while that
 * panel is the one the chrome shows: closing it for any reason goes through
 * `forgetPanelTarget`, so a late pick in a closed panel finds no target.
 */

import type { DemoAsset, ReplaceAssetOp, SceneData } from '../scene/types.js';
import type { VariantBank } from '../assets/asset-variants.js';
import type { OpeningListEntry } from '../geometry/opening-builder.js';
import type { Messages } from './messages.js';
import type { ViewerUI } from './viewer-ui.js';
import type { FinishTarget } from './selection-options.js';
import { finishPanelRequest, furniturePanelRequest, interiorPanelRequest, openingPanelRequest } from './panel-requests.js';

/** What the open panel is editing. */
export type PanelTarget =
  | ({ kind: 'surface' } & FinishTarget)
  | { kind: 'furniture'; assetId: string }
  | { kind: 'opening'; openingId: string }
  | { kind: 'interior' }
  | null;

/** What the panels read of the editor and the document, and where their picks go. */
export type EditorPanelsPort = {
  ui: Pick<ViewerUI, 'openPanel' | 'closePanel' | 'wakeControls' | 'openReplacePopup'>;
  /** The catalogue on screen now, read per panel: `handle.setLocale` replaces it. */
  messages: () => Messages;
  /** The committed scene. */
  scene: () => SceneData;
  /** The document's variant bank, absent for a bare scene. */
  variants: () => VariantBank | undefined;
  /** The built openings, for the opening panel's entry. */
  openings: () => OpeningListEntry[];
  /** The `edits` mode in force: `'off'` offers no replace and no interior panel. */
  editsMode: () => 'local' | 'emit' | 'off';
  openingVariantOf: (openingId: string) => string | null;
  /** Offscreen preview of one furniture variant, `null` when it cannot be rendered. */
  furniturePreview: (placement: DemoAsset, variantId: string) => string | null;
  /** The interior preset in force, ringed in the interior panel. */
  activePresetId: () => string | null;
  /** The interior panel is about the whole flat: it clears the selection. */
  clearSelection: () => void;
  applyFinish: (finishId: string, scopeChecked: boolean) => void;
  applyFinishToAll: (finishId: string | null, scopeChecked: boolean) => void;
  requestFurnitureVariant: (assetId: string, variantId?: string) => void;
  requestOpeningVariant: (openingId: string, variantId: string) => void;
  /** «Replace with another…»: the popup's pick, as one op. */
  commitReplace: (op: ReplaceAssetOp) => void;
  commitPreset: (presetId: string) => void;
};

export class EditorPanels {
  private readonly port: EditorPanelsPort;
  private panelTarget: PanelTarget = null;
  /** Where the interior panel last opened, so a commit does not move it. */
  private interiorAnchor = { x: 0, y: 0 };
  /** Rendered previews of the popup's offers, per archetype: rendering one is the expensive part of opening it. */
  private readonly offerPreviews = new Map<string, string | null>();

  constructor(port: EditorPanelsPort) {
    this.port = port;
  }

  /** What the open panel is editing, `null` when none is. */
  target(): PanelTarget {
    return this.panelTarget;
  }

  openFinishPanel(target: FinishTarget, clientX: number, clientY: number): void {
    const { port } = this;
    const request = finishPanelRequest({
      messages: port.messages(),
      scene: port.scene(),
      target,
      variants: port.variants(),
      anchor: { x: clientX, y: clientY },
      onPick: (finishId, scopeChecked) => port.applyFinish(finishId, scopeChecked),
      onApplyToAll: (finishId, scopeChecked) => port.applyFinishToAll(finishId, scopeChecked),
    });
    // A surface the paint vocabulary cannot address (a floor click that carried
    // no room) opens nothing, which is also what `describeSelection` answers
    // for it: one rule, in `selection-options.ts`.
    if (!request) return;
    this.panelTarget = { kind: 'surface', ...target };
    port.ui.openPanel(request);
  }

  openReplacePanel(assetId: string): void {
    const { port } = this;
    const placement = port.scene().assets.find((asset) => asset.id === assetId);
    if (!placement) return;
    this.panelTarget = { kind: 'furniture', assetId };
    port.ui.openPanel(
      furniturePanelRequest({
        messages: port.messages(),
        placement,
        renderPreview: (definition, variantId) => port.furniturePreview(definition, variantId),
        variants: port.variants(),
        onPick: (variantId) => {
          if (this.panelTarget?.kind !== 'furniture') return;
          port.requestFurnitureVariant(this.panelTarget.assetId, variantId);
        },
        onStandard: (variantId) => {
          this.closePanel();
          port.requestFurnitureVariant(assetId, variantId);
        },
        replace:
          port.editsMode() === 'off'
            ? undefined
            : { previews: this.offerPreviews, open: (popup) => port.ui.openReplacePopup(popup), commit: (op) => port.commitReplace(op) },
      }),
    );
    port.ui.wakeControls();
  }

  openOpeningPanel(openingId: string, clientX: number, clientY: number): void {
    const { port } = this;
    const entry = port.openings().find((item) => item.id === openingId);
    if (!entry) return;
    this.panelTarget = { kind: 'opening', openingId };
    port.ui.openPanel(
      openingPanelRequest({
        messages: port.messages(),
        entry,
        current: port.openingVariantOf(openingId),
        anchor: { x: clientX, y: clientY },
        onPick: (variantId) => {
          if (this.panelTarget?.kind !== 'opening') return;
          port.requestOpeningVariant(this.panelTarget.openingId, variantId);
        },
        onStandard: (variantId) => {
          this.closePanel();
          port.requestOpeningVariant(openingId, variantId);
        },
      }),
    );
    port.ui.wakeControls();
  }

  /**
   * The interior-preset panel. Unlike the other three it is opened from the
   * control bar rather than from a pick, so it anchors to the shell and clears
   * whatever was selected: a preset is about the whole flat.
   */
  openInteriorPanel(anchor?: { x: number; y: number }): void {
    const { port } = this;
    // `'off'` opens no panel. The interiors button reaches this through `ui-commands`,
    // outside the `director-wiring` pick gate, so the panel refuses on its own.
    if (port.editsMode() === 'off') return;
    const presets = port.scene().interiors ?? [];
    if (presets.length === 0) return;
    // Remembered, so re-opening after a commit keeps the panel where it was.
    if (anchor) this.interiorAnchor = anchor;
    port.clearSelection();
    this.panelTarget = { kind: 'interior' };
    port.ui.openPanel(
      interiorPanelRequest({
        messages: port.messages(),
        presets,
        activeId: port.activePresetId(),
        anchor: this.interiorAnchor,
        onPick: (presetId) => port.commitPreset(presetId),
      }),
    );
    port.ui.wakeControls();
  }

  closePanel(): void {
    this.port.ui.closePanel();
  }

  /** Drops the panel target when the UI closes the panel for any other reason. */
  forgetPanelTarget(): void {
    this.panelTarget = null;
  }
}
