/**
 * What a selection OFFERS: the swatches of a picked surface, furniture item or
 * opening, each with a picture and the exact `SceneOp` that applies it.
 *
 * One builder, two consumers. The viewer's own panel
 * (`panel-requests.ts` -> `selection-panel.ts`) renders these cores as
 * `PanelRequest`s with callbacks and an anchor; `ViewerHandle.describeSelection`
 * hands the same cores to a HOST that draws its own card and dispatches the op
 * itself. There is deliberately no second implementation of "which finishes
 * does a floor offer" or "what does this swatch commit": a host card and the
 * built-in panel that disagreed would be a bug nobody could see.
 *
 * A preview is an IMAGE and never carries text. `thumbnail` is the
 * honest render (a canvas swatch, an offscreen furniture render) and
 * `background` the flat CSS chip the panel falls back to; `SelectionOption.preview`
 * is never empty, because a host has nowhere to put a CSS gradient — when
 * nothing could be rendered it gets the same palette as an SVG data URL.
 *
 * Purity: no `document`, no scene graph, no `SceneModel`. Everything that needs
 * a renderer arrives as a callback (`renderPreview`), which is what lets this
 * module be unit-tested under Bun and keeps it in the `ui` layer.
 *
 * Cost, and why there is no preview cache. Measured on the demo flat (61
 * placements, `scripts/browser-check/describe.ts` reports the first call of a
 * run): a furniture description with four offscreen renders is 34 ms cold and
 * 8 ms on a repeat of the same placement, 16 ms for another one; nine canvas
 * floor swatches are 59 ms; four schematic opening swatches are 2 ms. The very
 * first call after a mount is ~190 ms, because it is what builds the preview
 * render target. Caching per variant id would save those ~10 ms and buy a
 * staleness bug: `SceneBuilder.upgradeModels` replaces a procedural body with
 * its GLB minutes into a session, and a cached picture would go on showing the
 * stand-in. Rendering on demand is therefore the decision, not an omission.
 */

import { FLOOR_FINISHES, WALL_FINISHES, finishSwatchDataURL, type Finish } from '../materials/finishes.js';
import { activeVariantFor, variantsForPlacement, type AssetVariant, type VariantBank } from '../assets/asset-variants.js';
import type { VariantAccess } from '../assets/asset-types.js';
import { findCatalogueEntry } from '../assets/asset-catalogue.js';
import { openingVariantSwatchDataURL, variantsForOpening, type OpeningVariant } from '../assets/opening-variants.js';
import { faceFinishOf, facadeFinishOf, floorFinishOf, roomWallFinishOf, type SceneOp } from '../scene/scene-ops.js';
import type { OpeningListEntry } from '../geometry/opening-builder.js';
import type { HighlightKind } from '../render/selection-highlight.js';
import type { DemoAsset, FaceKey, MirrorAxis, MirrorFacts, OpeningType, SceneData } from '../scene/types.js';
import { allowedMirrorAxes, mirroredAxes } from '../scene/mirror.js';
import type { MessageKey, Messages } from './messages.js';

/** A surface the finish panel can paint. */
export type FinishTarget = {
  surface: 'floor' | 'wall';
  roomId?: string | undefined;
  /** The picked wall face; `room` is omitted on the facade. */
  face?: FaceKey | undefined;
};

/** The three selections that carry a catalogue behind them. */
export type SelectionDescriptionKind = 'furniture' | 'finish' | 'opening';

/**
 * One swatch as a HOST gets it: a picture it can put in an `<img>` and the
 * operation that applies it, with nothing of the viewer's catalogues attached.
 */
export type SelectionOption = {
  readonly id: string;
  /** The name, as a separate caption — never drawn into `preview`. */
  readonly label: string;
  /**
   * A ready image URL; never empty. Three sources, in order: the address
   * the CONTENT declares (a catalogue's public preview, an `https:` URL), then the viewer's
   * own render as a `data:` URL, then the variant's palette as an SVG
   * `data:` URL.
   *
   * FALLIBLE: the first source is a request to
   * another origin, so a host drawing it in its own `<img>` gives that image
   * an `onerror` and degrades to its own chip or skeleton — which is what the
   * viewer's own panel does (`ui/selection-panel.ts`). A `data:` preview
   * cannot fail, and there is no way to tell the two apart from here, so the
   * handler is written once and always.
   */
  readonly preview: string;
  /**
   * The access level the content declared for this option (catalogue
   * metadata) — absent for everything the viewer's own catalogues answer.
   *
   * The viewer CARRIES it and decides nothing: it puts no badge on a swatch,
   * refuses no click and asks no question. Whether a `pro` variant may be
   * placed is for the host to decide.
   * A host that ignores the field gets exactly the behaviour it had before.
   */
  readonly access?: VariantAccess;
  /**
   * Whether the host's own workspace may take this option, as the HOST wrote
   * it into the library it handed over. Absent means «nobody said», never
   * «no»: the viewer neither computes nor enforces it.
   */
  readonly allowed?: boolean;
  /** Exactly what the built-in panel would dispatch for this swatch. */
  readonly op: SceneOp;
};

/**
 * The breadth the built-in panel offers besides a plain swatch click: its
 * "only this wall" checkbox and its "apply to all …" footer, as the pair of
 * operations they would commit for the finish in force (`current`).
 *
 * Present for a FINISH only. A furniture or opening panel's footer is
 * "Standard variant" — one operation, not a narrow/broad pair — so those
 * descriptions carry no `scope`, and a host that wants the standard variant
 * takes the first option (the banks are ordered standard-first).
 */
export type SelectionScope = {
  /** The broad action's wording ("Apply to all floors" / "… all walls"). */
  readonly label: string;
  readonly ops: {
    /** The narrowest the panel offers: this face, this room's floor. */
    readonly one: SceneOp;
    /** The broadest: every floor, every wall. */
    readonly all: SceneOp;
  };
};

/**
 * Everything the viewer's own selection panel would show for a target, as
 * DATA. `ViewerHandle.describeSelection` answers one of these
 * or `null`; it never opens anything, so `edits: 'off'` changes nothing here.
 */
export type SelectionDescription = {
  readonly kind: SelectionDescriptionKind;
  /** The panel's title, already translated ("Floor finish · Kitchen"). */
  readonly title: string;
  /**
   * What is being edited and its name: the room, placement or opening by its
   * UUID; a single wall face by its wall's UUID, with the face itself in `face`.
   */
  readonly subject: { readonly id: string; readonly label: string; readonly face?: FaceKey };
  /**
   * The option to mark as chosen — exactly what the built-in panel puts its
   * active ring on, defaulting included. A finish is the document's own answer
   * and is `null` when the surface names none; a furniture or opening variant
   * falls back to the archetype's standard one, so `current === null` there
   * means only "this selection offers nothing", never "the document is silent".
   */
  readonly current: string | null;
  readonly options: readonly SelectionOption[];
  readonly scope?: SelectionScope;
  /**
   * Furniture only: the mirror axes the asset's facts allow (the buttons a
   * host card may draw for `handle.mirrorAsset`) and the axes the placement
   * is mirrored on now.
   */
  readonly mirror?: SelectionMirror;
};

/** What `SelectionDescription.mirror` says, axes in `x, y, z` order. */
export type SelectionMirror = { readonly allowed: readonly MirrorAxis[]; readonly current: readonly MirrorAxis[] };

/**
 * One swatch as BOTH consumers need it. The panel takes `thumbnail` +
 * `background` (a CSS chip is the nicer fallback inside the viewer's own
 * markup); a host takes `preview`, which is `thumbnail` or the palette as SVG.
 */
export type SelectionOptionCore = {
  readonly id: string;
  readonly label: string;
  /**
   * Picture the CONTENT declares, already an absolute URL: a catalogue's public
   * preview or a file of the bake's folder. It BEATS `thumbnail`, because it
   * is the finished photograph of the variant while the render is a stand-in
   * of whatever geometry has arrived so far. Absent for every swatch the
   * viewer's own catalogues answer.
   */
  readonly image?: string | undefined;
  readonly thumbnail: string | null;
  readonly background: string;
  /** Colours the flat fallback is built from, in order. */
  readonly palette: readonly string[];
  /** The access level the content declared for this option; carried, not interpreted. */
  readonly access?: VariantAccess | undefined;
  /** Whether the host's workspace may take it, as the host wrote it into the library at handover (`ProjectVariant.allowed`). */
  readonly allowed?: boolean | undefined;
  readonly op: SceneOp;
};

/** A whole selection before either consumer has shaped it. */
export type SelectionCore = {
  readonly kind: SelectionDescriptionKind;
  readonly title: string;
  readonly subject: { readonly id: string; readonly label: string };
  readonly current: string | null;
  readonly options: readonly SelectionOptionCore[];
  readonly scope?: SelectionScope | undefined;
};

/** Colour of the chip when a catalogue entry names no usable colour at all. */
const FALLBACK_SWATCH_COLOUR = '#b0a294';

/** The two-tone stand-in for a variant whose bank entry carries no swatch. */
const FALLBACK_VARIANT_PALETTE: readonly string[] = ['#d8cfc0', FALLBACK_SWATCH_COLOUR];

/**
 * Only a literal CSS hex colour reaches a generated SVG; anything else is
 * dropped. The lengths are spelled out rather than `{3,8}`: `#12345` and
 * `#1234567` are not colours, and an invalid `fill` falls back to black — a
 * solid black band instead of the palette, which is worse than the default
 * chip. The filter is also what keeps markup out of the SVG, so it only ever
 * gets tighter.
 */
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The palette as a text-free image: vertical bands, one per colour.
 *
 * It exists because `SelectionOption.preview` is a URL, not a CSS value: a host
 * card has nowhere to put `linear-gradient(...)`, and an empty string would
 * make "there is a picture" a lie. Built as SVG rather than on a canvas so it
 * works with no `document` at all — under Bun, and in a viewer whose WebGL
 * context is gone.
 */
export function paletteSwatchDataURL(colours: readonly string[]): string {
  const usable = colours.filter((colour) => HEX_COLOUR.test(colour)).slice(0, 3);
  const palette = usable.length > 0 ? usable : [FALLBACK_SWATCH_COLOUR];
  const band = 12 / palette.length;
  const bands = palette
    .map((colour, index) => `<rect x="${(index * band).toFixed(4)}" y="0" width="${band.toFixed(4)}" height="12" fill="${colour}"/>`)
    .join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12">${bands}</svg>`)}`;
}

/**
 * Human name of a furniture placement: the catalogue name of the archetype it
 * places, project bank first. An id is never a name, so a placement neither
 * bank resolves is called by its furniture type word (`side-table` -> `Side Table`).
 */
export function assetLabel(placement: DemoAsset, bank?: VariantBank): string {
  const reference = placement.asset ?? placement.type;
  const name = (bank?.catalogue(reference) ?? findCatalogueEntry(reference))?.object.name;
  return name ?? placement.type.replaceAll('-', ' ').replaceAll(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Human name of an opening; the entrance door is called out separately. */
export function openingLabel(type: OpeningType, entrance: boolean, messages: Messages): string {
  if (type === 'window') return messages.t('opening.window');
  if (type === 'passage') return messages.t('opening.passage');
  return messages.t(entrance ? 'opening.entranceDoor' : 'opening.door');
}

/** Fallback chip of a furniture variant: its palette as a hard-stop gradient. */
function variantChipBackground(variant: AssetVariant): string {
  const colours = variantPalette(variant);
  const stops = colours
    .slice(0, 3)
    .map((colour, index) => `${colour} ${Math.round((index / colours.length) * 100)}% ${Math.round(((index + 1) / colours.length) * 100)}%`)
    .join(', ');
  return `linear-gradient(135deg, ${stops})`;
}

/** The colours a furniture variant's fallback picture is made of. */
function variantPalette(variant: AssetVariant): string[] {
  return variant.swatch.length > 0 ? [...variant.swatch] : [...FALLBACK_VARIANT_PALETTE];
}

/** Fallback chip of an opening variant: frame colour split against its accent. */
function openingChipBackground(variant: OpeningVariant): string {
  return `linear-gradient(135deg, ${variant.preview.base} 55%, ${variant.preview.accent ?? variant.preview.base} 55%)`;
}

// ------------------------------------------------------------ finish ops ----

/** An operation plus the hint the built-in panel shows after committing it. */
export type FinishAction = { op: SceneOp; hint: MessageKey | null };

/** Whether a wall target is a facade face: a wall face that belongs to no room. */
export function isFacadeTarget(target: FinishTarget): boolean {
  return target.surface === 'wall' && target.roomId === undefined;
}

/**
 * One swatch click: what painting `finishId` onto `target` commits.
 *
 * `scopeChecked` is the panel's "only this wall" checkbox. `null` means the
 * target names nothing paintable (a floor with no room), which is exactly when
 * the panel dispatches nothing.
 */
export function finishPickAction(target: FinishTarget, finishId: string, scopeChecked: boolean): FinishAction | null {
  if (target.surface === 'floor') {
    if (!target.roomId) return null;
    return { op: { op: 'set_material', target: target.roomId, material: finishId }, hint: null };
  }
  if (scopeChecked && target.face) {
    return { op: { op: 'set_material', target: target.face, material: finishId, scope: 'face' }, hint: 'hint.faceApplied' };
  }
  if (target.roomId) return { op: { op: 'set_material', target: target.roomId, material: finishId }, hint: null };
  return { op: { op: 'set_material', target: 'facade', material: finishId }, hint: 'hint.facadeApplied' };
}

/** The footer button: the active swatch applied as broadly as the panel offers. */
export function finishApplyAllAction(target: FinishTarget, finishId: string, scopeChecked: boolean): FinishAction {
  if (target.surface === 'floor') {
    return { op: { op: 'set_material', target: 'floors', material: finishId }, hint: 'hint.allFloorsApplied' };
  }
  if (scopeChecked && target.face) {
    return { op: { op: 'set_material', target: target.face, material: finishId, scope: 'face' }, hint: 'hint.faceApplied' };
  }
  return {
    op: { op: 'set_material', target: 'walls', material: finishId },
    hint: isFacadeTarget(target) ? 'hint.allWallsAppliedFacadeKept' : 'hint.allWallsApplied',
  };
}

/**
 * Display name of the surface's owner: a room name, `Facade`, or `Exterior`.
 *
 * The last branch is not reachable through `finishCore`, which refuses a floor
 * that names no room before it gets here (and every roomless WALL face is the
 * facade). It stays because this function is TOTAL over `FinishTarget` — a
 * caller that builds a target by hand still gets a name rather than an empty
 * string, and "Exterior" is the honest one for a surface that belongs to
 * nothing.
 */
export function finishOwnerName(scene: SceneData, target: FinishTarget, messages: Messages): string {
  if (isFacadeTarget(target)) return messages.t('panel.ownerFacade');
  // The raw id rather than an empty string when the document no longer carries
  // that room (a stale target after `loadScene`): the sentence above promises a
  // NAME, and «Floor finish · » is the one thing it must not produce.
  if (target.roomId) return scene.rooms.find((room) => room.id === target.roomId)?.name ?? target.roomId;
  return messages.t('panel.ownerExterior');
}

/**
 * The finish in force on the picked surface, as the panel reads it.
 *
 * A picked FACE is asked about itself first: «only this wall» writes
 * the face's entry in `scene.finishes.faces` and the renderer paints from it, so reading the
 * room's finish for a face that carries an override put the active ring on a
 * swatch the surface visibly does NOT wear — and `finishScope` derived its
 * `one`/`all` operations from that wrong answer. Since
 * `describeSelection` publishes this value to hosts as «the finish in force on
 * the picked surface», the disagreement was a public one.
 */
export function finishCurrentOf(scene: SceneData, target: FinishTarget): string | null {
  if (target.surface === 'floor') return floorFinishOf(scene, target.roomId ?? '');
  if (target.face) return faceFinishOf(scene, target.face);
  if (isFacadeTarget(target)) return facadeFinishOf(scene);
  return target.roomId ? roomWallFinishOf(scene, target.roomId) : null;
}

// ---------------------------------------------------------------- cores ----

/** One finish as a core swatch: the canvas chip, the flat colour, and its op. */
function finishOptionCore(finish: Finish, op: SceneOp): SelectionOptionCore {
  return {
    id: finish.id,
    label: finish.name,
    thumbnail: finishSwatchDataURL(finish, 72),
    background: finish.base,
    palette: finish.accent ? [finish.base, finish.accent] : [finish.base],
    op,
  };
}

/**
 * The finish selection: the bank of the picked surface, the owner's name in the
 * title, and the narrow/broad pair the checkbox and the footer stand for.
 *
 * `null` when the target names nothing paintable — a floor click that carried
 * no room, a wall click that carried neither room nor face.
 */
export function finishCore(scene: SceneData, target: FinishTarget, messages: Messages): SelectionCore | null {
  if (target.surface === 'floor' && !target.roomId) return null;
  if (target.surface === 'wall' && !target.roomId && !target.face) return null;
  const finishes = target.surface === 'floor' ? FLOOR_FINISHES : WALL_FINISHES;
  const ownerName = finishOwnerName(scene, target, messages);
  const current = finishCurrentOf(scene, target);
  // The guards above leave a floor with its room and a wall with its face or room.
  const face = target.surface === 'wall' ? target.face : undefined;
  const subject = face ? { id: face.wallId, label: ownerName, face } : { id: target.roomId ?? '', label: ownerName };
  return {
    kind: 'finish',
    title: messages.t(target.surface === 'floor' ? 'panel.floorFinish' : 'panel.wallFinish', { name: ownerName }),
    subject,
    current,
    // `flatMap` rather than `map`: `finishPickAction` judges the TARGET, and a
    // target it refuses was already turned away by the two guards above — the
    // filter is what makes that provable instead of asserted.
    options: finishes.flatMap((finish) => {
      const action = finishPickAction(target, finish.id, false);
      return action ? [finishOptionCore(finish, action.op)] : [];
    }),
    scope: current ? finishScope(target, current, messages) : undefined,
  };
}

/**
 * The wording of the broad action ("Apply to all floors"). A facade face gets
 * its own: "apply to all walls" covers ROOM walls and deliberately leaves the
 * facade as it is.
 */
export function finishFooterKey(target: FinishTarget): MessageKey {
  if (target.surface === 'floor') return 'panel.applyAllFloors';
  return isFacadeTarget(target) ? 'panel.applyAllRoomWalls' : 'panel.applyAllWalls';
}

/** The footer's wording plus the two breadths it and the checkbox commit. */
function finishScope(target: FinishTarget, finishId: string, messages: Messages): SelectionScope | undefined {
  const one = finishPickAction(target, finishId, true);
  if (!one) return undefined;
  return { label: messages.t(finishFooterKey(target)), ops: { one: one.op, all: finishApplyAllAction(target, finishId, false).op } };
}

/** The variant selection of a furniture placement: its archetype's bank. */
export function furnitureCore(
  placement: DemoAsset,
  messages: Messages,
  renderPreview: (placement: DemoAsset, variantId: string) => string | null,
  bank?: VariantBank,
): SelectionCore {
  const variants = variantsForPlacement(placement, bank);
  return {
    kind: 'furniture',
    title: messages.t('panel.replace', { name: assetLabel(placement, bank) }),
    subject: { id: placement.id, label: assetLabel(placement, bank) },
    current: placement.variant ?? activeVariantFor(placement, bank) ?? variants[0]?.id ?? null,
    options: variants.map((variant) => ({
      id: variant.id,
      label: variant.name,
      // Spread, not an explicit `undefined`: under `exactOptionalPropertyTypes`
      // the two are different values, and a shipped archetype must leave the
      // three content fields absent rather than present-and-empty.
      ...(variant.preview === undefined ? {} : { image: variant.preview }),
      thumbnail: renderPreview(placement, variant.id),
      background: variantChipBackground(variant),
      palette: variantPalette(variant),
      ...(variant.access === undefined ? {} : { access: variant.access }),
      ...(variant.allowed === undefined ? {} : { allowed: variant.allowed }),
      op: { op: 'replace_asset_variant', assetId: placement.id, variant: variant.id },
    })),
  };
}

/** The variant selection of a window, door or passage: its family's bank. */
export function openingCore(entry: OpeningListEntry, current: string | null, messages: Messages): SelectionCore {
  const variants = variantsForOpening(entry.type, { entrance: entry.entrance });
  const label = openingLabel(entry.type, entry.entrance, messages);
  return {
    kind: 'opening',
    title: messages.t('panel.replace', { name: label }),
    subject: { id: entry.id, label },
    current: current ?? variants[0]?.id ?? null,
    options: variants.map((variant) => ({
      id: variant.id,
      label: variant.name,
      thumbnail: openingVariantSwatchDataURL(variant),
      background: openingChipBackground(variant),
      palette: variant.preview.accent ? [variant.preview.base, variant.preview.accent] : [variant.preview.base],
      op: { op: 'replace_opening_variant', openingId: entry.id, variant: variant.id },
    })),
  };
}

// --------------------------------------------------------- describe them ----

/**
 * The selection a host describes, structurally: `ViewerSelection` (`app/`) is
 * assignable to it, and naming it here rather than importing it keeps this
 * module inside the `ui` layer (`.dependency-cruiser.cjs`).
 */
export type DescribeTarget = {
  readonly kind: HighlightKind | 'none';
  readonly id?: string | undefined;
  readonly roomId?: string | undefined;
  readonly face?: FaceKey | undefined;
};

/** The document and the two renderers `describeSelection` needs. */
export type DescribeDeps = {
  readonly scene: SceneData;
  readonly messages: Messages;
  /** The built openings of the document (`SceneBuilder.openingsList`). */
  readonly openings: readonly OpeningListEntry[];
  /** Honest preview of one variant; `null` falls back to the palette chip. */
  readonly renderPreview: (placement: DemoAsset, variantId: string) => string | null;
  /** The mirror axes a placement's asset allows (the built body's facts); absent or `undefined` allows none. */
  readonly mirrorFacts?: ((placement: DemoAsset) => MirrorFacts | undefined) | undefined;
  /**
   * The loaded project's variant bank, or absent for a bare scene: what makes
   * a catalogue-only archetype offer a Replace list at all, and what carries the
   * content's own pictures.
   */
  readonly variants?: VariantBank | undefined;
};

/** The variant an opening carries in the DOCUMENT, or `null` when it names none. */
export function openingVariantInScene(scene: SceneData, openingId: string): string | null {
  for (const wall of scene.walls) {
    const opening = (wall.openings ?? []).find((candidate) => candidate.id === openingId);
    if (opening) return opening.variant ?? null;
  }
  return null;
}

/** A core as a host gets it: pictures resolved, CSS chips dropped. */
function describeCore(core: SelectionCore): SelectionDescription | null {
  if (core.options.length === 0) return null;
  return {
    kind: core.kind,
    title: core.title,
    subject: core.subject,
    current: core.current,
    options: core.options.map((option) => ({
      id: option.id,
      label: option.label,
      // Three sources, in this order: the picture the CONTENT
      // declares — a catalogue's public preview, the finished photograph of the
      // variant — then the viewer's own render of whatever geometry has
      // arrived, then the palette, which is never empty.
      preview: option.image ?? option.thumbnail ?? paletteSwatchDataURL(option.palette),
      // Carried, not judged: the viewer publishes what the content said and
      // the HOST decides what a `pro` swatch does. Absent stays
      // absent, so a host with `exactOptionalPropertyTypes` can tell «nobody
      // said» from «no».
      ...(option.access === undefined ? {} : { access: option.access }),
      ...(option.allowed === undefined ? {} : { allowed: option.allowed }),
      op: option.op,
    })),
    ...(core.scope ? { scope: core.scope } : {}),
  };
}

/**
 * What the viewer's own panel would show for `target`, as data — the whole of
 * `ViewerHandle.describeSelection`.
 *
 * `null` for a selection with nothing to offer: a click that landed on nothing,
 * a wall or room the document does not carry, an id that names no placement or
 * opening. It reads the document and the catalogues and changes nothing, so the
 * answer is the same in every `edits` mode, `'off'` included.
 */
export function describeSelection(target: DescribeTarget, deps: DescribeDeps): SelectionDescription | null {
  const { scene, messages } = deps;
  if (target.kind === 'furniture') {
    const placement = scene.assets.find((asset) => asset.id === target.id);
    const described = placement ? describeCore(furnitureCore(placement, messages, deps.renderPreview, deps.variants)) : null;
    if (!placement || !described) return described;
    const mirror = { allowed: allowedMirrorAxes(deps.mirrorFacts?.(placement)), current: mirroredAxes(placement.mirror) };
    return { ...described, mirror };
  }
  if (target.kind === 'opening') {
    const entry = deps.openings.find((opening) => opening.id === target.id);
    return entry ? describeCore(openingCore(entry, openingVariantInScene(scene, entry.id) ?? entry.variant, messages)) : null;
  }
  if (target.kind === 'room') {
    const roomId = target.roomId ?? target.id;
    if (!roomId || !scene.rooms.some((room) => room.id === roomId)) return null;
    const core = finishCore(scene, { surface: 'floor', roomId }, messages);
    return core ? describeCore(core) : null;
  }
  if (target.kind === 'wall') {
    // A room the document does not carry is refused here, exactly as in the
    // `room` branch above: the payload is the HOST's, it can be a selection
    // taken before a `loadScene`, and a description titled "Wall finish · "
    // whose ops paint a room that is gone is worse than `null`.
    if (target.roomId !== undefined && !scene.rooms.some((room) => room.id === target.roomId)) return null;
    // A facade face carries a `face` and no room; a room face carries both.
    // A wall selection with neither is a wall the drawing named but the paint
    // vocabulary cannot address, and there is nothing to offer for it.
    const core = finishCore(
      scene,
      { surface: 'wall', ...(target.roomId ? { roomId: target.roomId } : {}), ...(target.face ? { face: target.face } : {}) },
      messages,
    );
    return core ? describeCore(core) : null;
  }
  return null;
}
