/**
 * What every applier is handed, what every applier answers with, and what more
 * than one of them needs on the way — the same split `layout/rules/context.ts`
 * makes for the layout rules.
 *
 * An applier mutates a `Draft<SceneData>` the model made and returns a one-line
 * English summary plus the entities it touched; it never validates the
 * resulting plan (`SceneModel.apply` does that and throws the whole batch away
 * if the candidate is refused). An applier that cannot express the request at
 * all throws `OpError`.
 *
 * Touched entities are a small discriminated union the geometry layer
 * subscribes to (`TouchedEntity`, below): a room's floor, walls, ceiling or
 * trim, one wall face, the facade, a placement, an opening (variant only), a
 * camera, the navigation, the autotour, the tour checkpoints, and `shell`
 * (the plan itself changed and the geometry must be rebuilt). A structure,
 * not a joined string, because a face is a structure: nothing a host receives
 * has to be parsed.
 *
 * Nothing here imports an applier, so the op modules may all read it without a
 * cycle; `scene-ops.ts` re-exports every name below, which is why the split of
 * that file changed no importer anywhere in the repository.
 *
 * Pure module: no `three`, no DOM.
 */

import { ViewerLibError, type ErrorDetail } from '../../shared/errors.js';
import { arcFromChord, arcLength, dist } from '../../plan/plan-geometry.js';
import type { Draft } from '../../shared/committed.js';
import { faceKey, isUuidV7, sameFace } from '../types.js';
import type { FaceKey, InteriorPreset, SceneData, SceneOp, SetCameraTarget, TopologyRemap, Wall } from '../types.js';

/**
 * A request the applier cannot express; the model turns it into `validation_failed`.
 *
 * `op` names the operation that refused and is filled in by the DISPATCHER for
 * every refusal raised without one. `extra` is a structured payload an
 * applier hands the caller alongside the sentence — the two nearest legal
 * `at` values of a refused `split_wall`, for instance — and when it is given,
 * the applier names its own `op` too (a detail is passed through the
 * dispatcher unchanged, so the applier is the one that completes it).
 */
export class OpError extends ViewerLibError {
  declare readonly code: 'scene-invalid';

  constructor(message: string, op?: string, extra?: ErrorDetail) {
    super('scene-invalid', message, {
      detail: op === undefined && extra === undefined ? undefined : { ...extra, op },
    });
    this.name = 'OpError';
  }
}

export type OpOutcome = {
  summary: string;
  touched: TouchedEntity[];
  /**
   * How the edit moved the paintable faces, set by the one operation that
   * changes wall topology (`split_wall`); absent everywhere else. The remap
   * has already been APPLIED through `remapFaceFinishes` — this is the
   * mapping for a journal's benefit, not a pending instruction.
   */
  remap?: TopologyRemap | undefined;
};

/* ---------------------------------------------------- touched entities --- */

/**
 * One thing an operation changed, as the geometry layer and a host's journal
 * read it. Every member carries the UUIDs (or the `FaceKey`) of what it names
 * and nothing joined, so a subscriber switches on `kind` and reads fields.
 */
export type TouchedEntity =
  | { readonly kind: 'shell' }
  | { readonly kind: 'facade' }
  | { readonly kind: 'floor'; readonly room: string }
  | { readonly kind: 'walls'; readonly room: string }
  | { readonly kind: 'ceiling'; readonly room: string }
  | { readonly kind: 'trim'; readonly room: string }
  | { readonly kind: 'face'; readonly face: FaceKey }
  | { readonly kind: 'asset'; readonly id: string }
  | { readonly kind: 'opening'; readonly id: string }
  | { readonly kind: 'camera'; readonly target: SetCameraTarget }
  | { readonly kind: 'navigation' }
  | { readonly kind: 'autotour' }
  | { readonly kind: 'tourCheckpoints' };

/** The facade's finish changed. */
export const TOUCHED_FACADE: TouchedEntity = Object.freeze({ kind: 'facade' });
/** The plan changed; the geometry layer must rebuild rather than repaint. */
export const TOUCHED_SHELL: TouchedEntity = Object.freeze({ kind: 'shell' });
export const TOUCHED_NAVIGATION: TouchedEntity = Object.freeze({ kind: 'navigation' });
export const TOUCHED_AUTOTOUR: TouchedEntity = Object.freeze({ kind: 'autotour' });
export const TOUCHED_TOUR_CHECKPOINTS: TouchedEntity = Object.freeze({ kind: 'tourCheckpoints' });

export const touchedFloor = (room: string): TouchedEntity => ({ kind: 'floor', room });
export const touchedRoomWalls = (room: string): TouchedEntity => ({ kind: 'walls', room });
export const touchedCeiling = (room: string): TouchedEntity => ({ kind: 'ceiling', room });
export const touchedTrim = (room: string): TouchedEntity => ({ kind: 'trim', room });
export const touchedFace = (face: FaceKey): TouchedEntity => ({ kind: 'face', face });
export const touchedAsset = (id: string): TouchedEntity => ({ kind: 'asset', id });
export const touchedOpening = (id: string): TouchedEntity => ({ kind: 'opening', id });
/** A camera target is copied, never the op's own object: a touched entity outlives the batch that produced it. */
export const touchedCamera = (target: SetCameraTarget): TouchedEntity => ({
  kind: 'camera',
  target: typeof target === 'object' ? { room: target.room } : target,
});

/** True when a touched entity names an asset placement (see `touchedAsset`). */
export const isTouchedAsset = (entity: TouchedEntity): entity is Extract<TouchedEntity, { kind: 'asset' }> => entity.kind === 'asset';

/** True when a touched entity names an opening (see `touchedOpening`). */
export const isTouchedOpening = (entity: TouchedEntity): entity is Extract<TouchedEntity, { kind: 'opening' }> => entity.kind === 'opening';

/**
 * True when both name the same thing — what a batch's union of touched
 * entities is deduplicated by (`SceneModel.apply`), since two structures are
 * never `===`.
 */
export function sameTouched(a: TouchedEntity, b: TouchedEntity): boolean {
  switch (a.kind) {
    case 'floor':
    case 'walls':
    case 'ceiling':
    case 'trim':
      return b.kind === a.kind && b.room === a.room;
    case 'face':
      return b.kind === 'face' && sameFace(a.face, b.face);
    case 'asset':
    case 'opening':
      return b.kind === a.kind && b.id === a.id;
    case 'camera':
      return b.kind === 'camera' && sameCameraTarget(a.target, b.target);
    case 'shell':
    case 'facade':
    case 'navigation':
    case 'autotour':
    case 'tourCheckpoints':
      return b.kind === a.kind;
  }
}

function sameCameraTarget(a: SetCameraTarget, b: SetCameraTarget): boolean {
  if (typeof a === 'object' || typeof b === 'object') {
    return typeof a === 'object' && typeof b === 'object' && a.room === b.room;
  }
  return a === b;
}

/* ------------------------------------------------------- shared measures --- */

/** Centreline length of a wall (arc length for curved walls), metres. */
export function wallCentrelineLength(scene: SceneData, wall: Wall): number {
  const a = scene.nodes.find((node) => node.id === wall.a)?.p;
  const b = scene.nodes.find((node) => node.id === wall.b)?.p;
  if (!a || !b) throw new OpError(`Wall ${wall.id} references a missing node`);
  if (!wall.arc) return dist(a, b);
  return arcLength(arcFromChord(a, b, wall.arc.radius, wall.arc.ccw));
}

/** Short human number for a summary line: two decimals without trailing zeros. */
export function round(value: number): string {
  const text = value.toFixed(2);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/* ---------------------------------------------- a caller-minted id --- */

/**
 * Every id the document has already claimed: the scene itself, nodes, walls,
 * openings, rooms, placements, scene-local materials, interior presets and
 * tour checkpoints.
 *
 * ONE set across all of them, exactly the one the validator keeps
 * (`validate/context.ts` `claim`): a UUID names one entity, so a room may not
 * reuse a wall's, and an operation that created a room under a UUID an asset
 * or a preset already answered to would produce a draft that applies and then
 * loses its batch at commit.
 *
 * Exported for the operations that check SEVERAL caller-minted ids at once
 * (`split_wall`: a node and two halves) and hand the growing set to
 * `requireNewId` rather than rebuilding it per id.
 */
export function claimedIds(scene: SceneData): Set<string> {
  const taken = new Set<string>([scene.id]);
  for (const node of scene.nodes) taken.add(node.id);
  for (const material of scene.materials ?? []) taken.add(material.id);
  for (const wall of scene.walls) {
    taken.add(wall.id);
    for (const opening of wall.openings ?? []) taken.add(opening.id);
  }
  for (const room of scene.rooms) taken.add(room.id);
  for (const asset of scene.assets) taken.add(asset.id);
  for (const preset of scene.interiors ?? []) taken.add(preset.id);
  for (const checkpoint of scene.tourCheckpoints ?? []) taken.add(checkpoint.id);
  return taken;
}

/** Why a creating operation refused the id it was handed; `OpError.detail.reason`. */
export type NewIdRefusal = 'invalid_id' | 'duplicate_id';

/**
 * The id a creating operation was handed, proved usable: a UUID v7 the
 * document has not claimed yet.
 *
 * The viewer never mints ids, so there is no fallback: a missing or malformed
 * id is `invalid_id`, a claimed one `duplicate_id`, both as an `OpError` whose
 * `detail` carries the `reason`, the op, the field and the id. Refusing a taken
 * id rather than picking another is the point — the caller named an entity, and
 * quietly creating a different one is how an editor host's undo stack starts
 * pointing at something that is not there. With nothing derived from hidden
 * state, a journal replay creates exactly the same entities.
 *
 * `taken` is the claimed set to check against, built from `scene` when the
 * caller has none; a caller checking several ids passes one set and this adds
 * each accepted id to it, so two new ids of one operation cannot coincide.
 */
export function requireNewId(scene: SceneData, id: unknown, op: string, field = 'id', taken: Set<string> = claimedIds(scene)): string {
  if (!isUuidV7(id)) {
    const shown = typeof id === 'string' ? JSON.stringify(id) : typeof id;
    throw new OpError(`${op} ${field} ${shown} is not a UUID v7`, op, {
      reason: 'invalid_id',
      field,
      id: typeof id === 'string' ? id : null,
    });
  }
  if (taken.has(id)) throw new OpError(`${op} ${field} ${id} is already taken`, op, { reason: 'duplicate_id', field, id });
  taken.add(id);
  return id;
}

/* ---------------------------------------------------- forgetting a thing --- */

/**
 * Drops every preset operation `gone` recognises, and every preset left with
 * nothing to do.
 *
 * The validator proves each interior preset still applies (`validate/presets.ts`
 * dry-runs it through these very appliers), so a preset left naming an opening,
 * a room or a placement that no longer exists would make an otherwise legal
 * removal fail validation: the decorative layer would veto an edit to the
 * document. The document wins — the preset simply stops dressing what is gone.
 */
export function forgetInPresets(scene: Draft<SceneData>, gone: (op: SceneOp) => boolean): void {
  if (!scene.interiors) return;
  const kept: Draft<InteriorPreset>[] = [];
  for (const preset of scene.interiors) {
    const ops = preset.ops.filter((candidate) => !gone(candidate));
    if (ops.length === 0) continue;
    kept.push(ops.length === preset.ops.length ? preset : { ...preset, ops });
  }
  scene.interiors = kept;
}

/* -------------------------------------------------------- shared refusals --- */

/** Refuses a coordinate pair or triple that is not finite, naming the field. */
export function requireFinite(value: number, field: string, owner: string): void {
  if (!Number.isFinite(value)) throw new OpError(`${owner} got a non-finite ${field}`);
}

/* ------------------------------------------------------- painted faces --- */

/**
 * A face for a summary, log or error line: `<owner>/<wallId>/<side>`, the
 * owner a room UUID or `facade`. Text for a person to read, never a key.
 */
export function faceText(face: FaceKey): string {
  return `${face.room ?? 'facade'}/${face.wallId}/${face.side}`;
}

/**
 * Drops every `finishes.faces` entry `drop` selects and answers with the faces
 * it dropped, in list order, so the caller can name them in `touched`.
 *
 * The list keeps the order of what remains: `finishes.faces` is a list (a
 * face appears in it at most once), and an edit that only removes entries has
 * no reason to reorder the others.
 */
export function dropFaceFinishes(scene: Draft<SceneData>, drop: (face: FaceKey) => boolean): FaceKey[] {
  const faces = scene.finishes?.faces;
  if (faces === undefined) return [];
  const dropped: FaceKey[] = [];
  const kept = faces.filter((entry) => {
    if (!drop(entry)) return true;
    dropped.push(faceKey(entry.room ?? null, entry.wallId, entry.side));
    return false;
  });
  if (dropped.length > 0) scene.finishes!.faces = kept;
  return dropped;
}
