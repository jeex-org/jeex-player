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
 * about. The one observer it keeps (`NoticeLift`) MEASURES the bottom boxes
 * and reads nothing inside them, and it ends with the viewer's lifetime
 * signal.
 */

import { ViewerLibError } from '../shared/errors.js';

/**
 * Every box a host may ask for, in reading order.
 *
 * The six corner and edge names are laid out by `styles/viewer.css`; the last
 * three are special:
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
  /**
   * Covers the viewport BELOW all the chrome: over the scene and the 2D plan
   * drawing, under every panel, bar and card. Inert to the pointer, content
   * included, until the host sets `pointer-events` on it.
   */
  'underlay',
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
 * The custom property the degraded notice's lift is published as on the root,
 * in pixels; `styles/viewer.css` adds it to the notice's bottom inset.
 */
const NOTICE_LIFT_PROPERTY = '--jeex-notice-lift';

/** Clear space between the notice and whatever it was lifted above, pixels. */
const NOTICE_GAP_PX = 8;

/**
 * The custom property the bottom boxes' clearance is published as on the root,
 * in pixels: the distance from the root's bottom edge to the top of the
 * tallest filled bottom box, plus `NOTICE_GAP_PX`, ACROSS THE WHOLE WIDTH
 * (`0px` when no bottom box is filled). The narrow settings sheet
 * (`styles/viewer.css`) spans the full width, so the notice's lift, which
 * counts only what lies under the notice's own span, does not fit it. The
 * hint card is not counted: it is the viewer's own chrome, under the sheet's
 * layer, and the sheet already covers it.
 */
const BOTTOM_CLEARANCE_PROPERTY = '--jeex-bottom-clearance';

/** The three boxes along the bottom edge a notice can collide with. */
const BOTTOM_SLOTS: readonly SlotName[] = ['bottom-left', 'bottom-center', 'bottom-right'];

/**
 * What the notice is measured against: the notice itself, the viewer's own
 * hint card beside it, the elements whose appearance moves that card without
 * resizing it (the tour bar lifts the hint 24 px), and the mount's lifetime.
 */
export type NoticeLiftTargets = {
  readonly notice: HTMLElement;
  readonly hint: HTMLElement;
  readonly triggers: readonly HTMLElement[];
  readonly signal: AbortSignal;
};

/** Whether a rect is rendered at all: a hidden card and an empty host box both measure zero. */
function rendered(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

/**
 * Lifts the degraded-asset notice above every filled bottom box and the hint
 * card that it would otherwise overlap, plus `NOTICE_GAP_PX`, and publishes
 * the full-width clearance of the filled bottom boxes for the narrow settings
 * sheet (`BOTTOM_CLEARANCE_PROPERTY`).
 *
 * Only what overlaps the notice HORIZONTALLY counts: the lift moves the notice
 * up and never sideways, so its horizontal span is the same before and after,
 * and a desktop notice with nothing under it keeps its default inset.
 * Measured on every size change of the root, the boxes, the notice, the hint
 * and the triggers; all rects are read first and the property is written only
 * when it changed, and that write moves the notice without resizing anything
 * observed, so the observer cannot feed itself.
 */
function observeNoticeLift(root: HTMLElement, boxes: ReadonlyMap<SlotName, HTMLElement>, targets: NoticeLiftTargets): void {
  if (typeof ResizeObserver === 'undefined' || targets.signal.aborted) return;
  const bottomBoxes = BOTTOM_SLOTS.flatMap((name) => boxes.get(name) ?? []);
  const candidates = [...bottomBoxes, targets.hint];
  let lift = 0;
  let boxesClearance = 0;
  const measure = (): void => {
    const bottom = root.getBoundingClientRect().bottom;
    let across = 0;
    for (const box of bottomBoxes) {
      const rect = box.getBoundingClientRect();
      if (rendered(rect)) across = Math.max(across, Math.ceil(bottom - rect.top + NOTICE_GAP_PX));
    }
    if (across !== boxesClearance) {
      boxesClearance = across;
      root.style.setProperty(BOTTOM_CLEARANCE_PROPERTY, `${across}px`);
    }
    const own = targets.notice.getBoundingClientRect();
    if (!rendered(own)) return;
    // The notice's own inset without the lift: its distance from the root's
    // bottom edge now, minus what this function already added.
    const base = bottom - own.bottom - lift;
    let clearance = 0;
    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      if (!rendered(rect) || rect.left >= own.right || rect.right <= own.left) continue;
      clearance = Math.max(clearance, bottom - rect.top + NOTICE_GAP_PX);
    }
    const next = Math.max(0, Math.ceil(clearance - base));
    if (next === lift) return;
    lift = next;
    root.style.setProperty(NOTICE_LIFT_PROPERTY, `${next}px`);
  };
  const observer = new ResizeObserver(measure);
  for (const element of [root, targets.notice, ...candidates, ...targets.triggers]) observer.observe(element);
  // The listener is bound to its OWN controller, the `linkedAbortController`
  // pattern (`shared/abort.ts`): bound to the mount's signal itself it would be
  // removed by that very abort before it could run.
  const own = new AbortController();
  targets.signal.addEventListener(
    'abort',
    () => {
      observer.disconnect();
      own.abort();
    },
    { once: true, signal: own.signal },
  );
}

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

  /**
   * `lift`, when given, keeps the degraded notice clear of the bottom boxes
   * and the hint card (`observeNoticeLift`) for the mount's lifetime.
   */
  constructor(root: HTMLElement, names: readonly SlotName[], lift?: NoticeLiftTargets) {
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
    if (lift) observeNoticeLift(root, boxes, lift);
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
