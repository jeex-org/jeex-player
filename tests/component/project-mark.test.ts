/**
 * The producer's mark (`src/ui/project-mark.ts`): a project whose
 * manifest carries `mark` shows «Made with JEEX» whatever the host asked for,
 * and a project without one, or a bare scene, shows nothing.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { PROJECT_MARK_NAME } from '../../src/ui/project-mark.js';
import { closeContainers, demoScene, openContainer } from './support.js';

const PROJECT_URL = '/tests/fixtures/project/project.json';
const PROJECT_BASE = new URL('/tests/fixtures/project/', window.location.origin).href;
const OWNERS = 'https://jeex.org/owners';
/** One bake build per case on a shared software GPU: well past the default. */
const PROJECT_TIMEOUT_MS = 180_000;

const handles: ViewerHandle[] = [];

async function fixture(mark?: { href: string }): Promise<{ manifest: unknown; scene: unknown }> {
  const manifest = (await (await fetch(PROJECT_URL)).json()) as { scene: string };
  const scene = (await (await fetch(new URL(manifest.scene, PROJECT_BASE).href)).json()) as unknown;
  return { manifest: mark === undefined ? manifest : { ...manifest, mark }, scene };
}

async function mounted(options: Record<string, unknown>): Promise<{ handle: ViewerHandle; container: HTMLElement }> {
  const container = openContainer();
  const handle = mountViewer(container, { tour: { mode: 'off' }, debug: false, ...options });
  handles.push(handle);
  await handle.ready;
  return { handle, container };
}

const markOf = (container: HTMLElement): HTMLAnchorElement | null =>
  container.querySelector<HTMLAnchorElement>(`[data-jeex="${PROJECT_MARK_NAME}"]`);

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

describe('the producer mark', () => {
  test(
    'a manifest that asks for it gets it, through every option that hides chrome',
    async () => {
      const { manifest, scene } = await fixture({ href: OWNERS });
      const { container } = await mounted({
        scene: { document: scene, library: { manifest, baseUrl: PROJECT_BASE } },
        readonly: true,
        overlay: 'kiosk',
        chrome: { brand: false, controls: false, status: false, modeSwitcher: false, hint: false },
      });
      const mark = markOf(container);
      expect(mark).not.toBeNull();
      expect(mark!.href).toBe(OWNERS);
      expect(mark!.textContent).toBe('Made with JEEX');
      expect(mark!.target).toBe('_blank');
      expect(mark!.rel).toBe('noopener noreferrer');
      // No `part`: a host's `::part()` cannot style it away.
      expect(mark!.hasAttribute('part')).toBe(false);
      // Small and non-blocking: on screen, a corner of the viewport, nowhere near its centre.
      const box = mark!.getBoundingClientRect();
      const viewport = container.getBoundingClientRect();
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeLessThan(32);
      expect(box.right).toBeLessThan(viewport.left + viewport.width / 2);
      expect(box.bottom).toBeLessThan(viewport.top + viewport.height / 2);
      expect(getComputedStyle(mark!).visibility).toBe('visible');
    },
    PROJECT_TIMEOUT_MS,
  );

  test(
    'on a narrow viewer with all its chrome it stays clear of the control bar',
    async () => {
      const { manifest, scene } = await fixture({ href: OWNERS });
      const container = openContainer(360, 640);
      const handle = mountViewer(container, {
        tour: { mode: 'off' },
        debug: false,
        scene: { document: scene, library: { manifest, baseUrl: PROJECT_BASE } },
        chrome: { autoHide: false },
      });
      handles.push(handle);
      await handle.ready;
      const mark = markOf(container)!.getBoundingClientRect();
      const bar = container.querySelector<HTMLElement>('[data-jeex="control-bar"]')!.getBoundingClientRect();
      expect(bar.height).toBeGreaterThan(0);
      const overlaps = mark.left < bar.right && bar.left < mark.right && mark.top < bar.bottom && bar.top < mark.bottom;
      expect(overlaps, `mark ${JSON.stringify(mark)} against bar ${JSON.stringify(bar)}`).toBe(false);
    },
    PROJECT_TIMEOUT_MS,
  );

  test(
    'speaks the viewer’s language',
    async () => {
      const { manifest, scene } = await fixture({ href: OWNERS });
      const { container } = await mounted({ scene: { document: scene, library: { manifest, baseUrl: PROJECT_BASE } }, locale: 'ru' });
      expect(markOf(container)?.textContent).toBe('Сделано в JEEX');
    },
    PROJECT_TIMEOUT_MS,
  );

  test(
    'a project without it, and a bare scene, show none',
    async () => {
      const { manifest, scene } = await fixture();
      const { container } = await mounted({ scene: { document: scene, library: { manifest, baseUrl: PROJECT_BASE } } });
      expect(markOf(container)).toBeNull();
      const bare = await mounted({ scene: { document: demoScene() } });
      expect(markOf(bare.container)).toBeNull();
    },
    PROJECT_TIMEOUT_MS,
  );

  test(
    'a scene swap to a project without one takes the mark away',
    async () => {
      const { manifest, scene } = await fixture({ href: OWNERS });
      const { handle, container } = await mounted({ scene: { document: scene, library: { manifest, baseUrl: PROJECT_BASE } } });
      expect(markOf(container)).not.toBeNull();
      await handle.loadScene({ document: demoScene() });
      expect(markOf(container)).toBeNull();
    },
    PROJECT_TIMEOUT_MS,
  );
});
