/**
 * The boxes a HOST renders its own chrome into: named, positioned by the
 * viewer, and filled by nobody here.
 *
 * Invariant: the viewer owns the BOX, the host owns the CONTENT. `get` hands
 * back a node and does nothing else — it never reads what is inside it, never
 * empties it, and never re-parents it — so a host may mount a React tree, a
 * web component or three `<div>`s into the same box and keep them across
 * everything the viewer does to the scene. The viewer's only writes to a box
 * are the ones a POSITION needs: the anchor's two custom properties and its
 * `data-visible`.
 *
 * Closed set: `SLOT_NAMES` is the whole vocabulary. Arbitrary
 * names are not accepted because nothing could then lay them out or check them,
 * and because a name is also a CSS selector in
 * `styles/viewer.css` — an unknown one would build a box with no rules at all.
 *
 * Empty by default: `HostSlots` builds exactly the names it is given, so a
 * viewer nobody asked for chrome has not one extra node in it.
 *
 * Trusted Types invariant: `createElement` / `setAttribute` / `append` only,
 * the same as `viewer-shell.ts` — no string ever reaches `innerHTML`.
 *
 * Lifetime: the boxes are children of the shell root, so
 * `viewer-context.release()` takes them away with everything else. There is
 * deliberately no `dispose` here and not one `addEventListener`: a box the
 * viewer listened on would be a box whose content the viewer had an opinion
 * about.
 */

import { ViewerLibError } from '../shared/errors.js';

/**
 * Every box a host may ask for, in reading order.
 *
 * The six corner and edge names are laid out by `styles/viewer.css`; the last
 * two are special:
 */
export const SLOT_NAMES = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  /** Covers the viewport above all the chrome except the loading and error cards. */
  'modal-root',
  /** Follows a scene point or an entity; `data-visible` says whether it is on screen. */
  'selection-anchor',
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

/** The attribute every slot box carries; a host's own selector hook as well as ours. */
export const SLOT_ATTRIBUTE = 'data-jeex-slot';

/**
 * Two flags `HostSlots` writes on `root` at construction: whether the host
 * claimed the `bottom-right` / `bottom-left` box. `styles/viewer.css` reads
 * them to move the degraded-asset notice (`viewer-shell.ts`) out of a
 * requested box's way — the one corner the viewer's own chrome and a host
 * slot can end up sharing (host content must never cover a
 * viewer notice or error card, and a requested slot sits at z-index 8,
 * above the notice's 5). Written once, because the slot set of a mount
 * never changes after boot — there is nothing here for a later frame to
 * keep in sync.
 */
export const BOTTOM_RIGHT_CLAIMED_ATTRIBUTE = 'data-jeex-slot-bottom-right';
export const BOTTOM_LEFT_CLAIMED_ATTRIBUTE = 'data-jeex-slot-bottom-left';

/**
 * The one box the viewer writes a POSITION into, and the only reason this
 * module knows about the anchor at all.
 */
const ANCHOR_SLOT: SlotName = 'selection-anchor';

/** Custom property the anchor's horizontal offset is published as, in unitless pixels. */
const ANCHOR_X_PROPERTY = '--jeex-anchor-x';

/** Custom property the anchor's vertical offset is published as, in unitless pixels. */
const ANCHOR_Y_PROPERTY = '--jeex-anchor-y';

/** A slot the host did not ask for in `options.slots`. */
export class MissingSlotError extends ViewerLibError {
  declare readonly code: 'bad-params';
  readonly slotName: string;

  constructor(slotName: string) {
    super('bad-params', `viewer slots: "${slotName}" was not asked for in options.slots`, { detail: { slotName } });
    this.name = 'MissingSlotError';
    this.slotName = slotName;
  }
}

/**
 * The boxes of ONE mount: built once, emptied never, removed with the shell.
 *
 * Caller obligation: build `HostSlots` only AFTER the whole shell tree is in
 * `root`. The constructor appends and enforces nothing, so it is the CALLER
 * (`app/viewer-context.ts`) that decides the boxes come last — which is what
 * makes a slot and a panel of the viewer's own chrome sharing a `z-index`
 * resolve in the host's favour, as layers 8–9 promise.
 */
export class HostSlots {
  private readonly boxes: Map<SlotName, HTMLElement>;

  /**
   * The last position published, so a point parked behind the camera keeps its
   * numbers, and so a still anchor costs no CSSOM write per frame.
   *
   * `null` is "never published", not "published as 0": with `0` as the start
   * value an anchor whose first position is the viewport's origin would never
   * write the property at all, and a host reading `--jeex-anchor-x` would get
   * an empty string where the contract promises a number.
   */
  private anchorX: number | null = null;

  private anchorY: number | null = null;

  constructor(root: HTMLElement, names: readonly SlotName[]) {
    const boxes = new Map<SlotName, HTMLElement>();
    for (const name of names) {
      // A host that names one slot twice gets one box, not two: the second
      // would be an unreachable node `get` could never answer with.
      if (boxes.has(name)) continue;
      const box = root.ownerDocument.createElement('div');
      box.setAttribute(SLOT_ATTRIBUTE, name);
      // The anchor starts parked: it has nothing to follow until `anchorTo`.
      if (name === ANCHOR_SLOT) box.dataset['visible'] = 'false';
      boxes.set(name, box);
      root.append(box);
    }
    this.boxes = boxes;
    root.setAttribute(BOTTOM_RIGHT_CLAIMED_ATTRIBUTE, String(boxes.has('bottom-right')));
    root.setAttribute(BOTTOM_LEFT_CLAIMED_ATTRIBUTE, String(boxes.has('bottom-left')));
  }

  /** The box for `name`; throws `MissingSlotError` when it was not asked for. */
  get(name: SlotName): HTMLElement {
    const box = this.boxes.get(name);
    if (!box) throw new MissingSlotError(name);
    return box;
  }

  /**
   * Publishes the anchor position onto the `selection-anchor` box; `null` parks it.
   *
   * A no-op when the host did not ask for the anchor — this is called once per
   * frame, and a mount without the slot must not pay for a branch it cannot
   * see. Every write is dirty-checked for the same reason `minimap.ts` checks
   * `data-visible` before writing it: an unchanged `setAttribute` still queues
   * a mutation record and dirties the element's style.
   *
   * The numbers are rounded and UNITLESS: the stylesheet multiplies them by
   * `1px` itself, so a host may read them and do its own arithmetic.
   * `setProperty` rather than a `style` attribute, for the same reason
   * `door-hud.ts` positions its button that way: the CSSOM path is not what a
   * host's `style-src-attr` governs.
   */
  setAnchor(point: { x: number; y: number; visible: boolean } | null): void {
    const box = this.boxes.get(ANCHOR_SLOT);
    if (!box) return;
    // A non-finite coordinate would reach CSS as a parse-valid property value
    // that only fails at computed-value time — an anchor still on screen with
    // its `translate` thrown away — and `NaN !== NaN` would defeat the cache
    // below on every frame after. It is parked, exactly like a null target.
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      this.publishVisible(box, false);
      return;
    }
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    if (x !== this.anchorX) {
      this.anchorX = x;
      box.style.setProperty(ANCHOR_X_PROPERTY, String(x));
    }
    if (y !== this.anchorY) {
      this.anchorY = y;
      box.style.setProperty(ANCHOR_Y_PROPERTY, String(y));
    }
    this.publishVisible(box, point.visible);
  }

  private publishVisible(box: HTMLElement, visible: boolean): void {
    const next = visible ? 'true' : 'false';
    if (box.dataset['visible'] !== next) box.dataset['visible'] = next;
  }
}
