/**
 * The one button that opens and shuts a door: an icon-only HUD pinned to the
 * leaf the pointer is over.
 *
 * Invariant: this module owns exactly one element, `#door-hud`, which it
 * creates itself and appends to the viewer shell — no `index.html` id is read
 * or written here. Its whole state is machine-readable (`data-visible`,
 * `data-state`, `data-opening`), because that is what a browser check may
 * assert on; the copy comes from `messages.ts` and is never asserted.
 *
 * It never touches the scene: it asks where a door is on screen, what phase it
 * is in, and reports a click. The state machine is `door-state.ts`, the leaves
 * are `door-animator.ts`.
 *
 * The button follows the LEAF, not the door's rest state: over a rest-closed
 * door the automation is holding open it offers "close", because that is what
 * the user sees. Clicking it is a decision, and `DoorStates.toggle` latches it
 * — the door stays shut with the walker standing there instead of springing
 * open again on the next frame.
 *
 * The click lands on an HTML button that sits ABOVE the canvas, so it never
 * reaches the picker: pressing the HUD can not also open the variant panel.
 */

import type { DoorPhase } from './door-state.js';
import { listenerOptions } from '../shared/abort.js';
import type { Messages } from '../shared/messages.js';

/** How long the button survives after the pointer leaves both it and the door, ms. */
const DOOR_HUD_GRACE_MS = 250;

/**
 * The `data-jeex` name this module stamps on the button it creates.
 *
 * Owned here, not by `ui/viewer-shell.ts`: the name belongs to the module
 * that creates the element, the same way `minimap.ts` and `plan-modes.ts` own
 * theirs. `viewer-shell.ts` imports it (downward, `ui` -> `doors`) to compose
 * the combined `OVERLAY_NAMES` the rest of the machine-readable surface reads.
 */
export const DOOR_HUD_NAME = 'door-hud';

export type DoorHudDeps = {
  /** The viewer shell the button is positioned inside (`#viewer`). */
  container: HTMLElement;
  /** The scene canvas; a press on it dismisses the button. */
  canvas: HTMLElement;
  /** Viewport-pixel position of a door's leaf centre, `null` when it is unknown. */
  screenPoint: (openingId: string) => { x: number; y: number } | null;
  /** Phase of an interactive door, `null` for anything that is not one. */
  phase: (openingId: string) => DoorPhase | null;
  toggle: (openingId: string) => void;
  /** True while a selection panel is open: the HUD steps out of its way. */
  panelOpen: () => boolean;
  /** True in the modes that allow door interaction (orbit and walk). */
  enabled: () => boolean;
  /** This instance's catalogue; the button's `aria-label` is its only copy. */
  messages: Messages;
  /** The mounted viewer's lifetime; every listener bound here carries it. */
  signal?: AbortSignal | undefined;
};

/**
 * The two icons, as node descriptions rather than markup.
 *
 * `innerHTML` throws under `require-trusted-types-for 'script'`, and a policy
 * this component registered would still be at the mercy of the host's
 * `trusted-types` allowlist. A leaf and an arrow built
 * with `createElementNS` need neither.
 */
const ICON_CLOSE: readonly IconPath[] = [{ d: 'M14 4v16l-7-2V6l7-2Z' }, { d: 'M17 9l-3 3 3 3', stroke: true }];
const ICON_OPEN: readonly IconPath[] = [{ d: 'M10 4v16l7-2V6l-7-2Z' }, { d: 'M4 9l3 3-3 3', stroke: true }];

/** One path of a HUD icon: filled by default, or stroked like the arrow. */
type IconPath = { d: string; stroke?: true };

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds one `<span class="door-hud-icon …"><svg>…</svg></span>` wrapper. */
function iconSpan(document: Document, modifier: string, paths: readonly IconPath[]): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `door-hud-icon door-hud-icon-${modifier}`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const path of paths) {
    const node = document.createElementNS(SVG_NS, 'path');
    node.setAttribute('d', path.d);
    if (path.stroke) {
      node.setAttribute('fill', 'none');
      node.setAttribute('stroke', 'currentColor');
      node.setAttribute('stroke-width', '1.6');
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('stroke-linejoin', 'round');
    }
    svg.append(node);
  }
  span.append(svg);
  return span;
}

export class DoorHud {
  private readonly deps: DoorHudDeps;
  private readonly button: HTMLButtonElement;
  /** The door the button currently belongs to, `null` when it is hidden. */
  private openingId: string | null = null;
  /** Last time the pointer was over the door or the button, ms. */
  private lastSeenAt = 0;
  private overButton = false;
  /** A touch tap keeps the button up until something dismisses it. */
  private pinned = false;

  constructor(deps: DoorHudDeps) {
    this.deps = deps;
    const document = deps.container.ownerDocument;
    this.button = document.createElement('button');
    this.button.dataset['jeex'] = DOOR_HUD_NAME;
    this.button.className = 'door-hud';
    this.button.type = 'button';
    this.button.dataset['visible'] = 'false';
    this.button.dataset['state'] = 'open';
    this.button.append(iconSpan(document, 'close', ICON_CLOSE), iconSpan(document, 'open', ICON_OPEN));
    const listener = listenerOptions(deps.signal);
    this.button.addEventListener('click', this.onClick, listener);
    this.button.addEventListener('pointerenter', this.onEnter, listener);
    this.button.addEventListener('pointerleave', this.onLeave, listener);
    this.deps.canvas.addEventListener('pointerdown', this.onCanvasPointerDown, listener);
    this.deps.container.appendChild(this.button);
  }

  /** The element, for tests and for the debug surface. */
  get element(): HTMLButtonElement {
    return this.button;
  }

  /** Which door the button is currently offering, `null` when it is hidden. */
  current(): string | null {
    return this.openingId;
  }

  /**
   * What the pointer is over right now: a door id, or `null` for anything else.
   * Called at most once per frame from the controller's hover raycast.
   */
  hover(openingId: string | null, now: number): void {
    if (openingId === null) return;
    if (!this.canShow(openingId)) return;
    this.pinned = false;
    this.show(openingId, now);
  }

  /** A tap on a door leaf (touch, where there is no hover): show and stay. */
  showFor(openingId: string, now: number): void {
    if (this.deps.phase(openingId) === null || !this.deps.enabled()) return;
    this.pinned = true;
    this.show(openingId, now);
  }

  /**
   * One frame: re-anchor the button to the leaf, refresh its state, and let it
   * go once the pointer has been away from both for `DOOR_HUD_GRACE_MS`.
   */
  update(now: number): void {
    if (!this.openingId) return;
    const phase = this.deps.phase(this.openingId);
    // A panel takes the HUD's place — except when the button was raised by a
    // deliberate tap, which is the touch story: that same tap opens the
    // variant panel, and it must not swallow the affordance it just offered.
    if (phase === null || !this.deps.enabled() || (this.deps.panelOpen() && !this.pinned)) {
      this.hide();
      return;
    }
    if (this.overButton) this.lastSeenAt = now;
    if (!this.pinned && now - this.lastSeenAt > DOOR_HUD_GRACE_MS) {
      this.hide();
      return;
    }
    const point = this.deps.screenPoint(this.openingId);
    if (!point) {
      this.hide();
      return;
    }
    const shut = phase === 'closed' || phase === 'closing';
    this.button.dataset['state'] = shut ? 'closed' : 'open';
    this.button.setAttribute('aria-label', this.deps.messages.t(shut ? 'door.open' : 'door.close'));
    // `setProperty`, never a `style` attribute: the CSSOM path is not what a
    // host's `style-src-attr` governs (README, "Content Security Policy").
    this.button.style.setProperty('left', `${Math.round(point.x)}px`);
    this.button.style.setProperty('top', `${Math.round(point.y)}px`);
  }

  hide(): void {
    this.openingId = null;
    this.pinned = false;
    this.overButton = false;
    this.button.dataset['visible'] = 'false';
    delete this.button.dataset['opening'];
  }

  /** The four listeners die with the mount's signal; the button is this class's. */
  dispose(): void {
    this.button.remove();
  }

  /** A door may take the HUD when it is interactive and nothing else is in the way. */
  private canShow(openingId: string): boolean {
    if (!this.deps.enabled() || this.deps.panelOpen()) return false;
    return this.deps.phase(openingId) !== null;
  }

  private show(openingId: string, now: number): void {
    this.openingId = openingId;
    this.lastSeenAt = now;
    this.button.dataset['visible'] = 'true';
    this.button.dataset['opening'] = openingId;
    this.update(now);
  }

  private readonly onClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!this.openingId) return;
    this.deps.toggle(this.openingId);
  };

  private readonly onEnter = (): void => {
    this.overButton = true;
  };

  private readonly onLeave = (): void => {
    this.overButton = false;
  };

  /** A press on the scene dismisses the button, whatever it was offering. */
  private readonly onCanvasPointerDown = (): void => {
    this.hide();
  };
}
