/**
 * `options.edits` end to end, on a real WebGL2 context: what a click on the
 * scene does to the DOCUMENT in each of the three modes.
 *
 * The unit tier already proves the two seams in isolation
 * (`src/app/viewer-editor.test.ts`); what only a browser can prove is that the
 * PANEL is still the same panel in `'emit'` — it opens, it answers, and the
 * revision does not move — and that `'off'` opens nothing while `select` still
 * reports.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { ViewerEditRequest, ViewerSceneInfo } from '../../src/app/viewer-events.js';
import type { ViewerSelection } from '../../src/app/selection.js';
import { closeContainers, demoScene, delay, nextFrame, openContainer, until, untilCameraStill } from './support.js';

const handles: ViewerHandle[] = [];

type Mounted = {
  container: HTMLElement;
  handle: ViewerHandle;
  edits: ViewerEditRequest[];
  selections: ViewerSelection[];
  /** Every document that reached the screen, so a test can say WHO changed it. */
  scenes: ViewerSceneInfo[];
};

function mount(options: Record<string, unknown>): Mounted {
  const container = openContainer();
  const handle = mountViewer(container, {
    scene: { repository: new InlineSceneRepository(demoScene()) },
    tour: { mode: 'off' },
    debug: false,
    ...options,
  });
  handles.push(handle);
  const edits: ViewerEditRequest[] = [];
  const selections: ViewerSelection[] = [];
  const scenes: ViewerSceneInfo[] = [];
  handle.on('edit', (edit) => edits.push(edit));
  handle.on('select', (selection) => selections.push(selection));
  handle.on('scene', (info) => scenes.push(info));
  return { container, handle, edits, selections, scenes };
}

function canvasOf(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
  if (!canvas) throw new Error('no scene canvas');
  return canvas;
}

let pointerId = 700;

/** Points of the lower half a floor is likely to be under; see `openFinishPanel`. */
const PROBES = [
  [0.5, 0.78],
  [0.35, 0.72],
  [0.65, 0.72],
  [0.5, 0.65],
  [0.25, 0.62],
  [0.75, 0.62],
  [0.5, 0.88],
] as const;

/**
 * One click on a point of the canvas.
 *
 * The `click` at the end is not decoration: `camera-input.ts` raises its `tap`
 * gesture from the CLICK event, not from `pointerup`, and a browser synthesises
 * a click only for real input. Without it the pointer pair reaches
 * `app/selection.ts` (which listens for itself) and never reaches the rig, so
 * the editor's own pick path never runs at all.
 */
function clickAt(canvas: HTMLCanvasElement, x: number, y: number): void {
  const id = (pointerId += 1);
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: id, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, pointerId: id, bubbles: true }));
  canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, button: 0, bubbles: true }));
}

/** A click on each probe point, for the mode that must open nothing anywhere. */
async function clickEveryProbe(container: HTMLElement): Promise<void> {
  const canvas = canvasOf(container);
  const box = canvas.getBoundingClientRect();
  for (const [fx, fy] of PROBES) {
    clickAt(canvas, box.left + box.width * fx, box.top + box.height * fy);
    await delay(80);
  }
}

/** A mount, a frame-counted settle and the probe at the loaded tier's 1-2 fps: past the 60 s default. */
const PROBE_TIMEOUT_MS = 180_000;

/** Sweeps of the probe points over a settled camera before the panel counts as never opening. */
const FINISH_PANEL_SWEEPS = 2;

/**
 * Clicks until the FINISH panel is open, and answers where it was clicked.
 *
 * WHAT the presentation camera frames in the middle of the demo apartment is
 * not this test's subject and is not stable enough to assume: a click can land
 * on furniture (another panel), on a door (the HUD) or on nothing at all. The
 * probe walks a few points of the lower half — where a floor is — and stops at
 * the first that opens the panel this test is about.
 *
 * `ready` means the first frame, not the settled camera: the fit follows the
 * canvas size over the next frames, and with four files sharing one
 * SwiftShader those frames are seconds apart (on a loaded machine without a
 * usable GPU a 15 s wall-clock sweep budget ran out twice).
 * So the probe first waits for the camera to hold its pose, counted in
 * frames, and only then sweeps — a fixed number of times, two rendered frames
 * after each click. No click opens anything but a panel here, so the second
 * sweep changes nothing the tests assert.
 */
async function openFinishPanel(container: HTMLElement): Promise<void> {
  const canvas = canvasOf(container);
  await untilCameraStill('the presentation camera to settle before the probe');
  for (let sweep = 0; sweep < FINISH_PANEL_SWEEPS; sweep += 1) {
    for (const [fx, fy] of PROBES) {
      const box = canvas.getBoundingClientRect();
      clickAt(canvas, box.left + box.width * fx, box.top + box.height * fy);
      await nextFrame();
      await nextFrame();
      if (panelOpen(container) && panelOf(container).dataset['kind'] === 'finish') return;
    }
  }
  throw new Error(`no probe point opened the finish panel in ${FINISH_PANEL_SWEEPS} sweeps over a settled camera`);
}

/** The viewer's own panel, by the machine-readable state `selection-panel.ts` writes. */
function panelOf(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>('[data-jeex="finish-panel"]');
  if (!panel) throw new Error('no panel');
  return panel;
}

function panelOpen(container: HTMLElement): boolean {
  return panelOf(container).dataset['open'] === 'true';
}

/** Clicks the first swatch of the open panel — the action that produces a batch. */
function pickFirstSwatch(container: HTMLElement): void {
  const swatch = panelOf(container).querySelector<HTMLElement>('[data-finish]');
  if (!swatch) throw new Error('the open panel offers no swatch');
  swatch.click();
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

describe("edits: 'local' (the default)", () => {
  test('is what a mount with no `edits` at all gets', () => {
    const { handle } = mount({});
    expect(handle.options.edits).toBe('local');
  });

  test(
    'a swatch commits into the viewer and raises no `edit`',
    async () => {
      const { container, handle, edits } = mount({ select: true });
      await handle.ready;
      await openFinishPanel(container);
      const before = handle.getState().rev;
      pickFirstSwatch(container);
      await until(() => handle.getState().rev > before, 'the commit');
      expect(edits).toEqual([]);
    },
    PROBE_TIMEOUT_MS,
  );
});

describe("edits: 'emit'", () => {
  test(
    'the panel still opens, the batch goes out, and the document does not move',
    async () => {
      const { container, handle, edits } = mount({ edits: 'emit', select: true });
      await handle.ready;
      // The panel is the SAME panel: `'emit'` changes where the batch goes, not
      // what the user sees.
      await openFinishPanel(container);
      const before = handle.getState().rev;
      pickFirstSwatch(container);
      await until(() => edits.length > 0, 'the edit event');
      expect(edits).toHaveLength(1);
      expect(edits[0]!.baseRev).toBe(before);
      expect(edits[0]!.ops.length).toBeGreaterThan(0);
      // Nothing was committed here, and nothing will be: this is the divergence
      // the option exists to prevent.
      await delay(120);
      expect(handle.getState().rev).toBe(before);
    },
    PROBE_TIMEOUT_MS,
  );

  /**
   * The other half of the `'emit'` contract: the viewer waits for the HOST's
   * document. The assertion is on the `scene` event rather than on `rev`, because `loadScene`
   * starts a fresh `SceneModel` — a new document's revision begins at 0 again,
   * so a number says nothing about who moved it.
   */
  test(
    "the host's own document is what changes the scene, not the click",
    async () => {
      const { container, handle, edits, scenes } = mount({ edits: 'emit' });
      await handle.ready;
      const builtOnBoot = scenes.length;
      await openFinishPanel(container);
      pickFirstSwatch(container);
      await until(() => edits.length > 0, 'the edit event');
      // The click produced a batch and nothing else: no document, no event.
      await delay(150);
      expect(scenes).toHaveLength(builtOnBoot);
      await handle.loadScene({ document: demoScene() });
      expect(scenes.length).toBeGreaterThan(builtOnBoot);
    },
    PROBE_TIMEOUT_MS,
  );
});

describe("edits: 'off'", () => {
  test('a click opens no panel, and `select` still reports what it landed on', async () => {
    const { container, handle, edits, selections } = mount({ edits: 'off', select: true });
    await handle.ready;
    // Every point that opens a panel in the other two modes, and none of them
    // may open one here.
    await clickEveryProbe(container);
    await until(() => selections.length > 0, 'a select event');
    expect(panelOpen(container)).toBe(false);
    expect(edits).toEqual([]);
  });
});
