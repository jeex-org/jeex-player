/**
 * The rooms' reflection probes: one capture per room at its probe point,
 * prefiltered by three's PMREM into a cube and copied into one 2D array the
 * patch samples (`box-probe-patch.ts`), six layers a room, one room per
 * frame.
 *
 * A probe is captured after the grids are baked, in the rig's capture state:
 * box probes off (so no probe sees an earlier probe), the environment's
 * diffuse off inside the rooms, the grids on (the room is lit as it will be
 * on screen, and every program the walk draws with is compiled here, before
 * the swap), the mirrors hidden.
 *
 * Layout invariant: a 128 px probe's PMREM is a cube of 256 texels a face
 * with mips down to 8 (`PROBE_PMREM_MAX_LOD`), whatever the size of the
 * scene's environment; the array holds its levels 1 to 5 (128 to 8 texels)
 * and `step` fails loudly when a capture's cube differs. Each array face
 * carries a one-texel border written from the extended face plane, so a
 * bilinear read at a face edge takes the neighbouring face's light and a
 * rough reflection shows no seam.
 */

import { ViewerLibError } from '../../shared/errors.js';
import * as THREE from 'three';
import { PROBE_PMREM_MAX_LOD, type UniformState } from './box-probe-patch.js';
import type { RoomProbe, Vec3 } from './room-volumes.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';
import { probeArrayLayout } from './probe-layout.js';

/** One prefiltered capture: its cube texture, its face size and its release. */
export type CapturedProbe = { texture: THREE.Texture; size: number; dispose(): void };
/** Captures the scene around `position` and prefilters it. */
export type ProbeCapture = (position: Vec3) => CapturedProbe;
/** Copies a capture into the array's layers of room `room`. */
export type ProbeCopy = (source: THREE.Texture, room: number) => void;

/** The face size of a probe's PMREM cube: its last level is 8 texels. */
const PMREM_FACE = 8 << PROBE_PMREM_MAX_LOD;

export type RoomProbesDeps = {
  probes: readonly RoomProbe[];
  rig: { setState(state: UniformState): void };
  mirrors: () => readonly { visible: boolean }[];
  /** The grids' switch (`jeexGridOn`). */
  grids: { visible: boolean };
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
    const { rig, mirrors, grids } = this.deps;
    const hidden = mirrors().filter((mirror) => mirror.visible);
    const started = performance.now();
    rig.setState('capture');
    for (const mirror of hidden) mirror.visible = false;
    grids.visible = true;
    try {
      const probe = this.deps.capture(this.deps.probes[index]!.position);
      try {
        if (probe.size !== PMREM_FACE) {
          throw new ViewerLibError(
            'internal',
            `a room probe's PMREM layout has ${probe.size} texel faces; the probe array copies ${PMREM_FACE}`,
          );
        }
        this.deps.copy(probe.texture, index);
      } finally {
        probe.dispose();
      }
      this.queue.shift();
    } finally {
      grids.visible = false;
      for (const mirror of hidden) mirror.visible = true;
      rig.setState('editing');
      this.stats.frames += 1;
      this.stats.ms += performance.now() - started;
    }
    return this.done;
  }
}

/**
 * Writes one face of one level: every texel, border included, is the PMREM
 * cube read at the direction through the texel's centre on the face plane,
 * extended past the face's edge for the border (`jeexFace` in the patch is
 * the inverse).
 */
const COPY_SHADER = {
  vertexShader: /* glsl */ `void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
  fragmentShader: /* glsl */ `
    uniform samplerCube source;
    uniform int face;
    uniform float level;
    uniform float faceSize;
    void main() {
      vec2 st = ( ( gl_FragCoord.xy - 1.0 ) / ( faceSize - 2.0 ) ) * 2.0 - 1.0;
      vec3 d;
      if ( face == 0 ) d = vec3( 1.0, st.y, st.x );
      else if ( face == 1 ) d = vec3( -1.0, st.y, st.x );
      else if ( face == 2 ) d = vec3( st.x, 1.0, st.y );
      else if ( face == 3 ) d = vec3( st.x, -1.0, st.y );
      else if ( face == 4 ) d = vec3( st.x, st.y, 1.0 );
      else d = vec3( st.x, st.y, -1.0 );
      gl_FragColor = vec4( textureLod( source, d, level + 1.0 ).rgb, 1.0 );
    }
  `,
};

/**
 * The cube camera every probe capture renders with, kept for the life of the
 * walk lighting: three keeps a transmission target per camera that draws
 * glass and frees it only with the renderer, so a camera per capture (as
 * `PMREMGenerator.fromScene` makes) would strand one target per capture.
 *
 * The cube's edge is the tuning's `probeSize` and nothing else: the layout
 * invariant above pins the atlas tile to what a 128 px capture's PMREM
 * produces, so no caller may hand a different edge.
 */
export class ProbeCamera {
  readonly camera: THREE.CubeCamera;
  readonly target: THREE.WebGLCubeRenderTarget;

  constructor() {
    this.target = new THREE.WebGLCubeRenderTarget(T.probeSize, { type: THREE.HalfFloatType });
    this.target.texture.name = 'WalkLighting.probeCube';
    this.camera = new THREE.CubeCamera(0.05, 100, this.target);
  }

  dispose(): void {
    this.target.dispose();
  }
}

/** The GPU side: the probe array, the PMREM capture and the copy pass. */
export class ProbeArray {
  readonly target: THREE.WebGLArrayRenderTarget;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly cube: ProbeCamera;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, rooms: number, cube: ProbeCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.cube = cube;
    const { faceSize, levels, layers } = probeArrayLayout(rooms);
    this.target = new THREE.WebGLArrayRenderTarget(faceSize, faceSize, layers, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    // Placeholders: three allocates one level per entry and limits sampling to them.
    for (let level = 0; level < levels; level += 1)
      this.target.texture.mipmaps.push({ width: faceSize >> level, height: faceSize >> level } as never);
    this.target.texture.name = 'WalkLighting.probeArray';
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        ...COPY_SHADER,
        uniforms: { source: { value: null }, face: { value: 0 }, level: { value: 0 }, faceSize: { value: 0 } },
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.quad.frustumCulled = false;
  }

  readonly capture: ProbeCapture = (position) => {
    const { camera, target: cube } = this.cube;
    camera.position.set(position.x, position.y, position.z);
    camera.updateMatrixWorld();
    // Each face must start clear, or a face keeps the last probe's room where this one draws nothing.
    const autoClear = this.renderer.autoClear;
    try {
      this.renderer.autoClear = true;
      camera.update(this.renderer, this.scene);
    } finally {
      this.renderer.autoClear = autoClear;
    }
    const target = this.pmrem.fromCubemap(cube.texture);
    return { texture: target.texture, size: target.width, dispose: () => target.dispose() };
  };

  readonly copy: ProbeCopy = (source, room) => {
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const uniforms = this.quad.material.uniforms;
    uniforms['source']!.value = source;
    const levels = this.target.texture.mipmaps.length;
    try {
      renderer.autoClear = false;
      for (let level = 0; level < levels; level += 1) {
        const size = this.target.width >> level;
        this.target.viewport.set(0, 0, size, size);
        uniforms['level']!.value = level;
        uniforms['faceSize']!.value = size;
        for (let face = 0; face < 6; face += 1) {
          uniforms['face']!.value = face;
          renderer.setRenderTarget(this.target, room * 6 + face, level);
          renderer.render(this.quad, this.camera);
        }
      }
    } finally {
      this.target.viewport.set(0, 0, this.target.width, this.target.height);
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(previous, previousFace, previousLevel);
      uniforms['source']!.value = null;
    }
  };

  dispose(): void {
    this.target.dispose();
    this.pmrem.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
