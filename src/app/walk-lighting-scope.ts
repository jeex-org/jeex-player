/**
 * What an edit asks the walk and tour room lighting to refresh: a furniture
 * edit re-captures its room's reflection probe; a finish edit re-bakes its
 * room's grid (and so its probe); an opening edit re-bakes both rooms it
 * joins; a plan, sun or facade change re-bakes everything; camera and tour
 * edits change no light. Every asset edit also asks the lighting to check
 * its lamps (`lamps`): a lamp moved, removed, added or swapped re-bakes
 * everything, and a removed asset, or one moved out of every room, has no
 * room the updated model could name, so the check is its only way in.
 *
 * Pure module: no `three`, no DOM.
 */

import type { TouchedEntity } from '../scene/ops/context.js';

/**
 * Rooms by name, or everything. `grids` rooms re-bake grid and probe; `probes` rooms re-capture the probe only;
 * `lamps` asks the lighting to compare its lamps with those it baked and re-bake everything when they differ.
 */
export type LightingScope = { all: boolean; grids: readonly string[]; probes: readonly string[]; lamps?: true };

/** The document reads the scope needs. */
export type ScopeLookups = {
  assetRoom: (assetId: string) => string | null;
  openingRooms: (openingId: string) => readonly string[];
};

const ALL: LightingScope = Object.freeze({ all: true, grids: [], probes: [] });

/** The scope of one commit's touched entities; `null` when nothing lit changed. */
export function refreshScope(touched: readonly TouchedEntity[], lookups: ScopeLookups): LightingScope | null {
  const grids = new Set<string>();
  const probes = new Set<string>();
  let lamps = false;
  for (const entity of touched) {
    switch (entity.kind) {
      case 'shell':
      case 'site':
      case 'facade':
        return ALL;
      case 'floor':
      case 'walls':
      case 'ceiling':
      case 'trim':
        grids.add(entity.room);
        break;
      case 'face':
        if (entity.face.room === undefined) return ALL;
        grids.add(entity.face.room);
        break;
      case 'opening':
        for (const room of lookups.openingRooms(entity.id)) grids.add(room);
        break;
      case 'asset': {
        lamps = true;
        const room = lookups.assetRoom(entity.id);
        if (room !== null) probes.add(room);
        break;
      }
      case 'camera':
      case 'navigation':
      case 'autotour':
      case 'tourCheckpoints':
        break;
    }
  }
  if (grids.size === 0 && probes.size === 0 && !lamps) return null;
  return {
    all: false,
    grids: [...grids],
    probes: [...probes].filter((room) => !grids.has(room)),
    ...(lamps ? { lamps: true as const } : {}),
  };
}

/** Two pending scopes as one. */
export function mergeScopes(a: LightingScope | null, b: LightingScope): LightingScope {
  if (a === null) return b;
  if (a.all || b.all) return ALL;
  const grids = [...new Set([...a.grids, ...b.grids])];
  return {
    all: false,
    grids,
    probes: [...new Set([...a.probes, ...b.probes])].filter((room) => !grids.includes(room)),
    ...(a.lamps || b.lamps ? { lamps: true as const } : {}),
  };
}
