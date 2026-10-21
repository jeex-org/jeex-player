/**
 * The lifecycle of one document inside the running viewer: build it, register
 * the root everywhere it is indexed, wire the editor to the model, and take all
 * of that back apart when another document arrives.
 *
 * There are exactly two ways a document becomes geometry — the initial load /
 * `loadScene` (`mount`) and a plan-level commit (`rebuild`) — and both end in
 * the same registrations, so they live here instead of being repeated in the
 * composition root.
 *
 * Invariant: at most one root is registered at a time. Every entry point
 * detaches the previous root from the picker and the scene graph, and every
 * successful (re)build ends with `onDocument`, which is where the caller
 * re-seeds everything derived from the document — camera obstacles, tour
 * route, the furniture toggle, the debug API.
 *
 * Ordering invariant: `onDocument` NEVER runs before the editor has adopted the
 * new root. It re-applies the authoritative furniture visibility, and pushing
 * that onto the disposed group left hidden furniture visible again after a
 * shell rebuild. `rebuild()` therefore hands the build back to the editor,
 * which adopts it and only then calls `reseed` (`viewer-editor.ts`).
 */

import type { UsageSink } from '../shared/usage.js';
import type * as THREE from 'three';
import { SceneBuilder, type BuildResult, type SceneBuilderOptions, type UpgradeResult } from '../geometry/scene-builder.js';
import type { VariantBank } from '../assets/asset-variants.js';
import { isTouchedAsset, isTouchedOpening, type TouchedEntity } from '../scene/scene-ops.js';
import { touchedText } from '../geometry/touched-kind.js';
import { ViewerEditor } from './viewer-editor.js';
import type { EditsWiring } from './edits-wiring.js';
import { nextFrame } from './viewer-boot.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { Picker } from '../geometry/picker.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import type { FurnitureAnimator } from '../geometry/furniture-animator.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { Messages } from '../ui/messages.js';
import { toViewerError, type ViewerError } from './viewer-events.js';
import type { LoadedDocument } from './project-wiring.js';

type SceneMountDeps = {
  /** The runtime scene graph the root lives in; absent before the runtime exists. */
  scene: () => THREE.Scene | undefined;
  picker: Picker;
  dollhouse: Dollhouse;
  animator: FurnitureAnimator;
  ui: ViewerUI;
  /** This instance's catalogue; handed on to the editor it builds. */
  messages: Messages;
  renderPreview: (group: THREE.Object3D) => string | null;
  /** What the built-in panel does with an edit made in it (`edits-wiring.ts`). */
  edits: EditsWiring;
  /** Called after every successful (re)build, with the document now on screen. */
  onDocument: (model: SceneModel) => void;
  /**
   * Called after a commit that swapped an asset WITHOUT rebuilding the shell.
   * A variant swap can change an object's real size, and walk obstacles are
   * derived from that size, so they have to be recomputed even though no
   * `onDocument` fires.
   */
  onAssetsChanged: (model: SceneModel) => void;
  /**
   * Called after a commit that rebuilt an opening group WITHOUT rebuilding the
   * shell. A variant swap hands out a brand-new group whose door leaf is open
   * again, so whoever owns door state has to put it back (`door-animator.ts`).
   */
  onOpeningsChanged?: (model: SceneModel) => void;
  /**
   * Something went wrong that the HOST should hear about, not a console: a
   * commit the geometry could not follow, or a listener that threw. The
   * composition root routes it to the `error` event of the handle.
   */
  onError: (error: ViewerError) => void;
  /**
   * The first model pass of a freshly mounted document ended, and was not cut
   * short by a dispose or another document. Passes after an edit or a rebuild
   * are not reported: they say nothing about how the document loaded.
   */
  onModelsSettled?: ((model: SceneModel, result: UpgradeResult) => void) | undefined;
  /** Hears accepted actions in the built-in panels (`shared/usage.ts`). */
  usage?: UsageSink | undefined;
};

export class SceneMount {
  private readonly deps: SceneMountDeps;
  private currentModel?: SceneModel | undefined;
  private currentBuilder?: SceneBuilder | undefined;
  private currentEditor?: ViewerEditor | undefined;
  private root?: THREE.Group | undefined;
  /**
   * What the mounted document was drawn WITH (`LoadedProjectContext.key`):
   * a later document is a revision of this one only when it comes with the
   * same library. `null` while nothing is mounted.
   */
  private sourceKey: string | null = null;
  /** Unsubscribes belonging to the currently mounted model. */
  private readonly teardown: Array<() => void> = [];
  /**
   * Aborts the GLB upgrade of the CURRENT document. Released with the
   * document, so a mount that is torn down mid-download leaves no pass
   * writing into a disposed graph.
   */
  private upgrades = new AbortController();
  /** The passes queued so far, chained: two of them must never swap the same body at once. */
  private upgradePass: Promise<void> = Promise.resolve();

  constructor(deps: SceneMountDeps) {
    this.deps = deps;
  }

  get model(): SceneModel | undefined {
    return this.currentModel;
  }

  get builder(): SceneBuilder | undefined {
    return this.currentBuilder;
  }

  get editor(): ViewerEditor | undefined {
    return this.currentEditor;
  }

  get sceneRoot(): THREE.Group | undefined {
    return this.root;
  }

  /**
   * Replaces whatever is mounted with a freshly built `model`.
   *
   * `variants` is the same document's variant bank: what the Replace panel and
   * `describeSelection` offer, project entries first. Like `options` it belongs
   * to the document, not to the mount.
   *
   * `options` is what the document is DRAWN with — the project's model
   * resolver, catalogue, materials and logger, or nothing at all for a bare
   * scene (`app/project-wiring.ts`). It belongs to the document rather than to
   * the mount, which is why it arrives with the model instead of living in
   * `SceneMountDeps`: `loadScene` may swap a bare scene for a project and back.
   */
  mount(model: SceneModel, options: SceneBuilderOptions = {}, variants?: VariantBank, sourceKey = ''): BuildResult {
    this.release();
    this.sourceKey = sourceKey;
    this.currentModel = model;
    const builder = new SceneBuilder(model.scene, model.plan, options);
    this.currentBuilder = builder;
    const built = builder.build();
    this.adopt(built);
    if (built.degradedAssets > 0) this.deps.ui.showDegradedNotice();

    const editor = new ViewerEditor({
      model,
      ui: this.deps.ui,
      messages: this.deps.messages,
      picker: this.deps.picker,
      builder,
      animator: this.deps.animator,
      dollhouse: this.deps.dollhouse,
      renderPreview: this.deps.renderPreview,
      variants,
      edits: this.deps.edits,
      rebuild: () => this.rebuild(),
      reseed: () => this.deps.onDocument(model),
      usage: this.deps.usage,
    });
    this.currentEditor = editor;
    editor.attachRoot(built.root);
    // The geometry facade repaints itself from the model; the editor owns the
    // rest of a commit (pick registries, auras, swap animations, rebuilds).
    this.teardown.push(
      builder.bindModel(model, (failed) => this.handleDrift(failed)),
      model.onRevision((_rev, touched) => {
        editor.applyRevision(touched);
        // A plan-level commit ends in `reseed` -> `onDocument`, which re-seeds
        // every consumer. An incremental asset swap does not, so its own
        // consequence — the changed footprint — is published here.
        if (SceneBuilder.needsRebuild(touched)) return;
        if (touched.some((entry) => isTouchedAsset(entry))) {
          this.deps.onAssetsChanged(model);
          // A variant swap hands out a freshly BUILT (procedural) body, so the
          // new variant's own model has to be fetched the same way the first
          // one was.
          this.scheduleUpgrade(builder);
        }
        if (touched.some((entry) => isTouchedOpening(entry))) this.deps.onOpeningsChanged?.(model);
      }),
      model.onError((error) => {
        this.deps.onError(toViewerError('internal', error, 'A revision listener failed'));
      }),
    );
    this.deps.onDocument(model);
    this.scheduleUpgrade(builder, model);
    return built;
  }

  /** `mount` for a loaded document: the project's builder options, variant bank and library key. */
  mountDocument(loaded: LoadedDocument): BuildResult {
    const project = loaded.project;
    this.deps.ui.setProjectMark(project?.info.manifest.mark);
    return this.mount(loaded.model, project?.builderOptions, project?.variants, project?.key ?? '');
  }

  /**
   * `loadScene`'s door, so turning ONE object does not redraw ALL objects.
   *
   * A host that keeps the document itself (an editor host) answers each edit it
   * committed with the whole next document. When that document is the one on
   * screen — same scene id, drawn with the same library — it is committed as
   * ONE revision of the mounted model (`SceneModel.replaceDocument`), and the
   * consumers follow it piece by piece exactly as they follow an operation:
   * a turned sofa is stood anew, every other placement keeps its meshes, its
   * materials and its loaded model, and nothing is downloaded again. Anything
   * else — another scene, another library, nothing mounted — is mounted from
   * scratch, as before.
   *
   * Either way the document's consumers are re-seeded and `scene` fires once:
   * the plan-level rebuild re-seeds on its own (`ViewerEditor.rebuildShell`),
   * every other revision, an empty one included, here.
   */
  present(loaded: LoadedDocument): void {
    const current = this.currentModel;
    const sameSource =
      current !== undefined &&
      this.root !== undefined &&
      this.sourceKey === (loaded.project?.key ?? '') &&
      current.scene.id === loaded.model.scene.id;
    if (!sameSource) {
      this.mountDocument(loaded);
      return;
    }
    // Same scene, same library key: the same manifest, so the same mark.
    const committed = current.replaceDocument(loaded.model);
    if (committed === null || !SceneBuilder.needsRebuild(committed.touched)) this.deps.onDocument(current);
  }

  /**
   * Queues the GLB upgrade of every furniture body that has a model to load.
   *
   * It starts a frame LATER on purpose: `mount` runs before the first paint,
   * and the contract is that `ready` means "the first frame is drawn", with no
   * network in it. From there the pass hands a frame back between assets, so
   * a hundred-object apartment upgrades without a stutter.
   *
   * Nothing here can fail loudly: a failed model leaves the procedural body
   * (that is what `failed` counts) and a disposed mount rejects the frame
   * wait, which is the normal way a pass ends early.
   */
  private scheduleUpgrade(builder: SceneBuilder, reportFor?: SceneModel): void {
    const signal = this.upgrades.signal;
    this.upgradePass = this.upgradePass
      .then(async () => {
        if (signal.aborted) return;
        await nextFrame(signal);
        const result = await builder.upgradeModels(
          signal,
          () => nextFrame(signal),
          (group, replaced) => {
            // The editor owns furniture pick registration and the auras, so a
            // swapped body is its news, not the mount's (`viewer-editor.ts`).
            this.currentEditor?.adoptUpgradedBody(group, replaced);
          },
        );
        if (reportFor && !signal.aborted) this.deps.onModelsSettled?.(reportFor, result);
      })
      .catch(() => undefined);
  }

  /**
   * The geometry could not follow a commit: a paint the shell recognised and
   * failed to perform (`SceneBuilder.applyRevision`). The model is the truth,
   * so the shell is rebuilt from it rather than left showing the wrong finish,
   * and the host is told — a viewer that silently disagrees with its own
   * document is the failure this replaces.
   */
  private handleDrift(failed: readonly TouchedEntity[]): void {
    this.currentEditor?.rebuildFromDocument();
    this.deps.onError({
      code: 'internal',
      message: `the geometry could not follow ${failed.length} change(s) and was rebuilt: ${failed.map((entity) => touchedText(entity)).join(', ')}`,
    });
  }

  /**
   * Full geometry rebuild after a plan-level operation: the builder disposes
   * the old root and produces a fresh one from the model's re-solved plan.
   *
   * `onDocument` deliberately does NOT fire here: the caller (`ViewerEditor`)
   * still has to adopt the returned root, and re-seeding before that adoption
   * is exactly the ordering bug this split fixes.
   */
  rebuild(): BuildResult | null {
    const builder = this.currentBuilder;
    if (!builder || !this.root || !this.currentModel) return null;
    this.detach();
    const built = builder.rebuildAll();
    this.adopt(built);
    this.scheduleUpgrade(builder);
    return built;
  }

  /** Frees the mounted document; the mount can be reused with `mount`. */
  release(): void {
    for (const off of this.teardown.splice(0)) off();
    // Before the builder is disposed: a pass in flight must stop writing into
    // a graph whose caches are about to be freed.
    this.upgrades.abort();
    this.upgrades = new AbortController();
    this.detach();
    // The editor owns the selection auras — the live one and any still fading —
    // and nothing else disposes them, so dropping it is a GPU leak on a remount.
    this.currentEditor?.dispose();
    this.currentBuilder?.dispose();
    this.currentBuilder = undefined;
    this.currentEditor = undefined;
    this.currentModel = undefined;
    this.root = undefined;
    this.sourceKey = null;
  }

  /** Puts a build into the scene graph, the picker and the dollhouse. */
  private adopt(built: BuildResult): void {
    this.root = built.root;
    this.deps.scene()?.add(built.root);
    if (this.currentModel) this.deps.dollhouse.prepare(this.currentModel.plan, built.root);
    this.deps.picker.register(built.root, (wallId) => this.deps.dollhouse.isExterior(wallId));
  }

  /** Takes the current root out of the picker and the scene graph. */
  private detach(): void {
    if (!this.root) return;
    this.deps.picker.unregister(this.root);
    this.deps.scene()?.remove(this.root);
  }
}
