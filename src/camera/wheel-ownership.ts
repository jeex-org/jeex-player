/**
 * Who a plain wheel over the canvas belongs to: the viewer, or the page it
 * sits in.
 *
 * The rule is the one embedded maps and panorama viewers settled on
 * («cooperative gestures»): a viewer the user has not engaged must not stop a page from
 * scrolling just because the pointer crossed it. The viewer is ENGAGED when
 *
 * - focus is inside its shell root (a click on the scene focuses the root), or
 * - it is fullscreen, or
 * - there is nothing to scroll: a top-level page that cannot scroll, like the
 *   standalone viewer page or a full-page host editor, which are «engaged by
 *   default».
 *
 * Inside a frame the viewer cannot see whether the HOST page scrolls, so a
 * framed viewer is always cooperative until focused.
 *
 * DOM-only and deliberately duck-typed: under Bun (no `document`) every wheel
 * belongs to the viewer, which is what the unit harnesses have always assumed.
 */

/** `overflow-y` values that let an element scroll its own content. */
const SCROLLING = new Set(['auto', 'scroll', 'overlay']);
/** `overflow-y` values on `<html>`/`<body>` that stop the page scrolling. */
const PAGE_LOCKED = new Set(['hidden', 'clip']);
/** Sub-pixel rounding of `scrollHeight` against `clientHeight`. */
const SLACK_PX = 1;

/** The element's parent, crossing a shadow boundary to its host. */
function composedParent(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode() as Partial<ShadowRoot>;
  return root.host ?? null;
}

/** Whether `root` is, or sits inside, the document's fullscreen element. */
function insideFullscreen(root: Element): boolean {
  const full = document.fullscreenElement;
  if (!full) return false;
  for (let node: Element | null = root; node; node = composedParent(node)) if (node === full) return true;
  return false;
}

/** Whether this document is some other page's frame. */
function framed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin parent refuses the comparison: that is a frame too.
    return true;
  }
}

/** Whether `node` is a scroll container with more content than box. */
function scrollsItself(node: Element): boolean {
  return SCROLLING.has(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + SLACK_PX;
}

/**
 * Whether anything between `from` and the viewport can scroll vertically: an
 * ancestor with scrollable overflow and more content than box, or the page
 * itself when neither `<html>` nor `<body>` locks it.
 *
 * `<body>` counts as such an ancestor when it is a scroll container of its
 * own. That is the theme pattern `html, body { height: 100%; overflow-x:
 * hidden }`: `overflow-x` on `<html>` goes to the viewport, so `<body>`'s
 * `overflow-x: hidden` makes it compute `overflow-y: auto` and scroll its own
 * content, while `<html>` — the `scrollingElement` — never overflows. Before
 * this check such a page read as one that cannot scroll, the viewer took
 * every plain wheel as «engaged by default», zoomed, and stopped the page
 * scrolling.
 */
export function pageScrollsAround(from: Element): boolean {
  const html = document.documentElement;
  const body = document.body as HTMLElement | null;
  for (let node = composedParent(from); node && node !== html && node !== body; node = composedParent(node)) {
    if (scrollsItself(node)) return true;
  }
  // Every viewer in the document sits under `<body>`, through any shadow host.
  if (body !== null && scrollsItself(body)) return true;
  const page = document.scrollingElement ?? html;
  if (page.scrollHeight <= page.clientHeight + SLACK_PX) return false;
  const locked = PAGE_LOCKED.has(getComputedStyle(html).overflowY) || (body !== null && PAGE_LOCKED.has(getComputedStyle(body).overflowY));
  return !locked;
}

/**
 * Whether a plain wheel over the viewer whose shell root is `root` belongs to
 * the viewer (see the module comment). Ctrl/⌘+wheel is not asked about: it
 * always does.
 */
export function viewerOwnsWheel(root: HTMLElement): boolean {
  if (typeof document === 'undefined' || typeof root.matches !== 'function') return true;
  if (root.matches(':focus-within')) return true;
  if (insideFullscreen(root)) return true;
  if (framed()) return false;
  return !pageScrollsAround(root);
}
