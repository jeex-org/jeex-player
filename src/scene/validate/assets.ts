/**
 * Painted overrides and asset placements — the two sections that can only run
 * once the plan is solved or the object bank consulted.
 *
 * Catalogue invariant: `DemoAsset.type`, `DemoAsset.asset` and
 * `DemoAsset.variant` are resolved against the object bank HERE, through the
 * same `parseAssetRef` / `findCatalogueEntry` the renderer uses. A reference the
 * bank cannot resolve would render as a placeholder and collide with a footprint
 * belonging to something else, so it is a hard error, not a silent degradation.
 *
 * Pure module: no `three`, no DOM.
 */

import type { SolvedPlan } from '../../plan/plan-solver.js';
import { isFiniteVec3, ownKeys, requireFinishFamily, type ValidationContext } from './context.js';
import { findArchetype, type CatalogueArchetype } from '../registries.js';
import { FaceMap, faceKey, isFaceKey, type FaceFinish, type FaceKey, type SceneFinishes } from '../types.js';
import { isMirrorState } from '../mirror.js';

/**
 * Painted overrides (`SceneData.finishes`).
 *
 * Every finish must resolve in the finish catalogue AND belong to the right
 * family, every room key must be a real room, and every face entry must name a
 * face the solver actually produced, at most once — an override the renderer
 * cannot apply would make the exported draft and the rendered scene disagree
 * the moment it commits, which is why this section runs AFTER `solvePlan`.
 */
export function checkFinishes(ctx: ValidationContext, plan: SolvedPlan): void {
  const finishes: SceneFinishes | undefined = ctx.scene.finishes;
  if (finishes === undefined) return;
  if (typeof finishes !== 'object' || finishes === null) ctx.fail('finishes-not-object', 'finishes', 'Scene finishes must be an object');
  for (const roomId of ownKeys(finishes.rooms)) {
    const path = `finishes.rooms.${roomId}`;
    if (!ctx.roomIds.has(roomId)) ctx.fail('finishes-unknown-room', path, `Scene finishes reference unknown room ${roomId}`, { roomId });
    const entry = finishes.rooms![roomId];
    if (!entry || typeof entry !== 'object') {
      ctx.fail('finishes-room-not-object', path, `Scene finishes for room ${roomId} must be an object`);
    }
    for (const key of ['floor', 'walls'] as const) {
      const id = entry[key];
      if (id === undefined) continue;
      requireFinishFamily(ctx, id, key === 'floor' ? 'floor' : 'wall', `Scene finishes room ${roomId} ${key}`, `${path}.${key}`);
    }
  }
  checkFaceFinishes(ctx, plan, finishes.faces);
  if (finishes.facade !== undefined) requireFinishFamily(ctx, finishes.facade, 'wall', 'Scene finishes facade', 'finishes.facade');
}

/**
 * `finishes.faces`: a list of `{ room?, wallId, side, finish }`, each a face
 * of the solved plan (looked up in its `FaceMap`, by value) and none listed
 * twice — a second entry for one face would leave which finish wins to the
 * order of a list.
 */
function checkFaceFinishes(ctx: ValidationContext, plan: SolvedPlan, faces: readonly FaceFinish[] | undefined): void {
  if (faces === undefined) return;
  if (!Array.isArray(faces)) ctx.fail('finishes-faces-not-array', 'finishes.faces', 'Scene finishes faces must be a list');
  const seen = new FaceMap<number>();
  for (const [index, entry] of faces.entries()) {
    const path = `finishes.faces[${index}]`;
    const face = faceOf(entry);
    if (face === null || !plan.faces.has(face)) {
      ctx.fail('finishes-unknown-face', path, `Scene finishes reference unknown wall face ${JSON.stringify(face ?? entry)}`, {
        face: face === null ? null : { ...face },
      });
    }
    const first = seen.get(face);
    if (first !== undefined) {
      ctx.fail('finishes-duplicate-face', path, `Scene finishes list the face at finishes.faces[${first}] twice`, { first });
    }
    seen.set(face, index);
    requireFinishFamily(ctx, entry.finish, 'wall', `Scene finishes face ${index}`, `${path}.finish`);
  }
}

/** The face an entry names, or `null` when it is not shaped like one. */
function faceOf(entry: unknown): FaceKey | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const bare = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'finish'));
  if (!isFaceKey(bare)) return null;
  return faceKey(bare.room ?? null, bare.wallId, bare.side);
}

/**
 * Resolves a placement against the object bank and fails when it cannot.
 *
 * A placement names EITHER `asset` (`library:asset_uuid`, the bank form) or a
 * furniture `type` word; `resolveAsset` reads them in that order, and so does
 * this. The returned archetype is what a `variant` has to belong to.
 */
function resolveCatalogueObject(
  ctx: ValidationContext,
  asset: { type: string; asset?: string | undefined },
  assetId: string,
  path: string,
): CatalogueArchetype {
  const { defaultLibrary, parseAssetRef, libraries } = ctx.registries;
  const ref = parseAssetRef(asset.asset ?? asset.type, ctx.scene.assetLibrary ?? defaultLibrary);
  if (!libraries.has(ref.library)) {
    ctx.fail('asset-unknown-library', path, `Asset ${assetId} references unknown asset library ${ref.library}`, { library: ref.library });
  }
  const object = findArchetype(ctx.registries, ref);
  if (!object) {
    ctx.fail('asset-unknown-catalogue-entry', path, `Asset ${assetId} references unknown catalogue asset ${ref.assetId}`, {
      ref: ref.assetId,
    });
  }
  return object;
}

/**
 * The library a bare reference belongs to.
 *
 * A document may name any library the registries were built with; it may not
 * name one they were not, because then no placement in it could be checked
 * against anything. An absent field means `defaultLibrary`, which is how every
 * document authored before libraries existed keeps validating.
 */
function checkAssetLibrary(ctx: ValidationContext): void {
  const named = ctx.scene.assetLibrary;
  if (named === undefined) return;
  if (typeof named !== 'string' || !named) {
    ctx.fail('scene-asset-library-invalid', 'assetLibrary', 'Scene assetLibrary must be a non-empty string');
  }
  if (!ctx.registries.libraries.has(named)) {
    ctx.fail('scene-unknown-asset-library', 'assetLibrary', `Scene references unknown asset library ${named}`, { library: named });
  }
}

/**
 * `mirror` (schema 2.1): an object whose keys are axes and whose values are
 * `true`. Whether the ASSET allows those axes is not the document's question:
 * the facts live in the catalogue and `mirror_object` judges them on edit.
 */
function checkMirror(ctx: ValidationContext, mirror: unknown, path: string, assetId: string): void {
  if (mirror === undefined || isMirrorState(mirror)) return;
  ctx.fail('asset-mirror-invalid', path, `Asset ${assetId} has an invalid mirror; expected { x?: true, y?: true, z?: true }`);
}

/** Placements: their own fields, then their catalogue reference and finishes. */
export function checkAssets(ctx: ValidationContext): void {
  checkAssetLibrary(ctx);
  for (const [index, asset] of ctx.scene.assets.entries()) {
    const path = `assets[${index}]`;
    if (!asset || typeof asset !== 'object') ctx.fail('asset-not-object', path, 'Assets must be objects');
    const assetId = ctx.claim('asset', asset.id, `${path}.id`);
    if (typeof asset.type !== 'string' || !asset.type) ctx.fail('asset-type-missing', `${path}.type`, `Asset ${assetId} has no type`);
    if (!isFiniteVec3(asset.position)) ctx.fail('asset-position-invalid', `${path}.position`, `Asset ${assetId} has an invalid position`);
    if (asset.rotationY !== undefined && !Number.isFinite(asset.rotationY)) {
      ctx.fail('asset-rotation-invalid', `${path}.rotationY`, `Asset ${assetId} has an invalid rotationY`);
    }
    if (asset.scale !== undefined && (!Number.isFinite(asset.scale) || asset.scale <= 0)) {
      // Schema 2.1: a reflection is `mirror`, never a negative scale.
      const why = Number.isFinite(asset.scale) && asset.scale < 0 ? '; scale must be positive, use mirror to reflect it' : '';
      ctx.fail('asset-scale-invalid', `${path}.scale`, `Asset ${assetId} has an invalid scale${why}`, { scale: asset.scale });
    }
    checkMirror(ctx, asset.mirror, `${path}.mirror`, assetId);
    if (asset.room !== undefined && !ctx.roomIds.has(asset.room)) {
      ctx.fail('asset-unknown-room', `${path}.room`, `Asset ${assetId} references unknown room ${asset.room}`, { room: asset.room });
    }
    if (asset.asset !== undefined && (typeof asset.asset !== 'string' || !asset.asset)) {
      ctx.fail('asset-reference-invalid', `${path}.asset`, `Asset ${assetId} has an invalid catalogue reference`);
    }
    if (asset.variant !== undefined && (typeof asset.variant !== 'string' || !asset.variant)) {
      ctx.fail('asset-variant-invalid', `${path}.variant`, `Asset ${assetId} has an invalid variant`);
    }
    const object = resolveCatalogueObject(ctx, asset, assetId, `${path}.asset`);
    if (asset.variant !== undefined && !object.variants.some((variant) => variant.id === asset.variant)) {
      ctx.fail('asset-variant-unknown', `${path}.variant`, `Asset ${assetId} variant ${asset.variant} is not a variant of ${object.id}`, {
        variant: asset.variant,
        object: object.id,
      });
    }
    if (asset.collision !== undefined) {
      const { hx, hz } = asset.collision;
      if (!Number.isFinite(hx) || !Number.isFinite(hz) || hx <= 0 || hz <= 0) {
        ctx.fail('asset-collision-invalid', `${path}.collision`, `Asset ${assetId} has an invalid collision footprint`, { hx, hz });
      }
    }
    const slotFinishes: Readonly<Record<string, string>> = asset.finishes ?? {};
    for (const [slot, finishId] of Object.entries(slotFinishes)) {
      if (!ctx.registries.isKnownFinish(finishId, ctx.materials)) {
        ctx.fail(
          'asset-slot-finish-unknown',
          `${path}.finishes.${slot}`,
          `Asset ${assetId} slot ${slot} references unknown finish ${finishId}`,
          {
            slot,
            finish: finishId,
          },
        );
      }
    }
    if (asset.material && !ctx.registries.isKnownFinish(asset.material, ctx.materials)) {
      ctx.fail('asset-material-unknown', `${path}.material`, `Asset ${assetId} references unknown material ${asset.material}`, {
        material: asset.material,
      });
    }
  }
}
