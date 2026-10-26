/**
 * The furniture operations: what a placement is and what may be done to it —
 * `place_object`, `move_object`, `rotate_object`, `set_object`,
 * `remove_object`, `replace_asset_variant`, `replace_asset` and `mirror_object`.
 *
 * What they all have in common is the REGISTRIES: whether an archetype, a
 * variant or a finish exists is a question for the bank the caller injected,
 * never for an import (`scene/registries.ts`). A reference is read the way
 * the scene document spells it — a bare `asset` UUID plus an optional
 * `library` UUID (`assetRefOf`) — and any other form (a `library:asset`
 * string, a catalogue's `publisher/asset@variant`) is refused by simply not
 * resolving: the catalogue service translates into the document's form in one
 * place, and that place is not here.
 *
 * What the appliers do NOT decide is whether the furniture FITS. Clearances,
 * door swings and circulation are the layout linter's answer, asked for per
 * batch (`ApplyBatch.lint`), so an editor can put a chair down while the user
 * is still dragging it.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Draft } from '../../shared/committed.js';
import { assetRefOf, findArchetype, type CatalogueArchetype, type SceneRegistries } from '../registries.js';
import { effectiveAsset } from '../types.js';
import { disallowedMirrorAxes, isMirrorState, mirroredAxes, mirrorOf } from '../mirror.js';
import type {
  DemoAsset,
  MirrorObjectOp,
  MoveObjectOp,
  PlaceObjectOp,
  RemoveObjectOp,
  ReplaceAssetOp,
  ReplaceAssetVariantOp,
  RotateObjectOp,
  SceneData,
  SetObjectOp,
  Vec3,
} from '../types.js';
import { OpError, forgetInPresets, requireFinite, requireNewId, round, touchedAsset, type OpOutcome } from './context.js';
import { OBJECT_SCALE } from './limits.js';

/** `(x, y, z)` for a summary line: two decimals, so two placements read as one column. */
function positionText(position: Vec3): string {
  return `(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`;
}

/**
 * A yaw in (−π, π]: the same angle, written the one way a journal line, a diff
 * and an equality test can all agree on.
 *
 * The interval is half-open by contract, and the closing branch is what
 * makes it half-open: −π and π are the same direction, and the remainder below
 * lands on −π for exactly the inputs that mean "turned all the way round".
 */
function normaliseYaw(angle: number): number {
  const turn = 2 * Math.PI;
  const shifted = (((angle + Math.PI) % turn) + turn) % turn;
  const normalised = shifted - Math.PI;
  return normalised === -Math.PI ? Math.PI : normalised;
}

function findAsset(scene: Draft<SceneData>, assetId: string): Draft<DemoAsset> {
  const asset = scene.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new OpError(`Unknown asset ${assetId}`);
  return asset;
}

/**
 * The archetype a `place_object` reference names, or an `OpError` saying what
 * did not resolve. An operation without `library` is read in the document's
 * `assetLibrary`, then in the registries' default — exactly as the validator
 * will read the placement it writes.
 */
function requireArchetype(
  scene: Draft<SceneData>,
  registries: SceneRegistries,
  op: { readonly asset: string; readonly library?: string | undefined },
): CatalogueArchetype {
  const ref = assetRefOf({ type: op.asset, library: op.library }, scene.assetLibrary ?? registries.defaultLibrary);
  const object = findArchetype(registries, ref);
  if (!object)
    throw new OpError(op.library === undefined ? `Unknown asset ${op.asset}` : `Unknown asset ${op.asset} in library ${op.library}`);
  return object;
}

/** Refuses a room a placement names but the document does not have. */
function requireRoom(scene: Draft<SceneData>, roomId: string): void {
  if (!scene.rooms.some((room) => room.id === roomId)) throw new OpError(`Unknown room ${roomId}`);
}

/** Refuses a finish neither catalogue nor the document's own materials know. */
function requireFinish(scene: Draft<SceneData>, registries: SceneRegistries, finishId: string): void {
  if (!registries.isKnownFinish(finishId, scene.materials ?? [])) throw new OpError(`Unknown finish ${finishId}`);
}

/**
 * The height a placement of this archetype actually sits at.
 *
 * A floor-standing object is pinned to 0 whatever the editor sent:
 * its pivot IS the floor centre (the scene contract), so a
 * non-zero `y` is a sofa hovering. A wall-hung or ceiling-mounted one keeps
 * what it was given — that number is the mounting height, and only the editor
 * and the layout linter know what it should be.
 */
function seatedY(object: CatalogueArchetype, y: number): number {
  return (object.anchor ?? 'floor') === 'floor' ? 0 : y;
}

export function applyPlaceObject(scene: Draft<SceneData>, op: PlaceObjectOp, registries: SceneRegistries): OpOutcome {
  const id = requireNewId(scene, op.id, 'place_object');
  const object = requireArchetype(scene, registries, op);
  if (op.variant !== undefined && !object.variants.some((variant) => variant.id === op.variant)) {
    throw new OpError(`Variant ${op.variant} is not offered for asset ${op.asset}`);
  }
  requireFinite(op.position.x, 'position.x', 'place_object');
  requireFinite(op.position.y, 'position.y', 'place_object');
  requireFinite(op.position.z, 'position.z', 'place_object');
  if (op.rotationY !== undefined) requireFinite(op.rotationY, 'rotationY', 'place_object');
  if (op.room !== undefined) requireRoom(scene, op.room);
  for (const finishId of Object.values(op.finishes ?? {})) requireFinish(scene, registries, finishId);

  const asset: Draft<DemoAsset> = {
    id,
    // `type` is the archetype the reference resolved to, `asset` the reference
    // itself: the document keeps the asset and the library the caller named,
    // and every reader that only knows legacy types still sees one it can act on.
    type: object.id,
    asset: op.asset,
    ...(op.library === undefined ? {} : { library: op.library }),
    position: { x: op.position.x, y: seatedY(object, op.position.y), z: op.position.z },
  };
  if (op.variant !== undefined) asset.variant = op.variant;
  if (op.room !== undefined) asset.room = op.room;
  if (op.rotationY !== undefined) asset.rotationY = normaliseYaw(op.rotationY);
  if (op.finishes !== undefined) asset.finishes = { ...op.finishes };
  scene.assets.push(asset);

  const shown = registries.resolvePlacement(asset)?.variant.id;
  const what = shown === undefined ? object.id : `${object.id}@${shown}`;
  const where = op.room === undefined ? '' : ` in ${op.room}`;
  return { summary: `Object ${id}: placed ${what}${where} at ${positionText(asset.position)}`, touched: [touchedAsset(id)] };
}

export function applyMoveObject(scene: Draft<SceneData>, op: MoveObjectOp, registries: SceneRegistries): OpOutcome {
  const asset = findAsset(scene, op.assetId);
  if (op.position !== undefined && op.dposition !== undefined) {
    throw new OpError('move_object takes position and dposition, not both');
  }
  if (op.position === undefined && op.dposition === undefined && op.room === undefined) {
    throw new OpError('move_object needs at least one field to change');
  }
  if (typeof op.room === 'string') requireRoom(scene, op.room);

  const changes: string[] = [];
  if (op.position !== undefined || op.dposition !== undefined) {
    const delta = op.dposition;
    const wanted: Vec3 =
      op.position ??
      (delta === undefined
        ? asset.position
        : { x: asset.position.x + delta.x, y: asset.position.y + delta.y, z: asset.position.z + delta.z });
    requireFinite(wanted.x, 'position.x', 'move_object');
    requireFinite(wanted.y, 'position.y', 'move_object');
    requireFinite(wanted.z, 'position.z', 'move_object');
    const object = registries.resolvePlacement(asset)?.object;
    asset.position = { x: wanted.x, y: object === undefined ? wanted.y : seatedY(object, wanted.y), z: wanted.z };
    changes.push(`moved to ${positionText(asset.position)}${typeof op.room === 'string' ? ` in ${op.room}` : ''}`);
  } else if (typeof op.room === 'string') {
    changes.push(`bound to ${op.room}`);
  }

  if (op.room === null) {
    delete asset.room;
    changes.push('unbound from its room');
  } else if (typeof op.room === 'string') {
    asset.room = op.room;
  }

  return { summary: `Object ${op.assetId}: ${changes.join(', ')}`, touched: [touchedAsset(op.assetId)] };
}

export function applyRotateObject(scene: Draft<SceneData>, op: RotateObjectOp): OpOutcome {
  const asset = findAsset(scene, op.assetId);
  if (op.rotationY !== undefined && op.drotation !== undefined) {
    throw new OpError('rotate_object takes rotationY and drotation, not both');
  }
  if (op.rotationY === undefined && op.drotation === undefined) {
    throw new OpError('rotate_object needs at least one field to change');
  }
  const wanted = op.rotationY ?? effectiveAsset(asset).rotationY + (op.drotation ?? 0);
  requireFinite(wanted, 'rotationY', 'rotate_object');
  asset.rotationY = normaliseYaw(wanted);
  return { summary: `Object ${op.assetId}: rotated to ${round(asset.rotationY)} rad`, touched: [touchedAsset(op.assetId)] };
}

export function applySetObject(scene: Draft<SceneData>, op: SetObjectOp, registries: SceneRegistries): OpOutcome {
  const asset = findAsset(scene, op.assetId);
  if (op.scale === undefined && op.material === undefined && op.finishes === undefined) {
    throw new OpError('set_object needs at least one field to change');
  }
  const changes: string[] = [];

  if (op.scale !== undefined) {
    requireFinite(op.scale, 'scale', 'set_object');
    const [min, max] = OBJECT_SCALE;
    asset.scale = Math.min(max, Math.max(min, op.scale));
    changes.push(`scale ${round(asset.scale)}`);
  }
  if (op.material !== undefined) {
    requireFinish(scene, registries, op.material);
    asset.material = op.material;
    changes.push(`material ${op.material}`);
  }
  for (const [slot, finishId] of Object.entries(op.finishes ?? {})) {
    requireFinish(scene, registries, finishId);
    asset.finishes = { ...asset.finishes, [slot]: finishId };
    changes.push(`${slot} ${finishId}`);
  }

  return { summary: `Object ${op.assetId}: set ${changes.join(', ')}`, touched: [touchedAsset(op.assetId)] };
}

export function applyRemoveObject(scene: Draft<SceneData>, op: RemoveObjectOp): OpOutcome {
  const asset = findAsset(scene, op.assetId);
  scene.assets.splice(scene.assets.indexOf(asset), 1);
  forgetInPresets(scene, (candidate) => candidate.op === 'replace_asset_variant' && candidate.assetId === op.assetId);
  return { summary: `Object ${op.assetId}: removed`, touched: [touchedAsset(op.assetId)] };
}

export function applyReplaceAssetVariant(scene: Draft<SceneData>, op: ReplaceAssetVariantOp, registries: SceneRegistries): OpOutcome {
  const asset = scene.assets.find((candidate) => candidate.id === op.assetId);
  if (!asset) throw new OpError(`Unknown asset ${op.assetId}`);
  const offered = registries.variantsForPlacement(asset);
  if (!offered.some((variant) => variant.id === op.variant)) {
    throw new OpError(`Variant ${op.variant} is not offered for asset ${op.assetId}`);
  }
  asset.variant = op.variant;
  return { summary: `Asset ${op.assetId} replaced with variant ${op.variant}`, touched: [touchedAsset(op.assetId)] };
}

/** The anchor pair a replacement must share: where the origin belongs, and whether it stands on another object. */
function anchorPair(object: CatalogueArchetype): string {
  return `${object.anchor ?? 'floor'}${object.onSurface === true ? ' on a surface' : ''}`;
}

/** The one word a host can say for how an asset is mounted: on-surface wins over the anchor, no anchor is the floor. */
function mountOf(object: CatalogueArchetype): 'floor' | 'wall' | 'ceiling' | 'surface' {
  return object.onSurface === true ? 'surface' : (object.anchor ?? 'floor');
}

/**
 * Gives a placement another asset, keeping the placement itself.
 *
 * The target is read the way `place_object` reads one — its `library`, else
 * the document's `assetLibrary`, else the registries' default — and must share
 * the current asset's anchor pair and allow the mirror the placement carries.
 * The position is copied as it is, never reseated: a vase on a table keeps
 * its height. Interior presets forget the variant and finish edits they
 * recorded for the placement, which named the old body.
 */
export function applyReplaceAsset(scene: Draft<SceneData>, op: ReplaceAssetOp, registries: SceneRegistries): OpOutcome {
  const asset = findAsset(scene, op.assetId);
  const target = requireArchetype(scene, registries, { asset: op.asset, library: op.library });
  if (op.variant !== undefined && !target.variants.some((variant) => variant.id === op.variant)) {
    throw new OpError(`Variant ${op.variant} is not offered for asset ${op.asset}`);
  }
  const current = registries.resolvePlacement(asset)?.object;
  if (current === undefined) throw new OpError(`Asset ${op.assetId} names no asset the catalogue knows`);
  if (anchorPair(current) !== anchorPair(target)) {
    throw new OpError(
      `replace_asset: ${op.assetId} is anchored ${anchorPair(current)}, asset ${op.asset} ${anchorPair(target)}`,
      'replace_asset',
      {
        reason: 'anchor_mismatch',
        assetId: op.assetId,
        mount: mountOf(target),
        currentMount: mountOf(current),
      },
    );
  }
  const mirror = asset.mirror ?? {};
  const refused = disallowedMirrorAxes(mirror, target.mirror);
  if (mirroredAxes(mirror).length > 0 && refused.length > 0) {
    throw new OpError(`replace_asset: ${op.asset} may not be mirrored on ${refused.join(', ')}`, 'replace_asset', {
      reason: 'mirror_not_allowed',
      assetId: op.assetId,
      axes: refused,
    });
  }

  asset.type = target.id;
  asset.asset = op.asset;
  if (op.library === undefined) delete asset.library;
  else asset.library = op.library;
  if (op.variant === undefined) delete asset.variant;
  else asset.variant = op.variant;
  delete asset.finishes;
  delete asset.material;
  delete asset.scale;
  delete asset.collision;
  forgetInPresets(
    scene,
    (candidate) =>
      (candidate.op === 'replace_asset_variant' && candidate.assetId === op.assetId) ||
      (candidate.op === 'set_object' &&
        candidate.assetId === op.assetId &&
        (candidate.finishes !== undefined || candidate.material !== undefined || candidate.scale !== undefined)),
  );
  const shown = op.variant === undefined ? target.id : `${target.id}@${op.variant}`;
  return { summary: `Object ${op.assetId}: replaced with ${shown}`, touched: [touchedAsset(op.assetId)] };
}

/**
 * Sets a placement's whole mirror state (absolute, so an undo is the previous
 * state). Refused with `reason: 'mirror_not_allowed'` when the archetype's
 * facts do not allow an axis the state sets, or when the bank does not know
 * the archetype at all (its facts are then unknown). Clearing the
 * mirror is always allowed: it is the state every asset may be in.
 */
export function applyMirrorObject(scene: Draft<SceneData>, op: MirrorObjectOp, registries: SceneRegistries): OpOutcome {
  const asset = findAsset(scene, op.assetId);
  if (!isMirrorState(op.mirror)) {
    throw new OpError('mirror_object takes mirror: { x?: true, y?: true, z?: true }', 'mirror_object', { assetId: op.assetId });
  }
  const mirror = mirrorOf(mirroredAxes(op.mirror));
  const wanted = mirroredAxes(mirror);
  if (wanted.length > 0) {
    const facts = registries.resolvePlacement(asset)?.object.mirror;
    const refused = disallowedMirrorAxes(mirror, facts);
    if (refused.length > 0) {
      const why = facts === undefined ? 'its mirror facts are unknown' : `it does not allow ${refused.join(', ')}`;
      throw new OpError(`mirror_object: asset ${op.assetId} may not be mirrored on ${refused.join(', ')}: ${why}`, 'mirror_object', {
        reason: 'mirror_not_allowed',
        assetId: op.assetId,
        axes: refused,
      });
    }
  }
  if (wanted.length === 0) delete asset.mirror;
  else asset.mirror = mirror;
  const summary = wanted.length === 0 ? 'mirror cleared' : `mirrored on ${wanted.join(', ')}`;
  return { summary: `Object ${op.assetId}: ${summary}`, touched: [touchedAsset(op.assetId)] };
}
