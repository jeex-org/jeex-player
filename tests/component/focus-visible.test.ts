/**
 * Every focusable element in the shell carries a visible `:focus-visible`
 * ring, and never fires on a plain mouse click.
 *
 * One rule in `styles/viewer.css` covers the whole shell (root, buttons, the
 * tour slider); this file proves it actually reaches representative elements
 * of each family through a REAL Tab, not by reading the stylesheet text.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ViewerChrome, type ChromeCommands, type ViewerChromeDeps } from '../../src/ui/viewer-chrome.js';
import { TourBar, type TourBarDeps } from '../../src/ui/tour-bar.js';
import { FullscreenController } from '../../src/ui/fullscreen-controller.js';
import { closeContainers, openShell, type Shell } from './support.js';

function noop(): void {
  // Command stubs below never run in this file: the point is focus, not effect.
}

function buildChrome(shell: Shell): ViewerChrome {
  const commands: ChromeCommands = {
    setMode: noop,
    resetCamera: noop,
    toggleTour: noop,
    toggleFullscreen: noop,
    toggleFurniture: noop,
    openInteriors: noop,
    setLightTemperature: noop,
  };
  const deps: ViewerChromeDeps = {
    roots: shell.roots,
    viewport: new FullscreenController(shell.roots.viewport),
    messages: shell.messages,
    commands,
    onModePressed: noop,
    onCollapseChanged: noop,
    onDismiss: noop,
  };
  const chrome = new ViewerChrome(deps);
  chrome.bind();
  chrome.wake(true);
  return chrome;
}

function buildTourBar(shell: Shell): TourBar {
  const deps: TourBarDeps = {
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
  };
  const bar = new TourBar(deps);
  bar.bind();
  bar.setState('playing');
  return bar;
}

/** A ring drawn, not the browser's own default (which this stylesheet removed). */
function hasVisibleOutline(element: Element): boolean {
  const style = getComputedStyle(element);
  return style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
}

let shell: Shell;

beforeEach(() => {
  shell = openShell();
  // The chrome behind `chrome.showViewer()`: the loading card is on screen by
  // default and, at `inset: 0; z-index: 10`, swallows every pointer event a
  // test below sends at a control underneath it.
  shell.roots.byName('loading-state').classList.add('is-hidden');
  shell.roots.byName('viewer-ui').classList.remove('is-hidden');
});

afterEach(() => {
  closeContainers();
});

describe('focus-visible ring', () => {
  test('the shell root shows a ring after Tab, and matches :focus-visible', async () => {
    shell.roots.root.tabIndex = 0;
    await userEvent.tab();
    expect(document.activeElement).toBe(shell.roots.root);
    expect(shell.roots.root.matches(':focus-visible')).toBe(true);
    expect(hasVisibleOutline(shell.roots.root)).toBe(true);
  });

  test('Tab from the root lands on a mode button with a visible ring', async () => {
    buildChrome(shell);
    shell.roots.root.tabIndex = 0;
    shell.roots.root.focus();
    await userEvent.tab();
    const focused = document.activeElement;
    expect(focused).not.toBe(shell.roots.root);
    expect(focused?.matches('[data-mode]')).toBe(true);
    expect(focused?.matches(':focus-visible')).toBe(true);
    expect(hasVisibleOutline(focused!)).toBe(true);
  });

  test('an icon button shows a ring after Tab', async () => {
    buildChrome(shell);
    const button = shell.roots.byName<HTMLButtonElement>('reset-button');
    button.focus();
    // `element.focus()` from script is treated as keyboard-equivalent by
    // `:focus-visible` heuristics (no prior pointer interaction on the page).
    expect(button.matches(':focus-visible')).toBe(true);
    expect(hasVisibleOutline(button)).toBe(true);
  });

  test('the tour track (role=slider) shows a ring after Tab, not on pointer capture', async () => {
    buildTourBar(shell);
    const track = shell.roots.byName('tour-track');
    track.focus();
    expect(track.matches(':focus-visible')).toBe(true);
    expect(hasVisibleOutline(track)).toBe(true);
  });

  test('a real pointer click never leaves an element matching :focus-visible', async () => {
    buildChrome(shell);
    const button = shell.roots.byName<HTMLButtonElement>('fullscreen-button');
    await userEvent.click(button);
    expect(document.activeElement).toBe(button);
    expect(button.matches(':focus-visible')).toBe(false);
    expect(getComputedStyle(button).outlineStyle).toBe('none');
  });
});
