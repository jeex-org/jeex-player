/**
 * Who owns the wheel and Space, on a real DOM (focus and embedding).
 *
 * `camera-input.test.ts` pins what the input does with the answer; this file
 * pins the answer itself — focus, a scrolling ancestor, a locked page — and
 * the parts only a browser has: a real focused button taking Space, a real
 * `visibilitychange`, the plate's own timer. No viewer is mounted: the
 * question is about the page, not about the scene.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { CameraInput, type CameraGesture } from '../../src/camera/camera-input.js';
import { pageScrollsAround, viewerOwnsWheel } from '../../src/camera/wheel-ownership.js';
import { SCROLL_HINT_MS, ScrollHint } from '../../src/ui/scroll-hint.js';
import { createMessages } from '../../src/ui/messages.js';

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const undo of cleanup.splice(0).reverse()) undo();
  vi.useRealTimers();
});

/** A shell-like root (focusable, with a canvas and a button) inside `host`. */
function viewerIn(host: HTMLElement): { root: HTMLElement; canvas: HTMLCanvasElement; button: HTMLButtonElement } {
  const root = document.createElement('div');
  root.tabIndex = 0;
  root.style.cssText = 'position:relative;width:400px;height:300px';
  const canvas = document.createElement('canvas');
  const button = document.createElement('button');
  button.textContent = 'reset';
  root.append(canvas, button);
  host.appendChild(root);
  return { root, canvas, button };
}

/** A box that scrolls: fixed height, `overflow: auto`, content twice as tall. */
function scrollingBox(): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText = 'height:320px;overflow:auto';
  const tall = document.createElement('div');
  tall.style.cssText = 'height:1200px';
  box.appendChild(tall);
  document.body.appendChild(box);
  cleanup.push(() => box.remove());
  return tall;
}

/** `<html>` and `<body>` locked, the way the standalone viewer page locks them. */
function lockPage(): void {
  const before = [document.documentElement.style.overflow, document.body.style.overflow];
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  cleanup.push(() => {
    document.documentElement.style.overflow = before[0] ?? '';
    document.body.style.overflow = before[1] ?? '';
  });
}

function input(root: HTMLElement, canvas: HTMLElement, seen: CameraGesture[]): CameraInput {
  const built = new CameraInput({ canvas, keys: root }, (gesture) => {
    seen.push(gesture);
    return gesture.type === 'zoom' || gesture.type === 'pan';
  });
  cleanup.push(() => built.dispose());
  return built;
}

describe('pageScrollsAround', () => {
  test('an ancestor with more content than box scrolls', () => {
    const { root } = viewerIn(scrollingBox());
    expect(pageScrollsAround(root)).toBe(true);
  });

  test('a page whose BODY is the scroller scrolls (`html, body { height: 100%; overflow-x: hidden }`)', () => {
    // The theme pattern that made an embedded viewer zoom instead of letting
    // the page scroll (a reported bug): `overflow-x` on
    // both makes `<body>` the scroll container, so `<html>` never overflows.
    const html = document.documentElement;
    const body = document.body;
    const before = [html.style.cssText, body.style.cssText];
    html.style.cssText = 'height:100%;overflow-x:hidden';
    body.style.cssText = 'height:100%;margin:0;overflow-x:hidden';
    cleanup.push(() => {
      html.style.cssText = before[0] ?? '';
      body.style.cssText = before[1] ?? '';
    });
    const tall = document.createElement('div');
    tall.style.cssText = 'height:3000px';
    body.appendChild(tall);
    cleanup.push(() => tall.remove());
    const { root } = viewerIn(tall);
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    expect(pageScrollsAround(root)).toBe(true);
    expect(viewerOwnsWheel(root)).toBe(false);
  });

  test('in a locked page with nothing else to scroll, nothing scrolls', () => {
    lockPage();
    const host = document.createElement('div');
    document.body.appendChild(host);
    cleanup.push(() => host.remove());
    const { root } = viewerIn(host);
    expect(pageScrollsAround(root)).toBe(false);
  });
});

describe('viewerOwnsWheel', () => {
  test('focus inside the root engages the viewer, wherever it sits', () => {
    const { root, button } = viewerIn(scrollingBox());
    expect(viewerOwnsWheel(root)).toBe(false);
    root.focus();
    expect(viewerOwnsWheel(root)).toBe(true);
    button.focus();
    expect(viewerOwnsWheel(root)).toBe(true);
    button.blur();
    expect(viewerOwnsWheel(root)).toBe(false);
  });
});

describe('CameraInput on a real page', () => {
  test('a plain wheel over an unfocused viewer in a scrolling box is the page’s; after focus it is the viewer’s', () => {
    const { root, canvas } = viewerIn(scrollingBox());
    const seen: CameraGesture[] = [];
    input(root, canvas, seen);
    const unfocused = new WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true });
    canvas.dispatchEvent(unfocused);
    expect(unfocused.defaultPrevented).toBe(false);
    expect(seen.map((gesture) => gesture.type)).toEqual(['scroll-through']);

    const pinch = new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, bubbles: true, cancelable: true });
    canvas.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);

    root.focus();
    const focused = new WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true });
    canvas.dispatchEvent(focused);
    expect(focused.defaultPrevented).toBe(true);
    expect(seen.map((gesture) => gesture.type)).toEqual(['scroll-through', 'zoom', 'zoom']);
  });

  test('Space on the focused root is taken; Space on a focused button inside it is left to the button', () => {
    const { root, canvas, button } = viewerIn(scrollingBox());
    input(root, canvas, []);
    root.focus();
    const onRoot = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    root.dispatchEvent(onRoot);
    expect(onRoot.defaultPrevented).toBe(true);
    root.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));

    button.focus();
    const onButton = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    button.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(false);
  });

  test('a hidden tab ends the Space latch, like a blur', () => {
    const { root, canvas } = viewerIn(scrollingBox());
    const seen: CameraGesture[] = [];
    input(root, canvas, seen);
    root.focus();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(canvas.dataset['jeexMove']).toBe('true');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(canvas.dataset['jeexMove']).toBe('false');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, bubbles: true }));
    const press = seen.find((gesture) => gesture.type === 'press');
    expect(press).toMatchObject({ move: false });
  });
});

describe('ScrollHint', () => {
  test('shows on a scroll-through, stays while the wheel goes on, and hides after the last one', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    cleanup.push(() => container.remove());
    const hint = new ScrollHint({ container, messages: createMessages('en'), apple: false });
    cleanup.push(() => hint.dispose());
    const plate = container.querySelector<HTMLElement>('[data-jeex="scroll-hint"]')!;
    expect(plate.textContent).toBe('Use Ctrl + scroll to zoom');
    expect(plate.getAttribute('aria-hidden')).toBe('true');
    expect(hint.visible).toBe(false);
    hint.show();
    expect(hint.visible).toBe(true);
    vi.advanceTimersByTime(SCROLL_HINT_MS - 100);
    hint.show();
    vi.advanceTimersByTime(SCROLL_HINT_MS - 100);
    expect(hint.visible).toBe(true);
    vi.advanceTimersByTime(200);
    expect(hint.visible).toBe(false);
  });

  test('Apple platforms get the ⌘ spelling, and the plate carries its key for setLocale', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    cleanup.push(() => container.remove());
    const hint = new ScrollHint({ container, messages: createMessages('ru'), apple: true });
    cleanup.push(() => hint.dispose());
    const plate = container.querySelector<HTMLElement>('[data-jeex="scroll-hint"]')!;
    expect(plate.dataset['i18n']).toBe('hint.scrollZoomApple');
    expect(plate.textContent).toContain('⌘');
  });
});
