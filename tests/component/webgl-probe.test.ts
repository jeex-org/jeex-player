/**
 * The WebGL support probe on a real context: it takes the context on the
 * viewer's own canvas, and the default renderer then runs on that same
 * context, with the attributes it would have chosen on a fresh canvas.
 *
 * Its own file on purpose: the probe is memoised once per page, so only a
 * page where nothing has probed yet can watch the first probe happen.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { createRenderRuntime, type RenderRuntime } from '../../src/render/render-runtime.js';
import { hasWebGL } from '../../src/render/webgl-probe.js';
import { closeContainers, openContainer } from './support.js';

const runtimes: RenderRuntime[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  closeContainers();
});

function runtimeOn(canvas: HTMLCanvasElement): RenderRuntime {
  const container = openContainer(64, 64);
  container.appendChild(canvas);
  const runtime = createRenderRuntime({
    canvas,
    viewport: { clientWidth: 64, clientHeight: 64, element: container },
    scheduleFrame: () => 0,
    cancelFrame: () => undefined,
  });
  runtimes.push(runtime);
  return runtime;
}

describe('hasWebGL', () => {
  test('the default renderer takes over the probed context, with the attributes it asks a fresh canvas for', () => {
    const probed = document.createElement('canvas');
    expect(hasWebGL(probed)).toBe(true);
    const context = probed.getContext('webgl2');
    expect(context).not.toBeNull();

    const onProbed = runtimeOn(probed);
    // One context on the canvas: the probe's, now the renderer's.
    expect(onProbed.renderer.getContext()).toBe(context);

    // The probe is memoised: this canvas is not probed, so three makes the
    // context itself, with the attributes `defaultRenderer` chooses. The
    // probe must have asked for exactly those, or it would have won silently.
    const fresh = runtimeOn(document.createElement('canvas'));
    expect(onProbed.renderer.getContext().getContextAttributes()).toEqual(fresh.renderer.getContext().getContextAttributes());
  });
});
