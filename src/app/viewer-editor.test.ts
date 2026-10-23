/**
 * Editor contract tests that need no viewport: the order in which a shell
 * rebuild adopts the new furniture root, and the teardown of the selection
 * auras it owns.
 *
 * The editor is driven with stub collaborators and stub roots — the real
 * `SceneBuilder`, `Picker` and `Dollhouse` are covered by their own tests, and
 * what matters here is who is called, and when.
 */

import { describe, expect, spyOn, test } from 'bun:test';
import * as THREE from 'three';
import { ViewerEditor, type EditorDeps } from './viewer-editor.js';
import { TOUCHED_SHELL } from '../scene/scene-ops.js';
import { GLOW_GROUP_NAME } from '../geometry/selection-glow.js';
import type { BuildResult } from '../geometry/scene-builder.js';
import { createMessages } from '../ui/messages.js';
import { editsWiring } from './edits-wiring.js';
import { resolveViewerOptions } from './viewer-options.js';
import type { ViewerEditRequest } from './viewer-events.js';
import type { PanelRequest } from '../ui/viewer-ui.js';
import type { DemoAsset, SceneOp } from '../scene/types.js';
import { FINISH } from '../materials/finish-ids.js';

/** Ids this file invents for its stub roots and its one-room scene. */
const ID = {
  sofa: '01a12ffa-e529-79f2-968f-ecac4905c209',
  lamp: '01a12ffa-e52a-7510-8b92-059746e460d5',
  room: '01a12ffa-e52b-7b9e-8d9b-c96d98830fe6',
  oak: '01a12ffa-e52c-7c3c-9aac-7725fb691c26',
} as const;

/** The placement behind the sofa root: a selection names what it picked from the document. */
const SOFA: DemoAsset = { id: ID.sofa, type: 'sofa', position: { x: 0, y: 0, z: 0 } };

/** A root shaped like a real build: one `demo-assets` container with one item. */
function stubRoot(assetId: string): { root: THREE.Group; furniture: THREE.Group; item: THREE.Group } {
  const root = new THREE.Group();
  const furniture = new THREE.Group();
  furniture.name = 'demo-assets';
  const item = new THREE.Group();
  item.name = assetId;
  item.userData['assetId'] = assetId;
  item.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.8), new THREE.MeshBasicMaterial()));
  furniture.add(item);
  root.add(furniture);
  return { root, furniture, item };
}

type Harness = {
  editor: ViewerEditor;
  /** Every group handed to the animator, oldest first. */
  attached: Array<THREE.Group | null>;
  /** What the picker was told, in order: one entry per call. */
  picker: { registered: THREE.Object3D[]; unregistered: THREE.Object3D[] };
  /** What the animator was attached to at the moment `reseed` ran. */
  attachedWhenReseeded: Array<THREE.Group | null>;
  reseeds: number;
  next: { root: THREE.Group; furniture: THREE.Group; item: THREE.Group };
};

function harness(): Harness {
  const registered: THREE.Object3D[] = [];
  const unregistered: THREE.Object3D[] = [];
  const attached: Array<THREE.Group | null> = [];
  const attachedWhenReseeded: Array<THREE.Group | null> = [];
  const next = stubRoot(ID.lamp);
  const state = { reseeds: 0 };
  const deps = {
    model: { scene: { assets: [SOFA], walls: [] }, rev: 0, apply: () => ({ rev: 1, applied: [], touched: [] }) },
    ui: { closePanel: () => {}, openPanel: () => {}, setHint: () => {}, wakeControls: () => {} },
    messages: createMessages('en'),
    picker: {
      registerFurniture: (group: THREE.Object3D) => {
        registered.push(group);
      },
      unregister: (root: THREE.Object3D) => {
        unregistered.push(root);
      },
    },
    // Picking the sofa opens its replace panel, whose swatches ask for
    // previews; `null` is the builder's own "cannot be rendered" answer.
    builder: { buildFurnitureVariant: () => null },
    animator: {
      attach: (group: THREE.Group | null) => {
        attached.push(group);
      },
    },
    dollhouse: {},
    renderPreview: () => null,
    rebuild: (): BuildResult | null => ({ root: next.root, degradedAssets: 0 }),
    reseed: (): void => {
      state.reseeds += 1;
      attachedWhenReseeded.push(attached.at(-1) ?? null);
    },
  } as unknown as EditorDeps;
  const editor = new ViewerEditor(deps);
  return {
    editor,
    attached,
    picker: { registered, unregistered },
    attachedWhenReseeded,
    get reseeds() {
      return state.reseeds;
    },
    next,
  };
}

describe('a shell rebuild adopts the new root before anything re-seeds', () => {
  test('the animator holds the NEW furniture group by the time reseed runs', () => {
    const subject = harness();
    const first = stubRoot(ID.sofa);
    subject.editor.attachRoot(first.root);
    expect(subject.attached).toEqual([first.furniture]);

    subject.editor.applyRevision([TOUCHED_SHELL]);

    // Guards against `onDocument` (here `reseed`), which re-applies the
    // authoritative furniture visibility, running while the animator still holds
    // the disposed group — hidden furniture would come back visible on the new one.
    expect(subject.reseeds).toBe(1);
    expect(subject.attachedWhenReseeded).toEqual([subject.next.furniture]);
    expect(subject.attached).toEqual([first.furniture, subject.next.furniture]);
  });

  test('a rebuild that produces no root re-seeds nothing', () => {
    const attached: Array<THREE.Group | null> = [];
    let reseeds = 0;
    const editor = new ViewerEditor({
      model: { scene: { assets: [], walls: [] } },
      ui: { closePanel: () => {} },
      messages: createMessages('en'),
      picker: { registerFurniture: () => {}, unregister: () => {} },
      builder: {},
      animator: {
        attach: (group: THREE.Group | null) => {
          attached.push(group);
        },
      },
      dollhouse: {},
      renderPreview: () => null,
      rebuild: () => null,
      reseed: () => {
        reseeds += 1;
      },
    } as unknown as EditorDeps);
    editor.applyRevision([TOUCHED_SHELL]);
    expect(reseeds).toBe(0);
    expect(attached).toEqual([]);
  });
});

describe('dispose frees the selection auras the editor owns', () => {
  test('the live aura and the fading ones leave their groups and release their materials', () => {
    const subject = harness();
    const built = stubRoot(ID.sofa);
    subject.editor.attachRoot(built.root);

    // One aura still fading out, one live.
    subject.editor.handleFurniturePick(ID.sofa);
    subject.editor.clearSelection();
    subject.editor.handleFurniturePick(ID.sofa);
    const glows = built.item.children.filter((child) => child.name === GLOW_GROUP_NAME);
    expect(glows.length).toBe(2);
    const spies = glows.map((glow) => {
      let material: THREE.Material | null = null;
      glow.traverse((object) => {
        if (!material && object instanceof THREE.Mesh) material = object.material as THREE.Material;
      });
      if (!material) throw new Error('a glow should carry at least one mesh');
      return spyOn(material, 'dispose');
    });

    subject.editor.dispose();

    expect(built.item.children.filter((child) => child.name === GLOW_GROUP_NAME)).toEqual([]);
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(subject.editor.selectedFurniture()).toBeNull();
  });

  test('dispose is idempotent', () => {
    const subject = harness();
    const built = stubRoot(ID.sofa);
    subject.editor.attachRoot(built.root);
    subject.editor.handleFurniturePick(ID.sofa);
    subject.editor.dispose();
    expect(() => subject.editor.dispose()).not.toThrow();
  });
});

/**
 * The viewer's own panel is the same panel in every mode — what
 * changes is where the batch it produced goes. `'emit'` must leave the
 * document alone and hand the ops to the host, or the host's copy and the
 * viewer's drift apart silently, which is the bug the option exists to stop.
 */
describe('edits', () => {
  type EditsHarness = {
    editor: ViewerEditor;
    /** Every batch that reached the host. */
    sent: ViewerEditRequest[];
    /** Every batch the MODEL was asked to commit. */
    committed: Array<{ baseRev: number; ops: SceneOp[] }>;
    /** The last panel the editor opened, so a test can click a swatch. */
    panel: () => PanelRequest;
    rev: () => number;
  };

  function editsHarness(mode: 'local' | 'emit' | 'off'): EditsHarness {
    const sent: ViewerEditRequest[] = [];
    const committed: Array<{ baseRev: number; ops: SceneOp[] }> = [];
    let rev = 4;
    let panel: PanelRequest | null = null;
    const scene = {
      assets: [],
      walls: [],
      rooms: [{ id: ID.room, name: 'Room' }],
      interiors: [{ id: ID.oak, name: 'Oak', swatch: [FINISH.oak, FINISH.white], ops: [] }],
    };
    const deps = {
      model: {
        scene,
        registries: {},
        get rev() {
          return rev;
        },
        apply: (batch: { baseRev: number; ops: SceneOp[] }) => {
          committed.push(batch);
          rev += 1;
          return { rev, applied: batch.ops, touched: [] };
        },
      },
      ui: {
        closePanel: () => {},
        openPanel: (request: PanelRequest) => {
          panel = request;
        },
        setHint: () => {},
        setPanelBusy: () => {},
        wakeControls: () => {},
      },
      messages: createMessages('en'),
      picker: { registerFurniture: () => {}, unregister: () => {} },
      builder: {},
      animator: { attach: () => {} },
      dollhouse: {},
      renderPreview: () => null,
      rebuild: () => null,
      reseed: () => {},
      edits: editsWiring(resolveViewerOptions({ edits: mode }), (edit) => sent.push(edit)),
    } as unknown as EditorDeps;
    return {
      editor: new ViewerEditor(deps),
      sent,
      committed,
      panel: () => {
        if (!panel) throw new Error('no panel was opened');
        return panel;
      },
      rev: () => rev,
    };
  }

  /** One swatch click on the floor finish panel, through the real pick path. */
  function paintFloor(built: EditsHarness): void {
    built.editor.handleSurfacePick({ surface: 'floor', roomId: ID.room } as never, 10, 10);
    built.panel().onPick({ id: FINISH.oak, scopeChecked: false });
  }

  test("'local' commits, as it always did, and raises nothing", () => {
    const built = editsHarness('local');
    const before = built.rev();
    paintFloor(built);
    expect(built.committed).toHaveLength(1);
    expect(built.rev()).toBe(before + 1);
    expect(built.sent).toEqual([]);
  });

  test("'emit' raises exactly one batch, against the revision it was computed on, and commits nothing", () => {
    const built = editsHarness('emit');
    const before = built.rev();
    paintFloor(built);
    expect(built.committed).toEqual([]);
    expect(built.rev()).toBe(before);
    expect(built.sent).toHaveLength(1);
    expect(built.sent[0]!.baseRev).toBe(before);
    expect(built.sent[0]!.ops).toEqual([{ op: 'set_material', target: ID.room, material: FINISH.oak }]);
  });

  test("'emit' sends the ops that WOULD have been committed — the same batch, byte for byte", () => {
    const local = editsHarness('local');
    paintFloor(local);
    const emitting = editsHarness('emit');
    paintFloor(emitting);
    expect(emitting.sent[0]!.ops).toEqual(local.committed[0]!.ops);
    expect(emitting.sent[0]!.baseRev).toBe(local.committed[0]!.baseRev);
  });

  test("an interior preset in 'emit' sends its whole batch and commits nothing", () => {
    const built = editsHarness('emit');
    const before = built.rev();
    built.editor.openInteriorPanel();
    built.panel().onPick({ id: ID.oak, scopeChecked: false });
    expect(built.committed).toEqual([]);
    expect(built.rev()).toBe(before);
    expect(built.sent).toHaveLength(1);
    expect(built.sent[0]!.baseRev).toBe(before);
  });

  /**
   * `'off'`: a click opens NO panel (only `select` reaches the
   * host). The control bar's interiors button drives `openInteriorPanel`, so
   * in `'off'` it must reach nothing: no panel, and therefore no commit and no
   * emission — `'off'` is not `'local'`.
   */
  test("'off' opens no interior panel at all, and nothing commits or emits", () => {
    const built = editsHarness('off');
    const before = built.rev();
    built.editor.openInteriorPanel();
    expect(() => built.panel()).toThrow('no panel was opened');
    expect(built.committed).toEqual([]);
    expect(built.sent).toEqual([]);
    expect(built.rev()).toBe(before);
  });

  /**
   * `__viewerDebug.applyPreset` is an AUTHORING surface behind
   * `options.debug`, driven by `scripts/browser-check/presets.ts`, and the host
   * never sees it. It commits in every mode.
   */
  test("the debug `applyPreset` is ungated: it commits even in 'emit'", () => {
    const built = editsHarness('emit');
    const before = built.rev();
    built.editor.applyPreset(ID.oak);
    expect(built.rev()).toBeGreaterThan(before);
    expect(built.sent).toEqual([]);
  });
});

/**
 * `adoptUpgradedBody`: what the editor does when a placement's stand-in has
 * become its GLB minutes into a session.
 *
 * Two failures live here, and both are silent. Not re-registering leaves the
 * placement unpickable (a regression seen before). Re-registering a group
 * the editor no longer owns is the same bug with the sign flipped: a model
 * downloads for hundreds of milliseconds, and a variant swap or a plan rebuild
 * inside that window hands the pass a group nobody draws any more.
 */
describe('a landed model re-registers the body the editor still owns', () => {
  test('the bodies that left are unregistered and the live group is registered again', () => {
    const subject = harness();
    const built = stubRoot(ID.sofa);
    subject.editor.attachRoot(built.root);
    const standIn = built.item.children[0]!;
    standIn.removeFromParent();
    const glb = new THREE.Group();
    glb.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), new THREE.MeshBasicMaterial()));
    built.item.add(glb);

    subject.editor.adoptUpgradedBody(built.item, [standIn]);

    expect(subject.picker.unregistered).toEqual([standIn]);
    // `attachRoot` registered it once; the swap registers the group again, and
    // it is the group that carries the new body.
    expect(subject.picker.registered).toEqual([built.item, built.item]);
  });

  test('a group the editor no longer owns is unregistered and never registered again', () => {
    const subject = harness();
    const first = stubRoot(ID.sofa);
    subject.editor.attachRoot(first.root);
    const standIn = first.item.children[0]!;
    // A plan rebuild (or a variant swap) puts another group under the same
    // placement id; the pass in flight still holds the old one.
    const second = stubRoot(ID.sofa);
    subject.editor.attachRoot(second.root);
    subject.picker.registered.length = 0;
    subject.picker.unregistered.length = 0;

    subject.editor.adoptUpgradedBody(first.item, [standIn]);

    expect(subject.picker.unregistered).toEqual([standIn]);
    expect(subject.picker.registered).toEqual([]);
  });

  test('the aura of a selected placement is rebuilt around the body that landed', () => {
    const subject = harness();
    const built = stubRoot(ID.sofa);
    subject.editor.attachRoot(built.root);
    subject.editor.handleFurniturePick(ID.sofa);
    expect(built.item.children.filter((child) => child.name === GLOW_GROUP_NAME)).toHaveLength(1);

    const standIn = built.item.children[0]!;
    standIn.removeFromParent();
    built.item.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 1), new THREE.MeshBasicMaterial()));
    subject.editor.adoptUpgradedBody(built.item, [standIn]);

    // The stale one is fading, a fresh one is live, and the selection held.
    expect(built.item.children.filter((child) => child.name === GLOW_GROUP_NAME)).toHaveLength(2);
    expect(subject.editor.selectedFurniture()).toBe(ID.sofa);
  });
});

describe('the selection aura asks walk and tour to redraw while it exists', () => {
  test('updateGlows answers true while an aura lives or dissolves, false once none is left', () => {
    const subject = harness();
    subject.editor.attachRoot(stubRoot(ID.sofa).root);
    expect(subject.editor.updateGlows(0)).toBe(false);
    subject.editor.handleFurniturePick(ID.sofa);
    expect(subject.editor.updateGlows(16)).toBe(true);
    expect(subject.editor.updateGlows(32)).toBe(true);
    subject.editor.clearSelection();
    // Dissolving: still an aura on screen.
    expect(subject.editor.updateGlows(performance.now())).toBe(true);
    // Long after the fade-out: the tick that reaps it still drew it, the next one rests.
    expect(subject.editor.updateGlows(performance.now() + 60_000)).toBe(true);
    expect(subject.editor.updateGlows(performance.now() + 60_016)).toBe(false);
  });
});
