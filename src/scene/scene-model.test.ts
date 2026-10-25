/**
 * Model contract: monotonic revisions, refusal on a stale base revision, all-
 * or-nothing batches, a frozen committed state, listener isolation, hostile
 * identifiers, and a `toJSON` draft that survives a round trip through
 * `validateScene`.
 */

import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { describe, expect, test } from 'bun:test';
import { asDraft } from '../fixtures/stubs.js';
import { draftOf } from '../shared/committed.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { emptyShell, fixtureProjectLibrary } from '../fixtures/editor-scenario.js';
import { registriesFromLibrary } from './registries.js';
import { SceneModel, isApplyOk, type ApplyOk } from './scene-model.js';
import {
  TOUCHED_FACADE,
  TOUCHED_SHELL,
  facadeFinishOf,
  faceFinishOf,
  floorFinishOf,
  roomWallFinishOf,
  touchedFace,
  touchedFloor,
  touchedRoomWalls,
  type SceneOp,
  type TouchedEntity,
} from './scene-ops.js';
import { validateScene } from './scene-validator.js';
import { LocalFixtureRepository } from '../demo/fixture-repository.js';
import { lintLayout } from '../layout/layout-lint.js';
import { faceKey, type SceneData } from './types.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { EDITOR } from '../fixtures/editor-scenario-ids.js';
import { OPENING_VARIANT, VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { findFinish } from '../materials/finish-catalogue.js';
import { resolveRoomFinish } from '../materials/room-finish.js';
import { BUILTIN_FINISHES } from '../materials/builtin-library.js';
import { LIBRARY_FINISH as LIB, LIBRARY_REGISTRIES } from '../fixtures/library-finishes.js';
import type { Draft } from '../shared/committed.js';

const ROOM_A = L_SHAPE.room.a;
const ROOM_B = L_SHAPE.room.b;
/** Room A's face of the partition, the one face these tests paint on its own. */
const PARTITION_A = faceKey(ROOM_A, L_SHAPE.wall.wPart, 'L');

/** Ids the editor scenario mints, as an editor host would: fixed v7 literals generated once offline. */
const NEW = {
  nodeN: '01a12ff6-b7c7-7478-93c3-f0ab5992df10',
  nodeS: '01a12ff6-b7c8-7d77-a0cf-1f3afa7c7372',
  wallNW: '01a12ff6-b7c9-7faa-a961-95872a58881b',
  wallNE: '01a12ff6-b7ca-7eef-b64f-091e068aaeae',
  wallSE: '01a12ff6-b7cb-7a60-9a11-93410225a9e1',
  wallSW: '01a12ff6-b7cc-7430-9d5c-5634b981ec2d',
  wallPart: '01a12ff6-b7cd-7858-bc59-f90fb7542015',
  study: '01a12ff6-b7ce-755a-88c7-61277c101a6a',
  doorPart: '01a12ff6-b7cf-7875-ab79-014fb7fb3803',
  windowN: '01a12ff6-b7d0-7753-b9cd-69e8b36bffef',
  sofa: '01a12ff6-b7d1-7e05-98e4-c27b319ff4f9',
} as const;

/** A well-formed v7 that names nothing in the L-shape plan. */
const GHOST = '01a12ff6-b7d2-72b3-9e64-f4da880bc978';
/** A finish no catalogue declares. */
const NOT_A_FINISH = '01a12ff6-b7d3-734d-abe4-48ecaf000198';

function model(): SceneModel {
  return new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
}

/**
 * `lShapePlan` with the sofa pushed into the west wall — a HARD layout issue
 * (`inside-a-wall`) on a document the validator is perfectly happy with, which
 * is exactly the case `lint` exists for. The fixture itself lints clean, so the
 * one issue every assertion below sees is this one.
 */
function sofaInAWall(): SceneData {
  const scene = draftOf(lShapePlan);
  scene.assets[0]!.position = { x: 0, y: 0, z: 4 };
  return scene;
}

/** A model that CAN lint: the linter is injected, never imported (`layout/layout-issue.ts`). */
function linting(scene: SceneData = lShapePlan): SceneModel {
  return new SceneModel(scene, CATALOGUE_REGISTRIES, { lint: lintLayout });
}

/** A harmless op, so a lint assertion is about the candidate and not about the op. */
const RAISE_CEILING: SceneOp = { op: 'set_ceiling', height: 3.2 };

function ok(result: ReturnType<SceneModel['apply']>): ApplyOk {
  if (!isApplyOk(result)) throw new Error(`expected a commit, got ${result.error}: ${result.message}`);
  return result;
}

describe('construction', () => {
  test('starts at revision 0 with a solved plan and a deep copy of the input', () => {
    const scene = draftOf(lShapePlan);
    const subject = new SceneModel(scene, CATALOGUE_REGISTRIES);
    expect(subject.rev).toBe(0);
    expect(subject.plan.rooms.length).toBe(2);
    scene.rooms[0]!.name = 'mutated after construction';
    expect(subject.scene.rooms[0]!.name).toBe('Room A');
  });

  test('load validates an unknown document and refuses a broken one', () => {
    expect(SceneModel.load(draftOf(lShapePlan) as unknown, CATALOGUE_REGISTRIES).rev).toBe(0);
    expect(() => SceneModel.load({ schemaVersion: '1.1' }, CATALOGUE_REGISTRIES)).toThrow(/Scene validation failed/);
  });

  test('takes a repository result straight from load', async () => {
    const repository = new LocalFixtureRepository({ [lShapePlan.id]: lShapePlan }, lShapePlan.id);
    const subject = SceneModel.load(await repository.load(), CATALOGUE_REGISTRIES);
    expect(subject.scene.id).toBe(lShapePlan.id);
    await expect(repository.load('missing')).rejects.toThrow(/Unknown scene reference/);
  });
});

describe('apply', () => {
  test('one batch advances the revision by exactly one, whatever its size', () => {
    const subject = model();
    const result = ok(
      subject.apply({
        baseRev: 0,
        ops: [
          { op: 'set_material', target: ROOM_A, material: FINISH.walnut },
          { op: 'set_material', target: ROOM_B, material: FINISH.sage },
        ],
      }),
    );
    expect(result.rev).toBe(1);
    expect(subject.rev).toBe(1);
    expect(result.applied.map((entry) => entry.summary)).toEqual([
      `Floor of Room A set to ${FINISH.walnut}`,
      `Walls of Room B set to ${FINISH.sage}`,
    ]);
    expect(result.touched).toEqual([touchedFloor(ROOM_A), touchedRoomWalls(ROOM_B)]);
  });

  test('touched entities are the union of the batch, deduplicated by value', () => {
    const subject = model();
    const result = ok(
      subject.apply({
        baseRev: 0,
        ops: [
          { op: 'set_material', target: PARTITION_A, material: FINISH.graphite, scope: 'face' },
          { op: 'set_material', target: ROOM_A, material: FINISH.walnut },
          // A structurally equal key built anew: one entity, not two.
          { op: 'set_material', target: faceKey(ROOM_A, L_SHAPE.wall.wPart, 'L'), material: FINISH.sage, scope: 'face' },
          { op: 'set_material', target: ROOM_A, material: FINISH.ash },
        ],
      }),
    );
    const expected: TouchedEntity[] = [touchedFace(PARTITION_A), touchedFloor(ROOM_A)];
    expect(result.touched).toEqual(expected);
  });

  test('refuses a stale base revision without touching the scene', () => {
    const subject = model();
    ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.walnut }] }));
    const stale = subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.ash }] });
    expect(isApplyOk(stale)).toBe(false);
    expect(stale).toMatchObject({ error: 'revision_conflict' });
    expect(subject.rev).toBe(1);
    expect(floorFinishOf(subject.scene, ROOM_A)).toBe(FINISH.walnut);
  });

  test('an empty batch is refused', () => {
    const subject = model();
    expect(subject.apply({ baseRev: 0, ops: [] })).toMatchObject({ error: 'validation_failed' });
    expect(subject.rev).toBe(0);
  });

  test('a batch is atomic: a rejected second operation rolls the first one back', () => {
    const subject = model();
    const result = subject.apply({
      baseRev: 0,
      ops: [
        { op: 'set_material', target: ROOM_A, material: FINISH.walnut },
        { op: 'set_material', target: ROOM_A, material: NOT_A_FINISH },
      ],
    });
    expect(result).toMatchObject({ error: 'validation_failed' });
    expect(subject.rev).toBe(0);
    expect(floorFinishOf(subject.scene, ROOM_A)).toBe(lShapePlan.rooms.find((room) => room.id === ROOM_A)!.floorMaterial);
    expect(subject.scene.finishes).toBeUndefined();
  });

  test('a candidate that fails validateScene is dropped, plan and revision intact', () => {
    const subject = model();
    const planBefore = subject.plan;
    // A 3.9 m opening cannot fit the 6 m wall together with the entry door:
    // the appliers clamp it, the validator then catches the overlap.
    const result = subject.apply({
      baseRev: 0,
      ops: [{ op: 'set_opening', openingId: L_SHAPE.opening.windowASouth, center: 2.6, width: 3.9 }],
    });
    expect(result).toMatchObject({ error: 'validation_failed' });
    expect((result as { message: string }).message).toContain('Scene validation failed');
    expect(subject.rev).toBe(0);
    expect(subject.plan).toBe(planBefore);
    const wall = subject.scene.walls.find((candidate) => candidate.id === L_SHAPE.wall.wSA)!;
    expect(wall.openings!.find((opening) => opening.id === L_SHAPE.opening.windowASouth)!.width).toBe(2.0);
  });

  test('a committed plan change re-solves the plan', () => {
    const subject = model();
    const planBefore = subject.plan;
    const result = ok(subject.apply({ baseRev: 0, ops: [{ op: 'remove_opening', openingId: L_SHAPE.opening.doorAb }] }));
    expect(result.touched).toEqual([TOUCHED_SHELL]);
    expect(subject.plan).not.toBe(planBefore);
  });
});

describe('onRevision', () => {
  test('listeners see the revision, the touched entities and the ops, and can unsubscribe', () => {
    const subject = model();
    const seen: Array<{ rev: number; touched: TouchedEntity[]; ops: SceneOp[] }> = [];
    const off = subject.onRevision((rev, touched, ops) => {
      seen.push({ rev, touched: [...touched], ops: [...ops] });
    });
    ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: 'facade', material: FINISH.terra }] }));
    expect(seen).toEqual([{ rev: 1, touched: [TOUCHED_FACADE], ops: [{ op: 'set_material', target: 'facade', material: FINISH.terra }] }]);
    off();
    ok(subject.apply({ baseRev: 1, ops: [{ op: 'set_material', target: 'facade', material: FINISH.sage }] }));
    expect(seen.length).toBe(1);
  });

  test('a refused batch never notifies', () => {
    const subject = model();
    let calls = 0;
    subject.onRevision(() => {
      calls += 1;
    });
    subject.apply({ baseRev: 7, ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.oak }] });
    subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: ROOM_A, material: NOT_A_FINISH }] });
    expect(calls).toBe(0);
  });

  test('a listener that unsubscribes ITSELF does not skip the next one', () => {
    const subject = model();
    const seen: string[] = [];
    const off = subject.onRevision(() => {
      seen.push('a');
      off();
    });
    subject.onRevision(() => seen.push('b'));
    ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: 'facade', material: FINISH.terra }] }));
    ok(subject.apply({ baseRev: 1, ops: [{ op: 'set_material', target: 'facade', material: FINISH.sage }] }));
    expect(seen).toEqual(['a', 'b', 'b']);
  });

  test('a listener that unsubscribes ITS NEIGHBOUR still lets it hear this commit', () => {
    // The fan-out copies before it walks (`shared/fanout.ts`), so the neighbour
    // is notified for the commit already under way and never again.
    const subject = model();
    const seen: string[] = [];
    subject.onRevision(() => {
      seen.push('a');
      offB();
    });
    const offB = subject.onRevision(() => seen.push('b'));
    ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: 'facade', material: FINISH.terra }] }));
    ok(subject.apply({ baseRev: 1, ops: [{ op: 'set_material', target: 'facade', material: FINISH.sage }] }));
    expect(seen).toEqual(['a', 'b', 'a']);
  });
});

describe('toJSON round trip', () => {
  test('a retired finish is kept as written through an edit and an export, and still draws its target', () => {
    const scene = draftOf(lShapePlan) as SceneData & { schemaVersion: string; finishes?: unknown };
    scene.schemaVersion = '2.3';
    scene.finishes = { rooms: { [ROOM_B]: { walls: FINISH.wallpaper_cream } } };
    const subject = new SceneModel(scene, CATALOGUE_REGISTRIES);
    ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.walnut }, RAISE_CEILING] }));
    const exported = JSON.parse(JSON.stringify(subject.toJSON())) as SceneData;
    expect(roomWallFinishOf(exported, ROOM_B)).toBe(FINISH.wallpaper_cream);
    const reloaded = SceneModel.load(draftOf(exported), CATALOGUE_REGISTRIES);
    expect(roomWallFinishOf(reloaded.scene, ROOM_B)).toBe(FINISH.wallpaper_cream);
    const drawn = resolveRoomFinish(FINISH.wallpaper_cream, undefined, findFinish);
    expect(drawn?.kind === 'library' && drawn.draw.material).toBe(BUILTIN_FINISHES.get(FINISH.white)!.material);
  });

  test('a plan-mutating batch exports to a document that reloads to the same faces', () => {
    const subject = model();
    const ops: SceneOp[] = [
      { op: 'set_material', target: ROOM_A, material: FINISH.walnut },
      { op: 'set_material', target: ROOM_A, material: FINISH.sage },
      { op: 'set_material', target: PARTITION_A, material: FINISH.graphite, scope: 'face' },
      { op: 'set_material', target: 'facade', material: FINISH.terra },
      { op: 'replace_asset_variant', assetId: L_SHAPE.asset.sofa, variant: VARIANT.sofa_3s_boucle },
      // Plan-level: moves the window, so the export has to carry the new
      // geometry and re-solve to exactly the same face set.
      { op: 'set_opening', openingId: L_SHAPE.opening.windowASouth, center: 4.3, width: 1.4 },
      { op: 'replace_opening_variant', openingId: L_SHAPE.opening.windowASouth, variant: OPENING_VARIANT.window_oak_vertical },
    ];
    ops.forEach((op, index) => {
      ok(subject.apply({ baseRev: index, ops: [op] }));
    });
    expect(subject.rev).toBe(7);

    const exported = subject.toJSON();
    expect(() => validateScene(draftOf(exported) as unknown, CATALOGUE_REGISTRIES)).not.toThrow();

    const reloaded = SceneModel.load(draftOf(exported), CATALOGUE_REGISTRIES);
    expect(reloaded.rev).toBe(0);
    expect(floorFinishOf(reloaded.scene, ROOM_A)).toBe(FINISH.walnut);
    expect(roomWallFinishOf(reloaded.scene, ROOM_A)).toBe(FINISH.sage);
    expect(faceFinishOf(reloaded.scene, PARTITION_A)).toBe(FINISH.graphite);
    expect(facadeFinishOf(reloaded.scene)).toBe(FINISH.terra);
    expect(reloaded.scene.assets.find((asset) => asset.id === L_SHAPE.asset.sofa)!.variant).toBe(VARIANT.sofa_3s_boucle);
    const openingOf = (scene: SceneData, id: string) =>
      scene.walls.flatMap((wall) => wall.openings ?? []).find((opening) => opening.id === id)!;
    expect(openingOf(reloaded.scene, L_SHAPE.opening.windowASouth).center).toBeCloseTo(4.3, 9);
    expect(openingOf(reloaded.scene, L_SHAPE.opening.windowASouth).variant).toBe(OPENING_VARIANT.window_oak_vertical);
    // Faces, not just room ids: a re-solve that lost or renamed a face would
    // silently orphan every per-face override in the export.
    expect([...reloaded.plan.faces.keys()]).toEqual([...subject.plan.faces.keys()]);
    expect(reloaded.plan.rooms.map((room) => room.roomId).sort()).toEqual(subject.plan.rooms.map((room) => room.roomId).sort());
  });

  test('the export is a copy: mutating it cannot reach the model', () => {
    const subject = model();
    const exported = subject.toJSON();
    exported.ceilingHeight = 9;
    expect(subject.scene.ceilingHeight).toBe(lShapePlan.ceilingHeight);
  });
});

describe('the committed state is frozen', () => {
  test('editing the committed scene throws and leaves the revision alone', () => {
    const subject = model();
    // `asDraft` is how a JavaScript caller — one with no types at all — sees the
    // committed scene; these three writes are exactly what it would attempt,
    // and the runtime freeze is what has to stop them.
    const tamper = asDraft(subject.scene);
    expect(() => {
      tamper.name = 'tampered';
    }).toThrow(TypeError);
    expect(() => {
      tamper.walls.push(tamper.walls[0]!);
    }).toThrow(TypeError);
    expect(() => {
      tamper.rooms[0]!.floorMaterial = FINISH.walnut;
    }).toThrow(TypeError);
    expect(subject.scene.name).toBe(lShapePlan.name);
    expect(subject.rev).toBe(0);
    expect(subject.toJSON().name).toBe(lShapePlan.name);
  });

  test('editing the solved plan throws, maps included', () => {
    const subject = model();
    const room = asDraft(subject.plan.rooms[0]!);
    expect(() => {
      room.polygon[0]!.x = 99;
    }).toThrow(TypeError);
    const faces = subject.plan.faces as unknown as Record<string, unknown>;
    expect(faces['set']).toBeUndefined();
    expect(faces['delete']).toBeUndefined();
    expect(faces['clear']).toBeUndefined();
  });

  test('the exposed faces are a read-only view: Map.prototype cannot reach the store', () => {
    const subject = model();
    const faces = subject.plan.faces;
    const size = faces.size;
    const keys = [...faces.keys()];
    expect(() => {
      Map.prototype.set.call(faces, faceKey(ROOM_A, GHOST, 'L'), subject.plan.rooms[0]!.loop[0]!);
    }).toThrow(TypeError);
    expect(() => {
      Map.prototype.delete.call(faces, keys[0]!);
    }).toThrow(TypeError);
    expect(() => {
      Map.prototype.clear.call(faces);
    }).toThrow(TypeError);
    expect(faces.size).toBe(size);
    expect([...faces.keys()]).toEqual(keys);
    expect(subject.rev).toBe(0);
  });

  test('the exposed faces are looked up by FaceKey value, not by object identity', () => {
    const subject = model();
    const face = subject.plan.faces.get(faceKey(ROOM_A, L_SHAPE.wall.wPart, 'L'));
    expect(face?.key).toEqual(PARTITION_A);
    expect(face?.roomId).toBe(ROOM_A);
    expect(subject.plan.faces.has(faceKey(ROOM_A, GHOST, 'L'))).toBe(false);
  });

  test('the faces the view hands out are frozen too', () => {
    const subject = model();
    const face = subject.plan.faces.get([...subject.plan.faces.keys()][0]!)!;
    expect(Object.isFrozen(face)).toBe(true);
    expect(() => {
      (face as { length: number }).length = 99;
    }).toThrow(TypeError);
  });

  test('a fresh commit hands out a new frozen state', () => {
    const subject = model();
    ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.walnut }] }));
    expect(Object.isFrozen(subject.scene)).toBe(true);
    expect(() => {
      asDraft(subject.scene).name = 'tampered';
    }).toThrow(TypeError);
  });
});

describe('hostile identifiers', () => {
  // Words, prototype keys, the set_material aliases, a v4 and an uppercase v7:
  // none of them is a UUID v7, so none of them can be an id.
  const hostile = [
    '__proto__',
    'prototype',
    'constructor',
    'facade',
    'floors',
    'walls',
    'Room',
    '',
    '0b9e3f5c-1d2a-4c3b-9e8f-7a6b5c4d3e2f',
    ROOM_A.toUpperCase(),
  ];

  for (const id of hostile) {
    test(`load refuses a room called ${JSON.stringify(id)}`, () => {
      const scene = draftOf(lShapePlan);
      scene.rooms[0]!.id = id;
      expect(() => SceneModel.load(scene as unknown, CATALOGUE_REGISTRIES)).toThrow(/Scene validation failed/);
    });
  }

  test('a room id can never land on Object.prototype', () => {
    const scene = draftOf(lShapePlan);
    scene.rooms[0]!.id = '__proto__';
    expect(() => SceneModel.load(scene as unknown, CATALOGUE_REGISTRIES)).toThrow(/is not a UUID v7/);
    expect(({} as Record<string, unknown>)['floor']).toBeUndefined();
  });

  test('set_material refuses a face that names nothing', () => {
    const subject = model();
    const targets = [
      faceKey(ROOM_A, GHOST, 'L'),
      faceKey(GHOST, L_SHAPE.wall.wPart, 'L'),
      { room: ROOM_A, wallId: L_SHAPE.wall.wPart, side: 'X' },
      { room: '__proto__', wallId: L_SHAPE.wall.wPart, side: 'L' },
      { room: ROOM_A, wallId: L_SHAPE.wall.wPart, side: 'L', extra: true },
    ];
    for (const target of targets) {
      const result = subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target, material: FINISH.graphite } as SceneOp] });
      expect({ target, ...result }).toMatchObject({ target, error: 'validation_failed' });
    }
    expect(subject.rev).toBe(0);
    expect(subject.scene.finishes).toBeUndefined();
  });

  test('duplicate ids across kinds are refused', () => {
    const scene = draftOf(lShapePlan);
    scene.assets[0]!.id = scene.rooms[0]!.id;
    expect(() => SceneModel.load(scene as unknown, CATALOGUE_REGISTRIES)).toThrow(/Duplicate id/);
  });

  test('a duplicate opening id on another wall is refused', () => {
    const scene = draftOf(lShapePlan);
    const walls = scene.walls.filter((wall) => (wall.openings ?? []).length > 0);
    const donor = walls[0]!.openings![0]!;
    const other = scene.walls.find((wall) => wall.id !== walls[0]!.id && (wall.openings ?? []).length > 0);
    if (!other) throw new Error('fixture needs two walls with openings');
    other.openings![0]!.id = donor.id;
    expect(() => SceneModel.load(scene as unknown, CATALOGUE_REGISTRIES)).toThrow(/Duplicate id/);
  });
});

describe('listener isolation', () => {
  test('a throwing listener does not stop the others and does not fail the batch', () => {
    const subject = model();
    const seen: string[] = [];
    const errors: Error[] = [];
    subject.onError((error) => errors.push(error));
    subject.onRevision(() => {
      seen.push('first');
    });
    subject.onRevision(() => {
      throw new Error('listener exploded');
    });
    subject.onRevision(() => {
      seen.push('third');
    });
    const result = ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.walnut }] }));
    expect(seen).toEqual(['first', 'third']);
    expect(result.rev).toBe(1);
    expect(result.listenerErrors?.map((error) => error.message)).toEqual(['listener exploded']);
    expect(errors.map((error) => error.message)).toEqual(['listener exploded']);
    expect(subject.rev).toBe(1);
  });

  test('a throwing error sink cannot escape apply() after the commit', () => {
    const subject = model();
    const seen: string[] = [];
    subject.onError(() => {
      throw new Error('sink exploded');
    });
    subject.onRevision(() => {
      seen.push('first');
    });
    subject.onRevision(() => {
      throw new Error('listener exploded');
    });
    subject.onRevision(() => {
      seen.push('third');
    });
    const result = ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.walnut }] }));
    // The third listener still runs, and the sink's own failure is reported
    // through the result instead of being thrown at the caller.
    expect(seen).toEqual(['first', 'third']);
    expect(result.rev).toBe(1);
    expect(result.listenerErrors?.map((error) => error.message)).toEqual(['listener exploded', 'sink exploded']);
    expect(subject.rev).toBe(1);
    expect(floorFinishOf(subject.scene, ROOM_A)).toBe(FINISH.walnut);
  });

  test('a listener cannot apply another batch re-entrantly', () => {
    const subject = model();
    let nested: ReturnType<SceneModel['apply']> | null = null;
    subject.onRevision(() => {
      nested ??= subject.apply({ baseRev: subject.rev, ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.ash }] });
    });
    ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.walnut }] }));
    expect(nested).toMatchObject({ error: 'validation_failed' });
    expect(subject.rev).toBe(1);
    expect(floorFinishOf(subject.scene, ROOM_A)).toBe(FINISH.walnut);
  });
});

describe('layout lint', () => {
  test("'off' is the default: a model with a linter still commits a bad layout silently", () => {
    const subject = linting(sofaInAWall());

    const result = ok(subject.apply({ baseRev: 0, ops: [RAISE_CEILING] }));

    expect(result.rev).toBe(1);
    expect(result.issues).toBeUndefined();
  });

  test("'report' commits and hands back what the linter found", () => {
    const subject = linting(sofaInAWall());

    const result = ok(subject.apply({ baseRev: 0, ops: [RAISE_CEILING], lint: 'report' }));

    expect(result.rev).toBe(1);
    expect(subject.rev).toBe(1);
    expect(subject.scene.ceilingHeight).toBe(3.2);
    // A footprint sunk into a wall also crosses its room's outline (rule `on-floor`).
    expect(result.issues?.map((issue) => `${issue.rule}/${issue.severity}`)).toEqual(['inside-a-wall/error', 'on-floor/error']);
    expect(result.issues?.[0]?.ids).toEqual([L_SHAPE.asset.sofa, L_SHAPE.wall.wW]);
  });

  test("'strict' refuses the batch with layout_failed and leaves the revision alone", () => {
    const subject = linting(sofaInAWall());

    const result = subject.apply({ baseRev: 0, ops: [RAISE_CEILING], lint: 'strict' });

    if (isApplyOk(result)) throw new Error('expected the batch to be refused');
    expect(result.error).toBe('layout_failed');
    expect(result.message).toContain('inside-a-wall');
    expect(result.issues?.length).toBe(2);
    expect(subject.rev).toBe(0);
    expect(subject.scene.ceilingHeight).toBe(lShapePlan.ceilingHeight);
  });

  test("'strict' commits a candidate the linter is happy with, and reports nothing", () => {
    const subject = linting();

    const result = ok(subject.apply({ baseRev: 0, ops: [RAISE_CEILING], lint: 'strict' }));

    expect(result.rev).toBe(1);
    expect(result.issues).toBeUndefined();
  });

  test("'strict-new' lets a pre-existing hard issue ride along with an unrelated move", () => {
    const subject = linting(sofaInAWall());
    const moveTable: SceneOp = { op: 'move_object', assetId: L_SHAPE.asset.table, position: { x: 8.2, y: 0, z: 2.5 } };

    const result = ok(subject.apply({ baseRev: 0, ops: [moveTable], lint: 'strict-new' }));

    expect(result.rev).toBe(1);
    // The sofa's issues come back as information, not as a refusal.
    expect(result.issues?.map((issue) => issue.rule)).toEqual(['inside-a-wall', 'on-floor']);
  });

  test("'strict-new' refuses a batch that introduces a hard issue the base did not have", () => {
    const subject = linting(sofaInAWall());
    const tableIntoTheSofa: SceneOp = { op: 'move_object', assetId: L_SHAPE.asset.table, position: { x: 0.6, y: 0, z: 4 } };

    const result = subject.apply({ baseRev: 0, ops: [tableIntoTheSofa], lint: 'strict-new' });

    if (isApplyOk(result)) throw new Error('expected the batch to be refused');
    expect(result.error).toBe('layout_failed');
    expect(result.message).toContain('new error(s)');
    expect(result.message).not.toContain('first is on-floor');
    expect(subject.rev).toBe(0);
  });

  test("'strict-new' on a clean base is 'strict'", () => {
    const subject = linting();
    const sofaIntoTheWall: SceneOp = { op: 'move_object', assetId: L_SHAPE.asset.sofa, position: { x: 0, y: 0, z: 4 } };

    const result = subject.apply({ baseRev: 0, ops: [sofaIntoTheWall], lint: 'strict-new' });

    expect(result).toMatchObject({ error: 'layout_failed' });
    expect(subject.rev).toBe(0);
  });

  test('a model built without a linter refuses to pretend it linted', () => {
    const subject = new SceneModel(sofaInAWall(), CATALOGUE_REGISTRIES);

    const result = subject.apply({ baseRev: 0, ops: [RAISE_CEILING], lint: 'report' });

    expect(result).toMatchObject({ error: 'layout_failed' });
    expect(subject.rev).toBe(0);
  });

  test('the linter sees the CANDIDATE, not the committed scene', () => {
    const seen: number[] = [];
    const subject = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES, {
      lint: (scene, plan) => {
        seen.push(scene.ceilingHeight);
        return lintLayout(scene, plan);
      },
    });

    ok(subject.apply({ baseRev: 0, ops: [RAISE_CEILING], lint: 'report' }));

    expect(seen).toEqual([3.2]);
  });
});

/**
 * The document format, end to end: from an empty box to a two-room flat with a
 * door, a window, named rooms, laid floors, a sofa from a PROJECT library, a
 * presentation camera and a tour — built with nothing but operations, in one
 * atomic batch, accepted by `validateScene` and by the layout linter at `lint:
 * 'strict'`.
 *
 * This is the acceptance criterion of the whole vocabulary, which is why it
 * lives here rather than among the per-module op tests: those prove each
 * applier in isolation, and none of them proves that the sixteen of them
 * COMPOSE — that the ids one operation mints are the ids the next one names,
 * that a partition added mid-batch splits the face the next `add_room` anchors
 * into, that the finishes a project library ships are finishes `set_material`
 * accepts.
 */
describe('the editor scenario', () => {
  /** The shipped catalogues plus the project's own bank, which is what an editor host validates against. */
  const registries = registriesFromLibrary(fixtureProjectLibrary, CATALOGUE_REGISTRIES);

  /** Every operation of the scenario, in the order an editor would issue them. */
  const SCENARIO: SceneOp[] = [
    // 1. Split the box. The graph has to stay PLANAR — the validator refuses
    //    two walls that cross without sharing a node — so the partition's two
    //    ends become real vertices of the north and south walls: each is cut in
    //    two around the new node, and the partition then joins them.
    { op: 'add_node', id: NEW.nodeN, p: { x: 5, z: 0 } },
    { op: 'add_node', id: NEW.nodeS, p: { x: 5, z: 6 } },
    { op: 'remove_wall', wallId: EDITOR.wall.wallN },
    { op: 'remove_wall', wallId: EDITOR.wall.wallS },
    { op: 'add_wall', id: NEW.wallNW, a: EDITOR.node.cNw, b: NEW.nodeN, thickness: 0.3, role: 'facade' },
    { op: 'add_wall', id: NEW.wallNE, a: NEW.nodeN, b: EDITOR.node.cNe, thickness: 0.3, role: 'facade' },
    { op: 'add_wall', id: NEW.wallSE, a: EDITOR.node.cSe, b: NEW.nodeS, thickness: 0.3, role: 'facade' },
    { op: 'add_wall', id: NEW.wallSW, a: NEW.nodeS, b: EDITOR.node.cSw, thickness: 0.3, role: 'facade' },
    { op: 'add_wall', id: NEW.wallPart, a: NEW.nodeN, b: NEW.nodeS, thickness: 0.1, role: 'partition' },
    // 2. The second room, anchored in the face the partition just created.
    { op: 'add_room', id: NEW.study, name: 'Study', anchor: { x: 6.5, z: 3 } },
    // 3. A door between the two rooms and a window onto the street.
    { op: 'add_opening', id: NEW.doorPart, wallId: NEW.wallPart, type: 'door', center: 3, width: 0.9 },
    { op: 'add_opening', id: NEW.windowN, wallId: NEW.wallNW, type: 'window', center: 2.5, width: 1.6 },
    // 4. Naming.
    { op: 'set_room', roomId: EDITOR.room.space, name: 'Living room', kind: 'room' },
    { op: 'set_room', roomId: NEW.study, name: 'Study room', accent: '#a8b5a4' },
    // 5. Floors, from the project library's own finishes.
    { op: 'set_material', target: EDITOR.room.space, material: EDITOR.library.material.libOak },
    { op: 'set_material', target: NEW.study, material: EDITOR.library.material.libTerrazzo },
    // 6. A sofa out of the project library, put down, nudged and turned.
    {
      op: 'place_object',
      id: NEW.sofa,
      asset: EDITOR.library.object.sofaLib,
      library: EDITOR.library.project,
      variant: EDITOR.library.variant.sofaLibWool,
      room: EDITOR.room.space,
      position: { x: 2, y: 0, z: 2 },
    },
    { op: 'move_object', assetId: NEW.sofa, dposition: { x: 0.2, y: 0, z: 0.4 } },
    { op: 'rotate_object', assetId: NEW.sofa, rotationY: Math.PI / 2 },
    // 7. Cameras and the tour.
    { op: 'set_camera', target: 'presentation', pose: { position: { x: 4, y: 9, z: 15 }, target: { x: 4, y: 1, z: 3 } } },
    { op: 'set_camera', target: { room: NEW.study }, pose: { position: { x: 6.5, y: 1.6, z: 3 }, target: { x: 7.5, y: 1.4, z: 3 } } },
    {
      op: 'set_autotour',
      speed: 1.1,
      path: [
        { x: 2, y: 1.6, z: 3 },
        { x: 5, y: 1.6, z: 3 },
        { x: 6.5, y: 1.6, z: 3 },
      ],
      gaze: [{ at: 2, target: { x: 8, y: 1.5, z: 3 } }],
    },
  ];

  test('one batch turns the empty shell into the flat, and the result validates and lints clean', () => {
    const subject = new SceneModel(emptyShell, registries, { lint: lintLayout });

    const result = ok(subject.apply({ baseRev: 0, ops: SCENARIO, lint: 'strict' }));

    expect(result.rev).toBe(1);
    expect(result.applied).toHaveLength(SCENARIO.length);
    expect(result.issues).toBeUndefined();

    const scene = subject.scene;
    expect(scene.rooms.map((room) => room.name)).toEqual(['Living room', 'Study room']);
    expect(scene.rooms.map((room) => room.kind)).toEqual(['room', undefined]);
    expect(floorFinishOf(scene, EDITOR.room.space)).toBe(EDITOR.library.material.libOak);
    expect(floorFinishOf(scene, NEW.study)).toBe(EDITOR.library.material.libTerrazzo);
    expect(scene.walls.map((wall) => wall.id)).toContain(NEW.wallPart);
    expect(subject.plan.rooms.map((room) => room.roomId).sort()).toEqual([EDITOR.room.space, NEW.study].sort());

    // The placement kept the library reference it was given and the variant it
    // was told to show; `place_object` wrote the archetype id as its `type`.
    expect(scene.assets[0]).toMatchObject({
      id: NEW.sofa,
      type: EDITOR.library.object.sofaLib,
      asset: EDITOR.library.object.sofaLib,
      library: EDITOR.library.project,
      variant: EDITOR.library.variant.sofaLibWool,
      room: EDITOR.room.space,
      position: { x: 2.2, y: 0, z: 2.4 },
      rotationY: Math.PI / 2,
    });

    expect(scene.autotour.speed).toBe(1.1);
    expect(scene.autotour.path).toHaveLength(3);
    expect(scene.roomCameras[NEW.study]).toBeDefined();

    // The final say: the committed document is one the validator accepts on its
    // own terms, against the very registries the batch was applied with — it
    // throws on a refusal and hands the document back on acceptance.
    expect(validateScene(scene, registries)).toBe(scene);
  });

  test('the whole scenario is refused as one when its last operation is wrong', () => {
    const subject = new SceneModel(emptyShell, registries, { lint: lintLayout });

    const result = subject.apply({
      baseRev: 0,
      ops: [...SCENARIO, { op: 'set_autotour', gaze: [{ at: 9, target: { x: 0, y: 1, z: 0 } }] }],
      lint: 'strict',
    });

    expect(result).toMatchObject({ error: 'validation_failed' });
    expect(subject.rev).toBe(0);
    expect(subject.scene.rooms).toHaveLength(1);
    expect(subject.scene.assets).toEqual([]);
  });
});

describe('a 2.3 document with finish objects survives export', () => {
  test('exported, serialised and loaded again, every finish value is deep-equal to the original', () => {
    const document = draftOf(lShapePlan) as Draft<SceneData> & { schemaVersion: string };
    document.schemaVersion = '2.3';
    const finishes = {
      rooms: {
        [L_SHAPE.room.a]: {
          floor: { material: LIB.floorScan, rotation: 90 },
          walls: { material: LIB.paint, colour: '#c9d6df' },
          ceiling: LIB.paint,
          trim: { material: LIB.paint, colour: '#ffffff', rotation: 0 },
        },
      },
      faces: [
        {
          room: L_SHAPE.room.b,
          wallId: L_SHAPE.wall.wPart,
          side: 'R' as const,
          finish: { material: LIB.wallOnly, colour: '#d8cbb5', rotation: 45 },
        },
      ],
      facade: { material: LIB.facadeOnly, rotation: 180 },
    };
    (document as { finishes?: unknown }).finishes = finishes;
    const loaded = SceneModel.load(document, LIBRARY_REGISTRIES);
    const applied = loaded.apply({
      baseRev: loaded.rev,
      ops: [{ op: 'set_material', surface: 'ceiling', room: L_SHAPE.room.b, material: LIB.paint, colour: '#203040' }],
    });
    expect(isApplyOk(applied)).toBe(true);

    const exported = JSON.parse(JSON.stringify(loaded.toJSON())) as unknown;
    const reloaded = SceneModel.load(exported, LIBRARY_REGISTRIES);
    expect(reloaded.scene.schemaVersion).toBe('2.3');
    expect(reloaded.scene.finishes).toEqual({
      ...finishes,
      rooms: { ...finishes.rooms, [L_SHAPE.room.b]: { ceiling: { material: LIB.paint, colour: '#203040' } } },
    });
  });
});

describe('a 2.4 document with room purposes', () => {
  /** `emptyShell` declared 2.4: only such a document may take a `set_room_purpose`. */
  function shell24(): SceneData {
    const document = draftOf(emptyShell);
    (document as { schemaVersion: string }).schemaVersion = '2.4';
    return document;
  }

  test('a batch that adds a room and marks it commits as ONE revision, and the room has the purpose', () => {
    // The same split the editor scenario makes: the graph has to stay planar,
    // so the partition's ends become vertices of the north and south walls
    // before the partition joins them and the room anchors in the new face.
    const subject = new SceneModel(shell24(), CATALOGUE_REGISTRIES);

    const result = ok(
      subject.apply({
        baseRev: 0,
        ops: [
          { op: 'add_node', id: NEW.nodeN, p: { x: 5, z: 0 } },
          { op: 'add_node', id: NEW.nodeS, p: { x: 5, z: 6 } },
          { op: 'remove_wall', wallId: EDITOR.wall.wallN },
          { op: 'remove_wall', wallId: EDITOR.wall.wallS },
          { op: 'add_wall', id: NEW.wallNW, a: EDITOR.node.cNw, b: NEW.nodeN, thickness: 0.3, role: 'facade' },
          { op: 'add_wall', id: NEW.wallNE, a: NEW.nodeN, b: EDITOR.node.cNe, thickness: 0.3, role: 'facade' },
          { op: 'add_wall', id: NEW.wallSE, a: EDITOR.node.cSe, b: NEW.nodeS, thickness: 0.3, role: 'facade' },
          { op: 'add_wall', id: NEW.wallSW, a: NEW.nodeS, b: EDITOR.node.cSw, thickness: 0.3, role: 'facade' },
          { op: 'add_wall', id: NEW.wallPart, a: NEW.nodeN, b: NEW.nodeS, thickness: 0.1, role: 'partition' },
          { op: 'add_room', id: NEW.study, name: 'Study', anchor: { x: 6.5, z: 3 } },
          { op: 'set_room_purpose', roomId: NEW.study, purpose: 'study' },
        ],
      }),
    );

    expect(result.rev).toBe(1);
    const added = subject.scene.rooms.find((room) => room.id === NEW.study)!;
    expect(added.purpose).toBe('study');
  });

  test('a purpose-only batch commits and the touched list is empty', () => {
    const document = draftOf(lShapePlan);
    (document as { schemaVersion: string }).schemaVersion = '2.4';
    const subject = new SceneModel(document, CATALOGUE_REGISTRIES);

    const result = ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_room_purpose', roomId: ROOM_A, purpose: 'bedroom' }] }));

    expect(result.rev).toBe(1);
    expect(result.touched).toEqual([]);
  });

  /** `lShapePlan` declared 2.4, with nothing else changed. */
  function lShape24(): Draft<SceneData> {
    const document = draftOf(lShapePlan);
    (document as { schemaVersion: string }).schemaVersion = '2.4';
    return document;
  }

  test('set: the room gains the purpose and every other field of the document, that room included, is unchanged', () => {
    const subject = new SceneModel(lShape24(), CATALOGUE_REGISTRIES);

    ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_room_purpose', roomId: ROOM_A, purpose: 'kitchen' }] }));

    const expected = lShape24();
    expected.rooms[0] = { ...expected.rooms[0]!, purpose: 'kitchen' };
    expect(expected.rooms[0].id).toBe(ROOM_A);
    expect(subject.scene).toEqual(expected);
  });

  test('the purpose the room already has commits a revision and changes nothing else', () => {
    const document = lShape24();
    document.rooms[0]!.purpose = 'kitchen';
    const subject = new SceneModel(document, CATALOGUE_REGISTRIES);
    const before = draftOf(subject.scene);

    const result = ok(subject.apply({ baseRev: 0, ops: [{ op: 'set_room_purpose', roomId: ROOM_A, purpose: 'kitchen' }] }));

    expect(result.rev).toBe(1);
    expect(subject.rev).toBe(1);
    expect(subject.scene).toEqual(before);
  });

  test('on an older document the operation is refused, and the revision and the document stay as they were', () => {
    for (const version of ['2.2', '2.3'] as const) {
      const document = draftOf(lShapePlan);
      (document as { schemaVersion: string }).schemaVersion = version;
      const subject = new SceneModel(document, CATALOGUE_REGISTRIES);
      const before = draftOf(subject.scene);

      const result = subject.apply({ baseRev: 0, ops: [{ op: 'set_room_purpose', roomId: ROOM_A, purpose: 'kitchen' }] });

      if (isApplyOk(result)) throw new Error(`expected a ${version} document to refuse set_room_purpose`);
      expect(result.error).toBe('validation_failed');
      expect(result.message).toContain(`set_room_purpose needs scene schema 2.4; this document is ${version}`);
      expect(subject.rev).toBe(0);
      expect(subject.scene).toEqual(before);
    }
  });
});

describe('room merges on commit', () => {
  test('an ordinary batch carries no roomMerges key at all', () => {
    const subject = model();
    const result = ok(subject.apply({ baseRev: 0, ops: [RAISE_CEILING] }));
    expect('roomMerges' in result).toBe(false);
  });

  test('removing the partition commits one room in one revision and says which room went into which', () => {
    const subject = model();
    const result = ok(subject.apply({ baseRev: 0, ops: [{ op: 'remove_wall', wallId: L_SHAPE.wall.wPart }] }));
    expect(result.rev).toBe(1);
    expect(subject.scene.rooms.map((room) => room.id)).toEqual([ROOM_A]);
    expect(result.roomMerges).toEqual([{ from: ROOM_B, to: ROOM_A, summary: 'Room B merged into Room A' }]);
    // The model's own invariant: what it commits validates and is solved.
    expect(validateScene(subject.toJSON(), CATALOGUE_REGISTRIES)).toBeDefined();
    expect(subject.plan.rooms).toHaveLength(1);
  });
});
