import { afterEach, describe, expect, test } from 'bun:test';
import { debugCamera, debugFlags, debugLightBake } from './debug-flags.js';

const page = globalThis as { __JEEX_DEBUG_FLAGS__?: unknown };

afterEach(() => {
  delete page.__JEEX_DEBUG_FLAGS__;
});

describe('debugFlags', () => {
  test('every switch is off when the page set nothing', () => {
    expect(debugFlags()).toEqual({ noTransmission: false, noArm: false });
  });

  test("reads the page's global", () => {
    page.__JEEX_DEBUG_FLAGS__ = { noTransmission: true };
    expect(debugFlags()).toEqual({ noTransmission: true, noArm: false });
    page.__JEEX_DEBUG_FLAGS__ = { noArm: true };
    expect(debugFlags()).toEqual({ noTransmission: false, noArm: true });
  });

  test('a malformed global turns every switch off', () => {
    for (const source of [null, 'noArm', 1, [], { noArm: 'yes' }, { noTransmission: 1 }]) {
      expect(debugFlags(source), JSON.stringify(source)).toEqual({ noTransmission: false, noArm: false });
    }
  });

  test('unknown keys are ignored', () => {
    expect(debugFlags({ noArm: true, other: 1 })).toEqual({ noTransmission: false, noArm: true });
  });
});

const hooks = globalThis as { __JEEX_DEBUG_LIGHT_BAKE__?: unknown; __JEEX_DEBUG_CAMERA__?: unknown };

describe('debugLightBake', () => {
  afterEach(() => {
    delete hooks.__JEEX_DEBUG_LIGHT_BAKE__;
  });

  test('is off when the page set nothing', () => {
    expect(debugLightBake()).toBeNull();
  });

  test("resolves the page's two URLs against the page", () => {
    hooks.__JEEX_DEBUG_LIGHT_BAKE__ = { sidecar: 'bake/sidecar.json', shell: 'https://cdn.test/s/shell.glb' };
    const source = debugLightBake(undefined, 'https://page.test/dir/index.html');
    expect(source?.sidecarUrl.href).toBe('https://page.test/dir/bake/sidecar.json');
    expect(source?.shellUrl.href).toBe('https://cdn.test/s/shell.glb');
  });

  test('a malformed global is off', () => {
    for (const source of [
      null,
      'x',
      { sidecar: 'a' },
      { sidecar: 1, shell: 'b' },
      { sidecar: '', shell: 'b' },
      { sidecar: 'http://[', shell: 'b' },
    ]) {
      expect(debugLightBake(source, 'https://page.test/'), JSON.stringify(source)).toBeNull();
    }
  });
});

describe('debugCamera', () => {
  afterEach(() => {
    delete hooks.__JEEX_DEBUG_CAMERA__;
  });

  test('is off when the page set nothing', () => {
    expect(debugCamera()).toBeNull();
  });

  test("reads the page's pose", () => {
    hooks.__JEEX_DEBUG_CAMERA__ = { mode: 'walk', position: [1, 1.6, 2], target: [3, 1.5, 2] };
    expect(debugCamera()).toEqual({ mode: 'walk', position: [1, 1.6, 2], target: [3, 1.5, 2] });
  });

  test('a malformed pose is off', () => {
    for (const source of [
      null,
      { mode: 'tour', position: [0, 0, 0], target: [1, 0, 0] },
      { mode: 'orbit', position: [0, 0], target: [1, 0, 0] },
      { mode: 'orbit', position: [0, 0, Number.NaN], target: [1, 0, 0] },
      { mode: 'orbit', position: [0, 0, 0], target: [0, 0, 0] },
    ]) {
      expect(debugCamera(source), JSON.stringify(source)).toBeNull();
    }
  });
});
