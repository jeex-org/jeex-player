/**
 * The viewport box and the fullscreen lifecycle.
 *
 * Fullscreen is DOCUMENT-scoped, so the interesting property is not "does it
 * go fullscreen" — a headless run has no user gesture — but "does viewer A
 * ignore viewer B going fullscreen". That needs two shells in one real
 * document, which is exactly what this level of the pyramid has.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FullscreenController } from '../../src/ui/fullscreen-controller.js';
import { closeContainers, openContainer } from './support.js';

const shells: FullscreenController[] = [];

function open(
  width = 800,
  height = 500,
): { element: HTMLElement; onFullscreenChange: ReturnType<typeof vi.fn>; shell: FullscreenController } {
  const element = openContainer(width, height);
  const onFullscreenChange = vi.fn();
  const shell = new FullscreenController(element, { onFullscreenChange });
  shells.push(shell);
  return { element, onFullscreenChange, shell };
}

beforeEach(() => {
  shells.length = 0;
});

afterEach(() => {
  for (const shell of shells) shell.dispose();
  closeContainers();
});

describe('the box', () => {
  test('reports its element’s measured size and rect', () => {
    const { element, shell } = open(640, 360);
    expect(shell.element).toBe(element);
    expect(shell.clientWidth).toBe(640);
    expect(shell.clientHeight).toBe(360);
    const rect = shell.getBoundingClientRect();
    expect(rect.width).toBeCloseTo(640, 0);
    expect(rect.height).toBeCloseTo(360, 0);
  });

  test('follows its element when the element is resized', () => {
    const { element, shell } = open(640, 360);
    element.style.width = '320px';
    expect(shell.clientWidth).toBe(320);
  });
});

describe('fullscreen', () => {
  test('nothing is fullscreen to begin with', () => {
    const { shell } = open();
    expect(shell.isFullscreen()).toBe(false);
  });

  test('a fullscreenchange with nothing fullscreen is reported: this viewer just left it', () => {
    const { onFullscreenChange } = open();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onFullscreenChange).toHaveBeenCalledWith(false);
  });

  test('the webkit-prefixed event is heard as well', () => {
    const { onFullscreenChange } = open();
    document.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(onFullscreenChange).toHaveBeenCalledWith(false);
  });

  test('one viewer going fullscreen does not flip the other’s button', () => {
    const a = open();
    const b = open();
    // `document.fullscreenElement` is read-only, so the state is staged the
    // only honest way in a test: define it for the length of the check.
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'fullscreenElement');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => a.element });
    try {
      expect(a.shell.isFullscreen()).toBe(true);
      expect(b.shell.isFullscreen()).toBe(false);
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(a.onFullscreenChange).toHaveBeenCalledWith(true);
      // B's root is not the fullscreen element and does not contain it: not its
      // business, so its button is left alone.
      expect(b.onFullscreenChange).not.toHaveBeenCalled();
    } finally {
      delete (document as unknown as Record<string, unknown>)['fullscreenElement'];
      if (descriptor) Object.defineProperty(Document.prototype, 'fullscreenElement', descriptor);
    }
  });

  test('a descendant of the root going fullscreen counts as this viewer’s', () => {
    const { element, shell } = open();
    const inner = document.createElement('div');
    element.appendChild(inner);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => inner });
    try {
      expect(shell.isFullscreen()).toBe(true);
    } finally {
      delete (document as unknown as Record<string, unknown>)['fullscreenElement'];
    }
  });

  test('toggle reports false rather than throwing where the API is missing', async () => {
    const { element, shell } = open();
    // Both spellings taken away — a browser that offers neither is the case the
    // `return false` branch exists for, and Chromium ships the prefixed one.
    // Shadowed with own properties rather than reassigned, so the prototype's
    // methods are put back by `delete` alone.
    for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) {
      Object.defineProperty(element, name, { configurable: true, value: undefined });
    }
    try {
      expect(await shell.toggle()).toBe(false);
    } finally {
      for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) {
        delete (element as unknown as Record<string, unknown>)[name];
      }
    }
  });

  test('toggle reports false rather than throwing when the browser refuses', async () => {
    const { shell } = open();
    // Headless Chromium refuses `requestFullscreen` without a user gesture,
    // which is the real rejection this path exists for.
    expect(await shell.toggle()).toBe(false);
  });

  test('dispose stops the document listeners', () => {
    const { onFullscreenChange, shell } = open();
    shell.dispose();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onFullscreenChange).not.toHaveBeenCalled();
  });
});
