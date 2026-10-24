/**
 * The element metadata table an export walks: one row per exportable element
 * of a scene document. An ENTITY row (wall, opening, room, furniture) is keyed
 * by the entity's own UUID, the one the document's author minted. A wall face
 * has no id in the document — it is the side of a wall as seen from a room, or
 * from outside — so its row carries no id at all and is ADDRESSED instead, by
 * `wallId` + `side`, with `roomId` beside them (absent on the facade). The viewer mints no
 * ids and composes none from other ids; a writer that needs one per face (an
 * IFC `GlobalId`) owns that problem for the file it writes.
 *
 * Invariant: `metadataTable` is a pure function of `(scene, plan)` — same
 * document in, same rows out, in the same ORDER (class; then id, or for a wall face wall and side) — which is
 * what lets `exportGlb`'s byte-for-byte determinism test hold: a row's
 * position is what a primitive's `EXT_mesh_features` feature id holds
 * (`render/export-graph.ts`, `app/export-gltf.ts`), so a re-export of the same document must lay the
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
import { FaceMap } from './types.js';
import { finishMaterialOf } from './finish-value.js';
import { documentLibraryOf } from './registries.js';
import type { SceneData, WallSide } from './types.js';
import type { SolvedPlan } from '../plan/plan-solver.js';

/** The exportable entity kinds; open on purpose (see the module header). */
export type ElementClass = 'wall' | 'wallFace' | 'floor' | 'ceiling' | 'opening' | 'furniture' | 'room';

/** The optional cross-reference and value fields every row may carry. */
type RowFields = {
  readonly roomId?: string;
  readonly wallId?: string;
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

/**
 * A row for an entity the document holds a UUID for: `id` and `guid` are that
 * UUID, `ifcGuid` its IFC compression. The cross-reference fields (`roomId`,
 * `wallId`) name a RELATED entity, never the row's own id twice.
 */
export type EntityRow = RowFields & {
  readonly guid: string;
  readonly ifcGuid: string;
  readonly class: Exclude<ElementClass, 'wallFace'>;
  readonly id: string;
};

/**
 * A wall face: no id of its own, addressed by its wall and its side — every
 * side of a wall bounds exactly one face of the solved plan
 * (`plan/plan-graph.ts`, one half-edge per wall side). `roomId` names the room
 * the face is seen from and is absent on the facade.
 */
export type WallFaceRow = {
  readonly class: 'wallFace';
  readonly wallId: string;
  readonly side: WallSide;
  readonly roomId?: string;
  readonly finish?: string;
};

/**
 * One exportable element, ready to become a `EXT_structural_metadata`
 * property-table row.
 */
export type ElementRow = EntityRow | WallFaceRow;

/** Row order: class rank first, then `withinClass` (entities by id, faces by wall and side) — a total order, so the sort leaves no ties. */
const CLASS_ORDER: readonly ElementClass[] = ['wall', 'wallFace', 'floor', 'ceiling', 'opening', 'furniture', 'room'];

function classRank(elementClass: ElementClass): number {
  return CLASS_ORDER.indexOf(elementClass);
}

/** Ordinal string order: the same on every runtime and locale. */
function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Within one class: entities by id; faces by wall, then side — one face per wall side, so that is total. */
function withinClass(a: ElementRow, b: ElementRow): number {
  if (a.class === 'wallFace' && b.class === 'wallFace') return ordinal(a.wallId, b.wallId) || ordinal(a.side, b.side);
  if (a.class !== 'wallFace' && b.class !== 'wallFace') return a.id.localeCompare(b.id);
  return 0;
}

/** An entity row: its GUID is `id` itself, the entity's own UUID. */
function row(elementClass: EntityRow['class'], id: string, rest: RowFields = {}): EntityRow {
  return { guid: id, ifcGuid: ifcGuid(id), class: elementClass, id, ...rest };
}

/** The property-table columns, in the order the class declares them. */
type Column = keyof EntityRow | keyof WallFaceRow;

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
  for (const entry of scene.finishes?.faces ?? []) painted.set(entry, finishMaterialOf(entry.finish));
  for (const face of plan.faces.values()) {
    const finish = painted.get(face.key);
    rows.push({
      class: 'wallFace',
      wallId: face.wallId,
      side: face.side,
      ...(face.roomId === null ? {} : { roomId: face.roomId }),
      ...(finish === undefined ? {} : { finish }),
    });
  }

  for (const roomEntry of scene.rooms) {
    const override = scene.finishes?.rooms?.[roomEntry.id]?.floor;
    const finish = override === undefined ? roomEntry.floorMaterial : finishMaterialOf(override);
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

  rows.sort((a, b) => classRank(a.class) - classRank(b.class) || withinClass(a, b));
  return rows;
}

/** Every property of class `jeexElement`, in declaration order. */
const COLUMNS: readonly Column[] = [
  'guid',
  'ifcGuid',
  'class',
  'id',
  'roomId',
  'wallId',
  'side',
  'openingType',
  'assetId',
  'libraryId',
  'variantId',
  'finish',
];

/**
 * The value a cell holds when its row has none: the class property's `noData`.
 * No real value is ever empty (UUIDs, IFC GUIDs, `L`/`R`, opening types,
 * finish ids), so the sentinel never shadows data.
 */
const NO_DATA = '';

/** One STRING column as the extension stores it: UTF-8 `values` and `count + 1` UINT32 `stringOffsets`. */
function stringColumn(cells: readonly string[]): { values: Uint8Array; stringOffsets: Uint8Array } {
  const encoder = new TextEncoder();
  const encoded = cells.map((cell) => encoder.encode(cell));
  const values = new Uint8Array(encoded.reduce((sum, bytes) => sum + bytes.byteLength, 0));
  const stringOffsets = new Uint8Array((cells.length + 1) * 4);
  const offsets = new DataView(stringOffsets.buffer);
  let cursor = 0;
  encoded.forEach((bytes, rowIndex) => {
    offsets.setUint32(rowIndex * 4, cursor, true);
    values.set(bytes, cursor);
    cursor += bytes.byteLength;
  });
  offsets.setUint32(cells.length * 4, cursor, true);
  return { values, stringOffsets };
}

/**
 * The `EXT_structural_metadata` root extension object for `rows`, and the
 * binary blocks its property table points at.
 *
 * Written against the extension's text (a Cesium vendor extension, draft
 * status: the CesiumGS glTF repository, branch `3d-tiles-next`,
 * `extensions/2.0/Vendor/EXT_structural_metadata`). One schema (version
 * `"2"`; the inline-array shape before it had none), one class
 * (`jeexElement`), one property table. Every property is a `STRING` stored in
 * binary: a UTF-8 `values` block and a `stringOffsets` block of `count + 1`
 * UINT32 offsets. `class` is required; every other property is optional with
 * `noData: ""`, the value a row without it holds (a wall face's `guid`,
 * `ifcGuid` and `id`, a facade face's `roomId`). An optional property with no
 * value in any row stays declared but is left out of the table (a reader reads
 * an absent optional property as all `noData`; a zero-length bufferView is not
 * valid glTF). A table needs at least one row, so `rows = []` gives the schema
 * alone.
 *
 * `blocks[k]` is meant to become bufferView `firstBufferView + k`; the
 * table's `values`/`stringOffsets` already name those indexes. Placing the
 * blocks (alignment, the binary chunk) is the GLB writer's job.
 */
export function structuralMetadataExtension(
  rows: readonly ElementRow[],
  firstBufferView: number,
): { extension: Record<string, unknown>; blocks: Uint8Array[] } {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const name of COLUMNS) {
    properties[name] = name === 'class' ? { type: 'STRING', required: true } : { type: 'STRING', required: false, noData: NO_DATA };
  }
  const schema = { id: 'jeexViewerElementSchema', version: '2', classes: { jeexElement: { name: 'JEEX scene element', properties } } };
  if (rows.length === 0) return { extension: { schema }, blocks: [] };

  const blocks: Uint8Array[] = [];
  const stored: Record<string, Record<string, unknown>> = {};
  for (const name of COLUMNS) {
    const cells = rows.map((entry) => (entry as Partial<Record<Column, string>>)[name] ?? NO_DATA);
    if (name !== 'class' && cells.every((cell) => cell === NO_DATA)) continue;
    const { values, stringOffsets } = stringColumn(cells);
    stored[name] = {
      values: firstBufferView + blocks.length,
      stringOffsets: firstBufferView + blocks.length + 1,
      stringOffsetType: 'UINT32',
    };
    blocks.push(values, stringOffsets);
  }
  return {
    extension: { schema, propertyTables: [{ name: 'jeexElements', class: 'jeexElement', count: rows.length, properties: stored }] },
    blocks,
  };
}
