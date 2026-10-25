/**
 * The rooms' reflection probes: one capture per room at its probe point,
 * prefiltered by three's PMREM and copied into one shared atlas the patch
 * samples (`box-probe-patch.ts`), one room per frame.
 *
 * A probe is captured after the grids are baked, in the rig's capture state:
 * box probes off (so no probe sees an earlier probe), the environment's
 * diffuse off inside the rooms, every room grid and the exterior grid visible
 * (the room is lit as it will be on screen, and every program the walk draws
 * with is compiled here, before the swap), the mirrors hidden.
 *
 * Layout invariant: a 128 px probe's PMREM output is exactly one atlas tile
 * (`TILE`), and the patch samples it with the atlas's own largest mip
 * (`JEEX_PROBE_MAX_MIP`), whatever the size of the scene's environment;
 * `step` fails loudly when a capture's layout differs from the tile.
 */

import { ViewerLibError } from '../../shared/errors.js';
import * as THREE from 'three';
import { TILE, type AtlasLayout, type UniformState } from './box-probe-patch.js';
import type { RoomProbe, Vec3 } from './room-volumes.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';

/** One prefiltered capture: its texture, its size and its release. */
export type CapturedProbe = { texture: THREE.Texture; width: number; height: number; dispose(): void };
/** Captures the scene around `position` and prefilters it. */
export type ProbeCapture = (position: Vec3) => CapturedProbe;
/** Copies a capture into the atlas at `tile` (texels from the atlas's lower left corner). */
export type ProbeCopy = (source: THREE.Texture, tile: { x: number; y: number }) => void;

export type RoomProbesDeps = {
  probes: readonly RoomProbe[];
  layout: AtlasLayout;
  rig: { setState(state: UniformState): void };
  mirrors: () => readonly { visible: boolean }[];
  grids: readonly { visible: boolean }[];
  exterior: { visible: boolean };
  capture: ProbeCapture;
  copy: ProbeCopy;
};

export class RoomProbes {
  private readonly deps: RoomProbesDeps;
  /** Rooms still to capture, by index into `probes`. */
  private readonly queue: number[];
  readonly stats = { frames: 0, ms: 0 };

  constructor(deps: RoomProbesDeps) {
    this.deps = deps;
    this.queue = deps.probes.map((_, i) => i);
  }

  get done(): boolean {
    return this.queue.length === 0;
  }

  /** Queues the probes of `roomIds` again (an edit in walk). */
  recapture(roomIds: readonly string[]): void {
    this.deps.probes.forEach((probe, i) => {
      if (roomIds.includes(probe.roomId) && !this.queue.includes(i)) this.queue.push(i);
    });
  }

  /** Captures the next room; answers whether every room is captured. */
  step(): boolean {
    const index = this.queue[0];
    if (index === undefined) return true;
    const { rig, mirrors, grids, exterior, layout } = this.deps;
    const hidden = mirrors().filter((mirror) => mirror.visible);
    const started = performance.now();
    rig.setState('capture');
    for (const mirror of hidden) mirror.visible = false;
    for (const grid of grids) grid.visible = true;
    exterior.visible = true;
    try {
      const probe = this.deps.capture(this.deps.probes[index]!.position);
      try {
        if (probe.width !== TILE.width || probe.height !== TILE.height) {
          throw new ViewerLibError(
            'internal',
            `a room probe's cube-UV layout is ${probe.width} x ${probe.height}; the atlas tile is ${TILE.width} x ${TILE.height}`,
          );
        }
        this.deps.copy(probe.texture, layout.tiles[index]!);
      } finally {
        probe.dispose();
      }
      this.queue.shift();
    } finally {
      for (const grid of grids) grid.visible = false;
      exterior.visible = false;
      for (const mirror of hidden) mirror.visible = true;
      rig.setState('editing');
      this.stats.frames += 1;
      this.stats.ms += performance.now() - started;
    }
    return this.done;
  }
}

/** Copies one tile with exact texels: the atlas is filled tile by tile and never cleared. */
const COPY_SHADER = {
  vertexShader: /* glsl */ `void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D source;
    uniform vec2 tile;
    void main() { gl_FragColor = texelFetch( source, ivec2( gl_FragCoord.xy - tile ), 0 ); }
  `,
};

/** The GPU side: the atlas target, the PMREM capture and the tile copy. */
export class ProbeAtlas {
  readonly target: THREE.WebGLRenderTarget;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, layout: AtlasLayout) {
    this.renderer = renderer;
    this.scene = scene;
    this.target = new THREE.WebGLRenderTarget(layout.width, layout.height, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.target.texture.name = 'WalkLighting.probeAtlas';
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        ...COPY_SHADER,
        uniforms: { source: { value: null }, tile: { value: new THREE.Vector2() } },
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.quad.frustumCulled = false;
  }

  readonly capture: ProbeCapture = (position) => {
    const target = this.pmrem.fromScene(this.scene, 0, 0.05, 100, {
      size: T.probeSize,
      position: new THREE.Vector3(position.x, position.y, position.z),
    });
    return { texture: target.texture, width: target.width, height: target.height, dispose: () => target.dispose() };
  };

  readonly copy: ProbeCopy = (source, tile) => {
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const material = this.quad.material;
    material.uniforms['source']!.value = source;
    (material.uniforms['tile']!.value as THREE.Vector2).set(tile.x, tile.y);
    const image = source.image as { width: number; height: number };
    this.target.viewport.set(tile.x, tile.y, image.width, image.height);
    try {
      renderer.autoClear = false;
      renderer.setRenderTarget(this.target);
      renderer.render(this.quad, this.camera);
    } finally {
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(previous);
      material.uniforms['source']!.value = null;
    }
  };

  dispose(): void {
    this.target.dispose();
    this.pmrem.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
