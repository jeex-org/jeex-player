/**
 * The cache's job is OWNERSHIP, not caching: the map itself is a map. What has
 * to hold is that no viewer frees a texture a sibling is still drawing with,
 * and that no renderer is asked to filter above its own hardware maximum.
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_ANISOTROPY, TextureCache } from './texture-cache.js';

/** A `THREE.Texture` as far as this module is concerned. */
function fakeTexture(): { anisotropy: number; needsUpdate: boolean; disposed: number; dispose(): void } {
  const texture = {
    anisotropy: 0,
    needsUpdate: false,
    disposed: 0,
    dispose(): void {
      texture.disposed += 1;
    },
  };
  return texture;
}

type Fake = ReturnType<typeof fakeTexture>;

function put(cache: TextureCache, key: string): Fake {
  const texture = fakeTexture();
  cache.putTexture(key, texture as unknown as Parameters<TextureCache['putTexture']>[1]);
  return texture;
}

describe('reference counting', () => {
  test('the last holder frees everything; an earlier one frees nothing', () => {
    const cache = new TextureCache();
    cache.retain();
    cache.retain();
    const oak = put(cache, 'oak');

    cache.release();
    expect(oak.disposed).toBe(0);
    expect(cache.size).toBe(1);

    cache.release();
    expect(oak.disposed).toBe(1);
    expect(cache.size).toBe(0);
  });

  test('a release without a retain throws instead of freeing a live texture', () => {
    const cache = new TextureCache();
    const oak = put(cache, 'oak');
    expect(() => cache.release()).toThrow('release without a matching retain');
    expect(oak.disposed).toBe(0);
  });

  test('a cache that was fully released can be filled and freed again', () => {
    const cache = new TextureCache();
    cache.retain();
    put(cache, 'oak');
    cache.release();
    cache.retain();
    const second = put(cache, 'oak');
    cache.release();
    expect(second.disposed).toBe(1);
  });

  test('two caches are independent', () => {
    const first = new TextureCache();
    const second = new TextureCache();
    first.retain();
    second.retain();
    const mine = put(first, 'oak');
    put(second, 'oak');
    second.release();
    expect(mine.disposed).toBe(0);
    expect(first.texture('oak')).not.toBeNull();
  });
});

describe('anisotropy', () => {
  test('starts at the default until a renderer reports a capability', () => {
    expect(new TextureCache().anisotropy).toBe(DEFAULT_ANISOTROPY);
  });

  test('the LOWEST reported cap wins, whichever order they arrive in', () => {
    const cache = new TextureCache();
    cache.reportCapability(16);
    expect(cache.anisotropy).toBe(16);
    cache.reportCapability(4);
    expect(cache.anisotropy).toBe(4);
    // A more capable renderer joining must not raise the cap above the weaker
    // one's maximum: filtering above a renderer's own limit is undefined.
    cache.reportCapability(16);
    expect(cache.anisotropy).toBe(4);
  });

  test('a new cap is applied to everything already cached', () => {
    const cache = new TextureCache();
    cache.reportCapability(16);
    const oak = put(cache, 'oak');
    oak.anisotropy = 16;
    cache.reportCapability(2);
    expect(oak.anisotropy).toBe(2);
    expect(oak.needsUpdate).toBe(true);
  });

  test('a reported cap is clamped into the range the hardware can mean', () => {
    const low = new TextureCache();
    low.reportCapability(0);
    expect(low.anisotropy).toBe(1);
    const high = new TextureCache();
    high.reportCapability(64);
    expect(high.anisotropy).toBe(16);
  });
});

describe('canvases', () => {
  test('a cached noise tile comes back by key and is forgotten on dispose', () => {
    const cache = new TextureCache();
    const tile = {} as HTMLCanvasElement;
    expect(cache.canvas('grain')).toBeNull();
    expect(cache.putCanvas('grain', tile)).toBe(tile);
    expect(cache.canvas('grain')).toBe(tile);
    cache.dispose();
    expect(cache.canvas('grain')).toBeNull();
  });
});
