import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { RoomSampler } from './room-sampler.js';
import { walkUniformsFor } from './box-probe-patch.js';

/**
 * A renderer as WebGL2 reads a float colour buffer back: only the pair
 * RGBA/FLOAT is guaranteed. RGBA/HALF_FLOAT is an implementation-defined
 * extra that desktop ANGLE grants and many Android drivers do not; there
 * `readPixels` raises INVALID_OPERATION and leaves the buffer as it was.
 * A granted read holds neutral greys, from dark to light, as a matte white
 * room under white light would.
 */
function guaranteedPairRenderer(): THREE.WebGLRenderer {
  let target: THREE.WebGLRenderTarget | null = null;
  const RGBA = 0x1908;
  const FLOAT = 0x1406;
  const INVALID_OPERATION = 0x0502;
  let error = 0;
  const gl = {
    RGBA,
    FLOAT,
    NO_ERROR: 0,
    getError: () => {
      const last = error;
      error = 0;
      return last;
    },
    readPixels: (_x: number, _y: number, _w: number, _h: number, format: number, type: number, buffer: ArrayBufferView) => {
      if (format !== RGBA || type !== FLOAT || !(buffer instanceof Float32Array)) {
        error = INVALID_OPERATION;
        return;
      }
      for (let i = 0; i < buffer.length; i += 4) buffer.fill((i / 4 + 1) / (buffer.length / 4), i, i + 3);
    },
  };
  const stub = {
    isWebGLRenderer: true,
    coordinateSystem: THREE.WebGLCoordinateSystem,
    autoClear: true,
    xr: { enabled: false },
    state: { buffers: { depth: { getReversed: () => false } } },
    getContext: () => gl,
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
    },
    render: () => {},
    clearDepth: () => {},
    // three reads with the target's own type (HALF_FLOAT here): the driver refuses it.
    readRenderTargetPixels: () => {
      error = INVALID_OPERATION;
    },
  };
  return stub as unknown as THREE.WebGLRenderer;
}

describe('RoomSampler', () => {
  test('reads the room back with the pair every WebGL2 float buffer grants, so a phone measures the light too', () => {
    const scene = new THREE.Scene();
    const sampler = new RoomSampler(walkUniformsFor(scene));

    const light = sampler.sample(guaranteedPairRenderer(), scene, { x: 0, y: 1.2, z: 0 });

    expect(light).not.toBeNull();
    expect(light!.white.map((value) => Number(value.toFixed(6)))).toEqual([1, 1, 1]);
    expect(light!.level).toBeGreaterThan(0);
    sampler.dispose();
  });
});

describe('RoomSampler when the read is refused', () => {
  test('measures nothing, so the room keeps the fixed balance', () => {
    const scene = new THREE.Scene();
    const sampler = new RoomSampler(walkUniformsFor(scene));
    const renderer = guaranteedPairRenderer();
    const gl = renderer.getContext() as unknown as { readPixels: () => void };
    gl.readPixels = () => {};

    expect(sampler.sample(renderer, scene, { x: 0, y: 1.2, z: 0 })).toBeNull();
    sampler.dispose();
  });
});
