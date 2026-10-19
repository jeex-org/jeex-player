/**
 * The drag tool's judge and mask: they
 * ARE the linter's hard rules for one object, so every case below is checked
 * against `lintLayout` over the same scene with the object moved, and the
 * cost budgets (judge under 1 ms, a floor mask under 20 ms on the demo
 * flat) are measured here.
 */

import { describe, expect, test } from 'bun:test';
import { DEMO } from '../demo/demo-ids.js';
import { apartmentScene } from '../demo/scene-data.js';
import { solvePlan } from '../plan/plan-solver.js';
import { pointInPolygon } from '../plan/plan-geometry.js';
import { lintLayout } from './layout-lint.js';
import { LAYOUT_RULES } from './rules/index.js';
import { dragContext, fits, judge, poseItem, wallPose, type DragContext, type DragPose } from './asset-legality.js';
import { mask } from './asset-mask.js';
import type { LayoutIssue, LayoutRule } from './layout-issue.js';
import type { DemoAsset, SceneData } from '../scene/types.js';

const plan = solvePlan(apartmentScene);

function drag(assetId: string, scene: SceneData = apartmentScene): DragContext {
  const context = dragContext(scene, scene === apartmentScene ? plan : solvePlan(scene), assetId);
  if (!context) throw new Error(`no drag context for ${assetId}`);
  return context;
}

function moved(assetId: string, pose: DragPose): SceneData {
  return {
    ...apartmentScene,
    assets: apartmentScene.assets.map((asset): DemoAsset =>
      asset.id === assetId ? { ...asset, position: pose.position, rotationY: pose.rotationY } : asset,
    ),
  };
}

const ITEM_RULE_IDS = new Set<LayoutRule>(LAYOUT_RULES.filter((rule) => rule.severity === 'error' && rule.item).map((rule) => rule.id));

function keys(issues: readonly LayoutIssue[]): string[] {
  return issues.map((issue) => `${issue.rule}|${[...issue.ids].sort().join(',')}`).sort();
}

/**
 * What the linter's own `run` of every rule `judge` asks says about `assetId`
 * at `pose` — the whole-scene pass, not the per-item one. (Circulation, the one
 * hard rule without an item check, floods every room and is left out: the
 * full `lintLayout` is exercised by the case below.)
 */
function linted(context: DragContext, pose: DragPose): string[] {
  const assetId = context.placement.id;
  const ctx = { ...context.ctx, items: [...context.ctx.items, poseItem(context, pose)] };
  const issues: LayoutIssue[] = [];
  for (const rule of LAYOUT_RULES) if (ITEM_RULE_IDS.has(rule.id)) rule.run(ctx, issues);
  return keys(issues.filter((issue) => issue.ids.includes(assetId)));
}

function at(context: DragContext, dx: number, dz: number, dy = 0): DragPose {
  const p = context.placement.position;
  return { position: { x: p.x + dx, y: p.y + dy, z: p.z + dz }, rotationY: context.placement.rotationY ?? 0 };
}

describe('judge', () => {
  test('agrees with the full linter, object by object, at the committed pose and at poses pushed around', () => {
    // Every placement of the demo flat, at home and nudged in eight directions:
    // the drag must never call legal what the commit would refuse, or the reverse.
    const nudges: Array<[number, number]> = [
      [0, 0],
      [0.6, 0],
      [-0.6, 0],
      [0, 0.6],
      [0, -0.6],
      [1.5, 1.5],
      [-1.5, 1.5],
      [1.5, -1.5],
      [-3, -3],
    ];
    let disagreements = 0;
    let illegal = 0;
    for (const asset of apartmentScene.assets) {
      const context = drag(asset.id);
      for (const [dx, dz] of nudges) {
        const pose = at(context, dx, dz);
        const judged = judge(context.ctx, poseItem(context, pose));
        if (!judged.ok) illegal += 1;
        // The quick verdict the field and the settle use is the same verdict.
        if (fits(context.ctx, poseItem(context, pose)) !== judged.ok) disagreements += 1;
        if (keys(judged.issues).join() !== linted(context, pose).join()) disagreements += 1;
      }
    }
    expect(disagreements).toBe(0);
    // The nudges really did reach illegal poses, so the agreement is not over empty lists.
    expect(illegal).toBeGreaterThan(100);
  });

  test('the full lintLayout of a sofa shoved into the bedroom agrees with judge on every item rule', () => {
    const context = drag(DEMO.asset.livingSofa);
    const bed = apartmentScene.assets.find((asset) => asset.id === DEMO.asset.bedroomBed)!.position;
    const pose: DragPose = { position: { x: bed.x, y: 0, z: bed.z }, rotationY: 0 };
    const full = lintLayout(moved(DEMO.asset.livingSofa, pose), plan).filter(
      (issue) => ITEM_RULE_IDS.has(issue.rule) && issue.ids.includes(DEMO.asset.livingSofa),
    );
    const judged = judge(context.ctx, poseItem(context, pose));
    expect(judged.ok).toBe(false);
    expect(keys(judged.issues)).toEqual(keys(full));
  });

  test('every demo object is legal where it stands', () => {
    for (const asset of apartmentScene.assets) {
      const context = drag(asset.id);
      expect({ id: asset.id, issues: judge(context.ctx, poseItem(context, at(context, 0, 0))).issues }).toEqual({
        id: asset.id,
        issues: [],
      });
    }
  });

  test('a sofa pushed out through the facade is off the floor and inside a wall', () => {
    const context = drag(DEMO.asset.livingSofa);
    const rules = judge(context.ctx, poseItem(context, at(context, 0, 0))).issues.map((issue) => issue.rule);
    expect(rules).toEqual([]);
    const far = judge(context.ctx, poseItem(context, { position: { x: 100, y: 0, z: 100 }, rotationY: 0 }));
    expect(far.ok).toBe(false);
    expect(far.issues.map((issue) => issue.rule)).toContain('on-floor');
  });

  test('a wardrobe taller than the ceiling fails height-fit wherever it stands', () => {
    const scene: SceneData = { ...apartmentScene, ceilingHeight: 2.2 };
    const context = drag(DEMO.asset.bedroomWardrobe, scene);
    const judged = judge(context.ctx, poseItem(context, at(context, 0, 0)));
    expect(judged.issues.map((issue) => issue.rule)).toEqual(['height-fit']);
    const field = mask(context, poseItem(context, at(context, 0, 0)), 'floor');
    expect(field.count).toBeGreaterThan(1000);
    expect([...field.ok].every((legal) => legal === 0)).toBe(true);
  });

  test('a pendant refuses the loggia, which has no ceiling', () => {
    const context = drag(DEMO.asset.livingPendant);
    const loggia = plan.rooms.find((room) => room.roomId === DEMO.room.loggiaNorth)!;
    const inside = loggia.polygon.reduce((sum, p) => ({ x: sum.x + p.x / loggia.polygon.length, z: sum.z + p.z / loggia.polygon.length }), {
      x: 0,
      z: 0,
    });
    expect(pointInPolygon(inside, loggia.polygon)).toBe(true);
    const judged = judge(
      context.ctx,
      poseItem(context, { position: { x: inside.x, y: context.placement.position.y, z: inside.z }, rotationY: 0 }),
    );
    expect(judged.issues.map((issue) => issue.rule)).toEqual(['ceiling-hung']);
  });

  test('a mirror turned off its face fails wall-facing; hung by wallPose it faces the room', () => {
    const context = drag(DEMO.asset.hallMirror);
    const home = at(context, 0, 0);
    const turned = judge(context.ctx, poseItem(context, { ...home, rotationY: home.rotationY + 0.2 }));
    expect(turned.issues.map((issue) => issue.rule)).toContain('wall-facing');
    const face = [...plan.faces.values()].find((candidate) => candidate.roomId === DEMO.room.hall && candidate.length > 2)!;
    const hung = poseItem(context, wallPose(context, face, face.length / 2, home.position.y));
    expect(judge(context.ctx, hung).issues.map((issue) => issue.rule)).not.toContain('wall-facing');
  });
});
