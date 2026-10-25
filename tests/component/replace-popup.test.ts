/**
 * The Replace panel's reach and its "Replace with another…" popup, in a real
 * browser: every variant can be scrolled to inside a phone-sized viewer, the
 * second footer button moves nothing that was there, and the popup is a
 * titled, keyboard-trapped modal that gives focus back to its opener. On a
 * real WebGL mount a pick commits `replace_asset` locally, or hands it to the
 * host under `edits: 'emit'`.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { ViewerUI, type ViewerCommands } from '../../src/ui/viewer-ui.js';
import { FullscreenController } from '../../src/ui/fullscreen-controller.js';
import type { PanelItem, PanelRequest } from '../../src/ui/selection-panel.js';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { ViewerEditRequest } from '../../src/app/viewer-events.js';
import type { SceneData } from '../../src/scene/types.js';
import { OFFERS_FIXTURE as OFFERS } from '../fixtures/offers/fixture-ids.js';
import { closeContainers, nextFrame, openContainer, openShell, until, untilCameraStill, type Shell } from './support.js';

function noop(): void {
  // Command stubs: this file is about the panel and the popup, not effects.
}

function build(width?: number, height?: number): { shell: Shell; ui: ViewerUI } {
  const shell = openShell(width, height);
  shell.roots.byName('loading-state').classList.add('is-hidden');
  shell.roots.byName('viewer-ui').classList.remove('is-hidden');
  const commands: ViewerCommands = {
    setMode: noop,
    resetCamera: noop,
    toggleTour: noop,
    toggleFullscreen: noop,
    toggleFurniture: noop,
    openInteriors: noop,
    setLightTemperature: noop,
    tourSeek: noop,
    tourPlay: noop,
    tourPause: noop,
    tourSpeed: noop,
  };
  const ui = new ViewerUI({
    shell: new FullscreenController(shell.roots.viewport),
    messages: shell.messages,
    roots: shell.roots,
    commands,
  });
  ui.bind();
  return { shell, ui };
}

function items(count: number): PanelItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `variant-${index}`,
    label: `Variant ${index + 1}`,
    thumbnail: null,
    background: '#8a7a6a',
    active: index === 0,
    dataset: { variant: `variant-${index}` },
  }));
}

function furnitureRequest(count: number, secondary?: PanelRequest['secondary']): PanelRequest {
  return {
    kind: 'furniture',
    title: 'Replace · Long sofa',
    items: items(count),
    footer: { label: 'Standard variant', onClick: noop },
    ...(secondary === undefined ? {} : { secondary }),
    anchor: { x: 0, y: 0 },
    onPick: noop,
  };
}

function rectOf(shell: Shell, name: Parameters<Shell['roots']['byName']>[0]): DOMRect {
  return shell.roots.byName(name).getBoundingClientRect();
}

afterEach(() => {
  closeContainers();
});

describe('the Replace panel', () => {
  test('the second footer button sits below the first and moves no existing control', () => {
    const { shell, ui } = build();
    ui.openPanel(furnitureRequest(4));
    const before = { close: rectOf(shell, 'finish-close'), all: rectOf(shell, 'finish-all'), swatches: rectOf(shell, 'finish-swatches') };
    expect(shell.roots.byName('finish-other').classList.contains('is-hidden')).toBe(true);
    ui.closePanel();
    ui.openPanel(furnitureRequest(4, { label: 'Replace with another…', onClick: noop }));
    const other = shell.roots.byName<HTMLButtonElement>('finish-other');
    expect(other.classList.contains('is-hidden')).toBe(false);
    expect(other.textContent).toBe('Replace with another…');
    expect(rectOf(shell, 'finish-close').toJSON()).toEqual(before.close.toJSON());
    expect(rectOf(shell, 'finish-all').toJSON()).toEqual(before.all.toJSON());
    expect(rectOf(shell, 'finish-swatches').toJSON()).toEqual(before.swatches.toJSON());
    expect(other.getBoundingClientRect().top).toBeGreaterThanOrEqual(before.all.bottom);
  });

  test('forty variants in a 390 x 700 viewer: the panel stays inside and the last one scrolls into reach', () => {
    // Twenty object previews still fit 700 px (five rows); forty do not, so the list has to scroll.
    const { shell, ui } = build(390, 700);
    ui.openPanel(furnitureRequest(40, { label: 'Replace with another…', onClick: noop }));
    const viewer = shell.roots.viewport.getBoundingClientRect();
    const panel = rectOf(shell, 'finish-panel');
    expect(panel.bottom).toBeLessThanOrEqual(viewer.bottom);
    expect(panel.right).toBeLessThanOrEqual(viewer.right);
    const swatches = shell.roots.byName('finish-swatches');
    expect(swatches.scrollHeight).toBeGreaterThan(swatches.clientHeight);
    expect(getComputedStyle(swatches).overflowY).toBe('auto');
    // The title and both footer buttons stay in view while the list scrolls.
    for (const name of ['finish-title', 'finish-all', 'finish-other'] as const) {
      const rect = rectOf(shell, name);
      expect(rect.top).toBeGreaterThanOrEqual(panel.top);
      expect(rect.bottom).toBeLessThanOrEqual(panel.bottom);
    }
    const last = swatches.querySelector<HTMLElement>('[data-variant="variant-39"]')!;
    last.scrollIntoView({ block: 'nearest' });
    const shown = last.getBoundingClientRect();
    const box = swatches.getBoundingClientRect();
    expect(shown.top).toBeGreaterThanOrEqual(box.top - 1);
    expect(shown.bottom).toBeLessThanOrEqual(box.bottom + 1);
  });
});

describe('the Replace with another popup', () => {
  function openPopup(harness: { shell: Shell; ui: ViewerUI }, onPick = vi.fn()): HTMLButtonElement {
    const opener = harness.shell.roots.byName<HTMLButtonElement>('finish-other');
    harness.ui.openPanel(
      furnitureRequest(4, {
        label: 'Replace with another…',
        onClick: () =>
          harness.ui.openReplacePopup({
            title: 'Replace Long sofa with',
            empty: 'Nothing else fits here',
            groups: [
              { label: 'Sofas', items: items(2).map((item) => ({ ...item, dataset: { offer: item.id } })) },
              { label: 'Benches', items: items(1).map((item) => ({ ...item, id: 'bench', dataset: { offer: 'bench' } })) },
            ],
            onPick,
          }),
      }),
    );
    opener.focus();
    opener.click();
    return opener;
  }

  test('a visible title names the dialog, and groups carry their labels', () => {
    const harness = build();
    openPopup(harness);
    const popup = harness.shell.roots.byName('replace-popup');
    const dialog = popup.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(harness.ui.isReplacePopupOpen()).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = harness.shell.roots.byName('replace-popup-title');
    expect(title.textContent).toBe('Replace Long sofa with');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.getBoundingClientRect().height).toBeGreaterThan(0);
    expect([...popup.querySelectorAll('h3, [data-group]')].map((node) => node.textContent)).toEqual(['Sofas', 'Benches']);
  });

  test('Tab stays inside, Escape closes it and focus returns to the opener; the panel stays open', async () => {
    const harness = build();
    const opener = openPopup(harness);
    const popup = harness.shell.roots.byName('replace-popup');
    const root = popup.getRootNode() as Document;
    for (let step = 0; step < 6; step += 1) {
      popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      await nextFrame();
      // A cancelled Tab moved focus itself; an uncancelled one is the browser's, which stays in DOM order inside.
      expect(popup.contains(root.activeElement)).toBe(true);
    }
    harness.shell.roots.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(harness.ui.isReplacePopupOpen()).toBe(false);
    expect(root.activeElement).toBe(opener);
    expect(harness.ui.isPanelOpen()).toBe(true);
  });

  test('the close button closes it the same way', () => {
    const harness = build();
    const opener = openPopup(harness);
    harness.shell.roots.byName<HTMLButtonElement>('replace-popup-close').click();
    expect(harness.ui.isReplacePopupOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  test('a pick hands its id over and closes the popup', () => {
    const harness = build();
    const onPick = vi.fn();
    openPopup(harness, onPick);
    harness.shell.roots.byName('replace-popup').querySelector<HTMLButtonElement>('[data-offer="bench"]')!.click();
    expect(onPick).toHaveBeenCalledWith('bench');
    expect(harness.ui.isReplacePopupOpen()).toBe(false);
  });

  test('with nothing to offer it shows the empty state', () => {
    const harness = build();
    harness.ui.openPanel(furnitureRequest(1));
    harness.ui.openReplacePopup({ title: 'Replace Bud vase with', empty: 'Nothing else fits here', groups: [], onPick: noop });
    const empty = harness.shell.roots.byName('replace-popup-empty');
    expect(empty.classList.contains('is-hidden')).toBe(false);
    expect(empty.textContent).toBe('Nothing else fits here');
  });

  test('fits a 390-pixel-wide viewer without horizontal scrolling', () => {
    const harness = build(390, 700);
    openPopup(harness);
    const popup = harness.shell.roots.byName('replace-popup');
    const card = popup.querySelector<HTMLElement>('[role="dialog"]')!;
    const viewer = harness.shell.roots.viewport.getBoundingClientRect();
    expect(card.getBoundingClientRect().left).toBeGreaterThanOrEqual(viewer.left);
    expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(viewer.right);
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  });

  test('on a phone the tiles fill the sheet width: no empty strip on the right', () => {
    const harness = build(390, 700);
    harness.ui.openPanel(furnitureRequest(4));
    harness.ui.openReplacePopup({
      title: 'Replace Long sofa with',
      empty: 'Nothing else fits here',
      groups: [{ label: 'Furniture', items: items(7).map((item) => ({ ...item, dataset: { offer: item.id } })) }],
      onPick: noop,
    });
    const list = harness.shell.roots.byName('replace-popup-list').getBoundingClientRect();
    const tiles = [...harness.shell.roots.byName('replace-popup-list').querySelectorAll<HTMLElement>('.finish-swatch')];
    const right = Math.max(...tiles.map((tile) => tile.getBoundingClientRect().right));
    expect(list.right - right).toBeLessThan(16);
  });
});

// ------------------------------------------------------ on a real mount ---

type Debug = { mode: () => string | undefined; projectPoint: (x: number, y: number, z: number) => { x: number; y: number } | null };
const debug = (): Debug => (window as unknown as { __viewerDebug: Debug }).__viewerDebug;
const handles: ViewerHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
});

async function offersScene(): Promise<SceneData> {
  return (await (await fetch('/tests/fixtures/offers/scene.json')).json()) as SceneData;
}

async function offersLibrary(): Promise<unknown> {
  return (await (await fetch('/tests/fixtures/offers/library.json')).json()) as unknown;
}

let pointerId = 9100;

/** Clicks the sofa of the offers scene in orbit until its Replace panel opens. */
async function openSofaPanel(container: HTMLElement): Promise<HTMLElement> {
  const canvas = container.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
  const panel = container.querySelector<HTMLElement>('[data-jeex="finish-panel"]')!;
  await untilCameraStill('the camera to settle before the click');
  for (const y of [0.45, 0.3, 0.6, 0.2]) {
    const point = debug().projectPoint(2, y, 4.2);
    if (!point) continue;
    const id = (pointerId += 1);
    const at = { clientX: point.x, clientY: point.y, button: 0, pointerId: id, bubbles: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', at));
    canvas.dispatchEvent(new PointerEvent('pointerup', at));
    canvas.dispatchEvent(new MouseEvent('click', at));
    await nextFrame();
    if (panel.dataset['open'] === 'true' && panel.dataset['kind'] === 'furniture') return panel;
  }
  throw new Error('no click opened the sofa Replace panel');
}

const MOUNT_TIMEOUT_MS = 120_000;

describe('a pick on a real mount', { timeout: MOUNT_TIMEOUT_MS }, () => {
  for (const edits of ['local', 'emit'] as const) {
    test(`commits replace_asset (${edits})`, async () => {
      const container = openContainer();
      const handle = mountViewer(container, {
        scene: { repository: new InlineSceneRepository(await offersScene()) },
        offers: { library: await offersLibrary(), baseUrl: new URL('/tests/fixtures/offers/', location.href).href },
        tour: { mode: 'off' },
        view: { mode: 'orbit' },
        debug: true,
        analytics: 'off',
        edits,
      });
      handles.push(handle);
      const sent: ViewerEditRequest[] = [];
      handle.on('edit', (edit) => sent.push(edit));
      await handle.ready;
      await until(() => debug().mode() === 'orbit', 'orbit');
      const panel = await openSofaPanel(container);
      expect(panel.querySelectorAll('[data-variant]')).toHaveLength(20);
      container.querySelector<HTMLButtonElement>('[data-jeex="finish-other"]')!.click();
      const bench = container.querySelector<HTMLButtonElement>(`[data-jeex="replace-popup"] [data-offer="${OFFERS.asset.hallBench}"]`);
      expect(bench).not.toBeNull();
      bench!.click();
      const expected = {
        op: 'replace_asset',
        assetId: OFFERS.placement.sofa,
        asset: OFFERS.asset.hallBench,
        library: OFFERS.library,
        variant: OFFERS.variant.hallBench,
      };
      const placed = (): { asset?: string | undefined } | undefined =>
        handle.getScene()?.assets.find((asset) => asset.id === OFFERS.placement.sofa);
      if (edits === 'emit') {
        expect(sent.at(-1)?.ops).toEqual([expected]);
        expect(placed()?.asset).toBe(OFFERS.asset.longSofa);
      } else {
        expect(sent).toEqual([]);
        await until(() => placed()?.asset === OFFERS.asset.hallBench, 'the replaced placement');
      }
    });
  }
});
