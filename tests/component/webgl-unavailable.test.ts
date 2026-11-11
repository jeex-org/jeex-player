/**
 * A viewer in a browser that gives it no WebGL: the boot fails with
 * `webgl-unavailable`, and a `loadScene` afterwards cannot bring a scene up
 * either, so it rejects rather than resolving over the error card.
 *
 * The probe answers once per page (`render/webgl-probe.ts`), so the browser's
 * WebGL is taken away in a file of its own, before any viewer has mounted:
 * `getContext` answers `null` for every WebGL kind, a 2D context still works.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { ViewerError } from '../../src/app/viewer-events.js';
import { closeContainers, demoScene, openContainer } from './support.js';

// The browser's own, called with each canvas as `this` below.
const getContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')!.value as (
  this: HTMLCanvasElement,
  kind: string,
  options?: unknown,
) => RenderingContext | null;
const WEBGL_KINDS: ReadonlySet<string> = new Set(['webgl', 'webgl2', 'experimental-webgl']);

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    kind: string,
    options?: unknown,
  ) {
    return WEBGL_KINDS.has(kind) ? null : getContext.call(this, kind, options);
  } as typeof HTMLCanvasElement.prototype.getContext);
});

afterAll(() => {
  vi.restoreAllMocks();
});

const handles: ViewerHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

describe('a viewer with no WebGL', () => {
  test('ready and a later loadScene reject with webgl-unavailable, and each failure is reported once, fatal', async () => {
    const failures: ViewerError[] = [];
    const handle = mountViewer(openContainer(), { scene: { document: demoScene() }, tour: { mode: 'off' }, debug: false });
    handles.push(handle);
    handle.on('error', (error) => failures.push(error));
    await expect(handle.ready).rejects.toMatchObject({ code: 'webgl-unavailable' });
    await expect(handle.loadScene({ document: demoScene() })).rejects.toMatchObject({ code: 'webgl-unavailable' });
    expect(failures.map((failure) => [failure.code, failure.fatal])).toEqual([
      ['webgl-unavailable', true],
      ['webgl-unavailable', true],
    ]);
  });
});
