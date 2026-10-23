/**
 * The viewer's settings: a button attached to the end of the control bar and
 * the non-modal panel it opens. Its first (and so far only) setting is the
 * colour temperature of the interior's artificial light.
 *
 * Off by default: nothing of it exists until the host enables it
 * (`options.settings.show`), so a viewer that says nothing has exactly the
 * control bar it always had.
 *
 * Layout invariant: the button's wrapper is positioned ABSOLUTELY at the
 * bar's end, so the bar's centring and its flex layout ignore it and no
 * existing control moves. In a narrow viewer it sits under the bar's end,
 * inside the viewer. The panel is the bar's next sibling (so Tab goes from the
 * button straight into it), anchored under the button, and a bottom sheet in a
 * narrow viewer (`styles/viewer.css`).
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
import type { ViewerRoots } from './viewer-shell.js';

/** Where the thumb rests while the value is «Original»: neutral white. */
export const SLIDER_REST_K = 4000;

/** Below or at this many kelvin the read-out says warm, above `NEUTRAL_MAX_K` cool. */
const WARM_MAX_K = 3300;
const NEUTRAL_MAX_K = 4600;

/** The gap between the bar's end and the button's plate beside it, and the least room left to the viewer's edge, CSS px. */
const PLATE_GAP_PX = 4;
const EDGE_MARGIN_PX = 8;

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
  /** The document listener of an open panel; aborted on close. */
  private outside: AbortController | null = null;
  private focusTimer: number | undefined;
  /** Watches the bar and the viewer, so a bar too wide for the button beside it puts it under the bar's end. */
  private observer: ResizeObserver | null = null;

  constructor(deps: SettingsPanelDeps) {
    this.deps = deps;
    this.messages = deps.messages;
  }

  /** Whether the host enabled the button (`options.settings.show`). */
  setEnabled(show: boolean): void {
    if (show) this.build();
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
    this.anchor();
    nodes.panel.hidden = false;
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

  dispose(): void {
    if (this.focusTimer !== undefined) window.clearTimeout(this.focusTimer);
    this.focusTimer = undefined;
    this.outside?.abort();
    this.outside = null;
  }

  // ---------------------------------------------------------------- internals

  private build(): void {
    if (this.nodes) return;
    const { roots } = this.deps;
    const doc = roots.root.ownerDocument;
    const bar = roots.byName('control-bar');
    const extension = element(doc, 'div', 'settings-extension', { 'data-jeex': SETTINGS_NAMES.extension });
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
    bar.append(extension);
    bar.after(panel);
    this.nodes = { extension, button, panel, title, close, label, output, slider, reset };
    this.bind();
    this.render();
    if (typeof ResizeObserver !== 'undefined') {
      // Ends with the viewer, not with a boot: a Retry keeps this panel and its nodes.
      this.observer = new ResizeObserver(() => {
        if (this.deps.signal?.aborted === true) this.observer?.disconnect();
        else this.place();
      });
      this.observer.observe(bar);
      this.observer.observe(roots.viewport);
    }
  }

  /**
   * Beside the bar's end where it fits, else under it: a bar that a long scene
   * name has made nearly as wide as the viewer leaves no room beside it, and
   * the narrow position (`styles/viewer.css`, 600 px and below) is used then too.
   */
  private place(): void {
    const nodes = this.nodes;
    if (!nodes) return;
    const bar = this.deps.roots.byName('control-bar').getBoundingClientRect();
    const frame = this.deps.roots.viewport.getBoundingClientRect();
    const fits = bar.right + PLATE_GAP_PX + nodes.extension.offsetWidth + EDGE_MARGIN_PX <= frame.right;
    nodes.extension.dataset['placement'] = fits ? 'beside' : 'under';
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

  /** Puts the panel under the button, its end edge on the button's (a narrow viewer's sheet ignores both). */
  private anchor(): void {
    const nodes = this.nodes!;
    const viewport = this.deps.roots.viewport;
    const frame = viewport.getBoundingClientRect();
    const button = nodes.button.getBoundingClientRect();
    const top = Math.max(0, button.bottom - frame.top + 8);
    const right = Math.max(8, frame.right - button.right);
    nodes.panel.style.setProperty('--jeex-settings-top', `${Math.round(top)}px`);
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
