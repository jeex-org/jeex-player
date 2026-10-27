/**
 * The asset move tool's handles on screen (`asset-handles.ts`): the yaw ring
 * flat round the object, or the height bar beside a wall object in the top
 * view, in the tour-camera tool's accent.
 *
 * Drawn on top (`depthTest: false`) like that tool's handles: a handle behind
 * a sofa or inside a wall that cannot be seen cannot be grabbed with intent.
 * What is drawn is what `handleAt` picks: the same shape, the same points.
 */

import * as THREE from 'three';
import { EDITOR_ACCENT } from '../shared/editor-accent.js';
import { RING_LIFT_M, type HandleShape } from './asset-handles.js';

/** The ring's band and the bar's width, metres. */
const RING_BAND_M = 0.035;
const BAR_WIDTH_M = 0.05;
/** Over the legality field (999), which it is read against. */
const HANDLE_RENDER_ORDER = 1000;
const SEGMENTS = 64;

export class AssetHandlesView {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({
    color: EDITOR_ACCENT,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private mesh: THREE.Mesh | null = null;
  private shown: HandleShape | null = null;

  constructor() {
    this.group.name = 'jeex-asset-handles';
  }

  /** Draws `shape`, or nothing; an unchanged shape costs nothing. */
  show(shape: HandleShape | null): void {
    if (sameShape(shape, this.shown)) return;
    this.shown = shape;
    this.clear();
    if (!shape) return;
    const geometry =
      shape.kind === 'yaw'
        ? new THREE.RingGeometry(shape.radius - RING_BAND_M / 2, shape.radius + RING_BAND_M / 2, SEGMENTS)
        : new THREE.PlaneGeometry(BAR_WIDTH_M, Math.hypot(shape.to.x - shape.from.x, shape.to.z - shape.from.z));
    // Both shapes lie flat: the ring on its plane, the bar along the plan direction it runs.
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.renderOrder = HANDLE_RENDER_ORDER;
    if (shape.kind === 'yaw') {
      mesh.position.set(shape.centre.x, shape.centre.y, shape.centre.z);
    } else {
      mesh.position.set((shape.from.x + shape.to.x) / 2, shape.from.y + RING_LIFT_M, (shape.from.z + shape.to.z) / 2);
      mesh.rotation.y = Math.atan2(shape.to.x - shape.from.x, shape.to.z - shape.from.z);
    }
    this.mesh = mesh;
    this.group.add(mesh);
  }

  /** The shape on screen, for the picking. */
  current(): HandleShape | null {
    return this.shown;
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

/** Whether two shapes draw the same thing, within a millimetre. */
function sameShape(a: HandleShape | null, b: HandleShape | null): boolean {
  if (a === null || b === null) return a === b;
  const near = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }): boolean =>
    Math.abs(p.x - q.x) < 1e-3 && Math.abs(p.y - q.y) < 1e-3 && Math.abs(p.z - q.z) < 1e-3;
  if (a.kind === 'yaw' && b.kind === 'yaw') return near(a.centre, b.centre) && Math.abs(a.radius - b.radius) < 1e-3;
  if (a.kind === 'height' && b.kind === 'height') return near(a.from, b.from) && near(a.to, b.to);
  return false;
}
