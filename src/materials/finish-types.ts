/**
 * What an object finish IS, apart from which finishes this build happens to
 * ship: the surfaces a material may dress, the parametric generators that draw
 * one, its physical parameters, the slots a catalogue object exposes, and the
 * catalogue entry that carries them.
 *
 * The types were declared in `asset-finish-catalogue.ts` next to the data
 * until the baked-project format needed them: a project ships its OWN
 * materials (`assets/project-manifest.ts`), and a module that names the shape of a material must not have to import
 * the seventy entries this build bundles. Nothing moved but the declarations —
 * `asset-finish-catalogue.ts` re-exports every one of them, so every existing
 * importer keeps its import path and its meaning.
 *
 * Types only: no values, no `three`, no DOM.
 */

/** The surface families a finish may dress. */
export type FinishApply = 'floor' | 'wall' | 'furniture' | 'fabric' | 'metal' | 'glass' | 'decor';

/**
 * Parametric texture for a finish. Every variant maps onto one seamless
 * generator in `textures.ts`; the tile size lives in `pbr.tile` because it is a
 * property of the material, not of the pattern.
 */
export type FinishGenerator =
  | { kind: 'wood_grain'; tone: string; seed: number; lines?: number; variation?: number }
  | { kind: 'plank_floor'; tone: string; seed: number }
  | { kind: 'fabric_weave'; tone: string; seed: number; threads?: number; variance?: number }
  | { kind: 'painted_plaster'; tone: string; seed: number }
  | { kind: 'tile_grid'; tone: string; grout: string; seed: number; grid?: number; style?: 'ceramic' | 'stone' };

export type FinishPbr = {
  color: string;
  roughness: number;
  metalness?: number;
  /** Physical extras - any of these promotes the material to `MeshPhysicalMaterial`. */
  sheen?: number;
  sheenColor?: string;
  sheenRoughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  transmission?: number;
  ior?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  /** Metres covered by one texture repeat, `[u, v]` - the manifest's `tile`. */
  tile?: [number, number];
  /** `bumpScale` for the generated height map; omit for flat finishes. */
  bump?: number;
};

export type FinishDefinition = {
  /** UUID v7 of the finish. */
  id: string;
  /** Display-only readable name of a bank row (`oak_natural`); a scene's own material has none. Never a key. */
  slug?: string;
  name: string;
  tags: string[];
  apply: FinishApply[];
  pbr: FinishPbr;
  generator?: FinishGenerator;
};

/**
 * Slots a catalogue object exposes. A variant re-finishes an object by naming a
 * finish per slot, which is how the documented variant axes (upholstery,
 * colour, size) reach the geometry.
 */
export type FinishSlot =
  | 'frame'
  | 'upholstery'
  | 'cushion'
  | 'top'
  | 'front'
  | 'carcass'
  | 'leg'
  | 'metal'
  | 'accent'
  | 'shade'
  | 'screen'
  | 'glass'
  | 'ceramic'
  | 'foliage'
  | 'bark'
  | 'soil'
  | 'light';

/** What every material of a BAKED PROJECT carries, whichever way it is drawn. */
type ProjectMaterialBase = {
  readonly id: string;
  readonly name: string;
  readonly tags?: readonly string[];
  readonly apply: readonly FinishApply[];
  /** Picture of the material: relative to the manifest folder, or an absolute `http(s)` URL a catalogue service serves. */
  readonly preview?: string;
};

/**
 * One finish of a baked project, drawn either from baked PBR maps or by a
 * parametric generator.
 *
 * Declared here rather than in `assets/project-manifest.ts`, which is where
 * the rest of the manifest lives and which re-exports this name: it is the
 * shape `materials/finish-generators.ts` turns into a THREE material, and
 * `materials` sits BELOW `assets` in the layer order — type-only imports
 * included (`.dependency-cruiser.cjs`).
 *
 * Spelled as a union of two whole members rather than the format's
 * `Base & (A | B)`: the two are the same type to an assignment, but `keyof`
 * an intersection with a union inside it is only the BASE's keys, which would
 * quietly excuse `pbr` and `generator` from the schema's compile-time
 * agreement check (`assets/project-manifest.schema.test.ts`). The union
 * proves them.
 */
export type ProjectMaterial =
  | (ProjectMaterialBase & {
      readonly pbr: {
        readonly albedo: string;
        readonly normal?: string;
        readonly roughness: number;
        readonly metalness?: number;
        readonly tile: readonly [number, number];
      };
    })
  | (ProjectMaterialBase & { readonly generator: FinishGenerator; readonly tile?: number });
