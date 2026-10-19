/**
 * The viewport element: the box everything else measures against (the renderer
 * drawing buffer, the anchored panel) and the fullscreen lifecycle including
 * the WebKit-prefixed spelling.
 *
 * Invariant: safe areas are pure CSS — `100svh` and `env(safe-area-inset-*)`
 * in `style.css` — so the controller only guarantees the element those rules
 * apply to and never writes layout values itself.
 */

import { linkedAbortController } from '../shared/abort.js';

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

type FullscreenControllerOptions = {
  /** Fired whenever the browser enters or leaves fullscreen, however it was triggered. */
  onFullscreenChange?: (fullscreen: boolean) => void;
  /** The mounted viewer's lifetime; the two `document` listeners carry it. */
  signal?: AbortSignal | undefined;
};

export class FullscreenController {
  readonly element: HTMLElement;
  private readonly options: FullscreenControllerOptions;
  /**
   * The two `document` listeners' lifetime.
   *
   * Its OWN controller, linked to the mount's signal, and it is the one class
   * in the UI layer that needs one: every other listener in the viewer is on a
   * node of its own shell and goes when the shell does, but these two are on
   * the host's `document` and would outlive it. So `dispose()` still means
   * something on its own, and a disposed viewer unwinds them either way.
   */
  private readonly listeners: AbortController;
  /**
   * Fullscreen is inherently DOCUMENT-scoped: there is one fullscreen element
   * per document and every viewer on the page hears every change. So this one
   * reacts only when the element that went fullscreen is THIS root or lives
   * inside it — otherwise a second viewer going fullscreen would flip the
   * first one's button.
   */
  private readonly onChange = (): void => {
    if (!this.concernsThisRoot()) return;
    this.options.onFullscreenChange?.(this.isFullscreen());
  };

  constructor(element: HTMLElement, options: FullscreenControllerOptions = {}) {
    this.element = element;
    this.options = options;
    this.listeners = linkedAbortController(options.signal);
    const listener = { signal: this.listeners.signal };
    // The element's OWN document, not the global: a viewer mounted into an
    // iframe fullscreens against that frame's document, never the host page's.
    const document = this.element.ownerDocument;
    document.addEventListener('fullscreenchange', this.onChange, listener);
    document.addEventListener('webkitfullscreenchange', this.onChange, listener);
  }

  get clientWidth(): number {
    return this.element.clientWidth;
  }

  get clientHeight(): number {
    return this.element.clientHeight;
  }

  getBoundingClientRect(): DOMRect {
    return this.element.getBoundingClientRect();
  }

  /** True while THIS root (or something inside it) is the fullscreen element. */
  isFullscreen(): boolean {
    return this.fullscreenElement() !== null && this.concernsThisRoot();
  }

  private fullscreenElement(): Element | null {
    const document = this.element.ownerDocument as WebkitDocument;
    return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
  }

  /**
   * Whether the current fullscreen state is this viewer's business: nothing is
   * fullscreen (so a change means this one just left it), or the fullscreen
   * element is this root or an ancestor/descendant of it.
   */
  private concernsThisRoot(): boolean {
    const active = this.fullscreenElement();
    if (!active) return true;
    return active === this.element || active.contains(this.element) || this.element.contains(active);
  }

  /** Enters or leaves fullscreen. Returns `false` when the browser offers no API for it. */
  async toggle(): Promise<boolean> {
    try {
      const doc = this.element.ownerDocument as WebkitDocument;
      const element = this.element as WebkitElement;
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (doc.fullscreenElement) await doc.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
      } else if (this.element.requestFullscreen) {
        await this.element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        await element.webkitRequestFullscreen();
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Detaches both `document` listeners; the mount's signal does the same thing. */
  dispose(): void {
    this.listeners.abort();
  }
}
