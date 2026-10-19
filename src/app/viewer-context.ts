/**
 * One mounted viewer's context: the three things every module of the DOM layer
 * needs per instance, never through a module-level global.
 *
 * - `roots` replaces `document.getElementById`: every lookup is scoped to THIS
 *   instance's shell (`viewer-shell.ts`).
 * - `messages` replaces the process-wide locale: two viewers on one page each
 *   hold their own catalogue and answer in their own language at the same time
 *   (`messages.ts`).
 * - `styleRoot` is the document or shadow root the component stylesheet was
 *   adopted into — what the custom element needs to put a viewer inside a shadow root
 *   without any module here learning about shadow DOM.
 *
 * Invariant: the context is built ONCE per mount, before anything else exists,
 * and is read-only from then on. Nothing here is mutable state; a viewer that
 * changes locale rebuilds the catalogue and re-applies it, it does not write
 * into a shared one.
 *
 * Lifetime invariant: the context also owns this instance's `AbortController`.
 * Every `addEventListener` under a mounted viewer is bound with `signal`, and
 * NOTHING pairs it with a `removeEventListener` — `release()` aborts the one
 * controller, gives the stylesheet claim back and removes the shell from the
 * host's container, so a container that held a viewer holds nothing at all
 * afterwards. The thing that created the markup is the thing that takes it
 * away again.
 */

import { ViewerLibError } from '../shared/errors.js';
import { applyDomMessages, createMessages, type Locale, type Messages } from '../ui/messages.js';
import { HostSlots, type SlotName } from '../ui/host-slots.js';
import { createViewerShell, releaseViewerStyles, styleRootOf, type ViewerRoots } from '../ui/viewer-shell.js';
import { SlotAnchor, viewerSlots } from './slot-anchor.js';
import type { ViewerSlots } from './viewer-handle.js';

/**
 * What a boot cut short by `dispose()` rejects with.
 *
 * It exists so the two things that see it can tell it apart from a real
 * failure: the composition root does not raise an error card into a shell it
 * has just removed, and `mountViewer` does not log a mount the host itself
 * ended.
 */
export class ViewerDisposedError extends ViewerLibError {
  declare readonly code: 'disposed';

  constructor() {
    super('disposed', 'viewer: disposed before the scene was on screen');
    this.name = 'ViewerDisposedError';
  }
}

export type ViewerContext = {
  /** Element references of this instance's shell. */
  readonly roots: ViewerRoots;
  /** `t(key, params)` bound to this instance's locale. */
  readonly messages: Messages;
  /** Where this instance's stylesheet lives: a document, or a shadow root. */
  readonly styleRoot: Document | ShadowRoot;
  /** The host's own boxes inside this shell, and the anchor, as `ViewerHandle` sees them. */
  readonly slots: ViewerSlots;
  /** The same anchor, for the frame hook that has to drive it (`viewer-frame.ts`). */
  readonly anchor: SlotAnchor;
  /**
   * This mount's lifetime. Every listener the viewer binds carries it, so
   * `release()` unwinds all of them at once — including the ones on nodes the
   * viewer does not own (`document`'s fullscreen change, the host's canvas).
   */
  readonly signal: AbortSignal;
  /**
   * Switches this instance to another locale: re-translates the shell's static
   * copy and hands back the new catalogue for everything that writes its own.
   * Nothing is mutated — a `Messages` is immutable — so a viewer in another
   * language on the same page is untouched.
   */
  retranslate(locale: Locale): Messages;
  /** Idempotent: aborts every listener, disowns the sheet, removes the shell. */
  release(): void;
};

/**
 * Builds the shell inside `container` and returns the context around it. The
 * shell is translated at construction, which is why the locale is needed here
 * and not later; `slots` is needed here for the same reason — the host's boxes
 * are built with the shell, so `handle.slots` works before any scene exists.
 */
export function createViewerContext(container: HTMLElement, locale: Locale, slots: readonly SlotName[]): ViewerContext {
  const messages = createMessages(locale);
  const roots = createViewerShell(container, messages);
  // AFTER the shell tree: `HostSlots` appends, and being last is what makes a
  // slot win a `z-index` tie against the viewer's own chrome (its header).
  const hostSlots = new HostSlots(roots.root, slots);
  const anchor = new SlotAnchor((point) => hostSlots.setAnchor(point));
  const styleRoot = styleRootOf(container);
  const listeners = new AbortController();
  let released = false;
  return {
    roots,
    messages,
    styleRoot,
    slots: viewerSlots(hostSlots, anchor),
    anchor,
    signal: listeners.signal,
    retranslate: (next) => {
      const catalogue = createMessages(next);
      applyDomMessages(roots.root, catalogue);
      // The shell's language follows its copy — the CANONICAL
      // tag, so `setLocale('sr')` leaves `lang="sr-Latn"` on the shell.
      roots.root.lang = catalogue.locale;
      return catalogue;
    },
    release: () => {
      if (released) return;
      released = true;
      listeners.abort();
      releaseViewerStyles(styleRoot);
      roots.root.remove();
    },
  };
}
