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
 */

import * as THREE from 'three';

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
  /** Whether the owner can draw at all right now (disposed, or context lost). */
  private readonly available: () => boolean;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  /** The square target swatches are drawn into; reused across sizes. */
  private target: THREE.WebGLRenderTarget | null = null;
  /** One 2D canvas, reused, that turns read-back pixels into a PNG data URL. */
  private canvas: HTMLCanvasElement | null = null;

  constructor(renderer: THREE.WebGLRenderer, available: () => boolean) {
    this.renderer = renderer;
    this.available = available;
  }

  render(group: THREE.Object3D, size = PREVIEW_SIZE): string | null {
    if (!this.available()) return null;
    this.ensureLights();
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
      const pixels = new Uint8Array(size * size * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      return this.encode(pixels, size);
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
    this.canvas = null;
    this.scene.clear();
  }

  /** The three-light rig the preview scene is lit by; built on first use. */
  private ensureLights(): void {
    if (this.scene.children.length > 0) return;
    const ambient = new THREE.AmbientLight('#fff6e6', 1.6);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight('#ffffff', 2.6);
    key.position.set(2.5, 4, 2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#dbe4ff', 0.9);
    fill.position.set(-3, 2, 1);
    this.scene.add(fill);
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
    const target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
    // sRGB on the TEXTURE, so the pixels read back are display-encoded, as a
    // canvas would hand them over.
    target.texture.colorSpace = THREE.SRGBColorSpace;
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
