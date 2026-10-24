/**
 * The tour-camera tool's state machine and gestures, driven headless: the
 * canvas and the key target are listener registries, the events are plain
 * objects, and the screen-space picking projects real poses through a real
 * camera without a renderer. What is pinned here is what a screenshot cannot
 * see — which gesture a press starts, the clamps and floor rules, the «no
 * empty commit» rule, placement, the keyboard and the rebuild-from-committed
 * invariant.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { CheckpointOverlay, type CheckpointEdit } from './checkpoint-overlay.js';
import { BURST_IDLE_MS, type Scheduler } from './checkpoint-keys.js';
import { LEVEL_PITCH_RAD, canStand } from './checkpoint-placement.js';
import { activeShapes, viewOf } from './checkpoint-view.js';
import type { HandleKind } from './checkpoint-picking.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { solvePlan } from '../plan/plan-solver.js';
import { EYE_HEIGHT_M } from '../navigation/navigation.js';
import type { TourCheckpoint, ViewerMode } from '../scene/types.js';

const WIDTH = 800;
const HEIGHT = 600;

/** A listener registry with the canvas's box and pointer capture, no DOM behind it. */
class FakeTarget {
  readonly style: Record<string, string> = {};
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(): void {}
  setPointerCapture(): void {}
  releasePointerCapture(): void {}

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: WIDTH, height: HEIGHT };
  }

  /** Fires one synthetic event; answers whether a listener stopped it. */
  fire(type: string, event: Record<string, unknown>): { stopped: boolean } {
    const state = { stopped: false };
    for (const listener of this.listeners.get(type) ?? []) {
      if (state.stopped) break;
      listener({
        button: 0,
        pointerId: 1,
        timeStamp: 100,
        shiftKey: false,
        preventDefault: () => {},
        stopImmediatePropagation: () => {
          state.stopped = true;
        },
        ...event,
      });
    }
    return state;
  }
}

/** A scheduler the test fires by hand. */
function manualScheduler(): { schedule: Scheduler; fire: () => void; pending: () => boolean } {
  let run: (() => void) | null = null;
  return {
    schedule: (callback, ms) => {
      expect(ms).toBe(BURST_IDLE_MS);
      run = callback;
      return () => {
        run = null;
      };
    },
    fire: () => {
      const callback = run;
      run = null;
      callback?.();
    },
    pending: () => run !== null,
  };
}

/** Camera ids, as the host mints them; the overlay mints none. */
const CAM = {
  a: '01a12fe5-7e47-7fee-8083-0c62fa84e770',
  b: '01a12fe5-7e48-729e-9ea0-58a56d1cfe21',
  added: '01a12fe5-7e49-7d1e-ba95-a5d70c4dd6bf',
  addedNext: '01a12fe5-7e4a-7fd4-8180-d51d8d640bc0',
} as const;

const CAM_A: TourCheckpoint = { id: CAM.a, position: { x: 2, y: 1.6, z: 3 }, yaw: 0, pitch: 0 };
const CAM_B: TourCheckpoint = { id: CAM.b, position: { x: 4, y: 1.6, z: 6 }, yaw: Math.PI, pitch: 0.1 };
const plan = solvePlan(lShapePlan);

type Harness = {
  canvas: FakeTarget;
  keys: FakeTarget;
  overlay: CheckpointOverlay;
  camera: THREE.PerspectiveCamera;
  /** The plan's top view: what `plan3d` draws and casts rays with. */
  top: THREE.OrthographicCamera;
  selections: Array<string | null>;
  edits: CheckpointEdit[];
  placing: boolean[];
  framed: string[];
  world: { mode: ViewerMode };
  timer: ReturnType<typeof manualScheduler>;
  reload: () => void;
  /** How many times the overlay asked for a redraw. */
  changes: { count: number };
};

function harness(checkpoints: TourCheckpoint[] = [CAM_A, CAM_B]): Harness {
  const canvas = new FakeTarget();
  const keys = new FakeTarget();
  const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 160);
  // Straight down over the L-shape, north up, 16 x 12 m on the 800 x 600 canvas (`plan-modes.ts` fits it the same way).
  const top = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 100);
  top.up.set(0, 0, -1);
  top.position.set(5, 40, 4);
  top.lookAt(5, 0, 4);
  top.updateProjectionMatrix();
  top.updateMatrixWorld();
  const selections: Array<string | null> = [];
  const edits: CheckpointEdit[] = [];
  const placing: boolean[] = [];
  const framed: string[] = [];
  const world = { mode: 'orbit' as ViewerMode };
  const timer = manualScheduler();
  const changes = { count: 0 };
  const doc = { ...lShapePlan, tourCheckpoints: checkpoints };
  const overlay = new CheckpointOverlay({
    canvas: canvas as unknown as HTMLCanvasElement,
    keys: keys as unknown as HTMLElement,
    camera: () => camera,
    drawCamera: () => (world.mode === 'plan3d' ? top : camera),
    rayCamera: () => (world.mode === 'plan3d' ? top : camera),
    mode: () => world.mode,
    scene: () => doc,
    plan: () => plan,
    obstacles: () => [],
    rev: () => 7,
    enabled: () => true,
    pose: () => ({ position: camera.position.clone(), target: camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3())) }),
    frame: (checkpoint) => framed.push(checkpoint.id),
    onSelect: (selection) => selections.push(selection.id),
    onEdit: (edit) => edits.push(edit),
    onPlacing: (active) => placing.push(active),
    schedule: timer.schedule,
    onChange: () => (changes.count += 1),
  });
  overlay.group.visible = true;
  overlay.setScene(doc);
  return {
    canvas,
    keys,
    overlay,
    camera,
    top,
    selections,
    edits,
    placing,
    framed,
    world,
    timer,
    reload: () => overlay.setScene(doc),
    changes,
  };
}

/** Stands the author at `from` looking at `at`. */
function look(camera: THREE.PerspectiveCamera, from: THREE.Vector3, at: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)): void {
  camera.position.copy(from);
  camera.up.copy(up);
  camera.lookAt(at);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** A world point in the fake canvas's client pixels. */
function screen(camera: THREE.Camera, point: { x: number; y: number; z: number }): { clientX: number; clientY: number } {
  const ndc = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return { clientX: ((ndc.x + 1) / 2) * WIDTH, clientY: ((1 - ndc.y) / 2) * HEIGHT };
}

/** A press, a move (when `to` differs) and a release. */
function drag(h: Harness, from: { clientX: number; clientY: number }, to = from, extra: Record<string, unknown> = {}): void {
  h.canvas.fire('pointerdown', from);
  if (to !== from) h.canvas.fire('pointermove', { ...to, ...extra });
  h.canvas.fire('pointerup', to);
}

/** Every handle `orbit` offers. */
const ORBIT_HANDLES: ReadonlySet<HandleKind> = new Set<HandleKind>(['move', 'height', 'pitch', 'yaw']);

const SIDE = (h: Harness): void => look(h.camera, new THREE.Vector3(2, 3.2, 9), new THREE.Vector3(2, 1.2, 3));

describe('selecting', () => {
  test('setScene builds one camera per checkpoint, the gizmo and the tube', () => {
    const { overlay } = harness();
    expect(overlay.group.children.filter((child) => child.userData['checkpointId'])).toHaveLength(2);
    expect(overlay.group.children.some((child) => child.name === 'checkpointGizmo')).toBe(true);
    expect(overlay.group.children.some((child) => child instanceof THREE.Mesh)).toBe(true);
  });

  test('a click on a camera body focuses it and commits nothing', () => {
    const h = harness();
    SIDE(h);
    drag(h, screen(h.camera, CAM_A.position));
    expect(h.selections).toEqual([CAM.a]);
    expect(h.overlay.activeCheckpoint()?.id).toBe(CAM.a);
    expect(h.edits).toEqual([]);
  });

  test('a press within the grace radius is claimed — it never reaches the orbit', () => {
    const h = harness();
    SIDE(h);
    const at = screen(h.camera, CAM_A.position);
    expect(h.canvas.fire('pointerdown', { clientX: at.clientX + 20, clientY: at.clientY }).stopped).toBe(true);
    h.canvas.fire('pointerup', { clientX: at.clientX + 20, clientY: at.clientY });
    expect(h.canvas.fire('pointerdown', { clientX: 20, clientY: 20 }).stopped).toBe(false);
  });

  test('a far click deselects; a near miss between the grace and deselect radii does not', () => {
    const h = harness();
    SIDE(h);
    h.overlay.setActive(CAM.a);
    h.selections.length = 0;
    const view = viewOf(h.camera, h.canvas as unknown as HTMLCanvasElement)!;
    const shapes = activeShapes(CAM_A, view, ORBIT_HANDLES);
    const body = shapes.body!;
    // 20 px beyond the body's rim, straight left: outside every handle's grace, inside the 24 px band.
    const near = { clientX: body.at.x - body.radius - 20, clientY: body.at.y };
    drag(h, near);
    expect(h.selections).toEqual([]);
    drag(h, { clientX: 20, clientY: 20 });
    expect(h.selections).toEqual([null]);
  });

  test('focusCheckpoint focuses like a click, refuses an unknown id, null clears', () => {
    const h = harness();
    expect(h.overlay.focusCheckpoint(CAM.b)).toBe(true);
    expect(h.overlay.focusCheckpoint('cam-nope')).toBe(false);
    expect(h.overlay.activeCheckpoint()?.id).toBe(CAM.b);
    expect(h.overlay.focusCheckpoint(null)).toBe(true);
    expect(h.selections).toEqual([CAM.b, null]);
  });

  test('Esc deselects, and is claimed only while something is selected', () => {
    const h = harness();
    expect(h.keys.fire('keydown', { key: 'Escape' }).stopped).toBe(false);
    h.overlay.setActive(CAM.a);
    expect(h.keys.fire('keydown', { key: 'Escape' }).stopped).toBe(true);
    expect(h.overlay.activeCheckpoint()).toBeNull();
  });
});

describe('moving, lifting, turning', () => {
  test('a drag from the body centre MOVES the camera — it never lifts it', () => {
    const h = harness();
    SIDE(h);
    h.overlay.setActive(CAM.a);
    const at = screen(h.camera, CAM_A.position);
    drag(h, at, { clientX: at.clientX - 60, clientY: at.clientY });
    expect(h.edits).toHaveLength(1);
    const moved = h.edits[0]!.checkpoints[0]!;
    expect(moved.position.x).toBeLessThan(CAM_A.position.x);
    expect(moved.position.y).toBe(CAM_A.position.y);
    expect(h.edits[0]!.baseRev).toBe(7);
    expect(h.edits[0]!.summary).toContain('moved');
  });

  test('a drag that ends where it began commits nothing', () => {
    const h = harness();
    SIDE(h);
    const at = screen(h.camera, CAM_A.position);
    h.canvas.fire('pointerdown', at);
    h.canvas.fire('pointermove', { clientX: at.clientX + 40, clientY: at.clientY });
    h.canvas.fire('pointermove', at);
    h.canvas.fire('pointerup', at);
    expect(h.edits).toEqual([]);
  });

  test('a move released over a wall lands back on navigable floor', () => {
    const h = harness();
    look(h.camera, new THREE.Vector3(4, 12, 4.01), new THREE.Vector3(4, 0, 4), new THREE.Vector3(0, 0, -1));
    const at = screen(h.camera, CAM_A.position);
    // Drag the camera far west, out of the flat.
    drag(h, at, { clientX: 5, clientY: at.clientY });
    expect(h.edits).toHaveLength(1);
    expect(canStand(plan, h.edits[0]!.checkpoints[0]!.position)).toBe(true);
  });

  test('the height arrow above the body lifts, relative to the grab, clamped under the ceiling', () => {
    const h = harness();
    SIDE(h);
    h.overlay.setActive(CAM.a);
    const view = viewOf(h.camera, h.canvas as unknown as HTMLCanvasElement)!;
    const [base, tip] = activeShapes(CAM_A, view, ORBIT_HANDLES).height!;
    const grab = { clientX: (base.x + tip.x) / 2, clientY: (base.y + tip.y) / 2 };
    // The arrow's grab point is clear of the body: the body outranks it inside its own grace.
    drag(h, grab, { clientX: grab.clientX, clientY: grab.clientY - 30 });
    expect(h.edits).toHaveLength(1);
    const lifted = h.edits[0]!.checkpoints[0]!;
    expect(lifted.position.y).toBeGreaterThan(CAM_A.position.y);
    expect(lifted.position.y - CAM_A.position.y).toBeLessThan(1);
    expect(h.edits[0]!.summary).toContain('re-heighted');
    // Far up, from the committed pose again: the clamp answers, not the pointer.
    h.reload();
    drag(h, grab, { clientX: grab.clientX, clientY: -4000 });
    expect(h.edits[1]!.checkpoints[0]!.position.y).toBeCloseTo(lShapePlan.ceilingHeight - 0.2, 9);
  });

  test('a 90° sweep of the floor ring turns the camera 90°, whatever the grab point', () => {
    for (const start of [0, 2]) {
      const h = harness();
      look(h.camera, new THREE.Vector3(2, 9, 3.001), new THREE.Vector3(2, 0, 3), new THREE.Vector3(0, 0, -1));
      h.overlay.setActive(CAM.a);
      const view = viewOf(h.camera, h.canvas as unknown as HTMLCanvasElement)!;
      const radius = 80 * view.metresPerPixel({ x: 2, y: 0, z: 3 });
      const around = (angle: number): { clientX: number; clientY: number } =>
        screen(h.camera, { x: 2 + Math.sin(angle) * radius, y: 0, z: 3 + Math.cos(angle) * radius });
      h.canvas.fire('pointerdown', around(start));
      for (let step = 1; step <= 6; step += 1) h.canvas.fire('pointermove', around(start + (step / 6) * (Math.PI / 2)));
      h.canvas.fire('pointerup', around(start + Math.PI / 2));
      expect(h.edits).toHaveLength(1);
      expect(h.edits[0]!.checkpoints[0]!.yaw).toBeCloseTo(CAM_A.yaw + Math.PI / 2, 3);
      expect(h.edits[0]!.summary).toContain('re-aimed');
    }
  });

  test('Shift snaps the ring to 15°', () => {
    const h = harness();
    look(h.camera, new THREE.Vector3(2, 9, 3.001), new THREE.Vector3(2, 0, 3), new THREE.Vector3(0, 0, -1));
    h.overlay.setActive(CAM.a);
    const view = viewOf(h.camera, h.canvas as unknown as HTMLCanvasElement)!;
    const radius = 80 * view.metresPerPixel({ x: 2, y: 0, z: 3 });
    const around = (angle: number): { clientX: number; clientY: number } =>
      screen(h.camera, { x: 2 + Math.sin(angle) * radius, y: 0, z: 3 + Math.cos(angle) * radius });
    h.canvas.fire('pointerdown', around(0));
    h.canvas.fire('pointermove', { ...around(0.33), shiftKey: true });
    h.canvas.fire('pointerup', around(0.33));
    const yaw = h.edits[0]!.checkpoints[0]!.yaw;
    expect(yaw / ((15 / 180) * Math.PI)).toBeCloseTo(Math.round(yaw / ((15 / 180) * Math.PI)), 9);
  });

  test('a pointer cancel reverts the working copy; the focus survives', () => {
    const h = harness();
    SIDE(h);
    const at = screen(h.camera, CAM_A.position);
    h.canvas.fire('pointerdown', at);
    h.canvas.fire('pointermove', { clientX: at.clientX + 80, clientY: at.clientY });
    h.canvas.fire('pointercancel', {});
    expect(h.edits).toEqual([]);
    expect(h.overlay.activeCheckpoint()?.position).toEqual(CAM_A.position);
  });

  test('a scene rebuild resets the working copy to the committed document', () => {
    const h = harness();
    SIDE(h);
    const at = screen(h.camera, CAM_A.position);
    drag(h, at, { clientX: at.clientX + 80, clientY: at.clientY });
    h.reload();
    expect(h.overlay.activeCheckpoint()?.position).toEqual(CAM_A.position);
    expect(h.overlay.group.children.filter((child) => child.userData['checkpointId'])).toHaveLength(2);
  });
});

describe('keyboard nudges', () => {
  test('arrows move relative to the view; a burst commits once after the idle', () => {
    const h = harness();
    // Author looks along +Z: «up» moves the camera toward +Z.
    look(h.camera, new THREE.Vector3(2, 3, -2), new THREE.Vector3(2, 1, 3));
    h.overlay.setActive(CAM.a);
    for (let press = 0; press < 3; press += 1) expect(h.keys.fire('keydown', { key: 'ArrowUp' }).stopped).toBe(true);
    h.keys.fire('keydown', { key: 'PageUp' });
    h.keys.fire('keydown', { key: 'q' });
    expect(h.edits).toEqual([]);
    expect(h.timer.pending()).toBe(true);
    h.timer.fire();
    expect(h.edits).toHaveLength(1);
    const nudged = h.edits[0]!.checkpoints[0]!;
    expect(nudged.position.z).toBeCloseTo(CAM_A.position.z + 0.3, 9);
    expect(nudged.position.x).toBeCloseTo(CAM_A.position.x, 9);
    expect(nudged.position.y).toBeCloseTo(CAM_A.position.y + 0.1, 9);
    expect(nudged.yaw).toBeCloseTo((5 / 180) * Math.PI, 9);
  });

  test('keys do nothing without an active camera, and nothing from a text field', () => {
    const h = harness();
    expect(h.keys.fire('keydown', { key: 'ArrowUp' }).stopped).toBe(false);
    h.overlay.setActive(CAM.a);
    const field = { matches: (selector: string) => selector.includes('input') };
    expect(h.keys.fire('keydown', { key: 'ArrowUp', composedPath: () => [field] }).stopped).toBe(false);
    expect(h.timer.pending()).toBe(false);
  });

  test('Delete removes the active camera in one commit', () => {
    const h = harness();
    h.overlay.setActive(CAM.b);
    h.keys.fire('keydown', { key: 'Delete' });
    expect(h.edits.map((edit) => edit.checkpoints.map((checkpoint) => checkpoint.id))).toEqual([[CAM.a]]);
    expect(h.overlay.activeCheckpoint()).toBeNull();
  });
});

describe('placing', () => {
  test('click-to-place drops ONE camera on navigable floor at eye height, level, then ends', () => {
    const h = harness([]);
    look(h.camera, new THREE.Vector3(4, 12, 4.01), new THREE.Vector3(4, 0, 4), new THREE.Vector3(0, 0, -1));
    expect(h.overlay.startPlacing(CAM.added)).toBe(true);
    expect(h.placing).toEqual([true]);
    // Click the partition wall (x = 6), clear of its door.
    const wall = screen(h.camera, { x: 6, y: 0, z: 1 });
    expect(h.canvas.fire('pointerdown', wall).stopped).toBe(true);
    h.canvas.fire('pointerup', wall);
    expect(h.placing).toEqual([true, false]);
    expect(h.overlay.placing()).toBe(false);
    const placed = h.edits[0]!.checkpoints[0]!;
    expect(canStand(plan, placed.position)).toBe(true);
    expect(placed.position.y).toBe(EYE_HEIGHT_M);
    expect(placed.pitch).toBe(LEVEL_PITCH_RAD);
    expect(placed.id).toBe(CAM.added);
    expect(h.overlay.activeCheckpoint()?.id).toBe(CAM.added);
  });

  test('click-and-drag aims the new camera at the release point', () => {
    const h = harness([]);
    look(h.camera, new THREE.Vector3(4, 12, 4.01), new THREE.Vector3(4, 0, 4), new THREE.Vector3(0, 0, -1));
    h.overlay.startPlacing(CAM.added);
    h.canvas.fire('pointerdown', screen(h.camera, { x: 3, y: 0, z: 3 }));
    h.canvas.fire('pointerup', screen(h.camera, { x: 5, y: 0, z: 3 }));
    expect(h.edits[0]!.checkpoints[0]!.yaw).toBeCloseTo(Math.PI / 2, 2);
  });

  test('Esc and a mode change cancel placing; placing needs a select mode (orbit or plan3d)', () => {
    const h = harness();
    h.overlay.startPlacing(CAM.added);
    h.keys.fire('keydown', { key: 'Escape' });
    expect(h.overlay.placing()).toBe(false);
    h.overlay.startPlacing(CAM.added);
    h.overlay.setMode('walk');
    expect(h.overlay.placing()).toBe(false);
    h.world.mode = 'walk';
    expect(h.overlay.startPlacing(CAM.added)).toBe(false);
    h.world.mode = 'plan2d';
    expect(h.overlay.startPlacing(CAM.added)).toBe(false);
    expect(h.edits).toEqual([]);
  });

  test('«Add from current view» in orbit stands on the floor at eye height, level, and frames when off-screen', () => {
    const h = harness([]);
    // Looking at the partition wall from the south, like the reset view.
    look(h.camera, new THREE.Vector3(6, 9, 14), new THREE.Vector3(6, 0, 1));
    expect(h.overlay.addCheckpoint(CAM.added)).toBe(true);
    const placed = h.edits[0]!.checkpoints[0]!;
    expect(canStand(plan, placed.position)).toBe(true);
    expect(placed.position.y).toBe(EYE_HEIGHT_M);
    expect(placed.pitch).toBe(LEVEL_PITCH_RAD);
    expect(h.selections).toEqual([placed.id]);
  });

  test('«Add from current view» in walk copies the eye exactly', () => {
    const h = harness([]);
    h.world.mode = 'walk';
    look(h.camera, new THREE.Vector3(3, 1.5, 3), new THREE.Vector3(3, 1.5, 7));
    h.overlay.addCheckpoint(CAM.added);
    const placed = h.edits[0]!.checkpoints[0]!;
    expect(placed.position).toEqual({ x: 3, y: 1.5, z: 3 });
    expect(placed.yaw).toBeCloseTo(0, 9);
    expect(placed.pitch).toBeCloseTo(0, 9);
  });

  test('a refused add is dropped by revert, and the next add builds on the committed list', () => {
    const h = harness([CAM_A]);
    look(h.camera, new THREE.Vector3(3, 6, 12), new THREE.Vector3(3, 0, 3));
    h.overlay.addCheckpoint(CAM.added);
    expect(h.overlay.activeCheckpoint()?.id).toBe(CAM.added);
    h.overlay.revert();
    expect(h.overlay.activeCheckpoint()).toBeNull();
    h.overlay.addCheckpoint(CAM.added);
    expect(h.edits[1]!.checkpoints.map((checkpoint) => checkpoint.id)).toEqual([CAM.a, CAM.added]);
  });

  test('a new camera takes the id its caller hands over; without a fresh UUID v7 nothing is created', () => {
    const h = harness([CAM_A]);
    look(h.camera, new THREE.Vector3(3, 6, 12), new THREE.Vector3(3, 0, 3));
    // A room's or a wall's UUID is as taken as another camera's: `set_tour_checkpoints` would refuse it.
    const otherEntities = [lShapePlan.rooms[0]!.id, lShapePlan.walls[0]!.id];
    for (const id of ['', 'cam-1', CAM.a, CAM.added.toUpperCase(), '01a12fe5-7e49-4d1e-ba95-a5d70c4dd6bf', ...otherEntities]) {
      expect(h.overlay.addCheckpoint(id)).toBe(false);
      expect(h.overlay.startPlacing(id)).toBe(false);
    }
    expect(h.overlay.placing()).toBe(false);
    expect(h.edits).toEqual([]);
  });

  test('a committed camera the working list dropped may hand its id to a new one, as the op allows', () => {
    const h = harness([CAM_A]);
    look(h.camera, new THREE.Vector3(3, 6, 12), new THREE.Vector3(3, 0, 3));
    h.overlay.remove(CAM.a);
    expect(h.overlay.addCheckpoint(CAM.a)).toBe(true);
    expect(h.edits.at(-1)!.checkpoints.map((checkpoint) => checkpoint.id)).toEqual([CAM.a]);
  });

  test('the drop takes the id of the latest startPlacing call', () => {
    const h = harness([]);
    look(h.camera, new THREE.Vector3(4, 12, 4.01), new THREE.Vector3(4, 0, 4), new THREE.Vector3(0, 0, -1));
    expect(h.overlay.startPlacing(CAM.added)).toBe(true);
    expect(h.overlay.startPlacing(CAM.addedNext)).toBe(true);
    expect(h.placing).toEqual([true]);
    const at = screen(h.camera, { x: 3, y: 0, z: 3 });
    h.canvas.fire('pointerdown', at);
    h.canvas.fire('pointerup', at);
    expect(h.edits.map((edit) => edit.checkpoints.map((checkpoint) => checkpoint.id))).toEqual([[CAM.addedNext]]);
  });

  test('setCheckpointFromView keeps the id and the name, replaces the pose', () => {
    const h = harness([{ ...CAM_A, name: 'Hall' }]);
    h.world.mode = 'walk';
    look(h.camera, new THREE.Vector3(3, 1.5, 3), new THREE.Vector3(7, 1.5, 3));
    expect(h.overlay.setCheckpointFromView(CAM.a)).toBe(true);
    expect(h.edits[0]!.checkpoints[0]).toMatchObject({ id: CAM.a, name: 'Hall', position: { x: 3, y: 1.5, z: 3 } });
    expect(h.edits[0]!.checkpoints[0]!.yaw).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('the rest of the surface', () => {
  test('setEnabled(false) drops the focus and the placing state, and hides the group', () => {
    const h = harness();
    h.overlay.setActive(CAM.a);
    h.overlay.startPlacing(CAM.added);
    h.selections.length = 0;
    h.overlay.setEnabled(false);
    expect(h.overlay.group.visible).toBe(false);
    expect(h.selections).toEqual([null]);
    expect(h.overlay.placing()).toBe(false);
  });

  test('hideForPreview hides the whole rig and answers the restore', () => {
    const h = harness();
    const restore = h.overlay.hideForPreview();
    expect(h.overlay.group.visible).toBe(false);
    restore!();
    expect(h.overlay.group.visible).toBe(true);
  });

  test('applyPose commits once, and not at all when nothing changed', () => {
    const h = harness();
    expect(h.overlay.applyPose(CAM.a, { position: CAM_A.position, yaw: CAM_A.yaw, pitch: CAM_A.pitch }, 'same')).toBe(true);
    expect(h.edits).toEqual([]);
    h.overlay.applyPose(CAM.a, { position: CAM_A.position, yaw: 0.5, pitch: -0.2 }, `Camera ${CAM.a} looked through`, 3);
    expect(h.edits).toHaveLength(1);
    expect(h.edits[0]!.baseRev).toBe(3);
  });
});

describe('the pitch slider', () => {
  test('stands upright on screen beside the body, the length of the height arrow', () => {
    const h = harness();
    SIDE(h);
    const view = viewOf(h.camera, h.canvas as unknown as HTMLCanvasElement)!;
    const shapes = activeShapes(CAM_A, view, ORBIT_HANDLES);
    const [top, bottom] = shapes.pitch!;
    const body = shapes.body!;
    expect(Math.abs(top.x - bottom.x)).toBeLessThan(0.5);
    expect(bottom.y - top.y).toBeCloseTo(56, 0);
    expect(top.x).toBeGreaterThan(body.at.x + body.radius + 10);
    expect((top.y + bottom.y) / 2).toBeCloseTo(body.at.y, 0);
  });

  test('a drag up the slider tilts the camera up 0.25° a pixel and commits once; the frustum follows live', () => {
    const h = harness();
    SIDE(h);
    h.overlay.setActive(CAM.a);
    const view = viewOf(h.camera, h.canvas as unknown as HTMLCanvasElement)!;
    const [top, bottom] = activeShapes(CAM_A, view, ORBIT_HANDLES).pitch!;
    const grab = { clientX: top.x, clientY: (top.y + bottom.y) / 2 };
    h.canvas.fire('pointerdown', grab);
    expect(h.canvas.style['cursor']).toBe('ns-resize');
    h.canvas.fire('pointermove', { clientX: grab.clientX, clientY: grab.clientY - 40 });
    expect(h.overlay.activeCheckpoint()!.pitch).toBeCloseTo((10 / 180) * Math.PI, 9);
    expect(h.edits).toEqual([]);
    h.canvas.fire('pointerup', { clientX: grab.clientX, clientY: grab.clientY - 40 });
    expect(h.edits).toHaveLength(1);
    expect(h.edits[0]!.checkpoints[0]!.pitch).toBeCloseTo((10 / 180) * Math.PI, 9);
    expect(h.edits[0]!.checkpoints[0]!.position).toEqual(CAM_A.position);
    expect(h.edits[0]!.summary).toContain('tilted');
  });
});

describe('picking on the 3D plan', () => {
  function onPlan(): Harness {
    const h = harness();
    h.world.mode = 'plan3d';
    h.overlay.setMode('plan3d');
    return h;
  }

  test('a press on a marker selects it through the TOP view, and neither the press nor the release reaches the scene selection', () => {
    const h = onPlan();
    // The perspective rig looks somewhere else entirely: a ray through it would miss.
    look(h.camera, new THREE.Vector3(30, 12, 30), new THREE.Vector3(0, 0, 0));
    const at = screen(h.top, CAM_B.position);
    expect(h.canvas.fire('pointerdown', at).stopped).toBe(true);
    expect(h.canvas.fire('pointerup', at).stopped).toBe(true);
    expect(h.selections).toEqual([CAM.b]);
    expect(h.edits).toEqual([]);
  });

  test('a move drag follows the pointer on the plan; a press on empty floor clears the focus', () => {
    const h = onPlan();
    const at = screen(h.top, CAM_A.position);
    // 50 px right on a 16 m / 800 px top view: one metre east.
    drag(h, at, { clientX: at.clientX + 50, clientY: at.clientY });
    expect(h.edits).toHaveLength(1);
    const moved = h.edits[0]!.checkpoints[0]!;
    expect(moved.position.x).toBeCloseTo(CAM_A.position.x + 1, 1);
    expect(moved.position.z).toBeCloseTo(CAM_A.position.z, 1);
    const empty = screen(h.top, { x: 8, y: 0, z: 7.5 });
    drag(h, empty);
    expect(h.overlay.activeCheckpoint()).toBeNull();
  });

  test('the ring turns the camera; the height arrow and the pitch slider are not offered, and their places do not lift or tilt', () => {
    const h = onPlan();
    h.overlay.setActive(CAM.a);
    const view = viewOf(h.top, h.canvas as unknown as HTMLCanvasElement)!;
    const shapes = activeShapes(CAM_A, view, new Set<HandleKind>(['move', 'yaw']));
    expect(shapes.height).toBeNull();
    expect(shapes.pitch).toBeNull();
    // Where orbit would put the slider: right of the body on screen.
    const orbitShapes = activeShapes(CAM_A, view, ORBIT_HANDLES);
    const [top] = orbitShapes.pitch!;
    drag(h, { clientX: top.x, clientY: top.y }, { clientX: top.x, clientY: top.y - 40 });
    for (const edit of h.edits) {
      expect(edit.checkpoints[0]!.pitch).toBe(CAM_A.pitch);
      expect(edit.checkpoints[0]!.position.y).toBe(CAM_A.position.y);
    }
    // The ring, 80 px around the footprint: a quarter sweep is a quarter turn.
    const radius = 80 * view.metresPerPixel({ x: 2, y: 0, z: 3 });
    const around = (angle: number): { clientX: number; clientY: number } =>
      screen(h.top, { x: 2 + Math.sin(angle) * radius, y: 0, z: 3 + Math.cos(angle) * radius });
    h.edits.length = 0;
    h.canvas.fire('pointerdown', around(0));
    for (let step = 1; step <= 6; step += 1) h.canvas.fire('pointermove', around((step / 6) * (Math.PI / 2)));
    h.canvas.fire('pointerup', around(Math.PI / 2));
    expect(h.edits).toHaveLength(1);
    expect(h.edits[0]!.checkpoints[0]!.yaw).toBeCloseTo(CAM_A.yaw + Math.PI / 2, 3);
  });

  test('click-to-place drops a camera where the TOP view points', () => {
    const h = onPlan();
    expect(h.overlay.startPlacing(CAM.added)).toBe(true);
    const at = screen(h.top, { x: 3, y: 0, z: 5.5 });
    drag(h, at);
    expect(h.edits).toHaveLength(1);
    const placed = h.edits[0]!.checkpoints.at(-1)!;
    expect(placed.position.x).toBeCloseTo(3, 1);
    expect(placed.position.z).toBeCloseTo(5.5, 1);
  });
});

describe('redraw requests: the editing modes draw on demand, so every visible change of the rig asks for a frame', () => {
  /** Runs `change` and answers whether it asked for a redraw. */
  function asks(h: Harness, change: () => void): boolean {
    const before = h.changes.count;
    change();
    return h.changes.count > before;
  }

  test('a scene, the switch, focus, a revert, a remove and a settle each ask', () => {
    const h = harness();
    SIDE(h);
    expect(asks(h, () => h.reload())).toBe(true);
    expect(asks(h, () => h.overlay.setActive(CAM.a))).toBe(true);
    expect(asks(h, () => h.overlay.setActive(CAM.a))).toBe(false);
    expect(asks(h, () => h.overlay.revert())).toBe(true);
    expect(asks(h, () => h.overlay.settle(CAM.a))).toBe(true);
    expect(asks(h, () => h.overlay.setEnabled(false))).toBe(true);
    expect(asks(h, () => h.overlay.setEnabled(true))).toBe(true);
    expect(asks(h, () => h.overlay.remove(CAM.b))).toBe(true);
  });

  test('a working change asks, and so does the deferred tube rebuild it leads to', () => {
    const h = harness();
    h.overlay.working(CAM.a)!.position.x += 0.5;
    expect(asks(h, () => h.overlay.changed(CAM.a))).toBe(true);
    expect(asks(h, () => h.overlay.flush())).toBe(true);
    expect(asks(h, () => h.overlay.flush())).toBe(false);
  });

  test('hover asks only when what is hovered changes; the invalid tint asks only when it moves', () => {
    const h = harness();
    expect(asks(h, () => h.overlay.hover({ id: CAM.a, kind: 'move' }))).toBe(true);
    expect(asks(h, () => h.overlay.hover({ id: CAM.a, kind: 'move' }))).toBe(false);
    expect(asks(h, () => h.overlay.hover(null))).toBe(true);
    expect(asks(h, () => h.overlay.setInvalid(CAM.a))).toBe(true);
    expect(asks(h, () => h.overlay.setInvalid(CAM.a))).toBe(false);
    expect(asks(h, () => h.overlay.setInvalid(null))).toBe(true);
  });

  test('the placement ghost asks as it follows the floor and when placing ends', () => {
    const h = harness([]);
    look(h.camera, new THREE.Vector3(4, 12, 4.01), new THREE.Vector3(4, 0, 4), new THREE.Vector3(0, 0, -1));
    h.overlay.startPlacing(CAM.added);
    expect(asks(h, () => h.overlay.ghost({ x: 2, z: 2 }, null, true))).toBe(true);
    expect(asks(h, () => h.overlay.ghost(null, null, true))).toBe(true);
    expect(asks(h, () => h.overlay.cancelPlacing())).toBe(true);
    expect(asks(h, () => h.overlay.cancelPlacing())).toBe(false);
  });

  test('a drag asks on every move, and a cancel asks for the reverted rig', () => {
    const h = harness();
    SIDE(h);
    const at = screen(h.camera, CAM_A.position);
    h.canvas.fire('pointerdown', at);
    expect(asks(h, () => h.canvas.fire('pointermove', { clientX: at.clientX + 40, clientY: at.clientY }))).toBe(true);
    expect(asks(h, () => h.canvas.fire('pointermove', { clientX: at.clientX + 80, clientY: at.clientY }))).toBe(true);
    expect(asks(h, () => h.canvas.fire('pointercancel', {}))).toBe(true);
  });
});
