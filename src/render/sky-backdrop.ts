/**
 * The 3D backdrop one runtime OWNS: the soft sky gradient behind the model in
 * 360 and in the first frames, repainted in place when the host's theme
 * changes.
 *
 * It is deliberately not the shared procedural-texture cache
 * (`materials/texture-cache.ts`): that cache frees everything at once, and two
 * viewers with the same colours would share one texture object, so neither
 * could repaint or free its own. Repainting the SAME texture object is also
 * what keeps walk and tour right: `HdriSky` saves the background it replaces
 * and puts it back on the way out, so a theme change made while the HDRI is
 * up lands in that saved texture and shows on the return to 360, without the
 * HDRI being touched.
 *
 * `null` texture when there is no 2D canvas (`createCanvas2D`), so the runtime
 * stays constructible under `bun test`.
 */

import * as THREE from 'three';
import { createCanvas2D, type Canvas2D } from '../materials/canvas-2d.js';
import { getTextureAnisotropy, paintSky, SKY_SIZE } from '../materials/textures.js';

/**
 * The sky walk and tour light the rooms with, whatever the host's theme: it is a light source there, not chrome.
 * A neutral grey (it was a warm sand): the rooms take no tint from it.
 */
export const DAYLIGHT_SKY = { top: '#d4d4d4', horizon: '#b9b9b9' } as const;

export class SkyBackdrop {
  /** The texture to set as `scene.background`; the same object for this backdrop's whole life. */
  readonly texture: THREE.Texture | null;
  private readonly surface: Canvas2D | null;

  constructor(top: string, horizon: string) {
    this.surface = createCanvas2D(SKY_SIZE);
    if (!this.surface) {
      this.texture = null;
      return;
    }
    paintSky(this.surface.ctx, SKY_SIZE, top, horizon);
    const texture = new THREE.CanvasTexture(this.surface.canvas);
    // A colour map, authored in sRGB; clamped, because the gradient must not wrap.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = getTextureAnisotropy();
    this.texture = texture;
  }

  /** Repaints the gradient with new colours; the texture object stays the one already on the scene. */
  repaint(top: string, horizon: string): void {
    if (!this.surface || !this.texture) return;
    this.surface.ctx.clearRect(0, 0, SKY_SIZE, SKY_SIZE);
    paintSky(this.surface.ctx, SKY_SIZE, top, horizon);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture?.dispose();
  }
}
