/**
 * What a BAKED PROJECT is: the manifest a producer writes beside a scene so a
 * viewer can draw it from data alone — its asset library, its materials, its
 * renders and who may use them.
 *
 * The folder is the unit: `project.json` names every other file by a
 * path RELATIVE to itself, with no `..` and no URL scheme, so a bake can be
 * served from any origin and copied anywhere without rewriting.
 *
 * ```
 * project.json
 * scene.json
 * obj/<versionId>.glb
 * tex/<material>_<map>.ktx2
 * prev/<id>.webp
 * poster.webp
 * video/<preset>.mp4
 * ```
 *
 * Format 2: every id the manifest carries — the project, the bake, the publisher, the
 * workspace, every object, variant and material — is a UUID v7, checked by the
 * same `isUuidV7` as every id of the scene. The library IS the project
 * (`library.id === projectId`), so the scene names it as its `assetLibrary` (or
 * a placement as its `library`) and a placement's `asset` is the bare asset UUID.
 * Any other format version is refused, never converted. File NAMES
 * inside the folder are whatever the bake wrote and carry no identity.
 *
 * This module declares the shape and nothing else: the runtime judgement is
 * `project-manifest.schema.ts`'s, one file over, and the DOWNLOAD is
 * `scene/project-repository.ts`'s, one layer down — which is why the
 * repository hands a manifest on as `unknown` and `app/scene-mount.ts` is
 * where the two meet.
 *
 * Pure module: no `three`, no DOM.
 */

import type { ProjectLibrary } from '../scene/registries.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import type { CatalogueObject, CatalogueVariant, SlotFinishes, SlotName, VariantAccess } from './asset-types.js';

/** The `format` field that tells a baked project from a bare scene document. */
export const PROJECT_FORMAT = 'jeex-project';

/**
 * One VARIANT of a project object: the catalogue variant plus the two fields a
 * bake adds to it.
 *
 * `model` and `preview` per variant are not an invention of this format — a
 * catalogue export already writes them, because the unit of purchase and of
 * geometry is the VARIANT: one `obj/<versionId>.glb` per baked variant
 * version. They stay optional here; an object's own `model` is the one file a bake must have.
 */
export type ProjectVariant = Omit<CatalogueVariant, 'slug' | 'finishes'> & {
  /** `slot -> finish UUID` over open slot names. */
  readonly finishes?: SlotFinishes;
  /** GLB of this variant, relative to the manifest folder. */
  readonly model?: string;
  /**
   * Picture of this variant: a path relative to the manifest folder, or an
   * ABSOLUTE `http(s)` URL — a catalogue service's public preview address
   * (e.g. `<origin>/previews/<publisher>/<asset>/<variant>/<version>.webp`).
   * It is the one field of the format that may leave the folder, and
   * deliberately so: the picture is public and served without a signature,
   * while every file the viewer would DRAW from still has to sit inside the
   * bake.
   */
  readonly preview?: string;
  /**
   * The variant's access level, as the host wrote it. The viewer carries it to
   * `SelectionOption.access` and judges nothing.
   */
  readonly access?: VariantAccess;
  /**
   * Whether THIS workspace may place the variant, as the host decided at the
   * moment the library was handed over. Carried to `SelectionOption.allowed`;
   * the viewer neither computes nor enforces it.
   */
  readonly allowed?: boolean;
};

/**
 * One OBJECT of a project library: `CatalogueObject` with `model` required and
 * `builder` gone. Neither carries the bundled bank's display-only `slug`: a
 * project's entries are named by `name` and addressed by UUID.
 *
 * The format's rule — "`CatalogueObject.builder` becomes optional and the
 * viewer does not read it; `model` is required for the entries of a project"
 * — is what this type says to the compiler. It is a separate type rather than
 * a loosened `CatalogueObject` because the builders are still the fallback for
 * a bare scene, and a bake must be refused for carrying a builder id TODAY,
 * not once the builders are gone.
 */
export type ProjectObject = Omit<
  CatalogueObject,
  'slug' | 'builder' | 'model' | 'variants' | 'slots' | 'defaultFinishes' | 'primarySlot'
> & {
  /** Open slot names: a baked asset names its parts freely (`shell`, `base`, `fittings`). */
  readonly slots: readonly SlotName[];
  readonly defaultFinishes: SlotFinishes;
  readonly primarySlot: SlotName;
  /** GLB of the archetype, relative to the manifest folder. Never absent in a bake. */
  readonly model: string;
  readonly variants: readonly ProjectVariant[];
};

/**
 * The project's asset library: the library-manifest shape with `baseUrl`
 * omitted — the manifest folder IS the base — and the materials the bake
 * ships.
 *
 * Named `ProjectLibraryManifest` rather than `ProjectLibrary`
 * because `scene/registries.ts` already publishes a `ProjectLibrary`: the
 * NARROW view of this same thing, which is all the scene layer may see from
 * below. `projectLibraryOf` is the one-way door between them.
 */
export type ProjectLibraryManifest = {
  readonly manifestVersion: '1.0';
  /** The project's UUID: `BakedProjectManifest.projectId`, and what the scene's `assetLibrary` (or a placement's `library`) names. */
  readonly id: string;
  /** Human name of the library; the catalogue export writes one, the viewer never reads it. */
  readonly name?: string;
  /** UUID of the publishing workspace. */
  readonly publisher: string;
  /** SPDX or a URL. */
  readonly license: string;
  readonly objects: readonly ProjectObject[];
  readonly materials: readonly ProjectMaterial[];
};

/**
 * One finish of the project, re-exported from the layer that owns the shape.
 *
 * `ProjectMaterial` is a MATERIAL — `apply`, a generator or a set of baked
 * maps — and `materials/finish-generators.ts` has to name one to turn it into
 * a THREE material. `materials` sits BELOW `assets` (`.dependency-cruiser.cjs`,
 * type-only imports included), so the declaration lives down there next to
 * `FinishApply` and `FinishGenerator`, exactly as those two moved out of
 * `asset-finish-catalogue.ts` before it. Nothing moved but the declaration:
 * a manifest reader still imports `ProjectMaterial` from here.
 */
export type { ProjectMaterial } from '../materials/finish-types.js';

/** A render or a video the producer made for this bake. The viewer hands it to the host and plays nothing itself. */
export type ProjectMedia = {
  readonly kind: 'video' | 'still' | 'panorama';
  /** `landscape-1080p`, `vertical-1080p`, `landscape-4k`, … */
  readonly preset: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs?: number;
  readonly poster?: string;
};

/** One catalogue asset the bake was made with: which variant, at which version, under which access. */
export type ProjectRightsAsset = {
  /** UUID of the catalogue asset (the archetype). */
  readonly assetId: string;
  /** UUID of the variant: the unit of access and purchase. */
  readonly variantId: string;
  readonly version: string;
  readonly access: VariantAccess;
};

/** Who may use this bake, recorded for humans and for the producer; the viewer never reads it. */
export type ProjectRights = {
  /** UUID of the workspace the bake was made for. */
  readonly workspaceId: string;
  /** Baked assets stay usable forever; the flag is documentation, not a switch. */
  readonly perpetual: true;
  readonly assets: readonly ProjectRightsAsset[];
};

/** A baked project: one folder, one scene, one library, one bake. */
export type BakedProjectManifest = {
  readonly format: 'jeex-project';
  /** `2`: every id is a UUID v7; any other version is refused. */
  readonly formatVersion: 2;
  /** Stable project UUID at the producer; the same across bakes, and the library's `id`. */
  readonly projectId: string;
  /** UUID of this bake; a new one per bake of the project. */
  readonly bakeId: string;
  /** ISO-8601. */
  readonly bakedAt: string;
  readonly title?: string;
  /** Relative path of the scene document (schema 2.2). */
  readonly scene: string;
  /** The project's asset library: library-manifest shape, `baseUrl` omitted (it IS the manifest folder). */
  readonly library: ProjectLibraryManifest;
  /** Renders and videos the producer made for this bake. Optional per kind. */
  readonly media?: readonly ProjectMedia[];
  /** Who may use this bake, recorded for humans and for the producer; the viewer never reads it. */
  readonly rights: ProjectRights;
  /** Producer stamp; free-form, so any producer can name itself. */
  readonly generator: { readonly name: string; readonly version: string };
  /**
   * The producer's mark the viewer shows over this project, whatever the host
   * asked for: `readonly`, `unbranded`, `overlay`, `chrome` and every other
   * option leave it on screen. A producer writes it into the bake, so the
   * decision travels with the published data and no attribute or query
   * parameter of a pasted snippet can take it away. Absent: no mark. `href` is
   * where the mark links (http(s) only).
   */
  readonly mark?: { readonly href: string };
};

/**
 * Whether a document a repository downloaded is a baked project rather than a
 * bare scene.
 *
 * It reads ONE field on purpose: the repository asks this before anything is
 * validated, to decide which of the two documents it is holding, and a
 * malformed project must be refused BY THE SCHEMA with its field paths, never
 * silently mistaken for a scene because its `library` was missing.
 */
export function isProjectDocument(value: unknown): value is { format: 'jeex-project' } {
  return typeof value === 'object' && value !== null && (value as { format?: unknown }).format === PROJECT_FORMAT;
}

/**
 * The manifest's library as the SCENE layer reads it (`scene/registries.ts`):
 * archetype UUIDs, their variant UUIDs, the default variant, the anchor, and
 * the finishes with the surfaces they dress.
 *
 * A projection rather than the manifest object itself, though the manifest
 * satisfies `ProjectLibrary` structurally: what `registriesFromLibrary` gets
 * is then exactly what the scene layer is allowed to know, and `anchor` — the
 * one field of an archetype that changes what an EDIT does (`place_object`
 * forces `y = 0` for a floor-standing object) — is carried across
 * deliberately instead of surviving by accident.
 */
export function projectLibraryOf(manifest: BakedProjectManifest): ProjectLibrary {
  return {
    id: manifest.library.id,
    objects: manifest.library.objects.map((object) => ({
      id: object.id,
      variants: object.variants.map((variant) => ({ id: variant.id })),
      defaultVariant: object.defaultVariant,
      anchor: object.anchor,
      // The one other archetype fact an EDIT judges: which axes `mirror_object` may set.
      ...(object.mirror === undefined ? {} : { mirror: object.mirror }),
    })),
    materials: manifest.library.materials.map((material) => ({ id: material.id, apply: material.apply })),
  };
}
