/**
 * The small offscreen picture of one object: what a finish, furniture or
 * opening swatch shows in the selection panel.
 *
 * It draws with the viewer's OWN renderer, into a render target, and reads the
 * pixels back. A second `WebGLRenderer` for 112 px thumbnails would mean four
 * live contexts for two viewers on a page, out of the sixteen a browser
 * allows; a render target costs no context at all: it is the same one.
 *
 * Borrow invariant: the group is REPARENTED into the preview scene and put back
 * where it came from in a `finally`, so a failed render — a lost context, a
 * blocked read-back — can never strand a live object off-screen. The renderer's
 * own render target and clear colour are restored the same way, because the
 * next frame of the real scene draws with them.
 *
 * Answer invariant: every failure answers `null`. The panel then falls back to
 * a flat palette chip, which is a worse picture but never a broken one.
 *
 * Light invariant: a swatch is lit by the lighting standard's REFERENCE rig
 * (`src/lighting/`) — the same environment and key every application uses for
 * material review — and tone mapped exactly once. Rendering into a render
 * target applies no tone mapping, so the swatch goes into a half-float target
 * and through the still capture's display pass (`still-capture.ts`), which
 * applies the renderer's PBR Neutral, its exposure and the sRGB encoding.
 * Lights inside the previewed object (a lamp's bulb) are the object's own.
 */

import * as THREE from 'three';
import { displayMaterial, drawDisplayPass } from './still-capture.js';
import type { LightingContext, LightingRig } from '../lighting/lighting-context.js';

/** Edge of the square preview render target, in pixels. */
const PREVIEW_SIZE = 112;

/** Scratch: `frameCamera`'s bounding-box size and centre, recomputed once per swatch. */
const SCRATCH_SIZE = new THREE.Vector3();
const SCRATCH_CENTER = new THREE.Vector3();

export type PreviewRenderer = {
  /** Renders `group` on transparent background and returns a PNG data URL. */
  render(group: THREE.Object3D, size?: number): string | null;
  dispose(): void;
};

export class SwatchPreview implements PreviewRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  /** The owner's lighting context now; a context restore replaces it. */
  private readonly lighting: () => LightingContext;
  /** Whether the owner can draw at all right now (disposed, or context lost). */
  private readonly available: () => boolean;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  /** The half-float square target swatches are drawn into; reused across sizes. */
  private target: THREE.WebGLRenderTarget | null = null;
  /** The reference rig on `scene`, built on first use from the current context. */
  private rig: LightingRig | null = null;
  /** The context `rig` was made from. */
  private rigContext: LightingContext | null = null;
  /** One 2D canvas, reused, that turns read-back pixels into a PNG data URL. */
  private canvas: HTMLCanvasElement | null = null;

  constructor(renderer: THREE.WebGLRenderer, lighting: () => LightingContext, available: () => boolean) {
    this.renderer = renderer;
    this.lighting = lighting;
    this.available = available;
  }

  render(group: THREE.Object3D, size = PREVIEW_SIZE): string | null {
    if (!this.available()) return null;
    // A rig that cannot be renewed (a context restore that failed) is one more
    // failure that answers `null`, not a throw.
    try {
      this.ensureRig();
    } catch {
      return null;
    }
    const target = this.targetOf(size);
    const parent = group.parent;
    const previousTarget = this.renderer.getRenderTarget();
    const previousClear = this.renderer.getClearColor(new THREE.Color());
    const previousAlpha = this.renderer.getClearAlpha();
    this.scene.add(group);
    try {
      this.frameCamera(group);
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      const material = displayMaterial(this.renderer, { map: { value: target.texture } }, 'uniform sampler2D map;', 'texture2D(map, vUv)');
      return this.encode(drawDisplayPass(this.renderer, material, size, size), size);
    } catch {
      // A read-back or context failure is expected on some hosts; the caller
      // falls back to the flat palette chip.
      return null;
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setClearColor(previousClear, previousAlpha);
      this.scene.remove(group);
      parent?.add(group);
    }
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.rig?.dispose();
    this.rig = null;
    this.canvas = null;
    this.scene.clear();
  }

  /**
   * The reference rig the preview scene is lit by, built on first use. A rig
   * whose context was disposed (a context restore replaced it) is dead: its
   * environment went with it, so the next swatch takes a rig from the new one.
   */
  private ensureRig(): void {
    const lighting = this.lighting();
    if (this.rig?.scene === this.scene && this.rigContext === lighting) return;
    this.rig?.dispose();
    this.rig = lighting.createReferenceRig();
    this.rigContext = lighting;
    this.rig.attach(this.scene);
  }

  /**
   * The square target of `size`. Every call honours its own size — the panel
   * asks for more than one — and the target is REUSED when the size repeats,
   * which is the common case of a whole panel of swatches.
   */
  private targetOf(size: number): THREE.WebGLRenderTarget {
    const existing = this.target;
    if (existing) {
      if (existing.width !== size || existing.height !== size) existing.setSize(size, size);
      return existing;
    }
    // Half float and linear: tone mapping happens in the display pass AFTER
    // this one, and an 8-bit target would clip every highlight it rolls off.
    const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: true });
    this.target = target;
    return target;
  }

  /** Frames `group` in the preview camera: centred, with a little air around it. */
  private frameCamera(group: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(group);
    const bounds = box.getSize(SCRATCH_SIZE);
    const center = box.getCenter(SCRATCH_CENTER);
    const maxDim = Math.max(0.3, bounds.x, bounds.y, bounds.z);
    const dist = maxDim * 2.3 + 0.4;
    this.camera.position.set(center.x + dist * 0.62, center.y + dist * 0.42, center.z + dist * 0.62);
    this.camera.lookAt(center.x, center.y - maxDim * 0.04, center.z);
    this.camera.updateProjectionMatrix();
  }

  /**
   * The read-back pixels as a PNG data URL.
   *
   * WebGL reads bottom-up and `ImageData` is top-down, so the rows are copied
   * in reverse. One 2D canvas is kept for the life of the preview: a panel
   * builds a dozen swatches in one task and a canvas each would be churn.
   */
  private encode(pixels: Uint8Array, size: number): string | null {
    // The renderer's OWN document, not the global: a preview built for a
    // viewer mounted into a different document (an iframe embed) must not
    // reach for the host page's. `bun test`'s stub renderer has no
    // `domElement` at all, which doubles as the "no real canvas" guard.
    const ownerDocument = this.renderer.domElement?.ownerDocument;
    if (!ownerDocument) return null;
    const canvas = (this.canvas ??= ownerDocument.createElement('canvas'));
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(size, size);
    const rowBytes = size * 4;
    for (let row = 0; row < size; row += 1) {
      const from = (size - 1 - row) * rowBytes;
      image.data.set(pixels.subarray(from, from + rowBytes), row * rowBytes);
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
