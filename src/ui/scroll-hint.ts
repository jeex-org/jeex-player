/**
 * The «Ctrl + scroll to zoom» plate: what an embedded viewer says when a plain
 * wheel went to the page because the viewer was not engaged (the
 * cooperative-gesture overlay of embedded maps and Photo Sphere Viewer).
 *
 * It appears on a plain wheel over the canvas (`CameraController`'s
 * `onScrollThrough`) and goes away `SCROLL_HINT_MS` after the LAST one, so a
 * page scrolled past the viewer shows it once, briefly, and never holds it up.
 * It takes no pointer input and is hidden from assistive technology: the wheel
 * is a pointer gesture, and repeating a sentence on every notch would be noise.
 *
 * The text is a `data-i18n` key, so `setLocale` retranslates it with the rest
 * of the shell (`applyDomMessages`); Apple platforms get the ⌘ spelling.
 */

import type { Messages } from './messages.js';
import type { MessageKey } from '../shared/messages.js';

/** The `data-jeex` name this module stamps on the plate it creates. */
export const SCROLL_HINT_NAME = 'scroll-hint';

/** How long the plate stays after the last wheel, milliseconds. */
export const SCROLL_HINT_MS = 1500;

export type ScrollHintDeps = {
  /** The viewport box the plate is centred in. */
  container: HTMLElement;
  /** This instance's catalogue at mount; `setLocale` retranslates through `data-i18n`. */
  messages: Messages;
  /** Whether ⌘ is the zoom modifier here; defaults to sniffing an Apple platform. */
  apple?: boolean | undefined;
};

/** Whether this browser runs on an Apple platform, where ⌘ is the modifier. */
function applePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hinted = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return /mac|iphone|ipad/i.test(hinted ?? navigator.userAgent);
}

export class ScrollHint {
  private readonly plate: HTMLDivElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: ScrollHintDeps) {
    const key: MessageKey = (deps.apple ?? applePlatform()) ? 'hint.scrollZoomApple' : 'hint.scrollZoom';
    this.plate = deps.container.ownerDocument.createElement('div');
    this.plate.dataset['jeex'] = SCROLL_HINT_NAME;
    this.plate.className = 'scroll-hint';
    this.plate.setAttribute('part', 'scroll-hint');
    this.plate.setAttribute('aria-hidden', 'true');
    this.plate.dataset['i18n'] = key;
    this.plate.dataset['visible'] = 'false';
    this.plate.textContent = deps.messages.t(key);
    deps.container.appendChild(this.plate);
  }

  /** Shows the plate, or keeps it up: it hides `SCROLL_HINT_MS` after the last call. */
  show(): void {
    this.plate.dataset['visible'] = 'true';
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.plate.dataset['visible'] = 'false';
    }, SCROLL_HINT_MS);
  }

  get visible(): boolean {
    return this.plate.dataset['visible'] === 'true';
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.plate.remove();
  }
}
