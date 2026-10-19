/**
 * When the frame page may ask the browser to re-measure it (responsive
 * iframes, `window.requestResize()`).
 *
 * The method throws `NotAllowedError` from a top-level document, from a
 * document whose container is not an `<iframe>`, and from one without the
 * `responsive-embedded-sizing` opt-in (MDN, `Window.requestResize()`), and
 * Chrome 154+ exposes it on every window, framed or not. These cases pin that
 * `embed.html` opened on its own asks nothing, and that a refusal is heard
 * once instead of thrown out of a `ResizeObserver` on every size change.
 */

import { describe, expect, test } from 'bun:test';
import { frameResizeRequester } from './frame-resize.js';

/** A stand-in window: framed unless `topLevel`, with `requestResize` when given one. */
function stubWindow(options: { topLevel?: boolean; requestResize?: () => void }): Window {
  const win = { requestResize: options.requestResize } as { requestResize?: () => void; parent?: unknown };
  win.parent = options.topLevel ? win : {};
  return win as unknown as Window;
}

function notAllowed(): DOMException {
  return new DOMException("Failed to execute 'requestResize' on 'Window'", 'NotAllowedError');
}

describe('frameResizeRequester', () => {
  test('a framed page with responsive iframes asks on every call', () => {
    let calls = 0;
    const request = frameResizeRequester(
      stubWindow({
        requestResize: () => {
          calls += 1;
        },
      }),
    );
    request();
    request();
    expect(calls).toBe(2);
  });

  test('a top-level page never asks, even where the browser has the method', () => {
    let calls = 0;
    const refusals: unknown[] = [];
    const request = frameResizeRequester(
      stubWindow({
        topLevel: true,
        requestResize: () => {
          calls += 1;
          throw notAllowed();
        },
      }),
      (error) => refusals.push(error),
    );
    expect(() => request()).not.toThrow();
    expect(calls).toBe(0);
    expect(refusals).toEqual([]);
  });

  test('a browser without responsive iframes is left alone', () => {
    const request = frameResizeRequester(stubWindow({}));
    expect(() => request()).not.toThrow();
  });

  test('a refusal in a frame is reported once and the page stops asking', () => {
    let calls = 0;
    const refusals: unknown[] = [];
    const request = frameResizeRequester(
      stubWindow({
        requestResize: () => {
          calls += 1;
          throw notAllowed();
        },
      }),
      (error) => refusals.push(error),
    );
    expect(() => request()).not.toThrow();
    expect(() => request()).not.toThrow();
    expect(calls).toBe(1);
    expect(refusals).toHaveLength(1);
    expect((refusals[0] as DOMException).name).toBe('NotAllowedError');
  });
});
