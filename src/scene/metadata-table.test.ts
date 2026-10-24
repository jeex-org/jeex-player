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

describe('structuralMetadataExtension', () => {
  test('one class jeexElement and one property table sized to the rows', () => {
    const rows = metadataTable(lShapePlan, plan);
    const extension = structuralMetadataExtension(rows) as {
      schema: { classes: { jeexElement: unknown } };
      propertyTables: Array<{ count: number }>;
    };
    expect(extension.schema.classes.jeexElement).toBeTruthy();
    expect(extension.propertyTables[0]?.count).toBe(rows.length);
  });

  test('the face columns are wallId and side; there is no faceId column', () => {
    const extension = structuralMetadataExtension(metadataTable(lShapePlan, plan)) as {
      schema: { classes: { jeexElement: { properties: Record<string, unknown> } } };
      propertyTables: Array<{ properties: Record<string, unknown> }>;
    };
    const declared = Object.keys(extension.schema.classes.jeexElement.properties);
    expect(declared).toContain('side');
    expect(declared).not.toContain('faceId');
    expect(Object.keys(extension.propertyTables[0]!.properties)).toEqual(declared);
  });

  test('the id columns are optional and null exactly at the wall-face rows', () => {
    const rows = metadataTable(lShapePlan, plan);
    const extension = structuralMetadataExtension(rows) as {
      schema: { classes: { jeexElement: { properties: Record<string, { required?: boolean }> } } };
      propertyTables: Array<{ properties: Record<string, Array<string | null>> }>;
    };
    const declared = extension.schema.classes.jeexElement.properties;
    const columns = extension.propertyTables[0]!.properties;
    for (const key of ['guid', 'ifcGuid', 'id']) {
      expect({ key, required: declared[key]?.required }).toEqual({ key, required: false });
      rows.forEach((row, index) => {
        expect({ key, index, isNull: columns[key]![index] === null }).toEqual({ key, index, isNull: row.class === 'wallFace' });
      });
    }
    expect(declared['class']?.required).toBeUndefined();
  });

  test('an empty table still produces a valid shape', () => {
    const extension = structuralMetadataExtension([]) as { propertyTables: Array<{ count: number }> };
    expect(extension.propertyTables[0]?.count).toBe(0);
  });
});
