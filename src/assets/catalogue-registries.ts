/**
 * The `SceneRegistries` the shipped catalogues provide.
 *
 * The scene layer validates references — a finish, a catalogue archetype, an
 * opening variant — against registries it declares as an INTERFACE and never
 * imports (`scene/registries.ts`). This is the other half: the one module that
 * names the real catalogues and hands them over. It lives in `assets/`, above
 * both `materials/` and `scene/`, so nothing in the layer order is inverted.
 *
 * Invariant: no adaptation. Every member is the catalogue function itself, and
 * `SceneRegistries` is written to what those functions already answer — which
 * is why the two lookups are typed `| null | undefined` there rather than
 * being wrapped here.
 *
 * Pure module: no `three`, no DOM.
 */

import { DEFAULT_LIBRARY, findCatalogueEntry, listCatalogueObjects } from './asset-catalogue.js';
import { variantsForPlacement } from './asset-variants.js';
import { findOpeningVariant, variantFamily, variantsForOpening } from './opening-variants.js';
import { DEFAULT_FLOOR_FINISH, findFinish, finishKind } from '../materials/finish-catalogue.js';
import { isKnownFinish, resolveSurfaceFinish } from '../materials/material-catalogue.js';
import { placementIn, type CatalogueArchetype, type LibraryCatalogue, type SceneRegistries } from '../scene/registries.js';

/**
 * The shipped library as one entry of `SceneRegistries.libraries`.
 *
 * It is keyed by the bank's vocabulary id (`DEFAULT_LIBRARY`), which a
 * document never names — a document library is a UUID — so a placement reaches
 * it by naming no library at all. The entry is the same bank, indexed by
 * archetype id. The bank's own extras (a variant id standing for its
 * archetype, a legacy `DemoAsset.type` alias) stay behind `findCatalogueEntry`,
 * which is where `findArchetype` reads the default library from.
 */
const STARTER_LIBRARY: LibraryCatalogue = {
  id: DEFAULT_LIBRARY,
  objects: new Map<string, CatalogueArchetype>(listCatalogueObjects().map((object) => [object.id, object])),
};

export const CATALOGUE_REGISTRIES: SceneRegistries = {
  isSurfaceFinish: (id) => resolveSurfaceFinish(id) !== null,
  isFinish: (id) => findFinish(id) !== null,
  finishKind,
  isKnownFinish,
  variantsForPlacement,
  libraries: new Map([[DEFAULT_LIBRARY, STARTER_LIBRARY]]),
  defaultLibrary: DEFAULT_LIBRARY,
  resolvePlacement: (asset) => placementIn(CATALOGUE_REGISTRIES, asset),
  findCatalogueEntry,
  findOpeningVariant,
  variantFamily,
  openingVariantsOf: variantsForOpening,
  defaultFloorFinish: DEFAULT_FLOOR_FINISH,
};
