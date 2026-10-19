/**
 * The public `jeex-viewer/ops` entry: a façade test, not a behaviour test —
 * `scene-ops.test.ts` and `scene-model.test.ts` already cover the op
 * vocabulary and the revision machinery this module only re-exports.
 *
 * Two things are proven here that no other test proves:
 *
 * - the entry is REACHABLE and USABLE entirely on its own — `SceneModel` and
 *   `applyOp`, both imported from `./ops.js` alone, accept a real op against
 *   the demo apartment (also imported the way an editor host would: as data, not
 *   through the library graph — `purity.test.ts`'s `embed-carries-no-demo`
 *   rule still holds, since a TEST may reach the fixture at any level);
 * - the export surface is EXACTLY the module header's documented list, so a
 *   future export added to `scene-ops.ts` or `scene-model.ts` does not widen
 *   the hosts' public API through this façade by accident.
 */

import { describe, expect, test } from 'bun:test';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import { ARCHETYPE } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { draftOf } from '../shared/committed.js';
import {
  CATALOGUE_ID_BY_SLUG,
  CATALOGUE_REGISTRIES,
  SceneModel,
  applyOp,
  isApplyOk,
  isUuidV7,
  lintLayout,
  parseSceneDocument,
  parseSceneOps,
  registriesFromLibrary,
  type OpeningVariantOption,
  type PlaceObjectOp,
  type ProjectLibrary,
  type SceneOp,
  type SetRoomOp,
} from './ops.js';

/** A project library's own ids, as its bake minted them. */
const PROJECT = {
  library: '01a12ff4-099f-7bed-adff-a116f472e745',
  sofa: '01a12ff4-09a0-7dca-b724-596c28f12f0e',
  sofaLinen: '01a12ff4-09a1-7f9f-9d50-ee08614ee99b',
  oak: '01a12ff4-09a2-7018-8fea-ead31d071c1f',
} as const;

/** Ids a host minted for the operations below. */
const MINTED = { placement: '01a12ff4-09a3-7621-bbc8-b076ff8252e9' } as const;

describe('jeex-viewer/ops entry', () => {
  test('SceneModel.apply commits a set_ceiling op through the entry and advances the revision', () => {
    const model = new SceneModel(apartmentScene, CATALOGUE_REGISTRIES);
    const baseRev = model.rev;
    const nextHeight = apartmentScene.ceilingHeight + 0.05;

    const result = model.apply({ baseRev, ops: [{ op: 'set_ceiling', height: nextHeight }] });

    if (!isApplyOk(result)) throw new Error(`expected the op to be accepted, got ${JSON.stringify(result)}`);
    expect(result.rev).toBe(baseRev + 1);
    expect(model.rev).toBe(baseRev + 1);
    expect(model.scene.ceilingHeight).toBe(nextHeight);
  });

  test('applyOp mutates a draft directly, the low-level half of the same vocabulary', () => {
    const draft = draftOf(apartmentScene);
    const nextHeight = apartmentScene.ceilingHeight + 0.1;
    const op: SceneOp = { op: 'set_ceiling', height: nextHeight };

    const outcome = applyOp(draft, op, CATALOGUE_REGISTRIES);

    expect(draft.ceilingHeight).toBe(nextHeight);
    expect(outcome.summary).toStartWith('Ceiling height set to');
  });

  test('the editor-host path works end to end through the entry alone', () => {
    // A document that names a project library, parsed through the entry,
    // validated against registries the entry built, applied with the entry's
    // own linter injected — the three parsing and registry names, used together.
    const library: ProjectLibrary = {
      id: PROJECT.library,
      objects: [{ id: PROJECT.sofa, defaultVariant: PROJECT.sofaLinen, variants: [{ id: PROJECT.sofaLinen }] }],
      materials: [{ id: PROJECT.oak, apply: ['floor'] }],
    };
    const registries = registriesFromLibrary(library, CATALOGUE_REGISTRIES);
    expect(registries.libraries.get(PROJECT.library)?.objects.get(PROJECT.sofa)?.id).toBe(PROJECT.sofa);

    const document = parseSceneDocument(apartmentScene);
    expect(document).toBe(apartmentScene);

    const model = new SceneModel(document, CATALOGUE_REGISTRIES, { lint: lintLayout });
    const ops = parseSceneOps([{ op: 'set_ceiling', height: 2.7 }]);
    const result = model.apply({ baseRev: model.rev, ops, lint: 'strict' });

    if (!isApplyOk(result)) throw new Error(`expected the batch to commit, got ${result.error}: ${result.message}`);
    expect(result.rev).toBe(1);
  });

  test('parseSceneOps refuses a batch the vocabulary does not know', () => {
    expect(() => parseSceneOps([{ op: 'launch_rocket' }])).toThrow(/parseSceneOps/);
  });

  test('the registries answer the two questions an editor panel asks before it edits', () => {
    // The openings panel offers a `<select>` of
    // variants rather than a text field, and the room panel shows the floor a
    // new room will start on. Both are answered through the entry alone.
    const doors = CATALOGUE_REGISTRIES.openingVariantsOf('door');
    expect(doors.length).toBeGreaterThan(0);
    const option: OpeningVariantOption = doors[0]!;
    expect(option.for).toBe('door');
    expect(typeof option.name).toBe('string');

    expect(CATALOGUE_REGISTRIES.defaultFloorFinish).toBe(FINISH.oak);
    const library: ProjectLibrary = { id: PROJECT.library, objects: [], materials: [{ id: PROJECT.oak, apply: ['floor'] }] };
    expect(registriesFromLibrary(library).defaultFloorFinish).toBe(PROJECT.oak);
  });

  test('an op type can be named on its own, not only through the union', () => {
    // What the export list gains for an editor: one panel, one operation type.
    const rename: SetRoomOp = { op: 'set_room', roomId: DEMO.room.kitchen, name: 'Kitchen' };
    const place: PlaceObjectOp = { op: 'place_object', id: MINTED.placement, asset: ARCHETYPE.sofa_3s, position: { x: 1, y: 0, z: 1 } };
    const batch: SceneOp[] = [rename, place];
    expect(batch.map((op) => op.op)).toEqual(['set_room', 'place_object']);
  });

  test("a host checks ids with the validator's own rule and translates 1.x catalogue slugs", () => {
    expect(isUuidV7(MINTED.placement)).toBe(true);
    expect(isUuidV7('2c8f5b8e-3d5a-4a8e-9f6b-1c2d3e4f5a6b')).toBe(false);
    expect(CATALOGUE_ID_BY_SLUG.archetype['sofa_3s']).toBe(ARCHETYPE.sofa_3s);
    expect(CATALOGUE_ID_BY_SLUG.finish['oak']).toBe(FINISH.oak);
  });

  test('the export surface is exactly the documented list, sorted', async () => {
    // Verbatim against the header comment of `ops.ts`: one entry per name it
    // promises. Type-only exports (`OpOutcome`, `SceneOp`, `ApplyBatch`, …)
    // carry no runtime binding under `verbatimModuleSyntax`, so they never
    // appear in `Object.keys` of the imported namespace and are not listed.
    const documented = [
      'applyOp',
      'OpError',
      'floorFinishOf',
      'roomWallFinishOf',
      'facadeFinishOf',
      'faceFinishOf',
      'TOUCHED_SHELL',
      'TOUCHED_FACADE',
      'isTouchedAsset',
      'SceneModel',
      'isApplyOk',
      'validateScene',
      'parseSceneOps',
      'parseSceneDocument',
      'parseProjectManifest',
      'projectLibraryOf',
      'registriesFromLibrary',
      'solvePlan',
      'lintLayout',
      'countIssues',
      'describeIssues',
      'applyPresetBatch',
      'findPreset',
      'standardPreset',
      'presetCoverage',
      'presetBatchOps',
      'sceneSchema',
      'sceneOpSchema',
      'isSceneShape',
      'sceneShapeIssues',
      'OPENING_TYPES',
      'ROOM_KINDS',
      'WALL_ROLES',
      'CATALOGUE_REGISTRIES',
      // What format converters take from the viewer through this entry:
      // plan geometry, the graph, openings, tolerances, errors and the id vocabulary.
      'EPS_PLANAR',
      'arcFromChord',
      'arcLength',
      'arcPointAt',
      'closestOnSegment',
      'dist',
      'distanceToPolygon',
      'dot',
      'pointInPolygon',
      'sub',
      'buildGraph',
      'OPENING_EDGE_MARGIN',
      'clampOpening',
      'effectiveOpening',
      'DEFAULT_TOLERANCE',
      'quantiseKey',
      'ViewerLibError',
      'isViewerLibError',
      'badParams',
      'issueDetail',
      'issuePath',
      'WALL_LIMITS',
      'isDoorLike',
      // Identifiers: the check, never a generator;
      // the face key helpers; the shipped bank's slug -> UUID tables for 1.x documents.
      'UUID_V7_PATTERN',
      'isUuidV7',
      'faceKey',
      'sameFace',
      'isFaceKey',
      'CATALOGUE_ID_BY_SLUG',
      // What a host editor takes from the viewer for the plan underlay:
      // the fit margin and the conversion of plan metres to canvas pixels.
      'fitTransform',
      'PLAN_PADDING',
      // The free-space helper for a catalogue dialog: the pose request and the baked-project catalogue builder the
      // caller fills `PlacementRequest.catalogue` with.
      'suggestPlacement',
      'projectLayoutCatalogue',
      // Tour checkpoints: whether a document rides its cameras; the route itself stays inside the viewer.
      'hasTourRoute',
    ].sort();

    const entry: Record<string, unknown> = await import('./ops.js');
    expect(Object.keys(entry).sort()).toEqual(documented);
  });
});
