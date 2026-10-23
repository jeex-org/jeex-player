/**
 * What every validation section is handed, and the vocabulary they share.
 *
 * `validateScene` is a TABLE of sections over this context — each section
 * its own module, reading the prepared context and refusing the document through
 * `fail(rule, path, message, detail?)`, which takes the rule and the path
 * FIRST so no check can be written without saying which rule it is and which
 * field it is about.
 *
 * Invariant: a section returns nothing and repairs nothing. It either says
 * nothing or throws. What it may WRITE is only what a later section has to
 * read — the node points, the room ids, the entrance — and each of those has
 * exactly one writer, named on the field.
 *
 * Pure module: no `three`, no DOM.
 */

import type { SolvedPlan } from '../../plan/plan-solver.js';
import { SceneValidationError, type ErrorDetail } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import { isLibraryMaterialIn, surfacesIn, type SceneRegistries } from '../registries.js';
import { isUuidV7 } from '../types.js';
import { finishRefProblem } from '../finish-value.js';
import type { FinishRef, FinishSurface, MaterialDefinition, SceneData, Vec2, Vec3 } from '../types.js';

/**
 * Refuses the document: `rule` names the check, `path` names the field.
 *
 * The message keeps the prefix every existing host matches on, and the two
 * structured fields are what a machine reads. `detail` carries the numbers a
 * host would otherwise have to parse back out of the sentence.
 */
export function fail(rule: string, path: string, message: string, detail?: ErrorDetail): never {
  throw new SceneValidationError(rule, `Scene validation failed: ${message}`, detail === undefined ? { path } : { path, detail });
}

/** The refusal a section reaches through its context; the same `fail`. */
export type Fail = typeof fail;

/**
 * Registers an id across EVERY kind and answers with it.
 *
 * Every entity id is a UUID v7, and a UUID names ONE entity: a wall may not
 * borrow a room's id, and an opening may not repeat across walls, because the
 * touched-entity vocabulary, the builder registries and every host address
 * them by bare id.
 */
export type Claim = (kind: string, id: unknown, path: string) => string;

/** Everything the sections share, built once before the first one runs. */
export type ValidationContext = {
  /** The document under test, shape-checked by `assertSceneShape`. */
  readonly scene: SceneData;
  /** Where a warning goes: the host's `onLog`, else the console. */
  readonly log: Logger;
  readonly fail: Fail;
  readonly claim: Claim;
  /**
   * The registries a reference is validated against, HANDED IN rather than
   * imported (`scene/registries.ts`): the catalogues live two layers above the
   * scene layer, so importing them here would invert the layer order.
   */
  readonly registries: SceneRegistries;
  /** `nodes[].p` by id. Written by the `nodes` section, read by `walls`. */
  readonly nodePoints: Map<string, Vec2>;
  /** Every room id. Written by the `rooms` section, read by four others. */
  readonly roomIds: Set<string>;
  /** Scene-local material overrides; `[]` when the document declares none. */
  readonly materials: readonly MaterialDefinition[];
  /**
   * The one opening that may carry `entrance: true`, or `null`.
   * Written by the `walls` section as it walks the openings.
   */
  entrance: string | null;
};

/** A section that runs BEFORE the plan is solved. */
export type Section = { readonly name: string; readonly check: (ctx: ValidationContext) => void };

/** A section that runs after, so it may read the solved plan. */
export type PlanSection = { readonly name: string; readonly check: (ctx: ValidationContext, plan: SolvedPlan) => void };

/** The context of one run. `claim` closes over the id registry, which is its state. */
export function newContext(scene: SceneData, registries: SceneRegistries, log: Logger): ValidationContext {
  const takenIds = new Map<string, string>();
  const claim: Claim = (kind, id, path) => {
    if (!isUuidV7(id)) {
      fail('id-invalid', path, `${kind} id ${JSON.stringify(id)} is not a UUID v7 (lowercase, canonical 8-4-4-4-12)`, {
        kind,
        id: typeof id === 'string' ? id : null,
      });
    }
    const previous = takenIds.get(id);
    if (previous) fail('id-duplicate', path, `Duplicate id ${id}: already used by a ${previous}`, { id, kind, takenBy: previous });
    takenIds.set(id, kind);
    return id;
  };
  // The scene's own UUID is in the namespace too (the shape gate proved its
  // grammar), so no entity may take it.
  takenIds.set(scene.id, 'scene');
  return {
    scene,
    log,
    fail,
    claim,
    registries,
    nodePoints: new Map<string, Vec2>(),
    roomIds: new Set<string>(),
    materials: scene.materials ?? [],
    entrance: null,
  };
}

/* ------------------------------------------------------- shared checks --- */

export function isFiniteVec2(value: Vec2 | undefined): value is Vec2 {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.z);
}

export function isFiniteVec3(value: Vec3 | undefined): value is Vec3 {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

/** Own string keys of a record, ignoring anything inherited from the prototype. */
export function ownKeys(record: Readonly<Record<string, unknown>> | undefined): string[] {
  if (!record || typeof record !== 'object') return [];
  return Object.keys(record).filter((key) => Object.prototype.hasOwnProperty.call(record, key));
}

/** A surface finish that must belong to a given family (`floor` or `wall`). */
export function requireFinishFamily(ctx: ValidationContext, id: string, family: 'floor' | 'wall', label: string, path: string): void {
  if (!ctx.registries.isSurfaceFinish(id)) fail('finish-unknown', path, `${label} references unknown finish ${id}`, { finish: id });
  const kind = ctx.registries.finishKind(id);
  if (kind !== family) {
    fail('finish-wrong-family', path, `${label} references ${id}, which is a ${kind ?? 'unknown'} finish, not a ${family} finish`, {
      finish: id,
      kind: kind ?? null,
      family,
    });
  }
}

/**
 * A finish VALUE standing on `surface`: its shape, its version, the material
 * it names and whether that material dresses the surface.
 *
 * The two spellings are judged by two rules on purpose. A finish object names
 * a LIBRARY material (the only one with modifiers to read) whose `apply`
 * contains the surface, strictly. A bare UUID keeps the rule of 2.2 extended
 * to the new places: the surface table, plus the compatibility that a finish
 * dressing walls also dresses the facade.
 */
export function requireFinishOn(ctx: ValidationContext, value: FinishRef, surface: FinishSurface, label: string, path: string): void {
  const problem = finishRefProblem(value);
  if (problem !== null) fail('finish-invalid', path, `${label} ${problem}`);
  const { registries } = ctx;
  if (typeof value === 'object') {
    if (ctx.scene.schemaVersion === '2.2') {
      fail('finish-needs-schema-2-3', path, `${label} is a finish object, which needs scene schema 2.3; this document is 2.2`);
    }
    const id = value.material;
    if (!registries.isSurfaceFinish(id) && !isLibraryMaterialIn(registries, id)) {
      fail('finish-unknown', path, `${label} references unknown finish ${id}`, { finish: id });
    }
    if (!isLibraryMaterialIn(registries, id)) {
      fail('finish-modifiers-need-library', path, `${label} gives ${id} a colour or rotation; modifiers need a library material`, {
        finish: id,
      });
    }
    if (!surfacesIn(registries, id).has(surface)) wrongSurface(ctx, id, surface, label, path);
    return;
  }
  if (!registries.isSurfaceFinish(value)) fail('finish-unknown', path, `${label} references unknown finish ${value}`, { finish: value });
  const surfaces = surfacesIn(registries, value);
  if (!surfaces.has(surface) && !(surface === 'facade' && surfaces.has('wall'))) wrongSurface(ctx, value, surface, label, path);
}

/** Refuses a finish on a surface it does not dress, naming both. */
function wrongSurface(ctx: ValidationContext, id: string, surface: FinishSurface, label: string, path: string): never {
  const kind = ctx.registries.finishKind(id);
  return fail('finish-wrong-family', path, `${label} references ${id}, which is a ${kind ?? 'unknown'} finish, not a ${surface} finish`, {
    finish: id,
    kind: kind ?? null,
    family: surface,
  });
}

/** A `{ position, target }` pose with finite coordinates. */
export function requirePose(pose: { position?: Vec3; target?: Vec3 } | undefined, label: string, path: string): void {
  if (!pose || typeof pose !== 'object') fail('pose-not-object', path, `${label} must be an object`);
  if (!isFiniteVec3(pose.position) || !isFiniteVec3(pose.target)) fail('pose-invalid', path, `${label} has an invalid position or target`);
}
