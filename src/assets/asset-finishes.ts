/**
 * Finish (material) library for the object bank, plus the THREE material
 * registry built from it.
 *
 * Three sources answer an id, in this order: the finishes a BAKED PROJECT
 * ships (`ProjectMaterial[]`), then the bundled bank, then the
 * scene's own `materials[]`. The project comes first because a project is
 * self-contained — it may re-declare an id the bundled bank happens to use and
 * must win — and the bank stays behind it because a scene written before the
 * format (`DemoAsset.material`) still names bank finish UUIDs that no
 * exporter carries into `library.materials`.
 *
 * This is the *furniture* half of the material system and is deliberately
 * separate from `finishes.ts`, which owns the room surfaces the user paints
 * (floors and walls). Entries mirror the `materials[]` shape of the open
 * library manifest: `id`, `name`, `tags`, `apply` and a `pbr`
 * block. Where the manifest allows a parametric material, an entry carries a
 * `generator` instead of baked maps; the rasterisers are the seamless
 * generators of `textures.ts`, so a furniture panel and a floor share the same
 * tiling guarantees.
 *
 * Invariant: one cached THREE material per finish id, and geometry UVs are
 * baked in metres - so a finish's texture repeat is always `1 / tile`.
 */

import * as THREE from 'three';
import type { MaterialDefinition } from '../scene/types.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import { FALLBACK_FINISH_COLOUR } from '../materials/finish-catalogue.js';
import { generatorFor, materialFromProject, paramsOfGenerator } from '../materials/finish-generators.js';
import { defaultLogger, type Logger } from '../shared/logger.js';

// Only the names other modules actually consume are re-exported here; the rest
// of the manifest shape lives in `asset-finish-catalogue.ts` and is imported
// from there directly.
export type { FinishDefinition } from '../materials/asset-finish-catalogue.js';
export { finishById, resolveFinishId } from '../materials/asset-finish-catalogue.js';

import type { FinishDefinition, FinishGenerator } from '../materials/asset-finish-catalogue.js';
import { finishById } from '../materials/asset-finish-catalogue.js';
import { debugFlags } from '../shared/debug-flags.js';

/** Roughness of the grey a finish nothing resolved is painted with. */
const FALLBACK_FINISH_ROUGHNESS = 0.8;

/**
 * Rasterises a finish's generator through the ONE generator registry
 * (`materials/finish-generators.ts`).
 *
 * One registry for both families, not a per-family `switch` or table, so a
 * project material cannot be drawable on a wall and not on a sofa. A kind this
 * build has never heard of answers `undefined` here and the finish keeps its
 * flat `pbr.color`: an unknown material is drawn plainly, never refused.
 */
function generatorMaps(generator: FinishGenerator): { map: THREE.Texture | null; bump: THREE.Texture | null } {
  const entry = generatorFor(generator.kind);
  if (!entry) return { map: null, bump: null };
  const params = paramsOfGenerator(generator);
  return { map: entry.colour(params), bump: entry.bump?.(params) ?? null };
}

/**
 * Builds and caches one THREE material per finish id.
 *
 * Textures come from the shared cache in `texture-canvas.ts` and are cloned
 * here before the repeat is set, so setting a furniture repeat never disturbs
 * the room-surface finishes that draw from the same cached canvas.
 */
export class FinishRegistry {
  private readonly materials = new Map<string, THREE.Material>();
  /** Double-sided clones, cached per finish id so a swap reuses them. */
  private readonly doubles = new Map<string, THREE.Material>();
  /** Ad-hoc materials the registry hands out but no finish id owns. */
  private readonly adHoc: THREE.Material[] = [];
  private readonly clones: THREE.Texture[] = [];
  private readonly extras = new Map<string, FinishDefinition>();

  /** The finishes the loaded PROJECT ships, by id: the first source `get` asks. */
  private readonly project = new Map<string, ProjectMaterial>();
  private readonly log: Logger;

  /**
   * `sceneMaterials` are the document's own `materials[]`, `projectMaterials`
   * the loaded bake's `library.materials`; both are optional, and with
   * neither this is the bundled bank exactly as it was.
   *
   * A scene material whose id either of the other two sources already answers
   * is dropped rather than recorded: it could never be reached, and keeping it
   * would make `has` say yes to something `get` resolves elsewhere.
   */
  constructor(
    sceneMaterials: readonly MaterialDefinition[] = [],
    projectMaterials: readonly ProjectMaterial[] = [],
    log: Logger = defaultLogger,
  ) {
    this.log = log;
    for (const material of projectMaterials) this.project.set(material.id, material);
    for (const material of sceneMaterials) {
      if (this.project.has(material.id) || finishById(material.id)) continue;
      this.extras.set(material.id, {
        id: material.id,
        name: material.name,
        tags: ['scene'],
        apply: ['furniture'],
        pbr: { color: material.color, roughness: material.roughness, metalness: material.metalness ?? 0 },
      });
    }
  }

  has(id: string): boolean {
    return this.project.has(id) || Boolean(finishById(id) ?? this.extras.get(id));
  }

  /**
   * The BANK's record of a finish id, or `undefined`.
   *
   * A project material has no `FinishDefinition` — it is a `ProjectMaterial`,
   * a different shape — so this answers for the bundled bank and the scene's
   * own materials only. `get` is the lookup that spans all three.
   */
  definition(id: string): FinishDefinition | undefined {
    return finishById(id) ?? this.extras.get(id);
  }

  get(id: string): THREE.Material {
    const cached = this.materials.get(id);
    if (cached) return cached;
    const material = this.create(id);
    this.materials.set(id, material);
    return material;
  }

  /** One material for an id, from whichever of the three sources answers first. */
  private create(id: string): THREE.Material {
    const project = this.project.get(id);
    if (project) {
      const material = materialFromProject(project, this.log);
      // `materialFromProject` clones the cached canvas before setting the
      // repeat, and a disposed material does not dispose its maps: the clone
      // is this registry's to free.
      const map = (material as THREE.MeshStandardMaterial).map;
      if (map) this.clones.push(map);
      return material;
    }
    const definition = this.definition(id);
    if (!definition) {
      const fallback = new THREE.MeshStandardMaterial({ color: FALLBACK_FINISH_COLOUR, roughness: FALLBACK_FINISH_ROUGHNESS });
      fallback.name = `${id}-fallback`;
      return fallback;
    }
    const material = this.build(definition);
    material.name = definition.id;
    return material;
  }

  /**
   * Double-sided view of a finish, cached for the registry's whole life.
   *
   * The registry owns these clones and frees them in `dispose`; a cache per
   * `makeBuildKit` call (once per asset load) would leak one clone per
   * double-sided slot on every furniture swap.
   */
  getDouble(id: string): THREE.Material {
    const cached = this.doubles.get(id);
    if (cached) return cached;
    const clone = this.get(id).clone();
    clone.side = THREE.DoubleSide;
    clone.name = `${clone.name}-double`;
    this.doubles.set(id, clone);
    return clone;
  }

  /**
   * Registers a material the registry did not build (the asset loader's
   * placeholder), so it is disposed with everything else it owns.
   */
  own<T extends THREE.Material>(material: T): T {
    this.adHoc.push(material);
    return material;
  }

  private repeated(texture: THREE.Texture | null, tile: [number, number]): THREE.Texture | null {
    if (!texture) return null;
    const clone = texture.clone();
    clone.needsUpdate = true;
    // Geometry UVs are baked in metres, so the repeat is the inverse of the physical tile size.
    clone.repeat.set(1 / tile[0], 1 / tile[1]);
    this.clones.push(clone);
    return clone;
  }

  private build(definition: FinishDefinition): THREE.Material {
    const { pbr } = definition;
    const tile = pbr.tile ?? [1, 1];
    const generated = definition.generator ? generatorMaps(definition.generator) : { map: null, bump: null };
    const map = this.repeated(generated.map, tile);
    const bump = pbr.bump ? this.repeated(generated.bump ?? generated.map, tile) : null;
    const common = {
      color: new THREE.Color(map ? '#ffffff' : pbr.color),
      roughness: pbr.roughness,
      metalness: pbr.metalness ?? 0,
      map,
      bumpMap: bump,
      bumpScale: bump ? (pbr.bump ?? 0) : 0,
      emissive: new THREE.Color(pbr.emissive ?? '#000000'),
      emissiveIntensity: pbr.emissiveIntensity ?? 0,
    };
    const needsPhysical = pbr.sheen !== undefined || pbr.clearcoat !== undefined || pbr.transmission !== undefined;
    if (!needsPhysical) return new THREE.MeshStandardMaterial(common);
    const physical = new THREE.MeshPhysicalMaterial(common);
    if (pbr.sheen !== undefined) {
      physical.sheen = pbr.sheen;
      physical.sheenColor = new THREE.Color(pbr.sheenColor ?? pbr.color);
      physical.sheenRoughness = pbr.sheenRoughness ?? 0.6;
    }
    if (pbr.clearcoat !== undefined) {
      physical.clearcoat = pbr.clearcoat;
      physical.clearcoatRoughness = pbr.clearcoatRoughness ?? 0.3;
    }
    if (pbr.transmission !== undefined) {
      // A diagnostic switch can keep transmission off, so three.js runs no transmission pass.
      physical.transmission = debugFlags().noTransmission ? 0 : pbr.transmission;
      physical.ior = pbr.ior ?? 1.5;
      physical.thickness = 0.01;
      physical.transparent = true;
      physical.opacity = pbr.opacity ?? 1;
    }
    return physical;
  }

  /** Frees the materials and the texture clones this registry owns; shared canvases stay. */
  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    for (const material of this.doubles.values()) material.dispose();
    this.doubles.clear();
    for (const material of this.adHoc) material.dispose();
    this.adHoc.length = 0;
    for (const clone of this.clones) clone.dispose();
    this.clones.length = 0;
  }
}
