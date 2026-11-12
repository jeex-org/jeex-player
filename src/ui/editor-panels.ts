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
 *
 * Each request is built by one method per kind, read at the moment it is
 * built, so `refresh()` (a locale switch) rebuilds the open panel's request for
 * the same target and anchor and the UI relabels it in place.
 */

import type { DemoAsset, ReplaceAssetOp, SceneData } from '../scene/types.js';
import type { VariantBank } from '../assets/asset-variants.js';
import type { OpeningListEntry } from '../geometry/opening-builder.js';
import type { Messages } from './messages.js';
import type { ViewerUI } from './viewer-ui.js';
import type { FinishTarget } from './selection-options.js';
import type { PanelRequest } from './selection-panel.js';
import type { ReplacePopupRequest } from './replace-popup.js';
import {
  finishPanelRequest,
  furniturePanelRequest,
  interiorPanelRequest,
  openingPanelRequest,
  replacePopupRequest,
} from './panel-requests.js';

/** What the open panel is editing. */
export type PanelTarget =
  | ({ kind: 'surface' } & FinishTarget)
  | { kind: 'furniture'; assetId: string }
  | { kind: 'opening'; openingId: string }
  | { kind: 'interior' }
  | null;

/** What the panels read of the editor and the document, and where their picks go. */
export type EditorPanelsPort = {
  ui: Pick<
    ViewerUI,
    'openPanel' | 'refreshPanel' | 'closePanel' | 'wakeControls' | 'openReplacePopup' | 'refreshReplacePopup' | 'isReplacePopupOpen'
  >;
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
  /** Where the open finish or opening panel was anchored, so `refresh()` rebuilds it there. */
  private pickAnchor = { x: 0, y: 0 };
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
    const anchor = { x: clientX, y: clientY };
    const request = this.finishRequest(target, anchor);
    // A surface the paint vocabulary cannot address (a floor click that carried
    // no room) opens nothing, which is also what `describeSelection` answers
    // for it: one rule, in `selection-options.ts`.
    if (!request) return;
    this.pickAnchor = anchor;
    this.panelTarget = { kind: 'surface', ...target };
    this.port.ui.openPanel(request);
  }

  openReplacePanel(assetId: string): void {
    const request = this.furnitureRequest(assetId);
    if (!request) return;
    this.panelTarget = { kind: 'furniture', assetId };
    this.port.ui.openPanel(request);
    this.port.ui.wakeControls();
  }

  openOpeningPanel(openingId: string, clientX: number, clientY: number): void {
    const anchor = { x: clientX, y: clientY };
    const request = this.openingRequest(openingId, anchor);
    if (!request) return;
    this.pickAnchor = anchor;
    this.panelTarget = { kind: 'opening', openingId };
    this.port.ui.openPanel(request);
    this.port.ui.wakeControls();
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
    port.ui.openPanel(this.interiorRequest());
    port.ui.wakeControls();
  }

  /**
   * Rebuilds the open panel's request, for the same target and where it
   * stands, in the catalogue on screen NOW, and has the UI relabel it in
   * place: the scope tick, the active swatch and the focus stay. An open
   * replace popup over the furniture panel is relabelled the same way.
   * `handle.setLocale` calls it; with no panel open it does nothing.
   */
  refresh(): void {
    const target = this.panelTarget;
    if (!target) return;
    const { port } = this;
    let request: PanelRequest | null = null;
    if (target.kind === 'surface') request = this.finishRequest(target, this.pickAnchor);
    else if (target.kind === 'furniture') request = this.furnitureRequest(target.assetId);
    else if (target.kind === 'opening') request = this.openingRequest(target.openingId, this.pickAnchor);
    else request = this.interiorRequest();
    if (request) port.ui.refreshPanel(request);
    if (target.kind !== 'furniture' || !port.ui.isReplacePopupOpen()) return;
    const popup = this.popupRequest(target.assetId);
    if (popup) port.ui.refreshReplacePopup(popup);
  }

  closePanel(): void {
    this.port.ui.closePanel();
  }

  private finishRequest(target: FinishTarget, anchor: { x: number; y: number }): PanelRequest | null {
    const { port } = this;
    return finishPanelRequest({
      messages: port.messages(),
      scene: port.scene(),
      target,
      variants: port.variants(),
      anchor,
      onPick: (finishId, scopeChecked) => port.applyFinish(finishId, scopeChecked),
      onApplyToAll: (finishId, scopeChecked) => port.applyFinishToAll(finishId, scopeChecked),
    });
  }

  private furnitureRequest(assetId: string): PanelRequest | null {
    const { port } = this;
    const placement = port.scene().assets.find((asset) => asset.id === assetId);
    if (!placement) return null;
    return furniturePanelRequest({
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
    });
  }

  /** The popup the furniture panel's «Replace with another…» opens, as `furniturePanelRequest` builds it. */
  private popupRequest(assetId: string): ReplacePopupRequest | null {
    const { port } = this;
    const placement = port.scene().assets.find((asset) => asset.id === assetId);
    if (!placement) return null;
    return replacePopupRequest({
      messages: port.messages(),
      placement,
      variants: port.variants(),
      renderPreview: (definition, variantId) => port.furniturePreview(definition, variantId),
      previews: this.offerPreviews,
      onPick: (op) => port.commitReplace(op),
    });
  }

  private openingRequest(openingId: string, anchor: { x: number; y: number }): PanelRequest | null {
    const { port } = this;
    const entry = port.openings().find((item) => item.id === openingId);
    if (!entry) return null;
    return openingPanelRequest({
      messages: port.messages(),
      entry,
      current: port.openingVariantOf(openingId),
      anchor,
      onPick: (variantId) => {
        if (this.panelTarget?.kind !== 'opening') return;
        port.requestOpeningVariant(this.panelTarget.openingId, variantId);
      },
      onStandard: (variantId) => {
        this.closePanel();
        port.requestOpeningVariant(openingId, variantId);
      },
    });
  }

  private interiorRequest(): PanelRequest {
    const { port } = this;
    return interiorPanelRequest({
      messages: port.messages(),
      presets: port.scene().interiors ?? [],
      activeId: port.activePresetId(),
      anchor: this.interiorAnchor,
      onPick: (presetId) => port.commitPreset(presetId),
    });
  }

  /** Drops the panel target when the UI closes the panel for any other reason. */
  forgetPanelTarget(): void {
    this.panelTarget = null;
  }
}
