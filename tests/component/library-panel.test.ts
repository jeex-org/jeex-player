/**
 * The built-in finish panel over a project library, on a real WebGL2 context:
 * a floor picked in the library bake offers its plank scan first, picking it
 * commits the explicit `set_material` for that one room, and the floor
 * repaints with the scan.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { ViewerEditRequest } from '../../src/app/viewer-events.js';
import { LIBRARY_PROJECT_FIXTURE } from '../fixtures/project/fixture-ids.js';
import { closeContainers, nextFrame, openContainer, until, untilCameraStill } from './support.js';

const PROJECT_URL = '/tests/fixtures/project-library/project.json';
const SCAN = LIBRARY_PROJECT_FIXTURE.material.scan;
const handles: ViewerHandle[] = [];

/** Points of the lower half a floor is likely to be under. */
const PROBES = [
  [0.5, 0.78],
  [0.35, 0.72],
  [0.65, 0.72],
  [0.5, 0.65],
  [0.25, 0.62],
  [0.75, 0.62],
  [0.5, 0.88],
] as const;

/** A mount, a frame-counted settle and the probe at a loaded tier's frame rate. */
const PROBE_TIMEOUT_MS = 180_000;

let pointerId = 1700;

function mount(edits: 'local' | 'emit'): { container: HTMLElement; handle: ViewerHandle; sent: ViewerEditRequest[] } {
  const container = openContainer();
  const handle = mountViewer(container, { scene: { url: PROJECT_URL }, tour: { mode: 'off' }, debug: true, analytics: 'off', edits });
  handles.push(handle);
  const sent: ViewerEditRequest[] = [];
  handle.on('edit', (edit) => sent.push(edit));
  return { container, handle, sent };
}

function panelOf(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>('[data-jeex="finish-panel"]');
  if (!panel) throw new Error('no panel');
  return panel;
}

/** Clicks probe points until a FLOOR finish panel is open; answers the room it is for. */
async function openFloorPanel(container: HTMLElement): Promise<string> {
  const canvas = container.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
  await untilCameraStill('the presentation camera to settle before the probe');
  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (const [fx, fy] of PROBES) {
      const box = canvas.getBoundingClientRect();
      const [x, y] = [box.left + box.width * fx, box.top + box.height * fy];
      const id = (pointerId += 1);
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: id, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, pointerId: id, bubbles: true }));
      canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, button: 0, bubbles: true }));
      await nextFrame();
      await nextFrame();
      const panel = panelOf(container);
      if (panel.dataset['open'] === 'true' && panel.dataset['kind'] === 'finish' && panel.dataset['surface'] === 'floor') {
        return panel.dataset['owner']!;
      }
    }
  }
  throw new Error('no probe point opened the floor finish panel');
}

/** The swatch of the scan in the open panel. */
function scanSwatch(container: HTMLElement): HTMLElement {
  const swatches = [...panelOf(container).querySelectorAll<HTMLElement>('[data-finish]')];
  expect(swatches[0]?.dataset['finish']).toBe(SCAN);
  return swatches[0]!;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

describe('the finish panel over a project library', () => {
  test(
    'offers the scan first on a floor, and picking it sends the explicit operation for that room',
    async () => {
      const { container, handle, sent } = mount('emit');
      await handle.ready;
      const room = await openFloorPanel(container);
      scanSwatch(container).click();
      await until(() => sent.length > 0, 'the edit event');
      expect(sent[0]!.ops).toEqual([{ op: 'set_material', surface: 'floor', room, material: SCAN }]);
    },
    PROBE_TIMEOUT_MS,
  );

  test(
    'picking it commits and the floor repaints with the scan',
    async () => {
      const { container, handle } = mount('local');
      await handle.ready;
      const room = await openFloorPanel(container);
      const before = handle.getState().rev;
      scanSwatch(container).click();
      await until(() => handle.getState().rev > before, 'the commit');
      expect(handle.getScene()?.finishes?.rooms?.[room]?.floor).toBe(SCAN);
      const floor = `floor-${room}`;
      await until(() => (window.__viewerDebug?.surfaceMaterial(floor)?.maps.length ?? 0) > 0, 'the scan’s maps on the floor');
      expect(window.__viewerDebug?.surfaceMaterial(floor)?.maps).toContain('map');
    },
    PROBE_TIMEOUT_MS,
  );
});
