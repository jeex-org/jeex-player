/**
 * Bakes the room grids over several frames, a fixed number of probes per
 * frame, while the screen keeps the direct look.
 *
 * The grids are never in the scene: what lights the scene is the packed
 * atlas each grid is copied into (`baked`, once a pass has finished it),
 * switched by `lit`. Pass 0 bakes every grid with the grids off: direct
 * light only. Pass 1 bakes every grid again with the grids on, so a probe
 * sees its neighbours' direct light through the doorways (one bounce) and
 * facades through the windows lit as on screen; grids finished earlier in
 * pass 1 are seen with their pass-1 light (the order is fixed, accepted).
 *
 * Invariants: each frame's slice runs in the rig's capture state with every
 * furniture renderable on no layer and the mirrors and transmissive meshes
 * outside the furniture hidden, and puts back the editing state, every layer
 * mask, every visibility and the grids' switch off in `finally`, also when a
 * call throws.
 *
 * Why layers for the furniture: three stops traversing at an invisible
 * object, so hiding a body would hide the lamp lights under it; a mesh that
 * fails the camera's layer test is not drawn, but its children (the lamp
 * lights) are still collected and light the shell the grid records.
 */

import type * as THREE from 'three';
import type { UniformState } from './box-probe-patch.js';

/** What the bake needs of a grid: three's `LightProbeGridWebGL` surface. */
export type BakeGrid = {
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
  /** Every room grid, in grid order. */
  grids: readonly BakeGrid[];
  /** The grids to bake, in grid order; every room grid when absent. */
  targets?: readonly BakeGrid[];
  /** The grids' switch: whether the packed atlas lights the scene. */
  lit: { visible: boolean };
  /** A pass has finished `grid`: its atlas goes into the packed atlas. */
  baked: (grid: BakeGrid) => void;
  rig: { setState(state: UniformState): void };
  /** What a probe must not see, hidden by visibility: the mirrors and the transmissive meshes outside the furniture. */
  exclusions: () => readonly { visible: boolean }[];
  /** What a probe must not see, taken off every layer: the furniture renderables, so the lamps under them stay in the scene. */
  layerExclusions?: () => readonly { layers: { mask: number } }[];
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
    const { lit, rig, exclusions } = this.deps;
    const hidden = exclusions().filter((object) => object.visible);
    const layered = (this.deps.layerExclusions?.() ?? []).map((object) => ({ object, mask: object.layers.mask }));
    const started = performance.now();
    rig.setState('capture');
    for (const object of hidden) object.visible = false;
    for (const { object } of layered) object.layers.mask = 0;
    try {
      let budget = this.deps.probesPerFrame;
      while (budget > 0 && !this.done) budget -= this.bakeRange(budget);
    } finally {
      lit.visible = false;
      for (const { object, mask } of layered) object.layers.mask = mask;
      for (const object of hidden) object.visible = true;
      rig.setState('editing');
      this.stats.frames += 1;
      this.stats.ms += performance.now() - started;
    }
    return this.done;
  }

  /** One bake call over up to `budget` probes of the current grid; answers how many it baked. */
  private bakeRange(budget: number): number {
    const { grids, lit, renderer, scene, cubemapSize } = this.deps;
    const targets = this.deps.targets ?? grids;
    const grid = targets[this.grid]!;
    const { x, y, z } = grid.resolution;
    const count = Math.min(budget, x * y * z - this.probe);
    lit.visible = this.pass > 0;
    grid.bake(renderer, scene, { start: this.probe, count, pass: this.pass, cubemapSize });
    this.stats.probes += count;
    this.probe += count;
    if (this.probe >= x * y * z) {
      this.deps.baked(grid);
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
