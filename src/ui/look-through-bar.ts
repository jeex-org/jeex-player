/**
 * The look-through bar («Look through»): while the
 * author pilots a tour camera the host's own panel may be hidden (an editor
 * host hides it in `walk`), so the viewer shows the way out itself — which camera, «Done»
 * (keep the new pose) and «Cancel».
 *
 * Invariant: this module owns exactly one element, `[data-jeex="look-through"]`,
 * hidden unless `show` was called; its buttons only report, the command that
 * ends the look-through is the host's (`handle.endLookThrough`).
 */

import { listenerOptions } from '../shared/abort.js';
import type { Messages } from './messages.js';

export const LOOK_THROUGH_NAME = 'look-through';

export type LookThroughBarDeps = {
  container: HTMLElement;
  messages: Messages;
  /** «Done» (`true`) or «Cancel» (`false`). */
  onEnd: (commit: boolean) => void;
  signal?: AbortSignal | undefined;
};

export class LookThroughBar {
  private readonly bar: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly done: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private messages: Messages;
  private order: number | null = null;

  constructor(deps: LookThroughBarDeps) {
    this.messages = deps.messages;
    const doc = deps.container.ownerDocument;
    this.bar = doc.createElement('div');
    this.bar.className = 'look-through';
    this.bar.dataset['jeex'] = LOOK_THROUGH_NAME;
    this.bar.setAttribute('role', 'group');
    this.bar.hidden = true;
    this.label = doc.createElement('span');
    this.label.className = 'look-through-label';
    this.done = doc.createElement('button');
    this.done.type = 'button';
    this.done.className = 'look-through-done';
    this.cancel = doc.createElement('button');
    this.cancel.type = 'button';
    this.cancel.className = 'look-through-cancel';
    this.bar.append(this.label, this.cancel, this.done);
    deps.container.appendChild(this.bar);
    const listen = listenerOptions(deps.signal);
    this.done.addEventListener('click', () => deps.onEnd(true), listen);
    this.cancel.addEventListener('click', () => deps.onEnd(false), listen);
    this.retranslate(deps.messages);
  }

  get element(): HTMLDivElement {
    return this.bar;
  }

  /** Shows the bar for the camera at tour position `order` (1-based). */
  show(order: number): void {
    this.order = order;
    this.bar.hidden = false;
    this.retranslate(this.messages);
  }

  hide(): void {
    this.order = null;
    this.bar.hidden = true;
  }

  retranslate(messages: Messages): void {
    this.messages = messages;
    this.label.textContent = messages.t('lookThrough.label', { n: this.order ?? '' });
    this.bar.setAttribute('aria-label', this.label.textContent);
    this.done.textContent = messages.t('lookThrough.done');
    this.cancel.textContent = messages.t('lookThrough.cancel');
  }

  dispose(): void {
    this.bar.remove();
  }
}
