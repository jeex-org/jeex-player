/**
 * The eager half of the authoring boundary. Everything a published tour never
 * arms (the tour-camera overlay with its preview card and look-through, the
 * asset move tool and the plan tool) lives in ONE lazily loaded chunk (`authoring.ts`);
 * this port is what the boot bundle keeps of it.
 *
 * It owns the switches and remembers them before a stage or the chunk exists;
 * the first switch turned on starts the one load, and the loaded module is
 * bound to the current stage as soon as both are there (`ready()`, which the
 * boot awaits before the first document is mounted, so the first `scene`
 * event finds the tools bound). Every command is forwarded to the bound
 * tools; until then a command that answers a boolean answers `false`, a void
 * one does nothing, `lookThroughId()` is `null` and `placing()` is `false`.
 *
 * A «Move» armed before the tools are bound is remembered like a switch and
 * armed once they are; switching the asset tool off forgets it.
 *
 * Invariants: at most one load is in flight; a failed load is logged and
 * retried on the next switch turned on, never before; tools that throw while
 * they are built or bound are reported as an internal error (`report`) and
 * promise no retry; the tools are bound to one stage at a time and disposed
 * before another stage gets its own; a port disposed while its load is in
 * flight binds nothing when it resolves.
 */

import type * as THREE from 'three';
import type { MirrorAxis, ViewerMode } from '../scene/types.js';
import type { Messages } from '../ui/messages.js';
import type { AssetMoveDebug } from '../edit/asset-edit.js';
import type { Logger } from '../shared/logger.js';

/** What `__viewerDebug` reads of the tools (`debug-parts.ts`). */
export type AuthoringDebug = {
  readonly checkpointOverlay: THREE.Group | undefined;
  readonly assetMove: AssetMoveDebug | null;
};

/** The tools of one stage, as the lazy chunk builds them (`authoring.ts`). */
export type Authoring = {
  setCheckpointOverlay(visible: boolean): void;
  setAssetMoveTool(enabled: boolean): void;
  setPlanTool(enabled: boolean): void;
  revertPlanEdit(): void;
  addCheckpoint(id: string): boolean;
  startCheckpointPlacement(id: string): boolean;
  cancelCheckpointPlacement(): void;
  setCheckpointFromView(id: string): boolean;
  frameCheckpoint(id: string): boolean;
  lookThroughCheckpoint(id: string): boolean;
  endLookThrough(commit: boolean): boolean;
  focusCheckpoint(id: string | null): boolean;
  revertCheckpointEdit(): void;
  armAssetMove(): void;
  revertAssetEdit(): void;
  mirrorAsset(assetId: string, axis: MirrorAxis): boolean;
  turnAsset(assetId: string, steps: number): boolean;
  /** The mode on screen changed: a running look-through ends unkept and the overlay follows. */
  modeChanged(mode: ViewerMode): void;
  retranslate(messages: Messages): void;
  /** The camera being looked through, or `null`. */
  lookThroughId(): string | null;
  /** Whether click-to-place is running. */
  placing(): boolean;
  debug(): AuthoringDebug;
  /** Removes every tool from the stage and the DOM. */
  dispose(): void;
};

export type AuthoringPortDeps<S, M> = {
  /** The stage the tools are built on; `undefined` before the first document and between boots. */
  stage: () => S | undefined;
  /** The chunk: `import('./authoring.js')` in the viewer, a stand-in in tests. */
  load: () => Promise<M>;
  /** Builds the tools of `stage` from the loaded chunk. */
  start: (module: M, stage: S) => Authoring;
  log: Logger;
  /** An error thrown while the tools were built or bound: the viewer's internal error. */
  report: (error: unknown) => void;
};

/** The port's own surface: the switches, the binding and the forwarded commands. */
export type AuthoringPort = Omit<Authoring, 'debug' | 'dispose'> & {
  /** The overlay switch as the host left it. */
  checkpointOverlay(): boolean;
  /** Resolves once a load in flight settled and the tools are bound to the current stage (at once when nothing loads). */
  ready(): Promise<void>;
  /** The stage is going: its tools are disposed; the next `ready()` binds the next stage. */
  unbind(): void;
  debug(): AuthoringDebug & { readonly loaded: boolean };
  dispose(): void;
};

export function authoringPort<S, M>(deps: AuthoringPortDeps<S, M>): AuthoringPort {
  const switches = { checkpointOverlay: false, assetMove: false, planTool: false };
  /** A «Move» armed while no tools were bound. */
  let armed = false;
  let module: M | null = null;
  let loading: Promise<void> | null = null;
  let bound: { stage: S; tools: Authoring } | null = null;
  /** The stage whose tools threw while they were built: reported once, not built again. */
  let broken: S | null = null;
  let disposed = false;

  const bind = (): void => {
    const stage = deps.stage();
    if (disposed || module === null || stage === undefined || bound?.stage === stage || broken === stage) return;
    unbind();
    try {
      const tools = deps.start(module, stage);
      bound = { stage, tools };
      tools.setCheckpointOverlay(switches.checkpointOverlay);
      tools.setAssetMoveTool(switches.assetMove);
      tools.setPlanTool(switches.planTool);
      if (armed && switches.assetMove) tools.armAssetMove();
      armed = false;
    } catch (error) {
      broken = stage;
      deps.report(error);
    }
  };

  const unbind = (): void => {
    bound?.tools.dispose();
    bound = null;
  };

  /** Starts the one load unless it is in or in flight. */
  const load = (): void => {
    if (module !== null || loading !== null || disposed) return;
    loading = deps.load().then(
      (loaded) => {
        module = loaded;
        bind();
      },
      (cause: unknown) => {
        // A chunk that did not load (a dropped connection, a redeploy) is
        // tried again on the next switch turned on instead of leaving it dead.
        loading = null;
        deps.log.warn('authoring-chunk', 'the authoring tools did not load; turn a tool on again to retry', cause);
      },
    );
  };

  /** One forward: the bound tools' answer, or `fallback` while none are bound. */
  const call = <T>(fallback: T, run: (tools: Authoring) => T): T => (bound ? run(bound.tools) : fallback);

  return {
    setCheckpointOverlay(visible) {
      switches.checkpointOverlay = visible;
      if (visible) load();
      bound?.tools.setCheckpointOverlay(visible);
    },
    setAssetMoveTool(enabled) {
      switches.assetMove = enabled;
      if (enabled) load();
      else armed = false;
      bound?.tools.setAssetMoveTool(enabled);
    },
    setPlanTool(enabled) {
      switches.planTool = enabled;
      if (enabled) load();
      bound?.tools.setPlanTool(enabled);
    },
    revertPlanEdit: () => call(undefined, (tools) => tools.revertPlanEdit()),
    checkpointOverlay: () => switches.checkpointOverlay,
    async ready() {
      if (loading !== null) await loading;
      bind();
    },
    unbind,
    dispose() {
      disposed = true;
      unbind();
    },
    addCheckpoint: (id) => call(false, (tools) => tools.addCheckpoint(id)),
    startCheckpointPlacement: (id) => call(false, (tools) => tools.startCheckpointPlacement(id)),
    cancelCheckpointPlacement: () => call(undefined, (tools) => tools.cancelCheckpointPlacement()),
    setCheckpointFromView: (id) => call(false, (tools) => tools.setCheckpointFromView(id)),
    frameCheckpoint: (id) => call(false, (tools) => tools.frameCheckpoint(id)),
    lookThroughCheckpoint: (id) => call(false, (tools) => tools.lookThroughCheckpoint(id)),
    endLookThrough: (commit) => call(false, (tools) => tools.endLookThrough(commit)),
    focusCheckpoint: (id) => call(false, (tools) => tools.focusCheckpoint(id)),
    revertCheckpointEdit: () => call(undefined, (tools) => tools.revertCheckpointEdit()),
    armAssetMove() {
      if (bound) bound.tools.armAssetMove();
      else armed = true;
    },
    revertAssetEdit: () => call(undefined, (tools) => tools.revertAssetEdit()),
    mirrorAsset: (assetId, axis) => call(false, (tools) => tools.mirrorAsset(assetId, axis)),
    turnAsset: (assetId, steps) => call(false, (tools) => tools.turnAsset(assetId, steps)),
    modeChanged: (mode) => call(undefined, (tools) => tools.modeChanged(mode)),
    retranslate: (messages) => call(undefined, (tools) => tools.retranslate(messages)),
    lookThroughId: () => call(null, (tools) => tools.lookThroughId()),
    placing: () => call(false, (tools) => tools.placing()),
    debug: () =>
      bound
        ? { loaded: true, ...bound.tools.debug() }
        : {
            loaded: false,
            checkpointOverlay: undefined,
            // While the chunk is on the way the asset tool reports its switch, not yet loaded.
            assetMove: switches.assetMove ? { enabled: true, loaded: false, state: null } : null,
          },
  };
}
