/**
 * The room lighting of walk and tour on one renderer and one scene: the room
 * grids and the exterior grid, their bake, the room probes and their atlas,
 * the shader patch's uniforms and the walk rig, driven one frame at a time by
 * `app/walk-lighting-controller.ts`.
 *
 * Phases: `baking` (grids, a fixed number of probes per frame), `probes` (one
 * room per frame), `live`. Until `live` the screen keeps the direct look: the
 * grids stay hidden and the rig sits in the editing state between slices.
 * The frame the last probe is captured in is the swap frame: every grid is
 * shown and the rig goes to the walk state in that frame, and since the probe
 * captures already drew every object with every grid visible, the swap
 * compiles nothing.
 *
 * Outside walk and tour (`frame(false)`) the grids are hidden and the rig is
 * in the editing state, which is exactly the editing look; the bake keeps its
 * progress and a baked apartment is shown again on the next entry.
 *
 * Refresh: an edit re-bakes only the named rooms' grids and re-captures only
 * the named rooms' probes, synchronously within one frame, so a half-written
 * grid is never on screen; anything wider starts the bake over.
 */

import * as THREE from 'three';
import type { SceneData } from '../../scene/types.js';
import type { SolvedPlan } from '../../plan/plan-solver.js';
import { doorSwings } from '../../plan/door-swing.js';
import { openingFrameWidth } from '../../assets/opening-frame.js';
import { FURNITURE_GROUP_NAME } from '../../geometry/scene-builder.js';
import { LIGHTING_STANDARD } from '../../lighting/lighting-standard.js';
import { roomVolumes, type Rect, type RoomVolumes, type VolumeInput } from './room-volumes.js';
import { createExteriorGrid, RoomGrid } from './room-grid.js';
import { GridBake } from './grid-bake.js';
import { ProbeAtlas, RoomProbes } from './room-probes.js';
import { atlasLayout, createWalkUniforms, installWalkPatch, setRoomBoxes, type WalkUniforms } from './box-probe-patch.js';
import { WalkRig } from './walk-rig.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';
import type { LightProbeGridWebGL } from 'three/addons/lighting/LightProbeGridWebGL.js';

/** The document the lighting is built for. */
export type WalkDocument = { plan: SolvedPlan; scene: SceneData; root: THREE.Object3D };
/** What an edit asks to refresh: everything, or the grids and probes of some rooms. */
export type RefreshScope = { all: boolean; grids: readonly string[]; probes: readonly string[] };
export type WalkLightingPhase = 'baking' | 'probes' | 'live';

/** Measured cost of the last full bake, and the GPU memory the lighting holds. */
export type WalkLightingStats = {
  boxes: number;
  gridProbes: number;
  bakeFrames: number;
  bakeMs: number;
  probeFrames: number;
  probeMs: number;
  memoryBytes: number;
};

type Mirror = THREE.Object3D & { isReflector?: boolean };

/** The furniture group, every mirror and every transmissive mesh under `scene`: what a grid probe must not see. */
function bakeExclusions(scene: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object.name === FURNITURE_GROUP_NAME || (object as Mirror).isReflector === true) {
      out.push(object);
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((material) => ((material as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0)) out.push(object);
  });
  return out;
}

function mirrorsOf(scene: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if ((object as Mirror).isReflector === true) out.push(object);
  });
  return out;
}

/** The plan, the doors and the furniture footprints as the volumes read them. */
function volumeInput(doc: WalkDocument): VolumeInput {
  const thickness = new Map(doc.plan.centrelines.map((line) => [line.wallId, line.thickness]));
  const rooms = doc.plan.rooms.map((room) => ({
    roomId: room.roomId,
    polygon: room.polygon,
    halfWall: Math.max(0, ...room.loop.map((face) => (thickness.get(face.wallId) ?? 0) / 2)),
  }));
  const roomsOfWall = new Map<string, string[]>();
  for (const face of doc.plan.faces.values()) {
    if (face.roomId !== null) roomsOfWall.set(face.wallId, [...(roomsOfWall.get(face.wallId) ?? []), face.roomId]);
  }
  const doors = doorSwings(doc.scene, doc.plan, openingFrameWidth).flatMap((swing) => {
    if (swing.roomId === null) return [];
    const other = (roomsOfWall.get(swing.wallId) ?? []).find((room) => room !== swing.roomId) ?? null;
    return [{ into: swing.roomId, other }];
  });
  const furniture: Rect[] = [];
  const group = doc.root.getObjectByName(FURNITURE_GROUP_NAME);
  const box = new THREE.Box3();
  for (const item of group?.children ?? []) {
    box.setFromObject(item);
    if (!box.isEmpty()) furniture.push({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
  }
  return { rooms, ceilingHeight: doc.scene.ceilingHeight, doors, furniture };
}

/** The bytes a grid's atlas and its bounce snapshot take on the GPU (RGBA float). */
const gridBytes = (grid: RoomGrid): number => grid.resolution.x * grid.resolution.y * 7 * (grid.resolution.z + 2) * 16 * 2;

export class WalkLighting {
  readonly uniforms: WalkUniforms = createWalkUniforms();
  readonly rig: WalkRig;
  /** The atlas sampler's texture while there is no atlas. */
  private readonly placeholder = this.uniforms.jeexAtlas.value;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  /** The grids' parent: room grids in grid order, the exterior grid last (three takes the first that contains an origin). */
  private readonly parent = new THREE.Group();
  private volumes: RoomVolumes | null = null;
  private grids: RoomGrid[] = [];
  private exterior: LightProbeGridWebGL | null = null;
  private atlas: ProbeAtlas | null = null;
  private bake: GridBake | null = null;
  private probes: RoomProbes | null = null;
  private current: WalkLightingPhase = 'baking';
  private last: WalkLightingStats | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.rig = new WalkRig({ scene, renderer, uniforms: this.uniforms });
    this.parent.name = 'walk-lighting-grids';
    scene.add(this.parent);
  }

  get phase(): WalkLightingPhase {
    return this.current;
  }

  /**
   * Builds the volumes, grids, atlas and probes for `doc` and starts the bake;
   * throws when the plan has more room boxes than the lighting takes.
   */
  load(doc: WalkDocument): void {
    const result = roomVolumes(volumeInput(doc));
    if (!result.ok) throw new Error(result.error);
    this.release();
    const volumes = result.volumes;
    this.volumes = volumes;
    this.grids = volumes.boxes.map((box) => new RoomGrid(box));
    this.exterior = createExteriorGrid(LIGHTING_STANDARD.apartment, volumes.bounds);
    for (const grid of [...this.grids, this.exterior]) {
      grid.visible = false;
      this.parent.add(grid);
    }
    const layout = atlasLayout(volumes.probes.length);
    this.atlas = new ProbeAtlas(this.renderer, this.scene, layout);
    this.uniforms.jeexAtlas.value = this.atlas.target.texture;
    setRoomBoxes(this.uniforms, volumes.boxes, volumes.probes, layout);
    this.restart();
  }

  /** Starts the whole bake over: grids, then probes, with the direct look meanwhile. */
  rebake(): void {
    if (this.volumes) this.restart();
  }

  /** One frame: `eligible` is whether the frame is drawn in walk or tour with the chain ready. */
  frame(eligible: boolean): void {
    if (!eligible || !this.bake || !this.probes) {
      this.show(false);
      return;
    }
    // Materials made since the last frame (a paint, a model upgrade, a rebuild) get the patch too.
    installWalkPatch(this.scene, this.uniforms);
    if (this.current === 'baking') {
      if (this.bake.step()) this.current = 'probes';
      return;
    }
    if (this.current === 'probes') {
      if (!this.probes.step()) return;
      this.current = 'live';
      this.last = this.measure();
    }
    this.show(true);
  }

  /** Refreshes what an edit touched; a scope this cannot narrow, or an edit before the bake ends, starts over. */
  refresh(scope: RefreshScope): void {
    if (!this.volumes || !this.probes) return;
    if (scope.all || this.current !== 'live') {
      this.restart();
      return;
    }
    const targets = this.grids.filter((grid) => scope.grids.includes(grid.roomId));
    if (targets.length > 0) this.gridBake(targets).step();
    this.probes.recapture([...scope.grids, ...scope.probes]);
    while (!this.probes.step());
    this.show(true);
  }

  /** The last full bake's measurement; `null` before the first is done. */
  get stats(): WalkLightingStats | null {
    return this.last;
  }

  dispose(): void {
    this.release();
    this.parent.removeFromParent();
    this.rig.dispose();
    this.placeholder.dispose();
  }

  private restart(): void {
    this.show(false);
    this.current = 'baking';
    this.bake = this.gridBake(this.grids, T.probesPerFrame);
    const scene = this.scene;
    this.probes = new RoomProbes({
      probes: this.volumes!.probes,
      layout: atlasLayout(this.volumes!.probes.length),
      rig: this.rig,
      mirrors: () => mirrorsOf(scene),
      grids: this.grids,
      exterior: this.exterior!,
      expectedHeight: (scene.environment?.image as { height?: number } | undefined)?.height ?? 0,
      capture: this.atlas!.capture,
      copy: this.atlas!.copy,
    });
  }

  private gridBake(targets: readonly RoomGrid[], probesPerFrame = Number.POSITIVE_INFINITY): GridBake {
    const scene = this.scene;
    return new GridBake({
      renderer: this.renderer,
      scene,
      grids: this.grids,
      targets,
      exterior: this.exterior!,
      rig: this.rig,
      exclusions: () => bakeExclusions(scene),
      probesPerFrame,
      cubemapSize: T.gridCubemapSize,
    });
  }

  /** Shows the room lighting (every grid, the walk rig) or the editing look. */
  private show(on: boolean): void {
    for (const grid of this.grids) grid.visible = on;
    if (this.exterior) this.exterior.visible = on;
    if (this.rig.state !== (on ? 'walk' : 'editing')) this.rig.setState(on ? 'walk' : 'editing');
  }

  private measure(): WalkLightingStats {
    const layout = atlasLayout(this.volumes!.probes.length);
    return {
      boxes: this.grids.length,
      gridProbes: this.bake!.stats.probes,
      bakeFrames: this.bake!.stats.frames,
      bakeMs: Math.round(this.bake!.stats.ms),
      probeFrames: this.probes!.stats.frames,
      probeMs: Math.round(this.probes!.stats.ms),
      memoryBytes: layout.width * layout.height * 8 + this.grids.reduce((sum, grid) => sum + gridBytes(grid), 0),
    };
  }

  /** Frees the grids and the atlas of the current document. */
  private release(): void {
    this.show(false);
    for (const grid of this.grids) {
      grid.removeFromParent();
      grid.dispose();
    }
    this.exterior?.removeFromParent();
    this.exterior?.dispose();
    this.atlas?.dispose();
    this.uniforms.jeexAtlas.value = this.placeholder;
    this.uniforms.jeexBoxCount.value = 0;
    this.grids = [];
    this.exterior = null;
    this.atlas = null;
    this.bake = null;
    this.probes = null;
    this.volumes = null;
  }
}
