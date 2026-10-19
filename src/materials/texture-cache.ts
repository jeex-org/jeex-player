/**
 * The procedural textures the viewer paints with, and who owns them.
 *
 * Every texture here is CONTENT-ADDRESSED: the key names the finish, the size
 * and the seed, and the same key always draws the same pixels. Two viewers on
 * one page therefore SHOULD share them — a second copy of the same 512 px oak
 * costs GPU memory and buys nothing. What must not be shared is the decision to
 * free them, and that is what this module fixes: the cache is reference
 * counted, `retain()` per `RenderRuntime` and `release()` on its dispose, and
 * only the last holder actually disposes.
 *
 * Anisotropy is the other thing two renderers would fight over. It is a cap,
 * not a preference, so the cache keeps the LOWEST any live holder reported: a
 * texture filtered above a renderer's maximum is undefined behaviour, one
 * filtered below it is merely softer.
 *
 * Everything returns `null` when there is no `document`, so the module is
 * importable from bun tests.
 */

import type * as THREE from 'three';
import { ViewerLibError } from '../shared/errors.js';

/** Anisotropy used before any renderer has reported its capability. */
export const DEFAULT_ANISOTROPY = 8;
/** Hardware caps below 1 and above 16 are not worth honouring. */
const MIN_ANISOTROPY = 1;
const MAX_ANISOTROPY = 16;

export class TextureCache {
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly canvases = new Map<string, HTMLCanvasElement>();
  /** Lowest cap reported by a live holder; `null` while none has reported one. */
  private cap: number | null = null;
  private holders = 0;

  /** The anisotropy new textures are created with. */
  get anisotropy(): number {
    return this.cap ?? DEFAULT_ANISOTROPY;
  }

  /**
   * Reports one renderer's hardware maximum and applies the resulting cap to
   * everything already cached. The LOWEST wins, so no live renderer is ever
   * asked to filter above its own capability.
   */
  reportCapability(value: number): void {
    const capped = Math.max(MIN_ANISOTROPY, Math.min(MAX_ANISOTROPY, Math.round(value)));
    if (this.cap !== null && capped >= this.cap) return;
    this.cap = capped;
    for (const texture of this.textures.values()) {
      texture.anisotropy = capped;
      texture.needsUpdate = true;
    }
  }

  /** The cached texture for `key`, or `null` when nothing has drawn it yet. */
  texture(key: string): THREE.Texture | null {
    return this.textures.get(key) ?? null;
  }

  /** Remembers a texture under `key` and returns it. */
  putTexture(key: string, texture: THREE.Texture): THREE.Texture {
    this.textures.set(key, texture);
    return texture;
  }

  canvas(key: string): HTMLCanvasElement | null {
    return this.canvases.get(key) ?? null;
  }

  putCanvas(key: string, canvas: HTMLCanvasElement): HTMLCanvasElement {
    this.canvases.set(key, canvas);
    return canvas;
  }

  /** How many textures are cached; the disposal test reads it. */
  get size(): number {
    return this.textures.size;
  }

  /** One more holder. Balanced by `release()`. */
  retain(): void {
    this.holders += 1;
  }

  /**
   * One fewer holder; the LAST one frees everything. A release without a
   * matching retain is refused rather than silently dropping the count below
   * zero — that would free textures a live renderer is still drawing with.
   */
  release(): void {
    if (this.holders === 0) throw new ViewerLibError('internal', 'TextureCache: release without a matching retain');
    this.holders -= 1;
    if (this.holders === 0) this.dispose();
  }

  /** Frees and forgets everything, whatever the holder count says. */
  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.canvases.clear();
    this.cap = null;
  }
}

/**
 * The cache the procedural generators draw into.
 *
 * It is process-wide ON PURPOSE, and that is the whole point of the reference
 * count above: `textures.ts`, `finishes.ts` and the asset builders are free
 * functions called from deep inside the object bank, so threading an instance
 * through every one of them would touch a hundred call sites to arrive at a
 * cache whose contents are identical anyway. What was actually broken was
 * OWNERSHIP — one renderer's anisotropy overwriting another's, and a `dispose`
 * freeing textures a sibling was still using — and ownership is what moved.
 */
export const sharedTextureCache = new TextureCache();
