/**
 * Geometry facade: turns a `SolvedPlan` into meshes and keeps them in step with
 * a `SceneModel`.
 *
 * It builds nothing itself — `shell-builder.ts` builds the site, floors,
 * ceilings, wall faces and skirting and `shell-paint.ts` paints them,
 * `opening-builder.ts` builds and
 * replaces windows, doors and passages, and `asset-loader.ts` builds furniture.
 * This module is the public surface those three share: the build, the painting
 * API, `dispose()` and `applyRevision(touched)`.
 *
 * Invariant: the paint state is a projection of the model, never an
 * independent copy. `bindModel` subscribes, `applyRevision` repaints exactly
 * what a batch touched, and a plan-level change (`shell`) needs `rebuildAll`,
 * which hands the caller a fresh root to re-register.
 */

import * as THREE from 'three';
import type { Ktx2Support } from '../materials/ktx2.js';
import { sameFace, type DemoAsset, type FaceKey, type FinishRef, type SceneData } from '../scene/types.js';
import { AssetLoader, type AssetLoaderOptions, type ModelState, type ModelUrlResolver } from './asset-loader.js';
import type { AsyncModelSource } from './model-source.js';
import { MAX_MODEL_PARALLEL, MAX_PROJECT_BYTES } from '../shared/limits.js';
import { defaultLogger, type Logger } from '../shared/logger.js';
import type { CatalogueLookup, FinishIdResolver } from '../assets/asset-resolver.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import type { Finish } from '../materials/finishes.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import { createBuilderContext, type BuilderContext } from './builder-context.js';
import type { LibraryTextures } from './library-surface.js';
import { ShellBuilder } from './shell-builder.js';
import { rebaseOpeningFrames, rebaseShellOrigins } from './shell-origins.js';
import { OpeningBuilder } from './opening-builder.js';
import type { SceneModel } from '../scene/scene-model.js';
import { facadeFinishRefOf, floorFinishRefOf, roomWallFinishRefOf, type TouchedEntity } from '../scene/scene-ops.js';
import { dispatchTouched, type TouchedHandlers } from './touched-kind.js';
import { GLOW_GROUP_NAME } from './selection-glow.js';
import { bodyMirrorOf, mirrorBody } from './asset-mirror.js';
import { lampLightTag } from '../assets/artificial-light.js';

import type { OpeningListEntry } from './opening-builder.js';

/** What one build produced: the scene root and how many assets fell back to a placeholder. */
export type BuildResult = { root: THREE.Group; degradedAssets: number };

/**
 * What `applyRevision` did not do: entities that belong to another consumer
 * (`unhandled`) and paints this builder should have performed and could not
 * (`failed`). The two are not interchangeable — one is routing, the other is
 * drift.
 */
type ApplyRevisionResult = { unhandled: TouchedEntity[]; failed: TouchedEntity[] };

/** Name `SceneBuilder` gives the furniture container inside the scene root. */
export const FURNITURE_GROUP_NAME = 'demo-assets';

/** What one `upgradeModels` pass did. Placements with no model to load count as neither. */
/**
 * How one upgrade pass ended: models swapped in, models that failed, whether
 * the byte budget stopped the pass, and the first few errors the failed loads raised (for the anonymous
 * error counts; never shown to anyone).
 */
export type UpgradeResult = { upgraded: number; failed: number; budget: boolean; failures: unknown[] };

/** The most load errors one pass keeps in `UpgradeResult.failures`. */
const MAX_KEPT_FAILURES = 10;

/**
 * What the builder needs BEYOND a document and its plan.
 *
 * Everything here is absent for a bare scene, and that absence means the
 * built-in defaults: the shipped catalogue, the procedural builders, the
 * bundled finishes and a starter library with no `baseUrl` to fetch from. A
 * baked project fills every field in, and nothing in the geometry layer has to
 * know which of the two it is drawing.
 */
export type SceneBuilderOptions = {
  modelUrl?: ModelUrlResolver | undefined;
  modelSource?: AsyncModelSource | undefined;
  /** The object bank placements resolve against; the shipped catalogue when absent. */
  catalogue?: CatalogueLookup | undefined;
  /** The library id `catalogue` answers for: a baked project's `library.id`. */
  catalogueLibrary?: string | undefined;
  /** How a finish id is canonicalised on a furniture slot. */
  resolveFinish?: FinishIdResolver | undefined;
  /** The project's `library.materials`: furniture finishes AND, through `findFinish`, room surfaces. */
  projectMaterials?: readonly ProjectMaterial[] | undefined;
  /** Room-surface finish lookup; the bundled catalogue when absent (`builder-context.ts`). */
  findFinish?: ((id: string) => Finish | null) | undefined;
  /** Where library materials on room surfaces take their maps from; flat colours only when absent. */
  textures?: LibraryTextures | undefined;
  /** `'omit'` for the files of a baked project. */
  credentials?: RequestCredentials | undefined;
  /** The viewer's KTX2 transcoder, for GLBs that use `KHR_texture_basisu`; such GLBs are refused without it. */
  ktx2?: Ktx2Support | undefined;
  /** Where `asset-defect` and `project-budget` are reported; the console when absent. */
  log?: Logger | undefined;
};

/** Hands the caller a frame back between assets so a long upgrade pass cannot drop the frame rate. */
export type YieldFrame = () => Promise<void>;

/**
 * Told about one placement whose body has just become its GLB: the group, now
 * holding the new body, and the bodies that left it.
 *
 * The pick registries are keyed by MESH and it is `Picker.registerFurniture`
 * that writes `surface`/`assetId` onto one (`geometry/picker.ts`), so the swap
 * is exactly the moment they go stale: the stand-in's meshes stay in them,
 * detached, and the GLB's meshes are in no registry and carry no `userData` a
 * pick can read. `app/scene-mount.ts` routes this to the editor, which owns
 * furniture registration and only re-registers the body it still holds.
 */
export type BodySwapped = (group: THREE.Group, replaced: readonly THREE.Object3D[]) => void;

/** The lights built from a variant's `lights` fact under `bodies` (never a builder's bulb). */
function factLightsUnder(bodies: readonly THREE.Object3D[]): THREE.Object3D[] {
  const lights: THREE.Object3D[] = [];
  for (const body of bodies) {
    body.traverse((child) => {
      if (lampLightTag(child) !== null) lights.push(child);
    });
  }
  return lights;
}

/**
 * The group that IS each placement's body right now, keyed by placement id.
 *
 * Direct children only, and the LAST one wins. A variant swap ADDS the new
 * group and leaves the old one attached until the animator's tween removes it
 * (`app/viewer-editor.ts` `swapFurniture`, `geometry/furniture-animator.ts`),
 * so for about a tenth of a second two groups answer to the same name — and
 * `Object3D.getObjectByName` is a depth-first FIRST match, which answers with
 * the one that is leaving. The pass a swap schedules starts one frame later,
 * well inside that window, so it downloaded into a group nobody would draw and
 * the replacement kept its stand-in for ever («when the armchair is swapped
 * nothing changes»).
 */
function liveBodies(furniture: THREE.Object3D): Map<string, THREE.Group> {
  const bodies = new Map<string, THREE.Group>();
  for (const child of furniture.children) {
    if (child instanceof THREE.Group) bodies.set(child.name, child);
  }
  return bodies;
}

export class SceneBuilder {
  private scene: SceneData;
  private plan: SolvedPlan;
  private ctx: BuilderContext;
  private shell: ShellBuilder;
  private openings: OpeningBuilder;
  private assetLoader: AssetLoader;
  private root: THREE.Group | null = null;
  private model: SceneModel | null = null;
  private readonly options: SceneBuilderOptions;
  private readonly log: Logger;
  /**
   * Bytes this builder has pulled for MODELS since it was constructed, against
   * `MAX_PROJECT_BYTES`.
   *
   * Per builder rather than per pass: the budget is what one document is
   * allowed to download, and a variant swap that re-runs the pass must not get
   * a fresh allowance. `rebuildAll` constructs a new builder's worth of state
   * and deliberately keeps this number, because it is the same document.
   */
  private modelBytes = 0;

  constructor(scene: SceneData, plan: SolvedPlan, options: SceneBuilderOptions = {}) {
    this.scene = scene;
    this.plan = plan;
    this.options = options;
    this.log = options.log ?? defaultLogger;
    this.ctx = createBuilderContext(scene, plan, options.findFinish, options.projectMaterials, options.textures ?? null);
    this.shell = new ShellBuilder(this.ctx);
    this.openings = new OpeningBuilder(this.ctx);
    // One loader for the whole scene: geometry and finishes are shared between
    // the initial build and every later variant swap.
    this.assetLoader = this.newAssetLoader();
  }

  /** The loader for the CURRENT scene, with whatever model delivery this builder was given. */
  private newAssetLoader(): AssetLoader {
    const options: AssetLoaderOptions = {
      defaultLibrary: this.scene.assetLibrary,
      ceilingHeight: this.scene.ceilingHeight,
      modelUrl: this.options.modelUrl,
      modelSource: this.options.modelSource,
      catalogue: this.options.catalogue,
      catalogueLibrary: this.options.catalogueLibrary,
      resolveFinish: this.options.resolveFinish,
      projectMaterials: this.options.projectMaterials,
      credentials: this.options.credentials,
      ktx2: this.options.ktx2,
      log: this.log,
    };
    return new AssetLoader(this.scene.materials ?? [], options);
  }

  /**
   * The document as it is COMMITTED right now.
   *
   * `this.scene` is the one this builder was CONSTRUCTED with, and `apply`
   * hands the model a NEW frozen object on every commit (`scene/scene-model.ts`)
   * — only `rebuildAll` re-reads it, which an asset- or opening-level commit
   * deliberately does not do. So everything that has to agree with the document
   * as it stands reads it through here: the upgrade queue, whose placements
   * carry the variants, and the paint dispatch. Read `this.scene` directly only
   * where the question is genuinely about the document this builder was BUILT
   * from (the asset loader's library and its materials).
   *
   * Found the hard way: the pass fetched the model of the variant
   * a swap had just replaced.
   */
  private get committedScene(): SceneData {
    return this.model?.scene ?? this.scene;
  }

  build(): BuildResult {
    const root = new THREE.Group();
    root.name = this.scene.id;
    const shell = new THREE.Group();
    shell.name = 'parametric-shell';
    this.shell.build(shell);
    this.openings.build(shell);
    // Origins inside the rooms, vertices unchanged: walk lighting picks a mesh's grid by its origin.
    rebaseShellOrigins(shell, this.plan, this.scene.ceilingHeight);
    root.add(shell);

    let degradedAssets = 0;
    const furniture = new THREE.Group();
    furniture.name = FURNITURE_GROUP_NAME;
    for (const asset of this.scene.assets) {
      const result = this.assetLoader.load(asset);
      if (result.degraded) degradedAssets += 1;
      furniture.add(result.group);
    }
    root.add(furniture);
    this.root = root;
    return { root, degradedAssets };
  }

  /**
   * Frees every geometry and material this builder created: the shell, the
   * openings and the asset loader's shared geometry and finish caches. After
   * `dispose` the builder is dead; `rebuildAll` constructs fresh parts.
   */
  dispose(): void {
    this.openings.dispose();
    this.shell.dispose();
    this.assetLoader.dispose();
    this.root?.removeFromParent();
    this.root = null;
  }

  // ------------------------------------------------------------ furniture ----

  /** Builds a furniture item with a specific bank variant applied. */
  buildFurnitureVariant(asset: DemoAsset, variantId?: string): THREE.Group | null {
    return this.assetLoader.load(asset, variantId).group;
  }

  /**
   * Stands a built placement group where `asset` says, keeping its body
   * (`AssetLoader.repose`); `false` when it has to be built again.
   */
  poseFurniture(group: THREE.Group, asset: DemoAsset): boolean {
    return this.assetLoader.repose(group, asset);
  }

  /**
   * Swaps every procedural body whose catalogue entry names a `model` for the
   * GLB the library serves — after the first frame, one asset at a time.
   *
   * The GROUP survives: same object, same `userData` (plus `modelState` and,
   * when the library got something wrong, `modelWarnings`), same transform.
   * The BODY does not, and everything keyed by its meshes has to follow it —
   * `onSwapped` is how, and a caller that does not pass it gets a placement
   * whose click falls through to the floor behind it.
   *
   * `ready` never waits for this: the first frame is procedural by design and
   * a failure here is not a degraded scene, only a body that stays procedural
   * and is counted in `failed`. Aborting (a dispose, another document) ends
   * the pass where it stands and leaves the bodies already swapped alone.
   *
   * The detached procedural body is NOT disposed mesh by mesh: its geometry
   * and materials come from the loader's shared caches, and freeing them here
   * would empty them under every other placement of the same archetype. The
   * loader frees them with everything else in `dispose()`.
   */
  async upgradeModels(signal: AbortSignal, yieldFrame?: YieldFrame, onSwapped?: BodySwapped): Promise<UpgradeResult> {
    const furniture = this.root?.getObjectByName(FURNITURE_GROUP_NAME);
    const result: UpgradeResult = { upgraded: 0, failed: 0, budget: false, failures: [] };
    if (!furniture) return result;
    const queue = this.upgradeQueue(furniture);
    let next = 0;
    let stopped = false;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal.aborted || stopped) return;
        const entry = queue[next++];
        if (!entry) return;
        const swapped = await this.upgradeOne(entry.placement, entry.group, signal, onSwapped, (error) => {
          if (result.failures.length < MAX_KEPT_FAILURES) result.failures.push(error);
        });
        if (swapped === 'upgraded') result.upgraded += 1;
        else if (swapped === 'failed') result.failed += 1;
        if (this.modelBytes > MAX_PROJECT_BYTES) {
          // Every worker stops, not just this one: the budget is the
          // document's, and the remaining placements keep their stand-ins.
          stopped = true;
          result.budget = true;
          this.log.warn('project-budget', `project models stopped after ${this.modelBytes} bytes`, {
            bytes: this.modelBytes,
            limit: MAX_PROJECT_BYTES,
            loaded: result.upgraded,
            pending: queue.length - next,
          });
          return;
        }
        // A frame back between assets, so a hundred-object apartment upgrades
        // without a stutter. Only after work that actually touched the graph.
        if (swapped !== 'absent' && yieldFrame) await yieldFrame();
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_MODEL_PARALLEL, queue.length) }, () => worker()));
    return result;
  }

  /**
   * The placements still waiting for a body, nearest to the presentation
   * camera first.
   *
   * "Nearest first" is the whole point of the order: the first
   * thing a visitor looks at is what the opening shot frames, so that is what
   * the connection is spent on, and the wait is paid by what is out of shot. A
   * document with no presentation camera keeps DOCUMENT order, which is the
   * author's own sequence and the only other defensible answer.
   */
  private upgradeQueue(furniture: THREE.Object3D): Array<{ placement: DemoAsset; group: THREE.Group }> {
    const scene = this.committedScene;
    const bodies = liveBodies(furniture);
    const queue: Array<{ placement: DemoAsset; group: THREE.Group }> = [];
    for (const placement of scene.assets) {
      const group = bodies.get(placement.id);
      if (!group || group.userData['modelState'] !== ('procedural' satisfies ModelState)) continue;
      queue.push({ placement, group });
    }
    const eye = scene.presentationCamera?.position;
    if (!eye) return queue;
    const distance = ({ placement }: { placement: DemoAsset }): number => {
      const dx = placement.position.x - eye.x;
      const dy = placement.position.y - eye.y;
      const dz = placement.position.z - eye.z;
      return dx * dx + dy * dy + dz * dz;
    };
    // Decorated, not compared in place: `sort` calls the comparator O(n log n)
    // times and the distance of a placement does not change during the sort.
    return queue
      .map((entry, index) => ({ entry, index, key: distance(entry) }))
      .sort((a, b) => a.key - b.key || a.index - b.index)
      .map((ranked) => ranked.entry);
  }

  /** One placement's upgrade; `absent` when the catalogue names no model to load. */
  private async upgradeOne(
    placement: DemoAsset,
    group: THREE.Group,
    signal: AbortSignal,
    onSwapped?: BodySwapped,
    onFailed?: (error: unknown) => void,
  ): Promise<'upgraded' | 'failed' | 'absent'> {
    let upgrade;
    try {
      upgrade = await this.assetLoader.upgrade(placement, signal);
    } catch (error) {
      if (!signal.aborted) onFailed?.(error);
      // Every reason a model can fail — offline, 404, a corrupt container, a
      // dispose mid-flight — ends the same way: the body that is already on
      // screen stays on screen.
      if (!signal.aborted) group.userData['modelState'] = 'failed' satisfies ModelState;
      return signal.aborted ? 'absent' : 'failed';
    }
    if (!upgrade || signal.aborted) return 'absent';
    this.modelBytes += upgrade.bytes;
    // The aura of a selected object lives under the same group and is not a
    // body (`geometry/selection-glow.ts`): dropping it here would make a
    // selection vanish the moment its model landed.
    const replaced = group.children.filter((child) => child.name !== GLOW_GROUP_NAME);
    const lamps = factLightsUnder(replaced);
    for (const child of replaced) child.removeFromParent();
    // The model joins reflected the way the group's procedural body was.
    mirrorBody(upgrade.body, bodyMirrorOf(group));
    group.add(upgrade.body);
    // The SAME lights move onto the model, with their tint and bake mark.
    // `add`, not `attach`: each keeps its local position, the bulb in the
    // model frame, so it follows the drawn GLB even where its pose differs.
    for (const light of lamps) upgrade.body.add(light);
    group.userData['modelState'] = 'gltf' satisfies ModelState;
    // A body that arrived is no longer a stand-in, whatever it arrived with.
    delete group.userData['degraded'];
    if (upgrade.warnings.length > 0) {
      group.userData['modelWarnings'] = [...upgrade.warnings];
      // A defect of the LIBRARY, never a failure of the viewer:
      // the body is on screen, and the host hears what was wrong with it.
      this.log.warn('asset-defect', `${placement.id}: ${upgrade.warnings.join(', ')}`, {
        placementId: placement.id,
        warnings: [...upgrade.warnings],
      });
    }
    // Last, so the graph AND every `userData` key — `modelWarnings` included —
    // are final by the time a listener reads them.
    try {
      onSwapped?.(group, replaced);
    } catch (error) {
      // A listener that throws must not strand the placements still queued
      // behind it: the pass is contracted never to fail loudly, and a worker
      // that dies here would end the whole pass in `scheduleUpgrade`'s catch
      // with nothing said (`app/scene-mount.ts`).
      this.log.error('listener-failed', `model-swap listener failed for ${placement.id}`, error);
    }
    return 'upgraded';
  }

  // -------------------------------------------------------------- openings ---

  /**
   * Replaces one window, door or passage with another variant of the same
   * family. Only that opening's group is rebuilt.
   */
  rebuildOpening(openingId: string, variantId: string): boolean {
    const rebuilt = this.openings.rebuildOpening(openingId, variantId);
    const group = rebuilt ? this.openings.groupOf(openingId) : null;
    if (group) rebaseOpeningFrames(group);
    return rebuilt;
  }

  /** Variant id currently shown for an opening, or `null` when it is unknown. */
  getOpeningVariant(openingId: string): string | null {
    return this.openings.variantOf(openingId);
  }

  /** The group of one opening, so callers can re-register its pick meshes. */
  getOpeningGroup(openingId: string): THREE.Group | null {
    return this.openings.groupOf(openingId);
  }

  /** Every built opening with the data needed to find and click it. */
  openingsList(): OpeningListEntry[] {
    return this.openings.list();
  }

  // -------------------------------------------------------------- finishes ---

  /** Swaps one room's floor finish (`set_material` with a `<room id>` target). */
  setRoomFloor(roomId: string, finish: FinishRef): boolean {
    return this.shell.paint.setRoomFloor(roomId, finish);
  }

  setAllFloors(finish: FinishRef): void {
    this.shell.paint.setAllFloors(finish);
  }

  getFloorFinish(roomId: string): string | null {
    return this.shell.paint.getFloorFinish(roomId);
  }

  /** Paints every face of a room's loop and drops that room's per-face overrides. */
  setRoomWall(roomId: string, finish: FinishRef): boolean {
    return this.shell.paint.setRoomWall(roomId, finish);
  }

  getRoomWall(roomId: string): string | null {
    return this.shell.paint.getRoomWall(roomId);
  }

  /** Paints a single face (corner to corner, or up to a T-junction). */
  setFaceWall(face: FaceKey, finish: FinishRef): boolean {
    return this.shell.paint.setFaceWall(face, finish);
  }

  /** Effective finish of a face: its own override, else the room's or the facade's. */
  getFaceWall(face: FaceKey): string | null {
    return this.shell.paint.getFaceWall(face);
  }

  /** Paints every outer face of the building as one area. */
  setFacadeWall(finish: FinishRef): boolean {
    return this.shell.paint.setFacadeWall(finish);
  }

  getFacadeWall(): string {
    return this.shell.paint.getFacadeWall();
  }

  /** Paints every room; the facade keeps its own finish. */
  setAllWalls(finish: FinishRef): void {
    this.shell.paint.setAllWalls(finish);
  }

  /** Repaints a room's ceiling from the committed document. */
  setRoomCeiling(roomId: string): boolean {
    return this.shell.paint.setRoomCeiling(roomId);
  }

  /** Repaints a room's baseboards from the committed document. */
  setRoomTrim(roomId: string): boolean {
    return this.shell.paint.setRoomTrim(roomId);
  }

  /**
   * Drops a per-face override so the face falls back to its room or the
   * facade. `false` when the plan has no such face.
   */
  resetFaceWall(face: FaceKey): boolean {
    return this.shell.paint.resetFaceWall(face);
  }

  /** Faces of a room's loop, in walk order. */
  facesOfRoom(roomId: string): FaceKey[] {
    return this.shell.paint.facesOfRoom(roomId);
  }

  // ------------------------------------------------------- model binding ----

  /**
   * Subscribes the geometry to a `SceneModel`: every committed batch repaints
   * exactly the surfaces the batch touched and nothing else. Returns the
   * unsubscribe function.
   *
   * `onDrift` is told about the paints this builder RECOGNISED but could not
   * perform. That is the model and the meshes coming apart, and the only honest
   * answer is a full rebuild — which only the caller can wire back into the
   * scene graph, so the decision is reported, not taken here.
   */
  bindModel(model: SceneModel, onDrift?: (failed: readonly TouchedEntity[]) => void): () => void {
    this.model = model;
    // The paint getters project the model, so the shell must read the CURRENT
    // committed document: `apply` swaps in a new object on every commit.
    this.shell.paint.bindScene(() => model.scene);
    return model.onRevision((_rev, touched) => {
      const { failed } = this.applyRevision(touched);
      if (failed.length > 0) onDrift?.(failed);
    });
  }

  /**
   * Applies a commit incrementally and reports what it did not do.
   *
   * `unhandled` are the entities that are not this builder's business: assets
   * and openings need the pick registries and swap animations of the composition
   * root, and `shell` needs `rebuildAll`, which only the composition root can
   * wire back into the scene graph. They are routine.
   *
   * `failed` is the serious half: a paint this builder RECOGNISED and could not
   * perform (an unknown finish, a face or room the plan does not have). That is
   * the model and the meshes drifting apart, so it is reported to `bindModel`'s
   * `onDrift` — a `console.warn` here would leave a viewer showing the wrong
   * finish with nothing but a line in a console nobody is reading.
   */
  applyRevision(touched: readonly TouchedEntity[]): ApplyRevisionResult {
    const ctx: SceneBuilderApplyCtx = { builder: this, scene: this.committedScene, unhandled: [], failed: [] };
    dispatchTouched(ctx, touched, SCENE_BUILDER_TOUCHED_HANDLERS);
    return { unhandled: ctx.unhandled, failed: ctx.failed };
  }

  /** Resolves once every library map of the current shell has attached or given up (`ShellPaint.mapsSettled`). */
  mapsSettled(): Promise<void> {
    return this.shell.paint.mapsSettled();
  }

  /** True when a batch changed the plan itself and needs `rebuildAll`. */
  static needsRebuild(touched: readonly TouchedEntity[]): boolean {
    return touched.some((entity) => entity.kind === 'shell');
  }

  /**
   * Full rebuild after a plan-level change (`set_ceiling`, `set_opening`,
   * `add`/`remove_opening`): disposes everything this builder owns and builds a
   * fresh root from the model's current scene and plan. The caller adds the new
   * root to the scene graph and re-registers it with the `Picker`; `main.ts`
   * never re-runs.
   */
  rebuildAll(): BuildResult {
    const model = this.model;
    if (model) {
      this.scene = model.scene;
      this.plan = model.plan;
    }
    this.dispose();
    this.ctx = createBuilderContext(
      this.scene,
      this.plan,
      this.options.findFinish,
      this.options.projectMaterials,
      this.options.textures ?? null,
    );
    this.shell = new ShellBuilder(this.ctx);
    if (model) this.shell.paint.bindScene(() => model.scene);
    this.openings = new OpeningBuilder(this.ctx);
    this.assetLoader = this.newAssetLoader();
    return this.build();
  }
}

/** What `SCENE_BUILDER_TOUCHED_HANDLERS` reads and accumulates into per commit. */
type SceneBuilderApplyCtx = { builder: SceneBuilder; scene: SceneData; unhandled: TouchedEntity[]; failed: TouchedEntity[] };

/** Every kind `SceneBuilder` does not paint (routing, not drift — see `applyRevision`'s own doc). */
const routeAsUnhandled = (ctx: SceneBuilderApplyCtx, entity: TouchedEntity): void => {
  ctx.unhandled.push(entity);
};

/**
 * The touched-entity dispatch table `applyRevision` folds over — shared in SHAPE
 * (the `TouchedHandlers` table and the `dispatchTouched` loop, `touched-kind.ts`)
 * with `ViewerEditor.applyRevision`'s own table, which dispatches the two
 * kinds this one treats as routine (one shared touched-entity dispatch table
 * for the two `applyRevision`s keeps their complexity down).
 */
const SCENE_BUILDER_TOUCHED_HANDLERS: TouchedHandlers<SceneBuilderApplyCtx> = {
  facade: (ctx, entity) => {
    if (!ctx.builder.setFacadeWall(facadeFinishRefOf(ctx.scene))) ctx.failed.push(entity);
  },
  floor: (ctx, entity) => {
    const finish = floorFinishRefOf(ctx.scene, entity.room);
    if (!finish || !ctx.builder.setRoomFloor(entity.room, finish)) ctx.failed.push(entity);
  },
  walls: (ctx, entity) => {
    if (!ctx.builder.setRoomWall(entity.room, roomWallFinishRefOf(ctx.scene, entity.room))) ctx.failed.push(entity);
  },
  face: (ctx, entity) => {
    const override = ctx.scene.finishes?.faces?.find((entry) => sameFace(entry, entity.face))?.finish;
    if (override) {
      if (!ctx.builder.setFaceWall(entity.face, override)) ctx.failed.push(entity);
    } else if (!ctx.builder.resetFaceWall(entity.face)) {
      ctx.failed.push(entity);
    }
  },
  ceiling: (ctx, entity) => {
    if (!ctx.builder.setRoomCeiling(entity.room)) ctx.failed.push(entity);
  },
  trim: (ctx, entity) => {
    if (!ctx.builder.setRoomTrim(entity.room)) ctx.failed.push(entity);
  },
  // `shell`, `asset` and `opening` belong to another consumer (the composition
  // root); cameras, navigation and the tour are not geometry at all — all of
  // them are routing, not drift, so they go through the same handler.
  shell: routeAsUnhandled,
  asset: routeAsUnhandled,
  opening: routeAsUnhandled,
  camera: routeAsUnhandled,
  navigation: routeAsUnhandled,
  autotour: routeAsUnhandled,
  tourCheckpoints: routeAsUnhandled,
  site: routeAsUnhandled,
};
