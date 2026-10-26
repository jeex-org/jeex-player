/**
 * The controls hint's toggle in a narrow viewer.
 *
 * On a small canvas (the 16:9 hero of a phone page is about 350 × 197) the
 * full hint covered half the scene. Below a 480 px container width the
 * stylesheet hides the text and shows this button beside the icon; the button
 * opens and closes the text, and the first camera gesture closes it again
 * (`collapse`, called through `DirectorChrome.collapseHint` on manual input —
 * never on the chrome's own wake signal, which also fires on a mere pointer
 * move and is switched off with auto-hide).
 *
 * The card, its `hint` part and the live region of its text are the ones a
 * wide viewer always had: this only adds `data-expanded` on the card and the
 * button's own `aria-expanded`. In a wide viewer the button is not displayed,
 * so it is no tab stop, and `data-expanded` changes nothing there.
 */

import { listenerOptions } from '../shared/abort.js';

/** Distinct ids for `aria-controls` across every viewer on a page. */
let textSequence = 0;

export class HintToggle {
  private expanded = false;
  private readonly card: HTMLElement;
  private readonly button: HTMLButtonElement;

  constructor(card: HTMLElement, button: HTMLButtonElement, text: HTMLElement) {
    this.card = card;
    this.button = button;
    textSequence += 1;
    text.id = `jeex-hint-text-${textSequence}`;
    button.setAttribute('aria-controls', text.id);
  }

  /** Binds the button for as long as the chrome's mount signal lives. */
  bind(signal: AbortSignal | undefined): void {
    const listener = listenerOptions(signal);
    this.button.addEventListener('click', () => this.set(!this.expanded), listener);
  }

  /** Closes the text again: the first camera gesture after it was opened. */
  collapse(): void {
    if (this.expanded) this.set(false);
  }

  private set(expanded: boolean): void {
    this.expanded = expanded;
    this.card.toggleAttribute('data-expanded', expanded);
    this.button.setAttribute('aria-expanded', String(expanded));
  }
}
