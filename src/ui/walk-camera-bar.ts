/**
 * The walk's camera stepper: two icon buttons, «Previous camera» and «Next camera», with the
 * current index («3 / 7») between them, at the bottom of the walk view. No
 * play, no progress, no auto-advance — walk is the person's own tour.
 *
 * Invariant: this module owns exactly one element, `[data-jeex="walk-cameras"]`,
 * shown only in `walk`, on a document with tour cameras, and while the host
 * keeps the viewer's controls (`chrome.controls`); a host that mounts with
 * `chrome: false` keeps the keys and the mini-map dots. Its buttons only
 * report; the step itself is the director's (`CameraDirector.stepCamera`).
 * `data-index` and `data-count` are the machine-readable half.
 */

import { listenerOptions } from '../shared/abort.js';
import type { Messages } from './messages.js';
import type { ViewerMode } from '../scene/types.js';

export const WALK_CAMERAS_NAME = 'walk-cameras';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Chevrons in the 24-unit icon grid the viewer's other icons use. */
const PREVIOUS_PATH = 'M15 5 8 12l7 7';
const NEXT_PATH = 'm9 5 7 7-7 7';

export type WalkCameraBarDeps = {
  container: HTMLElement;
  messages: Messages;
  /** Whether the host keeps the viewer's own controls (`options.chrome.controls`). */
  enabled: () => boolean;
  onStep: (to: 'previous' | 'next') => void;
  signal?: AbortSignal | undefined;
};

export class WalkCameraBar {
  private readonly deps: WalkCameraBarDeps;
  private readonly bar: HTMLDivElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private messages: Messages;
  private index: number | null = null;
  private count = 0;
  private mode: ViewerMode | undefined;

  constructor(deps: WalkCameraBarDeps) {
    this.deps = deps;
    this.messages = deps.messages;
    const doc = deps.container.ownerDocument;
    this.bar = doc.createElement('div');
    this.bar.className = 'walk-cameras';
    this.bar.dataset['jeex'] = WALK_CAMERAS_NAME;
    this.bar.setAttribute('role', 'group');
    this.bar.hidden = true;
    this.previous = button(doc, 'walk-cameras-previous', PREVIOUS_PATH);
    this.next = button(doc, 'walk-cameras-next', NEXT_PATH);
    this.label = doc.createElement('span');
    this.label.className = 'walk-cameras-index';
    this.bar.append(this.previous, this.label, this.next);
    deps.container.appendChild(this.bar);
    const listen = listenerOptions(deps.signal);
    this.previous.addEventListener('click', () => deps.onStep('previous'), listen);
    this.next.addEventListener('click', () => deps.onStep('next'), listen);
    this.render();
  }

  get element(): HTMLDivElement {
    return this.bar;
  }

  /** The current camera (0-based, `null` when none) and the count. */
  setCamera(camera: { index: number | null; count: number }): void {
    if (camera.index === this.index && camera.count === this.count) return;
    this.index = camera.index;
    this.count = camera.count;
    this.render();
  }

  /** The mode on screen; read every frame by the stage, so it must be cheap when nothing changed. */
  setMode(mode: ViewerMode | undefined): void {
    const visible = this.visibleIn(mode);
    this.mode = mode;
    if (this.bar.hidden === !visible) return;
    this.bar.hidden = !visible;
  }

  retranslate(messages: Messages): void {
    this.messages = messages;
    this.render();
  }

  dispose(): void {
    this.bar.remove();
  }

  private visibleIn(mode: ViewerMode | undefined): boolean {
    return mode === 'walk' && this.count > 0 && this.deps.enabled();
  }

  private render(): void {
    const { messages } = this;
    const shown = this.index === null ? '–' : String(this.index + 1);
    this.label.textContent = `${shown} / ${this.count}`;
    // A plain `<span>` takes no `aria-label` (axe `aria-prohibited-attr`): the group carries the spoken position.
    const group = messages.t('walkCameras.label');
    this.bar.setAttribute(
      'aria-label',
      this.index === null ? group : `${group}: ${messages.t('walkCameras.position', { n: this.index + 1, count: this.count })}`,
    );
    this.previous.setAttribute('aria-label', messages.t('walkCameras.previous'));
    this.previous.title = messages.t('walkCameras.previous');
    this.next.setAttribute('aria-label', messages.t('walkCameras.next'));
    this.next.title = messages.t('walkCameras.next');
    // With no current camera both buttons go to camera 1 (`walk-stepper.ts`).
    this.previous.disabled = this.index === 0;
    this.next.disabled = this.index !== null && this.index >= this.count - 1;
    this.bar.dataset['index'] = this.index === null ? '' : String(this.index);
    this.bar.dataset['count'] = String(this.count);
    this.setMode(this.mode);
  }
}

function button(doc: Document, className: string, path: string): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.className = className;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const stroke = doc.createElementNS(SVG_NS, 'path');
  stroke.setAttribute('d', path);
  svg.append(stroke);
  element.append(svg);
  return element;
}
