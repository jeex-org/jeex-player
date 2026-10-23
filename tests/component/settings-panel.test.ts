/**
 * The settings button and panel in a real browser, on real viewers: hidden by
 * default, attached to the control bar's end without moving any control (on
 * both sides of the narrow breakpoints, each viewer narrow inside a wide
 * page), and the panel's behaviour: the slider at rest on «Original», the
 * keyboard, Escape, presses outside, the other panel, the chrome, the locale
 * and two viewers on one page.
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

/** Every control of the bar and the bar itself, as rectangles. */
/** Every control of the bar and the bar itself, as rectangles relative to the viewer's own box. */
function barLayout(viewer: ViewerHandle): Record<string, number[]> {
  const origin = viewer.element.getBoundingClientRect();
  const at = (rect: DOMRect): number[] =>
    [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height].map((v) => Math.round(v * 10) / 10);
  const bar = node(viewer, 'control-bar')!;
  const out: Record<string, number[]> = { bar: at(bar.getBoundingClientRect()) };
  bar.querySelectorAll<HTMLElement>('button').forEach((button, i) => {
    if (button.dataset['jeex'] === 'settings-button') return;
    out[button.dataset['jeex'] ?? `button-${i}`] = at(button.getBoundingClientRect());
  });
  return out;
}

describe('the settings button', { timeout: MOUNT_TIMEOUT_MS }, () => {
  test('does not exist unless the host enables it', async () => {
    const viewer = await mount(900);
    expect(node(viewer, 'settings-button')).toBeNull();
    expect(node(viewer, 'settings-panel')).toBeNull();
  });

  for (const width of [900, 560, 400]) {
    test(`at ${width} px it is attached to the bar's end and no control moves`, async () => {
      const plain = await mount(width);
      const before = barLayout(plain);
      plain.dispose();
      const viewer = await mount(width, { settings: { show: true } });
      expect(barLayout(viewer)).toEqual(before);
      const button = node(viewer, 'settings-button')!.getBoundingClientRect();
      const bar = node(viewer, 'control-bar')!.getBoundingClientRect();
      const box = viewer.element.getBoundingClientRect();
      // Inside the viewer, whatever its width.
      expect(button.left).toBeGreaterThanOrEqual(box.left);
      expect(button.right).toBeLessThanOrEqual(box.right);
      if (width > 600) {
        expect(button.left).toBeGreaterThan(bar.right);
        expect(Math.abs((button.top + button.bottom) / 2 - (bar.top + bar.bottom) / 2)).toBeLessThan(1.5);
      } else {
        expect(button.top).toBeGreaterThan(bar.bottom);
        expect(Math.abs(node(viewer, 'settings-extension')!.getBoundingClientRect().right - bar.right)).toBeLessThan(1.5);
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

  test('stays with edits off and with no Interior styles, and hides with the control bar', async () => {
    const off = await mount(900, { settings: { show: true }, edits: 'off', interiors: { selector: false } });
    expect(node(off, 'settings-button')!.checkVisibility()).toBe(true);
    const bare = await mount(900, { settings: { show: true }, chrome: { controls: false } });
    expect(node(bare, 'settings-button')!.checkVisibility()).toBe(false);
  });
});

describe('the settings panel', { timeout: MOUNT_TIMEOUT_MS }, () => {
  async function open(viewer: ViewerHandle): Promise<{ button: HTMLButtonElement; panel: HTMLElement; slider: HTMLInputElement }> {
    const button = node<HTMLButtonElement>(viewer, 'settings-button')!;
    await userEvent.click(button);
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
    await userEvent.click(button);
    expect(slider.value).toBe('3900');
    await userEvent.click(panel.querySelector<HTMLButtonElement>('.settings-reset')!);
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
    await userEvent.click(node(viewer, 'hint-card')!);
    expect(panel.hidden).toBe(true);
    await until(() => document.activeElement === button, 'focus back on the settings button');
    await userEvent.click(button);
    expect(panel.hidden).toBe(false);
    const outside = document.createElement('button');
    outside.textContent = 'page';
    document.body.append(outside);
    await userEvent.click(outside);
    expect(panel.hidden).toBe(true);
    await delay(50);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  test('one panel at a time: Interior styles closes it, and it closes Interior styles', async () => {
    const viewer = await mount(900, { settings: { show: true } });
    const { panel } = await open(viewer);
    const interiors = node<HTMLButtonElement>(viewer, 'interiors-button')!;
    await userEvent.click(interiors);
    const finish = node(viewer, 'finish-panel')!;
    expect(finish.classList.contains('is-hidden')).toBe(false);
    expect(panel.hidden).toBe(true);
    await userEvent.click(node<HTMLButtonElement>(viewer, 'settings-button')!);
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
});
