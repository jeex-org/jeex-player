import { describe, expect, test } from 'bun:test';
import {
  chevronTexture,
  fabricBumpTexture,
  fabricTexture,
  getTextureAnisotropy,
  plasterTexture,
  planksBumpTexture,
  planksTexture,
  resetTextureCache,
  setTextureAnisotropy,
  skyTexture,
  stripesTexture,
  terrazzoTexture,
  tilesBumpTexture,
  tilesTexture,
  woodGrainBumpTexture,
  woodGrainTexture,
} from './textures.js';

describe('texture generators without a DOM', () => {
  test('every generator returns null when there is no document', () => {
    expect(typeof document).toBe('undefined');
    expect(planksTexture('#b5855a')).toBeNull();
    expect(planksBumpTexture('#b5855a')).toBeNull();
    expect(chevronTexture('#a97b4e')).toBeNull();
    expect(terrazzoTexture('#a7b5a6')).toBeNull();
    expect(tilesTexture('#e9e5dc', '#b8b4aa')).toBeNull();
    expect(tilesBumpTexture()).toBeNull();
    expect(plasterTexture('#b0a294')).toBeNull();
    expect(stripesTexture('#e7ddc8', '#d9cbae')).toBeNull();
    expect(skyTexture('#dcd3c2', '#c6b8a3')).toBeNull();
    expect(fabricTexture('#cdbda2')).toBeNull();
    expect(fabricBumpTexture()).toBeNull();
    expect(woodGrainTexture('#b99a75')).toBeNull();
    expect(woodGrainBumpTexture()).toBeNull();
  });

  test('resetting the cache is safe without a DOM', () => {
    expect(() => resetTextureCache()).not.toThrow();
  });
});

describe('texture quality settings', () => {
  test('anisotropy defaults to 8 and clamps to the hardware range', () => {
    expect(getTextureAnisotropy()).toBe(8);
    setTextureAnisotropy(16);
    expect(getTextureAnisotropy()).toBe(16);
    setTextureAnisotropy(64);
    expect(getTextureAnisotropy()).toBe(16);
    setTextureAnisotropy(0);
    expect(getTextureAnisotropy()).toBe(1);
    setTextureAnisotropy(8);
  });
});
