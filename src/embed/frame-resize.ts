/**
 * The frame page's request to the browser to re-measure it (responsive
 * iframes, `window.requestResize()`), asked only where it can be granted.
 *
 * `requestResize()` throws a `NotAllowedError` when it is called from a
 * top-level document, when the document's container is not an `<iframe>`, and
 * when the document did not opt in with `<meta name="responsive-embedded-sizing">`
 * (MDN, `Window.requestResize()`, checked 2026-10-19). Chrome 154+ exposes the
 * method on every window, framed or not, so a feature check alone let
 * `embed.html` opened on its own throw out of its first measurement and out of
 * every `ResizeObserver` callback after it (Chrome 156, 2026-10-19).
 *
 * So the requester asks only from a nested document (`win.parent !== win`),
 * and treats a refusal there (an `<object>` or `<embed>` container, a page
 * without the opt-in) as final: none of the three conditions changes over a
 * document's life, and the meta cannot be added after load. The refusal is
 * handed to `onRefused` once; the caller's own `size` reporting goes on.
 */

/** `window.requestResize`, where the browser has responsive iframes. */
type ResizableWindow = Window & { requestResize?: () => void };

/** Returns the function the size watch calls on every change of the content box. */
export function frameResizeRequester(win: Window, onRefused?: (error: unknown) => void): () => void {
  const target = win as ResizableWindow;
  // A top-level document has no container to resize; it is its own parent.
  let allowed = target.parent !== target;
  return () => {
    if (!allowed || typeof target.requestResize !== 'function') return;
    try {
      target.requestResize();
    } catch (error) {
      allowed = false;
      onRefused?.(error);
    }
  };
}
