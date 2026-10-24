/**
 * The `capture` namespace of `ViewerHandle`: stills, panoramas and the «as is»
 * pair, each with the provenance sidecar the disclosure rules want.
 *
 * It lives here rather than in `viewer-app.ts` for the reason every command
 * bag does — the composition root's job is knowing which collaborator owns
 * what, not owning a fourth thing itself — and it reads the renderer, the
 * document and the live pose through GETTERS, because a Retry or a
 * `loadScene` replaces all three under it.
 *
 * Live-view invariant: nothing here touches the camera on screen or the size
 * of the canvas. A capture renders into a target of its own
 * (`render/still-capture.ts`) with a camera of its own, and the very next
 * frame of the live scene draws exactly as it would have.
 *
 * State invariant: `'default'` is not a second scene the host has to keep. It
 * is the committed document with the paint taken off
 * (`render/offscreen-scene.ts`), built OFFSCREEN into a scene of its own, lit
 * by an apartment rig of the runtime's own lighting context, captured, and
 * disposed in the same call — so a pair is one document photographed twice, which is exactly
 * what «the unaltered original beside the staged image» means for a viewer
 * that owns its geometry.
 */

import * as THREE from 'three';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { Dollhouse, type ShellState } from '../geometry/dollhouse.js';
import { SceneBuilder } from '../geometry/scene-builder.js';
import { SceneModel } from '../scene/scene-model.js';
import { roomCentre } from '../navigation/room-graph.js';
import { documentForState, type SceneState } from '../render/offscreen-scene.js';
import { capturePanorama } from '../render/panorama.js';
import { captureStill, type StillResult } from '../render/still-capture.js';
import { prepareSunShadow } from '../render/sun-shadow.js';
import { provenanceFor, stampCaption, type Provenance } from './provenance.js';
import { captureFrames, type FramesRequest, type FramesResult } from './video-frames.js';
import { ViewerLibError } from '../shared/errors.js';
import type { RenderRuntime } from '../render/render-runtime.js';
import type { TourPlayer } from '../camera/tour-player.js';
import { isUuidV7, type CameraPose, type SceneData, type Vec3 } from '../scene/types.js';
import type { Messages } from '../ui/messages.js';
import type { PostProcessor } from '../render/post-processor.js';
import type { ViewerOptions } from './viewer-options.js';

/** Eye height a room panorama is taken at, metres — the walk rig's own. */
const PANORAMA_EYE_M = 1.6;
/**
 * The width a 14 px caption is sized for. A still is captioned for the SIZE it
 * came out at: fourteen pixels of disclosure on a 4K export is a disclosure
 * nobody can read, and the rules are about what a viewer of the picture sees.
 */
const CAPTION_REFERENCE_PX = 1280;

/** Where a still's camera comes from; a room camera is named by the room's UUID. */
export type CaptureCamera = CameraPose | { roomId: string } | 'presentation' | 'live';

export type CaptureStillRequest = {
  width: number;
  height: number;
  /** Which document to render; default `'current'`. */
  state?: SceneState | undefined;
  /** Default `'presentation'` — the pose the scene itself names. */
  camera?: CaptureCamera | undefined;
  fov?: number | undefined;
  /** Overrides `options.capture.disclosure.caption` for this one artefact. */
  caption?: boolean | undefined;
};

export type CapturePanoramaRequest = {
  /** Width of the equirectangular image; the height is half of it. */
  width: number;
  /** The room's UUID; the panorama is taken at standing height in its centre. */
  roomId: string;
  state?: SceneState | undefined;
  caption?: boolean | undefined;
};

/** One artefact and the sidecar that says where it came from. */
export type CaptureResult = { blob: Blob; provenance: Provenance };

export type CaptureCommands = {
  still(request: CaptureStillRequest): Promise<CaptureResult>;
  panorama(request: CapturePanoramaRequest): Promise<CaptureResult>;
  /** Both states of the same shot, for the disclosure rules that want the unaltered original beside the staged image. */
  pair(request: Omit<CaptureStillRequest, 'state'>): Promise<{ current: CaptureResult; default: CaptureResult }>;
  /** Deterministic tour frames for a fast, script-assembled video (`video-frames.ts`). */
  frames(request: FramesRequest): Promise<FramesResult>;
};

/**
 * What the commands need from the application. Every entry is a getter for the
 * same reason `debug-parts.ts`'s are: the stage and the document are replaced
 * by a Retry or a `loadScene`, and a value captured at construction would
 * answer for the viewer that used to be there.
 */
export type CaptureDeps = {
  runtime: () => RenderRuntime | undefined;
  model: () => SceneModel | undefined;
  /** The pose the live camera holds now, or `null` before the camera stack exists. */
  livePose: () => CameraPose | null;
  options: () => ViewerOptions;
  messages: () => Messages;
  /**
   * What the shell on screen is doing — the dollhouse cutaway, or the whole
   * flat with its ceilings. The offscreen «as is» build is put into the same
   * state, or the pair would differ in more than the finishes it exists to
   * compare.
   */
  shellState: () => ShellState;
  /** Whether the first scene is on screen; a capture before that is refused. */
  ready: () => boolean;
  /**
   * The autotour clip, for `frames`. Optional: `still`/`panorama`/`pair` never
   * read it, and a mount built for those alone (tests included) need not
   * supply one.
   */
  tour?: (() => TourPlayer | undefined) | undefined;
  /**
   * The live walk and tour chain a still or a video frame renders through,
   * waiting for it to load; `null` outside walk and tour or when it cannot be
   * had, and the capture takes the direct path (`app/walk-post-controller.ts`).
   * Optional: a mount built without one captures directly. Panoramas never
   * ask for it.
   */
  postChain?: (() => Promise<PostProcessor | null>) | undefined;
  /** Puts the current colour temperature on the artificial lights of the offscreen «as is» build. */
  artificialLights?: ((root: THREE.Object3D) => void) | undefined;
};

/** What `stageCaptureDeps` reads of the stage (`viewer-stage.ts`), named structurally: the stage reaches this module through its own imports. */
type CaptureStage = {
  readonly runtime: RenderRuntime;
  readonly director:
    | { readonly controller: { getPose(): { position: THREE.Vector3; target: THREE.Vector3 } }; readonly tour: TourPlayer }
    | undefined;
  captureChain(): Promise<PostProcessor | null>;
};

/**
 * The deps the stage answers: its renderer, the live camera pose, the tour and
 * the walk chain. Read through `stage` at every call, because a Retry
 * replaces the stage under the commands.
 */
export function stageCaptureDeps(stage: () => CaptureStage | undefined): Pick<CaptureDeps, 'runtime' | 'livePose' | 'tour' | 'postChain'> {
  return {
    runtime: () => stage()?.runtime,
    livePose: () => poseOf(stage()?.director?.controller.getPose()),
    tour: () => stage()?.director?.tour,
    postChain: () => stage()?.captureChain() ?? Promise.resolve(null),
  };
}

/** The three-command surface `ViewerHandle.capture` is. */
export function captureCommands(deps: CaptureDeps): CaptureCommands {
  /** The runtime and the document, or a coded refusal: a capture needs both. */
  function engaged(): { runtime: RenderRuntime; model: SceneModel } {
    const runtime = deps.runtime();
    const model = deps.model();
    if (!deps.ready() || runtime === undefined || model === undefined) {
      throw new ViewerLibError('not-ready', 'capture: the first scene is not on screen yet');
    }
    return { runtime, model };
  }

  /** The pose a request names, resolved against the document on screen. */
  function poseFor(scene: SceneData, camera: CaptureCamera | undefined): CameraPose {
    if (camera === undefined || camera === 'presentation') return scene.presentationCamera;
    if (camera === 'live') {
      const live = deps.livePose();
      if (live === null) throw new ViewerLibError('not-ready', 'capture: the live camera does not exist yet');
      return live;
    }
    if ('roomId' in camera) {
      const { roomId } = camera;
      requireRoomUuid(roomId);
      if (!Object.hasOwn(scene.roomCameras, roomId)) {
        throw new ViewerLibError('bad-params', `capture: the scene has no camera for room ${JSON.stringify(roomId)}`, {
          detail: { roomId },
        });
      }
      return scene.roomCameras[roomId]!;
    }
    return camera;
  }

  /**
   * Runs `take` against the scene graph for `state`.
   *
   * `'current'` hands over the LIVE scene, so a still of what is on screen is
   * the same picture with the same background, fog, environment and lights.
   * `'default'` builds the stripped document offscreen, lights it with an
   * apartment rig of the runtime's lighting context (the live scene's values
   * and shadow size), and disposes every mesh, material, light and shadow map
   * it made before it returns — `renderer.info.memory` is back where it
   * started.
   */
  async function inState<T>(
    state: SceneState,
    runtime: RenderRuntime,
    model: SceneModel,
    eye: Vec3,
    take: (root: THREE.Object3D) => Promise<T>,
  ): Promise<T> {
    if (state === 'current') return take(runtime.scene);
    // `toJSON()` first: the committed document is deep-frozen and shared, and
    // a second `SceneModel` must own what it validates.
    const offscreen = SceneModel.load(documentForState(model.toJSON(), 'default'), CATALOGUE_REGISTRIES);
    const builder = new SceneBuilder(offscreen.scene, offscreen.plan);
    const scene = new THREE.Scene();
    // Cached like the live rig: a panorama's six faces share one shadow map.
    const rig = runtime.lighting.createApartmentRig({ shadowMapSize: runtime.shadowMapSize, shadowCache: true });
    let sun: { dispose(): void } | null = null;
    try {
      scene.background = runtime.scene.background;
      scene.fog = runtime.scene.fog;
      rig.attach(scene);
      const built = builder.build();
      shellLike(deps.shellState(), offscreen, built.root, eye);
      scene.add(built.root);
      deps.artificialLights?.(built.root);
      // The same orientation, ceiling slabs and fitting policy as the live
      // view, over this build's own geometry.
      sun = prepareSunShadow(built.root, offscreen.scene, offscreen.plan, rig);
      return await take(scene);
    } finally {
      sun?.dispose();
      // The rig's sun allocates its shadow map on the first frame it is drawn
      // in; disposing the rig releases it with the lights.
      rig.dispose();
      scene.clear();
      builder.dispose();
    }
  }

  /** The caption a request gets, or `null` when it asked for none. */
  function captionFor(wanted: boolean | undefined): string | null {
    const disclosure = deps.options().capture.disclosure;
    if (!(wanted ?? disclosure.caption)) return null;
    return disclosure.text ?? deps.messages().t('capture.disclosure');
  }

  /** The artefact: the picture, captioned unless the host said not to, and its sidecar. */
  async function artefact(
    shot: StillResult,
    model: SceneModel,
    kind: Provenance['kind'],
    state: SceneState,
    caption: boolean | undefined,
    extra: Partial<Provenance>,
  ): Promise<CaptureResult> {
    const text = captionFor(caption);
    const blob = text === null ? shot.blob : await stampCaption(shot.blob, text, Math.max(1, shot.width / CAPTION_REFERENCE_PX));
    return { blob, provenance: provenanceFor(model.scene, model.rev, kind, state, extra) };
  }

  return {
    async still(request) {
      const { runtime, model } = engaged();
      const state = request.state ?? 'current';
      const pose = poseFor(model.scene, request.camera);
      const post = (await deps.postChain?.()) ?? null;
      const shot = await inState(state, runtime, model, pose.position, (root) =>
        captureStill(runtime.renderer, root, { width: request.width, height: request.height, pose, fov: request.fov, post }),
      );
      return artefact(shot, model, 'still', state, request.caption, { camera: pose });
    },

    async panorama(request) {
      const { runtime, model } = engaged();
      const state = request.state ?? 'current';
      const position = eyePoint(model, request.roomId);
      const shot = await inState(state, runtime, model, position, (root) =>
        capturePanorama(runtime.renderer, root, { width: request.width, position }),
      );
      return artefact(shot, model, 'panorama', state, request.caption, { roomId: request.roomId });
    },

    async pair(request) {
      return {
        current: await this.still({ ...request, state: 'current' }),
        default: await this.still({ ...request, state: 'default' }),
      };
    },

    async frames(request) {
      const { runtime, model } = engaged();
      const tour = deps.tour?.();
      if (tour === undefined) throw new ViewerLibError('not-ready', 'capture: the tour does not exist yet');
      const state = request.state ?? 'current';
      const eye = deps.livePose()?.position ?? model.scene.presentationCamera.position;
      const post = (await deps.postChain?.()) ?? null;
      return captureFrames(
        {
          runtime,
          model,
          tour,
          livePose: deps.livePose,
          withRoot: (take) => inState(state, runtime, model, eye, take),
          captionFor,
          post,
        },
        request,
      );
    },
  };
}

/**
 * Puts a freshly built offscreen root into the shell state the live view is in.
 *
 * The live root has a `Dollhouse` over it (hidden ceilings, and the exterior
 * walls between the camera and the interior taken away); a second build has
 * nothing, so an «as is» still of the same pose would show the whole closed
 * box beside a cutaway. One throw-away `Dollhouse` guards against that: it takes its
 * exterior set from the root it was handed rather than from a `Picker`, which
 * is a mount-lifetime object this call has no business creating.
 */
function shellLike(state: ShellState, model: SceneModel, root: THREE.Object3D, eye: Vec3): void {
  const exteriors: THREE.Object3D[] = [];
  const dollhouse = new Dollhouse(() => exteriors);
  dollhouse.prepare(model.plan, root);
  root.traverse((object) => {
    const wallIds = object.userData['wallIds'];
    if (Array.isArray(wallIds)) {
      if (wallIds.some((wallId) => typeof wallId === 'string' && dollhouse.isExterior(wallId))) exteriors.push(object);
      return;
    }
    const wallId = object.userData['wallId'];
    if (typeof wallId === 'string' && dollhouse.isExterior(wallId)) exteriors.push(object);
  });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(eye.x, eye.y, eye.z);
  dollhouse.setState(state, camera);
}

/**
 * The camera stack's pose as the schema spells one.
 *
 * `CameraController.getPose()` answers `THREE.Vector3`s, and `CameraPose` is
 * the document's plain `Vec3` pair — the composition root hands the live pose
 * in through this rather than teaching `capture-commands.ts` about the camera
 * layer, which `render` and `app` both keep at arm's length.
 */
export function poseOf(pose: { position: THREE.Vector3; target: THREE.Vector3 } | undefined): CameraPose | null {
  if (pose === undefined) return null;
  return {
    position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
    target: { x: pose.target.x, y: pose.target.y, z: pose.target.z },
  };
}

/**
 * A room is named by its UUID: anything else is refused as `bad-params` before
 * the document is asked, the same refusal an unknown room gets.
 */
function requireRoomUuid(roomId: string): void {
  if (!isUuidV7(roomId)) {
    throw new ViewerLibError('bad-params', `capture: room id ${JSON.stringify(roomId)} is not a UUID v7`, { detail: { roomId } });
  }
}

/** Standing height at the centre of a room: where a 360 of it is taken from. */
function eyePoint(model: SceneModel, roomId: string): Vec3 {
  requireRoomUuid(roomId);
  if (!model.scene.rooms.some((room) => room.id === roomId)) {
    throw new ViewerLibError('bad-params', `capture: the scene has no room ${JSON.stringify(roomId)}`, { detail: { roomId } });
  }
  const centre = roomCentre(model.plan, model.scene, roomId, []);
  return { x: centre.x, y: PANORAMA_EYE_M, z: centre.z };
}
