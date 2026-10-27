/**
 * The asset move tool's switch and its view of the running viewer:
 * `handle.setAssetMoveTool(true)` loads the tool
 * as a LAZY chunk on first arming and binds it; until then nothing of it is in
 * the boot bundle and a published tour never pays for it. `viewer-app.ts` is
 * at its size limit, so the wiring lives here and `handle-commands.ts` owns
 * the one instance.
 *
 * What the tool reads, all of it late-bound: the mode (it works in `orbit`
 * and `plan3d` only), the host's selection, the picker and the camera a ray is
 * cast through, the committed document, and the body of the object in the
 * built scene graph it moves on screen. What it raises: `assetEdit` and
 * `assetEditRefused` on the public fan-out, `assetMoveState` on each edge of a
 * drag or a key burst, and the `hint.assetMove` hint.
 */

import * as THREE from 'three';
import { isTypingTarget } from '../camera/camera-input.js';
import { AUTHORING_MODES } from '../camera/checkpoint-overlay.js';
import { effectiveAsset, type DemoAsset, type Mirror } from '../scene/types.js';
import { mirrorFactsOf, setBodyMirror } from '../geometry/asset-mirror.js';
import type { BodyFacts } from '../edit/asset-move-catalogue.js';
import type { SurfaceFacts } from '../assets/asset-types.js';
import type { AssetMoveControl, AssetMoveSession } from '../edit/asset-move-session.js';
import type { DragPose } from '../layout/asset-legality.js';
import type { AssetMoveStateEvent, ViewerEvents } from './viewer-events.js';
import type { ViewerStage } from './viewer-stage.js';
import type { SceneMount } from './scene-mount.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { ViewerRoots } from '../ui/viewer-shell.js';
import { defaultLogger } from '../shared/logger.js';

/** The object tints while it drags: the camera tool's ghost colours. */
export const MOVE_OK_TINT = 0x3fbf6f;
export const MOVE_BAD_TINT = 0xd9534f;
const TINTS = { ok: MOVE_OK_TINT, bad: MOVE_BAD_TINT } as const;

export type AssetMoveWiringDeps = {
  stage: () => ViewerStage | undefined;
  mount: () => SceneMount;
  events: ViewerEvents;
  ui: ViewerUI;
  roots: ViewerRoots;
  signal: AbortSignal;
};

/** A body found in the built graph, with the yaw its builder added on top of the placement's. */
type Body = { group: THREE.Object3D; yawOffset: number };

export function assetMoveWiring(deps: AssetMoveWiringDeps): AssetMoveControl {
  let enabled = false;
  let session: AssetMoveSession | null = null;
  let loading: Promise<void> | null = null;
  let armPending = false;
  const bodies = new Map<string, Body>();
  let bodiesRoot: THREE.Object3D | undefined;

  const placementOf = (assetId: string): DemoAsset | undefined => deps.mount().model?.scene.assets.find((asset) => asset.id === assetId);

  /** The placement's body in the built graph, cached until the graph changes under it. */
  const bodyOf = (assetId: string): Body | null => {
    const root = deps.mount().sceneRoot;
    if (!root) return null;
    if (root !== bodiesRoot) {
      bodies.clear();
      bodiesRoot = root;
    }
    const cached = bodies.get(assetId);
    if (cached && cached.group.parent !== null) return cached;
    let found: THREE.Object3D | null = null;
    root.traverse((object) => {
      if (found === null && object.userData['assetId'] === assetId && object.userData['archetypeId'] !== undefined) found = object;
    });
    const placement = placementOf(assetId);
    if (found === null || !placement) return null;
    const group: THREE.Object3D = found;
    const body = { group, yawOffset: group.rotation.y - effectiveAsset(placement).rotationY };
    bodies.set(assetId, body);
    return body;
  };

  /** What the built body says of its archetype (`asset-loader.ts` tags the resolved dims and anchor). */
  const bodyFacts = (assetId: string): BodyFacts | null => {
    const body = bodyOf(assetId);
    const data = body?.group.userData;
    if (!body || !data || !Array.isArray(data['dims'])) return null;
    return {
      archetype: String(data['archetypeId']),
      anchor: (data['anchor'] as BodyFacts['anchor'] | undefined) ?? 'floor',
      dims: data['dims'] as [number, number, number],
      clearance: typeof data['clearance'] === 'number' ? data['clearance'] : 0,
      yaw: body.yawOffset,
      mirror: mirrorFactsOf(body.group),
      // Tagged by `asset-loader.ts` from the resolved archetype (a baked library's own facts included).
      surfaces:
        typeof data['surfaceFacts'] === 'object' && data['surfaceFacts'] !== null ? (data['surfaceFacts'] as SurfaceFacts) : undefined,
    };
  };

  const show = (assetId: string, pose: DragPose, mirror?: Mirror): void => {
    const body = bodyOf(assetId);
    const scene = deps.mount().model?.scene;
    if (!body || !scene) return;
    const anchor = body.group.userData['anchor'];
    const y = anchor === 'ceiling' && pose.position.y <= 0 ? scene.ceilingHeight : pose.position.y;
    body.group.position.set(pose.position.x, y, pose.position.z);
    body.group.rotation.y = pose.rotationY + body.yawOffset;
    if (mirror) setBodyMirror(body.group, mirror);
    body.group.updateMatrixWorld(true);
    // The dragged body casts: redraw, growing the sun's frustum past the fit if it must.
    deps.mount().sunShadow?.include(body.group, 'preview');
  };

  const viewYaw = (): number => {
    const stage = deps.stage();
    const camera = stage?.planModes.activeCamera() ?? stage?.camera;
    if (!camera) return 0;
    const ahead = camera.getWorldDirection(new THREE.Vector3());
    // Looking straight down (the plan's top view), «up» on screen is the camera's own up.
    if (Math.abs(ahead.y) > 0.95) ahead.copy(camera.up).applyQuaternion(camera.quaternion);
    return Math.atan2(ahead.x, ahead.z);
  };

  const load = (): Promise<void> => {
    loading ??= import('../edit/asset-move-session.js')
      .then((module) => {
        const stage = deps.stage();
        if (!stage || deps.signal.aborted) return;
        session = module.startAssetMove(
          {
            active: () => {
              const mode = deps.stage()?.mode;
              return enabled && mode !== undefined && AUTHORING_MODES.has(mode);
            },
            selected: () => {
              const target = deps.stage()?.selection.current().highlight;
              return target?.kind === 'furniture' ? target.id : null;
            },
            pickAsset: (clientX, clientY) => {
              const current = deps.stage();
              if (!current) return null;
              const hit = current.picker.pickSelection(clientX, clientY, current.pickCamera());
              return hit?.pick.surface === 'furniture' ? (hit.pick.assetId ?? null) : null;
            },
            ray: (clientX, clientY) => {
              const current = deps.stage();
              return current ? current.picker.pointerRay(clientX, clientY, current.pickCamera()).clone() : null;
            },
            document: () => {
              const model = deps.mount().model;
              return model ? { scene: model.scene, plan: model.plan, rev: model.rev } : null;
            },
            bodyFacts,
            layoutCatalogue: () => deps.mount().layoutCatalogue(),
            show,
            // The editing modes draw on demand: a preview pose or a field is a new picture.
            redraw: () => deps.stage()?.runtime.demand.invalidate(),
            tint: (state) => deps.stage()?.selection.tint(state === null ? null : TINTS[state]),
            viewYaw,
            handles: {
              addFrameHook: (hook) => deps.stage()?.runtime.addFrameHook(hook),
              removeFrameHook: (hook) => deps.stage()?.runtime.removeFrameHook(hook),
              project: (point) => {
                const current = deps.stage();
                if (!current) return null;
                const ndc = new THREE.Vector3(point.x, point.y, point.z).project(current.pickCamera());
                if (ndc.z > 1) return null;
                const rect = deps.roots.canvas.getBoundingClientRect();
                return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
              },
              screenUp: () => {
                const yaw = viewYaw();
                return { x: Math.sin(yaw), z: Math.cos(yaw) };
              },
              mode: () => {
                const mode = deps.stage()?.mode;
                return mode === 'orbit' || mode === 'plan3d' ? mode : null;
              },
            },
            onEdit: (edit) => deps.events.emit('assetEdit', edit),
            onRefused: (refusal) => deps.events.emit('assetEditRefused', refusal),
            onMoving: (moving) => {
              // A drag or a key burst ended (committed, cancelled or reverted): fit the apartment again.
              if (!moving) deps.mount().sunShadow?.endPreview();
              const current = deps.stage();
              if (moving) current?.director?.hint('hint.assetMove');
              else if (current?.mode) deps.ui.setHintForMode(current.mode);
              let phase: AssetMoveStateEvent['phase'] = 'idle';
              if (moving) phase = session?.tool.state().phase === 'nudging' ? 'nudging' : 'dragging';
              deps.events.emit('assetMoveState', { phase });
            },
          },
          {
            container: deps.roots.canvas.parentElement ?? deps.roots.viewport,
            canvas: deps.roots.canvas,
            keys: deps.roots.root,
            typing: (event) => isTypingTarget(typeof event.composedPath === 'function' ? event.composedPath() : []),
            signal: deps.signal,
          },
          stage.runtime.scene,
        );
        if (armPending) session.tool.arm();
        armPending = false;
      })
      .catch((cause: unknown) => {
        // A chunk that did not load (a dropped connection, a redeploy) is tried
        // again on the next arming instead of leaving the switch dead.
        loading = null;
        defaultLogger.warn('asset-move-chunk', 'the asset move tool did not load; arm it again to retry', cause);
      });
    return loading;
  };

  // A new document answers a pending edit and voids a running move; the graph it built is new too.
  const offScene = deps.events.on('scene', () => {
    bodies.clear();
    session?.tool.documentChanged();
  });

  return {
    setEnabled(next) {
      enabled = next;
      if (next) {
        void load();
        return;
      }
      // Disarming also drops a «Move» toggle that was never used: re-arming
      // later must not teleport the object on the first press.
      armPending = false;
      session?.tool.disarm();
      session?.tool.cancel();
    },
    arm() {
      if (session) session.tool.arm();
      else armPending = true;
    },
    revert() {
      session?.tool.revert();
      // The body is back at its start pose: fit the apartment again and redraw it there.
      deps.mount().sunShadow?.endPreview();
    },
    mirror: (assetId, axis) => session?.tool.mirror(assetId, axis) ?? false,
    turnAsset: (assetId, steps) => session?.tool.turnAsset(assetId, steps) ?? false,
    loaded: () => loading ?? Promise.resolve(),
    debug: () => ({ enabled, loaded: session !== null, state: session?.tool.state() ?? null }),
    dispose() {
      offScene();
      session?.dispose();
      session = null;
    },
  };
}
