/**
 * The element box a renderer's drawing buffer follows: what one
 * `ResizeObserver` reading says in CSS and in device pixels, the observer
 * itself, and the window's device pixel ratio (`render-runtime.ts`).
 */

/**
 * Element box the drawing buffer follows.
 *
 * `element` is optional so a unit harness can hand over a plain measurement,
 * but a real mount always passes one: it is what the `ResizeObserver` watches,
 * and a container that changes size without the WINDOW resizing (a flex
 * reflow, a `<details>` opening, a host layout change) is exactly the case a
 * `window` resize listener never saw.
 */
export type ViewportBox = { clientWidth: number; clientHeight: number; element?: HTMLElement };

/**
 * One `ResizeObserver` reading, in both units.
 *
 * The device box is the load-bearing half: computing it as `cssBox ×
 * devicePixelRatio` after CSS has already rounded the layout leaves a
 * half-pixel of blur on a fractional-DPR display, which is exactly what
 * `devicePixelContentBoxSize` exists to avoid. It is Chromium 84+ / Firefox
 * 108+ and NOT Baseline (no Safari), so both paths ship.
 */
export type ObservedBox = { cssWidth: number; cssHeight: number; deviceWidth: number; deviceHeight: number };

/**
 * Measures one observer entry in CSS and in device pixels; `null` for a box
 * with no area (a hidden container reports zero and must not resize anything).
 */
export function measureEntry(entry: ResizeObserverEntry, pixelRatio: number): ObservedBox | null {
  const content = entry.contentBoxSize?.[0];
  const cssWidth = content ? content.inlineSize : entry.contentRect.width;
  const cssHeight = content ? content.blockSize : entry.contentRect.height;
  if (cssWidth <= 0 || cssHeight <= 0) return null;
  const device = entry.devicePixelContentBoxSize?.[0];
  return {
    cssWidth,
    cssHeight,
    deviceWidth: device ? device.inlineSize : Math.round(cssWidth * pixelRatio),
    deviceHeight: device ? device.blockSize : Math.round(cssHeight * pixelRatio),
  };
}

/**
 * Watches a viewport box for size changes.
 *
 * The observer sees the CONTAINER, so an embedded viewer follows its own box
 * rather than the window; a box with no element (a unit harness) and an
 * environment with no `ResizeObserver` both simply get no watch, which is the
 * truthful answer — never a `window` listener standing in for one, because
 * that reports the wrong element's size.
 */
export function observeBox(box: ViewportBox, onObserve: ResizeObserverCallback): ResizeObserver | null {
  if (!box.element || typeof ResizeObserver === 'undefined') return null;
  const observer = new ResizeObserver(onObserve);
  // `device-pixel-content-box` is asked for explicitly: without it the entry
  // carries no `devicePixelContentBoxSize` even where the browser supports it.
  // A browser that does not know the value throws, and the CSS box is then the
  // only reading there is.
  try {
    observer.observe(box.element, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(box.element);
  }
  return observer;
}

/** `window.devicePixelRatio` where there is a window, 1 elsewhere. */
export function devicePixelRatioOf(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio;
}
