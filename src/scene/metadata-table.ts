/**
 * The element metadata table an export walks: one row per exportable entity
 * of a scene document, keyed by its exchange GUID — the entity's own UUID, or
 * for a wall face the id `scene/guid.ts` derives from its owners.
 *
 * Invariant: `metadataTable` is a pure function of `(scene, plan)` — same
 * document in, same rows out, in the same ORDER (class, then id) — which is
 * what lets `exportGlb`'s byte-for-byte determinism test hold: a row's
 * position is what `EXT_mesh_features` on a mesh points at
 * (`render/export-graph.ts`), so a re-export of the same document must lay the
 * rows out identically.
 *
 * Deliberately narrower than `ElementKind` allows: `'floor'` and `'ceiling'`
 * are reserved for a future covering export (the IFC mapping puts
 * `finishes` onto `IfcCovering`, not onto a standalone entity), so the table
 * emits exactly the five kinds the acceptance test names — wall, wall face,
 * room, opening, furniture — and the type stays open for the day a covering
 * gets its own row.
 *
 * Pure module: no `three`, no DOM.
 */

import { ifcGuid } from '../shared/uuid.js';
import { faceGuid } from './guid.js';
import { FaceMap } from './types.js';
import { documentLibraryOf } from './registries.js';
import type { SceneData, WallSide } from './types.js';
import type { SolvedPlan } from '../plan/plan-solver.js';

/** The exportable entity kinds; open on purpose (see the module header). */
export type ElementClass = 'wall' | 'wallFace' | 'floor' | 'ceiling' | 'opening' | 'furniture' | 'room';

/**
 * One exportable element, ready to become a `EXT_structural_metadata`
 * property-table row and a `Pset_JEEX_*` set on the eventual IFC writer.
 *
 * The cross-reference fields (`roomId`, `wallId`) name a RELATED entity,
 * never the row's own id twice. A `wallFace` row's own id is the GUID derived
 * from its face (`guid.faceGuid`), and the face itself is spelled out beside
 * it: `wallId`, `side` and — except on the facade — `roomId`.
 */
export type ElementRow = {
  readonly guid: string;
  readonly ifcGuid: string;
  readonly class: ElementClass;
  readonly id: string;
  readonly roomId?: string;
  readonly wallId?: string;
  /** Wall face only: which side of `wallId` the face is. */
  readonly side?: WallSide;
  readonly openingType?: string;
  /** Furniture only: the catalogue reference (`DemoAsset.asset`, a bare UUID). */
  readonly assetId?: string;
  /**
   * Furniture only: the UUID of the library `assetId` belongs to — the
   * placement's `library`, else the document's `assetLibrary`. Absent for the
   * built-in bank, which has no UUID to write.
   */
  readonly libraryId?: string;
  /** Furniture: `DemoAsset.variant`. Opening: `Opening.variant`. */
  readonly variantId?: string;
  /** The resolved finish id, when this element carries an explicit override. */
  readonly finish?: string;
};

/** Row order: class rank first, then id — `Array.prototype.sort` is stable, so ties keep insertion order. */
const CLASS_ORDER: readonly ElementClass[] = ['wall', 'wallFace', 'floor', 'ceiling', 'opening', 'furniture', 'room'];

function classRank(elementClass: ElementClass): number {
  return CLASS_ORDER.indexOf(elementClass);
}

/** A row whose GUID is `id` itself: an entity's UUID, or a face's derived one. */
function row(elementClass: ElementClass, id: string, rest: Omit<ElementRow, 'guid' | 'ifcGuid' | 'class' | 'id'> = {}): ElementRow {
  return { guid: id, ifcGuid: ifcGuid(id), class: elementClass, id, ...rest };
}

/** One row per wall, wall face, room, opening and furniture placement. */
export function metadataTable(scene: SceneData, plan: SolvedPlan): ElementRow[] {
  const rows: ElementRow[] = [];

  for (const wall of scene.walls) {
    rows.push(row('wall', wall.id));
    for (const opening of wall.openings ?? []) {
      rows.push(
        row('opening', opening.id, {
          wallId: wall.id,
          openingType: opening.type,
          ...(opening.variant === undefined ? {} : { variantId: opening.variant }),
        }),
      );
    }
  }

  const painted = new FaceMap<string>();
  for (const entry of scene.finishes?.faces ?? []) painted.set(entry, entry.finish);
  for (const face of plan.faces.values()) {
    const finish = painted.get(face.key);
    rows.push(
      row('wallFace', faceGuid(face.key), {
        ...(face.roomId === null ? {} : { roomId: face.roomId }),
        wallId: face.wallId,
        side: face.side,
        ...(finish === undefined ? {} : { finish }),
      }),
    );
  }

  for (const roomEntry of scene.rooms) {
    const finish = scene.finishes?.rooms?.[roomEntry.id]?.floor ?? roomEntry.floorMaterial;
    rows.push(row('room', roomEntry.id, { finish }));
  }

  for (const asset of scene.assets) {
    const libraryId = documentLibraryOf(asset, scene.assetLibrary);
    rows.push(
      row('furniture', asset.id, {
        ...(asset.room === undefined ? {} : { roomId: asset.room }),
        ...(asset.asset === undefined ? {} : { assetId: asset.asset }),
        ...(libraryId === undefined ? {} : { libraryId }),
        ...(asset.variant === undefined ? {} : { variantId: asset.variant }),
      }),
    );
  }

  rows.sort((a, b) => classRank(a.class) - classRank(b.class) || a.id.localeCompare(b.id));
  return rows;
}

/**
 * The `EXT_structural_metadata` root extension object for `rows`.
 *
 * One schema, one class (`jeexElement`), one property table. Deliberately
 * simplified against the real extension (no binary buffers yet): a conformant
 * reader expects a property's values in a binary buffer view addressed by the
 * mesh's glTF `bufferViews`, and this writes them inline as JSON arrays
 * instead, which is not what the ratified spec's schema validator accepts. It
 * is enough for our own reader (a debug panel, a future IFC round-trip) and is
 * a documented deviation, not a claim of `EXT_structural_metadata` conformance.
 */
export function structuralMetadataExtension(rows: readonly ElementRow[]): Record<string, unknown> {
  const column = <K extends keyof ElementRow>(key: K): Array<ElementRow[K] | null> => rows.map((entry) => entry[key] ?? null);
  return {
    schema: {
      id: 'jeexViewerElementSchema',
      classes: {
        jeexElement: {
          name: 'JEEX scene element',
          properties: {
            guid: { type: 'STRING' },
            ifcGuid: { type: 'STRING' },
            class: { type: 'STRING' },
            id: { type: 'STRING' },
            roomId: { type: 'STRING', required: false },
            wallId: { type: 'STRING', required: false },
            side: { type: 'STRING', required: false },
            openingType: { type: 'STRING', required: false },
            assetId: { type: 'STRING', required: false },
            libraryId: { type: 'STRING', required: false },
            variantId: { type: 'STRING', required: false },
            finish: { type: 'STRING', required: false },
          },
        },
      },
    },
    propertyTables: [
      {
        name: 'jeexElements',
        class: 'jeexElement',
        count: rows.length,
        properties: {
          guid: column('guid'),
          ifcGuid: column('ifcGuid'),
          class: column('class'),
          id: column('id'),
          roomId: column('roomId'),
          wallId: column('wallId'),
          side: column('side'),
          openingType: column('openingType'),
          assetId: column('assetId'),
          libraryId: column('libraryId'),
          variantId: column('variantId'),
          finish: column('finish'),
        },
      },
    ],
  };
}
