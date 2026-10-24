/**
 * `SceneMount.present` (turning ONE object must not redraw ALL objects): a host that answers each committed edit with the
 * whole next document must see only the placements that edit named change on
 * screen. Every other placement keeps its group, its body and its loaded model,
 * and nothing is downloaded again.
 *
 * Real model, real builder, real picker and animator; the dollhouse, the UI
 * and the GLB source are stand-ins (no WebGL is needed to build or to compare
 * object identity).
 */

import { projectAssetFacts, shippedAssetFacts, type AssetFactsSource } from '../assets/asset-facts.js';
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import * as THREE from 'three';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FurnitureAnimator } from '../geometry/furniture-animator.js';
import type { ModelOutcome } from '../geometry/model-source.js';
import { Picker } from '../geometry/picker.js';
import { FURNITURE_GROUP_NAME, SceneBuilder } from '../geometry/scene-builder.js';
import { SceneModel } from '../scene/scene-model.js';
import { draftOf } from '../shared/committed.js';
import type { Draft } from '../shared/committed.js';
import type { SceneData } from '../scene/types.js';
import { createMessages } from '../ui/messages.js';
import { editsWiring } from './edits-wiring.js';
import type { LoadedDocument } from './project-wiring.js';
import { SceneMount } from './scene-mount.js';
import { shippedFacts } from '../layout/layout-lint.js';
import { resolveViewerOptions } from './viewer-options.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { ApartmentRig } from '../lighting/lighting-context.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProjectManifest } from '../assets/project-manifest.schema.js';
import { registriesFromLibrary } from '../scene/registries.js';
import { projectLibraryOf } from '../assets/project-manifest.js';
import { projectContext } from './project-wiring.js';
import { tintArtificialLights } from '../render/light-temperature.js';
import { lampLightTag } from '../assets/artificial-light.js';
import { LAMP_PROJECT_FIXTURE as LAMPS } from '../../tests/fixtures/project/fixture-ids.js';
import type { BakeTarget, LightBakeWiring } from '../lightmap/light-bake-wiring.js';
import { FINISH } from '../materials/finish-ids.js';
import { isApplyOk } from '../scene/scene-model.js';

const SOFA = L_SHAPE.asset.sofa;
const TABLE = L_SHAPE.asset.table;
/** A placement no fixture carries, for the «added» case. */
const LAMP = '01a1318c-6a3e-7c55-9d0b-3c5f2f6b1a01';
/** The same library for every load in this file; another key is another library. */
const KEY = 'library-under-test';
/** The stand-in model is a plain box, which the GLB checks rightly call a defect; not this file's subject. */
const QUIET = { warn: () => {}, error: () => {} };

/** Every whole-document build in this file, counted without changing what it does. */
const builds = spyOn(SceneBuilder.prototype, 'build');
const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;
beforeAll(() => {
  // `nextFrame` waits for a frame; bun has none, so a timer stands in for it.
  const frames = new Map<number, ReturnType<typeof setTimeout>>();
  let next = 0;
  globalThis.requestAnimationFrame = (callback) => {
    next += 1;
    frames.set(
      next,
      setTimeout(() => callback(performance.now()), 0),
    );
    return next;
  };
  globalThis.cancelAnimationFrame = (handle) => {
    clearTimeout(frames.get(handle));
    frames.delete(handle);
  };
});
afterAll(() => {
  builds.mockRestore();
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
});

type Rig = {
  mount: SceneMount;
  scene: THREE.Scene;
  /** Model downloads, one entry per request. */
  downloads: string[];
  /** Documents re-seeded, in order. */
  seeded: SceneModel[];
  /** Model passes reported as settled: the document and its outcome. */
  settled: Array<{ model: SceneModel; upgraded: number; failed: number }>;
  /** How many times the whole document was built. */
  builds: () => number;
  load: (document: SceneData, key?: string) => LoadedDocument;
  seededFacts: AssetFactsSource[];
  /** Redraws the mount asked the runtime for (`RenderDemand.invalidate`). */
  invalidations: () => number;
};

function rig(sunRig?: ApartmentRig, artificialLights?: (root: THREE.Object3D) => void, lightBake?: LightBakeWiring): Rig {
  const scene = new THREE.Scene();
  const downloads: string[] = [];
  const seeded: SceneModel[] = [];
  /** `mount.assetFacts()` as `onDocument` read it, one per seed. */
  const seededFacts: AssetFactsSource[] = [];
  const settled: Rig['settled'] = [];
  const buildsBefore = builds.mock.calls.length;
  let invalidations = 0;
  const demand = { invalidate: () => (invalidations += 1) };
  const ui = {
    showDegradedNotice: () => {},
    closePanel: () => {},
    openPanel: () => {},
    setHint: () => {},
    wakeControls: () => {},
    setProjectMark: () => {},
  };
  const dollhouse = { prepare: () => {}, isExterior: () => false, update: () => {} };
  const mount = new SceneMount({
    runtime: () => ({ scene, demand, ...(sunRig && { sunRig }) }),
    picker: new Picker({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }),
    dollhouse: dollhouse as unknown as Dollhouse,
    animator: new FurnitureAnimator(),
    ui: ui as unknown as ViewerUI,
    messages: createMessages('en'),
    renderPreview: () => null,
    edits: editsWiring(resolveViewerOptions({}), () => {}),
    onDocument: (model) => {
      seeded.push(model);
      seededFacts.push(mount.assetFacts());
    },
    onAssetsChanged: () => {},
    onModelsSettled: (model, result) => settled.push({ model, upgraded: result.upgraded, failed: result.failed }),
    ...(artificialLights && { artificialLights }),
    onError: (error) => {
      throw new Error(error.message);
    },
    ...(lightBake && { lightBake }),
  });
  const modelSource = (request: { url: string }): Promise<ModelOutcome> => {
    downloads.push(request.url);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), new THREE.MeshStandardMaterial()));
    return Promise.resolve({ group, triangles: 12, warnings: [], bytes: 16 });
  };
  const load = (document: SceneData, key = KEY): LoadedDocument => {
    const model = new SceneModel(document, CATALOGUE_REGISTRIES);
    return {
      model,
      project: {
        key,
        // A manifest with no `mark`: the mount hands it to the UI.
        info: { manifest: {}, baseUrl: '' } as never,
        facts: shippedAssetFacts,
        registries: CATALOGUE_REGISTRIES,
        variants: undefined as never,
        builderOptions: { modelUrl: (asset) => `https://models.test/${asset.variantId}.glb`, modelSource, log: QUIET },
      },
    };
  };
  return {
    mount,
    scene,
    downloads,
    seeded,
    seededFacts,
    settled,
    builds: () => builds.mock.calls.length - buildsBefore,
    load,
    invalidations: () => invalidations,
  };
}

/** Lets the frame-paced GLB upgrade pass run to its end. */
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1);
    });
  }
}

function edited(change: (draft: Draft<SceneData>) => void): SceneData {
  const draft = draftOf(lShapePlan);
  change(draft);
  return draft;
}

/** The group that IS the placement's body now: the LAST of its name, as a swap adds before its tween removes. */
function placementGroup(mount: SceneMount, id: string): THREE.Group {
  const group = mount.sceneRoot?.getObjectByName(FURNITURE_GROUP_NAME)?.children.findLast((child) => child.name === id);
  if (!(group instanceof THREE.Group)) throw new Error(`no group for ${id}`);
  return group;
}

/** Every mesh under a placement group, the identities a rebuild would replace. */
function bodyMeshes(group: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

async function mounted(): Promise<Rig & { table: THREE.Group; tableMeshes: THREE.Mesh[]; sofa: THREE.Group; root: THREE.Group }> {
  const subject = rig();
  subject.mount.mountDocument(subject.load(lShapePlan));
  await settle();
  const table = placementGroup(subject.mount, TABLE);
  const sofa = placementGroup(subject.mount, SOFA);
  return { ...subject, table, sofa, tableMeshes: bodyMeshes(table), root: subject.mount.sceneRoot! };
}

describe('a committed edit of one placement leaves every other placement alone', () => {
  test('a move and a turn stand the SAME group anew: no build, no download, the other body untouched', async () => {
    const subject = await mounted();
    expect(subject.downloads).toHaveLength(2);
    expect(subject.table.userData['modelState']).toBe('gltf');
    const buildsBefore = subject.builds();

    subject.mount.present(
      subject.load(
        edited((draft) => {
          const sofa = draft.assets.find((asset) => asset.id === SOFA)!;
          sofa.position = { x: 2.5, y: 0, z: 5.5 };
          sofa.rotationY = Math.PI / 12;
        }),
      ),
    );
    await settle();

    expect(subject.mount.sceneRoot).toBe(subject.root);
    expect(subject.builds()).toBe(buildsBefore);
    expect(subject.downloads).toHaveLength(2);
    expect(placementGroup(subject.mount, TABLE)).toBe(subject.table);
    expect(bodyMeshes(subject.table)).toEqual(subject.tableMeshes);
    const sofa = placementGroup(subject.mount, SOFA);
    expect(sofa).toBe(subject.sofa);
    expect(sofa.userData['modelState']).toBe('gltf');
    expect(sofa.position.x).toBeCloseTo(2.5);
    expect(sofa.position.z).toBeCloseTo(5.5);
    expect(subject.mount.model?.scene.assets.find((asset) => asset.id === SOFA)?.rotationY).toBeCloseTo(Math.PI / 12);
  });

  test('the turn reaches the group: its yaw changes by exactly the committed angle', async () => {
    const subject = await mounted();
    const before = subject.sofa.rotation.y;
    subject.mount.present(
      subject.load(
        edited((draft) => {
          draft.assets.find((asset) => asset.id === SOFA)!.rotationY = -Math.PI / 6;
        }),
      ),
    );
    expect(subject.sofa.rotation.y - before).toBeCloseTo(-Math.PI / 6);
  });

  test('a new scale and room reach the same group: its scale, room tag and the walk footprint it carries', async () => {
    const subject = await mounted();
    const collision = subject.sofa.userData['collision'];
    subject.mount.present(
      subject.load(
        edited((draft) => {
          const sofa = draft.assets.find((asset) => asset.id === SOFA)!;
          sofa.scale = 1.2;
          sofa.room = L_SHAPE.room.b;
        }),
      ),
    );
    await settle();
    expect(placementGroup(subject.mount, SOFA)).toBe(subject.sofa);
    expect(subject.sofa.scale.x).toBeCloseTo(1.2);
    expect(subject.sofa.userData['roomId']).toBe(L_SHAPE.room.b);
    // The footprint is the unscaled one, exactly as a fresh build tags it.
    expect(subject.sofa.userData['collision']).toEqual(collision);
    expect(subject.downloads).toHaveLength(2);
  });

  test('a mirror reflects the same body in place', async () => {
    const subject = await mounted();
    subject.mount.present(
      subject.load(
        edited((draft) => {
          draft.assets.find((asset) => asset.id === SOFA)!.mirror = { x: true };
        }),
      ),
    );
    await settle();
    expect(placementGroup(subject.mount, SOFA)).toBe(subject.sofa);
    expect(subject.sofa.userData['mirror']).toEqual(['x']);
    expect(placementGroup(subject.mount, TABLE)).toBe(subject.table);
    expect(subject.downloads).toHaveLength(2);
  });

  test('a new finish builds THAT body again and downloads only its model', async () => {
    const subject = await mounted();
    subject.mount.present(
      subject.load(
        edited((draft) => {
          draft.assets.find((asset) => asset.id === SOFA)!.material = lShapePlan.assets.find((asset) => asset.id === TABLE)!.material!;
        }),
      ),
    );
    await settle();
    expect(subject.mount.sceneRoot).toBe(subject.root);
    expect(placementGroup(subject.mount, SOFA)).not.toBe(subject.sofa);
    expect(placementGroup(subject.mount, TABLE)).toBe(subject.table);
    expect(bodyMeshes(subject.table)).toEqual(subject.tableMeshes);
    expect(subject.downloads).toHaveLength(3);
  });

  test('a placement added or removed is the only group that comes or goes', async () => {
    const subject = await mounted();
    const sofa = lShapePlan.assets.find((asset) => asset.id === SOFA)!;
    subject.mount.present(
      subject.load(
        edited((draft) => {
          draft.assets = [
            ...draft.assets.filter((asset) => asset.id !== SOFA),
            { ...draftOf(sofa), id: LAMP, position: { x: 3, y: 0, z: 4 } },
          ];
        }),
      ),
    );
    await settle();
    const furniture = subject.mount.sceneRoot!.getObjectByName(FURNITURE_GROUP_NAME)!;
    expect(furniture.children.map((child) => child.name).sort()).toEqual([LAMP, TABLE].sort());
    expect(placementGroup(subject.mount, TABLE)).toBe(subject.table);
    expect(subject.sofa.parent).toBeNull();
  });

  test('every commit re-seeds the document once, and the model keeps counting revisions', async () => {
    const subject = await mounted();
    const model = subject.mount.model!;
    expect(subject.seeded).toEqual([model]);
    subject.mount.present(
      subject.load(
        edited((draft) => {
          draft.assets.find((asset) => asset.id === SOFA)!.rotationY = 1;
        }),
      ),
    );
    expect(subject.mount.model).toBe(model);
    expect(model.rev).toBe(1);
    expect(subject.seeded).toEqual([model, model]);
    // The same document again commits nothing and still answers the load.
    subject.mount.present(subject.load(model.toJSON()));
    expect(model.rev).toBe(1);
    expect(subject.seeded).toHaveLength(3);
  });
});

describe('what is not a revision of the document on screen is mounted from scratch', () => {
  test('another library', async () => {
    const subject = await mounted();
    subject.mount.present(subject.load(lShapePlan, 'another-library'));
    expect(subject.mount.sceneRoot).not.toBe(subject.root);
  });

  test('another scene', async () => {
    const subject = await mounted();
    subject.mount.present(subject.load({ ...lShapePlan, id: '01a1318c-6a3f-7d11-8e2a-4b6d0c9e7f02' }));
    expect(subject.mount.sceneRoot).not.toBe(subject.root);
  });

  test('a plan change rebuilds the root but keeps the mounted model', async () => {
    const subject = await mounted();
    const model = subject.mount.model;
    subject.mount.present(subject.load({ ...lShapePlan, ceilingHeight: lShapePlan.ceilingHeight + 0.2 }));
    expect(subject.mount.model).toBe(model);
    expect(subject.mount.sceneRoot).not.toBe(subject.root);
  });
});

describe('the model pass outcome', () => {
  test('the first pass of a mounted document is reported once; an edit is not', async () => {
    const subject = await mounted();
    expect(subject.settled.map((entry) => [entry.upgraded, entry.failed])).toEqual([[2, 0]]);
    subject.mount.present(
      subject.load(
        edited((draft) => {
          draft.assets.find((asset) => asset.id === SOFA)!.rotationY = Math.PI / 6;
        }),
      ),
    );
    await settle();
    expect(subject.settled).toHaveLength(1);
  });

  test('a pass cut short by another document is not reported', async () => {
    const subject = rig();
    const first = subject.load(lShapePlan);
    subject.mount.mountDocument(first);
    subject.mount.present(subject.load(lShapePlan, 'another-library'));
    await settle();
    expect(subject.settled.map((entry) => entry.model)).not.toContain(first.model);
    expect(subject.settled).toHaveLength(1);
  });
});

describe('what the mount changes on screen asks for a redraw (walk and tour draw on demand)', () => {
  test('a mount, every upgraded body, a commit and a plan rebuild each ask', async () => {
    const subject = rig();
    subject.mount.mountDocument(subject.load(lShapePlan));
    const afterMount = subject.invalidations();
    expect(afterMount).toBeGreaterThanOrEqual(1);
    await settle();
    // One per body the model pass swapped in.
    expect(subject.invalidations() - afterMount).toBe(subject.downloads.length);
    const beforeEdit = subject.invalidations();
    subject.mount.present(
      subject.load(
        edited((draft) => {
          draft.assets.find((asset) => asset.id === SOFA)!.position = { x: 2.5, y: 0, z: 5.5 };
        }),
      ),
    );
    expect(subject.invalidations()).toBeGreaterThan(beforeEdit);
    const beforePlan = subject.invalidations();
    expect(subject.mount.rebuild()).not.toBeNull();
    expect(subject.invalidations()).toBeGreaterThan(beforePlan);
  });
});

describe('a sun redraw asks for a redraw too', () => {
  test('the mounted sun reports its map redraws to the runtime demand', () => {
    const quiet = () => undefined;
    const sunRig = {
      kind: 'apartment',
      scene: null,
      shadowMapSize: 2048,
      shadowDraws: 0,
      attach: quiet,
      detach: quiet,
      dispose: quiet,
      setSunDirection: quiet,
      setShadowFrustum: quiet,
      markShadowDirty: quiet,
    } satisfies ApartmentRig;
    const subject = rig(sunRig);
    subject.mount.mountDocument(subject.load(lShapePlan));
    const before = subject.invalidations();
    subject.mount.sunShadow!.markDirty();
    expect(subject.invalidations()).toBe(before + 1);
  });
});

describe('the bank the document is drawn with answers its floor questions', () => {
  test('the project bank is current inside onDocument, survives a remount, and a bare scene resets it', () => {
    const r = rig();
    const facts = projectAssetFacts({ objects: [] });
    const loaded = r.load(lShapePlan);
    r.mount.mountDocument({ ...loaded, project: { ...loaded.project!, facts } });
    expect(r.seededFacts.at(-1)).toBe(facts);
    expect(r.mount.assetFacts()).toBe(facts);
    r.mount.remount();
    expect(r.seededFacts.at(-1)).toBe(facts);
    r.mount.mountDocument({ model: new SceneModel(lShapePlan, CATALOGUE_REGISTRIES), project: null });
    expect(r.seededFacts.at(-1)).toBe(shippedAssetFacts);
    expect(r.mount.layoutCatalogue()).toBe(shippedFacts);
  });
});

/**
 * A variant swap rebuilds the body through the loader, so it builds the NEW
 * variant's lamp lights (or none); the mount then applies the current light
 * temperature to the swapped group, as it does for every asset commit.
 */
describe("a variant swap builds the new variant's lamp lights under the current temperature", () => {
  const LAMP_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project-lamps');
  /** Two more variants of the fixture's table lamp: one unlit, one lit in a colder colour. */
  const UNLIT = '01a16c55-3d04-74c8-846e-8ac9f1c75335';
  const COLD = '01a16c55-3d04-74c9-9a88-945a30ab597a';
  const COLD_COLOUR = '#e8eeff';

  function lampManifest() {
    const raw = JSON.parse(readFileSync(join(LAMP_DIR, 'project.json'), 'utf8')) as {
      library: { objects: Array<{ variants: Array<Record<string, unknown>> }> };
    };
    const table = raw.library.objects[0]!;
    const base = table.variants[0]!;
    table.variants.push({ ...base, id: UNLIT, name: 'Table lamp, unlit' });
    delete table.variants[1]!['lights'];
    table.variants.push({
      ...base,
      id: COLD,
      name: 'Table lamp, cold',
      lights: [{ ...(base['lights'] as object[])[0], colour: COLD_COLOUR }],
    });
    return parseProjectManifest(raw);
  }

  function lampDocument(manifest: ReturnType<typeof lampManifest>, variant: string): LoadedDocument {
    const scene = draftOf(JSON.parse(readFileSync(join(LAMP_DIR, 'scene.json'), 'utf8')) as SceneData);
    scene.assets.find((asset) => asset.id === LAMPS.placement.tableLamp)!.variant = variant;
    const context = projectContext({ manifest, baseUrl: 'https://lamps.test/bake/' }, QUIET);
    const modelSource = (): Promise<ModelOutcome> => {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.52, 0.3), new THREE.MeshStandardMaterial()));
      return Promise.resolve({ group, triangles: 12, warnings: [], bytes: 16 });
    };
    return {
      model: new SceneModel(scene, registriesFromLibrary(projectLibraryOf(manifest), CATALOGUE_REGISTRIES)),
      project: { ...context, key: 'lamp-library', builderOptions: { ...context.builderOptions, modelSource } },
    };
  }

  function factLights(group: THREE.Object3D): THREE.PointLight[] {
    const lights: THREE.PointLight[] = [];
    group.traverse((child) => {
      if (lampLightTag(child) !== null) lights.push(child as THREE.PointLight);
    });
    return lights;
  }

  test('to an unlit variant: no light; to a lit one at 3000 K: its light tinted, «Original» restoring its own colour', async () => {
    const manifest = lampManifest();
    const subject = rig(undefined, (root) => tintArtificialLights(root, 3000));
    subject.mount.mountDocument(lampDocument(manifest, LAMPS.variant.tableLamp));
    await settle();
    expect(factLights(placementGroup(subject.mount, LAMPS.placement.tableLamp))).toHaveLength(1);

    subject.mount.present(lampDocument(manifest, UNLIT));
    await settle();
    const unlit = placementGroup(subject.mount, LAMPS.placement.tableLamp);
    expect(unlit.userData['variantId']).toBe(UNLIT);
    expect(factLights(unlit)).toEqual([]);

    subject.mount.present(lampDocument(manifest, COLD));
    await settle();
    const cold = placementGroup(subject.mount, LAMPS.placement.tableLamp);
    expect(cold.userData['variantId']).toBe(COLD);
    const [light] = factLights(cold);
    const authored = new THREE.Color(COLD_COLOUR);
    const expected = new THREE.PointLight(COLD_COLOUR);
    expected.userData['artificialLight'] = { colour: authored.toArray() };
    tintArtificialLights(expected, 3000);
    expect(light!.color.toArray()).toEqual(expected.color.toArray());
    tintArtificialLights(subject.mount.sceneRoot!, null);
    expect(light!.color.toArray()).toEqual(authored.toArray());
  });
});

/** A wiring that records what the mount tells it, and what was on screen at that moment. */
function recordingBake(scene: () => THREE.Scene, root: () => THREE.Object3D | undefined, floor: () => THREE.Material | undefined) {
  const events: Array<{ call: string; attached: boolean; floor?: THREE.Material | undefined }> = [];
  const targets: BakeTarget[] = [];
  /** Whether the mount's current shell (if it has one yet) is still in the scene graph. */
  const attached = (): boolean => {
    const current = root();
    return current === undefined || current.parent === scene();
  };
  const wiring: LightBakeWiring = {
    mounted: (target) => {
      targets.push(target);
      events.push({ call: 'mounted', attached: attached() });
    },
    revision: () => events.push({ call: 'revision', attached: attached(), floor: floor() }),
    drop: () => events.push({ call: 'drop', attached: attached() }),
    state: () => ({ state: 'off' }),
    idle: () => Promise.resolve(),
  };
  return { wiring, events, targets };
}

describe('the light bake follows the mounted document', () => {
  function baked() {
    let subject: Rig | undefined;
    const floorOf = (): THREE.Material | undefined =>
      (subject?.mount.sceneRoot?.getObjectByName(`floor-${L_SHAPE.room.a}`) as THREE.Mesh | undefined)?.material as
        | THREE.Material
        | undefined;
    const bake = recordingBake(
      () => subject!.scene,
      () => subject?.mount.sceneRoot,
      floorOf,
    );
    subject = rig(undefined, undefined, bake.wiring);
    return { subject, bake, floorOf };
  }

  test('a mount hands the wiring its root and document, settled only after the first model pass', async () => {
    const { subject, bake } = baked();
    subject.mount.mountDocument(subject.load(lShapePlan));
    expect(bake.targets).toHaveLength(1);
    const target = bake.targets[0]!;
    expect(target.root).toBe(subject.mount.sceneRoot!);
    expect(target.document).toBe(subject.mount.model!);
    expect(target.scene).toBe(subject.mount.model!.scene);
    let settled = false;
    void target.settled.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await settle();
    expect(settled).toBe(true);
    expect(subject.settled).toHaveLength(1);
  });

  test('settled also waits for every library map of the shell', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const maps = spyOn(SceneBuilder.prototype, 'mapsSettled').mockImplementation(() => held);
    try {
      const { subject, bake } = baked();
      subject.mount.mountDocument(subject.load(lShapePlan));
      let settled = false;
      void bake.targets[0]!.settled.then(() => (settled = true));
      await settle();
      expect(subject.settled).toHaveLength(1);
      expect(settled).toBe(false);
      release();
      await settle();
      expect(settled).toBe(true);
    } finally {
      maps.mockRestore();
    }
  });

  test('a repaint reaches the wiring before the builder repaints the shell', async () => {
    const { subject, bake, floorOf } = baked();
    subject.mount.mountDocument(subject.load(lShapePlan));
    await settle();
    const before = floorOf();
    const model = subject.mount.model!;
    const result = model.apply({
      baseRev: model.rev,
      ops: [{ op: 'set_material', surface: 'floor', room: L_SHAPE.room.a, material: FINISH.walnut }],
    });
    expect(isApplyOk(result)).toBe(true);
    const revision = bake.events.find((event) => event.call === 'revision');
    expect(revision?.floor).toBe(before);
    expect(floorOf()).not.toBe(before);
  });

  test('a plan rebuild, a release and a remount drop the bake while the old shell is still attached', async () => {
    const { subject, bake } = baked();
    subject.mount.mountDocument(subject.load(lShapePlan));
    await settle();
    subject.mount.present(subject.load({ ...lShapePlan, ceilingHeight: lShapePlan.ceilingHeight + 0.2 }));
    subject.mount.remount();
    subject.mount.release();
    const drops = bake.events.filter((event) => event.call === 'drop');
    // The first mount (nothing yet), the plan rebuild, the remount, the release.
    expect(drops).toHaveLength(4);
    expect(drops.every((event) => event.attached)).toBe(true);
    expect(bake.events.filter((event) => event.call === 'mounted')).toHaveLength(2);
    expect(bake.targets[1]!.document).toBe(bake.targets[0]!.document);
  });
});
