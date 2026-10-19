/**
 * The ONE builder behind the viewer's own selection panel and
 * `ViewerHandle.describeSelection`.
 *
 * What is pinned here: which swatches a selection offers, what each one
 * commits, the narrow/broad pair the scope row stands for, and the two
 * invariants a host depends on — every `preview` is a non-empty image URL
 * (and never text), and every `op` names the subject that was picked.
 */

import { describe, expect, test } from 'bun:test';
import {
  assetLabel,
  describeSelection,
  finishApplyAllAction,
  finishCore,
  finishCurrentOf,
  finishOwnerName,
  finishPickAction,
  furnitureCore,
  openingCore,
  openingLabel,
  paletteSwatchDataURL,
  type DescribeDeps,
  type SelectionDescription,
} from './selection-options.js';
import { createMessages } from './messages.js';
import { FLOOR_FINISHES, WALL_FINISHES } from '../materials/finishes.js';
import { variantsForOpening } from '../assets/opening-variants.js';
import { variantsForPlacement, type VariantBank } from '../assets/asset-variants.js';
import { projectCatalogue, projectPreviewUrl } from '../assets/project-catalogue.js';
import type { ProjectLibraryManifest } from '../assets/project-manifest.js';
import { findCatalogueEntry } from '../assets/asset-catalogue.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { ARCHETYPE, OPENING_VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { faceKey, type DemoAsset, type SceneData } from '../scene/types.js';
import type { OpeningListEntry } from '../geometry/opening-builder.js';

const EN = createMessages('en');

/** The ids this file invents: fixed UUID v7 literals, named for what they stand for. */
const ID = {
  kitchen: '01a12ffe-13d0-7ee4-ab2b-73ad59046adf',
  livingSofa: '01a12ffe-13d1-7e6d-a1dc-771df069dbb3',
  /** A room no document carries. */
  nowhere: '01a12ffe-13d2-78e3-8b42-affaa0ec8cdd',
  livingLamp: '01a12ffe-13d3-7882-bbd6-74c0e91aceea',
  livingChair: '01a12ffe-13d4-7160-a834-2cada4410b0f',
  project: '01a12ffe-13d5-7276-92fd-3853d43a185a',
  bake: '01a12ffe-37ab-7f02-8992-79346da6a720',
  publisher: '01a12ffe-13d6-7d96-a5b4-cf2e2086412d',
  lampCatalogue: '01a12ffe-13d7-7cd4-9064-bb2b55ac5d63',
  /** The lamp's variants, the brass one first. */
  lampVariants: ['01a12ffe-13df-7a6a-8714-435974f176e6', '01a12ffe-37ac-7afa-97e4-35914714fd69', '01a12ffe-37ad-7193-8c94-ae3b2a299bfc'],
  brassBrushed: '01a12ffe-13d8-7420-afa9-e855228112cf',
  chairCatalogue: '01a12ffe-13d9-7416-a229-726ec558eaa7',
  chairFree: '01a12ffe-13da-7bdb-8e99-0111e7982cbc',
  chairPro: '01a12ffe-13db-78c3-b96e-733818cf7a5e',
  chairPlain: '01a12ffe-13dc-7da5-aaec-410c6541a8c4',
  /** A room a later `loadScene` removed. */
  gone: '01a12ffe-13dd-76ef-a46e-63ee7a2cf973',
} as const;

const W1 = L_SHAPE.wall.wSA;
const KITCHEN_W1 = faceKey(ID.kitchen, W1, 'L');
const KITCHEN_W2 = faceKey(ID.kitchen, L_SHAPE.wall.wE, 'L');
const FACADE_W1 = faceKey(null, W1, 'R');
/** Where the catalogue's bake is served from, and the picture the catalogue publishes for the brass lamp. */
const PROJECT_BASE = `https://example.com/${ID.publisher}/${ID.project}/${ID.bake}/`;
const CATALOGUE_PREVIEW = `https://cdn.example.com/v1/previews/${ID.publisher}/${ID.lampCatalogue}/${ID.lampVariants[0]}/1.4.0.webp`;

const SOFA: DemoAsset = { id: ID.livingSofa, type: 'sofa', asset: ARCHETYPE.sofa_3s, position: { x: 0, y: 0, z: 0 } };

const OPENING: OpeningListEntry = {
  id: L_SHAPE.opening.doorEntry,
  type: 'door',
  wallId: W1,
  entrance: true,
  variant: OPENING_VARIANT.entry_door_walnut_panelled,
  center: { x: 1, y: 1, z: 0 },
  pick: { x: 1, y: 1, z: 0 },
};

/** A document with one named room, a painted wall and the sofa above. */
const SCENE: SceneData = {
  ...lShapePlan,
  rooms: [{ id: ID.kitchen, name: 'Kitchen', anchor: { x: 1, z: 1 }, floorMaterial: FINISH.oak }],
  assets: [SOFA],
  finishes: { rooms: { [ID.kitchen]: { walls: FINISH.sand } } },
};

const DEPS: DescribeDeps = {
  scene: SCENE,
  messages: EN,
  openings: [OPENING],
  // Under Bun there is no renderer at all; `null` is exactly what the viewer
  // answers with a lost context, so the fallback below is the tested path.
  renderPreview: () => null,
};

describe('finish ops: one builder for the panel and the host card', () => {
  test('a floor swatch paints its room, and the footer every floor', () => {
    const target = { surface: 'floor', roomId: ID.kitchen } as const;
    expect(finishPickAction(target, FINISH.oak, false)?.op).toEqual({ op: 'set_material', target: ID.kitchen, material: FINISH.oak });
    expect(finishApplyAllAction(target, FINISH.oak, false)).toEqual({
      op: { op: 'set_material', target: 'floors', material: FINISH.oak },
      hint: 'hint.allFloorsApplied',
    });
  });

  test('a floor with no room paints nothing at all', () => {
    expect(finishPickAction({ surface: 'floor' }, FINISH.oak, false)).toBeNull();
  });

  test('the "only this wall" checkbox is what turns a room paint into a face paint', () => {
    const target = { surface: 'wall', roomId: ID.kitchen, face: KITCHEN_W1 } as const;
    expect(finishPickAction(target, FINISH.sage, false)?.op).toEqual({ op: 'set_material', target: ID.kitchen, material: FINISH.sage });
    expect(finishPickAction(target, FINISH.sage, true)).toEqual({
      op: { op: 'set_material', target: KITCHEN_W1, material: FINISH.sage, scope: 'face' },
      hint: 'hint.faceApplied',
    });
  });

  test('a wall face owned by no room is the facade, and "all walls" keeps it', () => {
    const target = { surface: 'wall', face: FACADE_W1 } as const;
    expect(finishPickAction(target, FINISH.sage, false)).toEqual({
      op: { op: 'set_material', target: 'facade', material: FINISH.sage },
      hint: 'hint.facadeApplied',
    });
    expect(finishApplyAllAction(target, FINISH.sage, false).hint).toBe('hint.allWallsAppliedFacadeKept');
    expect(finishOwnerName(SCENE, target, EN)).toBe('Facade');
  });

  test('the finish in force comes from the document, floor and walls apart', () => {
    expect(finishCurrentOf(SCENE, { surface: 'floor', roomId: ID.kitchen })).toBe(FINISH.oak);
    expect(finishCurrentOf(SCENE, { surface: 'wall', roomId: ID.kitchen })).toBe(FINISH.sand);
    expect(finishCurrentOf(SCENE, { surface: 'floor', roomId: ID.nowhere })).toBeNull();
  });

  test('a face that was painted alone wears its own finish, not the room’s', () => {
    // «Only this wall» writes the face's `finishes.faces` entry and the renderer paints
    // from it; reading the room's finish put the ring on a swatch the surface
    // visibly does not wear.
    const painted: SceneData = {
      ...SCENE,
      finishes: { rooms: { [ID.kitchen]: { walls: FINISH.sand } }, faces: [{ ...KITCHEN_W1, finish: FINISH.sage }] },
    };
    expect(finishCurrentOf(painted, { surface: 'wall', roomId: ID.kitchen, face: KITCHEN_W1 })).toBe(FINISH.sage);
    // A face with no override still answers with the room's finish.
    expect(finishCurrentOf(painted, { surface: 'wall', roomId: ID.kitchen, face: KITCHEN_W2 })).toBe(FINISH.sand);
  });

  test('an owner the document lost is named by its id, never by an empty string', () => {
    expect(finishOwnerName(SCENE, { surface: 'floor', roomId: ID.nowhere }, EN)).toBe(ID.nowhere);
  });
});

describe('cores', () => {
  test('a floor core offers the floor bank, titled by the room', () => {
    const core = finishCore(SCENE, { surface: 'floor', roomId: ID.kitchen }, EN);
    expect(core?.title).toBe('Floor finish · Kitchen');
    expect(core?.subject).toEqual({ id: ID.kitchen, label: 'Kitchen' });
    expect(core?.options.map((option) => option.id)).toEqual(FLOOR_FINISHES.map((finish) => finish.id));
    expect(core?.current).toBe(FINISH.oak);
  });

  test('a wall core offers the wall bank and the scope pair of the finish in force', () => {
    const core = finishCore(SCENE, { surface: 'wall', roomId: ID.kitchen, face: KITCHEN_W1 }, EN);
    expect(core?.options.map((option) => option.id)).toEqual(WALL_FINISHES.map((finish) => finish.id));
    expect(core?.scope).toEqual({
      label: 'Apply to all walls',
      ops: {
        one: { op: 'set_material', target: KITCHEN_W1, material: FINISH.sand, scope: 'face' },
        all: { op: 'set_material', target: 'walls', material: FINISH.sand },
      },
    });
  });

  test('a target the paint vocabulary cannot address has no core', () => {
    expect(finishCore(SCENE, { surface: 'floor' }, EN)).toBeNull();
    expect(finishCore(SCENE, { surface: 'wall' }, EN)).toBeNull();
  });

  test('a furniture core offers the archetype bank with one replace op each', () => {
    const core = furnitureCore(SOFA, EN, () => null);
    expect(core.options.map((option) => option.id)).toEqual(variantsForPlacement(SOFA).map((variant) => variant.id));
    for (const option of core.options) {
      expect(option.op).toEqual({ op: 'replace_asset_variant', assetId: ID.livingSofa, variant: option.id });
    }
    expect(core.scope).toBeUndefined();
  });

  test('an opening core offers its family with one replace op each', () => {
    const core = openingCore(OPENING, OPENING_VARIANT.entry_door_walnut_panelled, EN);
    expect(core.options.map((option) => option.id)).toEqual(variantsForOpening('door', { entrance: true }).map((variant) => variant.id));
    for (const option of core.options) {
      expect(option.op).toEqual({ op: 'replace_opening_variant', openingId: L_SHAPE.opening.doorEntry, variant: option.id });
    }
    expect(core.current).toBe(OPENING_VARIANT.entry_door_walnut_panelled);
  });
});

describe('the palette fallback preview', () => {
  test('is an SVG data URL carrying the colours and no text', () => {
    const url = paletteSwatchDataURL(['#112233', '#445566']);
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
    expect(svg).toContain('#112233');
    expect(svg).toContain('#445566');
    expect(svg).not.toContain('<text');
  });

  test('takes the four CSS hex lengths and refuses the two that are not colours', () => {
    for (const colour of ['#abc', '#abcd', '#aabbcc', '#aabbccdd']) {
      expect(decodeURIComponent(paletteSwatchDataURL([colour]))).toContain(colour);
    }
    // `#12345` and `#1234567` are not colours: an invalid `fill` renders black,
    // which is a worse picture than the default chip.
    for (const colour of ['#12345', '#1234567']) {
      const svg = decodeURIComponent(paletteSwatchDataURL([colour]));
      expect(svg).not.toContain(colour);
      expect(svg).toContain('#b0a294');
    }
  });

  test('drops anything that is not a literal hex colour, and never answers empty', () => {
    const svg = decodeURIComponent(paletteSwatchDataURL(['url(#x)', 'red', '</svg><script>']).slice('data:image/svg+xml,'.length));
    expect(svg).not.toContain('script');
    expect(svg).toContain('#b0a294');
    expect(paletteSwatchDataURL([]).length).toBeGreaterThan(30);
  });
});

/** The catalogue lamp's project library, one variant per preview. */
function lampLibrary(previews: readonly (string | undefined)[]): ProjectLibraryManifest {
  return {
    manifestVersion: '1.0',
    id: ID.project,
    publisher: ID.publisher,
    license: 'Apache-2.0',
    materials: [],
    objects: [
      {
        id: ID.lampCatalogue,
        name: 'Catalogue lamp',
        category: 'lighting/floor',
        dims: [0.4, 1.6, 0.4],
        anchor: 'floor',
        wallSnap: false,
        clearance: 0.3,
        tags: ['living'],
        model: `obj/${ID.lampCatalogue}@1.4.0.glb`,
        slots: ['metal'],
        defaultFinishes: { metal: ID.brassBrushed },
        primarySlot: 'metal',
        defaultVariant: ID.lampVariants[0],
        variants: previews.map((preview, index) => ({
          id: ID.lampVariants[index]!,
          name: `Lamp ${index}`,
          version: '1.4.0',
          pricing: { model: 'free' as const },
          ...(preview === undefined ? {} : { preview }),
        })),
      },
    ],
  };
}
/**
 * A swatch's picture has THREE sources, in this order — the address the content
 * declares, the viewer's own render, the palette — and the first one that
 * answers wins. All three are pinned here, on one placement, so the ORDER is
 * the assertion and not three unrelated facts.
 */
describe('three sources of a swatch picture, in order', () => {
  const LAMP: DemoAsset = { id: ID.livingLamp, type: 'lamp', asset: ID.lampCatalogue, position: { x: 0, y: 0, z: 0 } };

  function bank(previews: readonly (string | undefined)[]): VariantBank {
    return { catalogue: projectCatalogue(lampLibrary(previews), findCatalogueEntry), previewUrl: projectPreviewUrl(PROJECT_BASE) };
  }

  function describeLamp(previews: readonly (string | undefined)[], renderPreview: DescribeDeps['renderPreview']): SelectionDescription {
    const scene: SceneData = { ...SCENE, assets: [LAMP] };
    const description = describeSelection(
      { kind: 'furniture', id: ID.livingLamp },
      { ...DEPS, scene, renderPreview, variants: bank(previews) },
    );
    if (!description) throw new Error('the lamp must be describable');
    return description;
  }

  test('1. the manifest address wins over a render that IS available', () => {
    const description = describeLamp([CATALOGUE_PREVIEW], () => 'data:image/png;base64,RENDERED');
    expect(description.options[0]?.preview).toBe(CATALOGUE_PREVIEW);
  });

  test('1b. a relative manifest picture is resolved against the project folder', () => {
    const description = describeLamp(['prev/lamp.webp'], () => null);
    expect(description.options[0]?.preview).toBe(`${PROJECT_BASE}prev/lamp.webp`);
  });

  test("2. with no manifest picture the viewer's own render is used", () => {
    const description = describeLamp([undefined], () => 'data:image/png;base64,RENDERED');
    expect(description.options[0]?.preview).toBe('data:image/png;base64,RENDERED');
  });

  test('3. with neither, the palette — never empty, never text', () => {
    const description = describeLamp([undefined], () => null);
    const preview = description.options[0]?.preview ?? '';
    expect(preview.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(preview)).not.toContain('<text');
  });

  test('a picture the resolver refuses falls through to the render, not to a broken <img>', () => {
    const description = describeLamp(['javascript:alert(1)'], () => 'data:image/png;base64,RENDERED');
    expect(description.options[0]?.preview).toBe('data:image/png;base64,RENDERED');
  });

  test('the built-in panel takes the same picture: one variant, one image', () => {
    const core = furnitureCore(LAMP, EN, () => 'data:image/png;base64,RENDERED', bank([CATALOGUE_PREVIEW]));
    expect(core.options[0]?.image).toBe(CATALOGUE_PREVIEW);
  });

  test('a bare scene is untouched: no bank, no image, the render as before', () => {
    const core = furnitureCore(SOFA, EN, () => 'data:image/png;base64,RENDERED');
    expect(core.options.every((option) => option.image === undefined)).toBe(true);
    expect(core.options[0]?.thumbnail).toBe('data:image/png;base64,RENDERED');
  });
});

/**
 * `access` and `allowed` travel from the manifest to the host's card and
 * NOTHING in the viewer reads them. What is pinned here is exactly that — the
 * fields arrive, and a variant nobody may place is still offered with its own
 * `op`, because the question belongs to the host.
 */
describe('access and allowed reach a host card, and gate nothing here', () => {
  const GATED: DemoAsset = { id: ID.livingChair, type: 'chair', asset: ID.chairCatalogue, position: { x: 0, y: 0, z: 0 } };

  function gatedLibrary(): ProjectLibraryManifest {
    return {
      manifestVersion: '1.0',
      id: ID.project,
      publisher: ID.publisher,
      license: 'Apache-2.0',
      materials: [],
      objects: [
        {
          id: ID.chairCatalogue,
          name: 'Catalogue chair',
          category: 'furniture/chairs',
          dims: [0.5, 0.9, 0.5],
          anchor: 'floor',
          wallSnap: false,
          clearance: 0.4,
          tags: ['living'],
          model: `obj/${ID.chairCatalogue}@1.0.0.glb`,
          slots: ['frame'],
          defaultFinishes: { frame: FINISH.oak_natural },
          primarySlot: 'frame',
          defaultVariant: ID.chairFree,
          variants: [
            { id: ID.chairFree, name: 'Free', version: '1.0.0', pricing: { model: 'free' }, access: 'free', allowed: true },
            { id: ID.chairPro, name: 'Pro', version: '1.0.0', pricing: { model: 'subscription' }, access: 'pro', allowed: false },
            { id: ID.chairPlain, name: 'Plain', version: '1.0.0', pricing: { model: 'free' } },
          ],
        },
      ],
    };
  }

  function describeGated(): SelectionDescription {
    const scene: SceneData = { ...SCENE, assets: [GATED] };
    const variants: VariantBank = {
      catalogue: projectCatalogue(gatedLibrary(), findCatalogueEntry),
      previewUrl: projectPreviewUrl(PROJECT_BASE),
    };
    const description = describeSelection({ kind: 'furniture', id: ID.livingChair }, { ...DEPS, scene, variants });
    if (!description) throw new Error('the chair must be describable');
    return description;
  }

  test('each option carries the two fields the manifest gave it, and nothing where it said nothing', () => {
    expect(describeGated().options.map((option) => ({ id: option.id, access: option.access, allowed: option.allowed }))).toEqual([
      { id: ID.chairFree, access: 'free', allowed: true },
      { id: ID.chairPro, access: 'pro', allowed: false },
      { id: ID.chairPlain, access: undefined, allowed: undefined },
    ]);
  });

  test('an absent field is ABSENT, so a host can tell «nobody said» from «no»', () => {
    const plain = describeGated().options[2]!;
    expect(Object.hasOwn(plain, 'access')).toBe(false);
    expect(Object.hasOwn(plain, 'allowed')).toBe(false);
  });

  test('a disallowed option is still listed, still has a picture and still carries its own op', () => {
    const pro = describeGated().options[1]!;
    expect(pro.op).toEqual({ op: 'replace_asset_variant', assetId: ID.livingChair, variant: ID.chairPro });
    expect(pro.preview.length).toBeGreaterThan(0);
  });

  test('a bare scene publishes neither field: every option of the bundled bank is silent about access', () => {
    const description = describeSelection({ kind: 'furniture', id: ID.livingSofa }, DEPS);
    for (const option of description?.options ?? []) {
      expect({ id: option.id, hasAccess: Object.hasOwn(option, 'access'), hasAllowed: Object.hasOwn(option, 'allowed') }).toEqual({
        id: option.id,
        hasAccess: false,
        hasAllowed: false,
      });
    }
  });
});

describe('describeSelection', () => {
  /** Every description a host may receive, so the invariants are asserted once. */
  function every(): SelectionDescription[] {
    return [
      describeSelection({ kind: 'furniture', id: ID.livingSofa }, DEPS),
      describeSelection({ kind: 'room', id: ID.kitchen, roomId: ID.kitchen }, DEPS),
      describeSelection({ kind: 'wall', id: W1, roomId: ID.kitchen, face: KITCHEN_W1 }, DEPS),
      describeSelection({ kind: 'opening', id: L_SHAPE.opening.doorEntry }, DEPS),
    ].filter((description): description is SelectionDescription => description !== null);
  }

  test('describes the four selections that carry a catalogue', () => {
    expect(every().map((description) => description.kind)).toEqual(['furniture', 'finish', 'finish', 'opening']);
  });

  test('every option has a non-empty image preview and a separate label', () => {
    for (const description of every()) {
      expect(description.options.length).toBeGreaterThan(0);
      for (const option of description.options) {
        expect(option.preview.startsWith('data:image/')).toBe(true);
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.preview).not.toContain(option.label);
      }
    }
  });

  test('a furniture description names the picked placement in every op', () => {
    const description = describeSelection({ kind: 'furniture', id: ID.livingSofa }, DEPS);
    expect(description?.options.length).toBeGreaterThanOrEqual(2);
    expect(description?.subject).toEqual({ id: ID.livingSofa, label: 'Three-seat sofa' });
    for (const option of description?.options ?? []) {
      expect(option.op).toEqual({ op: 'replace_asset_variant', assetId: ID.livingSofa, variant: option.id });
    }
  });

  test('a floor pick lists the floor finishes with the one in force', () => {
    const description = describeSelection({ kind: 'room', id: ID.kitchen, roomId: ID.kitchen }, DEPS);
    expect(description?.kind).toBe('finish');
    expect(description?.current).toBe(FINISH.oak);
    expect(description?.options.map((option) => option.id)).toEqual(FLOOR_FINISHES.map((finish) => finish.id));
    expect(description?.scope?.ops.all).toEqual({ op: 'set_material', target: 'floors', material: FINISH.oak });
  });

  test('an opening pick lists exactly its family', () => {
    const description = describeSelection({ kind: 'opening', id: L_SHAPE.opening.doorEntry }, DEPS);
    expect(description?.options.map((option) => option.id)).toEqual(
      variantsForOpening('door', { entrance: true }).map((variant) => variant.id),
    );
    expect(description?.current).toBe(OPENING_VARIANT.entry_door_walnut_panelled);
  });

  test('nothing to offer answers null: no pick, a plan node, an unknown id', () => {
    expect(describeSelection({ kind: 'none' }, DEPS)).toBeNull();
    // Plan nodes are not selectable, and an id that names one reaches here only
    // as a mistake — an id the document does not carry answers null, whatever
    // kind it is claimed to be.
    const node = L_SHAPE.node.n1;
    expect(describeSelection({ kind: 'room', id: node, roomId: node }, DEPS)).toBeNull();
    expect(describeSelection({ kind: 'furniture', id: node }, DEPS)).toBeNull();
    expect(describeSelection({ kind: 'opening', id: node }, DEPS)).toBeNull();
    expect(describeSelection({ kind: 'wall', id: W1 }, DEPS)).toBeNull();
    // A host's payload can name a room a later `loadScene` removed; a wall is
    // checked against the document exactly as a room is.
    expect(describeSelection({ kind: 'wall', id: W1, roomId: ID.gone, face: faceKey(ID.gone, W1, 'L') }, DEPS)).toBeNull();
  });

  test('a wall face is the subject by its wall UUID, with the face spelled out beside it', () => {
    const description = describeSelection({ kind: 'wall', id: W1, roomId: ID.kitchen, face: KITCHEN_W1 }, DEPS);
    expect(description?.subject).toEqual({ id: W1, label: 'Kitchen', face: KITCHEN_W1 });
    expect(description?.scope?.ops.one).toEqual({ op: 'set_material', target: KITCHEN_W1, material: FINISH.sand, scope: 'face' });
  });

  test('a facade face needs no room and still describes', () => {
    const description = describeSelection({ kind: 'wall', id: W1, face: FACADE_W1 }, DEPS);
    expect(description?.kind).toBe('finish');
    expect(description?.subject.label).toBe('Facade');
  });

  test('the honest render wins over the fallback when the viewer can draw', () => {
    const description = describeSelection(
      { kind: 'furniture', id: ID.livingSofa },
      { ...DEPS, renderPreview: () => 'data:image/png;base64,AAAA' },
    );
    expect(description?.options.every((option) => option.preview === 'data:image/png;base64,AAAA')).toBe(true);
  });
});

describe('labels', () => {
  test('an asset id becomes a title-cased human name', () => {
    expect(assetLabel(SOFA)).toBe('Three-seat sofa');
    // A project archetype is named by the project's own manifest.
    const lamp: DemoAsset = { id: ID.livingLamp, type: 'lamp', asset: ID.lampCatalogue, position: { x: 0, y: 0, z: 0 } };
    expect(assetLabel(lamp, { catalogue: projectCatalogue(lampLibrary([undefined]), findCatalogueEntry) })).toBe('Catalogue lamp');
    // An id is never a name: what no bank resolves is called by its type word.
    expect(assetLabel({ ...lamp, type: 'side-table' })).toBe('Side Table');
  });

  test('the entrance door is named apart from an interior door', () => {
    expect(openingLabel('door', true, EN)).toBe('Entrance door');
    expect(openingLabel('door', false, EN)).toBe('Door');
    expect(openingLabel('window', false, EN)).toBe('Window');
    expect(openingLabel('passage', false, EN)).toBe('Passage');
  });
});

describe('describeSelection: the mirror buttons a host card may draw', () => {
  test('furniture says which axes its facts allow and which it is mirrored on now', () => {
    const scene = { ...SCENE, assets: [{ ...SOFA, mirror: { x: true as const } }] };
    const description = describeSelection(
      { kind: 'furniture', id: ID.livingSofa },
      { ...DEPS, scene, mirrorFacts: () => ({ x: true, y: false, z: true }) },
    );
    expect(description?.mirror).toEqual({ allowed: ['x', 'z'], current: ['x'] });
  });

  test('absent facts allow nothing, and other kinds carry no mirror', () => {
    expect(describeSelection({ kind: 'furniture', id: ID.livingSofa }, DEPS)?.mirror).toEqual({ allowed: [], current: [] });
    expect(describeSelection({ kind: 'room', roomId: ID.kitchen }, DEPS)?.mirror).toBeUndefined();
  });
});
