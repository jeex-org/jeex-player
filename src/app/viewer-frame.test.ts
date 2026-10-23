/**
 * The frame hooks' answer to drawing on demand: what they see change on a tick
 * (a shell switch or cutaway, a door or furniture frame up to the last one,
 * the selection tint and aura) asks walk and tour to draw that tick
 * (`render/render-demand.ts`); a tick where nothing changed asks nothing.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { frameHooksFor } from './viewer-frame.js';

function rig() {
  const state = { shell: false, ring: false, doors: false, furniture: [] as THREE.Group[], glow: false, tint: false };
  let invalidations = 0;
  const stage = {
    camera: new THREE.PerspectiveCamera(),
    runtime: { demand: { invalidate: () => (invalidations += 1) } },
    syncMinimap: () => undefined,
    selection: { update: () => state.tint },
    director: { controller: { floorRing: { takeChanged: () => state.ring } } },
  };
  const hooks = frameHooksFor({
    stage: () => stage as never,
    dollhouse: { update: () => undefined, takeChanged: () => state.shell } as never,
    animator: { update: () => undefined, takeMoved: () => state.furniture, busy: false } as never,
    doors: { update: () => undefined, takeMoved: () => state.doors } as never,
    mount: { flushSunRefit: () => undefined, sunShadow: undefined, editor: { updateGlows: () => state.glow } } as never,
    anchor: { hasTarget: () => false } as never,
  });
  /** Runs one tick of every hook and answers how many redraws it asked for. */
  const tick = (): number => {
    const before = invalidations;
    for (const hook of hooks) hook(0.016, 1000);
    return invalidations - before;
  };
  return { state, tick };
}

describe('frame hooks ask walk and tour to redraw what they saw change', () => {
  test('a quiet tick asks nothing', () => {
    expect(rig().tick()).toBe(0);
  });

  test('each source alone asks on its tick', () => {
    const sources: Array<(state: ReturnType<typeof rig>['state']) => void> = [
      (state) => (state.shell = true),
      (state) => (state.ring = true),
      (state) => (state.doors = true),
      (state) => (state.furniture = [new THREE.Group()]),
      (state) => (state.glow = true),
      (state) => (state.tint = true),
    ];
    for (const set of sources) {
      const subject = rig();
      set(subject.state);
      expect(subject.tick()).toBeGreaterThan(0);
    }
  });
});
