/**
 * The one-capture-per-frame contract of `mainPassOnly`, driven with a fake
 * renderer: the real thing needs a WebGL context, and the only renderer state
 * the gate reads is `getRenderTarget()`.
 */

import { describe, expect, test } from 'bun:test';
import { mainPassOnly } from './mirror-capture.js';

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

/** One rendered frame the way `WebGLRenderer.render` produces it when the scene holds transmissive materials. */
function frame(fake: FakeRenderer, capture: (renderer: FakeRenderer, scene: string, camera: string) => void): void {
  // `renderTransmissionPass` binds its own target, renders the opaque list -
  // which calls `onBeforeRender` on every object in it - and unbinds.
  fake.target = { id: 'transmission' };
  capture(fake, 'scene', 'camera');
  fake.target = null;
  // The main pass: the default framebuffer, the runtime's tone mapping.
  capture(fake, 'scene', 'camera');
}

describe('mainPassOnly', () => {
  test('captures in the main pass, with every argument forwarded', () => {
    const calls: Array<[FakeRenderer, string, string]> = [];
    const fake = renderer();
    const capture = mainPassOnly<FakeRenderer, [string, string]>((r, scene, camera) => {
      calls.push([r, scene, camera]);
    });

    capture(fake, 'scene', 'camera');

    expect(calls).toEqual([[fake, 'scene', 'camera']]);
  });

  test('captures nothing while a render target is bound', () => {
    let calls = 0;
    const fake = renderer();
    fake.target = { id: 'transmission' };
    const capture = mainPassOnly<FakeRenderer, []>(() => {
      calls += 1;
    });

    capture(fake);

    expect(calls).toBe(0);
  });

  test('captures exactly once per frame, not once per pass', () => {
    let calls = 0;
    const fake = renderer();
    const capture = mainPassOnly<FakeRenderer, [string, string]>(() => {
      calls += 1;
    });

    for (let index = 0; index < 3; index += 1) frame(fake, capture);

    expect(calls).toBe(3);
  });

  test('keeps the receiver, so a pass reading `this` still works', () => {
    const seen: unknown[] = [];
    const owner = {
      forceUpdate: true,
      pass: mainPassOnly<FakeRenderer, [], { forceUpdate: boolean }>(function () {
        seen.push(this.forceUpdate);
      }),
    };

    owner.pass(renderer());

    expect(seen).toEqual([true]);
  });
});
