/**
 * Gesture probes: synthetic pointer and wheel events, and the projection
 * readings that say where the picture actually went.
 *
 * Directions are MEASURED, never argued about (the rule: "Input direction: the
 * scene follows the fingers"): every verdict comes from
 * `__viewerDebug.projectPoint` before and after the gesture, because a
 * state-only assertion passes happily on an inverted control.
 *
 * The probe is bound to a session because firing a gesture and reading its
 * result are one round trip through `agent-browser eval`; the CASE TABLES are
 * built with it for the same reason (a dispatch snippet embeds JSON literals).
 */

import { literal, type Session } from './session.js';

/**
 * 360-mode gesture directions, measured rather than argued about (the rule:
 * "Input direction: the scene follows the fingers").
 *
 * A synthetic gesture goes to the canvas and the check reads where two FIXED
 * world points landed on screen before and after, through
 * `__viewerDebug.projectPoint`. No sign algebra survives that: the projection
 * is what the user sees.
 *
 *   centre — the floor point the camera looks at. A pan carries it with the
 *            fingers; a rotation leaves it where it is, which is how "this
 *            gesture must not pan" is asserted.
 *   probe  — 3 m in front of the centre, i.e. below it on screen and where the
 *            drags start and the wheel fires: the point a rotation swings
 *            sideways and a zoom holds under the cursor.
 *   eye    — camera height. Panning only ever slides the rig horizontally, so
 *            a pan cannot touch it, while a zoom scales it with the radius.
 */
export type GestureMotion = { cx: number; cy: number; px: number; py: number; height0: number; height1: number };

export type GestureExpectation = {
  /** Where the point the camera looks at must travel: the pan channel. */
  pan?: { x?: 'left' | 'right' | 'still'; y?: 'up' | 'down' | 'still' };
  /**
   * Where the point under the pointer must go: a rotation swings it, a zoom
   * toward the cursor holds it `still` (both axes).
   */
  spin?: 'left' | 'right' | 'still';
  zoom?: 'in' | 'out' | 'none';
};

/** Pixels below which a motion is projection noise rather than a direction. */
const GESTURE_PX = 8;
/**
 * "Still" is judged loosely: the centre probe is the floor point under the
 * screen centre, a few centimetres off the true orbit target, so a rotation
 * nudges it ~10 px, and a 120 px pan drags it ~13 px off-axis through the
 * perspective. Both are an order of magnitude below the 100-240 px an unwanted
 * pan moves it, which is what this check is hunting.
 */
const GESTURE_STILL_PX = 25;

/** One printable line: what the gesture did, what it had to do, and whether it agrees. */
export function gestureVerdict(m: GestureMotion, want: GestureExpectation): { ok: boolean; line: string } {
  const dir = (value: number, low: string, high: string, limit: number): string =>
    Math.abs(value) < limit ? 'still' : value > 0 ? high : low;
  const sawX = dir(m.cx, 'left', 'right', want.pan?.x === 'still' ? GESTURE_STILL_PX : GESTURE_PX);
  const sawY = dir(m.cy, 'up', 'down', want.pan?.y === 'still' ? GESTURE_STILL_PX : GESTURE_PX);
  // «Still» for the probe is both axes: a zoom that drifts the point under the
  // cursor straight up or down is exactly the defect this channel hunts.
  const sawSpin =
    want.spin === 'still' ? (Math.hypot(m.px, m.py) < GESTURE_STILL_PX ? 'still' : 'moved') : dir(m.px, 'left', 'right', GESTURE_PX);
  const ratio = m.height1 / m.height0;
  const sawZoom = Math.abs(ratio - 1) < 0.02 ? 'none' : ratio < 1 ? 'in' : 'out';
  const wants: string[] = [];
  let ok = true;
  if (want.pan?.x) {
    wants.push(`centre ${want.pan.x}`);
    if (sawX !== want.pan.x) ok = false;
  }
  if (want.pan?.y) {
    wants.push(`centre ${want.pan.y}`);
    if (sawY !== want.pan.y) ok = false;
  }
  if (want.spin) {
    wants.push(`near point ${want.spin}`);
    if (sawSpin !== want.spin) ok = false;
  }
  if (want.zoom) {
    wants.push(`zoom ${want.zoom}`);
    if (sawZoom !== want.zoom) ok = false;
  }
  const measured = `centre ${sawX}/${sawY} (${m.cx.toFixed(1)}, ${m.cy.toFixed(1)} px), near point ${sawSpin} (${m.px.toFixed(1)}, ${m.py.toFixed(1)} px), zoom ${sawZoom} (eye ${m.height0.toFixed(2)} -> ${m.height1.toFixed(2)} m)`;
  return { ok, line: `${measured} | expected ${wants.join(' + ') || '(reported only)'}` };
}

const STILL_CENTRE = { x: 'still', y: 'still' } as const;

/**
 * Walk-mode drag-look, measured the same way as the 360 gestures (the same
 * "Input direction" rule): the picture must follow the
 * pointer on both axes, not the inverted first-person look convention.
 *
 * There is no exposed camera direction, only `__viewerDebug.camera()`
 * (position) and `projectPoint`, so the "point 3 m ahead at eye height" the
 * check needs is FOUND rather than computed from an angle: a ring of
 * candidates at that radius and height is projected, and the one landing
 * nearest the screen centre is the one the camera is looking at. That same
 * fixed world point is re-projected after the drag, so its screen motion is
 * exactly what the eye would see move.
 */
export type WalkGestureMotion = { dx: number; dy: number };

/** One printable line for a walk drag gesture, direction only (magnitude is not the point here). */
export function walkGestureVerdict(
  name: string,
  m: WalkGestureMotion,
  want: { x?: 'left' | 'right' | 'still'; y?: 'up' | 'down' | 'still' },
): { ok: boolean; line: string } {
  const dir = (value: number, low: string, high: string): string => (Math.abs(value) < GESTURE_PX ? 'still' : value > 0 ? high : low);
  const sawX = dir(m.dx, 'left', 'right');
  const sawY = dir(m.dy, 'up', 'down');
  let ok = true;
  if (want.x && sawX !== want.x) ok = false;
  if (want.y && sawY !== want.y) ok = false;
  return { ok, line: `${name}: ahead-point moved ${sawX}/${sawY} (${m.dx.toFixed(1)}, ${m.dy.toFixed(1)} px)` };
}

/**
 * What a walk case does besides a plain drag: the MOVE modifier the
 * press carries, two pointers, or a wheel instead of a drag. `floor` measures
 * a FLOOR point ahead instead of one at eye height — the point a walk moves:
 * walking towards it slides it down the screen, stepping left slides it right.
 */
export type WalkGestureOptions = {
  move?: 'space' | 'right-button' | 'shift' | undefined;
  pointers?: 1 | 2 | undefined;
  wheelY?: number | undefined;
  floor?: boolean | undefined;
};

export type GestureProbe = {
  gestureMotion: (dispatch: string) => Promise<GestureMotion>;
  walkGestureMotion: (dx: number, dy: number, options?: WalkGestureOptions) => Promise<WalkGestureMotion>;
  gestureVerdict: typeof gestureVerdict;
  walkGestureVerdict: typeof walkGestureVerdict;
  GESTURE_CASES: Array<{ name: string; dispatch: string; expect: GestureExpectation }>;
  WALK_GESTURE_CASES: Array<{
    name: string;
    dx: number;
    dy: number;
    options?: WalkGestureOptions;
    expect: { x?: 'left' | 'right' | 'still'; y?: 'up' | 'down' | 'still' };
  }>;
};

export function createGestureProbe(session: Session): GestureProbe {
  const { evalValue } = session;

  /** A wheel over the probe (`ox`/`oy`), where a zoom must hold the point it closes in on. */
  const gestureWheel = (init: Record<string, unknown>): string =>
    `canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 0, deltaX: 0, deltaY: 0, clientX: ox, clientY: oy, ...${literal(init)} }));`;

  /** A press-move-release drag from the probe, in eight increments. */
  const gestureDrag = (dx: number, dy: number, opts: { button?: number; shiftKey?: boolean; pointers?: number } = {}): string => `
    const ids = ${literal(opts.pointers === 2 ? [901, 902] : [901])};
    const base = { bubbles: true, cancelable: true, button: ${opts.button ?? 0}, buttons: ${opts.button === 2 ? 2 : 1}, shiftKey: ${opts.shiftKey ?? false}, isPrimary: true, pointerType: 'mouse' };
    ids.forEach((pointerId, i) => canvas.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId, clientX: ox + i * 60, clientY: oy })));
    for (let s = 1; s <= 8; s += 1) {
      ids.forEach((pointerId, i) => canvas.dispatchEvent(new PointerEvent('pointermove', {
        ...base, pointerId, clientX: ox + i * 60 + (${dx} * s) / 8, clientY: oy + (${dy} * s) / 8,
      })));
      await frames(1);
    }
    ids.forEach((pointerId) => canvas.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId, buttons: 0 })));
  `;

  /**
   * Space held on the focused shell root around `dispatch` — the move modifier
   * (camera-input.ts). The root is focused first, as a click would focus it.
   */
  const withSpace = (dispatch: string): string => `
    const root = document.querySelector('[data-jeex="viewer"]');
    root.focus();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    ${dispatch}
    root.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  `;

  /** A movement key held on the focused shell root for thirty rendered frames. */
  const holdKey = (key: string): string => `
    const root = document.querySelector('[data-jeex="viewer"]');
    root.focus();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: ${literal(key)}, bubbles: true, cancelable: true }));
    await frames(30);
    root.dispatchEvent(new KeyboardEvent('keyup', { key: ${literal(key)}, bubbles: true }));
  `;

  /** Resets the 360 camera, fires one gesture and reports where the picture went. */
  const gestureMotion = async (dispatch: string): Promise<GestureMotion> => {
    return evalValue<GestureMotion>(`(async () => {
      const D = window.__viewerDebug;
      // Waits on the viewer's own frames, never on the wall clock (the
      // headless page may draw a few frames a second): \`frames(n)\` is n
      // rendered frames, \`settle()\` is the camera holding still for three.
      const frames = (n) => new Promise((resolve) => {
        let seen = 0;
        const tick = () => (++seen >= n ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
      const settle = async () => {
        let last = window.__viewerDebug.camera(), still = 0;
        for (let i = 0; i < 400 && still < 3; i += 1) {
          await frames(1);
          const now = window.__viewerDebug.camera();
          still = Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z) < 1e-4 ? still + 1 : 0;
          last = now;
        }
      };
      const canvas = document.querySelector('[data-jeex="scene-canvas"]');
      document.querySelector('[data-jeex="reset-button"]').click();
      await settle();
      const w = innerWidth, h = innerHeight;
      const room = D.plan().rooms[0];
      // The floor raycast is null wherever the apartment has no floor under that
      // pixel, so the centre falls back to a room the plan guarantees exists.
      const centre = D.floorPoint(w / 2, h / 2) ?? { x: (room.bbox.minX + room.bbox.maxX) / 2, y: 0, z: (room.bbox.minZ + room.bbox.maxZ) / 2 };
      const eye = D.camera();
      const back = Math.hypot(eye.x - centre.x, eye.z - centre.z) || 1;
      const probe = { x: centre.x + (3 * (eye.x - centre.x)) / back, y: 0, z: centre.z + (3 * (eye.z - centre.z)) / back };
      const start = D.projectPoint(probe.x, probe.y, probe.z);
      const ox = start.x, oy = start.y;
      const at = () => ({
        centre: D.projectPoint(centre.x, centre.y, centre.z),
        probe: D.projectPoint(probe.x, probe.y, probe.z),
        height: D.camera().y,
      });
      const before = at();
      ${dispatch}
      await settle();
      const after = at();
      return JSON.stringify({
        cx: after.centre.x - before.centre.x,
        cy: after.centre.y - before.centre.y,
        px: after.probe.x - before.probe.x,
        py: after.probe.y - before.probe.y,
        height0: before.height,
        height1: after.height,
      });
    })()`);
  };

  /**
   * Every way a viewer can move the 360 camera, with the direction the rule
   * demands. Natural scrolling is the macOS default and the convention the
   * viewer is written to: fingers LEFT arrive as `deltaX > 0`, fingers UP as
   * `deltaY > 0`.
   */
  const GESTURE_CASES: Array<{ name: string; dispatch: string; expect: GestureExpectation }> = [
    {
      name: 'wheel deltaX=+180 (two fingers swipe LEFT)',
      dispatch: gestureWheel({ deltaX: 180 }),
      expect: { pan: { x: 'left', y: 'still' }, zoom: 'none' },
    },
    {
      name: 'wheel deltaX=-180 (two fingers swipe RIGHT)',
      dispatch: gestureWheel({ deltaX: -180 }),
      expect: { pan: { x: 'right', y: 'still' }, zoom: 'none' },
    },
    {
      name: 'wheel deltaX=+170 deltaY=+60 (diagonal swipe LEFT and UP)',
      dispatch: gestureWheel({ deltaX: 170, deltaY: 60 }),
      expect: { pan: { x: 'left', y: 'up' }, zoom: 'none' },
    },
    {
      name: 'wheel shift deltaY=+180 (two fingers swipe UP)',
      dispatch: gestureWheel({ deltaY: 180, shiftKey: true }),
      expect: { pan: { x: 'still', y: 'up' }, zoom: 'none' },
    },
    {
      name: 'wheel shift deltaY=-180 (two fingers swipe DOWN)',
      dispatch: gestureWheel({ deltaY: -180, shiftKey: true }),
      expect: { pan: { x: 'still', y: 'down' }, zoom: 'none' },
    },
    { name: 'wheel deltaY=-180 (wheel forward)', dispatch: gestureWheel({ deltaY: -180 }), expect: { spin: 'still', zoom: 'in' } },
    { name: 'wheel deltaY=+180 (wheel back)', dispatch: gestureWheel({ deltaY: 180 }), expect: { spin: 'still', zoom: 'out' } },
    {
      name: 'ctrl+wheel deltaY=-160 deltaX=-200 (pinch APART, stray deltaX)',
      dispatch: gestureWheel({ deltaY: -160, deltaX: -200, ctrlKey: true }),
      expect: { spin: 'still', zoom: 'in' },
    },
    {
      name: 'ctrl+wheel deltaY=+160 deltaX=+200 (pinch TOGETHER, stray deltaX)',
      dispatch: gestureWheel({ deltaY: 160, deltaX: 200, ctrlKey: true }),
      expect: { spin: 'still', zoom: 'out' },
    },
    {
      name: 'wheel deltaMode=1 deltaY=-11 lines (Firefox wheel forward)',
      dispatch: gestureWheel({ deltaY: -11, deltaMode: 1 }),
      expect: { spin: 'still', zoom: 'in' },
    },
    { name: 'drag right 48 px (rotate)', dispatch: gestureDrag(48, 0), expect: { spin: 'right', pan: STILL_CENTRE, zoom: 'none' } },
    { name: 'drag left 48 px (rotate)', dispatch: gestureDrag(-48, 0), expect: { spin: 'left', pan: STILL_CENTRE, zoom: 'none' } },
    {
      name: 'shift-drag right 120 px (pan)',
      dispatch: gestureDrag(120, 0, { shiftKey: true }),
      expect: { pan: { x: 'right', y: 'still' }, zoom: 'none' },
    },
    {
      name: 'shift-drag down 120 px (pan)',
      dispatch: gestureDrag(0, 120, { shiftKey: true }),
      expect: { pan: { x: 'still', y: 'down' }, zoom: 'none' },
    },
    {
      name: 'right-button drag right 120 px (pan)',
      dispatch: gestureDrag(120, 0, { button: 2 }),
      expect: { pan: { x: 'right', y: 'still' }, zoom: 'none' },
    },
    {
      name: 'right-button drag down 120 px (pan)',
      dispatch: gestureDrag(0, 120, { button: 2 }),
      expect: { pan: { x: 'still', y: 'down' }, zoom: 'none' },
    },
    {
      name: 'Space+drag right 120 px (pan)',
      dispatch: withSpace(gestureDrag(120, 0)),
      expect: { pan: { x: 'right', y: 'still' }, zoom: 'none' },
    },
    {
      name: 'Space+drag down 120 px (pan)',
      dispatch: withSpace(gestureDrag(0, 120)),
      expect: { pan: { x: 'still', y: 'down' }, zoom: 'none' },
    },
    // WASD pan the model: W takes the view forward (the centre comes down
    // towards the viewer), D to the right (the centre slides left).
    { name: 'key W held (pan forward)', dispatch: holdKey('w'), expect: { pan: { x: 'still', y: 'down' }, zoom: 'none' } },
    { name: 'key D held (pan right)', dispatch: holdKey('d'), expect: { pan: { x: 'left', y: 'still' }, zoom: 'none' } },
    {
      name: 'two-pointer drag right 120 px (touch pan)',
      dispatch: gestureDrag(120, 0, { pointers: 2 }),
      expect: { pan: { x: 'right', y: 'still' } },
    },
    {
      name: 'two-pointer drag down 120 px (touch pan)',
      dispatch: gestureDrag(0, 120, { pointers: 2 }),
      expect: { pan: { x: 'still', y: 'down' } },
    },
  ];

  /**
   * Resets to orbit, enters walk, fires one gesture from the canvas centre (a
   * drag, a MOVE drag or a wheel, per `options`), reports where the ahead-point
   * went.
   */
  const walkGestureMotion = async (dx: number, dy: number, options: WalkGestureOptions = {}): Promise<WalkGestureMotion> => {
    const button = options.move === 'right-button' ? 2 : 0;
    const ids = options.pointers === 2 ? [971, 972] : [971];
    return evalValue<WalkGestureMotion>(`(async () => {
      const D = window.__viewerDebug;
      // Waits on the viewer's own frames, never on the wall clock (the
      // headless page may draw a few frames a second): \`frames(n)\` is n
      // rendered frames, \`settle()\` is the camera holding still for three.
      const frames = (n) => new Promise((resolve) => {
        let seen = 0;
        const tick = () => (++seen >= n ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
      const settle = async () => {
        let last = window.__viewerDebug.camera(), still = 0;
        for (let i = 0; i < 400 && still < 3; i += 1) {
          await frames(1);
          const now = window.__viewerDebug.camera();
          still = Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z) < 1e-4 ? still + 1 : 0;
          last = now;
        }
      };
      const canvas = document.querySelector('[data-jeex="scene-canvas"]');
      document.querySelector('[data-jeex="reset-button"]').click();
      await settle();
      document.querySelector('[data-mode="walk"]').click();
      await settle();
      const w = innerWidth, h = innerHeight;
      const eye = D.camera();
      // The point the camera looks at: 3 m out at eye height for a look; for a
      // move, a floor point 5 m out (nearest the vertical centre line) — at
      // 3 m the floor sits below the bottom edge of a level eye-height view.
      const floor = ${options.floor === true};
      const reach = floor ? 5 : 3;
      let ahead = null, bestDist = Infinity;
      for (let a = 0; a < 360; a += 5) {
        const rad = (a * Math.PI) / 180;
        const x = eye.x + reach * Math.sin(rad);
        const z = eye.z + reach * Math.cos(rad);
        const y = floor ? 0 : eye.y;
        const p = D.projectPoint(x, y, z);
        if (!p || p.y < 0 || p.y > h) continue;
        const d = floor ? Math.abs(p.x - w / 2) : Math.hypot(p.x - w / 2, p.y - h / 2);
        if (d < bestDist) { bestDist = d; ahead = { x, y, z }; }
      }
      if (!ahead) throw new Error('no ' + (floor ? 'floor' : 'eye-height') + ' point ahead is in view');
      const before = D.projectPoint(ahead.x, ahead.y, ahead.z);
      const ox = w / 2, oy = h / 2;
      const root = document.querySelector('[data-jeex="viewer"]');
      root.focus();
      const space = ${options.move === 'space'};
      if (space) root.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      const wheelY = ${options.wheelY ?? 0};
      if (wheelY !== 0) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 0, deltaX: 0, deltaY: wheelY, clientX: ox, clientY: oy }));
      } else {
        const ids = ${literal(ids)};
        const base = { bubbles: true, cancelable: true, button: ${button}, buttons: ${button === 2 ? 2 : 1}, shiftKey: ${options.move === 'shift'}, isPrimary: true, pointerType: 'mouse' };
        ids.forEach((pointerId, i) => canvas.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId, clientX: ox + i * 60, clientY: oy })));
        for (let s = 1; s <= 8; s += 1) {
          ids.forEach((pointerId, i) => canvas.dispatchEvent(new PointerEvent('pointermove', {
            ...base, pointerId, clientX: ox + i * 60 + (${dx} * s) / 8, clientY: oy + (${dy} * s) / 8,
          })));
          await frames(1);
        }
        ids.forEach((pointerId) => canvas.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId, buttons: 0 })));
      }
      if (space) root.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
      await settle();
      const after = D.projectPoint(ahead.x, ahead.y, ahead.z);
      return JSON.stringify({ dx: after.x - before.x, dy: after.y - before.y });
    })()`);
  };

  const WALK_GESTURE_CASES: Array<{
    name: string;
    dx: number;
    dy: number;
    options?: WalkGestureOptions;
    expect: { x?: 'left' | 'right' | 'still'; y?: 'up' | 'down' | 'still' };
  }> = [
    { name: 'walk drag right 48 px', dx: 48, dy: 0, expect: { x: 'right' } },
    { name: 'walk drag left 48 px', dx: -48, dy: 0, expect: { x: 'left' } },
    { name: 'walk drag down 48 px', dx: 0, dy: 48, expect: { y: 'down' } },
    { name: 'walk drag up 48 px', dx: 0, dy: -48, expect: { y: 'up' } },
    // Moving by hand: the FLOOR follows the pointer.
    // Pull it down and you walk forward (a floor point ahead slides down);
    // drag it right and you step left (the point slides right).
    { name: 'walk Space+drag down 60 px (forward)', dx: 0, dy: 60, options: { move: 'space', floor: true }, expect: { y: 'down' } },
    { name: 'walk Space+drag right 60 px (step left)', dx: 60, dy: 0, options: { move: 'space', floor: true }, expect: { x: 'right' } },
    {
      name: 'walk right-button drag down 60 px (forward)',
      dx: 0,
      dy: 60,
      options: { move: 'right-button', floor: true },
      expect: { y: 'down' },
    },
    { name: 'walk shift-drag left 60 px (step right)', dx: -60, dy: 0, options: { move: 'shift', floor: true }, expect: { x: 'left' } },
    { name: 'walk two-pointer drag down 60 px (forward)', dx: 0, dy: 60, options: { pointers: 2, floor: true }, expect: { y: 'down' } },
    { name: 'walk wheel deltaY=-100 (step forward)', dx: 0, dy: 0, options: { wheelY: -100, floor: true }, expect: { y: 'down' } },
    { name: 'walk wheel deltaY=+100 (step back)', dx: 0, dy: 0, options: { wheelY: 100, floor: true }, expect: { y: 'up' } },
  ];

  return { gestureMotion, walkGestureMotion, gestureVerdict, walkGestureVerdict, GESTURE_CASES, WALK_GESTURE_CASES };
}
