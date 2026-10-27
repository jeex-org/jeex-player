/**
 * The asset move tool's state machine with fake rays: a pointer at client
 * pixel `(x, y)` is the ray through the plan point `(x / 100, y / 100)` —
 * straight down like the plan's top view
 * (`plan3d`), or slanted like the orbit rig (`orbit`). The tool only ever
 * intersects rays with planes, so both are exact, and every verdict is checked
 * against the layout judge it uses.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import { solvePlan } from '../plan/plan-solver.js';
import { dragContext, judge, poseItem, wallPose, type DragPose } from '../layout/asset-legality.js';
import { mask, type LegalityMask } from '../layout/asset-mask.js';
import { proposePose } from '../layout/asset-pose.js';
import { pointInPolygon } from '../plan/plan-geometry.js';
import { nearestFace } from '../layout/rules/context.js';
import {
  AssetMoveTool,
  HEIGHT_M_PER_PX,
  TURN_STEP_DEG,
  type AssetEdit,
  type AssetEditRefused,
  type AssetHandle,
  type AssetMoveHost,
  type PointerSample,
} from './asset-move-tool.js';
import type { Scheduler } from './drag-kit.js';
import type { DemoAsset, SceneData, SceneOp } from '../scene/types.js';

const plan = solvePlan(apartmentScene);
const PX = 100;

type Rig = 'plan3d' | 'orbit';

/** A recording host over the demo flat. */
class FakeHost implements AssetMoveHost {
  rig: Rig = 'plan3d';
  armed = true;
  selection: string | null = DEMO.asset.livingSofa;
  scene: SceneData = apartmentScene;
  rev = 7;
  shown: Array<{ id: string; pose: DragPose }> = [];
  tints: Array<'ok' | 'bad' | null> = [];
  masks: Array<LegalityMask | null> = [];
  edits: AssetEdit[] = [];
  refusals: AssetEditRefused[] = [];
  moving: boolean[] = [];
  /** The handle under every press, as the drawn gizmo would answer it. */
  handle: AssetHandle | null = null;

  active(): boolean {
    return this.armed;
  }
  selected(): string | null {
    return this.selection;
  }
  pickAsset(clientX: number, clientY: number): string | null {
    // Whatever stands within half a metre of the pointer's plan point.
    const point = { x: clientX / PX, z: clientY / PX };
    const near = this.scene.assets.filter((asset) => Math.hypot(asset.position.x - point.x, asset.position.z - point.z) < 0.5);
    // A pendant over a table, a mirror over a console: the selected one is on top when it is there at all.
    return (near.find((asset) => asset.id === this.selection) ?? near[0])?.id ?? null;
  }
  ray(clientX: number, clientY: number): THREE.Ray {
    const target = new THREE.Vector3(clientX / PX, 0, clientY / PX);
    if (this.rig === 'plan3d') return new THREE.Ray(target.clone().setY(30), new THREE.Vector3(0, -1, 0));
    const origin = target.clone().add(new THREE.Vector3(-3, 6, 4));
    return new THREE.Ray(origin, target.clone().sub(origin).normalize());
  }
  document(): { scene: SceneData; plan: typeof plan; rev: number } {
    return { scene: this.scene, plan, rev: this.rev };
  }
  bodyFacts(): null {
    return null;
  }
  show(id: string, pose: DragPose): void {
    this.shown.push({ id, pose });
  }
  tint(state: 'ok' | 'bad' | null): void {
    this.tints.push(state);
  }
  drawMask(field: LegalityMask | null): void {
    this.masks.push(field);
  }
  viewYaw(): number {
    return 0;
  }
  onEdit(edit: AssetEdit): void {
    this.edits.push(edit);
  }
  onRefused(refusal: AssetEditRefused): void {
    this.refusals.push(refusal);
  }
  onMoving(moving: boolean): void {
    this.moving.push(moving);
  }
  handleAt(): AssetHandle | null {
    return this.handle;
  }
  last(): DragPose {
    return this.shown.at(-1)!.pose;
  }
}

/** A key-burst timer the test fires by hand. */
function manualScheduler(): { schedule: Scheduler; fire: () => void } {
  let pending: (() => void) | null = null;
  return {
    schedule: (run) => {
      pending = run;
      return () => {
        pending = null;
      };
    },
    fire: () => pending?.(),
  };
}

function at(x: number, z: number, shiftKey = false): PointerSample {
  return { clientX: x * PX, clientY: z * PX, pointerId: 1, shiftKey };
}

function placement(id: string) {
  return apartmentScene.assets.find((asset) => asset.id === id)!;
}

/**
 * A legal spot for `id` at least `away` metres from where it stands, in its own
 * room, read off its own mask: the drags here stay inside the room they start in.
 */
function legalSpot(id: string, away: number, surface: 'floor' | 'ceiling', turnedBy = 0): { x: number; z: number } {
  const context = dragContext(apartmentScene, plan, id)!;
  const home = placement(id);
  const room = plan.rooms.find((candidate) => candidate.roomId === home.room)!;
  const item = poseItem(context, { position: home.position, rotationY: home.rotationY ?? 0 });
  const field = mask(context, item, surface);
  for (let cell = 0; cell < field.count; cell += 1) {
    if (field.ok[cell] !== 1) continue;
    const x = field.positions[cell * 12]! + field.step / 2;
    const z = field.positions[cell * 12 + 2]! + field.step / 2;
    if (Math.hypot(x - home.position.x, z - home.position.z) < away) continue;
    if (!pointInPolygon({ x, z }, room.polygon)) continue;
    // The field is stored in float32; a cell on the edge of a touch can read differently at full precision.
    const pose = { position: { x, y: home.position.y, z }, rotationY: home.rotationY ?? 0 };
    const turned = { ...pose, rotationY: pose.rotationY + turnedBy };
    // A drag ends through the tool's own pose function, wall snap included: a
    // spot the snap would carry into a neighbour is not one a drag can land on.
    const dropped = proposePose(context, { kind: 'plan', point: { x, z }, rotationY: pose.rotationY, y: home.position.y, snap: true });
    const stays = Math.hypot(dropped.snapped.pose.position.x - x, dropped.snapped.pose.position.z - z) < 0.01;
    if (stays && dropped.judgement.ok && judge(context.ctx, poseItem(context, pose)).ok && judge(context.ctx, poseItem(context, turned)).ok)
      return { x, z };
  }
  throw new Error(`no legal spot for ${id}`);
}

/** Press on the object, drag in a few steps, release. */
function drag(tool: AssetMoveTool, from: { x: number; z: number }, to: { x: number; z: number }, shiftKey = false): void {
  expect(tool.down(at(from.x, from.z))).toBe(true);
  for (let step = 1; step <= 4; step += 1) {
    const k = step / 4;
    tool.move(at(from.x + (to.x - from.x) * k, from.z + (to.z - from.z) * k, shiftKey));
  }
  tool.up(at(to.x, to.z));
}

let host: FakeHost;
let tool: AssetMoveTool;

beforeEach(() => {
  host = new FakeHost();
  tool = new AssetMoveTool(host);
});

describe('starting a move', () => {
  test('a press anywhere but on the selected object is not the tool’s', () => {
    const bed = placement(DEMO.asset.bedroomBed).position;
    expect(tool.down(at(bed.x, bed.z))).toBe(false);
    host.selection = null;
    const sofa = placement(DEMO.asset.livingSofa).position;
    expect(tool.down(at(sofa.x, sofa.z))).toBe(false);
    host.selection = DEMO.asset.livingSofa;
    host.armed = false;
    expect(tool.down(at(sofa.x, sofa.z))).toBe(false);
  });

  test('a press on it is claimed, and a release under 4 px is a click that moves nothing', () => {
    const sofa = placement(DEMO.asset.livingSofa).position;
    expect(tool.down(at(sofa.x, sofa.z))).toBe(true);
    expect(tool.state().phase).toBe('pressed');
    expect(tool.move({ ...at(sofa.x, sofa.z), clientX: sofa.x * PX + 3 })).toBe(true);
    expect(tool.state().phase).toBe('pressed');
    expect(tool.up(at(sofa.x, sofa.z))).toBe(true);
    expect(tool.state().phase).toBe('idle');
    expect(host.edits).toEqual([]);
    expect(host.shown).toEqual([]);
  });
});

describe('a floor drag', () => {
  for (const rig of ['plan3d', 'orbit'] as const) {
    test(`moves the sofa to a legal spot and emits move_object on the start revision (${rig})`, () => {
      host.rig = rig;
      const home = placement(DEMO.asset.livingSofa).position;
      const spot = legalSpot(DEMO.asset.livingSofa, 1, 'floor');
      // Precondition: the drop pose with the wall snap is the spot itself, so the
      // asserted position below is what the drag lands on, not a snapped one.
      const context = dragContext(apartmentScene, plan, DEMO.asset.livingSofa)!;
      const yaw = placement(DEMO.asset.livingSofa).rotationY ?? 0;
      const dropped = proposePose(context, { kind: 'plan', point: spot, rotationY: yaw, y: home.y, snap: true });
      expect(Math.hypot(dropped.snapped.pose.position.x - spot.x, dropped.snapped.pose.position.z - spot.z)).toBeLessThan(0.01);
      drag(tool, home, spot);
      expect(host.refusals).toEqual([]);
      expect(host.edits).toHaveLength(1);
      const edit = host.edits[0]!;
      expect(edit.assetId).toBe(DEMO.asset.livingSofa);
      expect(edit.baseRev).toBe(7);
      expect(edit.gesture).toBe('move');
      expect(edit.ops).toHaveLength(1);
      const op = edit.ops[0]!;
      if (op.op !== 'move_object') throw new Error('expected move_object');
      expect(op.position!.x).toBeCloseTo(spot.x, 6);
      expect(op.position!.z).toBeCloseTo(spot.z, 6);
      expect(typeof op.room).toBe('string');
      // The field was drawn while it dragged and cleared after; the object ends untinted on its new pose.
      expect(host.masks[0]!.count).toBeGreaterThan(1000);
      expect(host.masks.at(-1)).toBeNull();
      expect(host.tints.at(-1)).toBeNull();
      expect(host.last().position.x).toBeCloseTo(spot.x, 6);
      expect(host.moving).toEqual([true, false]);
      expect(tool.state().pending).toBe(DEMO.asset.livingSofa);
    });
  }

  test('a drag into a wall tints red, reverts and reports why', () => {
    const home = placement(DEMO.asset.livingSofa).position;
    drag(tool, home, { x: home.x - 20, z: home.z });
    expect(host.tints).toContain('bad');
    expect(host.edits).toEqual([]);
    expect(host.refusals).toHaveLength(1);
    expect(host.refusals[0]!.issues.map((issue) => issue.rule)).toContain('on-floor');
    expect(host.last().position).toEqual(home);
  });

  test('Q during a drag turns the object 15°, redraws the field and adds rotate_object', () => {
    host.selection = DEMO.asset.livingPendant;
    const home = placement(DEMO.asset.livingPendant);
    const turn = (15 / 180) * Math.PI;
    const spot = legalSpot(DEMO.asset.livingPendant, 0.8, 'ceiling', turn);
    expect(tool.down(at(home.position.x, home.position.z))).toBe(true);
    tool.move(at(spot.x, spot.z));
    const drawn = host.masks.length;
    expect(tool.key('q', false)).toBe(true);
    expect(host.masks.length).toBe(drawn + 1);
    tool.up(at(spot.x, spot.z));
    expect(host.refusals).toEqual([]);
    expect(host.edits[0]!.ops.map((op) => op.op)).toEqual(['move_object', 'rotate_object']);
    // A drag that also turned is still a move: the person moved it.
    expect(host.edits[0]!.gesture).toBe('move');
    const rotate = host.edits[0]!.ops[1]!;
    if (rotate.op !== 'rotate_object') throw new Error('expected rotate_object');
    expect(rotate.rotationY).toBeCloseTo((home.rotationY ?? 0) + turn, 6);
  });

  test('Escape cancels a running drag: the start pose comes back and nothing is emitted', () => {
    const home = placement(DEMO.asset.livingSofa).position;
    expect(tool.down(at(home.x, home.z))).toBe(true);
    tool.move(at(home.x + 1, home.z));
    expect(tool.key('Escape', false)).toBe(true);
    expect(host.last().position).toEqual(home);
    expect(host.edits).toEqual([]);
    expect(tool.state().phase).toBe('idle');
    expect(tool.key('Escape', false)).toBe(false);
  });

  test('a mode the tool does not serve ends the drag where it started', () => {
    const home = placement(DEMO.asset.livingSofa).position;
    expect(tool.down(at(home.x, home.z))).toBe(true);
    tool.move(at(home.x + 1, home.z));
    host.armed = false;
    tool.move(at(home.x + 1.2, home.z));
    expect(host.last().position).toEqual(home);
    expect(tool.state().phase).toBe('idle');
  });
});

describe('a wall slide', () => {
  test('a picture slides along its face at its height, facing the room, to a legal span', () => {
    host.selection = DEMO.asset.bedroomArt;
    const home = placement(DEMO.asset.bedroomArt);
    const context = dragContext(apartmentScene, plan, DEMO.asset.bedroomArt)!;
    const near = nearestFace(plan, DEMO.room.bedroom, { x: home.position.x, z: home.position.z })!;
    // The first legal span 0.2-0.6 m along the face, either way.
    const target = [0.2, -0.2, 0.3, -0.3, 0.4, -0.4, 0.6, -0.6]
      .map((dt) => wallPose(context, near.face, near.t + dt, home.position.y))
      .find((pose) => judge(context.ctx, poseItem(context, pose)).ok)!;
    expect(target).toBeDefined();
    expect(tool.down(at(home.position.x, home.position.z))).toBe(true);
    for (let step = 1; step <= 5; step += 1) {
      const k = step / 5;
      tool.move(
        at(home.position.x + (target.position.x - home.position.x) * k, home.position.z + (target.position.z - home.position.z) * k),
      );
    }
    tool.up(at(target.position.x, target.position.z));
    expect(host.refusals).toEqual([]);
    expect(host.edits).toHaveLength(1);
    const op = host.edits[0]!.ops[0]!;
    if (op.op !== 'move_object') throw new Error('expected move_object');
    expect(op.position!.x).toBeCloseTo(target.position.x, 4);
    expect(op.position!.z).toBeCloseTo(target.position.z, 4);
    expect(op.position!.y).toBeCloseTo(home.position.y, 6);
    // Facing its wall: the yaw is the face's (rule wall-facing), and it did not change on a straight face.
    expect(host.edits[0]!.ops.map((candidate) => candidate.op)).toEqual(['move_object']);
  });

  test('a slide across a doorway is refused: the mirror would hang across the opening', () => {
    host.selection = DEMO.asset.hallMirror;
    const home = placement(DEMO.asset.hallMirror).position;
    // Along the spine, west to the guest bedroom's door (centre x 9.00).
    drag(tool, home, { x: 9.0, z: home.z + 0.3 });
    expect(host.edits).toEqual([]);
    expect(host.refusals[0]!.issues.map((issue) => issue.rule)).toContain('wall-hung');
    expect(host.last().position).toEqual(home);
  });

  test('Shift drags the height instead, inside the wall', () => {
    host.selection = DEMO.asset.hallMirror;
    host.rig = 'orbit';
    const home = placement(DEMO.asset.hallMirror).position;
    expect(tool.down(at(home.x, home.z))).toBe(true);
    tool.move(at(home.x, home.z + 0.1, true));
    tool.move(at(home.x, home.z + 0.4, true));
    const pose = host.last();
    expect(pose.position.y).not.toBeCloseTo(home.y, 3);
    expect(pose.position.y).toBeLessThanOrEqual(apartmentScene.ceilingHeight);
    expect(pose.position.y).toBeGreaterThanOrEqual(0);
  });
});

describe('a ceiling move', () => {
  for (const rig of ['plan3d', 'orbit'] as const) {
    test(`the pendant moves under the ceiling and keeps its drop (${rig})`, () => {
      host.rig = rig;
      host.selection = DEMO.asset.livingPendant;
      const home = placement(DEMO.asset.livingPendant).position;
      const spot = legalSpot(DEMO.asset.livingPendant, 0.8, 'ceiling');
      drag(tool, home, spot);
      expect(host.edits).toHaveLength(1);
      const op = host.edits[0]!.ops[0]!;
      if (op.op !== 'move_object') throw new Error('expected move_object');
      expect(op.position!.y).toBe(home.y);
      expect(op.position!.x).toBeCloseTo(spot.x, 6);
      expect(op.position!.z).toBeCloseTo(spot.z, 6);
      expect(host.masks[0]!.count).toBeGreaterThan(100);
    });
  }

  test('into the loggia it is refused: no ceiling there', () => {
    host.selection = DEMO.asset.livingPendant;
    const home = placement(DEMO.asset.livingPendant).position;
    const loggia = plan.rooms.find((room) => room.roomId === DEMO.room.loggia)!;
    const centre = { x: (loggia.bbox.minX + loggia.bbox.maxX) / 2, z: (loggia.bbox.minZ + loggia.bbox.maxZ) / 2 };
    drag(tool, home, centre);
    expect(host.edits).toEqual([]);
    expect(host.refusals[0]!.issues.map((issue) => issue.rule)).toEqual(['ceiling-hung']);
  });
});

describe('keys and the host’s answer', () => {
  test('an arrow burst commits once, after the idle', () => {
    const timer = manualScheduler();
    tool = new AssetMoveTool(host, timer.schedule);
    host.selection = DEMO.asset.livingPendant;
    expect(tool.key('ArrowRight', false)).toBe(true);
    expect(tool.key('ArrowRight', false)).toBe(true);
    expect(tool.state().phase).toBe('nudging');
    expect(host.edits).toEqual([]);
    timer.fire();
    expect(host.edits).toHaveLength(1);
    expect(host.edits[0]!.gesture).toBe('move');
    const op = host.edits[0]!.ops[0]!;
    if (op.op !== 'move_object') throw new Error('expected move_object');
    expect(op.position!.x - placement(DEMO.asset.livingPendant).position.x).toBeCloseTo(-0.1, 6);
  });

  test('revertAssetEdit puts the start pose back on the same revision, and not after a new document', () => {
    const home = placement(DEMO.asset.livingSofa).position;
    drag(tool, home, legalSpot(DEMO.asset.livingSofa, 1, 'floor'));
    tool.revert();
    expect(host.last().position).toEqual(home);
    expect(tool.state().pending).toBeNull();

    drag(tool, home, legalSpot(DEMO.asset.livingSofa, 1, 'floor'));
    const shown = host.shown.length;
    tool.documentChanged();
    tool.revert();
    expect(host.shown.length).toBe(shown);
  });

  test('the Move toggle moves the selected object to the next press, wherever it lands', () => {
    const spot = legalSpot(DEMO.asset.livingSofa, 1, 'floor');
    tool.arm();
    expect(tool.down(at(spot.x, spot.z))).toBe(true);
    expect(tool.state().phase).toBe('dragging');
    tool.up(at(spot.x, spot.z));
    expect(host.edits).toHaveLength(1);
    const op = host.edits[0]!.ops[0]!;
    if (op.op !== 'move_object') throw new Error('expected move_object');
    expect(op.position!.x).toBeCloseTo(spot.x, 6);
  });

  test('a disarmed Move toggle does not move the object on a later press', () => {
    const spot = legalSpot(DEMO.asset.livingSofa, 1, 'floor');
    tool.arm();
    tool.disarm();
    expect(tool.down(at(spot.x, spot.z))).toBe(false);
    expect(tool.state().phase).toBe('idle');
  });

  test('a wall nudge pushed past the end of its face comes back on the first press the other way', () => {
    const timer = manualScheduler();
    tool = new AssetMoveTool(host, timer.schedule);
    host.selection = DEMO.asset.bedroomArt;
    // Ten long nudges run the picture into a corner it cannot pass.
    for (let press = 0; press < 10; press += 1) tool.key('ArrowRight', true);
    const corner = host.last().position;
    expect(tool.key('ArrowLeft', false)).toBe(true);
    const back = host.last().position;
    // The request stops where the picture's width still lies on the face, so the press back moves at
    // once; what is drawn is the settled pose, so the step on screen is up to 5 cm.
    const step = Math.hypot(back.x - corner.x, back.z - corner.z);
    expect(step).toBeGreaterThan(0.01);
    expect(step).toBeLessThanOrEqual(0.05 + 1e-9);
  });
});

describe('what is drawn is what is committed', () => {
  test('a release commits exactly the pose drawn last, settled or not', () => {
    host.selection = DEMO.asset.bedroomNightstandA;
    const home = placement(DEMO.asset.bedroomNightstandA).position;
    const bed = placement(DEMO.asset.bedroomBed).position;
    const towards = { x: bed.x - home.x, z: bed.z - home.z };
    const length = Math.hypot(towards.x, towards.z);
    // 15 cm into the bed: illegal under the pointer, settled clear of it.
    const target = { x: home.x + (towards.x / length) * 0.15, z: home.z + (towards.z / length) * 0.15 };
    let drawnLast: DragPose | null = null;
    expect(tool.down(at(home.x, home.z))).toBe(true);
    for (let step = 1; step <= 4; step += 1)
      tool.move(at(home.x + (target.x - home.x) * (step / 4), home.z + (target.z - home.z) * (step / 4)));
    drawnLast = host.shown.filter((entry) => entry.id === DEMO.asset.bedroomNightstandA).at(-1)!.pose;
    expect(tool.state().legal).toBe(true);
    expect(host.tints.at(-1)).toBe('ok');
    // The ghost is not under the pointer: it stands where the release will put it.
    expect(Math.hypot(drawnLast.position.x - target.x, drawnLast.position.z - target.z)).toBeGreaterThan(0.01);
    tool.up(at(target.x, target.z));
    const op = host.edits[0]!.ops[0]!;
    if (op.op !== 'move_object') throw new Error('expected move_object');
    expect(op.position).toEqual(drawnLast.position);
  });

  test('a release on red with no legal pose in reach reverts and refuses', () => {
    const home = placement(DEMO.asset.livingSofa).position;
    expect(tool.down(at(home.x, home.z))).toBe(true);
    tool.move(at(home.x - 10, home.z));
    tool.move(at(home.x - 20, home.z));
    expect(tool.state().legal).toBe(false);
    expect(host.tints.at(-1)).toBe('bad');
    tool.up(at(home.x - 20, home.z));
    expect(host.edits).toEqual([]);
    expect(host.refusals).toHaveLength(1);
    expect(host.last().position).toEqual(home);
  });

  test('a host dragged across the room carries the lamp on its top in the same edit', () => {
    host.selection = DEMO.asset.bedroomNightstandA;
    const home = placement(DEMO.asset.bedroomNightstandA);
    const lamp = placement(DEMO.asset.bedroomLampA);
    // A turn at rest is the simplest move that keeps the nightstand legal by its bed: Q, then the idle.
    const timer = manualScheduler();
    tool = new AssetMoveTool(host, timer.schedule);
    expect(tool.key('q', false)).toBe(true);
    timer.fire();
    expect(host.refusals).toEqual([]);
    const edit = host.edits[0]!;
    // Q alone at rest is a turn, even though the turn moved what stands on top.
    expect(edit.gesture).toBe('turn');
    expect(edit.carried).toEqual([DEMO.asset.bedroomLampA]);
    const about = (op: SceneOp): string | null => (op.op === 'move_object' || op.op === 'rotate_object' ? op.assetId : null);
    expect(edit.ops.filter((op) => about(op) === DEMO.asset.bedroomLampA).map((op) => op.op)).toEqual(['move_object', 'rotate_object']);
    const rotate = edit.ops.find((op) => op.op === 'rotate_object' && op.assetId === DEMO.asset.bedroomLampA);
    if (rotate?.op !== 'rotate_object') throw new Error('expected rotate_object');
    expect(rotate.rotationY).toBeCloseTo((lamp.rotationY ?? 0) + Math.PI / 12, 6);
    // Both bodies came back on screen when the host refused it.
    tool.revert();
    expect(host.shown.filter((entry) => entry.id === DEMO.asset.bedroomLampA).at(-1)!.pose.position).toEqual(lamp.position);
    expect(host.shown.filter((entry) => entry.id === home.id).at(-1)!.pose.position).toEqual(home.position);
  });
});

describe('turning', () => {
  test('turnAsset turns 15° a step, settles, and emits rotate_object', () => {
    host.selection = null;
    const home = placement(DEMO.asset.livingChairA);
    expect(tool.turnAsset(DEMO.asset.livingChairA, 1)).toBe(true);
    const rotate = host.edits[0]!.ops.find((op) => op.op === 'rotate_object')!;
    if (rotate.op !== 'rotate_object') throw new Error('expected rotate_object');
    expect(rotate.rotationY).toBeCloseTo((home.rotationY ?? 0) + Math.PI / 12, 6);
    expect(host.edits[0]!.gesture).toBe('turn');
    expect(host.moving).toEqual([]);
  });

  test('a key burst with an arrow in it is a move, whatever turns it carries', () => {
    const timer = manualScheduler();
    tool = new AssetMoveTool(host, timer.schedule);
    host.selection = DEMO.asset.livingPendant;
    expect(tool.key('q', false)).toBe(true);
    expect(tool.key('ArrowRight', false)).toBe(true);
    timer.fire();
    expect(host.edits.map((edit) => edit.gesture)).toEqual(['move']);
  });

  test('a turn that does not fit is refused with the issue; the object keeps its yaw', () => {
    // A quarter turn swings the study desk into its wall and its chair.
    expect(tool.turnAsset(DEMO.asset.studyDesk, 6)).toBe(true);
    expect(host.edits).toEqual([]);
    expect(host.refusals[0]!.issues.map((issue) => issue.rule)).toContain('no-interpenetration');
    expect(host.shown).toEqual([]);
  });

  test('turnAsset answers false for an unknown id, a wall object, a disarmed tool and a running drag', () => {
    expect(tool.turnAsset('01a12fe6-0000-7000-8000-000000000000', 1)).toBe(false);
    expect(tool.turnAsset(DEMO.asset.bedroomArt, 1)).toBe(false);
    // Less than a whole step is no turn: nothing is judged, settled or emitted.
    expect(tool.turnAsset(DEMO.asset.livingChairA, 0.5)).toBe(false);
    expect(tool.turnAsset(DEMO.asset.livingChairA, -0.9)).toBe(false);
    expect(tool.turnAsset(DEMO.asset.livingChairA, Number.NaN)).toBe(false);
    const home = placement(DEMO.asset.livingSofa).position;
    expect(tool.down(at(home.x, home.z))).toBe(true);
    tool.move(at(home.x + 0.3, home.z));
    expect(tool.turnAsset(DEMO.asset.livingChairA, 1)).toBe(false);
    tool.cancel();
    host.armed = false;
    expect(tool.turnAsset(DEMO.asset.livingChairA, 1)).toBe(false);
    expect(host.edits).toEqual([]);
    expect(host.refusals).toEqual([]);
  });

  test('Q at rest that does not fit is refused at once and the burst commits nothing', () => {
    const timer = manualScheduler();
    tool = new AssetMoveTool(host, timer.schedule);
    host.selection = DEMO.asset.studyDesk;
    for (let press = 0; press < 6; press += 1) tool.key('q', false);
    expect(host.refusals.length).toBeGreaterThan(0);
    timer.fire();
    // Every 15° step that fitted was taken; the ones that did not were refused, never committed half-way.
    for (const edit of host.edits) {
      const rotate = edit.ops.find((op) => op.op === 'rotate_object');
      if (rotate?.op === 'rotate_object') {
        // Compared as a turn, wrapped to (-π, π]: the desk stands at π, so a step past it reads as 2π - 15°.
        const turned = (rotate.rotationY ?? 0) - (placement(DEMO.asset.studyDesk).rotationY ?? 0);
        expect(Math.abs(Math.atan2(Math.sin(turned), Math.cos(turned)))).toBeLessThan(Math.PI / 2);
      }
    }
  });
});

describe('the wall snap of a z-mirrored object', () => {
  test('snaps the mirrored back (its authored front) to the wall exactly like the plain object, and keeps the turned yaw', () => {
    const tub = DEMO.asset.bathroomBathtub;
    const home = placement(tub);
    const homeYaw = home.rotationY ?? 0;
    const context = dragContext(apartmentScene, plan, tub)!;
    expect(context.facts.wallSnap).toBe(true);
    // Into the room, the way the unmirrored tub faces at home.
    const facing = homeYaw + context.facts.yaw;
    const inward = { x: -Math.sin(facing), z: -Math.cos(facing) };
    const start = { x: home.position.x + inward.x * 0.05, y: home.position.y, z: home.position.z + inward.z * 0.05 };
    const along = { x: start.x - inward.z * 0.2, z: start.z + inward.x * 0.2 };
    /** Drags `body` (standing 5 cm off its wall) along the wall; the final pose's offset into the room and its yaw. */
    const slide = (body: DemoAsset): { offset: number; yaw: number } => {
      host = new FakeHost();
      tool = new AssetMoveTool(host);
      host.scene = { ...apartmentScene, assets: apartmentScene.assets.map((asset) => (asset.id === tub ? body : asset)) };
      host.selection = tub;
      drag(tool, start, along);
      const pose = host.last();
      return {
        offset: (pose.position.x - home.position.x) * inward.x + (pose.position.z - home.position.z) * inward.z,
        yaw: pose.rotationY,
      };
    };
    const plain = slide({ ...home, position: start });
    // Turned half round AND mirrored front to back: the same body, the same back on the wall.
    const mirrored = slide({ ...home, position: start, rotationY: homeYaw + Math.PI, mirror: { z: true } });
    expect(plain.offset).toBeLessThan(0.05 - 1e-3);
    expect(mirrored.offset).toBeCloseTo(plain.offset, 6);
    expect(Math.cos(mirrored.yaw - (homeYaw + Math.PI))).toBeCloseTo(1, 6);
  });
});

describe('edits before the host answers build on what is on screen', () => {
  test('two quick turns are 30°, and a refusal puts back the yaw before the first', () => {
    const home = placement(DEMO.asset.livingChairA);
    expect(tool.turnAsset(DEMO.asset.livingChairA, 1)).toBe(true);
    expect(tool.turnAsset(DEMO.asset.livingChairA, 1)).toBe(true);
    const yaws = host.edits.map((edit) => {
      const rotate = edit.ops.find((op) => op.op === 'rotate_object');
      return rotate?.op === 'rotate_object' ? (rotate.rotationY ?? 0) : null;
    });
    expect(yaws[0]).toBeCloseTo((home.rotationY ?? 0) + Math.PI / 12, 6);
    expect(yaws[1]).toBeCloseTo((home.rotationY ?? 0) + Math.PI / 6, 6);
    tool.revert();
    expect(host.last().rotationY).toBeCloseTo(home.rotationY ?? 0, 6);
  });

  test('a new document answers the pending edits: the next turn starts from the document again', () => {
    const home = placement(DEMO.asset.livingChairA);
    expect(tool.turnAsset(DEMO.asset.livingChairA, 1)).toBe(true);
    tool.documentChanged();
    expect(tool.turnAsset(DEMO.asset.livingChairA, 1)).toBe(true);
    const rotate = host.edits[1]!.ops.find((op) => op.op === 'rotate_object');
    if (rotate?.op !== 'rotate_object') throw new Error('expected rotate_object');
    expect(rotate.rotationY).toBeCloseTo((home.rotationY ?? 0) + Math.PI / 12, 6);
  });
});

describe('the handles', () => {
  /** A press `radius` metres from `centre` at floor angle `from`, swept round to `to` in small steps, released. */
  function sweep(centre: { x: number; z: number }, from: number, to: number, radius = 1): void {
    const point = (angle: number) => ({ x: centre.x + radius * Math.sin(angle), z: centre.z + radius * Math.cos(angle) });
    const start = point(from);
    expect(tool.down(at(start.x, start.z))).toBe(true);
    for (let step = 1; step <= 8; step += 1) {
      const p = point(from + ((to - from) * step) / 8);
      tool.move(at(p.x, p.z));
    }
    const end = point(to);
    tool.up(at(end.x, end.z));
  }

  test('the ring turns the object by the angle swept, in 15° steps, and commits it as a turn', () => {
    host.selection = DEMO.asset.livingChairA;
    host.handle = 'yaw';
    const home = placement(DEMO.asset.livingChairA);
    // 17° of sweep is one 15° step.
    sweep(home.position, 0, (17 / 180) * Math.PI);
    expect(host.refusals).toEqual([]);
    expect(host.edits).toHaveLength(1);
    const rotate = host.edits[0]!.ops.find((op) => op.op === 'rotate_object');
    if (rotate?.op !== 'rotate_object') throw new Error('expected rotate_object');
    expect(rotate.rotationY).toBeCloseTo((home.rotationY ?? 0) + (TURN_STEP_DEG / 180) * Math.PI, 6);
    expect(host.edits[0]!.gesture).toBe('turn');
  });

  test('a press on the selected body drags the body even where a handle lies within reach', () => {
    host.selection = DEMO.asset.livingChairA;
    host.handle = 'yaw';
    const home = placement(DEMO.asset.livingChairA).position;
    const spot = legalSpot(DEMO.asset.livingChairA, 0.6, 'floor');
    drag(tool, home, spot);
    const op = host.edits[0]!.ops[0]!;
    if (op.op !== 'move_object') throw new Error('expected move_object');
    expect(op.position!.x).toBeCloseTo(spot.x, 6);
    expect(host.edits[0]!.gesture).toBe('move');
  });

  test('a ring turn that does not fit is refused with the issue, and the object keeps its yaw', () => {
    host.selection = DEMO.asset.studyDesk;
    host.handle = 'yaw';
    const home = placement(DEMO.asset.studyDesk);
    sweep(home.position, 0, Math.PI / 2);
    expect(host.edits).toEqual([]);
    expect(host.refusals).toHaveLength(1);
    const desk = host.shown.filter((entry) => entry.id === DEMO.asset.studyDesk).at(-1)!;
    expect(desk.pose.rotationY).toBeCloseTo(home.rotationY ?? 0, 6);
  });

  test('in plan3d the height handle lifts a wall object by the vertical drag', () => {
    host.selection = DEMO.asset.hallMirror;
    host.handle = 'height';
    const home = placement(DEMO.asset.hallMirror).position;
    // Beside the body, where the bar is: a press on the body itself drags the body.
    const bar = { x: home.x + 1, z: home.z };
    expect(tool.down(at(bar.x, bar.z))).toBe(true);
    // 0.08 of a test metre is 8 px up the screen: 4 cm, inside the mirror's own mount band (`wall-hung`).
    tool.move(at(bar.x, bar.z - 0.04));
    tool.move(at(bar.x, bar.z - 0.08));
    tool.up(at(bar.x, bar.z - 0.08));
    expect(host.refusals).toEqual([]);
    const op = host.edits[0]!.ops[0]!;
    if (op.op !== 'move_object') throw new Error('expected move_object');
    expect(op.position!.y).toBeCloseTo(home.y + 8 * HEIGHT_M_PER_PX, 6);
    // The face and the place along it stay.
    expect(op.position!.x).toBeCloseTo(home.x, 6);
    expect(op.position!.z).toBeCloseTo(home.z, 6);
  });

  test('the height handle stops where the body meets the ceiling: the height-fit band', () => {
    host.selection = DEMO.asset.hallMirror;
    host.handle = 'height';
    const home = placement(DEMO.asset.hallMirror).position;
    const context = dragContext(apartmentScene, plan, DEMO.asset.hallMirror)!;
    const half = poseItem(context, { position: home, rotationY: placement(DEMO.asset.hallMirror).rotationY ?? 0 }).dims[1] / 2;
    expect(tool.down(at(home.x + 1, home.z))).toBe(true);
    tool.move(at(home.x + 1, home.z - 20));
    expect(host.last().position.y).toBeCloseTo(apartmentScene.ceilingHeight - half, 6);
    tool.move(at(home.x + 1, home.z + 40));
    expect(host.last().position.y).toBeCloseTo(half, 6);
  });
});

describe('what the tool leaves to others', () => {
  test('a drag never judges circulation: the floor rule runs once, on the commit', () => {
    // Every rule the drag judges per item; circulation floods a whole room and has none.
    const context = dragContext(apartmentScene, plan, DEMO.asset.livingSofa)!;
    const issues = judge(context.ctx, poseItem(context, { position: { x: 0, y: 0, z: 0 }, rotationY: 0 })).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.rule === 'circulation')).toBe(false);
  });

  test('a table lamp dropped onto a nightstand stands on its top, not on the floor', () => {
    // The second nightstand's top made free: the lamp moves over from the first.
    host.scene = { ...apartmentScene, assets: apartmentScene.assets.filter((asset) => asset.id !== DEMO.asset.bedroomLampB) };
    host.selection = DEMO.asset.bedroomLampA;
    const lamp = placement(DEMO.asset.bedroomLampA).position;
    const target = placement(DEMO.asset.bedroomNightstandB).position;
    drag(tool, lamp, target);
    expect(host.refusals).toEqual([]);
    const op = host.edits[0]!.ops[0]!;
    if (op.op !== 'move_object') throw new Error('expected move_object');
    expect(op.position!.y).toBeCloseTo(lamp.y, 6);
    expect(op.position!.y).toBeGreaterThan(0.3);
  });
});
