/**
 * When `<jeex-viewer>` starts its viewer: once it is near the viewport, or on
 * the first pointer press or focus that reaches it, whichever comes first.
 *
 * A pasted player below the fold used to download and build everything at
 * `connectedCallback`: the main chunk, the WebGL context, the procedural
 * textures and the first frame, all competing with the page the visitor is
 * actually looking at. Until it is wanted the element is only its box
 * (`hostBoxCss`), so the page's layout does not move when the viewer arrives.
 *
 * The margin is a constant, not an option: it is about the element's own
 * cost, not about the viewer inside it. It is small on purpose. A boot takes
 * a second or more after the start on a phone whatever the margin, so a wide
 * one would not make the player ready on arrival; it would only start
 * players the visitor never scrolls to. An `IntersectionObserver` ignores its
 * `rootMargin` for a target inside a cross-origin frame, so there the viewer
 * starts when the box itself comes into view.
 *
 * The interactions matter for content a host put inside a light-DOM element
 * (`shadow="none"`), such as its own start button: a press or a focus there
 * starts the viewer even when the observer has not reported yet.
 *
 * One observer serves every element on the page. A browser without
 * `IntersectionObserver` starts at once, as every browser did before.
 */

/** How far above and below the viewport the element counts as near it. */
export const START_MARGIN = '100px 0px';

/** The interactions that start a viewer the observer has not started yet. */
export const START_EVENTS = ['pointerdown', 'focusin'] as const;

/** The element each observed target starts, shared by every element. */
const waiting = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

function sharedObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) waiting.get(entry.target)?.();
    },
    { rootMargin: START_MARGIN },
  );
  return observer;
}

/**
 * Calls `start` once, when `target` nears the viewport or is interacted with.
 * Returns the cancel: a disconnected element must not start later.
 */
export function watchStart(target: Element, start: () => void): () => void {
  if (typeof IntersectionObserver !== 'function') {
    start();
    return () => undefined;
  }
  const listeners = new AbortController();
  const stop = (): void => {
    if (listeners.signal.aborted) return;
    listeners.abort();
    waiting.delete(target);
    observer?.unobserve(target);
  };
  const fire = (): void => {
    if (listeners.signal.aborted) return;
    stop();
    start();
  };
  for (const type of START_EVENTS) target.addEventListener(type, fire, { passive: true, signal: listeners.signal });
  waiting.set(target, fire);
  sharedObserver().observe(target);
  return stop;
}
