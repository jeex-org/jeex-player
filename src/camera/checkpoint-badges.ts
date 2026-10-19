/**
 * The tour cameras' ORDER BADGES: a
 * screen-space label «1», «2», … above each camera, matching the host's list
 * rows, always on top of the picture.
 *
 * DOM, not a sprite: the number is text a screen reader and a test can read,
 * it stays crisp at every zoom, and it costs no texture per camera. The layer
 * is transparent to the pointer — a press on a badge reaches the canvas, where
 * the overlay's screen-space picking treats the badge position as a grab
 * target (`checkpoint-picking.ts`), so a badge never swallows a drag.
 *
 * Invariant: this module owns exactly one element, `[data-jeex="checkpoint-badges"]`,
 * and writes only when a value changed — the positions are applied once per
 * frame from the overlay's frame step.
 */

import type { ScreenPoint } from './checkpoint-picking.js';

/** The `data-jeex` name of the badge layer. */
export const CHECKPOINT_BADGES_NAME = 'checkpoint-badges';

export type BadgeEntry = {
  readonly id: string;
  /** The 1-based tour order. */
  readonly order: number;
  /** Where the badge's centre goes, in canvas pixels; `null` hides it (off-screen, behind the author). */
  readonly at: ScreenPoint | null;
  readonly active: boolean;
};

export class CheckpointBadges {
  private readonly layer: HTMLDivElement;
  private readonly badges = new Map<string, HTMLSpanElement>();
  private shown = true;

  constructor(container: HTMLElement) {
    this.layer = container.ownerDocument.createElement('div');
    this.layer.dataset['jeex'] = CHECKPOINT_BADGES_NAME;
    this.layer.className = 'checkpoint-badges';
    this.layer.setAttribute('aria-hidden', 'true');
    container.appendChild(this.layer);
    this.hide();
  }

  /** Places every badge; badges of cameras no longer listed are removed. */
  update(entries: readonly BadgeEntry[]): void {
    if (!this.shown) {
      this.shown = true;
      this.layer.hidden = false;
    }
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.id);
      const badge = this.badges.get(entry.id) ?? this.create(entry.id);
      const text = String(entry.order);
      if (badge.textContent !== text) badge.textContent = text;
      const active = String(entry.active);
      if (badge.dataset['active'] !== active) badge.dataset['active'] = active;
      const visible = entry.at !== null;
      if (badge.hidden === visible) badge.hidden = !visible;
      if (entry.at) {
        const transform = `translate(${entry.at.x.toFixed(1)}px, ${entry.at.y.toFixed(1)}px) translate(-50%, -50%)`;
        if (badge.style.transform !== transform) badge.style.transform = transform;
      }
    }
    for (const [id, badge] of this.badges) {
      if (seen.has(id)) continue;
      badge.remove();
      this.badges.delete(id);
    }
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.layer.hidden = true;
  }

  dispose(): void {
    this.layer.remove();
    this.badges.clear();
  }

  private create(id: string): HTMLSpanElement {
    const badge = this.layer.ownerDocument.createElement('span');
    badge.className = 'checkpoint-badge';
    badge.dataset['checkpointId'] = id;
    this.layer.appendChild(badge);
    this.badges.set(id, badge);
    return badge;
  }
}
