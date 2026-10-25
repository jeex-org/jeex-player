/**
 * The viewer's ONE selection panel: the anchored card that serves finishes,
 * furniture variants, opening variants and interior presets, and the one
 * `swatch()` factory every item in it is built with.
 *
 * There is one panel, not four, because they differ only in what they list:
 * `PanelRequest` carries the copy, the items, the optional scope checkbox and
 * the optional footer button, and `panel-requests.ts` builds one per kind.
 *
 * A preview is an IMAGE. The name is a separate label under it, never
 * text drawn into the thumbnail.
 *
 * Machine-readable state (`scripts/browser-check`): `data-kind` plus whatever
 * `panelData` the request stamps (`data-surface`, `data-owner`, `data-wall`,
 * `data-side`, `data-asset`, `data-opening`, `data-preset`, `data-presets`),
 * and `data-busy` while a batch commits. `data-jeex` is a dataset key too, and it is the one
 * `openPanel` must NOT clear when it drops the previous target's identity —
 * the name is the only handle anything has on the node.
 */

import type { ViewerRoots } from './viewer-shell.js';
import { SHELL_DATA_KEY } from './viewer-shell.js';
import { listenerOptions } from '../shared/abort.js';

/** Which family of swatches a panel shows; decides the thumbnail class names. */
type PanelKind = 'finish' | 'furniture' | 'opening' | 'interior';

/**
 * Kinds whose preview is a rendered OBJECT (a furniture or opening variant),
 * shown large and uncropped. Finishes and interior presets are flat material
 * chips instead, cropped to fill.
 */
const OBJECT_PREVIEW_KINDS: ReadonlySet<PanelKind> = new Set<PanelKind>(['furniture', 'opening']);

/** Panel anchor clamp, in pixels: half the panel width, and its margins. */
const PANEL_OFFSET_X = 110;
const PANEL_OFFSET_Y = 14;
const PANEL_MIN_LEFT = 12;
const PANEL_MIN_TOP = 64;
const PANEL_RIGHT_MARGIN = 276;
const PANEL_BOTTOM_MARGIN = 300;

/**
 * Dataset keys `openPanel` must NOT clear when it drops the identity of the
 * previous target: `state` is the panel's own lifecycle, and `jeex` is the
 * shell name every lookup and every browser-check assertion goes through.
 */
const KEPT_DATA: ReadonlySet<string> = new Set(['state', SHELL_DATA_KEY]);

/**
 * Every element kind the panel's focus trap has to consider a tab stop.
 * `[tabindex]:not([tabindex="-1"])` is last so a future overlay control with
 * an explicit positive or zero tabindex is caught without a new clause.
 */
const FOCUSABLE_SELECTOR = "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

/**
 * The panel's own tab stops, in DOM order, skipping anything under an
 * `is-hidden` ancestor — the scope checkbox and the footer button are both
 * toggled that way, and a hidden control is not a place Tab may land.
 */
export function focusablesOf(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => !element.closest('.is-hidden'));
}

export type PanelItem = {
  id: string;
  /** Shown as a separate label under the preview and as the button title. */
  label: string;
  /**
   * The swatch's picture: a rendered `data:` URL, or — since the content may
   * name its own — an absolute `http(s)` address on someone else's server.
   * `null` falls back to
   * `background` directly, and so does a picture that fails to load.
   */
  thumbnail: string | null;
  /** CSS background of the fallback chip when there is no thumbnail, or when one fails to load. */
  background?: string;
  active: boolean;
  /** `data-*` attributes of the swatch, e.g. `{ finish: 'oak' }`. */
  dataset: Record<string, string>;
};

type PanelPick = { id: string; scopeChecked: boolean };
type PanelFooterContext = { activeId: string | null; scopeChecked: boolean };

export type PanelRequest = {
  kind: PanelKind;
  title: string;
  items: PanelItem[];
  /** Optional narrowing checkbox ("Only this wall"); absent hides the row. */
  scope?: { label: string; checked: boolean; onChange?: ((checked: boolean) => void) | undefined } | undefined;
  /** Optional wide action button under the swatches; absent hides it. */
  footer?: { label: string; hint?: string; onClick: (context: PanelFooterContext) => void };
  /**
   * Optional second action, in a row of its own under `footer`, so showing it
   * moves no control that was already there; absent hides it.
   */
  secondary?: { label: string; onClick: () => void } | undefined;
  /** Client coordinates the panel is anchored to, clamped into the shell. */
  anchor: { x: number; y: number };
  /**
   * `data-*` attributes stamped on the panel element while it is open. This is
   * the machine-readable identity of what is being edited, so automation never
   * has to parse the title copy.
   */
  panelData?: Record<string, string>;
  onPick: (pick: PanelPick) => void;
};

/**
 * The flat fallback under a swatch: the option's own palette as a CSS
 * background. One factory, two callers — an option that never had a picture
 * and one whose picture failed to load — so the two cannot drift apart.
 */
function swatchChip(item: PanelItem, objectPreview: boolean, document: Pick<Document, 'createElement'>): HTMLDivElement {
  const chip = document.createElement('div');
  // `objectPreview` is the single source of truth: the class name follows from
  // it, so the two cannot be handed in disagreeing.
  chip.className = objectPreview ? `${thumbClass(objectPreview)} variant-chip` : thumbClass(objectPreview);
  if (item.background) chip.style.background = item.background;
  return chip;
}

/** The preview's own class: object previews are shown large and uncropped, flat chips are cropped to fill. */
function thumbClass(objectPreview: boolean): string {
  return objectPreview ? 'variant-thumb' : 'swatch-thumb';
}

/**
 * The single swatch factory of the viewer: a preview image with no text in it,
 * the name as a separate label, the `data-*` attributes the browser
 * check selects on, and the `is-active` ring.
 *
 * `document` is a parameter, not the global: the caller passes the panel's own
 * `ownerDocument`, so a button built for a viewer mounted into a different
 * document (a popup, a foreign realm) is never created in the wrong one.
 */
export function swatch(
  item: PanelItem,
  kind: PanelKind,
  onPick: (id: string) => void,
  document: Pick<Document, 'createElement'>,
  signal?: AbortSignal,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'finish-swatch' + (item.active ? ' is-active' : '');
  for (const [key, value] of Object.entries(item.dataset)) button.dataset[key] = value;
  button.title = item.label;
  button.setAttribute('aria-pressed', String(item.active));
  const objectPreview = OBJECT_PREVIEW_KINDS.has(kind);
  if (item.thumbnail) {
    const image = document.createElement('img');
    image.alt = '';
    image.className = thumbClass(objectPreview);
    image.loading = 'lazy';
    image.decoding = 'async';
    // A picture may now be served by a catalogue service rather than drawn here,
    // and a request carries the embedding page in `Referer` by default — which
    // would tell that service which sites embed the viewer. The picture needs no
    // referrer to be served.
    image.referrerPolicy = 'no-referrer';
    // A picture is not always a `data:` URL the viewer just drew: a
    // project's manifest may name an address on a catalogue service, and a request
    // to another origin can 404, time out or be blocked. A broken
    // <img> is the one outcome a picker must never show, so the failure puts
    // the flat chip in its place — the same one an option with no picture at
    // all gets. `once`: the replacement removes the node, and a second error
    // would have nothing to replace.
    image.addEventListener('error', () => image.replaceWith(swatchChip(item, objectPreview, document)), {
      once: true,
      ...listenerOptions(signal),
    });
    // `src` LAST, and that is the point: everything above has to be in place
    // before the fetch can start. It is safe today only because the element is
    // still detached (the fetch is deferred to insertion), which is a spec
    // invariant a future edit could break silently — eager loading, or a
    // failure with no listener to catch it.
    image.src = item.thumbnail;
    button.appendChild(image);
  } else {
    button.appendChild(swatchChip(item, objectPreview, document));
  }
  const label = document.createElement('span');
  label.className = objectPreview ? 'variant-label' : 'swatch-label';
  label.textContent = item.label;
  button.appendChild(label);
  button.addEventListener('click', () => onPick(item.id), listenerOptions(signal));
  return button;
}

type SelectionPanelDeps = {
  roots: ViewerRoots;
  /** The box the card is clamped inside. */
  viewport: { clientWidth: number; clientHeight: number; getBoundingClientRect(): DOMRect };
  /** Any interaction with the panel wakes the rest of the chrome. */
  onInteraction: () => void;
  /** Fired when the panel closes for any reason, so the caller can drop its target. */
  onClose?: (() => void) | undefined;
  /**
   * The mounted viewer's lifetime. Every swatch button binds a `click`, and a
   * panel is opened many times over a session: without the signal those
   * handlers outlive the viewer that made them.
   */
  signal?: AbortSignal | undefined;
};

export class SelectionPanel {
  private readonly deps: SelectionPanelDeps;
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly swatches: HTMLElement;
  private readonly scope: HTMLElement;
  private readonly scopeLabel: HTMLElement;
  private readonly scopeInput: HTMLInputElement;
  private readonly footer: HTMLButtonElement;
  private readonly secondary: HTMLButtonElement;

  private request: PanelRequest | null = null;
  private activeItemId: string | null = null;
  /** Whether `bind()` has already run; a second call is a no-op. */
  private bound = false;
  /**
   * Whatever had focus the moment the panel opened, so `close()` can give it
   * back (dialog focus moves in on open and is restored on close). Read
   * off THIS root's own notion of `activeElement` — the shadow root's inside a
   * shadow tree, the document's in light DOM — never the host page's, which a
   * viewer that does not have focus must not touch.
   */
  private previouslyFocused: HTMLElement | null = null;

  constructor(deps: SelectionPanelDeps) {
    const { byName } = deps.roots;
    this.deps = deps;
    this.panel = byName('finish-panel');
    this.title = byName('finish-title');
    this.swatches = byName('finish-swatches');
    this.scope = byName('finish-scope');
    this.scopeLabel = byName('finish-scope-label');
    this.scopeInput = byName<HTMLInputElement>('finish-scope-wall');
    this.footer = byName<HTMLButtonElement>('finish-all');
    this.secondary = byName<HTMLButtonElement>('finish-other');
  }

  /**
   * Binds the close button and the panel's own focus trap. Idempotent,
   * because the Retry path re-runs the whole boot in the same instance.
   */
  bind(): void {
    if (this.bound) return;
    this.bound = true;
    const listener = listenerOptions(this.deps.signal);
    this.deps.roots.byName<HTMLButtonElement>('finish-close').addEventListener('click', () => this.close(), listener);
    // Modal Tab trap: a native `<dialog>` would take
    // this for free, but `showModal()` makes the WHOLE containing document
    // inert — including a host page's own content outside this viewer, light
    // DOM or an open shadow root alike (MDN, `HTMLDialogElement.showModal()`,
    // retrieved 2026-09-08: "elements inside the same document as the dialog,
    // except the dialog and its descendants, become inert"; the containing
    // DOCUMENT is the host's page, not this instance's shadow tree). That is
    // a concrete blocker for an embeddable component, which must stay
    // resilient in someone else's page, so the panel stays `role="dialog"` with a
    // hand-rolled trap scoped to its own descendants.
    this.panel.addEventListener('keydown', this.onKeyDown, listener);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || !this.request) return;
    const focusables = focusablesOf(this.panel);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables.at(-1)!;
    const root = this.panel.getRootNode() as unknown as DocumentOrShadowRoot;
    const active = root.activeElement as HTMLElement | null;
    const inside = active !== null && focusables.includes(active);
    const onEdge = event.shiftKey ? !inside || active === first : !inside || active === last;
    if (!onEdge) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  };

  /** True while a pointer press outside `panel` should close it. */
  contains(node: Node): boolean {
    return this.panel.contains(node);
  }

  isOpen(): boolean {
    return this.request !== null;
  }

  /** Live state of the "only this wall" checkbox, which tests set directly. */
  scopeChecked(): boolean {
    return this.scopeInput.checked;
  }

  /**
   * Opens the panel for one request. `kind` picks the swatch styling, `scope`
   * and `footer` appear only when given, and the card is anchored to `anchor`
   * clamped inside the viewport.
   */
  open(request: PanelRequest): void {
    // Captured only on the CLOSED→OPEN edge: a second `open()` while the panel
    // is already showing (a click on another surface while it is up) must
    // still give focus back to the ORIGINAL trigger on close, not to whatever
    // swatch inside the panel itself last held it.
    if (!this.request) {
      const root = this.panel.getRootNode() as unknown as DocumentOrShadowRoot;
      this.previouslyFocused = root.activeElement as HTMLElement | null;
    }
    this.request = request;
    for (const key of Object.keys(this.panel.dataset)) {
      if (!KEPT_DATA.has(key)) delete this.panel.dataset[key];
    }
    // Machine-readable open/closed state: a browser check
    // reads this, never the `is-hidden` class the line below also sets for
    // the CSS that actually hides the card.
    this.panel.dataset['open'] = 'true';
    this.panel.dataset['kind'] = request.kind;
    this.setBusy(false);
    for (const [key, value] of Object.entries(request.panelData ?? {})) this.panel.dataset[key] = value;
    this.activeItemId = request.items.find((item) => item.active)?.id ?? null;
    this.swatches.replaceChildren();
    for (const item of request.items) {
      this.swatches.appendChild(swatch(item, request.kind, (id) => this.pick(id), this.swatches.ownerDocument, this.deps.signal));
    }
    this.title.textContent = request.title;
    this.scope.classList.toggle('is-hidden', !request.scope);
    if (request.scope) this.scopeLabel.textContent = request.scope.label;
    // Reset on every open, scoped or not, so a stale tick cannot leak into the
    // next wall panel.
    this.scopeInput.checked = request.scope?.checked ?? false;
    this.footer.classList.toggle('is-hidden', !request.footer);
    if (request.footer) {
      this.footer.textContent = request.footer.label;
      if (request.footer.hint) this.footer.title = request.footer.hint;
      this.footer.onclick = () => request.footer?.onClick({ activeId: this.activeItemId, scopeChecked: this.scopeChecked() });
    } else {
      this.footer.onclick = null;
    }
    this.secondary.classList.toggle('is-hidden', !request.secondary);
    if (request.secondary) this.secondary.textContent = request.secondary.label;
    this.secondary.onclick = request.secondary ? () => request.secondary?.onClick() : null;
    this.anchor(request.anchor.x, request.anchor.y);
    this.panel.classList.remove('is-hidden');
    // Dialog focus-in: the FIRST control of the panel, in DOM
    // order — the close button, unless a future request removes it.
    focusablesOf(this.panel)[0]?.focus();
    this.deps.onInteraction();
  }

  close(): void {
    if (!this.request) {
      this.panel.classList.add('is-hidden');
      this.panel.dataset['open'] = 'false';
      return;
    }
    this.request = null;
    this.activeItemId = null;
    this.panel.classList.add('is-hidden');
    this.panel.dataset['open'] = 'false';
    this.setBusy(false);
    delete this.panel.dataset['kind'];
    this.restoreFocus();
    this.deps.onClose?.();
  }

  /**
   * Dialog focus-out: gives focus back to whatever had it before
   * the panel opened, when that element is still around to take it — a swap
   * or a rebuild may have removed it from the document entirely, and asking a
   * detached node to focus is a silent no-op that would otherwise leave
   * keyboard focus nowhere the user can find it.
   */
  private restoreFocus(): void {
    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    if (!target || !target.isConnected) return;
    target.focus();
  }

  /**
   * Marks the panel as committing a batch. A preset moves the whole flat, so
   * the swatches stop taking clicks until the revision lands; `data-busy` is
   * the machine-readable half.
   */
  setBusy(busy: boolean): void {
    if (busy) this.panel.dataset['busy'] = 'true';
    else delete this.panel.dataset['busy'];
    this.panel.setAttribute('aria-busy', String(busy));
  }

  private pick(id: string): void {
    const request = this.request;
    if (!request) return;
    this.markActive(id);
    request.onPick({ id, scopeChecked: this.scopeChecked() });
  }

  private markActive(id: string): void {
    this.activeItemId = id;
    const request = this.request;
    if (!request) return;
    const buttons = this.swatches.querySelectorAll<HTMLButtonElement>('.finish-swatch');
    request.items.forEach((item, index) => {
      const active = item.id === id;
      buttons[index]?.classList.toggle('is-active', active);
      buttons[index]?.setAttribute('aria-pressed', String(active));
    });
  }

  /** Places the panel near the pointer without letting it leave the viewport. */
  private anchor(clientX: number, clientY: number): void {
    const { viewport } = this.deps;
    const rect = viewport.getBoundingClientRect();
    // On a viewport narrower than the margins the upper bound falls below the
    // lower one, and a plain `min(max(...))` then produces a NEGATIVE offset
    // that pushes the panel off-screen; the upper bound is floored instead.
    const maxLeft = Math.max(PANEL_MIN_LEFT, viewport.clientWidth - PANEL_RIGHT_MARGIN);
    const maxTop = Math.max(PANEL_MIN_TOP, viewport.clientHeight - PANEL_BOTTOM_MARGIN);
    const left = Math.min(Math.max(PANEL_MIN_LEFT, clientX - rect.left - PANEL_OFFSET_X), maxLeft);
    const top = Math.min(Math.max(PANEL_MIN_TOP, clientY - rect.top + PANEL_OFFSET_Y), maxTop);
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${top}px`;
    // The panel never runs past the viewer's bottom: its swatch region scrolls
    // instead (`viewer.css`), so every item stays reachable. Nothing is
    // measured: the bound follows from where the panel was just put.
    this.panel.style.maxBlockSize = `${Math.max(0, viewport.clientHeight - top - PANEL_MIN_LEFT)}px`;
  }
}
