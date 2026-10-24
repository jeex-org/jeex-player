/**
 * The settings button and panel in a real browser, on real viewers: hidden by
 * default, attached to the control bar's end or start without moving any
 * control (on both sides of the narrow breakpoints, each viewer narrow inside
 * a wide page, and under a right-to-left bar), and the panel's behaviour: the
 * slider at rest on «Original», the keyboard, Escape, presses outside, the
 * other panel, the chrome, the locale and two viewers on one page.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { ViewerOptionsInput } from '../../src/app/viewer-options.js';
import type { LightTemperatureChange } from '../../src/app/light-temperature-control.js';
import { closeContainers, delay, demoScene, openContainer, until } from './support.js';

const MOUNT_TIMEOUT_MS = 120_000;
const viewers: ViewerHandle[] = [];

afterEach(() => {
  for (const viewer of viewers.splice(0)) viewer.dispose();
  closeContainers();
});

async function mount(width: number, options: ViewerOptionsInput = {}, height = 420): Promise<ViewerHandle> {
  const viewer = mountViewer(openContainer(width, height), {
    scene: { repository: new InlineSceneRepository(demoScene()) },
    tour: { mode: 'off' },
    ...options,
  });
  viewers.push(viewer);
  await viewer.ready;
  return viewer;
}

const node = <T extends HTMLElement = HTMLElement>(viewer: ViewerHandle, name: string): T | null =>
  viewer.element.querySelector<T>(`[data-jeex="${name}"]`);

/**
 * Every control of the bar and the bar itself, as rectangles relative to the
 * viewer's own box. Keyed by name, never by position: a start-side settings
 * plate is the bar's first child and would shift positional keys.
 */
function barLayout(viewer: ViewerHandle): Record<string, number[]> {
  const origin = viewer.element.getBoundingClientRect();
  const at = (rect: DOMRect): number[] =>
    [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height].map((v) => Math.round(v * 10) / 10);
  const bar = node(viewer, 'control-bar')!;
  const out: Record<string, number[]> = { bar: at(bar.getBoundingClientRect()) };
  const unnamed = [...bar.querySelectorAll<HTMLElement>('button')].filter((button) => button.dataset['jeex'] !== 'settings-button');
  unnamed.forEach((button, i) => {
    const key = button.dataset['jeex'] ?? (button.dataset['mode'] ? `mode-${button.dataset['mode']}` : `button-${i}`);
    out[key] = at(button.getBoundingClientRect());
  });
  return out;
}

describe('the settings button', { timeout: MOUNT_TIMEOUT_MS }, () => {
  test('does not exist unless the host enables it, whatever side it names', async () => {
    const viewer = await mount(900, { settings: { side: 'start' } });
    expect(node(viewer, 'settings-button')).toBeNull();
    expect(node(viewer, 'settings-panel')).toBeNull();
  });

  for (const width of [1280, 560, 400, 360]) {
    test(`at ${width} px it is attached to the bar's end or start, inside the viewer, and no control moves`, async () => {
      // The bar pinned open in all three: a boot slower than the chrome's idle would otherwise compare a collapsed bar with an open one.
      const plain = await mount(width, { chrome: { autoHide: false } });
      const before = barLayout(plain);
      plain.dispose();
      for (const side of ['end', 'start'] as const) {
        const viewer = await mount(width, { settings: { show: true, side }, chrome: { autoHide: false } });
        expect(barLayout(viewer)).toEqual(before);
        const extension = node(viewer, 'settings-extension')!;
        // Decided by the first resize report after the bar has a box.
        await until(() => extension.dataset['placement'] !== undefined, 'the plate placed');
        const plate = extension.getBoundingClientRect();
        const button = node(viewer, 'settings-button')!.getBoundingClientRect();
        const bar = node(viewer, 'control-bar')!.getBoundingClientRect();
        const box = viewer.element.getBoundingClientRect();
        // Inside the viewer, whatever its width.
        expect(plate.left).toBeGreaterThanOrEqual(box.left);
        expect(plate.right).toBeLessThanOrEqual(box.right);
        if (width > 600) {
          expect(
            extension.dataset['placement'],
            `${side} bar ${bar.left}..${bar.right} plate ${plate.left}..${plate.right} box ${box.left}..${box.right}`,
          ).toBe('beside');
          // The same gap on either side (4 px from the bar's padding box, 3 px from its 1 px border), centred on the bar's height.
          expect(side === 'end' ? plate.left - bar.right : bar.left - plate.right).toBeCloseTo(3, 0);
          expect(Math.abs((button.top + button.bottom) / 2 - (bar.top + bar.bottom) / 2)).toBeLessThan(1.5);
        } else {
          expect(button.top).toBeGreaterThan(bar.bottom);
          expect(Math.abs(side === 'end' ? plate.right - bar.right : plate.left - bar.left)).toBeLessThan(1.5);
        }
        viewer.dispose();
      }
    });
  }

  test('at 1280 px a long scene name leaves no room beside the bar: the button goes under its end, inside the viewer', async () => {
    const scene = {
      ...demoScene(),
      name: 'A two-bedroom apartment with a very long name that a listing editor pasted in full, '.repeat(2),
    };
    const viewer = mountViewer(openContainer(1280, 520), {
      scene: { repository: new InlineSceneRepository(scene) },
      tour: { mode: 'off' },
      settings: { show: true },
    });
    viewers.push(viewer);
    await viewer.ready;
    const extension = node(viewer, 'settings-extension')!;
    await until(() => extension.dataset['placement'] === 'under', 'the button under the bar');
    const bar = node(viewer, 'control-bar')!.getBoundingClientRect();
    const plate = extension.getBoundingClientRect();
    const box = viewer.element.getBoundingClientRect();
    expect(plate.right).toBeLessThanOrEqual(box.right);
    expect(plate.top).toBeGreaterThan(bar.bottom);
    expect(Math.abs(plate.right - bar.right)).toBeLessThan(1.5);
  });

  test("at 1280 px with a long scene name the start-side button goes under the bar's start, inside the viewer", async () => {
    const scene = {
      ...demoScene(),
      name: 'A two-bedroom apartment with a very long name that a listing editor pasted in full, '.repeat(2),
    };
    const viewer = mountViewer(openContainer(1280, 520), {
      scene: { repository: new InlineSceneRepository(scene) },
      tour: { mode: 'off' },
      settings: { show: true, side: 'start' },
    });
    viewers.push(viewer);
    await viewer.ready;
    const extension = node(viewer, 'settings-extension')!;
    await until(() => extension.dataset['placement'] === 'under', 'the button under the bar');
    const bar = node(viewer, 'control-bar')!.getBoundingClientRect();
    const plate = extension.getBoundingClientRect();
    const box = viewer.element.getBoundingClientRect();
    expect(plate.left).toBeGreaterThanOrEqual(box.left);
    expect(plate.top).toBeGreaterThan(bar.bottom);
    expect(Math.abs(plate.left - bar.left)).toBeLessThan(1.5);
  });

  test('stays with edits off and with no Interior styles, and hides with the control bar', async () => {
    const off = await mount(900, { settings: { show: true }, edits: 'off', interiors: { selector: false } });
    expect(node(off, 'settings-button')!.checkVisibility()).toBe(true);
    const bare = await mount(900, { settings: { show: true }, chrome: { controls: false } });
    expect(node(bare, 'settings-button')!.checkVisibility()).toBe(false);
  });
});

/**
 * A press, dispatched as the other component files do: a live viewer on the
 * software rasteriser keeps the page busy every frame, and Playwright's
 * pointer actions never complete over it.
 */
function press(target: HTMLElement): void {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, isPrimary: true }));
  target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, isPrimary: true }));
  target.click();
}

describe('the settings panel', { timeout: MOUNT_TIMEOUT_MS }, () => {
  async function open(viewer: ViewerHandle): Promise<{ button: HTMLButtonElement; panel: HTMLElement; slider: HTMLInputElement }> {
    const button = node<HTMLButtonElement>(viewer, 'settings-button')!;
    // Shown and inside the viewer's box: the press below is dispatched, so this is what proves it can be reached.
    expect(button.checkVisibility()).toBe(true);
    const at = button.getBoundingClientRect();
    const box = viewer.element.getBoundingClientRect();
    expect(at.left >= box.left && at.right <= box.right && at.top >= box.top && at.bottom <= box.bottom).toBe(true);
    press(button);
    const panel = node(viewer, 'settings-panel')!;
    return { button, panel, slider: panel.querySelector<HTMLInputElement>('input[type="range"]')! };
  }

  test('opens on «Original» with the thumb at rest; the keyboard steps 100 K, Escape closes and gives focus back', async () => {
    const viewer = await mount(900, { settings: { show: true } });
    const events: LightTemperatureChange[] = [];
    viewer.on('lightTemperature', (change) => events.push(change));
    const { button, panel, slider } = await open(viewer);
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(slider);
    expect(slider.value).toBe('4000');
    expect(slider.getAttribute('aria-valuetext')).toBe('Original');
    expect(panel.querySelector('output')!.textContent).toBe('Original');
    expect(panel.querySelector<HTMLButtonElement>('.settings-reset')!.disabled).toBe(true);
    await userEvent.keyboard('{ArrowRight}');
    expect(events).toEqual([{ temperature: 4100, source: 'panel' }]);
    expect(viewer.getState().lightTemperature).toBe(4100);
    expect(slider.getAttribute('aria-valuetext')).toBe('4100 K · neutral');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(viewer.getState().lightTemperature).toBe(3900);
    await userEvent.keyboard('{Escape}');
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
    // Reopened, it shows the current value; «Original» gives the default back.
    press(button);
    expect(slider.value).toBe('3900');
    press(panel.querySelector<HTMLButtonElement>('.settings-reset')!);
    expect(viewer.getState().lightTemperature).toBeNull();
    expect(events.at(-1)).toEqual({ temperature: null, source: 'panel' });
  });

  test('a host change reaches the open panel and reports host', async () => {
    const viewer = await mount(900, { settings: { show: true } });
    const { panel } = await open(viewer);
    const events: LightTemperatureChange[] = [];
    viewer.on('lightTemperature', (change) => events.push(change));
    viewer.setLightTemperature(2700);
    expect(panel.querySelector('output')!.textContent).toBe('2700 K · warm');
    viewer.setLightTemperature(2700);
    expect(events).toEqual([{ temperature: 2700, source: 'host' }]);
    expect(() => viewer.setLightTemperature(2750)).toThrow(expect.objectContaining({ code: 'bad-params', path: 'lightTemperature' }));
  });

  test('a press outside closes it: inside the viewer focus goes back to the button, outside it does not', async () => {
    const viewer = await mount(900, { settings: { show: true } });
    const { button, panel } = await open(viewer);
    // The hint card: inside the viewer, and not a pick (a press on the scene opens the finish panel, which takes focus itself).
    press(node(viewer, 'hint-card')!);
    expect(panel.hidden).toBe(true);
    await until(() => document.activeElement === button, 'focus back on the settings button');
    press(button);
    expect(panel.hidden).toBe(false);
    const outside = document.createElement('button');
    outside.textContent = 'page';
    document.body.append(outside);
    press(outside);
    // What the browser does after a real press on a focusable button outside.
    outside.focus();
    expect(panel.hidden).toBe(true);
    await delay(50);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  test('one panel at a time: Interior styles closes it, and it closes Interior styles', async () => {
    const viewer = await mount(900, { settings: { show: true } });
    const { panel } = await open(viewer);
    const interiors = node<HTMLButtonElement>(viewer, 'interiors-button')!;
    press(interiors);
    const finish = node(viewer, 'finish-panel')!;
    expect(finish.classList.contains('is-hidden')).toBe(false);
    expect(panel.hidden).toBe(true);
    press(node<HTMLButtonElement>(viewer, 'settings-button')!);
    expect(panel.hidden).toBe(false);
    expect(finish.classList.contains('is-hidden')).toBe(true);
  });

  test('keeps the chrome awake while open, and follows a live locale change', async () => {
    const viewer = await mount(900, { settings: { show: true } });
    const { panel } = await open(viewer);
    await delay(4800);
    expect(node(viewer, 'control-bar')!.dataset['collapsed']).toBe('false');
    viewer.setLocale('de');
    expect(panel.querySelector('.settings-title')!.textContent).toBe('Viewer-Einstellungen');
    expect(node(viewer, 'settings-button')!.getAttribute('aria-label')).toBe('Einstellungen');
  });

  test('two viewers on one page are independent', async () => {
    const one = await mount(700, { settings: { show: true } }, 360);
    const two = await mount(700, { settings: { show: true } }, 360);
    await open(one);
    await userEvent.keyboard('{ArrowRight}');
    expect(one.getState().lightTemperature).toBe(4100);
    expect(two.getState().lightTemperature).toBeNull();
    expect(node(two, 'settings-panel')!.hidden).toBe(true);
  });
  test("on the start side Tab reaches the button before the bar's controls, Shift+Tab comes back, Escape returns focus", async () => {
    const viewer = await mount(1280, { settings: { show: true, side: 'start' }, chrome: { autoHide: false } });
    const bar = node(viewer, 'control-bar')!;
    const button = node<HTMLButtonElement>(viewer, 'settings-button')!;
    expect(bar.firstElementChild).toBe(node(viewer, 'settings-extension'));
    const first = [...bar.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]')].find(
      (control) => control !== button && control.tabIndex >= 0 && control.checkVisibility(),
    )!;
    button.focus();
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(button);
    const { panel, slider } = await open(viewer);
    expect(document.activeElement).toBe(slider);
    expect(panel.hidden).toBe(false);
    await userEvent.keyboard('{Escape}');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  for (const side of ['start', 'end'] as const) {
    test(`on the ${side} side the open panel follows its button above 430 px and is the same bottom sheet at or below it`, async () => {
      const container = openContainer(1280, 420);
      const viewer = mountViewer(container, {
        scene: { repository: new InlineSceneRepository(demoScene()) },
        tour: { mode: 'off' },
        settings: { show: true, side },
      });
      viewers.push(viewer);
      await viewer.ready;
      const { button, panel } = await open(viewer);
      const edge = (rect: DOMRect): number => (side === 'start' ? rect.left : rect.right);
      const aligned = (): boolean => Math.abs(edge(panel.getBoundingClientRect()) - edge(button.getBoundingClientRect())) < 1.5;
      const inside = (): boolean => {
        const at = panel.getBoundingClientRect();
        const box = viewer.element.getBoundingClientRect();
        return at.left >= box.left - 0.5 && at.right <= box.right + 0.5 && at.bottom <= box.bottom + 0.5;
      };
      const sheet = (): boolean => {
        const at = panel.getBoundingClientRect();
        const box = viewer.element.getBoundingClientRect();
        return (
          Math.abs(at.left - box.left - 10) < 1.5 &&
          Math.abs(box.right - at.right - 10) < 1.5 &&
          Math.abs(box.bottom - at.bottom - 10) < 1.5
        );
      };
      expect(aligned()).toBe(true);
      expect(inside()).toBe(true);
      container.style.width = '560px';
      await until(() => aligned() && inside(), 'the panel on its button after the resize to 560 px');
      container.style.width = '420px';
      await until(sheet, 'the bottom sheet at 420 px');
      container.style.width = '560px';
      await until(() => aligned() && inside() && !sheet(), 'the popover again at 560 px');
      expect(panel.hidden).toBe(false);
    });
  }

  // The bar's own centring is physical (`translateX(-50%)`), so a right-to-left bar sits off-centre, partly outside the viewer:
  // these checks cover what this side option owns, the mirrored attachment and the panel's anchoring, not the bar.
  test('under a right-to-left bar the start side is the right and the end side the left, the panel inside the viewer', async () => {
    for (const side of ['start', 'end'] as const) {
      const container = openContainer(1280, 420);
      container.dir = 'rtl';
      const viewer = mountViewer(container, {
        scene: { repository: new InlineSceneRepository(demoScene()) },
        tour: { mode: 'off' },
        settings: { show: true, side },
        chrome: { autoHide: false },
      });
      viewers.push(viewer);
      await viewer.ready;
      const bar = node(viewer, 'control-bar')!.getBoundingClientRect();
      const extension = node(viewer, 'settings-extension')!;
      const plate = extension.getBoundingClientRect();
      const box = viewer.element.getBoundingClientRect();
      const where = `${side} ${extension.dataset['placement']} bar ${bar.left}..${bar.right} plate ${plate.left}..${plate.right} box ${box.left}..${box.right}`;
      // Beside the mirrored edge, or under it when there is no room beside it.
      if (extension.dataset['placement'] === 'under') {
        expect(Math.abs(side === 'start' ? plate.right - bar.right : plate.left - bar.left), where).toBeLessThan(1.5);
      } else if (side === 'start') expect(plate.left, where).toBeGreaterThan(bar.right);
      else expect(plate.right, where).toBeLessThan(bar.left);
      // Pressed directly: the bar itself may sit partly outside the viewer here (see above), so `open()`'s reach check does not apply.
      const button = node<HTMLButtonElement>(viewer, 'settings-button')!;
      press(button);
      const panel = node(viewer, 'settings-panel')!;
      const at = panel.getBoundingClientRect();
      const mark = button.getBoundingClientRect();
      expect(at.left >= box.left && at.right <= box.right, `${where} panel ${at.left}..${at.right}`).toBe(true);
      // The panel's start edge on the button's start edge (the right in a right-to-left bar), or clamped 8 px inside the viewer.
      if (side === 'start') expect(Math.abs(at.right - mark.right), where).toBeLessThan(1.5);
      else if (mark.left >= box.left + 8) expect(Math.abs(at.left - mark.left), where).toBeLessThan(1.5);
      else expect(Math.abs(at.left - box.left - 8), where).toBeLessThan(1.5);
      viewer.dispose();
    }
  });
});
