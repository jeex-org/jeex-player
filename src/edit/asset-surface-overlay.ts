/**
 * The legality field of a drag, drawn: one mesh of quads with a colour per
 * vertex, green where the dragged object would be legal and red where it
 * would not, drawn through everything (depth test off) at 35 % opacity so it reads through furniture in orbit and from
 * above in plan3d. One draw call; rebuilt only when the mask is recomputed
 * (a drag starts, the yaw or the room changes), never per frame.
 */

import * as THREE from 'three';
import type { LegalityMask } from '../layout/asset-mask.js';

/** Legal cells. */
export const MASK_OK_COLOR = 0x3ccf6e;
/** Illegal cells. */
export const MASK_BAD_COLOR = 0xe5484d;
/** The field's opacity. */
export const MASK_OPACITY = 0.35;
/** Drawn after the scene and the tour-camera rig. */
const MASK_RENDER_ORDER = 999;

export class AssetSurfaceOverlay {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: MASK_OPACITY,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private mesh: THREE.Mesh | null = null;

  constructor() {
    this.group.name = 'assetMoveMask';
  }

  /** Draws `mask`, or hides the field for `null`. */
  show(mask: LegalityMask | null): void {
    this.clear();
    if (!mask || mask.count === 0) return;
    const colours = new Float32Array(mask.count * 12);
    const ok = new THREE.Color(MASK_OK_COLOR);
    const bad = new THREE.Color(MASK_BAD_COLOR);
    const index: number[] = [];
    for (let cell = 0; cell < mask.count; cell += 1) {
      const colour = mask.ok[cell] === 1 ? ok : bad;
      for (let corner = 0; corner < 4; corner += 1) colour.toArray(colours, cell * 12 + corner * 3);
      const base = cell * 4;
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mask.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = MASK_RENDER_ORDER;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.group.removeFromParent();
  }

  private clear(): void {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
}
