/**
 * The "Replace with another…" popup: a modal list of the assets the selected
 * object can be replaced with, grouped by category.
 *
 * Viewer-local, not a native modal `<dialog>`: `showModal()` makes the whole
 * containing document inert, the host page included, which an embeddable
 * component must not do (`selection-panel.ts` gives the full reason). So it is
 * a backdrop inside the shell holding a titled `role="dialog"` card, with the
 * same root-aware Tab trap the panel uses, Escape and a close button, and focus
 * handed back to the control that opened it.
 *
 * WHAT is offered is `assets/replace-offers.ts`'s; this module only shows a
 * request and reports the pick, like the panel.
 *
 * Machine-readable state: `data-open` on the popup, `data-offer` on each item.
 */

import type { ViewerRoots } from './viewer-shell.js';
import { focusablesOf, swatch, type PanelItem } from './selection-panel.js';
import { listenerOptions } from '../shared/abort.js';

/** One category of the list, already labelled. */
export type ReplacePopupGroup = { readonly label: string; readonly items: readonly PanelItem[] };

/** What the popup shows and where a pick goes. */
export type ReplacePopupRequest = {
  readonly title: string;
  /** The empty state's text, shown when no group has an item. */
  readonly empty: string;
  readonly groups: readonly ReplacePopupGroup[];
  readonly onPick: (id: string) => void;
};

type ReplacePopupDeps = {
  roots: ViewerRoots;
  /** The mounted viewer's lifetime; every item's listener ends with it. */
  signal?: AbortSignal | undefined;
};

/** Makes each title id unique on the page: two viewers' popups must not share one. */
let titleSequence = 0;

export class ReplacePopup {
  private readonly deps: ReplacePopupDeps;
  private readonly popup: HTMLElement;
  private readonly card: HTMLElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private request: ReplacePopupRequest | null = null;
  /** Whatever had focus when the popup opened, read off this root's own `activeElement`. */
  private opener: HTMLElement | null = null;
  private bound = false;

  constructor(deps: ReplacePopupDeps) {
    const { byName } = deps.roots;
    this.deps = deps;
    this.popup = byName('replace-popup');
    this.title = byName('replace-popup-title');
    this.list = byName('replace-popup-list');
    this.empty = byName('replace-popup-empty');
    this.card = this.title.closest<HTMLElement>('[role="dialog"]')!;
    titleSequence += 1;
    this.title.id = `jeex-replace-popup-title-${titleSequence}`;
    this.card.setAttribute('aria-labelledby', this.title.id);
  }

  /** Binds the close button, the backdrop and the Tab trap. Idempotent, as `SelectionPanel.bind` is. */
  bind(): void {
    if (this.bound) return;
    this.bound = true;
    const listener = listenerOptions(this.deps.signal);
    this.deps.roots.byName<HTMLButtonElement>('replace-popup-close').addEventListener('click', () => this.close(), listener);
    // A press on the backdrop, outside the card, closes the popup.
    this.popup.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.card.contains(event.target as Node)) this.close();
      },
      listener,
    );
    this.popup.addEventListener('keydown', this.onKeyDown, listener);
  }

  isOpen(): boolean {
    return this.request !== null;
  }

  /** True when `node` is part of the popup, backdrop included. */
  contains(node: Node): boolean {
    return this.popup.contains(node);
  }

  open(request: ReplacePopupRequest): void {
    if (this.request === null) {
      const root = this.popup.getRootNode() as unknown as DocumentOrShadowRoot;
      this.opener = root.activeElement as HTMLElement | null;
    }
    this.request = request;
    this.title.textContent = request.title;
    const document = this.list.ownerDocument;
    this.list.replaceChildren();
    for (const group of request.groups) {
      if (group.items.length === 0) continue;
      const section = document.createElement('section');
      section.className = 'replace-group';
      const label = document.createElement('h3');
      label.className = 'replace-group-label';
      label.textContent = group.label;
      const grid = document.createElement('div');
      grid.className = 'replace-group-items';
      for (const item of group.items) grid.appendChild(swatch(item, 'furniture', (id) => this.pick(id), document, this.deps.signal));
      section.append(label, grid);
      this.list.appendChild(section);
    }
    const nothing = this.list.childElementCount === 0;
    this.empty.textContent = request.empty;
    this.empty.classList.toggle('is-hidden', !nothing);
    this.list.classList.toggle('is-hidden', nothing);
    this.popup.classList.remove('is-hidden');
    this.popup.dataset['open'] = 'true';
    this.list.scrollTop = 0;
    focusablesOf(this.card)[0]?.focus();
  }

  close(): void {
    if (this.request === null) return;
    this.request = null;
    this.popup.classList.add('is-hidden');
    this.popup.dataset['open'] = 'false';
    this.list.replaceChildren();
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) opener.focus();
  }

  private pick(id: string): void {
    const request = this.request;
    if (request === null) return;
    this.close();
    request.onPick(id);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.request === null) return;
    if (event.key === 'Escape') {
      // The popup is on top: Escape closes it and leaves the panel under it open.
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = focusablesOf(this.card);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables.at(-1)!;
    const root = this.popup.getRootNode() as unknown as DocumentOrShadowRoot;
    const active = root.activeElement as HTMLElement | null;
    const inside = active !== null && focusables.includes(active);
    const onEdge = event.shiftKey ? !inside || active === first : !inside || active === last;
    if (!onEdge) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  };
}
