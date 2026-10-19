/**
 * Who owns `window.__viewerDebug`, `window.__appReady` and
 * `window.__viewerReadyAt`.
 *
 * There is exactly one `window` and there may be several viewers in it, so
 * these three are a claim rather than a broadcast: the FIRST instance to mount
 * takes them, every later one leaves them alone, and only the owner may write
 * or delete. Before this, the second mount silently replaced the first one's
 * debug surface and the first one's `dispose()` deleted the second's.
 *
 * The globals themselves are a check-and-automation surface
 * (`scripts/browser-check.ts`), not a public API — a page that wants a handle
 * gets one from `mountViewer` (and the demo publishes `window.jeexViewer`
 * itself, in `main.ts`, which is a decision of the PAGE).
 *
 * Ownership is by IDENTITY, not by count: `release(owner)` from anything but
 * the current owner does nothing at all, so disposing viewer #2 cannot blind
 * viewer #1, and disposing #1 hands the claim back so a later mount can take
 * it.
 */

let currentOwner: object | null = null;

export const viewerGlobals = {
  /**
   * Claims the page globals for `owner`. `true` when this owner now holds them
   * — including a repeat claim by the current owner, which is a no-op — and
   * `false` when someone else already does.
   */
  claim(owner: object): boolean {
    if (currentOwner === owner) return true;
    if (currentOwner !== null) return false;
    currentOwner = owner;
    return true;
  },

  /** Gives the claim back, if `owner` is the one holding it. */
  release(owner: object): void {
    if (currentOwner === owner) currentOwner = null;
  },
};
