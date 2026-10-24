/**
 * Every interactive target in the shell is at least the WCAG
 * 2.2 minimum, 24 x 24 CSS px — measured with `getBoundingClientRect`, over
 * every `button`, `[role="slider"]`, `[role="button"]` and `a` the mounted
 * chrome, tour bar and panel actually put on screen.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ViewerChrome, type ChromeCommands } from '../../src/ui/viewer-chrome.js';
import { TourBar } from '../../src/ui/tour-bar.js';
import { SelectionPanel } from '../../src/ui/selection-panel.js';
import { FullscreenController } from '../../src/ui/fullscreen-controller.js';
import { closeContainers, openShell, type Shell } from './support.js';
import { FINISH } from '../../src/materials/finish-ids.js';

/** WCAG 2.2 §2.5.8 minimum target size, CSS px. */
const MIN_TARGET_PX = 24;

function noop(): void {
  // Command stubs: this file is about layout, not effects.
}

let shell: Shell;

beforeEach(() => {
  shell = openShell();
  shell.roots.byName('loading-state').classList.add('is-hidden');
  shell.roots.byName('viewer-ui').classList.remove('is-hidden');

  const commands: ChromeCommands = {
    setMode: noop,
    resetCamera: noop,
    toggleTour: noop,
    toggleFullscreen: noop,
    toggleFurniture: noop,
    openInteriors: noop,
    setLightTemperature: noop,
  };
  const chrome = new ViewerChrome({
    roots: shell.roots,
    viewport: new FullscreenController(shell.roots.viewport),
    messages: shell.messages,
    commands,
    onModePressed: noop,
    onCollapseChanged: noop,
    onDismiss: noop,
  });
  chrome.bind();
  chrome.wake(true);
  chrome.setInteriorsAvailable(true);

  const bar = new TourBar({
    roots: shell.roots,
    messages: shell.messages,
    seek: noop,
    play: noop,
    pause: noop,
    toggle: noop,
    setSpeed: noop,
    onInteraction: noop,
    mode: () => 'tour',
    collapsed: () => false,
    onState: noop,
  });
  bar.bind();
  bar.setEnabled(true);
  bar.setState('playing');

  const panel = new SelectionPanel({ roots: shell.roots, viewport: shell.roots.viewport, onInteraction: noop });
  panel.bind();
  panel.open({
    kind: 'finish',
    title: 'Floor finish',
    items: [{ id: FINISH.oak, label: 'Oak', thumbnail: null, background: '#c8a06a', active: true, dataset: { finish: FINISH.oak } }],
    scope: { label: 'Only this wall', checked: false },
    footer: { label: 'Apply to all floors', onClick: vi.fn() },
    anchor: { x: 300, y: 200 },
    onPick: vi.fn(),
  });
});

afterEach(() => {
  closeContainers();
});

describe('every interactive target is >= 24 x 24 CSS px', () => {
  test('buttons, the slider and links', () => {
    const targets = [...shell.roots.root.querySelectorAll<HTMLElement>('button, [role="slider"], [role="button"], a')].filter(
      (element) => !element.closest('.is-hidden') && getComputedStyle(element).display !== 'none',
    );
    expect(targets.length).toBeGreaterThan(0);
    const undersized: string[] = [];
    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      if (rect.width < MIN_TARGET_PX || rect.height < MIN_TARGET_PX) {
        const name = target.dataset['jeex'] ?? target.dataset['mode'] ?? target.className;
        undersized.push(`${target.tagName.toLowerCase()}[${name}] ${rect.width}x${rect.height}`);
      }
    }
    expect(undersized).toEqual([]);
  });
});
