import { describe, expect, test } from 'bun:test';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { ifcGuid } from '../shared/uuid.js';
import { metadataTable, structuralMetadataExtension, type ElementRow, type EntityRow } from './metadata-table.js';
import type { SceneData } from './types.js';
import { ARCHETYPE } from '../assets/catalogue-ids.js';

const plan = solvePlan(lShapePlan);

/** The rows that carry an id: every class but `wallFace`. */
function entities(rows: readonly ElementRow[]): EntityRow[] {
  return rows.filter((row): row is EntityRow => row.class !== 'wallFace');
}

describe('metadataTable', () => {
  test('one row per wall, face, room, opening and asset', () => {
    const rows = metadataTable(lShapePlan, plan);
    const byClass = (cls: EntityRow['class']): EntityRow[] => entities(rows).filter((row) => row.class === cls);

    expect(
      byClass('wall')
        .map((row) => row.id)
        .sort(),
    ).toEqual([...lShapePlan.walls].map((wall) => wall.id).sort());
    expect(
      byClass('room')
        .map((row) => row.id)
        .sort(),
    ).toEqual(lShapePlan.rooms.map((room) => room.id).sort());
    expect(
      byClass('furniture')
        .map((row) => row.id)
        .sort(),
    ).toEqual(lShapePlan.assets.map((asset) => asset.id).sort());
    const openingIds = lShapePlan.walls.flatMap((wall) => (wall.openings ?? []).map((opening) => opening.id));
    expect(
      byClass('opening')
        .map((row) => row.id)
        .sort(),
    ).toEqual(openingIds.sort());
    expect(rows.filter((row) => row.class === 'wallFace').length).toBe(plan.faces.size);
  });

  test('an entity row is keyed by its own UUID, and ifcGuid is that UUID compressed', () => {
    const rows = metadataTable(lShapePlan, plan);
    for (const row of rows.filter((candidate) => candidate.class !== 'wallFace')) {
      expect(row.guid).toBe(row.id);
      expect(row.ifcGuid).toBe(ifcGuid(row.id));
    }
    expect(rows.find((row) => row.class === 'wall' && row.id === L_SHAPE.wall.wSA)).toBeDefined();
    expect(rows.find((row) => row.class === 'room' && row.id === L_SHAPE.room.a)).toBeDefined();
    expect(rows.find((row) => row.class === 'furniture' && row.id === L_SHAPE.asset.sofa)).toBeDefined();
    expect(rows.find((row) => row.class === 'opening' && row.id === L_SHAPE.opening.doorEntry)).toBeDefined();
  });

  test('a wall-face row has no id of its own: it is addressed by its wall and side, and names its room', () => {
    const rows = metadataTable(lShapePlan, plan);
    const faceRows = rows.filter((candidate) => candidate.class === 'wallFace');
    expect(faceRows.length).toBe(plan.faces.size);
    for (const row of faceRows) {
      expect('guid' in row).toBe(false);
      expect('ifcGuid' in row).toBe(false);
      expect('id' in row).toBe(false);
    }
    for (const face of plan.faces.values()) {
      const matches = faceRows.filter(
        (candidate) => candidate.wallId === face.wallId && candidate.side === face.side && candidate.roomId === (face.roomId ?? undefined),
      );
      expect(matches.length).toBe(1);
      expect('roomId' in matches[0]!).toBe(face.roomId !== null);
    }
  });

  test('no row carries an id the viewer derived: every guid is a UUID v7 the document already holds', () => {
    const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const row of metadataTable(lShapePlan, plan)) {
      if ('guid' in row) expect(row.guid).toMatch(V7);
    }
  });

  test('a painted face carries its finish', () => {
    const face = [...plan.faces.values()].find(
      (candidate) => candidate.wallId === L_SHAPE.wall.wPart && candidate.roomId === L_SHAPE.room.a,
    )!;
    const painted: SceneData = { ...lShapePlan, finishes: { faces: [{ ...face.key, finish: FINISH.sage }] } };
    const row = metadataTable(painted, solvePlan(painted)).find(
      (candidate) =>
        candidate.class === 'wallFace' &&
        candidate.wallId === face.wallId &&
        candidate.side === face.side &&
        candidate.roomId === face.roomId,
    )!;
    expect(row.finish).toBe(FINISH.sage);
  });

  test('the order is deterministic: class, then id, on every call', () => {
    const first = metadataTable(lShapePlan, plan);
    const second = metadataTable(lShapePlan, plan);
    expect(second).toEqual(first);
    // Sorted within a class.
    const wallIds = entities(first)
      .filter((row) => row.class === 'wall')
      .map((row) => row.id);
    expect(wallIds).toEqual([...wallIds].sort());
  });

  test('face rows are ordered by wall, then side, and no two share a wall side', () => {
    const faceRows = metadataTable(lShapePlan, plan).filter((row) => row.class === 'wallFace');
    const address = (row: (typeof faceRows)[number]): string => `${row.wallId}/${row.side}`;
    const addresses = faceRows.map((row) => address(row));
    expect(addresses).toEqual([...addresses].sort());
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  test('cross-references: an opening names its wall and type; a face names its wall and room', () => {
    const rows = metadataTable(lShapePlan, plan);
    const door = entities(rows).find((row) => row.class === 'opening' && row.id === L_SHAPE.opening.doorEntry)!;
    expect(door.wallId).toBe(L_SHAPE.wall.wSA);
    expect(door.openingType).toBe('door');

    const interiorFace = rows.find((row) => row.class === 'wallFace' && row.wallId === L_SHAPE.wall.wPart && row.roomId !== undefined)!;
    expect(interiorFace.roomId === L_SHAPE.room.a || interiorFace.roomId === L_SHAPE.room.b).toBe(true);

    const furniture = entities(rows).find((row) => row.class === 'furniture' && row.id === L_SHAPE.asset.table)!;
    expect(furniture.variantId).toBeUndefined();
  });

  test('a furniture row names its bare asset and the library it belongs to: its own, else the document one, never the built-in bank', () => {
    const own = '01a12ff9-0b10-7c4e-8a2d-5e1f3b6c9d07';
    const shared = '01a12ff9-0b11-7f58-9c3b-2d4e6a8f0b19';
    const scene: SceneData = {
      ...lShapePlan,
      assets: [
        { ...lShapePlan.assets[0]!, asset: ARCHETYPE.sofa_3s, library: own },
        { ...lShapePlan.assets[1]!, asset: ARCHETYPE.table_dining },
      ],
    };
    const furniture = (id: string): EntityRow | undefined =>
      entities(metadataTable(scene, plan)).find((row) => row.class === 'furniture' && row.id === id);

    expect(furniture(L_SHAPE.asset.sofa)).toMatchObject({ assetId: ARCHETYPE.sofa_3s, libraryId: own });
    expect(furniture(L_SHAPE.asset.table)).toMatchObject({ assetId: ARCHETYPE.table_dining });
    expect(furniture(L_SHAPE.asset.table)?.libraryId).toBeUndefined();

    const inLibrary = entities(metadataTable({ ...scene, assetLibrary: shared }, plan));
    expect(inLibrary.find((row) => row.id === L_SHAPE.asset.table)?.libraryId).toBe(shared);
    expect(inLibrary.find((row) => row.id === L_SHAPE.asset.sofa)?.libraryId).toBe(own);
  });
});

type ClassProperty = { type: string; required?: boolean; noData?: string };
type TableProperty = { values: number; stringOffsets: number; stringOffsetType: string };
type Written = {
  extension: {
    schema: { id: string; version: string; classes: { jeexElement: { properties: Record<string, ClassProperty> } } };
    propertyTables?: Array<{ name: string; class: string; count: number; properties: Record<string, TableProperty> }>;
  };
  blocks: Uint8Array[];
};

const COLUMNS = [
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

/** A STRING column read back the way the extension says: UINT32 offsets into UTF-8 values, `noData` read as absent. */
function decode(written: Written, firstBufferView: number, name: string): Array<string | undefined> {
  const table = written.extension.propertyTables![0]!;
  const stored = table.properties[name]!;
  const values = written.blocks[stored.values - firstBufferView]!;
  const offsetBytes = written.blocks[stored.stringOffsets - firstBufferView]!;
  const offsets = new DataView(offsetBytes.buffer, offsetBytes.byteOffset, offsetBytes.byteLength);
  const noData = written.extension.schema.classes.jeexElement.properties[name]!.noData;
  return Array.from({ length: table.count }, (_, row) => {
    const text = new TextDecoder().decode(values.subarray(offsets.getUint32(row * 4, true), offsets.getUint32(row * 4 + 4, true)));
    return noData !== undefined && text === noData ? undefined : text;
  });
}

describe('structuralMetadataExtension', () => {
  test('one class jeexElement, schema version 2, and one property table sized to the rows', () => {
    const rows = metadataTable(lShapePlan, plan);
    const { extension } = structuralMetadataExtension(rows, 0) as Written;
    expect(extension.schema.id).toBe('jeexViewerElementSchema');
    expect(extension.schema.version).toBe('2');
    expect(extension.propertyTables?.[0]).toMatchObject({ name: 'jeexElements', class: 'jeexElement', count: rows.length });
  });

  test('class is required with no noData; every other property is optional with noData ""; there is no faceId', () => {
    const { extension } = structuralMetadataExtension(metadataTable(lShapePlan, plan), 0) as Written;
    const declared = extension.schema.classes.jeexElement.properties;
    expect(Object.keys(declared)).toEqual(COLUMNS);
    expect(declared['class']).toEqual({ type: 'STRING', required: true });
    for (const name of COLUMNS.filter((column) => column !== 'class'))
      expect({ name, ...declared[name] }).toEqual({ name, type: 'STRING', required: false, noData: '' });
  });

  test('every column decodes from its binary blocks back to the rows; a wall face has no id', () => {
    const rows = metadataTable(lShapePlan, plan);
    const written = structuralMetadataExtension(rows, 7) as Written;
    const table = written.extension.propertyTables![0]!;
    for (const name of COLUMNS) {
      const expected = rows.map((row) => (row as Partial<Record<string, string>>)[name]);
      if (expected.every((cell) => cell === undefined)) {
        expect({ name, written: name in table.properties }).toEqual({ name, written: false });
        continue;
      }
      expect({ name, cells: decode(written, 7, name) }).toEqual({ name, cells: expected });
    }
    rows.forEach((row, index) => {
      if (row.class === 'wallFace') expect(decode(written, 7, 'id')[index]).toBeUndefined();
    });
  });

  test('each property is a values block and exactly count + 1 UINT32 offsets, numbered from the first bufferView given', () => {
    const rows = metadataTable(lShapePlan, plan);
    const written = structuralMetadataExtension(rows, 7) as Written;
    const properties = Object.values(written.extension.propertyTables![0]!.properties);
    expect(properties.flatMap((property) => [property.values, property.stringOffsets])).toEqual(
      written.blocks.map((_, index) => 7 + index),
    );
    for (const property of properties) {
      expect(property.stringOffsetType).toBe('UINT32');
      const offsets = written.blocks[property.stringOffsets - 7]!;
      expect(offsets.byteLength).toBe((rows.length + 1) * 4);
      const last = new DataView(offsets.buffer, offsets.byteOffset).getUint32(rows.length * 4, true);
      expect(last).toBe(written.blocks[property.values - 7]!.byteLength);
    }
  });

  test('string offsets count UTF-8 bytes, not characters', () => {
    const id = L_SHAPE.wall.wE;
    const rows: ElementRow[] = [{ guid: id, ifcGuid: ifcGuid(id), class: 'wall', id, finish: 'oak-\u00E9' }];
    const written = structuralMetadataExtension(rows, 0) as Written;
    const finish = written.extension.propertyTables![0]!.properties['finish']!;
    expect(written.blocks[finish.values]!.byteLength).toBe(6);
    expect(decode(written, 0, 'finish')).toEqual(['oak-\u00E9']);
  });

  test('an optional column with no value in any row is left out of the table but stays declared', () => {
    const rows: ElementRow[] = [{ guid: L_SHAPE.wall.wE, ifcGuid: ifcGuid(L_SHAPE.wall.wE), class: 'wall', id: L_SHAPE.wall.wE }];
    const written = structuralMetadataExtension(rows, 0) as Written;
    expect(Object.keys(written.extension.propertyTables![0]!.properties)).toEqual(['guid', 'ifcGuid', 'class', 'id']);
    expect(Object.keys(written.extension.schema.classes.jeexElement.properties)).toEqual(COLUMNS);
    expect(written.blocks.every((block) => block.byteLength > 0)).toBe(true);
  });

  test('a document with no element gets the schema and no property table', () => {
    const written = structuralMetadataExtension([], 0) as Written;
    expect(written.extension.schema.version).toBe('2');
    expect(written.extension.propertyTables).toBeUndefined();
    expect(written.blocks).toEqual([]);
  });
});
