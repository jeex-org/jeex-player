/**
 * The drag's one pose function: snapping, rising onto a top, tucking, the
 * settle, a refused turn and
 * carrying, on the demo flat. Every verdict is cross-checked against the full
 * linter where a document-level claim is made.
 */

import { describe, expect, test } from 'bun:test';
import { DEMO } from '../demo/demo-ids.js';
import { apartmentScene } from '../demo/scene-data.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lintLayout } from './layout-lint.js';
import { dragContext, judge, poseItem, type DragContext } from './asset-legality.js';
import { SETTLE_RADIUS_M, carriedPoses, proposePose, type PoseRequest } from './asset-pose.js';
import type { DemoAsset, SceneData } from '../scene/types.js';

const plan = solvePlan(apartmentScene);

function drag(assetId: string): DragContext {
  const context = dragContext(apartmentScene, plan, assetId);
  if (!context) throw new Error(`no drag context for ${assetId}`);
  return context;
}

function placed(id: string): DemoAsset {
  return apartmentScene.assets.find((asset) => asset.id === id)!;
}

/** A floor request at the object's home moved by `(dx, dz)`, turned by `turn`. */
function request(context: DragContext, dx: number, dz: number, turn = 0, snap = true): PoseRequest {
  const home = context.placement;
  return {
    kind: 'plan',
    point: { x: home.position.x + dx, z: home.position.z + dz },
    rotationY: (home.rotationY ?? 0) + turn,
    y: home.position.y,
    snap,
  };
}

function withAsset(id: string, change: Partial<DemoAsset>): SceneData {
  return { ...apartmentScene, assets: apartmentScene.assets.map((asset) => (asset.id === id ? { ...asset, ...change } : asset)) };
}

describe('proposePose', () => {
  test('a legal request is its own settled pose; a near miss settles within the radius; far off there is none', () => {
    const context = drag(DEMO.asset.bedroomNightstandA);
    const home = proposePose(context, request(context, 0, 0, 0, false));
    expect(home.judgement.ok).toBe(true);
    expect(home.settled).toBe(home.snapped);
    const bed = placed(DEMO.asset.bedroomBed).position;
    const towards = { x: bed.x - context.placement.position.x, z: bed.z - context.placement.position.z };
    const length = Math.hypot(towards.x, towards.z);
    const pushed = proposePose(context, request(context, (towards.x / length) * 0.15, (towards.z / length) * 0.15, 0, false));
    expect(pushed.judgement.ok).toBe(false);
    expect(pushed.settled).not.toBeNull();
    expect(judge(context.ctx, poseItem(context, pushed.settled!.pose)).ok).toBe(true);
    const moved = Math.hypot(
      pushed.settled!.pose.position.x - pushed.snapped.pose.position.x,
      pushed.settled!.pose.position.z - pushed.snapped.pose.position.z,
    );
    expect(moved).toBeLessThanOrEqual(SETTLE_RADIUS_M + 1e-9);
    const far = request(context, 100 - context.placement.position.x, 100 - context.placement.position.z);
    expect(proposePose(context, far).settled).toBeNull();
  });

  test('a wall-snap wardrobe pulled 10 cm off its wall and turned a little snaps back flat, facing the room', () => {
    const context = drag(DEMO.asset.bedroomWardrobe);
    const home = context.placement;
    const front = poseItem(context, { position: home.position, rotationY: home.rotationY ?? 0 }).front;
    const proposal = proposePose(context, request(context, front.x * 0.1, front.z * 0.1, 0.1));
    expect(proposal.judgement.ok).toBe(true);
    expect(proposal.snapped.pose.rotationY).toBeCloseTo(home.rotationY ?? 0, 6);
    expect(Math.hypot(proposal.snapped.pose.position.x - home.position.x, proposal.snapped.pose.position.z - home.position.z)).toBeLessThan(
      0.05,
    );
  });

  test('turned across the living room the sofa does not fit: refused with the issue', () => {
    const context = drag(DEMO.asset.livingSofa);
    const along = proposePose(context, request(context, 0, 0, Math.PI / 12, false));
    expect(along.settled).not.toBeNull();
    const across = proposePose(context, request(context, 0, 0, Math.PI / 2, false));
    expect(across.settled).toBeNull();
    expect(across.judgement.issues.map((issue) => issue.rule)).toContain('no-interpenetration');
  });
});

describe('standing on a top', () => {
  const desk = placed(DEMO.asset.studyDesk).position;

  test('a table lamp dragged over the desk rises onto its top and is legal fully on it', () => {
    const context = drag(DEMO.asset.studyTableLamp);
    const proposal = proposePose(context, { kind: 'plan', point: { x: desk.x, z: desk.z }, rotationY: 0, y: 0, snap: true });
    expect(proposal.snapped.host).toBe(DEMO.asset.studyDesk);
    expect(proposal.snapped.pose.position.y).toBeCloseTo(0.75, 6);
    expect(proposal.judgement.ok).toBe(true);
  });

  test('half over the edge it drops to the floor and collides with the desk; in a document it floats', () => {
    const context = drag(DEMO.asset.studyTableLamp);
    const edge = { x: desk.x - 1.24 / 2, z: desk.z };
    const proposal = proposePose(context, { kind: 'plan', point: edge, rotationY: 0, y: 0, snap: true });
    expect(proposal.snapped.host).toBeNull();
    expect(proposal.snapped.pose.position.y).toBe(0);
    expect(proposal.judgement.issues.map((issue) => issue.rule)).toContain('no-interpenetration');
    const floating = lintLayout(withAsset(DEMO.asset.studyTableLamp, { position: { x: edge.x, y: 0.75, z: edge.z } }), plan);
    expect(floating.some((issue) => issue.rule === 'on-floor' && issue.ids.includes(DEMO.asset.studyTableLamp))).toBe(true);
  });

  test('an object without onSurface never rises: a dining chair over the table stays on the floor and collides', () => {
    const context = drag(DEMO.asset.livingChairA);
    const table = placed(DEMO.asset.livingTable).position;
    const proposal = proposePose(context, { kind: 'plan', point: { x: table.x, z: table.z }, rotationY: 0, y: 0, snap: true });
    expect(proposal.snapped.host).toBeNull();
    expect(proposal.judgement.ok).toBe(false);
  });
});

describe('tucking', () => {
  // Chair A faces the dining table across its long side; its front stands 8 cm off the table's edge.
  const pushedBy = (depth: number) => {
    const context = drag(DEMO.asset.livingChairA);
    return judge(
      context.ctx,
      poseItem(context, { position: { ...context.placement.position, z: context.placement.position.z + depth }, rotationY: 0 }),
    );
  };

  test('the chair goes under the table up to its backrest (0.42 m in) and no further', () => {
    expect(pushedBy(0.08 + 0.4).ok).toBe(true);
    const deep = pushedBy(0.08 + 0.48);
    expect(deep.ok).toBe(false);
    expect(deep.issues.map((issue) => issue.rule)).toEqual(['no-interpenetration']);
  });

  test('turned side-on it does not tuck: the front must face the knee space within 30°', () => {
    const context = drag(DEMO.asset.livingChairA);
    const sideOn = judge(
      context.ctx,
      poseItem(context, { position: { ...context.placement.position, z: context.placement.position.z + 0.2 }, rotationY: Math.PI / 2 }),
    );
    expect(sideOn.issues.map((issue) => issue.rule)).toContain('no-interpenetration');
  });

  test('the tucked document lints clean of hard issues and of dining-tuck', () => {
    const chair = placed(DEMO.asset.livingChairA).position;
    const issues = lintLayout(withAsset(DEMO.asset.livingChairA, { position: { ...chair, z: chair.z + 0.4 } }), plan).filter((issue) =>
      issue.ids.includes(DEMO.asset.livingChairA),
    );
    expect(issues.filter((issue) => issue.severity === 'error' && issue.rule !== 'circulation')).toEqual([]);
    expect(issues.filter((issue) => issue.rule === 'dining-tuck')).toEqual([]);
  });
});

describe('carrying', () => {
  test('a nightstand carries the lamp on it; the lamp is not an obstacle to its host', () => {
    const context = drag(DEMO.asset.bedroomNightstandA);
    expect(context.carried.map((entry) => entry.placement.id)).toEqual([DEMO.asset.bedroomLampA]);
    expect(context.ctx.items.some((item) => item.placement.id === DEMO.asset.bedroomLampA)).toBe(false);
    const home = context.placement;
    const turn = Math.PI / 2;
    const [lamp] = carriedPoses(context, {
      position: { x: home.position.x + 0.3, y: 0, z: home.position.z },
      rotationY: (home.rotationY ?? 0) + turn,
    });
    const before = placed(DEMO.asset.bedroomLampA);
    const dx = before.position.x - home.position.x;
    const dz = before.position.z - home.position.z;
    // Rigid: the same distance from the host's pivot, turned with it, at the same height.
    expect(Math.hypot(lamp!.pose.position.x - home.position.x - 0.3, lamp!.pose.position.z - home.position.z)).toBeCloseTo(
      Math.hypot(dx, dz),
      6,
    );
    expect(lamp!.pose.position.y).toBeCloseTo(before.position.y, 6);
    expect(lamp!.pose.rotationY).toBeCloseTo((before.rotationY ?? 0) + turn, 6);
  });
});
