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

/**
 * The surface families a finish may dress. `ceiling`, `facade` and `trim` came
 * with the library materials: a project names them, the bundled bank does not.
 */
export type FinishApply = 'floor' | 'wall' | 'ceiling' | 'facade' | 'trim' | 'furniture' | 'fabric' | 'metal' | 'glass' | 'decor';

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

/** The map roles a library material ships; `albedoTint` is the colour map of a tintable scan. */
export type LibraryMapRole = 'albedo' | 'albedoTint' | 'normal' | 'roughness' | 'ao' | 'arm';

/** The pixel sizes a library map may be listed at, as the keys of `LibraryMap.files`. */
export type LibraryMapSize = '128' | '256' | '384' | '512' | '768';

/**
 * One map of a library material: its colour space (`srgb` for the two colour
 * roles, `linear` for every other), the OpenGL convention on `normal` only, and
 * one file per listed size, each exactly `tex/<versionId>/<role>.<px>.webp`.
 */
export type LibraryMap = {
  readonly colourSpace: 'srgb' | 'linear';
  readonly convention?: 'opengl';
  readonly files: { readonly [size in LibraryMapSize]?: string };
};

/**
 * The PBR facts of a library material, glTF names in British spelling. Every
 * field is optional; the reader's defaults (metalness 0, roughness 1, alpha
 * `opaque`) are applied when drawing, never written into the manifest.
 */
export type LibraryPbr = {
  readonly baseColour?: string;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly alphaMode?: 'opaque' | 'blend' | 'mask';
  readonly opacity?: number;
  readonly sheen?: number;
  readonly sheenColour?: string;
  /** How far a sheen without `sheenColour` moves from the tint toward white, linear light; the reader's default is 0.2. */
  readonly sheenLift?: number;
  readonly sheenRoughness?: number;
  readonly clearcoat?: number;
  readonly clearcoatRoughness?: number;
  readonly transmission?: number;
  readonly ior?: number;
  readonly thicknessM?: number;
  readonly attenuationDistanceM?: number;
  readonly attenuationColour?: string;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
};

/** How a tintable material is tinted, and the colours it suggests. */
export type LibraryTint = {
  readonly recipe: 'luma-mid@1';
  readonly suggestedColours: readonly { readonly name: string; readonly hex: string }[];
};

/** What a library material is, apart from its maps. */
export type LibraryFacts = {
  /** Metres covered by one repeat, `[u, v]`; `null` exactly for a parameters material. */
  readonly tileM: readonly [number, number] | null;
  readonly grain: 'along_u' | 'along_v' | 'none' | 'unknown';
  readonly suitability: 'plank_floor' | 'board' | 'continuous';
  /** Scale of the normal map; absent means 1. */
  readonly normalStrength?: number;
  readonly colourMode: 'natural' | 'tintable';
  /** Present exactly when `colourMode` is `tintable`. */
  readonly tint?: LibraryTint;
  /** `#rrggbb`: the flat colour drawn before the first map arrives. */
  readonly averageColour: string;
  readonly pbr: LibraryPbr;
};

/**
 * The `library` member of a project material: a scanned texture set
 * (`scan`) or a parameter-only material (`parameters`), pinned by the UUID v7
 * of the catalogue VERSION whose folder its maps sit in.
 */
export type LibraryMaterial = {
  readonly versionId: string;
  readonly kind: 'scan' | 'parameters';
  readonly facts: LibraryFacts;
  readonly maps: { readonly [role in LibraryMapRole]?: LibraryMap };
};

/**
 * One finish of a baked project, drawn from baked PBR maps, by a parametric
 * generator, or as a library material.
 *
 * Declared here rather than in `assets/project-manifest.ts`, which is where
 * the rest of the manifest lives and which re-exports this name: it is the
 * shape `materials/finish-generators.ts` turns into a THREE material, and
 * `materials` sits BELOW `assets` in the layer order — type-only imports
 * included (`.dependency-cruiser.cjs`).
 *
 * Spelled as a union of three whole members rather than the format's
 * `Base & (A | B | C)`: the two are the same type to an assignment, but `keyof`
 * an intersection with a union inside it is only the BASE's keys, which would
 * quietly excuse `pbr`, `generator` and `library` from the schema's compile-time
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
  | (ProjectMaterialBase & { readonly generator: FinishGenerator; readonly tile?: number })
  | (ProjectMaterialBase & { readonly library: LibraryMaterial });
