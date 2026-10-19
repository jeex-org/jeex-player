/**
 * One viewer instance's side of the page globals: whether it holds the claim,
 * and everything it may write while it does.
 *
 * `viewer-globals.ts` answers WHO owns `window.__viewerDebug`,
 * `window.__appReady` and `window.__viewerReadyAt`; this answers what the owner
 * writes and when it gives them back. The composition root holds one of these
 * and never touches `window` itself — which is the point: a viewer that is not
 * the owner must be unable to write a global by accident, and the compiler
 * cannot enforce that when every call site repeats an `if (this.ownsGlobals)`.
 *
 * Claim invariant: the claim is taken in `claim()` and can be taken AGAIN after
 * a release — the Retry path disposes the instance and boots it once more, and
 * an instance that came back must own the globals it used to own rather than
 * writing them without holding the claim.
 */

import { viewerGlobals } from './viewer-globals.js';
import { installViewerDebug, type ViewerDebugHost } from './viewer-debug.js';

export class ViewerPageGlobals {
  /** Whatever identity `viewer-globals.ts` keys the claim on; the owning app. */
  private readonly owner: object;
  private owned = false;

  constructor(owner: object) {
    this.owner = owner;
  }

  /** Takes the claim if it is free (or already this instance's). */
  claim(): boolean {
    this.owned = viewerGlobals.claim(this.owner);
    return this.owned;
  }

  /** Whether this instance may write the globals right now. */
  get owns(): boolean {
    return this.owned;
  }

  /**
   * `__appReady` and `__viewerReadyAt`: the page-level signal a browser check
   * and an embedding page wait on. Measured from navigation start
   * (`performance.timeOrigin`).
   */
  publishReady(): void {
    if (!this.owned) return;
    window.__viewerReadyAt = performance.now();
    window.__appReady = true;
  }

  /** Installs `__viewerDebug` over `host`, whose every member is a getter. */
  installDebug(host: ViewerDebugHost): void {
    if (!this.owned) return;
    installViewerDebug(host);
  }

  /**
   * Takes the globals down and gives the claim back. A viewer that never held
   * the claim leaves every one of them alone: disposing viewer #2 must not
   * blind viewer #1.
   */
  release(): void {
    if (!this.owned) return;
    delete window.__viewerDebug;
    delete window.__viewerReadyAt;
    window.__appReady = false;
    viewerGlobals.release(this.owner);
    this.owned = false;
  }
}
