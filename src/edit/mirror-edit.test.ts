/**
 * `handle.mirrorAsset` through the move tool: one axis toggled, judged like a
 * move, emitted as `mirror_object` (plus a settle move) or refused; `false`
 * and silence when it may not run.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import { solvePlan } from '../plan/plan-solver.js';
import { dragContext, judge, poseItem, type DragPose } from '../layout/asset-legality.js';
import type { LegalityMask } from '../layout/asset-mask.js';
import { planMirror } from './mirror-edit.js';
import { AssetMoveTool, type AssetEdit, type AssetEditRefused, type AssetMoveHost, type PointerSample } from './asset-move-tool.js';
import type { Mirror, SceneData } from '../scene/types.js';

const plan = solvePlan(apartmentScene);
const SOFA = DEMO.asset.livingSofa;

class Host implements AssetMoveHost {
  armed = true;
  scene: SceneData = apartmentScene;
  shown: Array<{ id: string; pose: DragPose; mirror: Mirror | undefined }> = [];
  edits: AssetEdit[] = [];
  refusals: AssetEditRefused[] = [];
  active = (): boolean => this.armed;
  selected = (): string | null => SOFA;
  pickAsset = (): string | null => SOFA;
  ray = (clientX: number, clientY: number): THREE.Ray =>
    new THREE.Ray(new THREE.Vector3(clientX / 100, 30, clientY / 100), new THREE.Vector3(0, -1, 0));
  document = (): { scene: SceneData; plan: typeof plan; rev: number } => ({ scene: this.scene, plan, rev: 3 });
  bodyFacts = (): null => null;
  show = (id: string, pose: DragPose, mirror?: Mirror): void => {
    this.shown.push({ id, pose, mirror });
  };
  tint = (): void => {};
  drawMask = (_field: LegalityMask | null): void => {};
  viewYaw = (): number => 0;
  onEdit = (edit: AssetEdit): void => {
    this.edits.push(edit);
  };
  onRefused = (refusal: AssetEditRefused): void => {
    this.refusals.push(refusal);
  };
  onMoving = (): void => {};
}

function placement(id: string) {
  return apartmentScene.assets.find((asset) => asset.id === id)!;
}

describe('mirrorAsset', () => {
  test('an allowed axis emits mirror_object for the host, shows the mirrored body, and a revert puts the old state back', () => {
    const host = new Host();
    const tool = new AssetMoveTool(host);
    expect(tool.mirror(SOFA, 'x')).toBe(true);
    expect(host.refusals).toEqual([]);
    expect(host.edits).toHaveLength(1);
    expect(host.edits[0]!.ops).toEqual([{ op: 'mirror_object', assetId: SOFA, mirror: { x: true } }]);
    expect(host.edits[0]!.baseRev).toBe(3);
    expect(host.shown.at(-1)).toMatchObject({ id: SOFA, mirror: { x: true } });
    expect(host.shown.at(-1)!.pose.position).toEqual(placement(SOFA).position);
    expect(tool.state().pending).toBe(SOFA);
    tool.revert();
    expect(host.shown.at(-1)!.mirror).toEqual({});
  });

  test('a second toggle before the host answers builds on the first: x then x is none again', () => {
    const host = new Host();
    const tool = new AssetMoveTool(host);
    expect(tool.mirror(SOFA, 'x')).toBe(true);
    expect(tool.mirror(SOFA, 'x')).toBe(true);
    expect(host.edits.map((edit) => edit.ops[0])).toEqual([
      { op: 'mirror_object', assetId: SOFA, mirror: { x: true } },
      { op: 'mirror_object', assetId: SOFA, mirror: {} },
    ]);
    tool.revert();
    expect(host.shown.at(-1)!.mirror).toEqual({});
  });

  test('a mirrored placement toggles back to none', () => {
    const host = new Host();
    host.scene = {
      ...apartmentScene,
      assets: apartmentScene.assets.map((asset) => (asset.id === SOFA ? { ...asset, mirror: { x: true } } : asset)),
    };
    expect(new AssetMoveTool(host).mirror(SOFA, 'x')).toBe(true);
    expect(host.edits[0]!.ops[0]).toEqual({ op: 'mirror_object', assetId: SOFA, mirror: {} });
  });

  test('a wall piece mirrors along its face and keeps facing the room', () => {
    const host = new Host();
    expect(new AssetMoveTool(host).mirror(DEMO.asset.hallMirror, 'x')).toBe(true);
    expect(host.edits[0]!.ops[0]).toEqual({ op: 'mirror_object', assetId: DEMO.asset.hallMirror, mirror: { x: true } });
  });

  test('false and no event: an axis the facts forbid, a screen, an unknown asset, a disarmed tool, a running drag', () => {
    const host = new Host();
    const tool = new AssetMoveTool(host);
    expect(tool.mirror(SOFA, 'z')).toBe(false);
    expect(tool.mirror(DEMO.asset.livingTvUnit, 'x')).toBe(false);
    expect(tool.mirror('01a1a0c2-5d10-7a3e-9c41-2f7d8e6b5a03', 'x')).toBe(false);
    expect(tool.mirror(SOFA, 'w' as 'x')).toBe(false);
    host.armed = false;
    expect(tool.mirror(SOFA, 'x')).toBe(false);
    host.armed = true;
    const sofa = placement(SOFA).position;
    const press: PointerSample = { clientX: sofa.x * 100, clientY: sofa.z * 100, pointerId: 1, shiftKey: false };
    expect(tool.down(press)).toBe(true);
    expect(tool.mirror(SOFA, 'x')).toBe(false);
    expect(host.edits).toEqual([]);
    expect(host.refusals).toEqual([]);
  });

  test('a mirrored pose with no legal settle within reach is refused with the issues', () => {
    const host = new Host();
    const bed = placement(DEMO.asset.bedroomBed).position;
    // The sofa dropped onto the bed: nothing within 0.25 m is free.
    host.scene = {
      ...apartmentScene,
      assets: apartmentScene.assets.map((asset) => (asset.id === SOFA ? { ...asset, position: { ...bed } } : asset)),
    };
    expect(new AssetMoveTool(host).mirror(SOFA, 'x')).toBe(true);
    expect(host.edits).toEqual([]);
    expect(host.refusals).toHaveLength(1);
    expect(host.refusals[0]!.issues.map((issue) => issue.rule)).toContain('no-interpenetration');
  });
});

describe('planMirror', () => {
  test('a mirrored object that stands a little wrong settles within reach, and the edit carries the move', () => {
    const sofa = placement(SOFA);
    const yaw = sofa.rotationY ?? 0;
    // 0.2 m south, into the floor lamp that stands 0.10 m off its arm: an
    // overlap a settle within 0.25 m clears.
    const pushed = { x: sofa.position.x, y: 0, z: sofa.position.z + 0.2 };
    const scene = {
      ...apartmentScene,
      assets: apartmentScene.assets.map((asset) => (asset.id === SOFA ? { ...asset, position: pushed } : asset)),
    };
    const drag = dragContext(scene, plan, SOFA)!;
    const start = { position: pushed, rotationY: yaw };
    expect(judge(drag.ctx, poseItem(drag, start)).ok).toBe(false);
    const result = planMirror(drag, start, 'x', undefined);
    expect(result.kind).toBe('edit');
    if (result.kind !== 'edit') return;
    expect(result.ops.map((op) => op.op)).toEqual(['mirror_object', 'move_object']);
    expect(Math.hypot(result.pose.position.x - pushed.x, result.pose.position.z - pushed.z)).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(result.summary).toContain('and moved');
  });
});
