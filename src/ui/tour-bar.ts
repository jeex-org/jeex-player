/**
 * The tour's own chrome: the status pill and the progress bar with its
 * play/pause button, scrub track and speed button (it
 * shows the setting, «1x», and a click moves it on, 1x → 2x → 0.5x → 1x).
 *
 * Invariant: the bar is a MIRROR plus a scrubber. It never decides whether the
 * tour plays — that is `options.tour` and the `ViewerCommands` it calls —
 * and it never reads the clip; every state it shows was
 * pushed in through `setState` / `setProgress`.
 *
 * Both are tour chrome and exist only in the tour: in any other mode they are
 * off screen whatever the clip is doing, and leaving the tour (which pauses the
 * clip) takes them away with it.
 *
 * Machine-readable state (`scripts/browser-check`): `data-visible` on the bar
 * is the mount option AND whether the mode is `tour`, `data-state` mirrors the
 * clip, `data-scrubbing` marks a drag in progress, and the track's
 * `aria-valuenow` carries the fraction. The element stays in the DOM even with
 * the bar switched off, so the state is always readable.
 */

import { TOUR_SPEEDS, type TourProgress, type TourSpeed, type TourState } from '../camera/tour-player.js';
import { TOUR_STATE_LABEL, type Messages } from './messages.js';
import { listenerOptions } from '../shared/abort.js';
import type { ViewerRoots } from './viewer-shell.js';
import type { ViewerMode } from '../scene/types.js';

/** Keyboard scrub step on the track, as a fraction of the route. */
const TRACK_STEP = 0.02;
const TRACK_STEP_COARSE = 0.1;

export type TourBarDeps = {
  roots: ViewerRoots;
  messages: Messages;
  /** Scrub the tour to a fraction `0..1` of the authored route. */
  seek: (fraction: number) => void;
  /** Resume playback; the bar uses it to restore a run it paused for a drag. */
  play: () => void;
  pause: () => void;
  /** The bar's own play/pause button and its `Space` shortcut. */
  toggle: () => void;
  /** The speed button: the next setting. */
  setSpeed: (speed: TourSpeed) => void;
  /** Any interaction with the bar wakes the rest of the chrome. */
  onInteraction: () => void;
  /** The mode on screen; the tour chrome shows only in `tour`. */
  mode: () => ViewerMode;
  /** True while the rest of the chrome has auto-hidden. */
  collapsed: () => boolean;
  /**
   * The clip changed state: the control bar relabels its Tour button, which is
   * the one piece of tour copy that does not live here.
   */
  onState: (state: TourState) => void;
  /** The mounted viewer's lifetime; every listener bound below carries it. */
  signal?: AbortSignal | undefined;
};

export class TourBar {
  private deps: TourBarDeps;
  private readonly status: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly statusProgress: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly track: HTMLElement;
  private readonly speedButton: HTMLButtonElement;

  private state: TourState = 'ready';
  private fraction = 0;
  private speed: TourSpeed = 1;
  private enabled = true;
  /** Whether the status pill is offered at all (`options.chrome.status`). */
  private statusEnabled = true;
  private scrubbing = false;
  private resumeAfterScrub = false;
  /** Whether `bind()` has already run; a second call is a no-op. */
  private bound = false;

  constructor(deps: TourBarDeps) {
    const { byName } = deps.roots;
    this.deps = deps;
    this.status = byName('tour-status');
    this.statusLabel = byName('tour-status-label');
    this.statusProgress = byName('tour-status-progress');
    this.bar = byName('tour-bar');
    this.playButton = byName<HTMLButtonElement>('tour-play');
    this.track = byName('tour-track');
    this.speedButton = byName<HTMLButtonElement>('tour-speed');
  }

  /** Adopts a new catalogue and re-renders every string the bar owns. */
  retranslate(messages: Messages): void {
    this.deps = { ...this.deps, messages };
    this.setState(this.state);
  }

  /**
   * Binds the bar's controls. Idempotent, because the Retry path re-runs the
   * whole boot in the same instance; every listener carries the mount's signal
   * and none of them is ever removed by hand (`viewer-context.ts`).
   */
  bind(): void {
    if (this.bound) return;
    this.bound = true;
    const listener = listenerOptions(this.deps.signal);
    this.playButton.addEventListener('click', () => this.togglePlayback(), listener);
    this.speedButton.addEventListener('click', () => this.nextSpeed(), listener);
    this.track.addEventListener('pointerdown', this.onTrackPointerDown, listener);
    this.track.addEventListener('pointermove', this.onTrackPointerMove, listener);
    this.track.addEventListener('pointerup', this.onTrackPointerUp, listener);
    this.track.addEventListener('pointercancel', this.onTrackPointerUp, listener);
    this.track.addEventListener('keydown', this.onTrackKeyDown, listener);
    // `:hover` is not an event, and the auto-hide has to re-decide when the
    // pointer arrives on the bar or leaves it.
    this.bar.addEventListener('pointerenter', () => this.refresh(), listener);
    this.bar.addEventListener('pointerleave', () => this.refresh(), listener);
  }

  /**
   * The clip's state. `data-state` on the status pill is the machine-readable
   * half — `scripts/browser-check` asserts on it, never on the copy.
   */
  setState(state: TourState): void {
    this.state = state;
    this.status.dataset['state'] = state;
    this.statusLabel.textContent = this.deps.messages.t(TOUR_STATE_LABEL[state]);
    this.deps.onState(state);
    this.refresh();
  }

  /**
   * Whether the status pill is offered at all (`options.chrome.status`).
   * The element still carries `data-state`, so a browser check keeps
   * reading the clip's state even while the pill itself is hidden.
   */
  setStatusEnabled(enabled: boolean): void {
    this.statusEnabled = enabled;
    this.updateStatusVisibility();
  }

  private updateStatusVisibility(): void {
    this.status.classList.toggle('is-hidden', this.state === 'ready' || !this.statusEnabled || this.deps.mode() !== 'tour');
  }

  /** The clip's position; the times are shown on the wall clock of the speed setting. */
  setProgress(progress: TourProgress): void {
    this.statusProgress.textContent = `${formatTime(progress.elapsed / progress.speed)} / ${formatTime(progress.duration / progress.speed)}`;
    this.fraction = progress.fraction;
    this.speed = progress.speed;
    this.refresh();
  }

  /**
   * Whether the page shows the progress bar at all (`options.tour.progressBar`).
   * The element stays in the DOM either way, so `data-visible` is always a
   * truthful, machine-readable answer.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.refresh();
  }

  /**
   * Re-reads everything the bar mirrors. Called by the owning chrome whenever the
   * state it depends on changed (the mode, the auto-hide).
   */
  refresh(): void {
    const fraction = Math.min(1, Math.max(0, this.fraction));
    this.updateStatusVisibility();
    this.bar.dataset['visible'] = String(this.enabled && this.deps.mode() === 'tour' && this.state !== 'ready');
    this.bar.dataset['state'] = this.state;
    this.bar.style.setProperty('--tour-progress', String(fraction));
    this.track.setAttribute('aria-valuenow', fraction.toFixed(4));
    this.playButton.setAttribute('aria-label', this.deps.messages.t(this.state === 'playing' ? 'tour.bar.pause' : 'tour.bar.play'));
    const label = `${this.speed}x`;
    this.speedButton.textContent = label;
    this.speedButton.dataset['speed'] = String(this.speed);
    this.speedButton.setAttribute('aria-label', this.deps.messages.t('tour.bar.speed', { speed: label }));
    this.bar.classList.toggle('is-collapsed', this.deps.collapsed() && !this.staysAwake());
  }

  /**
   * The bar's exception to the idle auto-hide: a paused run is an invitation to
   * resume it, and a pointer resting on the bar means the viewer is being
   * scrubbed right now.
   */
  private staysAwake(): boolean {
    return this.scrubbing || this.state === 'paused' || this.bar.matches(':hover');
  }

  /** Track-relative fraction of a pointer position, clamped to the ends. */
  private fractionAt(clientX: number): number {
    const rect = this.track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  private readonly onTrackPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.scrubbing = true;
    // A drag over a playing run would fight the frame pump for the pose, so the
    // bar pauses for the drag and restores what it interrupted on release.
    this.resumeAfterScrub = this.state === 'playing';
    this.bar.dataset['scrubbing'] = 'true';
    if (this.resumeAfterScrub) this.deps.pause();
    capturePointer(this.track, event.pointerId, true);
    this.deps.seek(this.fractionAt(event.clientX));
    this.deps.onInteraction();
  };

  private readonly onTrackPointerMove = (event: PointerEvent): void => {
    if (!this.scrubbing) return;
    this.deps.seek(this.fractionAt(event.clientX));
  };

  private readonly onTrackPointerUp = (event: PointerEvent): void => {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    delete this.bar.dataset['scrubbing'];
    capturePointer(this.track, event.pointerId, false);
    if (this.resumeAfterScrub) this.deps.play();
    this.resumeAfterScrub = false;
    this.deps.onInteraction();
  };

  /** Slider keys on the track: arrows step, `Home`/`End` jump, `Space` toggles. */
  private readonly onTrackKeyDown = (event: KeyboardEvent): void => {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.togglePlayback();
      return;
    }
    const step = event.shiftKey ? TRACK_STEP_COARSE : TRACK_STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = this.fraction - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = this.fraction + step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    if (next === null) return;
    event.preventDefault();
    this.deps.seek(Math.min(1, Math.max(0, next)));
    this.deps.onInteraction();
  };

  /** 1x → 2x → 0.5x → 1x (`TOUR_SPEEDS` is that order). */
  private nextSpeed(): void {
    const next = TOUR_SPEEDS[(TOUR_SPEEDS.indexOf(this.speed) + 1) % TOUR_SPEEDS.length]!;
    this.deps.setSpeed(next);
    this.deps.onInteraction();
  }

  private togglePlayback(): void {
    this.deps.toggle();
    this.deps.onInteraction();
  }
}

/**
 * Pointer capture that tolerates a target without it: a headless run and the
 * unit tests hand the bar elements whose capture API throws or is absent, and
 * losing capture only costs the drag its off-track moves.
 */
function capturePointer(element: HTMLElement, pointerId: number, capture: boolean): void {
  try {
    if (capture) element.setPointerCapture(pointerId);
    else element.releasePointerCapture(pointerId);
  } catch {
    // No capture: the pointermove listener on the track still drives the scrub.
  }
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${remainder}`;
}
