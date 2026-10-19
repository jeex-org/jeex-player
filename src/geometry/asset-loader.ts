/**
 * Instantiates object-bank placements into Three.js groups for the scene.
 *
 * The documented delivery path is glTF/GLB served from a library `baseUrl`,
 * and it is ASYNCHRONOUS: `load` always builds the procedural
 * body, so the first frame owes nothing to the network, and `upgrade` fetches
 * the GLB afterwards for whoever wants to swap it in
 * (`SceneBuilder.upgradeModels`). The standalone demo therefore works with no
 * network and no bundled binaries — its starter library declares no `baseUrl`,
 * so `upgrade` has nothing to fetch. A placement that resolves to nothing at
 * all degrades to a neutral placeholder rather than vanishing from the scene.
 *
 * Invariants: `group.userData.assetId` is always the placement id; geometry and
 * materials are shared through the loader's caches and are disposed only by
 * `dispose()`, never by the scene.
 */

import * as THREE from 'three';
import { effectiveAsset } from '../scene/types.js';
import type { DemoAsset, MaterialDefinition } from '../scene/types.js';
import { DEFAULT_LIBRARY, interiorLibrary } from '../assets/asset-catalogue.js';
import {
  DEFAULT_CEILING_HEIGHT,
  isResolved,
  resolveAsset,
  type CatalogueLookup,
  type FinishIdResolver,
  type ResolveResult,
  type ResolvedAsset,
} from '../assets/asset-resolver.js';
import { FinishRegistry } from '../assets/asset-finishes.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import { defaultLogger, type Logger } from '../shared/logger.js';
import { BUILDERS } from '../assets/asset-builders.js';
import { GeometryCache, makeBuildKit } from '../assets/asset-kit.js';
import { prepareGltfBody } from './gltf-body.js';
import { MIRROR_FACTS_USERDATA_KEY, setBodyMirror } from './asset-mirror.js';
import {
  countTriangles,
  createGltfModelSource,
  type AsyncModelSource,
  type DisposableModelSource,
  type ModelRequest,
  type ModelSourceOptions,
} from './model-source.js';

type AssetResult = { group: THREE.Group; degraded: boolean };

/** How a body was last built: the state `SceneBuilder.upgradeModels` moves a group through. */
export type ModelState = 'procedural' | 'gltf' | 'failed';

/**
 * What `userData.degraded` says while a project object waits for its GLB.
 *
 * It is NOT a defect and is not counted in `BuildResult.degradedAssets`: a
 * baked project has no procedural body by design, so the stand-in
 * is the first frame doing its job. The key is the same one a real failure
 * writes, because a host reading `userData` asks one question - "is this the
 * real thing yet" - and the answer is one field.
 */
export const PENDING_MODEL = 'pending-model';

/** A GLB body ready to take a procedural one's place, with whatever the catalogue got wrong. */
export type ModelUpgrade = {
  body: THREE.Group;
  triangles: number;
  warnings: readonly string[];
  /** Bytes this upgrade pulled off the network; `0` when the container was already parsed. */
  bytes: number;
};

/**
 * Where a catalogue `model` is actually served from.
 *
 * A function rather than a URL template because the catalogue's delivery is
 * the LIBRARY's business, not the loader's: a hosted catalogue signs its URLs, a
 * self-hosted one prefixes a path, and the starter library serves nothing at
 * all. `undefined` means "no model for this placement" and is the normal
 * answer offline.
 */
export type ModelUrlResolver = (asset: ResolvedAsset) => string | undefined;

export type AssetLoaderOptions = {
  defaultLibrary?: string | undefined;
  /** Ceiling height of the scene, metres; drives ceiling-mounted fixtures. */
  ceilingHeight?: number;
  modelUrl?: ModelUrlResolver | undefined;
  /** Injected transport, for tests and for a host with its own; the loader makes its own when absent. */
  modelSource?: AsyncModelSource | undefined;
  /** The object bank placements resolve against; the shipped catalogue when absent. */
  catalogue?: CatalogueLookup | undefined;
  /** How a finish id is canonicalised; wider than the bundled bank for a project. */
  resolveFinish?: FinishIdResolver | undefined;
  /** The loaded project's `library.materials`: the first source the finish registry asks. */
  projectMaterials?: readonly ProjectMaterial[] | undefined;
  /** Where a finish that resolved to nothing is reported; the console when absent. */
  log?: Logger | undefined;
  /** `'omit'` for the files of a baked project; the platform default when absent. */
  credentials?: RequestCredentials | undefined;
};

/**
 * How solid a `dims` placeholder is drawn while its GLB is on the way.
 *
 * Translucent rather than wireframe: the first frame of a baked
 * project is the shell plus these, and a room full of wireframe boxes reads as
 * a broken viewer, while a room full of soft volumes reads as one that is
 * still loading.
 */
const PENDING_OPACITY = 0.35;

/** Colour of a pending placeholder - a neutral that belongs to no finish. */
const PENDING_COLOUR = '#93a7b3';

/** Colour of the placeholder a placement that resolved to NOTHING gets. */
const DEGRADED_COLOUR = '#b36f62';

/** Corner radius of a placeholder box, metres. */
const PLACEHOLDER_RADIUS = 0.04;

/** Edge of the cube a placement with no known `dims` degrades to, metres. */
const UNKNOWN_DIMS_M = 0.6;

/**
 * Default delivery: the starter library's `baseUrl` joined with the entry's
 * `model`. The starter manifest declares no `baseUrl` (`asset-library.ts`), so
 * this answers `undefined` for every placement until a hosted library replaces
 * it — which is what keeps the offline demo request-free.
 */
function libraryModelUrl(asset: ResolvedAsset): string | undefined {
  const base = interiorLibrary.baseUrl;
  return base && asset.model ? `${base}${asset.model}` : undefined;
}

export class AssetLoader {
  private readonly finishes: FinishRegistry;
  private readonly geometries = new GeometryCache();
  private readonly defaultLibrary: string;
  private readonly ceilingHeight: number;
  private readonly modelUrl: ModelUrlResolver;
  private readonly modelSource?: AsyncModelSource | undefined;
  /** The source this loader made itself, and is therefore the one to free. */
  private ownedSource?: DisposableModelSource | undefined;
  /** Cleanups builders registered for resources outside the caches (a mirror's reflection target). */
  private readonly disposables: Array<() => void> = [];

  private readonly catalogue?: CatalogueLookup | undefined;
  private readonly resolveFinish?: FinishIdResolver | undefined;
  /** What the loader's OWN source is built with; an injected source is configured by its maker. */
  private readonly sourceOptions: ModelSourceOptions;

  constructor(sceneMaterials: readonly MaterialDefinition[] = [], options: AssetLoaderOptions = {}) {
    this.finishes = new FinishRegistry(sceneMaterials, options.projectMaterials ?? [], options.log ?? defaultLogger);
    this.defaultLibrary = options.defaultLibrary ?? DEFAULT_LIBRARY;
    this.ceilingHeight = options.ceilingHeight ?? DEFAULT_CEILING_HEIGHT;
    this.modelUrl = options.modelUrl ?? libraryModelUrl;
    this.modelSource = options.modelSource;
    this.catalogue = options.catalogue;
    this.resolveFinish = options.resolveFinish;
    this.sourceOptions = options.credentials === undefined ? {} : { credentials: options.credentials };
  }

  /** The one place `resolveAsset` is called from, so both callers speak the same bank. */
  private resolution(placement: DemoAsset, variantId?: string): ResolveResult {
    const request = variantId ? { ...placement, variant: variantId } : placement;
    return resolveAsset(request, {
      defaultLibrary: this.defaultLibrary,
      ceilingHeight: this.ceilingHeight,
      catalogue: this.catalogue,
      resolveFinish: this.resolveFinish,
    });
  }

  /**
   * Builds one placement. `variantId` overrides the placement's own variant,
   * which is how the replace panel previews and swaps bank variants.
   */
  load(placement: DemoAsset, variantId?: string): AssetResult {
    const resolution = this.resolution(placement, variantId);
    if (!isResolved(resolution)) {
      const group = this.placeholder(placement, resolution.failure.reason);
      group.position.set(placement.position.x, placement.position.y, placement.position.z);
      return { group, degraded: true };
    }
    const asset = resolution.asset;
    const built = this.buildBody(asset);
    // No body, but a model to fetch: this is a PROJECT object, and
    // the `dims` stand-in is the first frame by design, not a failure. It goes
    // through the same group path as a built body - same transform, same
    // `userData`, same `modelState: 'procedural'` - so `upgradeModels` finds
    // it and the picker indexes it exactly like anything else.
    if (!built && asset.model) {
      const group = this.dressedGroup(placement, asset, this.pendingBody(asset));
      group.userData['degraded'] = PENDING_MODEL;
      return { group, degraded: false };
    }
    if (!built) {
      const group = this.placeholder(placement, 'unknown-builder', asset.dims);
      group.position.set(placement.position.x, asset.mountY, placement.position.z);
      return { group, degraded: true };
    }
    return { group: this.dressedGroup(placement, asset, built), degraded: false };
  }

  /** The group every drawn placement gets: named, placed, tagged and shadowed. */
  private dressedGroup(placement: DemoAsset, asset: ResolvedAsset, body: THREE.Object3D): THREE.Group {
    const group = new THREE.Group();
    group.name = placement.id;
    group.add(body);
    setBodyMirror(group, placement.mirror);
    this.applyTransform(group, placement, asset);
    this.tagUserData(group, placement, asset);
    this.applyShadows(group);
    return group;
  }

  /**
   * Stands an already built body where `placement` says, without building it
   * again: position (the anchor's mount height included), yaw, scale, mirror,
   * and the `userData` that follows the pose (room, collision box). Its body,
   * GLB or procedural, and its `modelState` stay exactly as they are.
   *
   * For a placement whose body is the same (`scene/scene-diff.ts` `sameBody`):
   * a move, a turn, a mirror committed by a host. `false` when the placement
   * no longer resolves — the caller builds it again, which draws the
   * placeholder that tells the truth.
   */
  repose(group: THREE.Group, placement: DemoAsset): boolean {
    const resolution = this.resolution(placement);
    if (!isResolved(resolution) || typeof group.userData['archetypeId'] !== 'string') return false;
    const asset = resolution.asset;
    setBodyMirror(group, placement.mirror);
    this.applyTransform(group, placement, asset);
    if (placement.room) group.userData['roomId'] = placement.room;
    else delete group.userData['roomId'];
    if (placement.collision) group.userData['collision'] = { hx: placement.collision.hx, hz: placement.collision.hz };
    else if (asset.anchor === 'floor') group.userData['collision'] = { hx: asset.dims[0] / 2, hz: asset.dims[2] / 2 };
    else delete group.userData['collision'];
    group.updateMatrixWorld(true);
    return true;
  }

  /**
   * Resolves a placement the way `load` does, so a caller that only wants the
   * catalogue's answer does not have to build geometry for it.
   */
  resolve(placement: DemoAsset, variantId?: string): ResolvedAsset | undefined {
    const resolution = this.resolution(placement, variantId);
    return isResolved(resolution) ? resolution.asset : undefined;
  }

  /**
   * Fetches the GLB the catalogue names for `placement` and returns a body
   * ready to take the procedural one's place — same finishes, same slots, same
   * shadows.
   *
   * `undefined` means "this placement has no model to load": no `model` in the
   * catalogue, or a library with no `baseUrl` to serve it from. A model that
   * exists and fails REJECTS, so the caller can count the failure instead of
   * mistaking it for an absent one.
   */
  async upgrade(placement: DemoAsset, signal: AbortSignal, variantId?: string): Promise<ModelUpgrade | undefined> {
    const asset = this.resolve(placement, variantId);
    const url = asset ? this.modelUrl(asset) : undefined;
    if (!asset || !url) return undefined;
    const request: ModelRequest = {
      url,
      archetypeId: asset.archetypeId,
      variantId: asset.variantId,
      dims: asset.dims,
      materialSlots: asset.materialSlots,
    };
    const source = this.modelSource ?? (this.ownedSource ??= createGltfModelSource(this.sourceOptions));
    const loaded = await source(request, signal);
    const prepared = prepareGltfBody(loaded.group, request, this.finishes, asset.finishes, { baked: asset.baked });
    prepared.group.name = `${asset.variantId}-gltf`;
    return {
      body: prepared.group,
      triangles: prepared.triangles,
      warnings: [...loaded.warnings, ...prepared.warnings],
      bytes: loaded.bytes,
    };
  }

  /** Builds the procedural body: the one the first frame always shows. */
  private buildBody(asset: ResolvedAsset): THREE.Group | undefined {
    const builder = asset.builder === undefined ? undefined : BUILDERS[asset.builder];
    if (!builder) return undefined;
    const body = builder(
      asset,
      makeBuildKit(this.geometries, this.finishes, asset.finishes, (dispose) => this.disposables.push(dispose)),
    );
    body.name = `${asset.variantId}-procedural`;
    // Builders author the front at +Z because the maths reads better that way;
    // the scene contract is "front faces -Z at rotationY = 0", so the body is
    // turned once here. `asset.yaw` adds the legacy per-type compensation.
    body.rotation.y = Math.PI;
    return body;
  }

  private applyTransform(group: THREE.Group, placement: DemoAsset, asset: ResolvedAsset): void {
    group.position.set(placement.position.x, asset.mountY, placement.position.z);
    const effective = effectiveAsset(placement);
    group.rotation.y = effective.rotationY + asset.yaw;
    group.scale.setScalar(effective.scale);
  }

  /**
   * Selection contract: `userData.assetId` stays the placement id. Catalogue
   * metadata rides alongside it so a picker can say what a variant is without
   * another lookup.
   */
  private tagUserData(group: THREE.Group, placement: DemoAsset, asset: ResolvedAsset): void {
    group.userData['assetId'] = placement.id;
    group.userData['assetRef'] = asset.ref;
    group.userData['archetypeId'] = asset.archetypeId;
    group.userData['variantId'] = asset.variantId;
    group.userData['variantName'] = asset.variantName;
    group.userData['variantVersion'] = asset.version;
    group.userData['category'] = asset.category;
    group.userData['dims'] = asset.dims;
    group.userData['anchor'] = asset.anchor;
    group.userData['clearance'] = asset.clearance;
    if (asset.mirrorFacts) group.userData[MIRROR_FACTS_USERDATA_KEY] = { ...asset.mirrorFacts };
    // What the move tool judges a baked library's object by: the shipped bank does not know it.
    if (asset.surfaceFacts && Object.keys(asset.surfaceFacts).length > 0) group.userData['surfaceFacts'] = asset.surfaceFacts;
    group.userData['pricing'] = asset.pricing.model;
    // Every body starts procedural, including one built to replace a failed
    // GLB: the state describes what is on screen NOW, and a fresh build has
    // not been offered a model yet (`SceneBuilder.upgradeModels`).
    group.userData['modelState'] = 'procedural' satisfies ModelState;
    if (placement.room) group.userData['roomId'] = placement.room;
    if (placement.collision) group.userData['collision'] = { hx: placement.collision.hx, hz: placement.collision.hz };
    else if (asset.anchor === 'floor') group.userData['collision'] = { hx: asset.dims[0] / 2, hz: asset.dims[2] / 2 };
  }

  private applyShadows(group: THREE.Group): void {
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      // Rugs and mats opt out in the builder; everything else casts and receives.
      if (child.castShadow) child.castShadow = true;
      child.receiveShadow = true;
    });
  }

  /**
   * Neutral stand-in for a placement that resolved to nothing.
   *
   * Its material is handed to the finish registry so a scene full of unknown
   * assets cannot leak one material per failure: the loader's `dispose` frees
   * it with everything else.
   */
  private placeholder(placement: DemoAsset, reason: string, dims?: ResolvedAsset['dims']): THREE.Group {
    const group = new THREE.Group();
    group.name = `${placement.id}-placeholder`;
    const [width, height, depth] = dims ?? [UNKNOWN_DIMS_M, UNKNOWN_DIMS_M, UNKNOWN_DIMS_M];
    const mesh = new THREE.Mesh(
      this.geometries.rounded(width, height, depth, PLACEHOLDER_RADIUS),
      this.finishes.own(new THREE.MeshStandardMaterial({ color: DEGRADED_COLOUR, roughness: 0.85, wireframe: true })),
    );
    mesh.position.y = height / 2;
    group.add(mesh);
    group.userData['assetId'] = placement.id;
    group.userData['degraded'] = reason;
    return group;
  }

  /**
   * The body a project object shows until its GLB arrives: a translucent box
   * of the catalogue's own `dims`, standing on the floor.
   *
   * Its material is `own`ed by the finish registry, like the placeholder's, so
   * a hundred pending objects cost one material rather than a hundred - and
   * `dispose()` frees it with everything else.
   */
  private pendingBody(asset: ResolvedAsset): THREE.Group {
    const body = new THREE.Group();
    body.name = `${asset.variantId}-pending`;
    const [width, height, depth] = asset.dims;
    const mesh = new THREE.Mesh(
      this.geometries.rounded(width, height, depth, PLACEHOLDER_RADIUS),
      this.finishes.own(
        new THREE.MeshStandardMaterial({ color: PENDING_COLOUR, roughness: 0.9, transparent: true, opacity: PENDING_OPACITY }),
      ),
    );
    mesh.position.y = height / 2;
    // A translucent stand-in that casts a hard shadow looks like a solid
    // object that failed to load; it still receives, so the floor under it is
    // lit the same either way.
    mesh.castShadow = false;
    body.add(mesh);
    return body;
  }

  /** Triangle count of a built object - used by tests to police the per-object budget. */
  triangles(object: THREE.Object3D): number {
    return countTriangles(object);
  }

  /** Number of distinct geometries cached so far - a sharing check for tests. */
  geometryCount(): number {
    return this.geometries.size();
  }

  dispose(): void {
    for (const dispose of this.disposables) dispose();
    this.disposables.length = 0;
    this.geometries.dispose();
    this.finishes.dispose();
    // Only the source this loader made: an injected one belongs to its maker.
    this.ownedSource?.dispose();
    this.ownedSource = undefined;
  }
}
