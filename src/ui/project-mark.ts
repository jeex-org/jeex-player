/**
 * The producer's mark over a project: «Made with JEEX» in the
 * viewport's top-left corner, a link to `BakedProjectManifest.mark.href`.
 *
 * It is DATA-driven on purpose. A baked project may carry `mark` in its
 * manifest, written by the producer, and the viewer shows it for every project that carries it — no option turns it off:
 * `readonly`, `unbranded`, the `kiosk`/`embed` overlays and `chrome` all leave
 * it alone. That is what keeps an embedder from removing it with an attribute
 * or a query parameter. (Residual risk, accepted: a host page can still reach
 * into an open shadow root or the frame-less light DOM with its own CSS or
 * script; the node therefore carries no `part`, so `::part()` cannot style it.)
 *
 * Small and non-blocking: one line of text, the only node here that takes the
 * pointer is the link itself, and it never covers the canvas centre.
 */

import type { Messages } from './messages.js';

/** The `data-jeex` name of the link this module creates. */
export const PROJECT_MARK_NAME = 'project-mark';

export type ProjectMarkDeps = {
  /** The viewport box the mark sits in. */
  container: HTMLElement;
  /** This instance's catalogue; `setLocale` retranslates through `data-i18n`. */
  messages: Messages;
};

export class ProjectMark {
  private readonly deps: ProjectMarkDeps;
  private link: HTMLAnchorElement | null = null;

  constructor(deps: ProjectMarkDeps) {
    this.deps = deps;
  }

  /** Shows the mark a manifest asks for, or removes it (`null`: a bare scene, or a project without one). */
  set(mark: { readonly href: string } | null | undefined): void {
    if (!mark) {
      this.link?.remove();
      this.link = null;
      return;
    }
    if (!this.link) {
      const link = this.deps.container.ownerDocument.createElement('a');
      link.dataset['jeex'] = PROJECT_MARK_NAME;
      link.className = 'project-mark';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset['i18n'] = 'mark.madeWith';
      link.textContent = this.deps.messages.t('mark.madeWith');
      this.deps.container.appendChild(link);
      this.link = link;
    }
    this.link.href = mark.href;
  }

  dispose(): void {
    this.link?.remove();
    this.link = null;
  }
}
