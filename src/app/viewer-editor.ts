/**
 * Everything the user can select and change from inside the viewport: the
 * selection aura, the three replace/finish panels, and the operations those
 * panels dispatch.
 *
 * Invariant: this module never mutates `SceneData` or a material directly. A
 * click becomes a `SceneOp`, the `SceneModel` validates and commits it, and the
 * commit comes back through `applyRevision`, which is the only place furniture
 * groups, opening groups and the scene root are swapped. That is what keeps the
 * exported draft and what the viewer shows identical.
 */

import type { UsageSink } from '../shared/usage.js';
import * as THREE from 'three';
import { effectiveAsset } from '../scene/types.js';
import { mirrorFactsOf } from '../geometry/asset-mirror.js';
import { isApplyOk, type ApplyResult, type SceneModel } from '../scene/scene-model.js';
import { SceneBuilder, FURNITURE_GROUP_NAME, type BuildResult } from '../geometry/scene-builder.js';
import type { EditsWiring } from './edits-wiring.js';
import type { Picker, SurfacePick } from '../geometry/picker.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { FurnitureAnimator } from '../geometry/furniture-animator.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import type { SceneOp, TouchedEntity } from '../scene/scene-ops.js';
import { dispatchTouched, type TouchedHandlers } from '../geometry/touched-kind.js';
import type { DemoAsset, SceneData } from '../scene/types.js';
import { adoptPlacements, assetIdOf, followPlacement, type PlacementFollowDeps } from './placement-follow.js';
import { finishPanelRequest, furniturePanelRequest, interiorPanelRequest, openingPanelRequest } from '../ui/panel-requests.js';
import {
  assetLabel,
  describeSelection as describeSelectionCore,
  finishApplyAllAction,
  finishPickAction,
  libraryChoiceOf,
  openingLabel,
  type DescribeTarget,
  type FinishTarget,
  type SelectionDescription,
} from '../ui/selection-options.js';
import { applyPresetBatch, findPreset, presetBatchOps } from '../scene/interior-presets.js';
import type { Messages } from '../ui/messages.js';
import type { VariantBank } from '../assets/asset-variants.js';
import {
  beginSelectionGlowFadeOut,
  createSelectionGlow,
  disposeSelectionGlow,
  updateSelectionGlow,
  type SelectionGlow,
} from '../geometry/selection-glow.js';

export type EditorDeps = {
  model: SceneModel;
  ui: ViewerUI;
  /** This instance's catalogue; every hint and panel title below comes from it. */
  messages: Messages;
  picker: Picker;
  builder: SceneBuilder;
  animator: FurnitureAnimator;
  dollhouse: Dollhouse;
  /** Honest offscreen preview of a furniture group, or `null` when unavailable. */
  renderPreview: (group: THREE.Group) => string | null;
  /**
   * Variant bank of the document on screen: the loaded project's, or absent
   * for a bare scene. It is what makes a catalogue-only archetype offer a
   * Replace list and what carries the content's own previews.
   */
  variants?: VariantBank | undefined;
  /**
   * Rebuilds the whole scene root after a plan-level change and puts it into
   * the scene graph, the picker and the dollhouse. Returns the new build, or
   * `null` when the root could not be replaced. It does NOT re-seed the
   * consumers of the document — that is `reseed`, and the split is what fixes
   * the ordering (see `rebuildShell`).
   */
  rebuild: () => BuildResult | null;
  /** What this viewer does with an edit made in its own panel (`edits-wiring.ts`). */
  edits: EditsWiring;
  /**
   * Re-seeds everything DERIVED from the document — camera obstacles, tour
   * route, the furniture toggle, the debug API. Called only after
   * the new root has been adopted, never before.
   */
  reseed: () => void;
  /** Hears an interior preset the visitor applied (`shared/usage.ts`). */
  usage?: UsageSink | undefined;
};

/** What the open panel is editing. */
type PanelTarget =
  | ({ kind: 'surface' } & FinishTarget)
  | { kind: 'furniture'; assetId: string }
  | { kind: 'opening'; openingId: string }
  | { kind: 'interior' }
  | null;

export class ViewerEditor {
  private readonly deps: EditorDeps;
  /** Shorthand for `deps.messages`: this module writes a lot of copy. */
  private get messages(): Messages {
    return this.deps.messages;
  }
  private panelTarget: PanelTarget = null;
  private furnitureGroup: THREE.Group | null = null;
  private readonly furnitureAssets = new Map<string, THREE.Group>();
  /** Each placement as its body was last built or stood for it (`placement-follow.ts`). */
  private readonly shownPlacements = new Map<string, DemoAsset>();
  private selectionGlow: SelectionGlow | null = null;
  /** Deselected auras still dissolving; disposed by `updateGlows` once their fade-out completes. */
  private readonly fadingGlows: SelectionGlow[] = [];
  private selectedAssetId: string | null = null;
  private selectedOpeningId: string | null = null;
  /** Preset applied last; any hand edit through `dispatch` clears it. */
  private activePresetId: string | null = null;
  /** Where the interior panel last opened, so a commit does not move it. */
  private interiorAnchor = { x: 0, y: 0 };

  /**
   * The touched-entity dispatch table `applyRevision` folds over — shared in
   * SHAPE (the `TouchedHandlers` table and the `dispatchTouched` loop,
   * `geometry/touched-kind.ts`) with `SceneBuilder.applyRevision`'s own
   * table, which dispatches the kinds this one ignores (one shared
   * touched-entity dispatch table for the two `applyRevision`s). A class field, not a module constant, because the
   * handlers close over `this` to reach the private swap methods.
   */
  private readonly touchedHandlers: TouchedHandlers<SceneData> = {
    asset: (scene, { id }) => {
      followPlacement(this.placements, scene, id);
    },
    opening: (scene, { id }) => {
      for (const wall of scene.walls) {
        const opening = wall.openings?.find((candidate) => candidate.id === id);
        if (opening?.variant) {
          this.swapOpening(id, opening.variant);
          return;
        }
      }
    },
    // `facade`/`floor`/`walls`/`ceiling`/`trim`/`face` are `SceneBuilder`'s to paint; `shell`
    // never reaches this table (`applyRevision` returns before it does);
    // cameras, navigation and the tour have consumers of their own. None of
    // them touch furniture or opening groups.
    facade: () => undefined,
    floor: () => undefined,
    walls: () => undefined,
    ceiling: () => undefined,
    trim: () => undefined,
    face: () => undefined,
    shell: () => undefined,
    camera: () => undefined,
    navigation: () => undefined,
    autotour: () => undefined,
    tourCheckpoints: () => undefined,
  };

  /** What `followPlacement` works with: this editor's registries and its two furniture actions. */
  private readonly placements: PlacementFollowDeps;

  constructor(deps: EditorDeps) {
    this.deps = deps;
    this.placements = {
      bodies: this.furnitureAssets,
      shown: this.shownPlacements,
      container: () => this.furnitureGroup,
      builder: deps.builder,
      picker: deps.picker,
      animator: deps.animator,
      release: (assetId) => {
        if (this.selectedAssetId === assetId) this.clearSelection();
        if (this.panelTarget?.kind === 'furniture' && this.panelTarget.assetId === assetId) this.closePanel();
      },
      swap: (assetId, variantId) => this.swapFurniture(assetId, variantId),
    };
  }

  /**
   * Adopts a freshly built root: finds the furniture container, hands its items
   * to the animator and registers them with the picker.
   */
  attachRoot(root: THREE.Object3D): void {
    this.furnitureGroup = (root.getObjectByName(FURNITURE_GROUP_NAME) as THREE.Group | null) ?? null;
    this.deps.animator.attach(this.furnitureGroup);
    adoptPlacements(this.placements, this.deps.model.scene.assets);
  }

  /**
   * One placement's stand-in has just become its GLB (`SceneBuilder`'s
   * `onSwapped`, routed here by `app/scene-mount.ts`): the pick registries
   * follow the meshes, and so does the aura.
   *
   * `Picker.registerFurniture` both TAGS a furniture mesh (`surface`,
   * `assetId`) and indexes it, so without this the upgraded body is invisible
   * to a click and the click falls through to the floor behind it, while the
   * detached stand-in sits in the registry at whatever world matrix it last
   * had (`geometry/picker.ts`; found on furniture loaded from a catalogue).
   *
   * Only the body this editor still OWNS is registered. A model downloads for
   * hundreds of milliseconds, and in that window a variant swap can replace the
   * placement's group (`swapFurniture`, whose old group leaves the graph on the
   * animator's tween) or a plan-level rebuild can replace the whole root — the
   * pass is not aborted for either, so it lands on a group nobody draws any
   * more. Registering THAT one would put invisible ghosts into `pickables` that
   * swallow clicks and, since `unregister` only ever walks the live root,
   * survive into the next document. The registry `Map` is the test rather than
   * "is it still under the root", because the swapped-out group is still
   * attached while its tween plays.
   */
  adoptUpgradedBody(group: THREE.Group, replaced: readonly THREE.Object3D[]): void {
    for (const body of replaced) this.deps.picker.unregister(body);
    const assetId = assetIdOf(group);
    if (this.furnitureAssets.get(assetId) !== group) return;
    this.deps.picker.registerFurniture(group, assetId);
    // The live aura was sized to the stand-in's boxes; re-selecting rebuilds it
    // around the body that is now on screen.
    if (this.selectedAssetId === assetId) this.selectFurniture(assetId);
  }

  // ------------------------------------------------------------- picking ----

  /** Orbit click on a floor, a wall or an opening. */
  handleSurfacePick(pick: SurfacePick | null, clientX: number, clientY: number): void {
    this.clearSelection();
    if (pick?.surface === 'opening') {
      if (!pick.openingId) {
        this.closePanel();
        return;
      }
      this.selectOpening(pick.openingId);
      this.openOpeningPanel(pick.openingId, clientX, clientY);
      return;
    }
    if (pick && (pick.surface === 'floor' || pick.surface === 'wall')) {
      this.openFinishPanel({ surface: pick.surface, roomId: pick.roomId, face: pick.face }, clientX, clientY);
      return;
    }
    this.closePanel();
  }

  /** Orbit click on furniture; `null` means the click missed every object. */
  handleFurniturePick(assetId: string | null): void {
    if (!assetId) {
      this.clearSelection();
      this.closePanel();
      return;
    }
    this.selectFurniture(assetId);
    this.openReplacePanel(assetId);
  }

  // -------------------------------------------------------------- panels ----

  private openFinishPanel(target: FinishTarget, clientX: number, clientY: number): void {
    const request = finishPanelRequest({
      messages: this.messages,
      scene: this.deps.model.scene,
      target,
      variants: this.deps.variants,
      anchor: { x: clientX, y: clientY },
      onPick: (finishId, scopeChecked) => this.applyFinish(finishId, scopeChecked),
      onApplyToAll: (finishId, scopeChecked) => this.applyFinishToAll(finishId, scopeChecked),
    });
    // A surface the paint vocabulary cannot address (a floor click that carried
    // no room) opens nothing, which is also what `describeSelection` answers
    // for it: one rule, in `selection-options.ts`.
    if (!request) return;
    this.panelTarget = { kind: 'surface', ...target };
    this.deps.ui.openPanel(request);
  }

  private openReplacePanel(assetId: string): void {
    const placement = this.deps.model.scene.assets.find((asset) => asset.id === assetId);
    if (!placement) return;
    this.panelTarget = { kind: 'furniture', assetId };
    this.deps.ui.openPanel(
      furniturePanelRequest({
        messages: this.messages,
        placement,
        renderPreview: (definition, variantId) => this.furniturePreview(definition, variantId),
        variants: this.deps.variants,
        onPick: (variantId) => {
          if (this.panelTarget?.kind !== 'furniture') return;
          this.requestFurnitureVariant(this.panelTarget.assetId, variantId);
        },
        onStandard: (variantId) => {
          this.closePanel();
          this.requestFurnitureVariant(assetId, variantId);
        },
      }),
    );
    this.deps.ui.wakeControls();
  }

  private openOpeningPanel(openingId: string, clientX: number, clientY: number): void {
    const entry = this.deps.builder.openingsList().find((item) => item.id === openingId);
    if (!entry) return;
    this.panelTarget = { kind: 'opening', openingId };
    this.deps.ui.openPanel(
      openingPanelRequest({
        messages: this.messages,
        entry,
        current: this.openingVariantOf(openingId),
        anchor: { x: clientX, y: clientY },
        onPick: (variantId) => {
          if (this.panelTarget?.kind !== 'opening') return;
          this.requestOpeningVariant(this.panelTarget.openingId, variantId);
        },
        onStandard: (variantId) => {
          this.closePanel();
          this.requestOpeningVariant(openingId, variantId);
        },
      }),
    );
    this.deps.ui.wakeControls();
  }

  /**
   * The interior-preset panel. Unlike the other three it is opened from the
   * control bar rather than from a pick, so it anchors to the shell and clears
   * whatever was selected: a preset is about the whole flat.
   */
  openInteriorPanel(anchor?: { x: number; y: number }): void {
    // `'off'`: a click opens no panel (only `select`). The
    // control-bar interiors button reaches this panel through `ui-commands`,
    // OUTSIDE the `director-wiring` pick gate, so the panel refuses on its own,
    // the same way the pick paths do.
    if (this.deps.edits.mode === 'off') return;
    const presets = this.deps.model.scene.interiors ?? [];
    if (presets.length === 0) return;
    // Remembered, so re-opening after a commit keeps the panel where it was.
    if (anchor) this.interiorAnchor = anchor;
    this.clearSelection();
    this.panelTarget = { kind: 'interior' };
    this.deps.ui.openPanel(
      interiorPanelRequest({
        messages: this.messages,
        presets,
        activeId: this.activePresetId,
        anchor: this.interiorAnchor,
        onPick: (presetId) => this.commitPreset(presetId),
      }),
    );
    this.deps.ui.wakeControls();
  }

  /**
   * Seam 2 of 2: what a click in the interiors PANEL does.
   *
   * It exists because a preset does not go through `dispatch` — `applyPreset`
   * commits its batch itself (`applyPresetBatch`, `interior-presets.ts`), so
   * gating `dispatch` alone would have let the one panel that commits the most
   * slip straight past `edits: 'emit'`.
   *
   * `applyPreset` itself stays UNGATED on purpose: it is also
   * `__viewerDebug.applyPreset`, an authoring surface behind `options.debug`
   * that `scripts/browser-check/presets.ts` drives and a host never sees.
   */
  private commitPreset(presetId: string): void {
    // `'off'` is not `'local'`: a pick that reaches this seam anyway must
    // commit and emit nothing. The debug `applyPreset` stays
    // ungated — this seam is the panel's, not the authoring surface's.
    if (this.deps.edits.mode === 'off') return;
    const model = this.deps.model;
    const preset = findPreset(model.scene, presetId);
    if (!preset) return;
    if (this.deps.edits.mode !== 'emit') {
      // Counted once the batch is accepted: a refused preset is not an applied one.
      if (isApplyOk(this.applyPreset(presetId))) this.deps.usage?.('interior');
      return;
    }
    this.deps.usage?.('interior');
    this.deps.edits.onEdit({ ops: presetBatchOps(model.scene, preset, model.registries), baseRev: model.rev });
  }

  /**
   * Applies a whole interior in one revision. Public, because it is also the
   * debug hook; a refused batch reports through the same hint sink as any other
   * refusal and leaves the active preset alone.
   */
  applyPreset(presetId: string): ApplyResult {
    const model = this.deps.model;
    const preset = findPreset(model.scene, presetId);
    this.deps.ui.setPanelBusy(true);
    let result: ApplyResult;
    try {
      result = applyPresetBatch(model, presetId, 'preset');
    } finally {
      this.deps.ui.setPanelBusy(false);
    }
    if (!isApplyOk(result)) {
      this.deps.ui.setHint(this.messages.t('hint.changeRefused', { message: result.message }));
      return result;
    }
    this.activePresetId = presetId;
    if (preset) this.deps.ui.setHint(this.messages.t('interiors.applied', { name: preset.name }));
    // Re-open so the active ring, and the swatches themselves, match the commit.
    if (this.panelTarget?.kind === 'interior') this.openInteriorPanel();
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

  closePanel(): void {
    this.deps.ui.closePanel();
  }

  /** Drops the panel target when the UI closes the panel for any other reason. */
  forgetPanelTarget(): void {
    this.panelTarget = null;
  }

  // ---------------------------------------------------------- dispatching ---

  /**
   * Dispatches a batch to the model. Every scene change in the viewer goes
   * through here: nothing mutates `SceneData` or the geometry directly.
   */
  private dispatch(...ops: SceneOp[]): void {
    const model = this.deps.model;
    if (ops.length === 0) return;
    // Seam 1 of 2. `'emit'` keeps the panel and its answer exactly
    // as they are and only changes where the batch goes: out to the host,
    // never into this viewer's own model, so the two copies of the document
    // cannot drift apart.
    if (this.deps.edits.mode === 'emit') {
      this.deps.edits.onEdit({ ops, baseRev: model.rev });
      return;
    }
    const result = model.apply({ baseRev: model.rev, ops });
    if ('error' in result) {
      this.deps.ui.setHint(this.messages.t('hint.changeRefused', { message: result.message }));
      return;
    }
    // Any hand edit makes the document something no preset describes any more.
    // `applyPreset` commits its batch itself, so it never passes through here.
    this.activePresetId = null;
  }

  /**
   * One swatch click: paints the floor, the room walls, one face or the facade.
   *
   * WHICH op that is belongs to `selection-options.ts` — the same builder that
   * puts an `op` on every swatch `describeSelection` hands a host, so the panel
   * and the host card can never commit two different things.
   */
  private applyFinish(finishId: string, scopeChecked: boolean): void {
    const target = this.panelTarget;
    if (!target || target.kind !== 'surface') return;
    const action = finishPickAction(target, finishId, scopeChecked, libraryChoiceOf(this.deps.variants?.materials, finishId));
    if (!action) return;
    this.dispatch(action.op);
    if (action.hint) this.deps.ui.setHint(this.messages.t(action.hint));
  }

  /** Footer button of the finish panel: the active swatch, applied broadly. */
  private applyFinishToAll(finishId: string | null, scopeChecked: boolean): void {
    const target = this.panelTarget;
    if (!finishId || !target || target.kind !== 'surface') return;
    const action = finishApplyAllAction(target, finishId, scopeChecked, libraryChoiceOf(this.deps.variants?.materials, finishId));
    if (action) this.dispatch(action.op);
    if (action?.hint) this.deps.ui.setHint(this.messages.t(action.hint));
    this.closePanel();
  }

  private requestFurnitureVariant(assetId: string, variantId?: string): void {
    if (!variantId) return;
    const placement = this.deps.model.scene.assets.find((asset) => asset.id === assetId);
    if (!placement || placement.variant === variantId) return;
    this.dispatch({ op: 'replace_asset_variant', assetId, variant: variantId });
  }

  private requestOpeningVariant(openingId: string, variantId: string): void {
    if (this.openingVariantOf(openingId) === variantId) return;
    this.dispatch({ op: 'replace_opening_variant', openingId, variant: variantId });
  }

  // ----------------------------------------------------- applying commits ---

  /**
   * The half of a commit the geometry facade hands back: furniture and opening
   * groups (pick registries, auras, swap animations) and plan changes, which
   * need a full rebuild.
   */
  applyRevision(touched: readonly TouchedEntity[]): void {
    if (SceneBuilder.needsRebuild(touched)) {
      this.rebuildShell();
      return;
    }
    dispatchTouched(this.deps.model.scene, touched, this.touchedHandlers);
  }

  /**
   * Rebuilds one opening in place and re-registers its pick meshes.
   *
   * The aura follows the object only when the object was the SELECTED one — a
   * hand swap keeps its selection, an interior preset (nineteen openings in one
   * batch) leaves nothing glowing.
   */
  private swapOpening(openingId: string, variantId: string): void {
    const builder = this.deps.builder;
    if (builder.getOpeningVariant(openingId) === variantId) return;
    const oldGroup = builder.getOpeningGroup(openingId);
    const wasSelected = this.selectedOpeningId === openingId;
    this.clearSelection();
    if (oldGroup) this.deps.picker.unregister(oldGroup);
    if (!builder.rebuildOpening(openingId, variantId)) return;
    const group = builder.getOpeningGroup(openingId);
    if (group) {
      this.deps.picker.registerOpening(group, (wallId) => this.deps.dollhouse.isExterior(wallId));
      if (wasSelected) this.selectOpening(openingId);
    }
    this.deps.dollhouse.update();
  }

  /** Swaps a furniture item for another bank variant with the pop tween. */
  private swapFurniture(assetId: string, variantId: string | undefined): void {
    const placement = this.deps.model.scene.assets.find((asset) => asset.id === assetId);
    const oldGroup = this.furnitureAssets.get(assetId);
    if (!placement || !oldGroup) return;
    const wasSelected = this.selectedAssetId === assetId;
    this.clearSelection();
    const newGroup = this.deps.builder.buildFurnitureVariant(placement, variantId);
    if (!newGroup) return;
    this.furnitureGroup?.add(newGroup);
    this.furnitureAssets.set(assetId, newGroup);
    // Retarget the pick registry to the new meshes.
    this.deps.picker.unregister(oldGroup);
    this.deps.picker.registerFurniture(newGroup, assetId);
    this.deps.animator.swap(oldGroup, newGroup, effectiveAsset(placement).scale, () => {
      if (wasSelected) this.selectFurniture(assetId);
    });
  }

  /**
   * Full rebuild after a plan-level change: the old root leaves the picker and
   * the scene graph, the builder produces a fresh one, and everything that
   * indexes the root is re-registered. `main.ts` never re-runs.
   *
   * Order matters. `reseed` re-applies the AUTHORITATIVE state of everything
   * derived from the document — furniture visibility above all — so the new
   * root has to be adopted first. Re-seeding before the adoption pushed the
   * visibility onto the disposed group and left hidden furniture visible again
   * on the freshly built one.
   */
  /**
   * Full rebuild plus the adoption and re-seed that must follow it. Public
   * because a DRIFT (`SceneBuilder.applyRevision` reporting a paint it could
   * not perform) takes the same road: whatever the shell and the model disagree
   * about, one honest rebuild from the committed document settles it.
   */
  rebuildFromDocument(): void {
    this.rebuildShell();
  }

  private rebuildShell(): void {
    this.clearSelection();
    this.closePanel();
    const rebuilt = this.deps.rebuild();
    if (!rebuilt) return;
    this.attachRoot(rebuilt.root);
    this.deps.reseed();
  }

  // ------------------------------------------------------------ selection ---

  /** Wraps the selected furniture in a soft iridescent aura (see selection-glow.ts). */
  private selectFurniture(assetId: string): void {
    this.clearSelection();
    const group = this.furnitureAssets.get(assetId);
    const placement = this.deps.model.scene.assets.find((asset) => asset.id === assetId);
    if (!group || !placement) return;
    this.selectedAssetId = assetId;
    this.attachGlow(group, this.messages.t('hint.selected', { name: assetLabel(placement, this.deps.variants) }));
  }

  /** Wraps a picked window, door or passage in the same aura. */
  private selectOpening(openingId: string): void {
    this.clearSelection();
    const group = this.deps.builder.getOpeningGroup(openingId);
    if (!group) return;
    this.selectedOpeningId = openingId;
    const entry = this.deps.builder.openingsList().find((item) => item.id === openingId);
    const label = entry ? openingLabel(entry.type, entry.entrance, this.messages) : this.messages.t('opening.generic');
    this.attachGlow(group, this.messages.t('hint.selected', { name: label }));
  }

  private attachGlow(group: THREE.Group, hint: string): void {
    const glow = createSelectionGlow(group);
    group.add(glow.group);
    this.selectionGlow = glow;
    this.deps.ui.setHint(hint);
    this.deps.ui.wakeControls();
  }

  /** Starts the aura's fade-out; the envelopes are disposed by `updateGlows`. */
  clearSelection(): void {
    if (this.selectionGlow) {
      beginSelectionGlowFadeOut(this.selectionGlow, performance.now() / 1000);
      this.fadingGlows.push(this.selectionGlow);
    }
    this.selectionGlow = null;
    this.selectedAssetId = null;
    this.selectedOpeningId = null;
  }

  /** Per-frame aura tick: advances the live aura and reaps the finished ones. */
  updateGlows(nowMs: number): void {
    const seconds = nowMs / 1000;
    updateSelectionGlow(this.selectionGlow, seconds);
    for (let index = this.fadingGlows.length - 1; index >= 0; index -= 1) {
      // `index` walks the array's own length backwards, so it is always in range.
      const glow = this.fadingGlows[index]!;
      if (updateSelectionGlow(glow, seconds)) continue;
      disposeSelectionGlow(glow);
      this.fadingGlows.splice(index, 1);
    }
  }

  /**
   * Frees what the editor owns: the live aura and every aura still dissolving.
   * Idempotent, so a double release (teardown after an error path) is safe.
   */
  dispose(): void {
    disposeSelectionGlow(this.selectionGlow);
    this.selectionGlow = null;
    for (const glow of this.fadingGlows.splice(0)) disposeSelectionGlow(glow);
    this.selectedAssetId = null;
    this.selectedOpeningId = null;
    this.furnitureAssets.clear();
    this.furnitureGroup = null;
  }

  // ------------------------------------------------------------ debug API ---

  selectedFurniture(): string | null {
    return this.selectedAssetId;
  }

  selectedOpening(): string | null {
    return this.selectedOpeningId;
  }

  /**
   * What the viewer's own panel would show for a selection, as DATA
   * (`ViewerHandle.describeSelection`).
   *
   * It opens nothing and commits nothing, so it answers the same in every
   * `edits` mode — `'off'`, where no panel exists at all, included. The
   * previews come from the same offscreen renderer the panel's swatches use;
   * the ops from the same builders `applyFinish` and `requestFurnitureVariant`
   * dispatch.
   */
  describeSelection(target: DescribeTarget): SelectionDescription | null {
    return describeSelectionCore(target, {
      scene: this.deps.model.scene,
      messages: this.messages,
      openings: this.deps.builder.openingsList(),
      renderPreview: (placement, variantId) => this.furniturePreview(placement, variantId),
      variants: this.deps.variants,
      // The facts the built body was tagged with (`asset-loader.ts`): the shipped bank or the project's own library.
      mirrorFacts: (placement) => mirrorFactsOf(this.furnitureAssets.get(placement.id)),
    });
  }

  /**
   * Offscreen preview of one furniture variant, or `null` when it cannot be
   * rendered. One owner for both callers — the panel's swatches and
   * `describeSelection`'s options — so the two pictures cannot drift apart.
   */
  private furniturePreview(placement: DemoAsset, variantId: string): string | null {
    const group = this.deps.builder.buildFurnitureVariant(placement, variantId);
    return group ? this.deps.renderPreview(group) : null;
  }

  /** Variant currently committed for an opening, model first, geometry second. */
  openingVariantOf(openingId: string): string | null {
    for (const wall of this.deps.model.scene.walls) {
      const opening = (wall.openings ?? []).find((candidate) => candidate.id === openingId);
      if (opening) return opening.variant ?? this.deps.builder.getOpeningVariant(openingId);
    }
    return null;
  }
}
