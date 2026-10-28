/**
 * The quality option end to end in a real browser: the element's attribute at
 * mount, the live attribute flip that retunes the drawing buffer WITHOUT a
 * reload, the ES object path, and the debug readout.
 *
 * The drawing buffer follows the cap only where the display's own ratio sits
 * ABOVE it, so this file pins the measured ratio at 2: the high tier's buffer
 * is the CSS box times 1.7 and the low tier's times 1.25, whatever display
 * the runner happens to have. The box observer is mocked out with it — the
 * runtime then sizes from `devicePixelRatioOf()` alone.
 *
 * One demo mount costs a geometry build; the file asks for the two-mount
 * budget (`element.test.ts`'s note).
 */

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import { defineJeexViewer, DEFAULT_TAG } from '../../src/embed/element.js';
import type { JeexViewerElement } from '../../src/embed/element.js';
import { closeContainers, demoScene, openContainer, until } from './support.js';

vi.mock('../../src/render/viewport-box.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/viewport-box.js')>();
  return { ...actual, devicePixelRatioOf: () => 2, watchPixelRatio: () => undefined, observeBox: () => null };
});

const MOUNT_TIMEOUT_MS = 90_000;

const urls: string[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  for (const container of containers.splice(0)) {
    container.querySelector('jeex-viewer')?.remove();
    container.remove();
  }
  for (const url of urls.splice(0)) URL.revokeObjectURL(url);
  closeContainers();
});

function sceneUrl(): string {
  const blob = new Blob([JSON.stringify(demoScene())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  urls.push(url);
  return url;
}

/** A connected element with the given attributes. */
function place(attributes: Record<string, string>): JeexViewerElement {
  const element = document.createElement(DEFAULT_TAG);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  const container = openContainer();
  containers.push(container);
  container.appendChild(element);
  return element;
}

/** The drawing buffer's ratio over the canvas's CSS width. */
function bufferRatio(root: HTMLElement): number {
  const canvas = root.querySelector('canvas');
  if (!canvas) throw new Error('no canvas yet');
  return canvas.width / canvas.clientWidth;
}

beforeAll(() => {
  defineJeexViewer();
});

describe('the quality option', () => {
  test(
    'the element mounts on the pinned low tier, the live attribute retunes both ways, and nothing reloads',
    async () => {
      const element = place({ src: sceneUrl(), tour: 'off', quality: 'low' });
      await element.viewer!.ready;
      const root = element.viewer!.element;
      const canvas = root.querySelector('canvas')!;
      expect(window.__viewerDebug!.quality()).toEqual({ mode: 'fixed', tier: 'low' });
      expect(bufferRatio(root)).toBeCloseTo(1.25, 2);

      // The live flip: the cap retunes, the drawing buffer follows, and the
      // document on screen is the SAME one — no reload, no re-mount.
      const readyAt = window.__viewerReadyAt;
      element.setAttribute('quality', 'high');
      await until(() => bufferRatio(root) > 1.5, 'the higher cap');
      expect(window.__viewerDebug!.quality()).toEqual({ mode: 'fixed', tier: 'high' });
      expect(bufferRatio(root)).toBeCloseTo(1.7, 2);
      expect(root.querySelector('canvas')).toBe(canvas);
      expect(window.__viewerReadyAt).toBe(readyAt);

      element.setAttribute('quality', 'low');
      await until(() => Math.abs(bufferRatio(root) - 1.25) < 0.01, 'the lower cap again');
      // Removing the attribute is the default: the machine, armed and on high.
      element.removeAttribute('quality');
      await until(() => window.__viewerDebug!.quality().mode === 'auto', 'the auto mode');
      expect(window.__viewerDebug!.quality().tier).toBe('high');
      expect(root.querySelector('canvas')).toBe(canvas);
    },
    MOUNT_TIMEOUT_MS,
  );

  test(
    'mountViewer takes the tier as an object option and the debug surface answers for it',
    async () => {
      const container = openContainer();
      const handle = mountViewer(container, {
        scene: { repository: new InlineSceneRepository(demoScene()) },
        tour: { mode: 'off' },
        quality: 'low',
      });
      await handle.ready;
      expect(window.__viewerDebug!.quality()).toEqual({ mode: 'fixed', tier: 'low' });
      expect(bufferRatio(handle.element)).toBeCloseTo(1.25, 2);
      handle.setQuality('high');
      await until(() => bufferRatio(handle.element) > 1.5, 'the higher cap');
      expect(window.__viewerDebug!.quality()).toEqual({ mode: 'fixed', tier: 'high' });
      handle.dispose();
    },
    MOUNT_TIMEOUT_MS,
  );
});
