/**
 * The controls hint on a narrow canvas, against the real shell and chrome.
 *
 * At the demo hero's size (16:9, 350 × 197) the full hint covered about half of the
 * scene. Below a 480 px container width the text now waits behind a toggle
 * beside the icon; the card, its `hint` part and its live region are the
 * ones a wide viewer has always had.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ViewerChrome } from '../../src/ui/viewer-chrome.js';
import { FullscreenController } from '../../src/ui/fullscreen-controller.js';
import { closeContainers, openShell, type Shell } from './support.js';

const FULL_CHROME = { brand: true, controls: true, status: true, modeSwitcher: true, hint: true, autoHide: true };

function build(width: number, height: number): { shell: Shell; chrome: ViewerChrome } {
  const shell = openShell(width, height);
  const chrome = new ViewerChrome({
    roots: shell.roots,
    viewport: new FullscreenController(shell.roots.viewport),
    messages: shell.messages,
    commands: {
      setMode: vi.fn(),
      resetCamera: vi.fn(),
      toggleTour: vi.fn(),
      toggleFullscreen: vi.fn(),
      toggleFurniture: vi.fn(),
      openInteriors: vi.fn(),
      setLightTemperature: vi.fn(),
    },
    onModePressed: vi.fn(),
    onCollapseChanged: vi.fn(),
    onDismiss: vi.fn(),
    onRetry: vi.fn(),
  });
  chrome.bind();
  chrome.showViewer();
  return { shell, chrome };
}

/** Whether `element` takes up room on screen. */
function shown(element: HTMLElement): boolean {
  return getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0;
}

afterEach(() => closeContainers());

describe('the hint on a 350 × 197 viewer (the 16:9 demo hero at a 390 px phone width)', () => {
  test('shows its icon and a toggle, not the text', () => {
    const { shell } = build(350, 197);
    const card = shell.roots.byName('hint-card');
    const toggle = shell.roots.byName<HTMLButtonElement>('hint-toggle');
    expect(shown(card)).toBe(true);
    expect(shown(toggle)).toBe(true);
    expect(shown(shell.roots.byName('hint-text'))).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(shell.roots.byName('hint-text').id);
    expect(toggle.getAttribute('aria-label')).toBe('Viewer controls');
  });

  test('a tap on the toggle shows the full text, and a second one hides it', async () => {
    const { shell } = build(350, 197);
    const toggle = shell.roots.byName<HTMLButtonElement>('hint-toggle');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(shown(shell.roots.byName('hint-text'))).toBe(true);
    await userEvent.click(toggle);
    expect(shown(shell.roots.byName('hint-text'))).toBe(false);
  });

  test('Enter on the focused toggle expands it', async () => {
    const { shell } = build(350, 197);
    const toggle = shell.roots.byName<HTMLButtonElement>('hint-toggle');
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  test('the first camera gesture collapses it, also with auto-hide off; moving the pointer does not', async () => {
    const { shell, chrome } = build(350, 197);
    chrome.setChrome({ ...FULL_CHROME, autoHide: false });
    const toggle = shell.roots.byName<HTMLButtonElement>('hint-toggle');
    await userEvent.click(toggle);

    shell.roots.root.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 20, clientY: 20 }));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    chrome.collapseHint();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(shown(shell.roots.byName('hint-text'))).toBe(false);
  });

  test('the card keeps its part and its live region', () => {
    const { shell } = build(350, 197);
    expect(shell.roots.byName('hint-card').getAttribute('part')).toBe('hint');
    expect(shell.roots.byName('hint-text').getAttribute('aria-live')).toBe('polite');
  });
});

describe('the hint on a wide viewer', () => {
  test('is unchanged: the text shows and the toggle is out of the layout and the tab order', () => {
    const { shell } = build(800, 600);
    const toggle = shell.roots.byName<HTMLButtonElement>('hint-toggle');
    expect(shown(shell.roots.byName('hint-text'))).toBe(true);
    expect(getComputedStyle(toggle).display).toBe('none');
  });

  test('collapseHint changes nothing there', () => {
    const { shell, chrome } = build(800, 600);
    chrome.collapseHint();
    expect(shown(shell.roots.byName('hint-text'))).toBe(true);
  });
});

describe('the reveal button and the fading control bar', () => {
  /** A CSS time list's first entry, in seconds. */
  const seconds = (value: string): number => {
    const first = value.split(',')[0]!.trim();
    return first.endsWith('ms') ? Number(first.slice(0, -2)) / 1000 : Number(first.slice(0, -1));
  };

  test('the "•••" button starts to appear only once the bar has finished fading out, so the two never show together', () => {
    const { shell } = build(350, 197);
    const bar = shell.roots.byName('control-bar');
    const reveal = shell.roots.byName('reveal-controls');
    bar.classList.add('is-collapsed');
    reveal.classList.add('is-visible');
    const barFade = seconds(getComputedStyle(bar).transitionDuration);
    expect(barFade).toBeGreaterThan(0);
    expect(seconds(getComputedStyle(reveal).transitionDelay)).toBeGreaterThanOrEqual(barFade);
  });

  test('when the bar comes back, the button leaves at once rather than lingering over it', () => {
    const { shell } = build(350, 197);
    const reveal = shell.roots.byName('reveal-controls');
    expect(reveal.classList.contains('is-visible')).toBe(false);
    expect(seconds(getComputedStyle(reveal).transitionDelay)).toBe(0);
  });
});
