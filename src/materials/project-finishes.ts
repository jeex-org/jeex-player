/**
 * The room-surface finishes of a baked project, as the live project view
 * paints with them: the project's own surface materials first, the bundled
 * catalogue behind them (a scene authored before the format still names bank
 * ids no exporter carried into `library.materials`).
 *
 * One composition for every consumer, so the live view and the shell a light
 * bake is made from cannot paint a surface differently.
 *
 * Pure module: no `three`, no DOM.
 */

import { findFinish, type Finish } from './finish-catalogue.js';
import type { ProjectMaterial } from './finish-types.js';

/** A project's finish lookup together with the materials it reads. */
export type ProjectFinishes = {
  readonly findFinish: (id: string) => Finish | null;
  readonly projectMaterials: readonly ProjectMaterial[];
};

/** The finishes of a project whose `library.materials` are `materials`. */
export function projectFinishes(materials: readonly ProjectMaterial[]): ProjectFinishes {
  return { findFinish: (id) => findFinish(id, materials) ?? findFinish(id), projectMaterials: materials };
}
