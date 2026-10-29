/**
 * Measures the light of each room, for the camera balance (`room-balance.ts`):
 * a small cube rendered from the room's probe point in the live walk state
 * (grids, box probes, the sky's diffuse light, the lamps gated by room), with
 * every surface drawn in one matte white (`scene.overrideMaterial`, patched
 * as the walk patches every material), read back and measured. A grey card,
 * as a photographer holds one: what it reads is the light alone, so a sand
 * wall does not pass for a warm light and the balance keeps it sand while it
 * turns a white front white. The reflection probes cannot serve: they are
 * captured in the rig's capture state, without the sky's diffuse light inside
 * the rooms, which is what turns a daylit kitchen blue on screen.
 *
 * What draws nothing on screen draws nothing here either: a mesh whose
 * materials are all hidden, write no colour or are fully transparent (pick
 * shapes, auras) is hidden for the render, since the override would draw it.
 *
 * One cube camera for the life of the walk lighting, as `ProbeCamera`: three
 * keeps a transmission target per camera that draws glass.
 */

import * as THREE from 'three';
import { measureProbe, type ProbeLight } from './room-balance.js';
import type { Vec3 } from './room-volumes.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';
import { installWalkPatch, type WalkUniforms } from './box-probe-patch.js';

/** Whether `mesh` draws nothing on screen. */
function drawsNothing(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.every((material) => !material.visible || !material.colorWrite || (material.transparent && material.opacity <= 0));
}

export class RoomSampler {
  private readonly target: THREE.WebGLCubeRenderTarget;
  private readonly camera: THREE.CubeCamera;
  private readonly texels: Float32Array;
  /** The grey card every surface is drawn with: white, matte, patched for the walk once. */
  private readonly card = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });

  constructor(uniforms: WalkUniforms) {
    this.card.name = 'WalkLighting.greyCard';
    installWalkPatch(new THREE.Mesh(undefined, this.card), uniforms);
    this.target = new THREE.WebGLCubeRenderTarget(T.balance.sampleSize, { type: THREE.HalfFloatType });
    this.target.texture.name = 'WalkLighting.roomSampler';
    this.camera = new THREE.CubeCamera(0.05, 100, this.target);
    this.texels = new Float32Array(T.balance.sampleSize * T.balance.sampleSize * 4);
  }

  /** Measures the room around `position` as `scene` draws now; `null` when nothing reads as a lit neutral surface. */
  sample(renderer: THREE.WebGLRenderer, scene: THREE.Scene, position: Vec3): ProbeLight | null {
    this.camera.position.set(position.x, position.y, position.z);
    this.camera.updateMatrixWorld();
    const autoClear = renderer.autoClear;
    const override = scene.overrideMaterial;
    const hidden: THREE.Object3D[] = [];
    scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && object.visible && drawsNothing(object as THREE.Mesh)) hidden.push(object);
    });
    try {
      for (const object of hidden) object.visible = false;
      renderer.autoClear = true;
      scene.overrideMaterial = this.card;
      this.camera.update(renderer, scene);
    } finally {
      scene.overrideMaterial = override;
      renderer.autoClear = autoClear;
      for (const object of hidden) object.visible = true;
    }
    // A refused or empty read measures nothing: the room keeps the fixed
    // balance, which `__viewerDebug.walkLighting().roomBalance` reports.
    const faces = this.read(renderer);
    return faces ? measureProbe(faces) : null;
  }

  /**
   * The six faces as floats, or `null` when the read failed. WebGL2 grants
   * reading a float colour buffer (RGBA16F included) back as RGBA/FLOAT on
   * every device; three reads with the texture's own type, RGBA/HALF_FLOAT,
   * which desktop grants and many Android drivers refuse with
   * INVALID_OPERATION, leaving the texels empty. So the read is made here.
   */
  private read(renderer: THREE.WebGLRenderer): Float32Array[] | null {
    const gl = renderer.getContext();
    const size = T.balance.sampleSize;
    const previous = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousLevel = renderer.getActiveMipmapLevel();
    const faces: Float32Array[] = [];
    let failed = false;
    let lit = false;
    // An error flag a draw before left set is not this read's answer.
    for (let stale = 0; stale < 8 && gl.getError() !== gl.NO_ERROR; stale += 1);
    try {
      for (let face = 0; face < 6 && !failed; face += 1) {
        renderer.setRenderTarget(this.target, face);
        this.texels.fill(0);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, this.texels);
        failed = gl.getError() !== gl.NO_ERROR;
        lit ||= this.texels.some((value) => value !== 0);
        faces.push(Float32Array.from(this.texels));
      }
    } finally {
      renderer.setRenderTarget(previous, previousFace, previousLevel);
    }
    return failed || !lit ? null : faces;
  }

  dispose(): void {
    this.target.dispose();
    this.card.dispose();
  }
}
