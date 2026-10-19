/**
 * Raw pointer, wheel and key events, normalised into the small vocabulary of
 * gestures the camera modes actually respond to.
 *
 * The one rule this module exists to keep is ONE GESTURE, ONE EFFECT. A
 * trackpad reports a sideways
 * swipe with a `deltaY` of its own, a pinch arrives as a `ctrlKey` wheel
 * carrying whatever `deltaX` the fingers rolled with, Firefox sends a mouse
 * wheel in LINES and rewrites shift+wheel onto `deltaX`. Every one of those is
 * decided HERE, once, so a rig never sees a browser quirk and never has to
 * choose between panning and zooming on the same event.
 *
 * The second rule is that a scroll delta is the NEGATIVE of the finger travel.
 * The sign is flipped once, on the way out of `onWheel`, so every gesture that
 * leaves this module speaks POINTER pixels: `+dx` is the finger going right,
 * `+dy` the finger going down the screen. Nothing downstream may flip it again.
 *
 * The sink answers whether it consumed a gesture, and that is what decides
 * `preventDefault`: the wheel only stops the page scrolling when a mode
 * actually zoomed or stepped, and the arrow keys only stop it when someone is
 * walking or panning.
 *
 * The third rule is that the wheel and Space belong to the PAGE until the
 * viewer is engaged: a plain wheel over an unfocused viewer that sits in a
 * scrolling page scrolls the page and is reported as `scroll-through` (the
 * «Ctrl + scroll» overlay); Ctrl/⌘+wheel always acts. Space is a MOVE
 * modifier only while the shell root itself has focus — never on a focused
 * button inside it, which Space must still press.
 */

import { CAMERA_TUNING } from './camera-tuning.js';
import { linkedAbortController } from '../shared/abort.js';
import { viewerOwnsWheel } from './wheel-ownership.js';

const { pointer: POINTER, wheel: WHEEL } = CAMERA_TUNING;

/** Which mouse button (or its shift stand-in) started the drag. */
type DragButton = 'primary' | 'secondary';

export type CameraGesture =
  /**
   * A pointer went down on the canvas: whatever the camera was doing, stop.
   * `button` and `shift` are what a mode latches its gesture from — a move
   * event reports no button, and a shift released mid-drag must not turn a pan
   * into a rotation. `move` is the one question both modes ask of them: the
   * secondary button, Shift, or Space held on the focused shell root — the
   * drag moves (pans in 360, walks in walk) instead of turning.
   */
  | { type: 'press'; button: DragButton; shift: boolean; move: boolean }
  /** The last-moved pointer came up (or was cancelled). */
  | { type: 'release' }
  /**
   * A pointer moved with the button down. `dx`/`dy` are THIS pointer's own
   * travel in pointer pixels; `centroid` is the movement of the midpoint of a
   * two-finger gesture, and is `null` for the first move of one and for every
   * single-pointer drag.
   */
  | { type: 'drag'; dx: number; dy: number; pointers: number; centroid: { dx: number; dy: number } | null }
  /**
   * Two fingers changed their separation: a distance scales by `scale`,
   * closing in on (or backing away from) the scene point under their
   * midpoint `x`/`y`, client pixels.
   */
  | { type: 'pinch'; scale: number; x: number; y: number }
  /** A wheel/trackpad swipe that means "move the picture", in pointer pixels. */
  | { type: 'pan'; dx: number; dy: number }
  /**
   * A wheel/trackpad gesture that means "closer"/"further"; `dy < 0` is in.
   * `x`/`y` is the pointer it happened under (client pixels): the zoom closes
   * in on that scene point, not on the screen centre.
   */
  | { type: 'zoom'; dy: number; x: number; y: number }
  /** A click that did not move: `at` is `performance.now()` of the click. */
  | { type: 'tap'; x: number; y: number; at: number }
  | { type: 'double-tap'; x: number; y: number }
  /** The pointer moved over the canvas with nothing pressed. */
  | { type: 'hover'; x: number; y: number }
  /** The pointer left the canvas; nothing is hovered until it comes back. */
  | { type: 'leave' }
  /** A key went down or came up; `code` is `KeyboardEvent.key`, lower case. */
  | { type: 'key'; code: string; down: boolean }
  /** The key target lost focus: every held key is up as far as anyone knows. */
  | { type: 'blur' }
  /**
   * A plain wheel the viewer left to the page: it is not engaged (no focus, no
   * fullscreen) and the page around it can scroll. Nothing moves; a mode that
   * would have acted on the wheel says how to make it act (Ctrl/⌘ + scroll).
   */
  | { type: 'scroll-through' };

/**
 * Where the listeners go. The canvas takes the pointer and wheel events; keys
 * are separate because they belong to whatever element owns the FOCUS — the
 * viewer's own shell root, which carries `tabindex="0"` and is focused by a
 * `pointerdown` on the canvas. That is what makes `w` drive the viewer the
 * user is looking at and no other, and what stops a keystroke in a host page's
 * `<input>` walking the camera.
 */
type CameraInputTarget = {
  canvas: HTMLElement;
  /**
   * The element keystrokes for `canvas` belong to: the focusable shell root it
   * sits in. Resolved by the CALLER — `app/viewer-stage.ts`, the one module
   * that owns `ViewerRoots`, hands in `roots.root` — so this module never
   * needs to know the shell's markup or its CSS selector. A harness with no
   * shell root at all passes the canvas itself as its own key target, which is
   * the same behaviour a real page gets when the canvas sits outside one; this
   * never falls back to `window`, which is the thing that made two viewers
   * walk on one keypress.
   */
  keys: HTMLElement;
  /**
   * The mounted viewer's lifetime. Every listener below carries it, so a
   * disposed viewer stops hearing the canvas even if nothing calls `dispose()`
   * — and `dispose()` itself is one `abort()` rather than thirteen removals.
   */
  signal?: AbortSignal | undefined;
  /**
   * `options.interaction`, minus `'none'` — a `CameraInput` is not
   * even constructed for that value (`camera-controller.ts`). `'passive'`
   * (default `'full'`) makes the wheel listener `{ passive: true }` and never
   * calls `preventDefault` on it, so a host with a scrolling page under the
   * canvas keeps scrolling.
   */
  interaction?: 'full' | 'passive' | undefined;
  /**
   * Whether a plain wheel belongs to the viewer right now. Defaults to
   * `viewerOwnsWheel` (focus, fullscreen, or a page that cannot scroll); a
   * harness passes its own answer.
   */
  ownsWheel?: (() => boolean) | undefined;
};

/** The keys that move the camera in both modes; anything else is the page's. */
export const MOVE_KEYS: ReadonlySet<string> = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/**
 * The direction the held movement keys ask for, in the camera's own terms:
 * `forward` along the view on the floor, `right` towards screen-right. Each is
 * -1, 0 or 1; W and S (or both arrows) held together cancel out.
 */
export function keyDirection(keys: ReadonlySet<string>): { forward: number; right: number } {
  const on = (a: string, b: string): number => (keys.has(a) || keys.has(b) ? 1 : 0);
  return { forward: on('w', 'arrowup') - on('s', 'arrowdown'), right: on('d', 'arrowright') - on('a', 'arrowleft') };
}

/**
 * Receives one gesture. `true` means it was consumed, and the input then calls
 * `preventDefault()` on the event behind it — the only way the page scroll can
 * be stopped for a zoom and left alone for the same wheel in a mode that does
 * not zoom.
 */
export type CameraGestureSink = (gesture: CameraGesture) => boolean | void;

/**
 * A wheel gesture in CSS pixels, whatever unit the browser reported it in.
 *
 * Chrome and Safari send pixels; Firefox sends LINES for a mouse wheel and
 * PAGES when the user scrolls by page. Read raw, three lines of wheel would
 * zoom by three pixels' worth — a gesture the viewer barely notices — so the
 * unit is normalised once, here, and every threshold downstream is in pixels.
 */
export function wheelPixels(event: WheelEvent, viewportHeight: number): { x: number; y: number } {
  const unit = event.deltaMode === 1 ? WHEEL.linePx : event.deltaMode === 2 ? viewportHeight || WHEEL.pageFallbackPx : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
}

/**
 * A shift+wheel gesture with the axis the USER moved, not the one the browser
 * reported.
 *
 * Firefox rewrites a shift+wheel onto `deltaX` — the same physical gesture
 * that arrives as `deltaY` on Chromium and Safari — so the documented vertical
 * shift-pan panned sideways there and nowhere else. A shift gesture carrying
 * ONLY `deltaX` is therefore read as vertical intent; anything that kept its
 * `deltaY` (every other browser, and a genuine diagonal) passes through
 * untouched.
 */
export function shiftWheel(delta: { x: number; y: number }, shiftKey: boolean): { x: number; y: number } {
  if (!shiftKey || delta.y !== 0 || delta.x === 0) return delta;
  return { x: 0, y: delta.x };
}

/**
 * Nodes a key belongs to rather than to the camera: a host's own field, and
 * anything inside a host slot (`ui/host-slots.ts`'s `SLOT_ATTRIBUTE`).
 *
 * `[contenteditable]` carries `:not([contenteditable="false"])` because the
 * bare presence selector matches the OFF value too — and a host that wraps the
 * viewer in `contenteditable="false"`, which is the standard way to put a
 * non-editable widget inside editable page content, would then have the
 * wrapper on the composed path of every key aimed at the camera and silence
 * all of them. `"true"`, `""` and `plaintext-only` stay covered.
 *
 * The literal is repeated here because `camera` sits BELOW `ui` in the layer
 * order and may not import it; `ui/host-slots.test.ts` proves the two agree.
 */
export const TYPING_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-jeex-slot]';

/**
 * Whether a key event was typed into host chrome rather than aimed at the
 * camera.
 *
 * Duck-typed on `matches` rather than `instanceof Element`: this module is
 * loaded under Bun by its own tests, where that global does not exist, and a
 * `composedPath()` ends with the document and the window, neither of which is
 * an element at all.
 */
export function isTypingTarget(path: readonly EventTarget[]): boolean {
  return path.some((node) => {
    const element = node as Partial<Element>;
    return typeof element.matches === 'function' && element.matches(TYPING_SELECTOR);
  });
}

/**
 * The event's composed path, or nothing.
 *
 * A synthetic event in a unit test carries no `composedPath`, and calling it
 * blind would turn every existing key case red — which is exactly what the
 * cases above `keys typed into host chrome` are there to prove.
 */
function pathOf(event: KeyboardEvent): readonly EventTarget[] {
  return typeof event.composedPath === 'function' ? event.composedPath() : [];
}

export class CameraInput {
  private readonly target: CameraInputTarget;
  private readonly emit: CameraGestureSink;
  /** Every listener this input binds; linked to the mount's signal. */
  private readonly listeners: AbortController;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  /**
   * The two-pointer gesture's own centroid, so it pans by the FINGERS'
   * combined movement once per event instead of once per finger (which would
   * double the gain: each pointer's own `pointermove` reports that pointer's
   * full travel). `null` outside an active two-pointer gesture; reset on
   * pointer down and up so a finger joining or leaving never reads as a jump.
   */
  private lastCentroid: { x: number; y: number } | null = null;
  private button: DragButton = 'primary';
  private shift = false;
  /** Space held down on the focused shell root: the next press moves. */
  private space = false;
  /** Shift held down on the focused shell root, for the cursor only. */
  private shiftHeld = false;
  /** Whether the pointer travelled far enough for the press to be a drag. */
  private moved = false;

  constructor(target: CameraInputTarget, onGesture: CameraGestureSink) {
    this.target = target;
    this.emit = onGesture;
    const { canvas, keys } = target;
    this.listeners = linkedAbortController(target.signal);
    const listener: AddEventListenerOptions = { signal: this.listeners.signal };
    canvas.addEventListener('pointerdown', this.onPointerDown as EventListener, listener);
    canvas.addEventListener('pointermove', this.onPointerMove as EventListener, listener);
    canvas.addEventListener('pointerup', this.onPointerUp as EventListener, listener);
    canvas.addEventListener('pointercancel', this.onPointerUp as EventListener, listener);
    canvas.addEventListener('pointerleave', this.onPointerLeave, listener);
    canvas.addEventListener('click', this.onClick as EventListener, listener);
    canvas.addEventListener('wheel', this.onWheel as EventListener, {
      passive: target.interaction === 'passive',
      signal: this.listeners.signal,
    });
    canvas.addEventListener('dblclick', this.onDoubleClick as EventListener, listener);
    canvas.addEventListener('contextmenu', this.onContextMenu as EventListener, listener);
    keys.addEventListener('keydown', this.onKeyDown as EventListener, listener);
    keys.addEventListener('keyup', this.onKeyUp as EventListener, listener);
    keys.addEventListener('blur', this.onBlur, listener);
    // A tab switched away while Space was held never sends its keyup here.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onBlur, listener);
    this.syncCursor();
  }

  /**
   * Forgets every in-flight gesture without detaching. A mode that takes the
   * camera away mid-drag (a plan mode) must not resume that drag when it hands
   * the camera back.
   */
  reset(): void {
    this.pointers.clear();
    this.lastCentroid = null;
    this.moved = false;
    this.syncCursor();
  }

  /**
   * Tells the stylesheet what the pointer would do: `data-jeex-move` while
   * Space or Shift is held (a drag would move), `data-jeex-drag` while a
   * pointer is down (`ui/styles/viewer.css` turns them into `move`/`grabbing`).
   */
  private syncCursor(): void {
    const { dataset } = this.target.canvas;
    dataset['jeexMove'] = String(this.space || this.shiftHeld);
    dataset['jeexDrag'] = String(this.pointers.size > 0);
  }

  /** Detaches every listener at once; the mount's signal does the same thing. */
  dispose(): void {
    this.listeners.abort();
  }

  private onPointerDown = (event: PointerEvent): void => {
    // A press on the scene is what gives this viewer the keyboard: the key
    // listeners live on the shell root, so `w` after a click here walks THIS
    // camera and no other one on the page. `preventScroll` keeps a tall host
    // page from jumping to the viewer when it takes focus.
    this.target.keys.focus?.({ preventScroll: true });
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      this.target.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    this.moved = false;
    this.lastCentroid = null;
    this.button = event.button === 2 ? 'secondary' : 'primary';
    this.shift = event.shiftKey;
    const move = this.button === 'secondary' || this.shift || this.space;
    this.syncCursor();
    this.emit({ type: 'press', button: this.button, shift: this.shift, move });
  };

  private onPointerMove = (event: PointerEvent): void => {
    const current = this.pointers.get(event.pointerId);
    if (!current) {
      // Hovering is a MOVE WITH NOTHING PRESSED: any pointer still down means
      // a gesture is in progress and the affordances are not the question.
      if (this.pointers.size === 0) this.emit({ type: 'hover', x: event.clientX, y: event.clientY });
      return;
    }
    const previous = { x: current.x, y: current.y };
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    current.x = event.clientX;
    current.y = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) > POINTER.dragThresholdPx) this.moved = true;

    let centroid: { dx: number; dy: number } | null = null;
    if (this.pointers.size >= 2) {
      const other = [...this.pointers.entries()].find(([pointerId]) => pointerId !== event.pointerId)?.[1];
      if (!other) return;
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(current.x - other.x, current.y - other.y);
      const middle = { x: (current.x + other.x) / 2, y: (current.y + other.y) / 2 };
      if (before > 0 && after > 0) this.emit({ type: 'pinch', scale: before / after, x: middle.x, y: middle.y });
      if (this.lastCentroid) centroid = { dx: middle.x - this.lastCentroid.x, dy: middle.y - this.lastCentroid.y };
      this.lastCentroid = middle;
    }
    this.emit({ type: 'drag', dx, dy, pointers: this.pointers.size, centroid });
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.lastCentroid = null;
    this.syncCursor();
    this.emit({ type: 'release' });
  };

  private onPointerLeave = (): void => {
    this.emit({ type: 'leave' });
  };

  /**
   * A drag must not be read as a click, but `moved` is only cleared on
   * `pointerdown`; a synthetic `click` (tests, assistive tech) that follows a
   * drag would otherwise be swallowed forever. Clearing the flag here ends the
   * drag-vs-click window with the click event it guards.
   */
  private onClick = (event: MouseEvent): void => {
    if (!this.moved) this.emit({ type: 'tap', x: event.clientX, y: event.clientY, at: performance.now() });
    this.moved = false;
  };

  private onDoubleClick = (event: MouseEvent): void => {
    this.emit({ type: 'double-tap', x: event.clientX, y: event.clientY });
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private onWheel = (event: WheelEvent): void => {
    // Ctrl/⌘+wheel is the one wheel that acts before the viewer is engaged
    // (a trackpad pinch arrives as a `ctrlKey` wheel too). A plain wheel over
    // a viewer the user has not engaged, in a page that can scroll, is the
    // page's: nothing is prevented and nothing moves (cooperative gestures,
    // as embedded maps do). `'passive'` keeps its own, older contract.
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier && this.target.interaction !== 'passive' && !(this.target.ownsWheel ?? this.ownsWheel)()) {
      this.emit({ type: 'scroll-through' });
      return;
    }
    const delta = shiftWheel(wheelPixels(event, this.target.canvas.clientHeight), event.shiftKey);
    // Classify FIRST, then act once. `ctrlKey` is how a browser reports a
    // pinch, and it carries whatever sideways roll the fingers had; a plain
    // trackpad diagonal has a deltaY of its own. Zooming by `deltaY` *and*
    // panning by `deltaX` on the same event is what made every diagonal swipe
    // drift in and out.
    const pans = !modifier && (event.shiftKey || Math.abs(delta.x) > Math.abs(delta.y));
    // A scroll delta is the negative of the finger travel; every gesture that
    // leaves here speaks pointer pixels.
    const consumed = pans
      ? this.emit({ type: 'pan', dx: -delta.x, dy: -delta.y })
      : this.emit({ type: 'zoom', dy: delta.y, x: event.clientX, y: event.clientY });
    // A passive listener cannot call `preventDefault` at all (the browser
    // ignores it and, in a dev build, warns) — `interaction: 'passive'` is
    // exactly the host asking for that: the canvas still zooms and pans, but
    // the page under it keeps scrolling on the same wheel event.
    if (consumed === true && this.target.interaction !== 'passive') event.preventDefault();
  };

  private readonly ownsWheel = (): boolean => viewerOwnsWheel(this.target.keys);

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(pathOf(event))) return;
    if (event.key === 'Shift') this.setHeld('shift', true);
    // Space is the move modifier only on the shell root ITSELF: on a focused
    // button inside it Space presses that button, and under `'passive'` the
    // host asked for the page to keep every key it would scroll with. It is
    // cancelled on keydown — on keyup the page has already scrolled — and on
    // every auto-repeat, which scrolls too.
    if (event.key === ' ' && event.target === this.target.keys && this.target.interaction !== 'passive') {
      this.setHeld('space', true);
      event.preventDefault();
      return;
    }
    if (this.emit({ type: 'key', code: event.key.toLowerCase(), down: true }) === true) event.preventDefault();
  };

  /** Latches or clears one held modifier and repaints the cursor. */
  private setHeld(which: 'space' | 'shift', held: boolean): void {
    if (which === 'space') this.space = held;
    else this.shiftHeld = held;
    this.syncCursor();
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    // Guarded too, but NOT because it is what stops a stuck key: focus moving
    // into a field blurs the shell root, and the `blur` gesture already clears
    // every latched key (`camera-controller.ts`). What this line suppresses is
    // the stray `key up` for a key nothing is holding any more, and the keys of
    // a synthetic or replayed event that carries a path and fires no `blur`.
    // The two modifiers are cleared unguarded: a latch must never outlive
    // its key, wherever the keyup happened to land.
    if (event.key === ' ') this.setHeld('space', false);
    if (event.key === 'Shift') this.setHeld('shift', false);
    if (isTypingTarget(pathOf(event))) return;
    this.emit({ type: 'key', code: event.key.toLowerCase(), down: false });
  };

  /** Focus left the shell root, or the tab was hidden: nothing is held any more. */
  private onBlur = (): void => {
    this.space = false;
    this.shiftHeld = false;
    this.syncCursor();
    this.emit({ type: 'blur' });
  };
}
