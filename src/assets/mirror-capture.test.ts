/**
 * The one-capture-per-frame contract of `mainPassOnly`, driven with a fake
 * renderer: the real thing needs a WebGL context, and the only state the gate
 * reads is `getRenderTarget()` and the beauty-pass scope (`shared/scene-pass.ts`).
 */

import { describe, expect, test } from 'bun:test';
import { mainPassOnly } from './mirror-capture.js';
import { withScenePass } from '../shared/scene-pass.js';

type FakeTarget = { readonly id: string };
type FakeRenderer = { target: FakeTarget | null; getRenderTarget(): FakeTarget | null };

function renderer(): FakeRenderer {
  return {
    target: null,
    getRenderTarget(): FakeTarget | null {
      return this.target;
    },
  };
}

const SCENE = 'scene';
const CAMERA = 'camera';
const COMPOSER: FakeTarget = { id: 'composer read buffer' };

/** A gate that counts its captures. */
function counted(): { capture: (renderer: FakeRenderer, scene: string, camera: string) => void; calls: () => number } {
  let calls = 0;
  const capture = mainPassOnly<FakeRenderer, string, string, []>(() => {
    calls += 1;
  });
  return { capture, calls: () => calls };
}

/**
 * One rendered frame the way `WebGLRenderer.render` produces it when the scene
 * holds transmissive materials, inside the beauty-pass scope its drawer sets.
 */
function frame(
  fake: FakeRenderer,
  beauty: FakeTarget | null,
  capture: (renderer: FakeRenderer, scene: string, camera: string) => void,
): void {
  withScenePass(fake, { target: beauty, scene: SCENE, camera: CAMERA }, () => {
    // `renderTransmissionPass` binds its own target, renders the opaque list -
    // which calls `onBeforeRender` on every object in it - and unbinds.
    fake.target = { id: 'transmission' };
    capture(fake, SCENE, CAMERA);
    fake.target = beauty;
    capture(fake, SCENE, CAMERA);
  });
}

describe('mainPassOnly', () => {
  test('captures in the beauty pass, with every argument forwarded', () => {
    const calls: Array<[FakeRenderer, string, string]> = [];
    const fake = renderer();
    const capture = mainPassOnly<FakeRenderer, string, string, []>((r, scene, camera) => {
      calls.push([r, scene, camera]);
    });

    withScenePass(fake, { target: null, scene: SCENE, camera: CAMERA }, () => capture(fake, SCENE, CAMERA));

    expect(calls).toEqual([[fake, SCENE, CAMERA]]);
  });

  test('captures nothing without a scope, even on the screen (an inset preview, a swatch)', () => {
    const { capture, calls } = counted();
    const fake = renderer();

    capture(fake, SCENE, 'preview camera');
    capture(fake, SCENE, CAMERA);

    expect(calls()).toBe(0);
  });

  test('captures nothing on the screen when the camera is not the scope camera (null-target inset preview)', () => {
    const { capture, calls } = counted();
    const fake = renderer();

    withScenePass(fake, { target: null, scene: SCENE, camera: CAMERA }, () => capture(fake, SCENE, 'preview camera'));

    expect(calls()).toBe(0);
  });

  test('captures nothing for another scene', () => {
    const { capture, calls } = counted();
    const fake = renderer();

    withScenePass(fake, { target: null, scene: SCENE, camera: CAMERA }, () => capture(fake, 'swatch scene', CAMERA));

    expect(calls()).toBe(0);
  });

  test('captures nothing while the transmission or the occlusion-input target is bound', () => {
    const { capture, calls } = counted();
    const fake = renderer();

    withScenePass(fake, { target: COMPOSER, scene: SCENE, camera: CAMERA }, () => {
      fake.target = { id: 'transmission' };
      capture(fake, SCENE, CAMERA);
      fake.target = { id: 'occlusion normals and depth' };
      capture(fake, SCENE, CAMERA);
    });

    expect(calls()).toBe(0);
  });

  test('captures exactly once per frame, on the screen and in the walk chain alike', () => {
    const { capture, calls } = counted();
    const fake = renderer();

    for (let index = 0; index < 3; index += 1) frame(fake, null, capture);
    expect(calls()).toBe(3);

    for (let index = 0; index < 3; index += 1) frame(fake, COMPOSER, capture);
    expect(calls()).toBe(6);
  });

  test('keeps the receiver, so a pass reading `this` still works', () => {
    const seen: unknown[] = [];
    const fake = renderer();
    const owner = {
      forceUpdate: true,
      pass: mainPassOnly<FakeRenderer, string, string, [], { forceUpdate: boolean }>(function () {
        seen.push(this.forceUpdate);
      }),
    };

    withScenePass(fake, { target: null, scene: SCENE, camera: CAMERA }, () => owner.pass(fake, SCENE, CAMERA));

    expect(seen).toEqual([true]);
  });
});
