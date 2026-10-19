/**
 * The WebGL launch decision both browser tiers share (`tests/headless-webgl.ts`):
 * which renderer a given environment gets, decided without a GPU — the driver
 * probe is handed in.
 */

import { describe, expect, test } from 'bun:test';
import { headlessWebglLaunch } from '../tests/headless-webgl.js';

const SWIFTSHADER = ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'];
const present = (): boolean => true;
const absent = (): boolean => false;

describe('headlessWebglLaunch', () => {
  test('no knob is SwiftShader in the headless shell', () => {
    expect(headlessWebglLaunch({}, present)).toEqual({ args: SWIFTSHADER });
  });

  test('nvidia with the driver present is ANGLE gl-egl on surfaceless EGL pinned to the NVIDIA vendor, still in the headless shell', () => {
    const launch = headlessWebglLaunch({ JEEX_BROWSER_GPU: 'nvidia', HOME: '/home/someone' }, present);
    expect(launch.channel).toBeUndefined();
    expect(launch.args).toEqual(['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist']);
    expect(launch.env).toMatchObject({
      HOME: '/home/someone',
      EGL_PLATFORM: 'surfaceless',
      __EGL_VENDOR_LIBRARY_FILENAMES: '/usr/share/glvnd/egl_vendor.d/10_nvidia.json',
    });
  });

  test('nvidia without the driver falls back to SwiftShader rather than a path that draws nothing', () => {
    expect(headlessWebglLaunch({ JEEX_BROWSER_GPU: 'nvidia', JEEX_E2E_ANGLE: 'swiftshader' }, absent)).toEqual({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
  });

  test('an unknown value is refused, never silently software', () => {
    expect(() => headlessWebglLaunch({ JEEX_BROWSER_GPU: 'cuda' }, present)).toThrow('JEEX_BROWSER_GPU must be unset, d3d12 or nvidia');
  });
});
