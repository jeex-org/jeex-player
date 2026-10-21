/**
 * Which site and page the iframe page's telemetry names (`TELEMETRY.md`).
 *
 * Invariant: `site` is only ever an origin the BROWSER vouched for — the
 * embedding document's origin from `location.ancestorOrigins` where the browser
 * has it, else the bridge's host origin once a message from it passed the
 * source and origin checks — and `null` before that. `page` is only ever the
 * path the host itself handed over in its first `context` command; the frame's
 * own URL never carries it. Both are raw here and sanitised by telemetry.
 */

import { isExactOrigin } from './frame-page.schema.js';
import type { SiteSource } from '../telemetry/browser-host.js';

export class FrameSite implements SiteSource {
  private origin: string | null;
  private path: string | null = null;
  private readonly waiting = new Set<() => void>();

  constructor(win: Window) {
    const ancestor = win.location.ancestorOrigins?.[0];
    this.origin = typeof ancestor === 'string' && isExactOrigin(ancestor) ? ancestor : null;
  }

  site(): string | null {
    return this.origin;
  }

  page(): string | null {
    return this.path;
  }

  /** A message from `origin` passed the bridge's checks. */
  verified(origin: string): void {
    this.origin ??= origin;
  }

  /** The host's `context` command; only the first one counts, and it settles the site. */
  context(page: string): void {
    if (this.path !== null) return;
    this.path = page;
    for (const listener of [...this.waiting]) listener();
    this.waiting.clear();
  }

  /** Calls `listener` once the host's `context` has arrived (at once if it already has). */
  settled(listener: () => void): void {
    if (this.path === null) this.waiting.add(listener);
    else listener();
  }
}
