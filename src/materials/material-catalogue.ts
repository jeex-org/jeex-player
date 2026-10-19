/**
 * The one place a material id is resolved.
 *
 * The viewer carries two catalogues on purpose: `finish-catalogue.ts` owns the
 * room surfaces the user paints (floors and walls, with a `tile` in metres and
 * a procedural pattern), and `asset-finish-catalogue.ts` owns the object-bank
 * finishes furniture is upholstered and veneered with (manifest shape). They
 * answer different questions and neither can replace the other.
 * Both live in `materials/`: a catalogue of finishes is this layer's business,
 * whoever consumes it — the object bank reads the second one from here rather
 * than owning it, so this module never reaches up into `assets/`.
 *
 * `resolveFinish(id)` is the single entry point over both, so a scene names a
 * finish once instead of declaring it twice (in `SceneData.materials[]` and in
 * a catalogue): it searches the surface catalogue first, then the object
 * catalogue, and finally an optional list of scene-local overrides. Every id is a UUID; the two catalogues' ids
 * are disjoint literals (`finish-ids.ts`). `SceneData.materials[]` is
 * therefore optional and means "extra ids this scene defines", not "every id
 * this scene may use".
 *
 * Pure module: no `three`, no DOM.
 */

import { findFinish, type Finish } from './finish-catalogue.js';
import { finishById, type FinishDefinition } from './asset-finish-catalogue.js';
import type { MaterialDefinition } from '../scene/types.js';

/** Which catalogue answered, so callers can pick the right material builder. */
export type ResolvedFinish =
  | { source: 'surface'; id: string; name: string; color: string; roughness: number; metalness: number; finish: Finish }
  | { source: 'object'; id: string; name: string; color: string; roughness: number; metalness: number; definition: FinishDefinition }
  | { source: 'scene'; id: string; name: string; color: string; roughness: number; metalness: number; material: MaterialDefinition };

/**
 * Resolves a material id across both catalogues and the scene's own overrides.
 *
 * Order is surface -> object -> scene override, so a scene cannot silently
 * shadow a catalogue finish the painting UI also offers; an override only ever
 * adds an id.
 */
export function resolveFinish(id: string | undefined, sceneMaterials: readonly MaterialDefinition[] = []): ResolvedFinish | null {
  if (!id) return null;

  const surface = findFinish(id);
  if (surface) {
    return {
      source: 'surface',
      id: surface.id,
      name: surface.name,
      color: surface.base,
      roughness: surface.roughness,
      metalness: 0,
      finish: surface,
    };
  }

  const object = finishById(id);
  if (object) {
    return {
      source: 'object',
      id: object.id,
      name: object.name,
      color: object.pbr.color,
      roughness: object.pbr.roughness,
      metalness: object.pbr.metalness ?? 0,
      definition: object,
    };
  }

  const local = sceneMaterials.find((material) => material.id === id);
  if (local) {
    return {
      source: 'scene',
      id: local.id,
      name: local.name,
      color: local.color,
      roughness: local.roughness,
      metalness: local.metalness ?? 0,
      material: local,
    };
  }

  return null;
}

/** True when an id resolves anywhere; the validator's membership test. */
export function isKnownFinish(id: string | undefined, sceneMaterials: readonly MaterialDefinition[] = []): boolean {
  return resolveFinish(id, sceneMaterials) !== null;
}

/**
 * Resolves an id that must be paintable on a room surface. Object finishes are
 * rejected here even though they resolve, because the shell builder needs a
 * `Finish` with a tile size and a pattern.
 */
export function resolveSurfaceFinish(id: string | undefined): Finish | null {
  if (!id) return null;
  return findFinish(id);
}

/** Base albedo of any resolvable id, for UI chips that cannot render a preview. */
export function finishColorOf(id: string, sceneMaterials: readonly MaterialDefinition[] = []): string | null {
  return resolveFinish(id, sceneMaterials)?.color ?? null;
}
