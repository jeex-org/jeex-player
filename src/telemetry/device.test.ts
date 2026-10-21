import { describe, expect, test } from 'bun:test';
import { gpuClass, type GpuProbe } from './device.js';

const probe = (textureSize: number, samples: number, floatColour: boolean): GpuProbe => ({
  getParameter: (name) => (name === 0x0d33 ? textureSize : name === 0x8d57 ? samples : null),
  getExtension: (name) => (name === 'EXT_color_buffer_float' && floatColour ? {} : null),
});

describe('gpuClass', () => {
  test('no context is none, WebGL 1 or a small texture limit is low', () => {
    expect(gpuClass(null, true)).toBe('none');
    expect(gpuClass(probe(16_384, 8, true), false)).toBe('low');
    expect(gpuClass(probe(4096, 4, true), true)).toBe('low');
  });

  test('high needs all three capabilities', () => {
    expect(gpuClass(probe(16_384, 4, true), true)).toBe('high');
    expect(gpuClass(probe(32_768, 8, true), true)).toBe('high');
    expect(gpuClass(probe(16_384, 2, true), true)).toBe('mid');
    expect(gpuClass(probe(16_384, 8, false), true)).toBe('mid');
    expect(gpuClass(probe(8192, 8, true), true)).toBe('mid');
  });
});
