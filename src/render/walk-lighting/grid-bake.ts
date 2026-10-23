/**
 * Bakes the room grids over several frames, a fixed number of probes per
 * frame, while the screen keeps the direct look.
 *
 * The grids live in the scene, hidden: three pushes only visible grids, so a
 * hidden grid never lights the screen and its half-written atlas never shows.
 * Pass 0 bakes every grid with only the baking grid visible inside the call
 * (three shows it itself, with an empty atlas: direct light only). Pass 1
 * bakes every grid again with every room grid and the exterior grid visible
 * inside the call, so a probe sees its neighbours' direct light through the
 * doorways (one bounce) and facades through the windows lit as on screen;
 * grids baked earlier in pass 1 are seen with their pass-1 light (the order
 * is fixed, accepted).
 *
 * Invariants: each frame's slice runs in the rig's capture state with the
 * furniture, the mirrors and the transmissive meshes hidden, and puts back
 * the editing state, every visibility and every grid's `visible = false` in
 * `finally`, also when a call throws.
 */

import type * as THREE from 'three';
import type { UniformState } from './box-probe-patch.js';

/** What the bake needs of a grid: three's `LightProbeGridWebGL` surface. */
export type BakeGrid = {
  visible: boolean;
  readonly resolution: { readonly x: number; readonly y: number; readonly z: number };
  bake(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    options: { start: number; count: number; pass: number; cubemapSize: number },
  ): void;
};

export type GridBakeDeps = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** Every room grid, in grid order, in the scene and hidden. */
  grids: readonly BakeGrid[];
  /** The grids to bake, in grid order; every room grid when absent. */
  targets?: readonly BakeGrid[];
  /** The exterior grid, in the scene and hidden. */
  exterior: { visible: boolean };
  rig: { setState(state: UniformState): void };
  /** What a probe must not see: the furniture, the mirrors, the transmissive meshes. */
  exclusions: () => readonly { visible: boolean }[];
  probesPerFrame: number;
  cubemapSize: number;
};

const PASSES = 2;

export class GridBake {
  private readonly deps: GridBakeDeps;
  private pass = 0;
  private grid = 0;
  private probe = 0;
  /** Frames stepped and probes baked so far. */
  readonly stats = { frames: 0, probes: 0, ms: 0 };

  constructor(deps: GridBakeDeps) {
    this.deps = deps;
  }

  get done(): boolean {
    return this.pass >= PASSES || (this.deps.targets ?? this.deps.grids).length === 0;
  }

  /** Bakes this frame's slice; answers whether the bake is done. */
  step(): boolean {
    if (this.done) return true;
    const { grids, exterior, rig, exclusions } = this.deps;
    const hidden = exclusions().filter((object) => object.visible);
    const started = performance.now();
    rig.setState('capture');
    for (const object of hidden) object.visible = false;
    try {
      let budget = this.deps.probesPerFrame;
      while (budget > 0 && !this.done) budget -= this.bakeRange(budget);
    } finally {
      for (const grid of grids) grid.visible = false;
      exterior.visible = false;
      for (const object of hidden) object.visible = true;
      rig.setState('editing');
      this.stats.frames += 1;
      this.stats.ms += performance.now() - started;
    }
    return this.done;
  }

  /** One bake call over up to `budget` probes of the current grid; answers how many it baked. */
  private bakeRange(budget: number): number {
    const { grids, exterior, renderer, scene, cubemapSize } = this.deps;
    const targets = this.deps.targets ?? grids;
    const grid = targets[this.grid]!;
    const { x, y, z } = grid.resolution;
    const count = Math.min(budget, x * y * z - this.probe);
    const bounce = this.pass > 0;
    for (const other of grids) other.visible = bounce;
    exterior.visible = bounce;
    grid.bake(renderer, scene, { start: this.probe, count, pass: this.pass, cubemapSize });
    this.stats.probes += count;
    this.probe += count;
    if (this.probe >= x * y * z) {
      this.probe = 0;
      this.grid += 1;
      if (this.grid >= targets.length) {
        this.grid = 0;
        this.pass += 1;
      }
    }
    return Math.max(1, count);
  }
}
