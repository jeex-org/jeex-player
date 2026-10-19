/**
 * Builders for the four `PanelRequest`s the viewer opens: surface finishes,
 * furniture variants, opening variants and interior presets.
 *
 * Everything here is a pure function of scene data plus callbacks — the titles,
 * the swatch items, the scope row and the footer label. `ViewerUI` renders the
 * request, `viewer-editor.ts` supplies the callbacks; neither has to know how
 * a panel is worded.
 *
 * WHAT a selection offers (which swatches, what each one commits, what the
 * scope row means) is `selection-options.ts`'s — the same builder
 * `ViewerHandle.describeSelection` hands a host. This file adds
 * only what a PANEL needs on top: the anchor, the checkbox state, the footer
 * button and the callbacks. There is no second catalogue and no second op.
 *
 * A preview never contains text. `thumbnail` is the image, `label` is
 * the separate caption, and `background` is the flat fallback chip when a
 * preview cannot be rendered (no `document`, no WebGL preview renderer).
 */

import { findFinish, finishPairSwatchDataURL } from '../materials/finishes.js';
import type { PanelItem, PanelRequest } from './viewer-ui.js';
import { defaultOpeningVariant } from '../assets/opening-variants.js';
import type { OpeningListEntry } from '../geometry/opening-builder.js';
import type { DemoAsset, SceneData } from '../scene/types.js';
import type { VariantBank } from '../assets/asset-variants.js';
import type { InteriorPreset } from '../scene/scene-ops.js';
import type { Messages } from './messages.js';
import {
  finishCore,
  finishFooterKey,
  furnitureCore,
  isFacadeTarget,
  openingCore,
  type FinishTarget,
  type SelectionCore,
  type SelectionOptionCore,
} from './selection-options.js';

/** One core swatch as the panel shows it: the picture pair plus the active ring. */
function panelItem(option: SelectionOptionCore, current: string | null, key: string): PanelItem {
  return {
    id: option.id,
    label: option.label,
    // The content's own picture first, the viewer's render second — the same
    // order `describeSelection` gives a host, so the built-in panel and a host
    // card never show two different pictures of one variant.
    thumbnail: option.image ?? option.thumbnail,
    background: option.background,
    active: option.id === current,
    dataset: { [key]: option.id },
  };
}

type FinishPanelArgs = {
  /** This instance\'s catalogue: every title and label below comes from it. */
  messages: Messages;
  /** The committed document: the owner's name and the finish in force come from it. */
  scene: SceneData;
  target: FinishTarget;
  anchor: { x: number; y: number };
  onPick: (finishId: string, scopeChecked: boolean) => void;
  onApplyToAll: (finishId: string | null, scopeChecked: boolean) => void;
};

/**
 * Finish panel for a picked surface. A wall face without a room is a facade
 * face: it gets the "Facade" owner name and its own footer wording, because
 * "apply to all walls" covers rooms only and leaves the facade alone.
 *
 * `null` when the target names nothing paintable, which is exactly when
 * `describeSelection` answers `null` too — one rule, one place.
 */
export function finishPanelRequest(args: FinishPanelArgs): PanelRequest | null {
  const core = finishCore(args.scene, args.target, args.messages);
  if (!core) return null;
  const { target } = args;
  return {
    kind: 'finish',
    title: core.title,
    items: core.options.map((option) => panelItem(option, core.current, 'finish')),
    scope: target.surface === 'wall' && target.face ? { label: args.messages.t('panel.scopeOnlyThisWall'), checked: false } : undefined,
    footer: {
      // The footer's wording is the scope core's `label`; the core carries one
      // only when a finish is in force, and the panel's button exists either
      // way, so the key is spelled out here for the empty case.
      label: core.scope?.label ?? args.messages.t(finishFooterKey(target)),
      onClick: ({ activeId, scopeChecked }) => args.onApplyToAll(activeId, scopeChecked),
    },
    anchor: args.anchor,
    panelData: {
      surface: target.surface,
      owner: isFacadeTarget(target) ? 'facade' : (target.roomId ?? ''),
      ...(target.face ? { wall: target.face.wallId, side: target.face.side } : {}),
    },
    onPick: ({ id, scopeChecked }) => args.onPick(id, scopeChecked),
  };
}

type FurniturePanelArgs = {
  /** This instance\'s catalogue: every title and label below comes from it. */
  messages: Messages;
  placement: DemoAsset;
  /** Honest preview of one variant, or `null` to fall back to the palette chip. */
  renderPreview: (placement: DemoAsset, variantId: string) => string | null;
  /** The loaded project's variant bank, or absent for a bare scene. */
  variants?: VariantBank | undefined;
  onPick: (variantId: string) => void;
  onStandard: (variantId: string | undefined) => void;
};

/** Replace panel for a picked furniture item: the four variants of its archetype. */
export function furniturePanelRequest(args: FurniturePanelArgs): PanelRequest {
  const core = furnitureCore(args.placement, args.messages, args.renderPreview, args.variants);
  return {
    kind: 'furniture',
    title: core.title,
    items: core.options.map((option) => panelItem(option, core.current, 'variant')),
    footer: { label: args.messages.t('panel.standardVariant'), onClick: () => args.onStandard(core.options[0]?.id) },
    // The furniture panel is anchored to the shell, not to the click: the pick
    // point is inside the object being replaced.
    anchor: { x: 0, y: 0 },
    panelData: { asset: args.placement.id },
    onPick: ({ id }) => args.onPick(id),
  };
}

/** Fallback chip of a preset: its floor colour split against its wall colour. */
function presetChipBackground(preset: InteriorPreset): string {
  const floor = findFinish(preset.swatch[0])?.base ?? '#b0a294';
  const wall = findFinish(preset.swatch[1])?.base ?? '#eae4d6';
  return `linear-gradient(135deg, ${floor} 50%, ${wall} 50%)`;
}

type InteriorPanelArgs = {
  /** This instance\'s catalogue: every title and label below comes from it. */
  messages: Messages;
  presets: readonly InteriorPreset[];
  /** Preset applied last, or `null` after any manual edit. */
  activeId: string | null;
  anchor: { x: number; y: number };
  onPick: (presetId: string) => void;
};

/**
 * The interior-preset panel: one two-tone chip per preset — the floor finish
 * against the wall finish, split on the diagonal — with the preset's name as a
 * separate label (the image never carries text).
 *
 * The one panel with no core in `selection-options.ts`: a preset is not a
 * SELECTION. It is opened from the control bar, it edits the whole flat, and
 * its batch is `interior-presets.ts`'s, not one `SceneOp` a host could be
 * handed (a host is handed three kinds of selection, and this is not one of them).
 */
export function interiorPanelRequest(args: InteriorPanelArgs): PanelRequest {
  return {
    kind: 'interior',
    title: args.messages.t('panel.interiors'),
    items: args.presets.map((preset) => {
      const floor = findFinish(preset.swatch[0]);
      const wall = findFinish(preset.swatch[1]);
      return {
        id: preset.id,
        label: preset.name,
        thumbnail: floor && wall ? finishPairSwatchDataURL(floor, wall, 72) : null,
        background: presetChipBackground(preset),
        active: preset.id === args.activeId,
        dataset: { preset: preset.id },
      };
    }),
    anchor: args.anchor,
    panelData: { presets: String(args.presets.length) },
    onPick: ({ id }) => args.onPick(id),
  };
}

type OpeningPanelArgs = {
  /** This instance\'s catalogue: every title and label below comes from it. */
  messages: Messages;
  entry: OpeningListEntry;
  /** Variant currently committed for this opening. */
  current: string | null;
  anchor: { x: number; y: number };
  onPick: (variantId: string) => void;
  onStandard: (variantId: string) => void;
};

/**
 * Replace panel for a picked window, door or passage: the four variants of its
 * family, with text-free schematic previews.
 */
export function openingPanelRequest(args: OpeningPanelArgs): PanelRequest {
  const { entry } = args;
  const core: SelectionCore = openingCore(entry, args.current, args.messages);
  return {
    kind: 'opening',
    title: core.title,
    items: core.options.map((option) => panelItem(option, core.current, 'variant')),
    footer: {
      label: args.messages.t('panel.standardVariant'),
      onClick: () => args.onStandard(defaultOpeningVariant(entry.type, entry.entrance).id),
    },
    anchor: args.anchor,
    panelData: { opening: entry.id, openingType: entry.type, entrance: String(entry.entrance) },
    onPick: ({ id }) => args.onPick(id),
  };
}
