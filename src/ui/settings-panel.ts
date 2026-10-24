/**
 * The viewer's settings: a button attached to one inline edge of the control
 * bar (its end by default, its start when the host asks) and the non-modal
 * panel it opens. Its first (and so far only) setting is the
 * colour temperature of the interior's artificial light.
 *
 * Off by default: nothing of it exists until the host enables it
 * (`options.settings.show`), so a viewer that says nothing has exactly the
 * control bar it always had.
 *
 * Layout invariant: the button's wrapper is positioned ABSOLUTELY at the
 * bar's chosen edge, so the bar's centring and its flex layout ignore it and
 * no existing control moves. In a narrow viewer it sits under that edge,
 * inside the viewer. On the end side the wrapper is the bar's last child and
 * the panel its next sibling (so Tab goes from the button straight into it);
 * on the start side the wrapper is the bar's first child, so Tab order still
 * follows what is seen. The panel is anchored under the button, and is a
 * bottom sheet in a narrow viewer (`styles/viewer.css`).
 *
 * Start and end are the bar's inline edges by its computed `direction`; the
 * clearance check and the panel's anchoring resolve them to a physical side.
 *
 * Behaviour (shadcn's Popover, Field and Slider as the reference): a labelled
 * non-modal dialog; the slider takes focus on open; Escape and the Close
 * button close it and give focus back to the button; a press anywhere outside
 * it closes it, giving focus back only when the press was inside this viewer;
 * focus leaving it closes it. It never uses `showModal()`, which would make
 * the embedding page inert. A native range input carries the temperature with
 * a translated `aria-valuetext`; while the value is «Original» the thumb rests
 * at `SLIDER_REST_K` and the first adjustment leaves «Original».
 */

import { linkedAbortController, listenerOptions } from '../shared/abort.js';
import { TEMPERATURE_RANGE } from '../lighting/temperature-range.js';
import { isLightTemperature } from '../lighting/colour-temperature.js';
import type { Messages } from './messages.js';
import { MINIMAP_NAME } from './minimap.js';
import { PROJECT_MARK_NAME } from './project-mark.js';
import type { ViewerRoots } from './viewer-shell.js';

/** Where the thumb rests while the value is «Original»: neutral white. */
export const SLIDER_REST_K = 4000;

/** Below or at this many kelvin the read-out says warm, above `NEUTRAL_MAX_K` cool. */
const WARM_MAX_K = 3300;
const NEUTRAL_MAX_K = 4600;

/** The gap between the bar's end and the button's plate beside it, and the least room left to the viewer's edge, CSS px. */
const PLATE_GAP_PX = 4;
const EDGE_MARGIN_PX = 8;
/** The room the plate under the bar keeps from viewer content it moves past along that row, CSS px. */
const NEIGHBOUR_GAP_PX = 8;
/**
 * Viewer content in the row under the bar that keeps its place: the
 * producer's mark (top start) and the minimap lifted under the bar in a narrow
 * walk (top end). New UI never displaces it; the plate moves along the row.
 */
const NEIGHBOURS = `:scope > [data-jeex="${PROJECT_MARK_NAME}"], :scope > [data-jeex="${MINIMAP_NAME}"]`;

/** The control bar edge the button attaches to (`options.settings.side`). */
export type SettingsSide = 'start' | 'end';

/** The `data-jeex` names of the nodes this module builds. */
export const SETTINGS_NAMES = { extension: 'settings-extension', button: 'settings-button', panel: 'settings-panel' } as const;

/** The slider's position for `value`. */
export function sliderPosition(value: number | null): string {
  return String(value ?? SLIDER_REST_K);
}

/** The temperature a slider position stands for; `null` for one the range never gives. */
export function valueFromSlider(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() !== '' && isLightTemperature(value) ? value : null;
}

/** The tone word a temperature reads as. */
export function temperatureTone(kelvin: number): 'warm' | 'neutral' | 'cool' {
  if (kelvin <= WARM_MAX_K) return 'warm';
  return kelvin <= NEUTRAL_MAX_K ? 'neutral' : 'cool';
}

/** The read-out and the slider's value text: «Original», or «3000 K · warm». */
export function temperatureText(value: number | null, messages: Messages): string {
  if (value === null) return messages.t('settings.original');
  return messages.t('settings.temperatureValue', { kelvin: value, tone: messages.t(`settings.${temperatureTone(value)}`) });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Two sliders on two rails: the settings glyph, in the 24-unit grid the icon buttons size. */
const SETTINGS_ICON = 'M4 7h9m4 0h3M4 17h3m4 0h9M15 4v6M9 14v6';

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  attrs: Readonly<Record<string, string>> = {},
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function settingsIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SETTINGS_ICON);
  svg.append(path);
  return svg;
}

export type SettingsPanelDeps = {
  roots: ViewerRoots;
  messages: Messages;
  /** The visitor chose a temperature, or «Original». */
  onChange: (temperature: number | null) => void;
  /** The panel opened: the caller closes the other panel and keeps the chrome awake. */
  onOpen: () => void;
  /** The panel closed. */
  onClose: () => void;
  signal?: AbortSignal | undefined;
};

/** The nodes, built on the first `setEnabled(true)`. */
type Nodes = {
  extension: HTMLElement;
  button: HTMLButtonElement;
  panel: HTMLElement;
  title: HTMLElement;
  close: HTMLButtonElement;
  label: HTMLElement;
  output: HTMLOutputElement;
  slider: HTMLInputElement;
  reset: HTMLButtonElement;
};

export class SettingsPanel {
  private readonly deps: SettingsPanelDeps;
  private messages: Messages;
  private nodes: Nodes | null = null;
  private value: number | null = null;
  private opened = false;
  /** Read once: the first `setEnabled(true)` builds the nodes on this side. */
  private side: SettingsSide = 'end';
  /** How far the plate under the bar is moved inwards past a neighbour, CSS px (`--jeex-settings-shift`). */
  private shift = 0;
  private reflowFrame: number | undefined;
  /** The document listener of an open panel; aborted on close. */
  private outside: AbortController | null = null;
  private focusTimer: number | undefined;
  /** Watches the bar and the viewer, so a bar too wide for the button beside it puts it under the bar's end. */
  private observer: ResizeObserver | null = null;

  constructor(deps: SettingsPanelDeps) {
    this.deps = deps;
    this.messages = deps.messages;
  }

  /** Whether the host enabled the button (`options.settings.show`), and on which side of the bar (read at the first build only). */
  setEnabled(show: boolean, side: SettingsSide = 'end'): void {
    if (show && !this.nodes) {
      this.side = side;
      this.build();
    }
    if (!this.nodes) return;
    if (!show) this.close(false);
    this.nodes.extension.hidden = !show;
  }

  /** The current temperature, from the host or the panel itself. */
  setValue(value: number | null): void {
    this.value = value;
    this.render();
  }

  retranslate(messages: Messages): void {
    this.messages = messages;
    this.render();
  }

  isOpen(): boolean {
    return this.opened;
  }

  /** Whether `target` is part of the panel or its button. */
  contains(target: Node | null): boolean {
    return this.nodes !== null && target !== null && (this.nodes.panel.contains(target) || this.nodes.extension.contains(target));
  }

  open(): void {
    const nodes = this.nodes;
    if (!nodes || this.opened || nodes.extension.hidden) return;
    this.opened = true;
    this.deps.onOpen();
    this.render();
    // Shown first, so `anchor()` can measure the panel's width to keep it inside the viewer.
    nodes.panel.hidden = false;
    this.anchor();
    nodes.button.setAttribute('aria-expanded', 'true');
    this.listenOutside();
    nodes.slider.focus();
  }

  /** Closes the panel; `returnFocus` gives focus back to the button. */
  close(returnFocus = true): void {
    const nodes = this.nodes;
    if (!nodes || !this.opened) return;
    this.opened = false;
    this.outside?.abort();
    this.outside = null;
    nodes.panel.hidden = true;
    nodes.button.setAttribute('aria-expanded', 'false');
    if (returnFocus) nodes.button.focus();
    this.deps.onClose();
  }

  /** Escape closes the open panel; answers whether it did. */
  dismissKey(event: KeyboardEvent): boolean {
    if (!this.opened || event.key !== 'Escape') return false;
    this.close(true);
    return true;
  }

  /**
   * Something that can move a neighbour without resizing the bar or the
   * viewer happened (a mode change, the producer's mark arriving): placed
   * again on the next frame, once the styles it triggers have applied.
   */
  reflow(): void {
    if (!this.nodes || this.reflowFrame !== undefined) return;
    this.reflowFrame = window.requestAnimationFrame(() => {
      this.reflowFrame = undefined;
      if (this.deps.signal?.aborted === true) return;
      this.place();
      if (this.opened) this.anchor();
    });
  }

  dispose(): void {
    if (this.reflowFrame !== undefined) window.cancelAnimationFrame(this.reflowFrame);
    this.reflowFrame = undefined;
    if (this.focusTimer !== undefined) window.clearTimeout(this.focusTimer);
    this.focusTimer = undefined;
    this.outside?.abort();
    this.outside = null;
    this.observer?.disconnect();
    this.observer = null;
  }

  // ---------------------------------------------------------------- internals

  private build(): void {
    if (this.nodes) return;
    const { roots } = this.deps;
    const doc = roots.root.ownerDocument;
    const bar = roots.byName('control-bar');
    const extension = element(doc, 'div', 'settings-extension', { 'data-jeex': SETTINGS_NAMES.extension, 'data-side': this.side });
    const button = element(doc, 'button', 'icon-button settings-button', {
      type: 'button',
      'data-jeex': SETTINGS_NAMES.button,
      'aria-expanded': 'false',
      'aria-haspopup': 'dialog',
    });
    button.append(settingsIcon(doc));
    extension.append(button);
    const panel = element(doc, 'section', 'settings-panel', { 'data-jeex': SETTINGS_NAMES.panel, role: 'dialog', 'aria-modal': 'false' });
    panel.hidden = true;
    const head = element(doc, 'div', 'settings-head');
    const title = element(doc, 'h2', 'settings-title');
    const close = element(doc, 'button', 'settings-close', { type: 'button' });
    close.textContent = '×';
    head.append(title, close);
    const field = element(doc, 'div', 'settings-field', { role: 'group' });
    const fieldHead = element(doc, 'div', 'settings-field-head');
    const label = element(doc, 'span', 'settings-label');
    const output = element(doc, 'output', 'settings-value');
    fieldHead.append(label, output);
    const { min, max, step } = TEMPERATURE_RANGE;
    const slider = element(doc, 'input', 'settings-slider', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const reset = element(doc, 'button', 'settings-reset', { type: 'button' });
    field.append(fieldHead, slider, reset);
    panel.append(head, field);
    if (this.side === 'start') bar.prepend(extension);
    else bar.append(extension);
    bar.after(panel);
    this.nodes = { extension, button, panel, title, close, label, output, slider, reset };
    this.bind();
    this.render();
    if (typeof ResizeObserver !== 'undefined') {
      // Ends with the viewer, not with a boot: a Retry keeps this panel and its nodes.
      this.observer = new ResizeObserver(() => {
        if (this.deps.signal?.aborted === true) {
          this.observer?.disconnect();
          return;
        }
        this.place();
        // An open panel follows its button when the viewer or the bar changes size.
        if (this.opened) this.anchor();
      });
      this.observer.observe(bar);
      this.observer.observe(roots.viewport);
    }
  }

  /** Whether the chosen side is the bar's physical left: start in a left-to-right bar, end in a right-to-left one. */
  private onLeft(): boolean {
    const bar = this.deps.roots.byName('control-bar');
    const rtl = bar.ownerDocument.defaultView?.getComputedStyle(bar).direction === 'rtl';
    return (this.side === 'start') !== rtl;
  }

  /**
   * Beside the bar's chosen edge where it fits, else under it: a bar that a
   * long scene name has made nearly as wide as the viewer leaves no room
   * beside it, and the narrow position (`styles/viewer.css`, 600 px and below)
   * is used then too.
   */
  private place(): void {
    const nodes = this.nodes;
    if (!nodes) return;
    const bar = this.deps.roots.byName('control-bar').getBoundingClientRect();
    // A bar with no box yet (before the chrome shows) says nothing about the room beside it; the next resize decides.
    if (bar.width === 0) return;
    const frame = this.deps.roots.viewport.getBoundingClientRect();
    const room = PLATE_GAP_PX + nodes.extension.offsetWidth + EDGE_MARGIN_PX;
    const fits = this.onLeft() ? bar.left - room >= frame.left : bar.right + room <= frame.right;
    nodes.extension.dataset['placement'] = fits ? 'beside' : 'under';
    this.clearNeighbours(bar);
  }

  /**
   * Under the bar, moves the plate inwards along its row until it clears every
   * neighbour it would cover, `NEIGHBOUR_GAP_PX` past it; beside the bar it
   * stays where it is. Neighbours are watched, so a mark a locale makes wider
   * moves the plate again.
   */
  private clearNeighbours(bar: DOMRect): void {
    const extension = this.nodes!.extension;
    const at = extension.getBoundingClientRect();
    const inward = this.onLeft() ? 1 : -1;
    const left = at.left - inward * this.shift;
    const right = left + at.width;
    let shift = 0;
    if (at.top >= bar.bottom) {
      for (const neighbour of this.deps.roots.viewport.querySelectorAll<HTMLElement>(NEIGHBOURS)) {
        this.observer?.observe(neighbour);
        const box = neighbour.getBoundingClientRect();
        if (box.width === 0 || box.bottom <= at.top || box.top >= at.bottom) continue;
        if (box.right <= left + inward * shift || box.left >= right + inward * shift) continue;
        shift = inward > 0 ? box.right + NEIGHBOUR_GAP_PX - left : right - (box.left - NEIGHBOUR_GAP_PX);
      }
    }
    if (shift === this.shift) return;
    this.shift = shift;
    if (shift > 0) extension.style.setProperty('--jeex-settings-shift', `${Math.round(shift)}px`);
    else extension.style.removeProperty('--jeex-settings-shift');
  }

  private bind(): void {
    const nodes = this.nodes!;
    const listener = listenerOptions(this.deps.signal);
    nodes.button.addEventListener('click', () => (this.opened ? this.close(true) : this.open()), listener);
    nodes.close.addEventListener('click', () => this.close(true), listener);
    nodes.slider.addEventListener(
      'input',
      () => {
        const value = valueFromSlider(nodes.slider.value);
        if (value !== null) this.choose(value);
      },
      listener,
    );
    nodes.reset.addEventListener(
      'click',
      () => {
        this.choose(null);
        nodes.slider.focus();
      },
      listener,
    );
    nodes.panel.addEventListener('keydown', (event) => this.dismissKey(event), listener);
    // Focus leaving the panel for anything but its button closes it: a non-modal popover does not keep the keyboard.
    nodes.panel.addEventListener(
      'focusout',
      (event) => {
        const next = event.relatedTarget as Node | null;
        if (next !== null && !this.contains(next)) this.close(false);
      },
      listener,
    );
  }

  private choose(value: number | null): void {
    if (value === this.value) return;
    this.value = value;
    this.render();
    this.deps.onChange(value);
  }

  /** A press anywhere on the page outside the panel and its button closes it. */
  private listenOutside(): void {
    // Ends with the close, and with the viewer.
    const controller = linkedAbortController(this.deps.signal);
    this.outside = controller;
    const doc = this.deps.roots.root.ownerDocument;
    doc.addEventListener(
      'pointerdown',
      (event) => {
        const path = event.composedPath();
        const nodes = this.nodes!;
        if (path.includes(nodes.panel) || path.includes(nodes.extension)) return;
        const inside = path.includes(this.deps.roots.root);
        this.close(false);
        // A press inside the viewer focuses its root by default once this event is done: the button gets focus after it.
        if (inside) this.focusTimer = window.setTimeout(() => this.focusButton(), 0);
      },
      { signal: controller.signal },
    );
  }

  private focusButton(): void {
    this.focusTimer = undefined;
    const button = this.nodes?.button;
    if (button && !this.opened && button.isConnected) button.focus();
  }

  /**
   * Puts the panel under the button, the edge of the chosen side on the
   * button's (a narrow viewer's sheet ignores all of it). A panel anchored by
   * its left edge is clamped inside the viewer; the right-edge anchoring is
   * the one the end side always had.
   */
  private anchor(): void {
    const nodes = this.nodes!;
    const viewport = this.deps.roots.viewport;
    const frame = viewport.getBoundingClientRect();
    const button = nodes.button.getBoundingClientRect();
    const top = Math.max(0, button.bottom - frame.top + 8);
    nodes.panel.style.setProperty('--jeex-settings-top', `${Math.round(top)}px`);
    if (this.onLeft()) {
      const widest = frame.width - nodes.panel.offsetWidth - EDGE_MARGIN_PX;
      const left = Math.max(EDGE_MARGIN_PX, Math.min(button.left - frame.left, widest));
      nodes.panel.dataset['anchor'] = 'left';
      nodes.panel.style.setProperty('--jeex-settings-left', `${Math.round(left)}px`);
      return;
    }
    delete nodes.panel.dataset['anchor'];
    const right = Math.max(EDGE_MARGIN_PX, frame.right - button.right);
    nodes.panel.style.setProperty('--jeex-settings-right', `${Math.round(right)}px`);
  }

  private render(): void {
    const nodes = this.nodes;
    if (!nodes) return;
    const { messages, value } = this;
    const label = messages.t('settings.label');
    nodes.button.setAttribute('aria-label', label);
    nodes.button.title = label;
    nodes.panel.setAttribute('aria-label', messages.t('settings.title'));
    nodes.title.textContent = messages.t('settings.title');
    nodes.close.setAttribute('aria-label', messages.t('panel.close'));
    nodes.label.textContent = messages.t('settings.temperature');
    nodes.slider.setAttribute('aria-label', messages.t('settings.temperature'));
    const text = temperatureText(value, messages);
    nodes.output.textContent = text;
    nodes.slider.value = sliderPosition(value);
    nodes.slider.setAttribute('aria-valuetext', text);
    nodes.slider.dataset['original'] = String(value === null);
    nodes.reset.textContent = messages.t('settings.original');
    nodes.reset.disabled = value === null;
  }
}
