/**
 * When a light bake is applied to a mounted document and when it is dropped,
 * over `applyBakedShell` (`baked-shell.ts`): the lifecycle, not the checks.
 *
 * The rules:
 * 1. A mounted document is baked only once its scene has SETTLED (the
 *    caller's `settled`: the first model pass and every library map of the
 *    shell). A map that lands after the binding would reach the source
 *    material, not the bound clone, and a model body that arrives later
 *    brings lamps the bake never marked.
 * 2. The apply re-reads the live shell after the files have loaded and
 *    refuses when it changed under them; a drop while loading aborts it, and
 *    whatever it still brings back is disposed at once.
 * 3. The bake is disposed (unbound, shell geometry restored) BEFORE the
 *    shell is torn down or rebuilt: the caller calls `drop` first.
 * 4. A revision of the shell, a finish, an opening, the site or a baked lamp
 *    drops the bake before anything repaints, so the live shell the revision
 *    changes is the one drawn; while the bake's lamps are not known yet any
 *    furniture edit does. It is not applied again for that document, not
 *    even by the remount after a restored WebGL context; any other mount
 *    (another document, or the remount of a document nobody edited) tries
 *    again from scratch, so a restored context neither loses the bake nor
 *    binds it twice.
 * 5. A refusal is one warning on the log (`light-bake-refused`) and leaves
 *    live lighting; the bake is never half-applied.
 *
 * Internal: the source is what the caller names (today the page's debug
 * global); no public option reaches this module yet.
 */

import type * as THREE from 'three';
import type { FinishLookup } from '../geometry/builder-context.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import type { TouchedEntity } from '../scene/ops/context.js';
import type { SceneData } from '../scene/types.js';
import type { Logger } from '../shared/logger.js';
import type { BakedShellOptions, BakedShellOutcome } from './baked-shell.js';
import type { FetchBytes } from './lightmap-page.js';

/** Where a bake's files are. */
export type LightBakeSource = { readonly sidecarUrl: URL; readonly shellUrl: URL };

/** A mounted document the bake goes onto, and when it has settled. */
export type BakeTarget = {
  /** The document's identity across remounts (its `SceneModel`): an edit that dropped the bake rules it out for good. */
  readonly document: object;
  readonly scene: SceneData;
  readonly root: THREE.Object3D;
  readonly projectMaterials?: readonly ProjectMaterial[] | undefined;
  readonly findFinish?: FinishLookup | undefined;
  /** Resolves once nothing changes the shell's materials or the furniture's lamps any more. */
  readonly settled: Promise<unknown>;
};

/** What the bake is doing, for the debug surface. */
export type LightBakeState =
  | { readonly state: 'off' | 'waiting' | 'loading' }
  | { readonly state: 'applied'; readonly bakeId: string; readonly bound: number }
  | { readonly state: 'refused'; readonly reason?: string; readonly message: string }
  | { readonly state: 'dropped'; readonly bakeId?: string };

export type LightBakeWiringDeps = {
  /** The bake to apply, read at every mount; `null` is off. */
  readonly source: () => LightBakeSource | null;
  readonly log: Logger;
  /** The shell's look changed (a bake applied or dropped): shadows and the next frame follow. */
  readonly changed?: (() => void) | undefined;
  readonly fetchBytes?: FetchBytes | undefined;
  /** `applyBakedShell` unless a test replaces it; loaded on first use, so a viewer without a bake never downloads it. */
  readonly apply?: ((options: BakedShellOptions) => Promise<BakedShellOutcome>) | undefined;
};

export type LightBakeWiring = {
  /** A document was mounted onto `target`: drops any earlier bake, then tries this one. */
  mounted(target: BakeTarget): void;
  /** A revision of the mounted document: drops the bake when it touches what the bake lit. */
  revision(touched: readonly TouchedEntity[]): void;
  /** Disposes the bake, or aborts the attempt; idempotent. */
  drop(): void;
  state(): LightBakeState;
  /** Resolves when the current attempt has ended, either way. */
  idle(): Promise<void>;
};

/** The kinds a bake does not depend on: the camera, the routes and (unless a lamp of the bake) the furniture. */
const KEEPS_BAKE = new Set<TouchedEntity['kind']>(['camera', 'navigation', 'autotour', 'tourCheckpoints', 'asset']);

/** Whether `touched` changes what the shell's light depends on; `lamps` is `null` while the bake's lamps are unknown. */
function touchesBake(touched: readonly TouchedEntity[], lamps: ReadonlySet<string> | null): boolean {
  return touched.some((entity) => !KEEPS_BAKE.has(entity.kind) || (entity.kind === 'asset' && (lamps === null || lamps.has(entity.id))));
}

export function lightBakeWiring(deps: LightBakeWiringDeps): LightBakeWiring {
  const apply = deps.apply ?? (async (options: BakedShellOptions) => (await import('./baked-shell.js')).applyBakedShell(options));
  let state: LightBakeState = { state: 'off' };
  /** The attempt in flight, aborted by a drop. */
  let attempt: AbortController | null = null;
  let running: Promise<void> = Promise.resolve();
  /** The document on screen, and the documents an edit ruled out. */
  let current: object | null = null;
  const invalidated = new WeakSet<object>();
  let applied: { readonly dispose: () => void; readonly bakeId: string; readonly lamps: ReadonlySet<string> } | null = null;

  const drop = (): void => {
    const wasActive = attempt !== null || applied !== null;
    attempt?.abort();
    attempt = null;
    if (applied) {
      const { bakeId, dispose } = applied;
      applied = null;
      dispose();
      state = { state: 'dropped', bakeId };
      deps.changed?.();
      return;
    }
    if (wasActive) state = { state: 'dropped' };
  };

  const run = async (target: BakeTarget, source: LightBakeSource, signal: AbortSignal): Promise<void> => {
    await target.settled;
    if (signal.aborted) return;
    state = { state: 'loading' };
    let outcome: BakedShellOutcome;
    try {
      outcome = await apply({ ...source, ...target, fetchBytes: deps.fetchBytes, signal });
    } catch (error) {
      if (signal.aborted) return;
      attempt = null;
      const message = error instanceof Error ? error.message : String(error);
      deps.log.error('light-bake-failed', `light bake not applied: ${message}`, error);
      state = { state: 'refused', message };
      return;
    }
    if (signal.aborted) {
      if (outcome.applied) outcome.dispose();
      return;
    }
    attempt = null;
    if (!outcome.applied) {
      deps.log.warn('light-bake-refused', outcome.error.message, { reason: outcome.error.reason });
      state = { state: 'refused', reason: outcome.error.reason, message: outcome.error.message };
      return;
    }
    const { bake, bound } = outcome;
    applied = { dispose: () => outcome.dispose(), bakeId: bake.bakeId, lamps: new Set(bake.lamps.map((lamp) => lamp.id)) };
    state = { state: 'applied', bakeId: bake.bakeId, bound: bake.bindings.length - bound.transmissive.length };
    deps.changed?.();
  };

  return {
    mounted(target) {
      drop();
      current = target.document;
      const source = deps.source();
      if (source === null) {
        state = { state: 'off' };
        return;
      }
      if (invalidated.has(target.document)) {
        state = { state: 'dropped' };
        return;
      }
      const controller = new AbortController();
      attempt = controller;
      state = { state: 'waiting' };
      running = run(target, source, controller.signal).catch(() => undefined);
    },
    revision(touched) {
      if ((attempt === null && applied === null) || !touchesBake(touched, applied?.lamps ?? null)) return;
      if (current !== null) invalidated.add(current);
      drop();
    },
    drop,
    state: () => state,
    idle: () => running,
  };
}
