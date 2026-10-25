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
 * grid is never on screen; anything wider starts the bake over. Handed the
 * document on screen, a refresh first moves the probe points to where the
 * current furniture puts them (every room whose point moved is re-captured
 * too, and its boxes project from the new point); rooms that no longer give
 * the loaded boxes reload the document. A scope that asks for the lamp
 * check (`lamps`, every asset edit) starts the bake over when any lamp
 * moved, went, came or changed since the bake started (`lampSignature`).
 *
 * Lamps: every artificial point light (a fact light or a bank bulb) gets a
 * source room on each bake start (`lamp-rooms.ts`), written to its
 * `userData`; the walk transform gates its direct light by it
 * (`box-probe-patch.ts`). The lamps feed the grids: the grid bake takes the
 * furniture off every layer, so the lights under it stay in the scene.
 *
 * Relight: a new colour of the artificial light changes the lamps' bounce in
 * the grids, so it starts the bake over; the colour it was baked with changes
 * nothing.
 */

import { ViewerLibError } from '../../shared/errors.js';
import * as THREE from 'three';
import { LIGHTING_STANDARD } from '../../lighting/lighting-standard.js';
import { roomVolumes, type RoomBox, type RoomVolumes, type Vec3, type VolumeInput, type VolumeRoom } from './room-volumes.js';
import { assignLampRoom, lampSignature, type LampEntry } from './lamp-rooms.js';
import { isArtificialLight } from '../../assets/artificial-light.js';
import { LAMP_ROOM_KEY } from '../light-order.js';
import { createExteriorGrid, RoomGrid } from './room-grid.js';
import { GridBake } from './grid-bake.js';
import { ProbeAtlas, RoomProbes } from './room-probes.js';
import { atlasLayout, installWalkPatch, walkUniformsFor, setRoomBoxes, type WalkUniforms } from './box-probe-patch.js';
import { WalkRig } from './walk-rig.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';
import { HdriSky, type HdriContent, type HdriSkyState, type HdriView } from '../hdri/hdri-sky.js';
import type { LightProbeGridWebGL } from 'three/addons/lighting/LightProbeGridWebGL.js';

/**
 * The document the lighting is built for, as the application reads it
 * (`app/walk-lighting-wiring.ts`): the rooms, doors and furniture footprints
 * the volumes are made of, and the furniture group a grid probe must not see.
 */
export type WalkDocument = { volumes: VolumeInput; furniture: THREE.Object3D | null };
/** What an edit asks to refresh: everything, or the grids and probes of some rooms. */
export type RefreshScope = { all: boolean; grids: readonly string[]; probes: readonly string[]; lamps?: true };
/** `empty`: the plan has no closed room, nothing is baked and the view keeps the direct look. */
export type WalkLightingPhase = 'baking' | 'probes' | 'live' | 'empty';

/** A probe point that moves less than this has not moved, metres. */
const MOVED_M = 1e-3;

/** Whether two box lists are the same rooms in the same order with the same projection boxes. */
function sameBoxes(a: readonly RoomBox[], b: readonly RoomBox[]): boolean {
  const same = (p: Vec3, q: Vec3): boolean => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9 && Math.abs(p.z - q.z) < 1e-9;
  return (
    a.length === b.length &&
    a.every(
      (box, i) =>
        box.roomId === b[i]!.roomId && same(box.projection.min, b[i]!.projection.min) && same(box.projection.max, b[i]!.projection.max),
    )
  );
}

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

/** Whether `object` is `furniture` or lies under it. */
function under(object: THREE.Object3D, furniture: THREE.Object3D | null): boolean {
  for (let at: THREE.Object3D | null = object; at !== null; at = at.parent) if (at === furniture) return true;
  return false;
}

/**
 * Every mirror and every transmissive mesh under `scene` outside the furniture
 * group: what a grid probe must not see, hidden by visibility. Nothing under
 * the furniture group is hidden, so no lamp light loses its ancestor
 * (`furnitureRenderables` takes the furniture out by layers).
 */
export function bakeExclusions(scene: THREE.Object3D, furniture: THREE.Object3D | null): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (under(object, furniture)) return;
    if ((object as Mirror).isReflector === true) {
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

/** Every renderable under the furniture group (bodies, shades, transmissive bodies, mirrors): what the grid capture takes off every layer. */
export function furnitureRenderables(furniture: THREE.Object3D | null): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  furniture?.traverse((object) => {
    const drawn = object as THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
    if (drawn.isMesh || drawn.isLine || drawn.isPoints || drawn.isSprite) out.push(object);
  });
  return out;
}

/** The room value of a lamp outside every room: it lights nothing inside the rooms. */
export const NO_ROOM = -2;

/** Every lamp of `scene`: each point light tagged as artificial light, a fact light or a bank bulb alike. */
export function runtimeLamps(scene: THREE.Object3D): THREE.PointLight[] {
  const out: THREE.PointLight[] = [];
  scene.traverse((object) => {
    if ((object as Partial<THREE.PointLight>).isPointLight && isArtificialLight(object)) out.push(object as THREE.PointLight);
  });
  return out;
}

/** What the lamps' signature reads of each lamp, in world space. */
function lampEntries(lamps: readonly THREE.PointLight[]): LampEntry[] {
  const world = new THREE.Vector3();
  return lamps.map((light) => {
    light.getWorldPosition(world);
    return {
      id: light.uuid,
      position: [world.x, world.y, world.z],
      colour: [light.color.r, light.color.g, light.color.b],
      intensity: light.intensity,
      distance: light.distance,
      decay: light.decay,
    };
  });
}

function mirrorsOf(scene: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if ((object as Mirror).isReflector === true) out.push(object);
  });
  return out;
}

/** The bytes a grid's atlas and its bounce snapshot take on the GPU (RGBA float). */
const gridBytes = (grid: RoomGrid): number => grid.resolution.x * grid.resolution.y * 7 * (grid.resolution.z + 2) * 16 * 2;

export class WalkLighting {
  /** The scene's shared uniforms (`walkUniformsFor`): they outlive this lighting, as the patched materials do. */
  readonly uniforms: WalkUniforms;
  readonly rig: WalkRig;
  /** The atlas sampler's texture while there is no atlas. */
  private readonly placeholder: THREE.Texture;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  /** The grids' parent: room grids in grid order, the exterior grid last (three takes the first that contains an origin). */
  private readonly parent = new THREE.Group();
  private volumes: RoomVolumes | null = null;
  private furniture: THREE.Object3D | null = null;
  /** The rooms of the loaded document, whose polygons the lamps are assigned by. */
  private rooms: readonly VolumeRoom[] = [];
  /** The lamps' signature when their rooms were last assigned and the bake started. */
  private lampsSigned = '';
  private grids: RoomGrid[] = [];
  private exterior: LightProbeGridWebGL | null = null;
  private atlas: ProbeAtlas | null = null;
  private bake: GridBake | null = null;
  private probes: RoomProbes | null = null;
  private current: WalkLightingPhase = 'baking';
  private last: WalkLightingStats | null = null;
  /** The host sky (`hdri/hdri-sky.ts`), shown in the states the rig picks. */
  private readonly sky: HdriSky;
  /** The live sun's direction authority, for the sky's elevation (`render/sun-shadow.ts`). */
  private sun: () => { override(elevationDeg: number | null): void } | null | undefined = () => null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.uniforms = walkUniformsFor(scene);
    this.placeholder = this.uniforms.jeexAtlas.value;
    this.rig = new WalkRig({ scene, renderer, uniforms: this.uniforms });
    this.sky = new HdriSky({ scene, renderer, exterior: () => this.exterior, sun: () => this.sun() });
    this.parent.name = 'walk-lighting-grids';
    scene.add(this.parent);
  }

  get phase(): WalkLightingPhase {
    return this.current;
  }

  /** What the host sky shows now. */
  get hdriState(): HdriSkyState {
    return this.sky.state;
  }

  /** Where the sky reads the live sun from. */
  setSun(sun: () => { override(elevationDeg: number | null): void } | null | undefined): void {
    this.sun = sun;
  }

  /**
   * Installs a host sky, or removes it (`null`). A change of HDRI lighting
   * (an environment installed or removed) re-bakes the rooms, so the swap
   * frame shows sky, sun and room lighting that agree; a sky alone (a baked
   * apartment) re-bakes nothing.
   */
  setHdri(content: HdriContent | null): void {
    const relit = this.sky.lighting || content?.environment !== undefined;
    this.sky.install(content);
    this.rig.setHdri(content ? this.sky : null);
    if (relit && this.volumes) this.restart();
  }

  /** The site's north changed: the sky and the sun turn with it. */
  setHdriView(view: HdriView): void {
    this.sky.setView(view);
  }

  /**
   * Builds the volumes, grids, atlas and probes for `doc` and starts the bake;
   * throws when the plan has more room boxes than the lighting takes.
   */
  load(doc: WalkDocument): void {
    const result = roomVolumes(doc.volumes);
    if (!result.ok) throw new ViewerLibError('internal', result.error);
    this.release();
    this.rig.setHdriDaylight(false);
    const volumes = result.volumes;
    if (volumes.boxes.length === 0) {
      this.current = 'empty';
      return;
    }
    this.volumes = volumes;
    this.furniture = doc.furniture;
    this.rooms = doc.volumes.rooms;
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
    if (this.current === 'empty') {
      // No room to light: a host sky shows on its own, in the open-air look.
      this.uniforms.jeexLampScope.value = 0;
      this.rig.setHdriDaylight(eligible);
      return;
    }
    if (!eligible || !this.bake || !this.probes) {
      this.uniforms.jeexLampScope.value = 0;
      this.show(false);
      return;
    }
    // The lamp gate holds from the first walk frame on, through the bake's direct look and its captures.
    this.uniforms.jeexLampScope.value = 1;
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
    } else if (!this.probes.done) {
      // A relight: one room's probe per frame, written into its tile in place.
      this.probes.step();
    }
    this.show(true);
  }

  /**
   * The artificial light changed colour: the grids hold the lamps' tinted bounce, so a change re-bakes
   * everything (grids, then probes), the initial bake included; the colour the lighting was baked with
   * re-bakes nothing.
   */
  relight(): void {
    if (this.volumes && this.lampsChanged()) this.restart();
  }

  /** Whether a lamp moved, went, came or changed colour or strength since the bake started. */
  private lampsChanged(): boolean {
    this.scene.updateMatrixWorld();
    return lampSignature(lampEntries(runtimeLamps(this.scene))) !== this.lampsSigned;
  }

  /** Whether a relight still has probes to write while live. */
  get recapturing(): boolean {
    return this.current === 'live' && this.probes !== null && !this.probes.done;
  }

  /**
   * Refreshes what an edit touched; a scope this cannot narrow, or an edit
   * before the bake ends, starts over. `doc`, the document on screen now,
   * moves the probe points with the furniture first.
   */
  refresh(scope: RefreshScope, doc: WalkDocument | null = null): void {
    if (!this.volumes || !this.probes) return;
    const moved = doc ? this.follow(doc) : [];
    if (moved === null) {
      this.load(doc!);
      return;
    }
    if (scope.all || this.current !== 'live' || (scope.lamps === true && this.lampsChanged())) {
      this.restart();
      return;
    }
    const targets = this.grids.filter((grid) => scope.grids.includes(grid.roomId));
    if (targets.length > 0) this.gridBake(targets).step();
    this.probes.recapture([...scope.grids, ...scope.probes, ...moved]);
    while (!this.probes.step());
    this.show(true);
  }

  /**
   * Moves the probe points to where `doc`'s furniture puts them and rewrites
   * every box's projection centre; answers the rooms whose point moved, or
   * `null` when `doc`'s rooms give other boxes than the loaded ones.
   */
  private follow(doc: WalkDocument): string[] | null {
    const volumes = this.volumes!;
    const result = roomVolumes(doc.volumes);
    if (!result.ok || !sameBoxes(result.volumes.boxes, volumes.boxes)) return null;
    this.furniture = doc.furniture;
    const moved: string[] = [];
    result.volumes.probes.forEach((next, i) => {
      const probe = volumes.probes[i]!;
      const { x, y, z } = probe.position;
      if (Math.hypot(next.position.x - x, next.position.y - y, next.position.z - z) <= MOVED_M) return;
      // In place: the room probes read the same objects at capture time.
      probe.position = next.position;
      moved.push(probe.roomId);
    });
    if (moved.length > 0) setRoomBoxes(this.uniforms, volumes.boxes, volumes.probes, atlasLayout(volumes.probes.length));
    return moved;
  }

  /** The last full bake's measurement; `null` before the first is done. */
  get stats(): WalkLightingStats | null {
    return this.last;
  }

  dispose(): void {
    this.uniforms.jeexLampScope.value = 0;
    this.release();
    this.parent.removeFromParent();
    this.rig.dispose();
    this.sky.dispose();
  }

  /** Gives every lamp its source room (an index in the probe order, or `NO_ROOM`) and records the lamps' signature. */
  private assignLamps(): void {
    this.scene.updateMatrixWorld();
    const order = this.volumes!.probes.map((probe) => probe.roomId);
    const lamps = runtimeLamps(this.scene);
    const entries = lampEntries(lamps);
    lamps.forEach((light, i) => {
      const [x, , z] = entries[i]!.position;
      const room = assignLampRoom({ x, z }, this.rooms, order);
      light.userData[LAMP_ROOM_KEY] = room >= 0 ? room : NO_ROOM;
    });
    this.lampsSigned = lampSignature(entries);
  }

  private restart(): void {
    this.show(false);
    this.assignLamps();
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
      exclusions: () => bakeExclusions(scene, this.furniture),
      layerExclusions: () => furnitureRenderables(this.furniture),
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
