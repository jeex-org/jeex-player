/**
 * `registriesFromLibrary` and the multi-library half of `SceneRegistries`.
 *
 * Two questions are asked here and nowhere else: does a library manifest turn
 * into registries the scene layer can validate against, and does a document
 * that names one of several libraries pass `validateScene` while a document
 * that names a library nobody declared does not.
 */

import { describe, expect, test } from 'bun:test';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { interiorLibrary } from '../assets/asset-catalogue.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { draftOf, type Draft } from '../shared/committed.js';
import { assetRefOf, findArchetype, registriesFromLibrary, type ProjectLibrary } from './registries.js';
import { validateScene } from './scene-validator.js';
import type { SceneData } from './types.js';
import { ARCHETYPE, OPENING_VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';

/**
 * Fixed ids for these tests, generated once offline. A project library is
 * addressed by its project's UUID; its objects, variants and materials by
 * their own.
 */
const ID = {
  showroom: '01a12ff6-24e8-7837-aad4-0e2b79ddb1a3',
  sofaShow: '01a12ff6-24e9-73b3-b0fe-25b1d5fc3259',
  sofaShowLinen: '01a12ff6-24ea-78fa-9ad7-bc3d2ac10219',
  sofaShowWool: '01a12ff6-24eb-743d-9cf2-c42c51a289cd',
  rugShow: '01a12ff6-24ec-7e2c-afc8-1b87d13a045f',
  rugShowSand: '01a12ff6-24ed-7331-94c0-c521db55d71f',
  showroomOak: '01a12ff6-24ee-7759-989c-6086fb6d387d',
  showroomClay: '01a12ff6-24ef-7d3e-963c-66eeaf401a62',
  showroomBoucle: '01a12ff6-24f0-78f1-9c3a-ce153de58bf4',
  wallsLibrary: '01a12ff6-24f1-7cac-ae5e-c9503032b568',
  clay: '01a12ff6-24f2-778b-aa0a-214e2eb49e52',
  bareLibrary: '01a12ff6-24f3-746e-8115-c68130568930',
  shadowLibrary: '01a12ff6-24f4-7191-815d-0f295a798c49',
  sofa3sOwn: '01a12ff6-24f5-7dc5-84a8-29ddd2c5e2e2',
  unobtanium: '01a12ff6-24f6-7c5a-9a20-596b3f9767b8',
  placement: '01a12ff6-24f7-7d35-abd1-c79f9407db4b',
  nowhere: '01a12ff6-24f8-7a3c-9e51-c6d0b84f2a17',
} as const;

/** A project library in the shape of a library manifest plus its own finishes. */
const showroom: ProjectLibrary = {
  id: ID.showroom,
  objects: [
    {
      id: ID.sofaShow,
      defaultVariant: ID.sofaShowLinen,
      variants: [{ id: ID.sofaShowLinen }, { id: ID.sofaShowWool }],
    },
    { id: ID.rugShow, defaultVariant: ID.rugShowSand, variants: [{ id: ID.rugShowSand }] },
  ],
  materials: [
    { id: ID.showroomOak, apply: ['floor'] },
    { id: ID.showroomClay, apply: ['wall'] },
    { id: ID.showroomBoucle, apply: ['fabric'] },
  ],
};

/** `lShapePlan` with one placement, from whichever library the test is about. */
function sceneWith(library: string | undefined, asset: string, variant?: string, own?: string): Draft<SceneData> {
  const scene = draftOf(lShapePlan);
  if (library === undefined) delete scene.assetLibrary;
  else scene.assetLibrary = library;
  scene.assets = [
    {
      id: L_SHAPE.asset.sofa,
      type: 'sofa',
      asset,
      ...(own === undefined ? {} : { library: own }),
      ...(variant === undefined ? {} : { variant }),
      position: { x: 2, z: 6, y: 0 },
      rotationY: 0,
    },
  ];
  return scene;
}

describe('registriesFromLibrary', () => {
  test('indexes the manifest objects under the library id', () => {
    const registries = registriesFromLibrary(showroom);

    const catalogue = registries.libraries.get(ID.showroom);
    expect(catalogue?.id).toBe(ID.showroom);
    expect(catalogue?.objects.get(ID.sofaShow)?.variants.map((variant) => variant.id)).toEqual([ID.sofaShowLinen, ID.sofaShowWool]);
  });

  test('without a base the manifest is the default library, so a bare id resolves against it', () => {
    const registries = registriesFromLibrary(showroom);

    expect(registries.defaultLibrary).toBe(ID.showroom);
    const placement = registries.resolvePlacement({ id: ID.placement, type: ID.sofaShow, position: { x: 0, y: 0, z: 0 } });
    expect(placement?.object.id).toBe(ID.sofaShow);
    expect(placement?.variant.id).toBe(ID.sofaShowLinen);
  });

  test('a variant a placement names wins over the archetype default', () => {
    const registries = registriesFromLibrary(showroom);

    const placement = registries.resolvePlacement({
      id: ID.placement,
      type: ID.sofaShow,
      variant: ID.sofaShowWool,
      position: { x: 0, y: 0, z: 0 },
    });
    expect(placement?.variant.id).toBe(ID.sofaShowWool);
  });

  test('an unknown archetype resolves to nothing rather than to the first one', () => {
    const registries = registriesFromLibrary(showroom);

    expect(registries.resolvePlacement({ id: ID.placement, type: ID.unobtanium, position: { x: 0, y: 0, z: 0 } })).toBeUndefined();
  });

  test('manifest materials are finishes, routed by what they may dress', () => {
    const registries = registriesFromLibrary(showroom);

    expect(registries.isFinish(ID.showroomOak)).toBe(true);
    expect(registries.finishKind(ID.showroomOak)).toBe('floor');
    expect(registries.finishKind(ID.showroomClay)).toBe('wall');
    // An object finish is a finish a placement slot may name, not a surface one.
    expect(registries.isFinish(ID.showroomBoucle)).toBe(true);
    expect(registries.finishKind(ID.showroomBoucle)).toBe(null);
    expect(registries.isSurfaceFinish(ID.showroomBoucle)).toBe(false);
    expect(registries.isKnownFinish(ID.showroomBoucle, [])).toBe(true);
  });

  test('a base keeps its own default library and its finishes, and gains the manifest', () => {
    const registries = registriesFromLibrary(showroom, CATALOGUE_REGISTRIES);

    expect(registries.defaultLibrary).toBe(CATALOGUE_REGISTRIES.defaultLibrary);
    expect([...registries.libraries.keys()].sort()).toEqual([CATALOGUE_REGISTRIES.defaultLibrary, ID.showroom].sort());
    expect(registries.isFinish(FINISH.oak)).toBe(true);
    expect(registries.isFinish(ID.showroomOak)).toBe(true);
    expect(registries.resolvePlacement({ id: ID.placement, type: 'sofa', position: { x: 0, y: 0, z: 0 } })?.object.id).toBe(
      ARCHETYPE.sofa_3s,
    );
  });

  test('the default floor finish comes from the library, and a base keeps its own', () => {
    // `add_room` without a `floorMaterial` has to name SOME finish, and a
    // project library that never heard of the bank's oak would have the validator refuse
    // the room the operation just made. So the registries answer it.
    expect(CATALOGUE_REGISTRIES.defaultFloorFinish).toBe(FINISH.oak);
    expect(registriesFromLibrary(showroom).defaultFloorFinish).toBe(ID.showroomOak);
    expect(registriesFromLibrary(showroom, CATALOGUE_REGISTRIES).defaultFloorFinish).toBe(FINISH.oak);
  });

  test('a library whose materials dress no floor, and one with no materials at all', () => {
    const wallsOnly: ProjectLibrary = { id: ID.wallsLibrary, objects: [], materials: [{ id: ID.clay, apply: ['wall'] }] };
    // No floor finish declared: the first material is the best answer there is.
    expect(registriesFromLibrary(wallsOnly).defaultFloorFinish).toBe(ID.clay);
    // Nothing at all: the registries say so rather than inventing a catalogue id.
    expect(registriesFromLibrary({ id: ID.bareLibrary, objects: [] }).defaultFloorFinish).toBeUndefined();
  });

  test('the opening variants of a type, in offering order, for an editor to list', () => {
    const windows = CATALOGUE_REGISTRIES.openingVariantsOf('window');
    expect(windows.map((variant) => variant.id)).toContain(OPENING_VARIANT.window_pvc_white);
    expect(windows.every((variant) => variant.for === 'window')).toBe(true);
    // A name, because a `<select>` shows a label and submits an id.
    expect(windows[0]?.name.length).toBeGreaterThan(0);

    // A passage takes the door frames, and the entrance sets are their own bank.
    expect(CATALOGUE_REGISTRIES.openingVariantsOf('passage')).toEqual(CATALOGUE_REGISTRIES.openingVariantsOf('door'));
    const entrance = CATALOGUE_REGISTRIES.openingVariantsOf('door', { entrance: true });
    expect(entrance.every((variant) => variant.entrance === true)).toBe(true);
    expect(entrance.map((variant) => variant.id)).not.toEqual(CATALOGUE_REGISTRIES.openingVariantsOf('door').map((v) => v.id));

    // Every listed variant resolves, so an editor's `<select>` cannot offer one
    // `replace_opening_variant` would refuse.
    for (const variant of [...windows, ...entrance]) expect(CATALOGUE_REGISTRIES.findOpeningVariant(variant.id)).toBeTruthy();
  });

  test('a base is the FALLBACK bank of the manifest, not a bank beside it', () => {
    // Two entrances, one validator, and the shipped bank stays the fallback
    // until the builders are removed. A document of a project library still
    // carries legacy `type` placements no exporter has rewritten, and refusing
    // them would be a defect in the host editor.
    const registries = registriesFromLibrary(showroom, CATALOGUE_REGISTRIES);
    const under = (assetId: string): string | undefined => findArchetype(registries, { library: ID.showroom, assetId })?.id;

    expect(under(ID.sofaShow)).toBe(ID.sofaShow);
    // A VARIANT id of the project library, which the library map does not key.
    expect(under(ID.sofaShowWool)).toBe(ID.sofaShow);
    // The shipped bank behind it: an archetype id, and a legacy `type` alias.
    expect(under(ARCHETYPE.sofa_3s)).toBe(ARCHETYPE.sofa_3s);
    expect(under('sofa')).toBe(ARCHETYPE.sofa_3s);
    // A library nobody declared is still a reference nothing can prove.
    expect(findArchetype(registries, { library: 'remote:nope', assetId: ARCHETYPE.sofa_3s })).toBeUndefined();
  });

  test('a project entry with the same id as a bank entry wins', () => {
    const shadowing: ProjectLibrary = {
      id: ID.shadowLibrary,
      objects: [{ id: ARCHETYPE.sofa_3s, defaultVariant: ID.sofa3sOwn, variants: [{ id: ID.sofa3sOwn }] }],
    };
    const registries = registriesFromLibrary(shadowing, CATALOGUE_REGISTRIES);

    expect(registries.findCatalogueEntry(ARCHETYPE.sofa_3s)?.object.variants.map((variant) => variant.id)).toEqual([ID.sofa3sOwn]);
  });

  test('a manifest declares no opening variants of its own, and a base lends its bank', () => {
    expect(registriesFromLibrary(showroom).openingVariantsOf('door')).toEqual([]);
    expect(registriesFromLibrary(showroom, CATALOGUE_REGISTRIES).openingVariantsOf('door').length).toBeGreaterThan(0);
  });

  test('the starter registries carry the shipped library under its own id', () => {
    const catalogue = CATALOGUE_REGISTRIES.libraries.get(CATALOGUE_REGISTRIES.defaultLibrary);

    expect(catalogue?.id).toBe(interiorLibrary.id);
    expect(catalogue?.objects.get(ARCHETYPE.sofa_3s)?.id).toBe(ARCHETYPE.sofa_3s);
  });
});

describe('assetRefOf', () => {
  test('builds a reference from the fields: the placement library, else the default it is handed', () => {
    const sofa = ARCHETYPE.sofa_3s;
    expect(assetRefOf({ type: sofa, asset: sofa, library: ID.showroom }, ID.nowhere)).toEqual({ library: ID.showroom, assetId: sofa });
    expect(assetRefOf({ type: sofa, asset: sofa }, ID.nowhere)).toEqual({ library: ID.nowhere, assetId: sofa });
    // A legacy type word is the id when the placement names no asset.
    expect(assetRefOf({ type: 'sofa' }, interiorLibrary.id)).toEqual({ library: interiorLibrary.id, assetId: 'sofa' });
    // Nothing is parsed: a composite string stays one (unresolvable) id.
    expect(assetRefOf({ type: sofa, asset: `x:${sofa}` }, ID.nowhere)).toEqual({ library: ID.nowhere, assetId: `x:${sofa}` });
  });
});

describe('validateScene against several libraries', () => {
  test('accepts a document whose assetLibrary is declared by the registries', () => {
    const scene = sceneWith(ID.showroom, ID.sofaShow, ID.sofaShowLinen);

    expect(() => validateScene(scene, registriesFromLibrary(showroom, CATALOGUE_REGISTRIES))).not.toThrow();
  });

  test('accepts a placement that names its own library in a document that names none', () => {
    const scene = sceneWith(undefined, ID.sofaShow, ID.sofaShowLinen, ID.showroom);

    expect(() => validateScene(scene, registriesFromLibrary(showroom, CATALOGUE_REGISTRIES))).not.toThrow();
  });

  test('a placement library wins over the document one', () => {
    // The document's library is declared; the placement's own is not, and it is the one read.
    const scene = sceneWith(ID.showroom, ID.sofaShow, undefined, ID.nowhere);

    expect(() => validateScene(scene, registriesFromLibrary(showroom, CATALOGUE_REGISTRIES))).toThrow(
      new RegExp(`unknown asset library ${ID.nowhere}`),
    );
  });

  test('accepts a legacy `type` placement in a document that names the project library', () => {
    const scene = sceneWith(ID.showroom, ID.sofaShow);
    delete scene.assets[0]!.asset;

    expect(() => validateScene(scene, registriesFromLibrary(showroom, CATALOGUE_REGISTRIES))).not.toThrow();
  });

  test('refuses a document whose assetLibrary nobody declared', () => {
    const scene = sceneWith(ID.nowhere, ARCHETYPE.sofa_3s);

    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).toThrow(new RegExp(`unknown asset library ${ID.nowhere}`));
  });

  test('refuses a placement reaching into a library the registries do not carry', () => {
    const scene = sceneWith(undefined, ARCHETYPE.sofa_3s, undefined, ID.nowhere);

    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).toThrow(new RegExp(`unknown asset library ${ID.nowhere}`));
  });

  test('refuses an archetype the named library does not have', () => {
    const scene = sceneWith(ID.showroom, ID.unobtanium);

    expect(() => validateScene(scene, registriesFromLibrary(showroom, CATALOGUE_REGISTRIES))).toThrow(
      new RegExp(`unknown catalogue asset ${ID.unobtanium}`),
    );
  });

  test('the demo path is unchanged: no assetLibrary means the default one', () => {
    expect(() => validateScene(draftOf(lShapePlan), CATALOGUE_REGISTRIES)).not.toThrow();
  });
});
