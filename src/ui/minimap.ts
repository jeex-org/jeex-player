/**
 * The mini-map of the walk and tour modes: the plan on a small white card in
 * the bottom-right corner, with the camera on it and the room under the
 * pointer lit up.
 *
 * Invariant: this module owns exactly one element, `#minimap`, which it creates
 * itself and appends to the viewer shell — no `index.html` id is read or
 * written here (the `door-hud.ts` pattern). Its whole state is machine-readable
 * (`data-visible`, `data-mode`, `data-hover-room`), because that is what a
 * browser check may assert on; nothing it shows is text, so nothing here needs
 * translating beyond the card's own label.
 *
 * It draws `plan-drawing.ts` through `plan-canvas.ts` in the `'minimap'` style
 * and owns no geometry of its own: the same primitives the 2D mode paints over
 * the whole viewport are painted here at 196 px. What it adds is the camera —
 * read from the controller's pose every frame — and one decision: a click on a
 * room is a request to TRAVEL there (`CameraDirector.travelToRoom`), never a
 * teleport it performs itself. In walk and tour it also draws the tour
 * cameras as numbered dots, the current one lit, and
 * a click on a dot is a request to STEP there (`CameraDirector.stepCamera`);
 * a dot wins over the room under it.
 *
 * Repaint discipline: the card is redrawn only when something visible moved.
 * A camera standing still, a pointer resting on the same room and an unchanged
 * document cost nothing per frame, which is what keeps a 2D canvas out of the
 * frame budget of a 3D scene.
 */

import { PLAN_PADDING, fitCanvasToBox, paintPlan, type PlanCameraMarker } from '../plan/plan-canvas.js';
import { fitTransform, planPoint, planPointAt, roomAt, type PlanDrawing, type PlanTransform } from '../plan/plan-drawing.js';
import type { Messages } from './messages.js';
import { listenerOptions } from '../shared/abort.js';
import type { Vec2, ViewerMode } from '../scene/types.js';

/**
 * The `data-jeex` name this module stamps on the card it creates. Owned here;
 * `viewer-shell.ts` imports it to compose `OVERLAY_NAMES`.
 */
export const MINIMAP_NAME = 'minimap';

export type MinimapDeps = {
  /** The viewer shell the card is appended to (`#viewer`). */
  container: HTMLElement;
  /** The drawing of the CURRENT document; `null` before the first one. */
  drawing: () => PlanDrawing | null;
  /** Where the camera stands and looks, in plan metres; `null` before it exists. */
  camera: () => PlanCameraMarker | null;
  /** Whether the mount option offers the map at all (`options.view.minimap`). */
  enabled: () => boolean;
  /** A click on a room: the application decides how to get there. */
  onRoomPicked: (roomId: string) => void;
  /** The tour cameras in plan metres, in tour order, and the walk's current one (0-based); absent draws none. */
  cameras?: (() => { readonly points: readonly Vec2[]; readonly current: number | null }) | undefined;
  /** A click on a camera dot (0-based tour index): the application steps there. */
  onCameraPicked?: ((index: number) => void) | undefined;
  /** This instance's catalogue; the card's `aria-label` is its only copy. */
  messages: Messages;
  /** The mounted viewer's lifetime; the card's three listeners carry it. */
  signal?: AbortSignal | undefined;
};

/** The modes the map belongs to; everywhere else it is not on screen. */
const MAP_MODES: ReadonlySet<ViewerMode> = new Set<ViewerMode>(['walk', 'tour']);

/** Camera movement below this does not earn a repaint, metres. */
const MOVE_EPS_M = 0.01;
/** Camera turn below this does not earn a repaint, radians (0.5°). */
const TURN_EPS_RAD = 0.0087;
/** Reach of the view cone on the map, metres. */
const CONE_RADIUS_M = 3.2;
/** Grid resolution used to find a point INSIDE an awkward room, per side. */
const INTERIOR_SAMPLES = 24;
/** Radius of a camera dot on the card, CSS px. */
const DOT_RADIUS_PX = 7;
/** A click this far from a dot's centre still picks it, CSS px. */
const DOT_PICK_PX = 10;
/** The dots' own palette: graphite with a white rim, the current one in the tour-camera accent. */
const DOT_FILL = '#2b302f';
const DOT_CURRENT = '#dfbd7d';

type PaintKey = {
  w: number;
  h: number;
  revision: number;
  x: number;
  z: number;
  yaw: number;
  hover: string;
  /** The camera dots (compared point by point, never formatted) and the current one. */
  cameraPoints: readonly Vec2[];
  cameraCurrent: number | null;
};

export class Minimap {
  private readonly deps: MinimapDeps;
  private readonly card: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly observer: ResizeObserver | null;
  private mode: ViewerMode = 'orbit';
  private hoverRoom: string | null = null;
  /** Transform of the last paint; `roomPoint` answers against it. */
  private transform: PlanTransform | null = null;
  private painted: PaintKey | null = null;
  /** Bumped by every new document and every resize, to force one repaint. */
  private revision = 0;

  constructor(deps: MinimapDeps) {
    this.deps = deps;
    this.card = deps.container.ownerDocument.createElement('div');
    this.card.dataset['jeex'] = MINIMAP_NAME;
    this.card.className = 'minimap';
    // `::part(minimap)` for a host styling the card from outside the shadow
    // root; the card is built here rather than in the shell tree.
    this.card.setAttribute('part', 'minimap');
    this.card.dataset['visible'] = 'false';
    this.card.dataset['mode'] = 'orbit';
    // A plain `<div>` is ARIA role "generic", which does not accept a
    // name from `aria-label` at all (axe `aria-prohibited-attr`) — `region`
    // does, and reads correctly for a labelled, navigable landmark.
    this.card.setAttribute('role', 'region');
    this.card.setAttribute('aria-label', deps.messages.t('minimap.label'));
    this.canvas = this.card.ownerDocument.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.card.appendChild(this.canvas);
    const listener = listenerOptions(deps.signal);
    this.card.addEventListener('pointermove', this.onPointerMove, listener);
    this.card.addEventListener('pointerleave', this.onPointerLeave, listener);
    this.card.addEventListener('click', this.onClick, listener);
    deps.container.appendChild(this.card);
    // The card follows ITS OWN box. There is no `window` resize fallback: it
    // reports the wrong element's size, and it is the listener two viewers on
    // one page were sharing (`render-runtime.ts` and `plan-modes.ts` watch the
    // viewport the same way).
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.invalidate());
    this.observer?.observe(this.card);
  }

  /** The card element, for tests and for the debug surface. */
  get element(): HTMLDivElement {
    return this.card;
  }

  /** Adopts a newly committed document: the drawing changed, so re-fit and repaint. */
  setDocument(): void {
    this.invalidate();
  }

  /** Applies a mode; the card is on screen only in walk and tour. */
  setMode(mode: ViewerMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.card.dataset['mode'] = mode;
    if (!this.isVisible()) this.clearHover();
    this.applyVisibility();
  }

  /**
   * One frame. Cheap by design: it re-reads the camera, decides whether
   * anything visible moved, and only then paints.
   */
  update(): void {
    this.applyVisibility();
    if (this.card.dataset['visible'] !== 'true') return;
    const drawing = this.deps.drawing();
    if (!drawing) return;
    const fitted = fitCanvasToBox(this.canvas, this.canvas);
    if (!fitted) return;
    const camera = this.deps.camera();
    const cameras = this.deps.cameras?.();
    const key: PaintKey = {
      w: fitted.w,
      h: fitted.h,
      revision: this.revision,
      x: camera?.x ?? 0,
      z: camera?.z ?? 0,
      yaw: camera?.yaw ?? 0,
      hover: this.hoverRoom ?? '',
      cameraPoints: cameras?.points ?? NO_POINTS,
      cameraCurrent: cameras?.current ?? null,
    };
    if (this.painted && this.settled(this.painted, key)) return;
    this.painted = key;
    this.transform = fitTransform(drawing.bounds, { w: fitted.w, h: fitted.h }, PLAN_PADDING);
    paintPlan(fitted.ctx, drawing, this.transform, 'minimap', {
      highlightRoom: this.hoverRoom,
      camera,
      coneRadius: CONE_RADIUS_M,
    });
    paintCameraDots(fitted.ctx, this.transform, cameras);
  }

  /**
   * Viewport pixels of tour camera `index` ON THE MAP, or `null` while the
   * map is hidden or carries no such dot: what a browser check clicks.
   */
  cameraPoint(index: number): { x: number; y: number } | null {
    if (this.card.dataset['visible'] !== 'true' || !this.transform) return null;
    const point = this.deps.cameras?.().points[index];
    if (!point) return null;
    const rect = this.canvas.getBoundingClientRect();
    const pixel = planPoint(this.transform, point);
    return { x: rect.left + pixel.x, y: rect.top + pixel.y };
  }

  /** What the debug surface reports: `__viewerDebug.minimap()`. */
  state(): { visible: boolean; camera: { x: number; z: number; yaw: number } | null; hoverRoom: string | null } {
    const camera = this.deps.camera();
    return {
      visible: this.card.dataset['visible'] === 'true',
      camera: camera ? { x: camera.x, z: camera.z, yaw: camera.yaw } : null,
      hoverRoom: this.hoverRoom,
    };
  }

  /**
   * Viewport pixels of a room's centre ON THE MAP, or `null` while the map is
   * hidden or has not been painted. This is what lets a browser check hover and
   * click a room without hard-coding a single pixel.
   */
  roomPoint(roomId: string): { x: number; y: number } | null {
    if (this.card.dataset['visible'] !== 'true') return null;
    const drawing = this.deps.drawing();
    if (!drawing) return null;
    const point = interiorPointOf(drawing, roomId);
    if (!point) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // The card can be laid out before its first paint; answer from the box it
    // WILL be painted into rather than making the caller wait for a frame.
    const transform = this.transform ?? fitTransform(drawing.bounds, { w: rect.width, h: rect.height }, PLAN_PADDING);
    const pixel = planPoint(transform, point);
    return { x: rect.left + pixel.x, y: rect.top + pixel.y };
  }

  /** The three card listeners die with the mount's signal; the card and the observer are this class's. */
  dispose(): void {
    this.observer?.disconnect();
    this.card.remove();
  }

  /** Whether the map belongs on screen right now: the right mode, and asked for. */
  private isVisible(): boolean {
    return this.deps.enabled() && MAP_MODES.has(this.mode);
  }

  private applyVisibility(): void {
    const visible = String(this.isVisible());
    if (this.card.dataset['visible'] === visible) return;
    this.card.dataset['visible'] = visible;
    // A card that comes back has no valid backing store behind it any more.
    this.invalidate();
  }

  /** Forces the next `update` to repaint, whatever the camera is doing. */
  private invalidate(): void {
    this.revision += 1;
    this.painted = null;
  }

  /** True when nothing visible has moved far enough to be worth a repaint. */
  private settled(before: PaintKey, now: PaintKey): boolean {
    if (before.w !== now.w || before.h !== now.h) return false;
    if (before.revision !== now.revision || before.hover !== now.hover) return false;
    if (before.cameraCurrent !== now.cameraCurrent || !samePoints(before.cameraPoints, now.cameraPoints)) return false;
    if (Math.hypot(before.x - now.x, before.z - now.z) > MOVE_EPS_M) return false;
    return Math.abs(angleDelta(before.yaw, now.yaw)) <= TURN_EPS_RAD;
  }

  /** The plan point under a pointer event, or `null` off the painted map. */
  private planPointOf(event: { clientX: number; clientY: number }): Vec2 | null {
    if (!this.transform) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return planPointAt(this.transform, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.card.dataset['visible'] !== 'true') return;
    const drawing = this.deps.drawing();
    const point = this.planPointOf(event);
    const room = drawing && point ? roomAt(drawing, point) : null;
    if (room === this.hoverRoom) return;
    this.hoverRoom = room;
    if (room) this.card.dataset['hoverRoom'] = room;
    else delete this.card.dataset['hoverRoom'];
  };

  private readonly onPointerLeave = (): void => {
    this.clearHover();
  };

  private clearHover(): void {
    if (this.hoverRoom === null) return;
    this.hoverRoom = null;
    delete this.card.dataset['hoverRoom'];
  }

  /** The camera dot under a pointer event (0-based), the nearest within `DOT_PICK_PX`; `null` for none. */
  private dotAt(event: { clientX: number; clientY: number }): number | null {
    const cameras = this.deps.cameras?.();
    const transform = this.transform;
    if (!cameras || !transform) return null;
    const rect = this.canvas.getBoundingClientRect();
    let best: number | null = null;
    let bestGap = DOT_PICK_PX;
    for (const [index, point] of cameras.points.entries()) {
      const at = planPoint(transform, point);
      const gap = Math.hypot(at.x - (event.clientX - rect.left), at.y - (event.clientY - rect.top));
      if (gap > bestGap) continue;
      best = index;
      bestGap = gap;
    }
    return best;
  }

  /**
   * A click — or a tap, which fires the same event — on a room. The room under
   * the pointer is resolved fresh: on touch there was never a hover to trust.
   */
  private readonly onClick = (event: MouseEvent): void => {
    if (this.card.dataset['visible'] !== 'true') return;
    const dot = this.dotAt(event);
    if (dot !== null && this.deps.onCameraPicked) {
      event.preventDefault();
      event.stopPropagation();
      this.deps.onCameraPicked(dot);
      return;
    }
    const drawing = this.deps.drawing();
    const point = this.planPointOf(event);
    const room = drawing && point ? roomAt(drawing, point) : null;
    if (!room) return;
    event.preventDefault();
    event.stopPropagation();
    this.deps.onRoomPicked(room);
  };
}

const NO_POINTS: readonly Vec2[] = [];

/** Whether two dot lists draw the same: the same list, or the same places in the same order (no allocation per frame). */
function samePoints(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((point, index) => point.x === b[index]!.x && point.z === b[index]!.z);
}

/** The tour cameras as numbered dots, the current one in the accent, drawn over the plan and the walker. */
function paintCameraDots(
  ctx: CanvasRenderingContext2D,
  transform: PlanTransform,
  cameras: { readonly points: readonly Vec2[]; readonly current: number | null } | undefined,
): void {
  if (!cameras) return;
  ctx.save();
  ctx.font = `700 9px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  cameras.points.forEach((point, index) => {
    const at = planPoint(transform, point);
    const current = index === cameras.current;
    ctx.beginPath();
    ctx.arc(at.x, at.y, DOT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = current ? DOT_CURRENT : DOT_FILL;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = current ? '#1c2523' : '#ffffff';
    ctx.fillText(String(index + 1), at.x, at.y + 0.5);
  });
  ctx.restore();
}

/** `a - b` folded into `[-PI, PI]`. */
function angleDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * A point the hit test resolves to `roomId`.
 *
 * The area centroid is the answer for every convex room, but an L-shaped one
 * (or the living room around its bay) can put its centroid in the neighbour, so
 * the fallback samples the polygon's bounding box and keeps the sample farthest
 * from anything else — the most unambiguous place to aim a pointer at.
 */
function interiorPointOf(drawing: PlanDrawing, roomId: string): Vec2 | null {
  const room = drawing.primitives.find((primitive) => primitive.kind === 'room' && primitive.id === roomId);
  if (!room || room.kind !== 'room' || room.polygon.length < 3) return null;

  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < room.polygon.length; i += 1) {
    const a = room.polygon[i]!;
    const b = room.polygon[(i + 1) % room.polygon.length]!;
    const w = a.x * b.z - b.x * a.z;
    area += w;
    cx += (a.x + b.x) * w;
    cz += (a.z + b.z) * w;
  }
  if (Math.abs(area) > 1e-9) {
    const centroid = { x: cx / (3 * area), z: cz / (3 * area) };
    if (roomAt(drawing, centroid) === roomId) return centroid;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of room.polygon) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  let best: Vec2 | null = null;
  let bestClearance = -Infinity;
  for (let i = 1; i < INTERIOR_SAMPLES; i += 1) {
    for (let j = 1; j < INTERIOR_SAMPLES; j += 1) {
      const candidate = {
        x: minX + ((maxX - minX) * i) / INTERIOR_SAMPLES,
        z: minZ + ((maxZ - minZ) * j) / INTERIOR_SAMPLES,
      };
      if (roomAt(drawing, candidate) !== roomId) continue;
      const clearance = Math.min(candidate.x - minX, maxX - candidate.x, candidate.z - minZ, maxZ - candidate.z);
      if (clearance <= bestClearance) continue;
      bestClearance = clearance;
      best = candidate;
    }
  }
  return best;
}
