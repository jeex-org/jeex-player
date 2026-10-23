import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { describe, expect, test } from 'bun:test';
import { draftOf } from '../shared/committed.js';
import { bayPlan, lShapePlan } from '../fixtures/plan-l-shape.js';
import type { MaterialDefinition, PlanNode, Room, SceneData, Wall } from './types.js';
import type { Draft } from '../shared/committed.js';
import type { InteriorPreset } from './scene-ops.js';
import { WALL_LIMITS, validateScene } from './scene-validator.js';
import { SceneValidationError, ViewerLibError, boundDocumentText } from '../shared/errors.js';
import type { Logger } from '../shared/logger.js';
import { collectLogger } from '../fixtures/stubs.js';
import { solvePlan } from '../plan/plan-solver.js';
import { floorOutline } from '../plan/floor-outline.js';
import { BAY, L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { ARCHETYPE, OPENING_VARIANT, VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { LIBRARY_FINISH as LIB, LIBRARY_REGISTRIES } from '../fixtures/library-finishes.js';
import { SceneModel } from './scene-model.js';

const NODE = L_SHAPE.node;
const WALL = L_SHAPE.wall;
const OPENING = L_SHAPE.opening;
const ROOM = L_SHAPE.room;
const ASSET = L_SHAPE.asset;

/** Ids this file adds to the fixtures: entities the fixtures do not have. */
const EXTRA = {
  missingNode: '01a12ff3-28bf-771d-bfac-f0a9cb1028ec',
  missingRoom: '01a12ff3-28c0-7c0f-b170-1ed98a0bc1ce',
  scannedRoom: '01a12ff3-28c1-718a-b0d1-c9b6eefa7147',
  ghostRoom: '01a12ff3-28c2-7f5a-bfdb-7375d6552195',
  danglingNode: '01a12ff3-28c3-7bc9-8a26-23df90ffa0a6',
  stubWall: '01a12ff3-28c4-7cc2-a57b-62fbc1b6db55',
  preset: '01a12ff3-28c5-7e4a-a939-288b533ba66c',
  farNodeA: '01a12ff3-28c6-76a1-b99a-a1985aa8ede0',
  farNodeB: '01a12ff3-28c7-701e-b062-dfae139291a4',
  farWall: '01a12ff3-28c8-7a2b-a599-d9d452ed3135',
  ghostAsset: '01a12ff3-28c9-7705-9e25-3038a16efdec',
  ghostOpening: '01a12ff3-28ca-778c-8b58-854caab279f2',
  material: '01a12ff3-28cb-7b9f-9985-3490d4b70495',
  ghostLibrary: '01a12ff3-28cc-7d41-a8e3-5f0c2b9d4e17',
} as const;

/** A well-formed UUID of the wrong version (v4): the grammar refuses it. */
const V4_UUID = '3b241101-e2bb-4255-8caf-4136c566a962';

/** A finish id no catalogue knows. */
const UNKNOWN_FINISH = 'unobtanium';

/** Look walls up by id — index-based access breaks whenever a fixture grows. */
function wallById(scene: Draft<SceneData>, id: string): Draft<Wall> {
  const wall = scene.walls.find((candidate) => candidate.id === id);
  if (!wall) throw new Error(`fixture has no wall ${id}`);
  return wall;
}

function nodeById(scene: Draft<SceneData>, id: string): Draft<PlanNode> {
  const node = scene.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`fixture has no node ${id}`);
  return node;
}

function roomById(scene: Draft<SceneData>, id: string): Draft<Room> {
  const room = scene.rooms.find((candidate) => candidate.id === id);
  if (!room) throw new Error(`fixture has no room ${id}`);
  return room;
}

/**
 * `validateScene` with a sink of its own; returns what it said.
 *
 * The validator reports a point outside every room through the `Logger` it is
 * handed (`shared/logger.ts`), so a test collects the warnings by INJECTING one
 * rather than by patching the process console.
 */
function warningsOf(run: (log: Logger) => void): string[] {
  const collected = collectLogger();
  run(collected.log);
  return collected.messages();
}

/** The error `run` throws, typed as the one thing the validator may raise. */
function errorOf(run: () => void): SceneValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof SceneValidationError) return error;
    throw error;
  }
  throw new Error('expected a SceneValidationError');
}

/** Message of the error `run` throws, or `''` when it does not throw. */
function messageOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

describe('scene validator — happy path', () => {
  test('accepts the L-shape fixture and returns the very object it was given', () => {
    expect(validateScene(lShapePlan, CATALOGUE_REGISTRIES)).toBe(lShapePlan);
  });

  test('accepts the semicircular bay fixture', () => {
    expect(validateScene(bayPlan, CATALOGUE_REGISTRIES)).toBe(bayPlan);
  });

  test('emits no warnings for the fixtures', () => {
    expect(warningsOf((log) => validateScene(lShapePlan, CATALOGUE_REGISTRIES, log))).toEqual([]);
    expect(warningsOf((log) => validateScene(bayPlan, CATALOGUE_REGISTRIES, log))).toEqual([]);
  });

  test('prefixes every failure with "Scene validation failed:"', () => {
    expect(messageOf(() => validateScene(null, CATALOGUE_REGISTRIES))).toStartWith('Scene validation failed:');
    const invalid = draftOf(lShapePlan);
    wallById(invalid, WALL.wPart).thickness = 0.7;
    expect(messageOf(() => validateScene(invalid, CATALOGUE_REGISTRIES))).toStartWith('Scene validation failed:');
  });
});

describe('scene validator — schema version', () => {
  test.each(['1.0', '1.1', '1.2'])('refuses a %s document: its ids are not UUIDs, and nothing migrates them', (version) => {
    const invalid = { ...draftOf(lShapePlan), schemaVersion: version };
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('schema-version-1x');
    expect(error.path).toBe('schemaVersion');
    expect(error.message).toContain('schemaVersion must be 2.x');
    expect(error.message).not.toContain('README');
  });

  test('rejects a version this build does not know', () => {
    const invalid = { ...draftOf(lShapePlan), schemaVersion: '2.4' };
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('schema-version-unsupported');
    expect(error.message).toContain("expected '2.2' or '2.3'");
    expect(error.detail).toEqual({ schemaVersion: '2.4' });
  });

  test('reads a 2.3 document as it reads 2.2', () => {
    const scene: SceneData = { ...draftOf(lShapePlan), schemaVersion: '2.3' };
    expect(validateScene(scene, CATALOGUE_REGISTRIES)).toBe(scene);
  });

  test.each(['2.0', '2.1'])('refuses a %s document: its asset references are composite strings, and nothing converts them', (version) => {
    const invalid = { ...draftOf(lShapePlan), schemaVersion: version };
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('schema-version-unsupported');
    expect(error.detail).toEqual({ schemaVersion: version });
  });

  test('accepts a document that declares neither units nor storey', () => {
    const scene = draftOf(lShapePlan);
    delete (scene as { units?: unknown }).units;
    delete (scene as { storey?: unknown }).storey;
    expect(warningsOf((log) => validateScene(scene, CATALOGUE_REGISTRIES, log))).toEqual([]);
  });
});

describe('scene validator — site orientation (schema 2.3)', () => {
  const withSite = (site: unknown, schemaVersion = '2.3'): unknown => ({ ...draftOf(lShapePlan), schemaVersion, site });

  test('accepts a site with north and a preset, a site with either, and an empty site', () => {
    for (const site of [{ northDeg: 30, sun: 'evening' }, { northDeg: -400.5 }, { sun: 'morning' }, {}]) {
      const scene = withSite(site);
      expect(validateScene(scene, CATALOGUE_REGISTRIES)).toBe(scene as SceneData);
    }
  });

  test('a 2.2 document without a site validates as before', () => {
    expect(validateScene(lShapePlan, CATALOGUE_REGISTRIES)).toBe(lShapePlan);
  });

  test.each([
    ['an unknown key', { north_deg: 30 }, 'site.north_deg'],
    ['a NaN north', { northDeg: Number.NaN }, 'site.northDeg'],
    ['an infinite north', { northDeg: Number.POSITIVE_INFINITY }, 'site.northDeg'],
    ['a string north', { northDeg: '30' }, 'site.northDeg'],
    ['an unknown preset', { sun: 'night' }, 'site.sun'],
    ['null', null, 'site'],
    ['an array', [], 'site'],
    ['a number', 5, 'site'],
  ])('refuses %s, naming the field', (_name, site, path) => {
    const error = errorOf(() => validateScene(withSite(site), CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('site-invalid');
    expect(error.path).toBe(path);
    expect(error.message).toContain(path);
  });

  test('refuses a site in a 2.2 document, naming the field and the version', () => {
    const error = errorOf(() => validateScene(withSite({ northDeg: 0 }, '2.2'), CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('site-invalid');
    expect(error.path).toBe('site');
    expect(error.message).toContain('2.3');
    expect(error.message).toContain('2.2');
  });
});

describe('scene validator — nodes and wall references', () => {
  test('rejects a scene without plan nodes', () => {
    const invalid = { ...draftOf(lShapePlan), nodes: [] };
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow('Scene needs at least three plan nodes');
  });

  test('rejects duplicate node ids', () => {
    const invalid = draftOf(lShapePlan);
    nodeById(invalid, NODE.n3).id = NODE.n2;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Duplicate id ${NODE.n2}: already used by a plan node`);
  });

  test('rejects a node with non-finite coordinates', () => {
    const invalid = draftOf(lShapePlan);
    nodeById(invalid, NODE.n3).p = { x: Number.NaN, z: 0 };
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Plan node ${NODE.n3} has invalid coordinates`);
  });

  test('rejects a wall pointing at a node that does not exist', () => {
    const invalid = draftOf(lShapePlan);
    wallById(invalid, WALL.wPart).b = EXTRA.missingNode;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Wall ${WALL.wPart} references unknown node ${EXTRA.missingNode}`);
  });

  test('rejects a wall whose ends are the same node', () => {
    const invalid = draftOf(lShapePlan);
    wallById(invalid, WALL.wPart).b = wallById(invalid, WALL.wPart).a;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Wall ${WALL.wPart} starts and ends at node ${NODE.n2}`);
  });

  test('one namespace across every kind: a tour checkpoint may not take a room id, nor anything the scene id', () => {
    const checkpoint = { id: ROOM.a, position: { x: 2, y: 1.6, z: 3 }, yaw: 0, pitch: 0 };
    const onRoom = { ...draftOf(lShapePlan), tourCheckpoints: [checkpoint] };
    expect(() => validateScene(onRoom, CATALOGUE_REGISTRIES)).toThrow(`Duplicate id ${ROOM.a}: already used by a room`);
    const onScene = draftOf(lShapePlan);
    nodeById(onScene, NODE.n3).id = onScene.id;
    expect(() => validateScene(onScene, CATALOGUE_REGISTRIES)).toThrow(`Duplicate id ${onScene.id}: already used by a scene`);
  });

  test('rejects duplicate wall ids', () => {
    const invalid = draftOf(lShapePlan);
    wallById(invalid, WALL.wSB).id = WALL.wSA;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Duplicate id ${WALL.wSA}: already used by a wall`);
  });
});

describe('scene validator — thickness and centreline length', () => {
  const RANGE = `${WALL_LIMITS.minThickness}..${WALL_LIMITS.maxThickness} m`;

  test('rejects a wall thicker than the maximum', () => {
    const invalid = draftOf(lShapePlan);
    const thickness = WALL_LIMITS.maxThickness + 0.1;
    wallById(invalid, WALL.wPart).thickness = thickness;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(
      `Wall ${WALL.wPart} thickness ${thickness} is outside the allowed range ${RANGE}`,
    );
  });

  test('rejects a wall thinner than the minimum', () => {
    const invalid = draftOf(lShapePlan);
    const thickness = WALL_LIMITS.minThickness - 0.01;
    wallById(invalid, WALL.wPart).thickness = thickness;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(
      `Wall ${WALL.wPart} thickness ${thickness} is outside the allowed range ${RANGE}`,
    );
  });

  test('accepts a wall exactly at either end of the range', () => {
    for (const thickness of [WALL_LIMITS.minThickness, WALL_LIMITS.maxThickness]) {
      const scene = draftOf(lShapePlan);
      wallById(scene, WALL.wPart).thickness = thickness;
      expect(messageOf(() => validateScene(scene, CATALOGUE_REGISTRIES))).not.toContain('outside the allowed range');
    }
  });

  test('rejects a centreline shorter than the minimum', () => {
    const invalid = draftOf(lShapePlan);
    nodeById(invalid, NODE.n3).p = { x: 6.4, z: 0 };
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(
      `Wall ${WALL.wSB} centreline length 0.400 is below the minimum ${WALL_LIMITS.minCentrelineLength} m`,
    );
  });

  test('measures an arc centreline by arc length, not by its chord', () => {
    const scene = draftOf(bayPlan);
    wallById(scene, BAY.wall.bay).openings = [];
    nodeById(scene, BAY.node.b2).p = { x: 0.4, z: 0 };

    const straight = draftOf(scene);
    delete wallById(straight, BAY.wall.bay).arc;
    expect(() => validateScene(straight, CATALOGUE_REGISTRIES)).toThrow(
      `Wall ${BAY.wall.bay} centreline length 0.400 is below the minimum ${WALL_LIMITS.minCentrelineLength} m`,
    );

    // radius 0.21 over a 0.40 chord spans 0.533 m of arc — above the minimum.
    // The squashed plan puts most points outside its rooms, so mute the warnings.
    wallById(scene, BAY.wall.bay).arc = { radius: 0.21, ccw: false };
    let message = '';
    warningsOf((log) => {
      message = messageOf(() => validateScene(scene, CATALOGUE_REGISTRIES, log));
    });
    expect(message).not.toContain('centreline length');
  });

  test('rejects an arc radius below half of its chord', () => {
    const invalid = draftOf(bayPlan);
    wallById(invalid, BAY.wall.bay).arc = { radius: 1.5, ccw: false };
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(
      `Wall ${BAY.wall.bay} arc radius 1.5 is below half of its chord 2.000`,
    );
  });
});

describe('scene validator — openings', () => {
  test('rejects an opening that does not fit its wall', () => {
    const invalid = draftOf(lShapePlan);
    wallById(invalid, WALL.wSA).openings![0]!.center = 5.9;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Opening ${OPENING.doorEntry} does not fit inside wall ${WALL.wSA}`);
  });

  test('rejects a door with a raised sill', () => {
    const invalid = draftOf(lShapePlan);
    wallById(invalid, WALL.wPart).openings![0]!.sill = 0.2;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Door opening ${OPENING.doorAb} must start at the floor`);
  });

  test('rejects two openings that overlap on the same wall', () => {
    const invalid = draftOf(lShapePlan);
    wallById(invalid, WALL.wSA).openings![1]!.center = 2.0;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(
      `Openings ${OPENING.doorEntry} and ${OPENING.windowASouth} overlap on wall ${WALL.wSA}`,
    );
  });

  test('accepts an authored hinge and swing on a door', () => {
    const scene = draftOf(lShapePlan);
    Object.assign(wallById(scene, WALL.wPart).openings![0]!, { hinge: 'b', swing: 'out' });
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('rejects an unknown hinge and a swing on something that has no leaf', () => {
    const badHinge = draftOf(lShapePlan);
    Object.assign(wallById(badHinge, WALL.wPart).openings![0]!, { hinge: 'left' });
    expect(() => validateScene(badHinge, CATALOGUE_REGISTRIES)).toThrow(`Opening ${OPENING.doorAb} has unknown hinge left`);

    const onWindow = draftOf(lShapePlan);
    Object.assign(wallById(onWindow, WALL.wSA).openings![1]!, { swing: 'in' });
    expect(() => validateScene(onWindow, CATALOGUE_REGISTRIES)).toThrow(
      `Opening ${OPENING.windowASouth} is a window and cannot carry a swing`,
    );
  });
});

describe('scene validator — rooms and finishes', () => {
  test('rejects a floor material that no catalogue knows', () => {
    const invalid = draftOf(lShapePlan);
    roomById(invalid, ROOM.a).floorMaterial = UNKNOWN_FINISH;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(
      `Room ${ROOM.a} floor material references unknown finish ${UNKNOWN_FINISH}`,
    );
  });

  test('a scene-local override cannot stand in for a floor finish', () => {
    // `materials[]` adds object ids, not paintable surfaces: a floor still has
    // to resolve in the surface catalogue.
    const invalid = draftOf(lShapePlan);
    const material: MaterialDefinition = { id: EXTRA.material, name: 'Unobtanium', color: '#ff00ff', roughness: 0.5 };
    invalid.materials = [...(invalid.materials ?? []), material];
    roomById(invalid, ROOM.a).floorMaterial = EXTRA.material;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(
      `Room ${ROOM.a} floor material references unknown finish ${EXTRA.material}`,
    );
  });

  test('materials[] is optional: a scene without it still validates', () => {
    const scene = draftOf(lShapePlan);
    delete scene.materials;
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('an asset material resolves through either catalogue or a scene override', () => {
    const scene = draftOf(lShapePlan);
    delete scene.materials;
    // The fixture's asset materials are object-catalogue finishes, so they resolve with no materials[].
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
    const invalid = draftOf(lShapePlan);
    invalid.assets[0]!.material = UNKNOWN_FINISH;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Asset ${ASSET.sofa} references unknown material ${UNKNOWN_FINISH}`);
  });

  test('rejects a room with an invalid anchor', () => {
    const invalid = draftOf(lShapePlan);
    roomById(invalid, ROOM.a).anchor = { x: Number.POSITIVE_INFINITY, z: 4 };
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Room ${ROOM.a} has an invalid anchor`);
  });

  test('a room may carry the outline its source supplied, and then claims no graph face', () => {
    // Optional: the wall graph does not close around this room, so
    // it is solved from the polygon instead of from a face (`Room.polygon`).
    const scene = draftOf(lShapePlan);
    scene.rooms = [
      ...scene.rooms,
      {
        id: EXTRA.scannedRoom,
        name: 'Scanned room',
        anchor: { x: 40, z: 40 },
        floorMaterial: FINISH.oak,
        polygon: [
          { x: 38, z: 38 },
          { x: 42, z: 38 },
          { x: 42, z: 42 },
          { x: 38, z: 42 },
        ],
      },
    ];
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
    const solved = solvePlan(validateScene(scene, CATALOGUE_REGISTRIES));
    const room = solved.rooms.find((candidate) => candidate.roomId === EXTRA.scannedRoom)!;
    expect(room).toBeDefined();
    expect(room.polygon).toHaveLength(4);
    expect(room.loop).toHaveLength(0);
    // Its slab is that outline: no wall face to notch a doorway out of.
    expect(floorOutline(solved, validateScene(scene, CATALOGUE_REGISTRIES), EXTRA.scannedRoom)).toHaveLength(4);
  });

  test('refuses an outline that is not at least three finite points', () => {
    const invalid = draftOf(lShapePlan);
    roomById(invalid, ROOM.a).polygon = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
    ];
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('room-polygon-invalid');
    expect(error.path).toBe('rooms[0].polygon');
  });

  test('rejects room cameras pointing at missing rooms', () => {
    const invalid = draftOf(lShapePlan);
    invalid.roomCameras[EXTRA.missingRoom] = invalid.roomCameras[ROOM.a]!;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Room camera references unknown room ${EXTRA.missingRoom}`);
  });
});

describe('scene validator — painted finishes and opening types', () => {
  test('accepts finishes that resolve in the catalogue', () => {
    const scene = draftOf(lShapePlan);
    scene.finishes = {
      rooms: { [ROOM.a]: { floor: FINISH.walnut, walls: FINISH.sage } },
      faces: [{ room: ROOM.a, wallId: WALL.wPart, side: 'L', finish: FINISH.graphite }],
      facade: FINISH.terra,
    };
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('rejects a finish id that is not in the catalogue', () => {
    const invalid = draftOf(lShapePlan);
    invalid.finishes = { rooms: { [ROOM.a]: { walls: UNKNOWN_FINISH } } };
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(
      `Scene finishes room ${ROOM.a} walls references unknown finish ${UNKNOWN_FINISH}`,
    );
  });

  test('rejects finishes for a room that does not exist', () => {
    const invalid = draftOf(lShapePlan);
    invalid.finishes = { rooms: { [EXTRA.missingRoom]: { walls: FINISH.sage } } };
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Scene finishes reference unknown room ${EXTRA.missingRoom}`);
  });

  test('rejects an unknown facade or face finish', () => {
    const badFacade = draftOf(lShapePlan);
    badFacade.finishes = { facade: UNKNOWN_FINISH };
    expect(() => validateScene(badFacade, CATALOGUE_REGISTRIES)).toThrow(
      `Scene finishes facade references unknown finish ${UNKNOWN_FINISH}`,
    );
    const badFace = draftOf(lShapePlan);
    badFace.finishes = { faces: [{ room: ROOM.a, wallId: WALL.wPart, side: 'L', finish: UNKNOWN_FINISH }] };
    const error = errorOf(() => validateScene(badFace, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('finish-unknown');
    expect(error.path).toBe('finishes.faces[0].finish');
  });

  test('rejects a face entry naming a face the solved plan does not have', () => {
    // Room B does not own the L side of the partition: room A does.
    const invalid = draftOf(lShapePlan);
    invalid.finishes = { faces: [{ room: ROOM.b, wallId: WALL.wPart, side: 'L', finish: FINISH.sage }] };
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('finishes-unknown-face');
    expect(error.path).toBe('finishes.faces[0]');
    expect(error.detail).toEqual({ face: { room: ROOM.b, wallId: WALL.wPart, side: 'L' } });
  });

  test('rejects a face entry that is not shaped like a face key', () => {
    const invalid = draftOf(lShapePlan);
    invalid.finishes = { faces: [{ room: ROOM.a, wallId: WALL.wPart, side: 'X' as never, finish: FINISH.sage }] };
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('finishes-unknown-face');
    expect(error.detail).toEqual({ face: null });
  });

  test('rejects the same face listed twice', () => {
    const invalid = draftOf(lShapePlan);
    invalid.finishes = {
      faces: [
        { room: ROOM.a, wallId: WALL.wPart, side: 'L', finish: FINISH.sage },
        { room: ROOM.a, wallId: WALL.wPart, side: 'L', finish: FINISH.terra },
      ],
    };
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('finishes-duplicate-face');
    expect(error.path).toBe('finishes.faces[1]');
    expect(error.detail).toEqual({ first: 0 });
  });

  test('refuses a faces field that is not a list', () => {
    const invalid = draftOf(lShapePlan);
    (invalid as { finishes?: unknown }).finishes = { faces: {} };
    expect(errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES)).rule).toBe('finishes-faces-not-array');
  });

  test("accepts a 'passage' opening and holds it to the door invariants", () => {
    const scene = draftOf(lShapePlan);
    const partition = wallById(scene, WALL.wPart);
    partition.openings![0]!.type = 'passage';
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
    partition.openings![0]!.sill = 0.4;
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).toThrow(`Door opening ${OPENING.doorAb} must start at the floor`);
  });

  test('rejects an opening type outside the vocabulary', () => {
    const invalid = draftOf(lShapePlan);
    wallById(invalid, WALL.wPart).openings![0]!.type = 'hatch' as never;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow(`Opening ${OPENING.doorAb} has unknown type hatch`);
  });
});

describe('scene validator — topology via solvePlan', () => {
  test('rejects a dangling node and keeps the plan error code', () => {
    const invalid = draftOf(lShapePlan);
    invalid.nodes.push({ id: EXTRA.danglingNode, p: { x: -3, z: 4 } });
    invalid.walls.push({ id: EXTRA.stubWall, a: NODE.n7, b: EXTRA.danglingNode, thickness: 0.3 });
    const message = messageOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(message).toStartWith('Scene validation failed:');
    expect(message).toContain('[DANGLING_NODE]');
  });

  test('rejects two room anchors landing in the same graph face', () => {
    const invalid = draftOf(lShapePlan);
    invalid.rooms.push({ id: EXTRA.ghostRoom, name: 'Ghost room', anchor: { x: 2, z: 6 }, floorMaterial: FINISH.oak });
    const message = messageOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(message).toContain('[MULTI_ANCHOR]');
    expect(message).toContain('several room anchors');
  });

  test('rejects a graph face without a room anchor', () => {
    const invalid = draftOf(lShapePlan);
    roomById(invalid, ROOM.b).anchor = { x: 30, z: 30 };
    const message = messageOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(message).toContain('[NO_ANCHOR]');
  });
});

describe('scene validator — warnings, never errors', () => {
  test('warns about a navigation point outside every room and doorway', () => {
    const scene = draftOf(lShapePlan);
    scene.navigation.points.push({ x: 30, y: 0, z: 30 });
    const warnings = warningsOf((log) => expect(validateScene(scene, CATALOGUE_REGISTRIES, log)).toBe(scene));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('navigation point 3');
    expect(warnings[0]).toContain('outside every room and doorway');
  });

  test('warns about a room camera parked inside a wall', () => {
    const scene = draftOf(lShapePlan);
    scene.roomCameras[ROOM.b]!.position = { x: 6, y: 1.6, z: 0.5 };
    const warnings = warningsOf((log) => validateScene(scene, CATALOGUE_REGISTRIES, log));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain(`room camera ${ROOM.b}`);
  });

  test('warns about an autotour waypoint outside the plan', () => {
    const scene = draftOf(lShapePlan);
    scene.autotour.path.push({ x: -5, y: 1.6, z: -5 });
    const warnings = warningsOf((log) => validateScene(scene, CATALOGUE_REGISTRIES, log));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('autotour waypoint 4');
  });

  test('accepts points that sit in a doorway rather than in a room', () => {
    const scene = draftOf(lShapePlan);
    // (6, 2.5) is the centre of the A–B door on the 0.10 partition — no room contains it.
    scene.navigation.points = [{ x: 6, y: 0, z: 2.5 }];
    expect(warningsOf((log) => validateScene(scene, CATALOGUE_REGISTRIES, log))).toEqual([]);
  });
});

describe('scene validator — preserved scalar checks', () => {
  test('rejects a scene without required camera data', () => {
    const invalid = { ...draftOf(lShapePlan), presentationCamera: undefined };
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow('Scene camera and navigation data are required');
  });

  test('rejects assets referencing unknown materials', () => {
    const invalid = draftOf(lShapePlan);
    invalid.assets[0]!.material = UNKNOWN_FINISH;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow('references unknown material');
  });

  test('rejects a tour gaze pointing at a missing waypoint', () => {
    const invalid = draftOf(lShapePlan);
    invalid.autotour.gaze[0]!.at = 99;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow('gaze references an invalid waypoint');
  });

  test('rejects a tour speed zone with an invalid speed', () => {
    const invalid = draftOf(lShapePlan);
    invalid.autotour.zones![0]!.speed = 0;
    expect(() => validateScene(invalid, CATALOGUE_REGISTRIES)).toThrow('speed zone has an invalid speed');
  });
});

describe('asset references are checked against the object bank', () => {
  test('accepts the furniture type words the bank aliases', () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.type = 'armchair';
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('accepts an archetype UUID and a variant UUID as the type', () => {
    for (const type of [ARCHETYPE.sofa_3s, VARIANT.sofa_3s_boucle]) {
      const scene = draftOf(lShapePlan);
      scene.assets[0]!.type = type;
      expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
    }
  });

  test('rejects a type the catalogue does not know', () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.type = 'unobtanium-lounger';
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).toThrow(
      `Asset ${ASSET.sofa} references unknown catalogue asset unobtanium-lounger`,
    );
  });

  test('accepts a bare catalogue reference', () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.asset = ARCHETYPE.sofa_3s;
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('refuses a composite library:asset reference: schema 2.2 names the library in its own field', () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.asset = `starter:interior-v1:${ARCHETYPE.sofa_3s}`;
    const error = errorOf(() => validateScene(scene, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('asset-reference-invalid');
    expect(error.path).toBe('assets[0].asset');
  });

  test('rejects a catalogue reference to a nonexistent asset', () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.asset = EXTRA.ghostAsset;
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).toThrow(
      `Asset ${ASSET.sofa} references unknown catalogue asset ${EXTRA.ghostAsset}`,
    );
  });

  test("refuses a library that is not a UUID, the built-in bank's own id included", () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.asset = ARCHETYPE.sofa_3s;
    scene.assets[0]!.library = 'starter:interior-v1';
    const error = errorOf(() => validateScene(scene, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('asset-library-invalid');
    expect(error.path).toBe('assets[0].library');
  });

  test('refuses a library on a placement that names no asset', () => {
    const scene = draftOf(lShapePlan);
    delete scene.assets[0]!.asset;
    scene.assets[0]!.library = EXTRA.ghostLibrary;
    const error = errorOf(() => validateScene(scene, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('asset-library-without-asset');
    expect(error.path).toBe('assets[0].library');
  });

  test('refuses a library UUID the registries do not declare', () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.asset = ARCHETYPE.sofa_3s;
    scene.assets[0]!.library = EXTRA.ghostLibrary;
    const error = errorOf(() => validateScene(scene, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('asset-unknown-library');
    expect(error.message).toContain(`Asset ${ASSET.sofa} references unknown asset library ${EXTRA.ghostLibrary}`);
    expect(error.detail).toEqual({ library: EXTRA.ghostLibrary });
  });

  test('refuses a scene assetLibrary that is not a UUID', () => {
    const scene = { ...draftOf(lShapePlan), assetLibrary: 'starter:interior-v1' };
    const error = errorOf(() => validateScene(scene, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('scene-asset-library-invalid');
    expect(error.path).toBe('assetLibrary');
  });

  test('accepts a variant of the resolved archetype', () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.variant = VARIANT.sofa_3s_boucle;
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('rejects a variant that belongs to another archetype', () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.variant = VARIANT.armchair_velvet;
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).toThrow(`Asset ${ASSET.sofa} variant ${VARIANT.armchair_velvet}`);
  });

  test('rejects a variant no object in the bank declares', () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.variant = EXTRA.ghostAsset;
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).toThrow(`Asset ${ASSET.sofa} variant ${EXTRA.ghostAsset}`);
  });

  test('still rejects a non-string reference or variant', () => {
    const badRef = draftOf(lShapePlan);
    (badRef.assets[0] as { asset?: unknown }).asset = 7;
    expect(() => validateScene(badRef, CATALOGUE_REGISTRIES)).toThrow(`Asset ${ASSET.sofa} has an invalid catalogue reference`);
    const badVariant = draftOf(lShapePlan);
    (badVariant.assets[0] as { variant?: unknown }).variant = '';
    expect(() => validateScene(badVariant, CATALOGUE_REGISTRIES)).toThrow(`Asset ${ASSET.sofa} has an invalid variant`);
  });
});

describe('exactly one entrance door', () => {
  test('accepts a single entrance', () => {
    expect(() => validateScene(draftOf(lShapePlan), CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('rejects a second entrance door', () => {
    const scene = draftOf(lShapePlan);
    const other = wallById(scene, WALL.wPart).openings![0]!;
    other.entrance = true;
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).toThrow(
      `Opening ${OPENING.doorAb} is a second entrance door; the apartment already has ${OPENING.doorEntry}`,
    );
  });
});

describe('interior presets', () => {
  /** A sound three-op preset over the L-shape fixture. */
  function preset(): Draft<InteriorPreset> {
    return {
      id: EXTRA.preset,
      name: 'Warm walnut',
      swatch: [FINISH.walnut, FINISH.terra],
      ops: [
        { op: 'set_material', target: ROOM.a, material: FINISH.walnut },
        { op: 'set_material', target: ROOM.a, material: FINISH.terra },
        { op: 'replace_asset_variant', assetId: ASSET.sofa, variant: VARIANT.sofa_3s_boucle },
      ],
    };
  }

  function withPresets(presets: readonly Draft<InteriorPreset>[]): Draft<SceneData> {
    const scene = draftOf(lShapePlan);
    scene.interiors = [...presets];
    return scene;
  }

  test('accepts a scene whose presets apply cleanly', () => {
    const scene = withPresets([preset()]);
    expect(validateScene(scene, CATALOGUE_REGISTRIES)).toBe(scene);
  });

  test('accepts a scene without the field at all', () => {
    const scene = draftOf(lShapePlan);
    delete scene.interiors;
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
  });

  test('rejects a duplicate preset id', () => {
    const twice = withPresets([preset(), { ...preset(), name: 'Copy' }]);
    expect(() => validateScene(twice, CATALOGUE_REGISTRIES)).toThrow(`Duplicate id ${EXTRA.preset}: already used by a interior preset`);
  });

  test('rejects a preset id that collides with a room', () => {
    const clash = withPresets([{ ...preset(), id: ROOM.a }]);
    expect(() => validateScene(clash, CATALOGUE_REGISTRIES)).toThrow(`Duplicate id ${ROOM.a}: already used by a room`);
  });

  test('rejects an id that is not a UUID v7', () => {
    const bad = withPresets([{ ...preset(), id: 'Warm Look' }]);
    expect(() => validateScene(bad, CATALOGUE_REGISTRIES)).toThrow('interior preset id "Warm Look" is not a UUID v7');
  });

  test('rejects a preset without a name', () => {
    const bad = withPresets([{ ...preset(), name: '' }]);
    expect(() => validateScene(bad, CATALOGUE_REGISTRIES)).toThrow(`Interior preset ${EXTRA.preset} needs a name`);
  });

  test('rejects an unknown finish in the swatch', () => {
    const bad = withPresets([{ ...preset(), swatch: [FINISH.walnut, 'mauve'] }]);
    expect(() => validateScene(bad, CATALOGUE_REGISTRIES)).toThrow(
      `Interior preset ${EXTRA.preset} swatch wall references unknown finish mauve`,
    );
  });

  test('rejects a swatch whose halves are the wrong families', () => {
    const bad = withPresets([{ ...preset(), swatch: [FINISH.terra, FINISH.walnut] }]);
    expect(() => validateScene(bad, CATALOGUE_REGISTRIES)).toThrow(
      `Interior preset ${EXTRA.preset} swatch floor references ${FINISH.terra}, which is a wall finish, not a floor finish`,
    );
  });

  test('rejects a swatch that is not a pair', () => {
    const bad = withPresets([{ ...preset(), swatch: [FINISH.walnut] as unknown as [string, string] }]);
    expect(() => validateScene(bad, CATALOGUE_REGISTRIES)).toThrow(
      `Interior preset ${EXTRA.preset} needs a swatch of exactly two finish ids`,
    );
  });

  test('rejects a preset with no operations', () => {
    const bad = withPresets([{ ...preset(), ops: [] }]);
    expect(() => validateScene(bad, CATALOGUE_REGISTRIES)).toThrow(`Interior preset ${EXTRA.preset} needs at least one operation`);
  });

  test('rejects an operation on an unknown asset', () => {
    const bad = preset();
    bad.ops.push({ op: 'replace_asset_variant', assetId: EXTRA.ghostAsset, variant: VARIANT.sofa_3s_boucle });
    expect(() => validateScene(withPresets([bad]), CATALOGUE_REGISTRIES)).toThrow(
      `Interior preset ${EXTRA.preset} has an operation that cannot apply: Unknown asset ${EXTRA.ghostAsset}`,
    );
  });

  test('rejects an operation on an unknown room', () => {
    const bad = preset();
    bad.ops.push({ op: 'set_material', target: EXTRA.missingRoom, material: FINISH.oak });
    expect(() => validateScene(withPresets([bad]), CATALOGUE_REGISTRIES)).toThrow(
      `Interior preset ${EXTRA.preset} has an operation that cannot apply: Unknown set_material target ${EXTRA.missingRoom}`,
    );
  });

  test('rejects an operation naming a variant the asset does not offer', () => {
    const bad = preset();
    bad.ops.push({ op: 'replace_asset_variant', assetId: ASSET.table, variant: VARIANT.sofa_3s_boucle });
    expect(() => validateScene(withPresets([bad]), CATALOGUE_REGISTRIES)).toThrow(
      `Interior preset ${EXTRA.preset} has an operation that cannot apply: Variant ${VARIANT.sofa_3s_boucle} is not offered for asset ${ASSET.table}`,
    );
  });

  test('rejects an operation on an opening that does not exist', () => {
    const bad = preset();
    bad.ops.push({ op: 'replace_opening_variant', openingId: EXTRA.ghostOpening, variant: OPENING_VARIANT.door_glass_slim });
    expect(() => validateScene(withPresets([bad]), CATALOGUE_REGISTRIES)).toThrow(
      `Interior preset ${EXTRA.preset} has an operation that cannot apply: Unknown opening ${EXTRA.ghostOpening}`,
    );
  });

  test('the dry run leaves the scene it validated untouched', () => {
    const scene = withPresets([preset()]);
    validateScene(scene, CATALOGUE_REGISTRIES);
    expect(scene.finishes).toBeUndefined();
    expect(scene.assets.find((asset) => asset.id === ASSET.sofa)?.variant).toBeUndefined();
  });
});

describe('the coded shape of a validation failure', () => {
  test('is a SceneValidationError with the scene-invalid code', () => {
    const error = errorOf(() => validateScene(null, CATALOGUE_REGISTRIES));
    expect(error).toBeInstanceOf(ViewerLibError);
    expect(error.code).toBe('scene-invalid');
    expect(error.rule).toBe('scene-not-object');
  });

  test('names the rule, the JSON path and the numbers, for a wall out of range', () => {
    const invalid = draftOf(lShapePlan);
    const index = invalid.walls.findIndex((wall) => wall.id === WALL.wPart);
    wallById(invalid, WALL.wPart).thickness = 0.9;
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('wall-thickness-range');
    expect(error.path).toBe(`walls[${index}].thickness`);
    expect(error.detail).toEqual({ thickness: 0.9, min: WALL_LIMITS.minThickness, max: WALL_LIMITS.maxThickness });
  });

  test('points at the offending opening inside its wall', () => {
    const invalid = draftOf(lShapePlan);
    const wallIndex = invalid.walls.findIndex((wall) => wall.id === WALL.wSA);
    const wall = wallById(invalid, WALL.wSA);
    const openingIndex = wall.openings!.findIndex((opening) => opening.id === OPENING.doorEntry);
    wall.openings![openingIndex]!.width = 40;
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('opening-outside-wall');
    expect(error.path).toBe(`walls[${wallIndex}].openings[${openingIndex}].center`);
  });

  test('a plan the solver refuses keeps the plan code in detail', () => {
    const invalid = draftOf(lShapePlan);
    // A wall pair the rest of the plan cannot reach: every field is well formed,
    // so only the SOLVER can refuse it.
    invalid.nodes.push({ id: EXTRA.farNodeA, p: { x: 90, z: 90 } }, { id: EXTRA.farNodeB, p: { x: 92, z: 90 } });
    invalid.walls.push({ id: EXTRA.farWall, a: EXTRA.farNodeA, b: EXTRA.farNodeB, thickness: 0.1 });
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('plan-unsolvable');
    expect(typeof (error.detail as { planCode?: unknown }).planCode).toBe('string');
  });

  /**
   * A scene can be fetched from an address the EMBEDDER chose, and the
   * refusal's sentence travels back to that embedder through the frame bridge:
   * the refused value may be quoted only as a short prefix, and never as a url.
   * The rule and the path, the machine-readable half, are unchanged.
   */
  test('a refusal quotes no url from the document and no more than a short prefix of a long value', () => {
    const invalid = draftOf(lShapePlan);
    roomById(invalid, ROOM.a).id = `see https://intranet.example/hr/salaries.json ${'S'.repeat(400)}`;
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('id-invalid');
    expect(error.path).toMatch(/^rooms\[\d+]\.id$/);
    for (const text of [error.message, JSON.stringify(error.detail)]) {
      expect(text).not.toContain('intranet.example');
      expect(text).toContain('<url>');
      expect(text).not.toContain('S'.repeat(40));
      expect(text).toContain(`${'S'.repeat(31)}…`);
    }
    expect(error.message.length).toBeLessThanOrEqual(300);
  });

  test('an unknown reference is bounded the same way, in the sentence and in detail', () => {
    const invalid = draftOf(lShapePlan);
    const reference = `//intranet.example/${'r'.repeat(200)}`;
    invalid.finishes = { rooms: { [reference]: { floor: FINISH.oak } } };
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('finishes-unknown-room');
    expect(`${error.message} ${error.path ?? ''} ${JSON.stringify(error.detail)}`).not.toContain('intranet.example');
  });

  test('an id that is not a UUID v7 names the field that holds it', () => {
    const invalid = draftOf(lShapePlan);
    roomById(invalid, ROOM.a).id = 'Room A';
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('id-invalid');
    expect(error.path).toMatch(/^rooms\[\d+]\.id$/);
  });
});

describe('every entity id is a UUID v7', () => {
  test('a v4 UUID is refused as a room, wall or node id', () => {
    const cases: Array<[string, (scene: Draft<SceneData>) => void, RegExp]> = [
      ['room', (scene) => (roomById(scene, ROOM.a).id = V4_UUID), /^rooms\[\d+]\.id$/],
      ['wall', (scene) => (wallById(scene, WALL.wW).id = V4_UUID), /^walls\[\d+]\.id$/],
      ['node', (scene) => (nodeById(scene, NODE.n1).id = V4_UUID), /^nodes\[\d+]\.id$/],
    ];
    for (const [kind, spoil, path] of cases) {
      const invalid = draftOf(lShapePlan);
      spoil(invalid);
      const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
      expect(error.rule).toBe('id-invalid');
      expect(error.path).toMatch(path);
      expect(error.message).toContain('is not a UUID v7');
      expect((error.detail as { kind?: unknown }).kind).toBe(kind === 'node' ? 'plan node' : kind);
    }
  });

  test('a v4 UUID is refused as the scene id, by the shape gate', () => {
    const invalid = { ...draftOf(lShapePlan), id: V4_UUID };
    const error = errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES));
    expect(error.rule).toBe('id-invalid');
    expect(error.path).toBe('id');
    expect(error.detail).toEqual({ kind: 'scene', id: V4_UUID });
  });

  test('an uppercase UUID v7 is refused: the canonical form is lowercase', () => {
    const invalid = draftOf(lShapePlan);
    roomById(invalid, ROOM.a).id = ROOM.a.toUpperCase();
    expect(errorOf(() => validateScene(invalid, CATALOGUE_REGISTRIES)).rule).toBe('id-invalid');
  });
});

/* ------------------------------------------------------ finish values --- */

/** The six places a finish value stands, with the surface each one is. */
const FINISH_PLACES = ['floor', 'walls', 'ceiling', 'trim', 'facade', 'roomFace', 'facadeFace'] as const;
type FinishPlace = (typeof FINISH_PLACES)[number];

/** A room-owned face and a facade face of the L-shape plan. */
const ROOM_FACE = { room: L_SHAPE.room.a, wallId: L_SHAPE.wall.wPart, side: 'L' } as const;
const FACADE_FACE = { wallId: L_SHAPE.wall.wSA, side: 'R' } as const;

/** `lShapePlan` at `version` with `value` at `place` and nothing else painted. */
function paintedAt(place: FinishPlace, value: unknown, version: '2.2' | '2.3' = '2.3'): Draft<SceneData> {
  const scene = draftOf(lShapePlan);
  (scene as { schemaVersion: string }).schemaVersion = version;
  const finishes: Record<string, unknown> =
    place === 'facade'
      ? { facade: value }
      : place === 'roomFace'
        ? { faces: [{ ...ROOM_FACE, finish: value }] }
        : place === 'facadeFace'
          ? { faces: [{ ...FACADE_FACE, finish: value }] }
          : { rooms: { [L_SHAPE.room.a]: { [place]: value } } };
  (scene as { finishes?: unknown }).finishes = finishes;
  return scene;
}

/** The path a refusal at `place` names, as the error carries it (a document path is bounded like any echo of a document). */
function finishPath(place: FinishPlace): string {
  if (place === 'facade') return 'finishes.facade';
  if (place === 'roomFace' || place === 'facadeFace') return 'finishes.faces[0].finish';
  return boundDocumentText(`finishes.rooms.${L_SHAPE.room.a}.${place}`);
}

/** The rule and path `document` is refused with against the library registries, or `accepted`. */
function refusalOf(document: unknown): { rule: string; path: string | undefined } | 'accepted' {
  try {
    validateScene(document, LIBRARY_REGISTRIES);
  } catch (error) {
    if (error instanceof SceneValidationError) return { rule: error.rule, path: error.path };
    throw error;
  }
  return 'accepted';
}

describe('finish values: the shape is checked at runtime, on the load path', () => {
  const MALFORMED = [
    { material: LIB.paint, colour: '#c9d6df', scale: 2 },
    { material: LIB.paint, colour: 'beige' },
    { material: LIB.paint, rotation: Number.POSITIVE_INFINITY },
    { material: LIB.paint },
  ];

  test('SceneModel.load refuses an unknown key, a bad colour, a non-finite rotation and a modifier-free object at every place', () => {
    for (const place of FINISH_PLACES) {
      for (const value of MALFORMED) {
        let refusal: { rule: string; path: string | undefined } | 'accepted' = 'accepted';
        try {
          SceneModel.load(paintedAt(place, value), LIBRARY_REGISTRIES);
        } catch (error) {
          if (!(error instanceof SceneValidationError)) throw error;
          refusal = { rule: error.rule, path: error.path };
        }
        expect({ place, value, refusal }).toEqual({ place, value, refusal: { rule: 'finish-invalid', path: finishPath(place) } });
      }
    }
  });

  test('a modifier-free object is told to use the bare UUID', () => {
    const error = errorOf(() => validateScene(paintedAt('walls', { material: LIB.paint }), LIBRARY_REGISTRIES));
    expect(error.message).toContain('use the bare UUID');
  });

  test('the bare UUID, a colour and a rotation are the three accepted spellings', () => {
    for (const value of [LIB.paint, { material: LIB.paint, colour: '#c9d6df' }, { material: LIB.paint, rotation: 90 }]) {
      expect({ value, refusal: refusalOf(paintedAt('walls', value)) }).toEqual({ value, refusal: 'accepted' });
    }
  });
});

describe('finish values: what is new in 2.3 needs 2.3', () => {
  test('a 2.2 document with a finish object, a ceiling or a trim is refused, naming 2.3', () => {
    for (const [place, value] of [
      ['walls', { material: LIB.paint, colour: '#c9d6df' }],
      ['ceiling', FINISH.sand],
      ['trim', FINISH.sand],
      ['roomFace', { material: LIB.paint, rotation: 90 }],
    ] as const) {
      const document = paintedAt(place, value, '2.2');
      expect({ place, refusal: refusalOf(document) }).toEqual({
        place,
        refusal: { rule: 'finish-needs-schema-2-3', path: finishPath(place) },
      });
      expect(errorOf(() => validateScene(document, LIBRARY_REGISTRIES)).message).toContain('2.3');
    }
  });

  test('the same document as 2.3 is accepted', () => {
    expect(refusalOf(paintedAt('ceiling', FINISH.sand))).toBe('accepted');
    expect(refusalOf(paintedAt('trim', { material: LIB.paint, colour: '#ffffff' }))).toBe('accepted');
  });

  test('every 2.2 fixture of this build still validates', () => {
    for (const scene of [lShapePlan, bayPlan]) expect(refusalOf(scene)).toBe('accepted');
  });
});

describe('finish values: which material may dress which place', () => {
  /** The surface word a place is judged by. */
  const SURFACE: Record<FinishPlace, string> = {
    floor: 'floor',
    walls: 'wall',
    ceiling: 'ceiling',
    trim: 'trim',
    facade: 'facade',
    roomFace: 'wall',
    facadeFace: 'facade',
  };
  /** Library materials and the surface words of their `apply`. */
  const APPLIES: Record<string, readonly string[]> = {
    [LIB.floorScan]: ['floor'],
    [LIB.paint]: ['wall', 'ceiling', 'facade', 'trim'],
    [LIB.floorAndWall]: ['floor', 'wall'],
    [LIB.facadeOnly]: ['facade'],
    [LIB.facadeAndWall]: ['facade', 'wall'],
    [LIB.wallOnly]: ['wall'],
  };

  test('a finish object dresses exactly the surfaces of its apply, at every place', () => {
    for (const [material, apply] of Object.entries(APPLIES)) {
      for (const place of FINISH_PLACES) {
        const expected = apply.includes(SURFACE[place]) ? 'accepted' : { rule: 'finish-wrong-family', path: finishPath(place) };
        expect({ material, place, refusal: refusalOf(paintedAt(place, { material, colour: '#c9d6df' })) }).toEqual({
          material,
          place,
          refusal: expected,
        });
      }
    }
  });

  test('a bare UUID dresses the surfaces of its apply, and a wall material the facade as well', () => {
    for (const [material, apply] of Object.entries(APPLIES)) {
      for (const place of FINISH_PLACES) {
        const surface = SURFACE[place];
        const dresses = apply.includes(surface) || (surface === 'facade' && apply.includes('wall'));
        const expected = dresses ? 'accepted' : { rule: 'finish-wrong-family', path: finishPath(place) };
        expect({ material, place, refusal: refusalOf(paintedAt(place, material)) }).toEqual({ material, place, refusal: expected });
      }
    }
  });

  test('a bundled floor finish dresses floors, a bundled wall finish walls, faces, the facade, ceilings and trim', () => {
    for (const place of FINISH_PLACES) {
      const floor = place === 'floor' ? 'accepted' : { rule: 'finish-wrong-family', path: finishPath(place) };
      const wall = place === 'floor' ? { rule: 'finish-wrong-family', path: finishPath(place) } : 'accepted';
      expect({ place, oak: refusalOf(paintedAt(place, FINISH.oak)), sand: refusalOf(paintedAt(place, FINISH.sand)) }).toEqual({
        place,
        oak: floor,
        sand: wall,
      });
    }
  });

  test('a wrong surface names the material and the surface', () => {
    const error = errorOf(() => validateScene(paintedAt('ceiling', { material: LIB.wallOnly, colour: '#c9d6df' }), LIBRARY_REGISTRIES));
    expect(error.message).toContain(LIB.wallOnly);
    expect(error.message).toContain('ceiling');
  });

  test('an unknown material is refused in either spelling', () => {
    const ghost = '01a167f6-040a-72e4-9504-fef48f8fd18d';
    for (const place of FINISH_PLACES) {
      expect({
        place,
        bare: refusalOf(paintedAt(place, ghost)),
        object: refusalOf(paintedAt(place, { material: ghost, rotation: 90 })),
      }).toEqual({
        place,
        bare: { rule: 'finish-unknown', path: finishPath(place) },
        object: { rule: 'finish-unknown', path: finishPath(place) },
      });
    }
  });

  test('a bundled finish, a pbr and a generator material in object form are refused: modifiers need a library material', () => {
    for (const [place, material] of [
      ['walls', FINISH.sand],
      ['floor', FINISH.oak],
      ['walls', LIB.pbrWall],
      ['floor', LIB.generatorFloor],
    ] as const) {
      const document = paintedAt(place, { material, colour: '#c9d6df' });
      expect({ material, refusal: refusalOf(document) }).toEqual({
        material,
        refusal: { rule: 'finish-modifiers-need-library', path: finishPath(place) },
      });
      const message = errorOf(() => validateScene(document, LIBRARY_REGISTRIES)).message;
      expect(message).toContain(material);
      expect(message).toContain('library material');
    }
  });

  test('pbr and generator project materials by bare UUID are still accepted, in a 2.3 document as in a 2.2 one', () => {
    for (const version of ['2.2', '2.3'] as const) {
      const scene = paintedAt('walls', LIB.pbrWall, version);
      (scene.finishes as { rooms: Record<string, Record<string, unknown>> }).rooms[L_SHAPE.room.a]!['floor'] = LIB.generatorFloor;
      expect({ version, refusal: refusalOf(scene) }).toEqual({ version, refusal: 'accepted' });
    }
  });

  test('the 2.2 facade painted with a project wall material is accepted as before', () => {
    expect(refusalOf(paintedAt('facade', LIB.wallOnly, '2.2'))).toBe('accepted');
    expect(refusalOf(paintedAt('facade', LIB.pbrWall, '2.2'))).toBe('accepted');
  });
});
