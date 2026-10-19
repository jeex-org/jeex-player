/**
 * `scene-parse.ts`: the boundary a consumer outside this repository crosses
 * with a document or a batch of operations it did not author.
 *
 * The one thing proven here that no other test proves is the INVARIANT: a
 * schema judges and the original value flows on. Every success assertion is
 * `toBe`, not `toEqual` — an identity check is the only way to see the
 * difference between "judged" and "reconstructed by Zod".
 */

import { describe, expect, test } from 'bun:test';
import { apartmentScene } from '../demo/scene-data.js';
import { ViewerLibError } from '../shared/errors.js';
import { parseSceneDocument, parseSceneOps } from './scene-parse.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { OPENING_VARIANT, VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';

/** The id of the opening `add_opening` creates below; the fixture does not have it. */
const NEW_OPENING = '01a12ff6-415b-7dcd-a1c7-7062b4e37bf2';

/** The error `run` throws, typed as the one thing this module may raise. */
function errorOf(run: () => void): ViewerLibError {
  try {
    run();
  } catch (error) {
    if (error instanceof ViewerLibError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

/** `detail.issues` as the error carries it: the capped `{ path, message }` list. */
function issuesOf(error: ViewerLibError): { path: string; message: string }[] {
  const detail = error.detail as { issues?: { path: string; message: string }[] } | undefined;
  return detail?.issues ?? [];
}

describe('parseSceneOps', () => {
  test('returns the very array it was handed', () => {
    const ops = [
      { op: 'set_ceiling', height: 2.8 },
      { op: 'set_material', target: 'floors', material: FINISH.oak },
    ];

    expect(parseSceneOps(ops)).toBe(ops as never);
  });

  test('accepts every op of the vocabulary', () => {
    const ops = [
      { op: 'set_material', target: L_SHAPE.room.a, material: FINISH.oak, scope: 'room' },
      { op: 'set_material', target: { room: L_SHAPE.room.a, wallId: L_SHAPE.wall.wPart, side: 'L' }, material: FINISH.sage },
      { op: 'set_material', target: { wallId: L_SHAPE.wall.wW, side: 'R' }, material: FINISH.sage },
      { op: 'replace_asset_variant', assetId: L_SHAPE.asset.sofa, variant: VARIANT.sofa_3s_linen },
      { op: 'replace_opening_variant', openingId: L_SHAPE.opening.doorAb, variant: OPENING_VARIANT.door_glass_slim },
      { op: 'set_ceiling', height: 2.7 },
      { op: 'set_opening', openingId: L_SHAPE.opening.doorAb, dcenter: 0.2 },
      { op: 'add_opening', id: NEW_OPENING, wallId: L_SHAPE.wall.wW, type: 'window', center: 1, width: 1.2 },
      { op: 'remove_opening', openingId: L_SHAPE.opening.doorAb },
    ];

    expect(parseSceneOps(ops)).toBe(ops as never);
  });

  test('refuses a value that is not an array', () => {
    const error = errorOf(() => parseSceneOps({ op: 'set_ceiling', height: 2.8 }));

    expect(error.code).toBe('scene-invalid');
    expect(error.message).toStartWith('parseSceneOps:');
  });

  test('names the operation and the field that refused, and carries every issue', () => {
    const error = errorOf(() =>
      parseSceneOps([
        { op: 'set_ceiling', height: 2.8 },
        { op: 'set_ceiling', height: 'tall' },
      ]),
    );

    expect(error.code).toBe('scene-invalid');
    expect(error.path).toBe('[1].height');
    expect(issuesOf(error)[0]?.path).toBe('[1].height');
    expect(error.message).toContain('[1].height');
  });

  test('refuses a face target that carries anything but its room, wall and side', () => {
    const face = { room: L_SHAPE.room.a, wallId: L_SHAPE.wall.wPart, side: 'L', faceId: 'a:w-part:L' };
    const error = errorOf(() => parseSceneOps([{ op: 'set_material', target: face, material: FINISH.sage }]));

    expect(error.code).toBe('scene-invalid');
    expect(error.path).toBe('[0].target');
  });

  test('refuses a face target joined into a string, and a reference that is not a UUID v7', () => {
    expect(errorOf(() => parseSceneOps([{ op: 'set_material', target: 'a:w-part:L', material: FINISH.sage }])).path).toBe('[0].target');
    expect(errorOf(() => parseSceneOps([{ op: 'remove_opening', openingId: 'door-ab' }])).path).toBe('[0].openingId');
  });

  test('refuses an add_opening without the id its caller mints', () => {
    const error = errorOf(() => parseSceneOps([{ op: 'add_opening', wallId: L_SHAPE.wall.wW, type: 'window', center: 1, width: 1.2 }]));

    expect(error.path).toBe('[0].id');
  });

  test('refuses an operation the vocabulary does not have', () => {
    const error = errorOf(() => parseSceneOps([{ op: 'launch_rocket', thrust: 9 }]));

    expect(error.code).toBe('scene-invalid');
    expect(error.path).toBe('[0].op');
  });
});

describe('parseSceneDocument', () => {
  test('returns the very document it was handed', () => {
    expect(parseSceneDocument(apartmentScene)).toBe(apartmentScene);
  });

  test('refuses a document whose shape is wrong and says where', () => {
    const broken = { ...apartmentScene, ceilingHeight: 'high' };

    const error = errorOf(() => parseSceneDocument(broken));

    expect(error.code).toBe('scene-invalid');
    expect(error.path).toBe('ceilingHeight');
    expect(error.message).toStartWith('parseSceneDocument: ceilingHeight');
  });

  test.each(['1.1', '1.2'])('refuses a %s document with the sentence that names the accepted version', (version) => {
    const error = errorOf(() => parseSceneDocument({ ...apartmentScene, schemaVersion: version }));

    expect(error.code).toBe('scene-invalid');
    expect(error.path).toBe('schemaVersion');
    expect(issuesOf(error)[0]?.message).toContain('schemaVersion must be 2.x');
    expect(error.message).not.toContain('README');
  });

  test('refuses a scene id that is not a UUID v7', () => {
    expect(errorOf(() => parseSceneDocument({ ...apartmentScene, id: 'apartment' })).path).toBe('id');
  });

  test('refuses a value that is not an object at all', () => {
    expect(errorOf(() => parseSceneDocument(null)).code).toBe('scene-invalid');
  });

  test('a key the document chose comes back bounded: no url, only a short prefix', () => {
    // A record key is part of the issue's path, and the path is part of the
    // sentence the bridge hands the embedder.
    const key = `https://intranet.example/secret/${'k'.repeat(200)}`;
    const error = errorOf(() => parseSceneDocument({ ...apartmentScene, finishes: { rooms: { [key]: 5 } } }));
    expect(error.code).toBe('scene-invalid');
    expect(error.path).toBe('finishes.rooms.<url>');
    for (const text of [error.message, JSON.stringify(error.detail)]) expect(text).not.toContain('intranet.example');
  });
});
