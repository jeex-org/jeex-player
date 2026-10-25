/**
 * The viewer's user interface, as ONE object for the application to hold.
 *
 * It is a facade and nothing else: the chrome (`viewer-chrome.ts`), the tour
 * bar (`tour-bar.ts`) and the selection panel (`selection-panel.ts`) each own
 * their own nodes, their own state and their own listeners, and this file is
 * where the three of them are wired to each other and given one API.
 *
 * The wiring is the part that could not live in any one of them: a mode button
 * re-hints AND re-labels the tour button, the auto-hide changes what the tour
 * bar shows, a plan mode closes the panel and hides the bar, and Escape belongs
 * to whichever of them is open. Every one of those crosses two modules;
 * everything that does not has already left this file.
 *
 * Invariant: no module below reads the host's document. Every element comes
 * from `ViewerRoots.byName`, scoped to this instance's shell.
 */

import type { UsageSink } from '../shared/usage.js';
import { ProjectMark } from './project-mark.js';
import type { ViewerMode } from '../scene/types.js';
import { isPlanMode } from '../scene/types.js';
import type { TourProgress, TourSpeed, TourState } from '../camera/tour-player.js';
import type { DirectorChrome } from '../camera/camera-director.js';
import type { Messages } from './messages.js';
import type { ViewerRoots } from './viewer-shell.js';
import type { FullscreenController } from './fullscreen-controller.js';
import { SelectionPanel, type PanelRequest } from './selection-panel.js';
import { ReplacePopup, type ReplacePopupRequest } from './replace-popup.js';
import { TourBar } from './tour-bar.js';
import { ViewerChrome, type ChromeCommands, type ChromeFlags, type FullscreenButtonFlags } from './viewer-chrome.js';
import { SettingsPanel, type SettingsSide } from './settings-panel.js';

/** The slice of `ViewerOptions` the chrome is laid out from. */
export type ChromeOptions = {
  chrome: ChromeFlags;
  fullscreenButton: FullscreenButtonFlags;
  readonly: boolean;
  /** The settings button (`settings-panel.ts`); the value it shows comes from `setLightTemperature`. */
  settings: { show: boolean; side: SettingsSide };
};

export type { PanelItem, PanelRequest } from './selection-panel.js';
export { swatch } from './selection-panel.js';

/** Everything the UI asks the application to do; no scene type crosses here. */
export type ViewerCommands = ChromeCommands & {
  /** Scrub the tour to a fraction `0..1` of the authored route. */
  tourSeek: (fraction: number) => void;
  /** Resume playback; the bar uses it to restore a run it paused for a drag. */
  tourPlay: () => void;
  tourPause: () => void;
  /** The speed button's next setting. */
  tourSpeed: (speed: TourSpeed) => void;
};

type ViewerUIOptions = {
  shell: FullscreenController;
  /** This instance's catalogue; every label and hint comes from it. */
  messages: Messages;
  /** This instance's shell: the only way any element here is reached. */
  roots: ViewerRoots;
  commands: ViewerCommands;
  /** Fired when the panel closes for any reason, so the caller can drop its target. */
  onPanelClose?: () => void;
  /**
   * The Retry button of the error card. It re-runs THIS instance's boot, never
   * `location.reload()`, which would reload the host page — the one thing an
   * embedded component must never do to a page it does not own.
   */
  onRetry?: () => void;
  /** The mounted viewer's lifetime; every listener under the UI carries it. */
  signal?: AbortSignal | undefined;
  /** Hears a selection panel the visitor opened (`shared/usage.ts`). */
  usage?: UsageSink | undefined;
};

/**
 * `implements DirectorChrome`: the camera layer declares the role it needs
 * (`camera/camera-director.ts`) and this is the concrete provider — the
 * import runs downward (`ui` -> `camera`), never the other way.
 */
export class ViewerUI implements DirectorChrome {
  private readonly commands: ViewerCommands;
  private readonly usage: UsageSink | undefined;
  private readonly chrome: ViewerChrome;
  private readonly panel: SelectionPanel;
  /** The "Replace with another…" popup, opened from the furniture panel. */
  private readonly popup: ReplacePopup;
  private readonly tourBar: TourBar;
  /** The settings button and its panel; nothing of it exists until the host enables it. */
  private readonly settings: SettingsPanel;
  /** The producer's mark a project's manifest may require (`project-mark.ts`). */
  private readonly mark: ProjectMark;
  /** The mode the camera director last switched to; the tour chrome shows only in `tour`. */
  private mode: ViewerMode = 'orbit';

  constructor(options: ViewerUIOptions) {
    this.commands = options.commands;
    this.usage = options.usage;
    this.mark = new ProjectMark({ container: options.roots.viewport, messages: options.messages });
    this.chrome = new ViewerChrome({
      roots: options.roots,
      viewport: options.shell,
      messages: options.messages,
      commands: options.commands,
      onModePressed: (mode) => this.handleModeButton(mode),
      onCollapseChanged: () => this.tourBar.refresh(),
      onDismiss: (event) => this.dismiss(event),
      onRetry: options.onRetry,
      signal: options.signal,
    });
    this.panel = new SelectionPanel({
      roots: options.roots,
      viewport: options.shell,
      onInteraction: () => this.chrome.wake(),
      onClose: options.onPanelClose,
      signal: options.signal,
    });
    this.popup = new ReplacePopup({ roots: options.roots, signal: options.signal });
    this.settings = new SettingsPanel({
      roots: options.roots,
      messages: options.messages,
      onChange: (temperature) => options.commands.setLightTemperature(temperature),
      // One panel at a time, and the bar it hangs off stays awake while it is open.
      onOpen: () => {
        this.closePanel();
        this.chrome.setPinned(true);
      },
      onClose: () => this.chrome.setPinned(false),
      signal: options.signal,
    });
    this.tourBar = new TourBar({
      roots: options.roots,
      messages: options.messages,
      seek: (fraction) => options.commands.tourSeek(fraction),
      play: () => options.commands.tourPlay(),
      pause: () => options.commands.tourPause(),
      setSpeed: (speed) => options.commands.tourSpeed(speed),
      toggle: () => {
        options.commands.toggleTour();
        this.setModeButtons('tour');
        this.setHintForMode('tour');
      },
      onInteraction: () => this.chrome.wake(),
      mode: () => this.mode,
      collapsed: () => this.chrome.isCollapsed,
      onState: (state) => this.chrome.setTourButtonLabel(state === 'playing'),
      signal: options.signal,
    });
  }

  /**
   * Binds every control of the shell. Call once — right after construction,
   * not after the scene loads: every command it wires is read lazily, so an
   * error card shown before the scene ever loads still has a working Retry.
   */
  bind(): void {
    this.chrome.bind();
    this.panel.bind();
    this.popup.bind();
    this.tourBar.bind();
  }

  /** Releases the auto-hide timer; every listener dies with the shell. */
  dispose(): void {
    this.chrome.dispose();
    this.settings.dispose();
    this.mark.set(null);
  }

  /**
   * Shows the mark the document's project asks for, or none. Called with every
   * document that goes on screen (`SceneMount`), from the DATA alone: no
   * option reaches this, so no host setting removes it.
   */
  setProjectMark(mark: { readonly href: string } | null | undefined): void {
    this.mark.set(mark);
    // The mark sits in the row under the bar's start: a plate there moves past it.
    this.settings.reflow();
  }

  /** Adopts a new catalogue: every string the UI owns is re-rendered. */
  retranslate(messages: Messages): void {
    this.chrome.retranslate(messages);
    this.tourBar.retranslate(messages);
    this.settings.retranslate(messages);
  }

  // ---- Shell states -------------------------------------------------------

  setLoading(value: number, label: string): void {
    this.chrome.setLoading(value, label);
  }
  showLoading(): void {
    this.chrome.showLoading();
  }
  showViewer(): void {
    this.chrome.showViewer();
  }
  showDegradedNotice(): void {
    this.chrome.showDegradedNotice();
  }
  showError(title: string, message: string, retry: boolean, keepCanvas = false): void {
    this.chrome.showError(title, message, retry, keepCanvas);
  }

  // ---- Control bar --------------------------------------------------------

  setHint(message: string): void {
    this.chrome.setHint(message);
  }
  setHintForMode(mode: ViewerMode): void {
    this.chrome.setHintForMode(mode);
  }
  setSceneName(name: string): void {
    this.chrome.setSceneName(name);
  }
  setCanvasDescription(sceneName: string, roomNames: readonly string[]): void {
    this.chrome.setCanvasDescription(sceneName, roomNames);
  }
  setChrome(chrome: ChromeFlags): void {
    this.chrome.setChrome(chrome);
    this.tourBar.setStatusEnabled(chrome.status);
  }
  /**
   * Every chrome-shaping option in one push, as the boot hands them over:
   * `chrome`, the standalone fullscreen button and read-only mode.
   * Structural, so `ui` names no `app` type.
   */
  setChromeOptions(options: ChromeOptions): void {
    this.setChrome(options.chrome);
    this.chrome.setFullscreenButton(options.fullscreenButton);
    this.chrome.setReadonly(options.readonly);
    this.settings.setEnabled(options.settings.show, options.settings.side);
  }
  /** The light temperature changed (a host, or the panel itself): the panel shows it. */
  setLightTemperature(temperature: number | null): void {
    this.settings.setValue(temperature);
  }
  setModeButtons(mode: ViewerMode): void {
    this.chrome.setModeButtons(mode);
    // Walk lifts the minimap into the row under the bar's end in a narrow viewer: a plate there moves past it.
    this.settings.reflow();
  }
  setFurnitureState(visible: boolean): void {
    this.chrome.setFurnitureState(visible);
  }
  setInteriorsAvailable(available: boolean): void {
    this.chrome.setInteriorsAvailable(available);
  }
  updateFullscreenButton(): void {
    this.chrome.updateFullscreenButton();
  }
  wakeControls(force = false): void {
    this.chrome.wake(force);
  }

  /**
   * The director announces every mode switch here (`applyPlanMode`). The tour
   * chrome follows every one of them: it is on screen only in `tour`, so
   * leaving the tour takes the bar and the pill away even though the clip
   * stays paused behind them. A plan mode also shows the drawing and nothing
   * else: the selection panel closes and the interior selector stops offering
   * itself for as long as one is on.
   */
  setPlanMode(mode: ViewerMode): void {
    this.mode = mode;
    this.tourBar.refresh();
    if (!this.chrome.setPlanMode(mode)) return;
    if (isPlanMode(mode)) this.panel.close();
  }

  // ---- Tour chrome --------------------------------------------------------

  setTourState(state: TourState): void {
    this.tourBar.setState(state);
  }
  setTourProgress(progress: TourProgress): void {
    this.tourBar.setProgress(progress);
  }
  setTourBarEnabled(enabled: boolean): void {
    this.tourBar.setEnabled(enabled);
  }

  // ---- Panel --------------------------------------------------------------

  openPanel(request: PanelRequest): void {
    this.settings.close(false);
    this.popup.close();
    this.panel.open(request);
    this.usage?.('panel');
  }
  closePanel(): void {
    this.popup.close();
    this.panel.close();
  }
  /**
   * Opens the "Replace with another…" popup over the panel; focus returns to
   * the control that had it. A pick closes the panel too: it lists the
   * variants of the asset being replaced.
   */
  openReplacePopup(request: ReplacePopupRequest): void {
    this.popup.open({
      ...request,
      onPick: (id) => {
        this.panel.close();
        request.onPick(id);
      },
    });
  }
  closeReplacePopup(): void {
    this.popup.close();
  }
  isReplacePopupOpen(): boolean {
    return this.popup.isOpen();
  }
  isPanelOpen(): boolean {
    return this.panel.isOpen();
  }
  scopeChecked(): boolean {
    return this.panel.scopeChecked();
  }
  setPanelBusy(busy: boolean): void {
    this.panel.setBusy(busy);
  }

  // ---- Wiring that crosses two of the three -------------------------------

  /**
   * A mode button: close the panel, ask for the mode (or the tour), then mirror
   * it. `tour` goes through `toggleTour` rather than `setMode`, because the
   * button is a play/pause control once the clip is engaged.
   */
  private handleModeButton(mode: ViewerMode): void {
    this.closePanel();
    if (mode === 'tour') this.commands.toggleTour();
    else this.commands.setMode(mode);
    this.setModeButtons(mode);
    this.setHintForMode(mode);
    this.wakeControls();
  }

  /**
   * Escape, and a press outside the panel, close whatever is open. Both arrive
   * on the shell root, so they belong to the viewer that has focus and to no
   * other one on the page.
   */
  private dismiss(event: Event): void {
    // The settings panel listens for presses outside it on the whole page itself (`settings-panel.ts`).
    if (event.type === 'keydown' && this.settings.dismissKey(event as KeyboardEvent)) return;
    // The popup is on top of the panel: Escape closes the popup alone, and a
    // press anywhere while it is open is the popup's own (its backdrop closes it).
    if (this.popup.isOpen()) {
      if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') this.popup.close();
      return;
    }
    if (!this.panel.isOpen()) return;
    if (event.type === 'keydown') {
      if ((event as KeyboardEvent).key === 'Escape') this.closePanel();
      return;
    }
    if (!this.panel.contains(event.target as Node)) this.closePanel();
  }
}
