/**
 * The viewer's own chrome, minus the tour bar and the selection panel: the four
 * shell STATES (loading, error, degraded, running), the control bar and its
 * buttons, the hint line, and the idle auto-hide.
 *
 * Invariant: the chrome is a VIEW. It never decides anything — every button
 * calls a `ViewerCommands` the application supplied, and every state it shows
 * was pushed in. `options.chrome` can take the bar and the hint away entirely
 * without taking a single capability with them.
 *
 * Every element is reached through `ViewerRoots.byName`, so a lookup can only
 * return a node of THIS instance, and every listener is bound to one of those
 * nodes — there is no `window` listener left to unbind.
 */

import type { ViewerMode } from '../scene/types.js';
import { LIVE_MODE_LABEL, MODE_HINT, type Messages } from './messages.js';
import { listenerOptions } from '../shared/abort.js';
import type { ViewerRoots } from './viewer-shell.js';
import { applyChromeOverlay, type ShellChromeFlags } from './chrome-overlay.js';
import { chromeLayout } from './chrome-layout.js';
import { MODE_LABELS } from './mode-labels.js';
import type { FullscreenController } from './fullscreen-controller.js';
import { adoptFallbackCanvas, paintWebglFallback } from './webgl-fallback.js';

/** Idle before the control bar collapses to its reveal pill, milliseconds. */
const HIDE_CONTROLS_MS = 4200;
/**
 * The live region's own throttle — a fast run of announcements
 * (spam-clicking mode buttons) coalesces to the LATEST one, never faster than
 * this, so the screen reader is not asked to interrupt itself every frame.
 */
const ANNOUNCE_THROTTLE_MS = 1000;

/** What the chrome asks the application to do; no scene type crosses here. */
export type ChromeCommands = {
  setMode: (mode: ViewerMode) => void;
  resetCamera: () => void;
  toggleTour: () => void;
  toggleFullscreen: () => void | Promise<void>;
  toggleFurniture: () => void;
  /**
   * Opens the interior-preset panel, anchored at the given client point (the
   * bottom of the button that asked). No-op when the scene ships no presets.
   */
  openInteriors: (anchor: { x: number; y: number }) => void;
  /** The settings panel chose a light temperature, or «Original» (`null`). */
  setLightTemperature: (temperature: number | null) => void;
};

/**
 * `options.chrome` as the chrome receives it: the five LAYOUT flags plus the
 * one behaviour flag. `autoHide` is kept out of `ShellChromeFlags` on purpose
 * — `chromeOverlayMode` compares the layout, and a host that pins the bar open
 * must not thereby lose the `unbranded` portal layout.
 */
export type ChromeFlags = ShellChromeFlags & { autoHide: boolean };

/** `options.fullscreenButton` as the chrome receives it. */
export type FullscreenButtonFlags = { show: boolean; right: number; top: number };

export type ViewerChromeDeps = {
  roots: ViewerRoots;
  viewport: FullscreenController;
  messages: Messages;
  commands: ChromeCommands;
  /** A mode button was pressed: the caller re-labels the tour button and hints. */
  onModePressed: (mode: ViewerMode) => void;
  /** The auto-hide state changed; the tour bar keeps its own counsel about it. */
  onCollapseChanged: () => void;
  /** Escape, and a press outside the panel, ask the caller to close it. */
  onDismiss: (event: Event) => void;
  /** The Retry button of the error card: re-runs THIS instance's boot. */
  onRetry?: (() => void) | undefined;
  /** The mounted viewer's lifetime; every listener bound below carries it. */
  signal?: AbortSignal | undefined;
};

export class ViewerChrome {
  private readonly deps: ViewerChromeDeps;
  private messages: Messages;
  private canvas: HTMLCanvasElement;

  private readonly loadingState: HTMLElement;
  private readonly loadingProgress: HTMLElement;
  private readonly loadingLabel: HTMLElement;
  private readonly errorState: HTMLElement;
  private readonly errorTitle: HTMLElement;
  private readonly errorMessage: HTMLElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly viewerUI: HTMLElement;
  private readonly controlBar: HTMLElement;
  private readonly brandContext: HTMLElement;
  private readonly brandLockup: HTMLElement;
  private readonly modeSwitcher: HTMLElement;
  private readonly hintCard: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly degradedNotice: HTMLElement;
  private readonly revealControls: HTMLButtonElement;
  private readonly furnitureButton: HTMLButtonElement;
  private readonly interiorsButton: HTMLButtonElement;
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly floatingFullscreen: HTMLButtonElement;
  private readonly liveRegion: HTMLElement;

  /** Whether `bind()` has already run; a second call is a no-op. */
  private bound = false;
  /** The mode last announced, so an unchanged `setModeButtons` says nothing new. */
  private announcedMode: ViewerMode | null = null;
  /** `ANNOUNCE_THROTTLE_MS` bookkeeping — when the window opens again, and what still needs saying. */
  private announcedAt = -Infinity;
  private pendingAnnouncement?: string | undefined;
  private announceTimer?: number | undefined;
  /** What `setCanvasDescription` was last given, so `retranslate` can rebuild it in the new language. */
  private lastDescription?: { sceneName: string; roomNames: readonly string[] } | undefined;
  /** True while a plan mode is on; the interior selector steps aside. */
  private planMode = false;
  /** Whether the scene offers interior presets at all. */
  private interiorsAvailable = false;
  /** What the furniture toggle currently reports; re-rendered on a locale change. */
  private furnitureShown = true;
  private collapsed = false;
  /** `options.chrome.autoHide`; `false` pins the bar open and arms no idle timer. */
  private autoHide = true;
  /** A panel hanging off the bar is open (the settings): the bar stays awake until it closes. */
  private pinned = false;
  /** `options.chrome` as last pushed in; `undefined` until the boot pushes it, so nothing is laid out before. */
  private chromeFlags?: ShellChromeFlags | undefined;
  /** `options.fullscreenButton.show`. */
  private floatingFullscreenShown = false;
  /** `options.readonly`: the brand leaves the bar; Reset camera stays. */
  private readonly = false;
  /** The clip was playing at the last `setTourButtonLabel`, so `retranslate` re-renders Pause in the new language. */
  private tourPlaying = false;
  /** Whether this viewer was fullscreen at the last `updateFullscreenButton`; entering it wakes the bar. */
  private fullscreen = false;
  /**
   * The floating button was pressed from the KEYBOARD (`:focus-visible` at the
   * press): entering fullscreen hides it, so focus moves on to the toolbar's
   * fullscreen button instead of dropping to `body`. A pointer press leaves
   * focus alone — moving it would fire the bar's `focusin` and pin the bar open
   * with no auto-hide.
   */
  private focusToolbarOnEnter = false;
  private hideTimer?: number | undefined;
  /**
   * The `focusout` follow-up. It is a real handle, not a fire-and-forget: it
   * guards against a focusout in the same task as `dispose()` scheduling a
   * callback that then reads disposed state.
   */
  private focusOutTimer?: number | undefined;
  /** True after `dispose()`; a timer that already fired stops here. */
  private disposed = false;

  constructor(deps: ViewerChromeDeps) {
    const { byName } = deps.roots;
    this.deps = deps;
    this.messages = deps.messages;
    this.canvas = deps.roots.canvas;
    this.loadingState = byName('loading-state');
    this.loadingProgress = byName('loading-progress');
    this.loadingLabel = byName('loading-label');
    this.errorState = byName('error-state');
    this.errorTitle = byName('error-title');
    this.errorMessage = byName('error-message');
    this.retryButton = byName<HTMLButtonElement>('retry-button');
    this.viewerUI = byName('viewer-ui');
    this.controlBar = byName('control-bar');
    this.brandContext = byName('brand-context');
    this.brandLockup = byName('brand-lockup');
    this.modeSwitcher = byName('mode-switcher');
    this.hintCard = byName('hint-card');
    this.hintText = byName('hint-text');
    this.degradedNotice = byName('degraded-notice');
    this.revealControls = byName<HTMLButtonElement>('reveal-controls');
    this.furnitureButton = byName<HTMLButtonElement>('furniture-button');
    this.interiorsButton = byName<HTMLButtonElement>('interiors-button');
    this.fullscreenButton = byName<HTMLButtonElement>('fullscreen-button');
    this.resetButton = byName<HTMLButtonElement>('reset-button');
    this.floatingFullscreen = byName<HTMLButtonElement>('fullscreen-float');
    this.liveRegion = byName('live-region');
  }

  /** True while the bar has auto-hidden; the tour bar reads it. */
  get isCollapsed(): boolean {
    return this.collapsed;
  }

  /**
   * Binds every control of the shell.
   *
   * Idempotent: the Retry path re-runs the whole boot in the same instance, and
   * a second `bind()` must not double every handler (one click on Fullscreen
   * would enter and immediately leave it).
   */
  bind(): void {
    // A Retry binds a chrome whose `dispose()` has already run; the listeners
    // are still there (they carry the mount's signal, not the boot's), so only
    // the timer guard has to come back.
    this.disposed = false;
    if (this.bound) return;
    this.bound = true;
    const listener = listenerOptions(this.deps.signal);
    // Scoped to the bar on purpose: `[data-mode]` alone also matches the
    // mini-map card, whose `data-mode` reports which mode it is showing FOR.
    // Bound unscoped, a click on the map was read as a sixth mode button and
    // cancelled the very walk it had just started.
    this.modeButtons().forEach((button) => {
      button.addEventListener('click', () => this.deps.onModePressed(button.dataset['mode'] as ViewerMode), listener);
    });
    this.resetButton.addEventListener(
      'click',
      () => {
        this.deps.commands.resetCamera();
        this.setModeButtons('orbit');
        this.setHintForMode('orbit');
        this.wake();
      },
      listener,
    );
    this.furnitureButton.addEventListener('click', () => this.deps.commands.toggleFurniture(), listener);
    this.interiorsButton.addEventListener(
      'click',
      () => {
        const rect = this.interiorsButton.getBoundingClientRect();
        this.deps.commands.openInteriors({ x: rect.left + rect.width / 2, y: rect.bottom });
      },
      listener,
    );
    // Both buttons ask the ONE command: there is no second fullscreen
    // implementation behind the floating one. Each press re-decides
    // where focus goes on entering, so a stale keyboard press never steers a
    // later one.
    this.fullscreenButton.addEventListener(
      'click',
      () => {
        this.focusToolbarOnEnter = false;
        void this.deps.commands.toggleFullscreen();
      },
      listener,
    );
    this.floatingFullscreen.addEventListener(
      'click',
      () => {
        this.focusToolbarOnEnter = this.floatingFullscreen.matches(':focus-visible');
        void this.deps.commands.toggleFullscreen();
      },
      listener,
    );
    this.revealControls.addEventListener('click', () => this.wake(true), listener);
    this.retryButton.addEventListener('click', () => this.deps.onRetry?.(), listener);

    const root = this.deps.roots.root;
    root.addEventListener('pointermove', () => this.wake(), listener);
    root.addEventListener('pointerdown', () => this.wake(), listener);
    root.addEventListener('focusin', () => this.wake(true), listener);
    root.addEventListener(
      'focusout',
      () => {
        // `activeElement` of THIS root, which is the shadow root's own inside a
        // shadow tree and the document's in light DOM — never the host page's
        // notion of focus for a viewer that does not have it.
        if (this.focusOutTimer) window.clearTimeout(this.focusOutTimer);
        this.focusOutTimer = window.setTimeout(() => {
          this.focusOutTimer = undefined;
          if (this.disposed) return;
          const focused = (root.getRootNode() as unknown as DocumentOrShadowRoot).activeElement;
          if (!this.controlBar.contains(focused)) this.wake();
        }, 0);
      },
      listener,
    );
    root.addEventListener('pointerdown', this.deps.onDismiss, listener);
    // On the ROOT, not on `window`: Escape closes the panel of the viewer that
    // has focus, and leaves every other viewer on the page alone.
    root.addEventListener('keydown', this.deps.onDismiss, listener);
    this.updateFullscreenButton();
  }

  /**
   * Releases every timer. Every listener this class binds carries the mount's
   * signal, so nothing is unbound here — but a timer already scheduled is not a
   * listener and has to be cancelled by hand.
   */
  dispose(): void {
    this.disposed = true;
    if (this.hideTimer) window.clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    if (this.focusOutTimer) window.clearTimeout(this.focusOutTimer);
    this.focusOutTimer = undefined;
    if (this.announceTimer) window.clearTimeout(this.announceTimer);
    this.announceTimer = undefined;
  }

  /** Adopts a new catalogue and re-renders every string the chrome owns. */
  retranslate(messages: Messages): void {
    this.messages = messages;
    this.updateFullscreenButton();
    this.setFurnitureState(this.furnitureShown);
    this.setTourButtonLabel(this.tourPlaying);
    if (this.lastDescription) this.setCanvasDescription(this.lastDescription.sceneName, this.lastDescription.roomNames);
  }

  // ---- Shell states -------------------------------------------------------

  setLoading(value: number, label: string): void {
    this.loadingProgress.style.width = `${value}%`;
    this.loadingLabel.textContent = label;
  }

  /** Back to the loading card: what Retry shows while the instance boots again. */
  showLoading(): void {
    this.errorState.classList.add('is-hidden');
    this.viewerUI.classList.add('is-hidden');
    this.loadingState.classList.remove('is-hidden');
  }

  /**
   * Hides the loading AND the error card and reveals the viewer chrome.
   *
   * The error card is taken down here rather than only in `showLoading`,
   * because a restored WebGL context goes straight from the card back to a
   * running scene without a loading step in between (`viewer-app.ts`).
   */
  showViewer(): void {
    this.loadingState.classList.add('is-hidden');
    this.errorState.classList.add('is-hidden');
    this.viewerUI.classList.remove('is-hidden');
  }

  showDegradedNotice(): void {
    this.degradedNotice.classList.remove('is-hidden');
  }

  /**
   * Error state plus, for a DEAD END, the flat 2D preview that stands in for
   * the scene.
   *
   * `keepCanvas` is what a failure passes whose canvas is expected to keep
   * (context loss) or regain (Retry) a WebGL context of its own: painting a
   * 2D fallback into it — the only context a canvas may ever hold — would
   * take that away for good; this guards a boot that failed before the scene
   * ever loaded against exactly that.
   * `retry` skips the paint for the same reason: a canvas behind a Retry
   * button is a canvas `buildStage()` is about to ask for WebGL again. Only a
   * failure that offers neither — truly no way back on this canvas — reaches
   * the illustration below.
   */
  showError(title: string, message: string, retry: boolean, keepCanvas = false): void {
    this.loadingState.classList.add('is-hidden');
    this.viewerUI.classList.add('is-hidden');
    this.errorTitle.textContent = title;
    this.errorMessage.textContent = message;
    this.retryButton.classList.toggle('is-hidden', !retry);
    this.errorState.classList.remove('is-hidden');
    if (keepCanvas || retry) return;
    const adopted = adoptFallbackCanvas(this.canvas, 'scene-canvas', this.messages.t('canvas.fallbackLabel'));
    this.canvas = adopted.canvas;
    if (adopted.context) paintWebglFallback(this.canvas, adopted.context, this.deps.viewport);
  }

  /**
   * The visible hint card. Mirrored into the hidden live region:
   * every room name a directed action (`focusRoom`, a minimap click,
   * `travelToRoom`) puts in the hint — `hint.room`, `hint.alreadyHere`,
   * `hint.travelling` — reaches a screen reader the same way, which is what
   * "reuse the existing room-tracking the hint uses" means: there is no
   * second room tracker, only a second SINK for the one the director
   * already raises hints through (`camera-director.ts`).
   */
  setHint(message: string): void {
    this.hintText.textContent = message;
    this.announce(message);
  }

  setHintForMode(mode: ViewerMode): void {
    this.setHint(this.messages.t(MODE_HINT[mode]));
  }

  /**
   * The brand lockup's context line: which apartment is on screen. It is
   * `scene.name` of the committed document, re-read on every mount, because a
   * viewer that ships a literal there is a viewer that can show only one flat.
   */
  setSceneName(name: string): void {
    this.brandContext.textContent = name;
  }

  /**
   * The canvas's `aria-description` (see the shell's own note on why not
   * `aria-describedby`): the apartment's name, its room list, and
   * the real keyboard bindings, rebuilt on every `loadScene` and never
   * authored once and left stale.
   */
  setCanvasDescription(sceneName: string, roomNames: readonly string[]): void {
    this.lastDescription = { sceneName, roomNames };
    this.canvas.setAttribute(
      'aria-description',
      this.messages.t('canvas.description', {
        name: sceneName,
        rooms: roomNames.join(', '),
        keys: this.messages.t('canvas.keys'),
      }),
    );
  }

  /**
   * The live region's own copy for `mode`, announced only when it is a
   * CHANGE — `setModeButtons` runs on every mode-affecting action, including
   * ones that re-confirm the mode already on screen, and re-reading the same
   * words twice is noise, not information.
   */
  private announceMode(mode: ViewerMode): void {
    if (this.announcedMode === mode) return;
    this.announcedMode = mode;
    this.announce(this.messages.t(LIVE_MODE_LABEL[mode]));
  }

  /**
   * Writes `text` to the hidden live region, throttled to at most once per
   * `ANNOUNCE_THROTTLE_MS`: a burst within the window replaces whatever was
   * PENDING rather than being dropped, so the last word is always the one
   * that lands, and a text identical to what is already there is skipped —
   * `aria-live` does not re-announce an unchanged node.
   */
  private announce(text: string): void {
    if (this.liveRegion.textContent === text) return;
    const elapsed = performance.now() - this.announcedAt;
    if (elapsed >= ANNOUNCE_THROTTLE_MS) {
      this.announcedAt = performance.now();
      this.liveRegion.textContent = text;
      return;
    }
    this.pendingAnnouncement = text;
    if (this.announceTimer) return;
    this.announceTimer = window.setTimeout(() => {
      this.announceTimer = undefined;
      this.announcedAt = performance.now();
      if (this.pendingAnnouncement !== undefined) this.liveRegion.textContent = this.pendingAnnouncement;
      this.pendingAnnouncement = undefined;
    }, ANNOUNCE_THROTTLE_MS - elapsed);
  }

  /**
   * Which parts of the chrome are on screen at all (`options.chrome`).
   *
   * `hidden` rather than a class, because it is the DOM's own answer to "this
   * element is not part of the page right now" and it stays readable to a
   * browser check. `hint` is its own flag: a host can show a hint with
   * the control bar hidden, or the other way round — `controls` does not
   * carry it. `revealControls` FOLLOWS `controls`:
   * the pill `wake()` offers after auto-hide is native-`hidden` whenever the
   * bar it reveals is off, so a later `wake(true)` — a focus entering the
   * shell, say — cannot make it appear (or receive focus) while the host asked
   * for no controls at all.
   */
  setChrome(chrome: ChromeFlags): void {
    this.autoHide = chrome.autoHide;
    // Only when it is switched OFF: `wake()` then cancels whatever is already
    // ticking and gives back a bar that had collapsed. Switching it back on
    // arms nothing by itself — the next `wake()` does, exactly as before, so a
    // host that never names `autoHide` sees no change in timing at all.
    if (!chrome.autoHide) this.wake();
    this.chromeFlags = chrome;
    this.applyLayout();
    // Stamps data-overlay="unbranded" when chrome matches the unbranded preset shape (`chrome-overlay.ts`).
    applyChromeOverlay(this.deps.roots.root, chrome);
  }

  /**
   * The standalone fullscreen button (`options.fullscreenButton`):
   * whether it is offered and where it sits, in CSS pixels from the root's
   * top-right corner. The offsets go in as custom properties `viewer.css`
   * reads, so a host stylesheet can still override them.
   */
  setFullscreenButton(flags: FullscreenButtonFlags): void {
    this.floatingFullscreenShown = flags.show;
    this.floatingFullscreen.style.setProperty('--jeex-fullscreen-button-right', `${flags.right}px`);
    this.floatingFullscreen.style.setProperty('--jeex-fullscreen-button-top', `${flags.top}px`);
    this.applyLayout();
  }

  /** `options.readonly`: the brand lockup leaves the bar; Reset camera stays. */
  setReadonly(readonly: boolean): void {
    this.readonly = readonly;
    this.applyLayout();
  }

  /**
   * Puts `chromeLayout`'s answer on the nodes. `hidden` rather than a class,
   * for the reasons `setChrome` gives. Nothing is laid out before the boot
   * pushes `options.chrome`: the shell's own markup is the state until then.
   */
  private applyLayout(): void {
    const chrome = this.chromeFlags;
    if (!chrome) return;
    const layout = chromeLayout({
      chrome,
      fullscreenButton: this.floatingFullscreenShown,
      readonly: this.readonly,
      fullscreen: this.fullscreen,
    });
    this.brandLockup.hidden = !layout.brand;
    this.controlBar.hidden = !layout.controls;
    this.revealControls.hidden = !layout.controls;
    this.hintCard.hidden = !layout.hint;
    this.modeSwitcher.hidden = !layout.modeSwitcher;
    this.floatingFullscreen.hidden = !layout.floatingFullscreen;
  }

  /**
   * The two plan modes show the drawing and nothing else: the interior selector
   * stops offering itself for as long as one is on. A preset dresses the 3D
   * scene, and its swatches say nothing over a flat drawing.
   */
  setPlanMode(mode: ViewerMode): boolean {
    const active = mode === 'plan2d' || mode === 'plan3d';
    if (this.planMode === active) return false;
    this.planMode = active;
    this.applyInteriorsVisibility();
    return true;
  }

  // ---- Control bar --------------------------------------------------------

  /** The five mode buttons of the control bar; nothing else carries `data-mode`. */
  private modeButtons(): HTMLButtonElement[] {
    return [...this.controlBar.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  }

  setModeButtons(mode: ViewerMode): void {
    this.modeButtons().forEach((button) => {
      const active = button.dataset['mode'] === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    this.announceMode(mode);
  }

  /**
   * The Tour button reads the mode name `Tour` (never translated)
   * or, while the clip plays, the localized Pause action.
   */
  setTourButtonLabel(playing: boolean): void {
    this.tourPlaying = playing;
    const button = this.controlBar.querySelector<HTMLButtonElement>('[data-mode="tour"]');
    if (button) button.textContent = playing ? this.messages.t('tour.button.pause') : MODE_LABELS.tour;
  }

  /** Mirrors furniture visibility onto the toggle button and the hint. */
  setFurnitureState(visible: boolean): void {
    this.furnitureShown = visible;
    this.furnitureButton.setAttribute('aria-pressed', String(!visible));
    this.furnitureButton.setAttribute('aria-label', this.messages.t(visible ? 'furniture.hide' : 'furniture.show'));
    this.furnitureButton.title = this.messages.t(visible ? 'furniture.stateShown' : 'furniture.stateHidden');
    this.furnitureButton.classList.toggle('is-off', !visible);
    this.setHint(this.messages.t(visible ? 'hint.furnitureShown' : 'hint.furnitureHidden'));
  }

  /**
   * Shows or hides the interior-preset button. It is the mount option AND
   * whether the scene ships presets at all: a plan with no `interiors` never
   * offers a selector, whatever the host asks for.
   */
  setInteriorsAvailable(available: boolean): void {
    this.interiorsAvailable = available;
    this.applyInteriorsVisibility();
  }

  private applyInteriorsVisibility(): void {
    this.interiorsButton.classList.toggle('is-hidden', !this.interiorsAvailable || this.planMode);
  }

  /**
   * Re-reads the fullscreen state: the toolbar button's label, the floating
   * button's visibility and the fullscreen override of the bar.
   * Entering fullscreen opens the bar expanded; from there the usual
   * `chrome.autoHide` rules apply. Leaving it gives the chrome back exactly
   * what the options say.
   *
   * Focus: a keyboard press
   * on the floating button hands focus to the toolbar's fullscreen button on
   * entering, and leaving with focus anywhere in the viewer hands it back to
   * the floating button, so it never drops to `body` with the node it was on.
   */
  updateFullscreenButton(): void {
    const isFullscreen = this.deps.viewport.isFullscreen();
    this.fullscreenButton.setAttribute('aria-label', this.messages.t(isFullscreen ? 'fullscreen.exit' : 'fullscreen.enter'));
    this.fullscreenButton.title = this.messages.t(isFullscreen ? 'fullscreen.exit' : 'fullscreen.label');
    this.floatingFullscreen.setAttribute('aria-label', this.messages.t('fullscreen.enter'));
    this.floatingFullscreen.title = this.messages.t('fullscreen.label');
    const entered = isFullscreen && !this.fullscreen;
    const left = !isFullscreen && this.fullscreen;
    // Read BEFORE the layout changes: leaving may hide the very button that
    // holds focus (the toolbar's, with `chrome.controls` off).
    const focusWasInside = left && this.focusIsInside();
    this.fullscreen = isFullscreen;
    this.applyLayout();
    if (entered) {
      this.wake();
      if (this.focusToolbarOnEnter) this.fullscreenButton.focus();
    }
    if (entered || left) this.focusToolbarOnEnter = false;
    if (focusWasInside && !this.floatingFullscreen.hidden) this.floatingFullscreen.focus();
  }

  /** Whether focus is inside this viewer's root (the shadow root's notion of it, see `focusout`). */
  private focusIsInside(): boolean {
    const root = this.deps.roots.root;
    const focused = (root.getRootNode() as unknown as DocumentOrShadowRoot).activeElement;
    return focused !== null && root.contains(focused);
  }

  // ---- Auto-hide ----------------------------------------------------------

  /** Keeps the bar awake while a panel attached to it is open; letting go arms the idle timer again. */
  setPinned(pinned: boolean): void {
    this.pinned = pinned;
    this.wake(pinned);
  }

  /**
   * Shows the control bar; without `force` it collapses again after a pause.
   *
   * With `chrome.autoHide` off there is no pause to refresh and nothing to
   * un-collapse, so a bar that is already open returns at once: `wake()` is on
   * `pointermove`, and a host that pinned the bar open must not pay for a DOM
   * write and an `onCollapseChanged` call per pointer sample.
   */
  wake(force = false): void {
    if (this.hideTimer) window.clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    if (!this.autoHide && !this.collapsed) return;
    this.collapsed = false;
    this.controlBar.classList.remove('is-collapsed');
    // Machine-readable mirror of the class: a browser check
    // reads this, never the CSS class.
    this.controlBar.dataset['collapsed'] = 'false';
    this.controlBar.inert = false;
    this.revealControls.classList.remove('is-visible');
    this.revealControls.setAttribute('aria-hidden', 'true');
    this.revealControls.tabIndex = -1;
    this.deps.onCollapseChanged();
    if (force || !this.autoHide || this.pinned) return;
    this.hideTimer = window.setTimeout(() => {
      // Keep the bar while the pointer rests on it; check again shortly.
      if (this.controlBar.matches(':hover')) {
        this.wake();
        return;
      }
      this.collapsed = true;
      this.controlBar.classList.add('is-collapsed');
      this.controlBar.dataset['collapsed'] = 'true';
      this.controlBar.inert = true;
      this.revealControls.classList.add('is-visible');
      this.revealControls.removeAttribute('aria-hidden');
      this.revealControls.tabIndex = 0;
      // The progress bar keeps its own counsel: a paused run and a hovered bar
      // stay on screen after the rest of the chrome has gone.
      this.deps.onCollapseChanged();
    }, HIDE_CONTROLS_MS);
  }
}
