/**
 * `<jeex-viewer>` in a browser that gives no WebGL 2 context: the element
 * hears the viewer's `webgl-unavailable` failure, which the viewer reports
 * before its boot's first await, and enters `:state(error)`.
 *
 * Its own file on purpose: the support probe is memoised once per page, so
 * only a page that has not probed yet can answer "no".
 */

import { afterEach, describe, expect, test } from 'vitest';
import { defineJeexViewer, DEFAULT_TAG } from '../../src/embed/element.js';
import { closeContainers, demoScene, openContainer, until } from './support.js';

const prototype = HTMLCanvasElement.prototype;
const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext')!;
const original = descriptor.value as (this: HTMLCanvasElement, ...args: unknown[]) => unknown;

afterEach(() => {
  Object.defineProperty(prototype, 'getContext', descriptor);
  closeContainers();
});

describe('a browser without WebGL 2', () => {
  test('the element fires jeex-error webgl-unavailable and shows :state(error)', async () => {
    // WebGL 1 only: the probe asks for WebGL 2 and gets nothing.
    Object.defineProperty(prototype, 'getContext', {
      ...descriptor,
      value(this: HTMLCanvasElement, ...args: unknown[]) {
        return args[0] === 'webgl2' ? null : original.apply(this, args);
      },
    });
    defineJeexViewer();
    const url = URL.createObjectURL(new Blob([JSON.stringify(demoScene())], { type: 'application/json' }));
    const element = document.createElement(DEFAULT_TAG);
    element.setAttribute('src', url);
    const codes: string[] = [];
    element.addEventListener('jeex-error', (event) => codes.push(event.detail.code));
    openContainer().appendChild(element);
    await until(() => codes.length > 0, 'the jeex-error event');
    expect(codes).toEqual(['webgl-unavailable']);
    expect(element.matches(':state(error)')).toBe(true);
    element.remove();
    URL.revokeObjectURL(url);
  });
});
