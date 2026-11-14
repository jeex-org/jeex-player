/**
 * A ceiling piece that says `overHost` hangs only over a host's top, high
 * enough above it (`over-host`, hard); every ceiling piece in the open keeps
 * head room (`head-room`, soft).
 *
 * The pendants here are a baked project's objects, so the fact is read from a
 * manifest library the way a project's own lint reads it
 * (`projectLayoutCatalogue`); the host is the shipped dining table behind it.
 * The exact English of each code is owned by `layout-issue-codes.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { lShapePlan } from '../../fixtures/plan-l-shape.js';
import { apartmentScene } from '../../demo/scene-data.js';
import { solvePlan } from '../../plan/plan-solver.js';
import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { ARCHETYPE } from '../../assets/catalogue-ids.js';
import { SceneModel, isApplyOk } from '../../scene/scene-model.js';
import { lintContext, lintLayout, projectLayoutCatalogue, shippedFacts, type LayoutCatalogue } from '../layout-lint.js';
import { layoutRuleOrder, type LayoutIssue } from './context.js';
import { LAYOUT_RULES } from './index.js';
import { HEAD_ROOM_M, OVER_HOST_GAP_M } from './hanging.js';
import type { DemoAsset, SceneData } from '../../scene/types.js';

/** Fixed ids: the viewer mints none. */
const ID = {
  pendant: '01a18c00-0e11-7a00-8000-0000000000a1',
  table: '01a18c00-0e11-7a00-8000-0000000000a2',
  fan: '01a18c00-0e11-7a00-8000-0000000000a3',
  archetype: '01a18c00-0e11-7a00-8000-0000000000b1',
  variant: '01a18c00-0e11-7a00-8000-0000000000b2',
} as const;

/** Room A's ceiling in the L-shape plan, metres. */
const CEILING = lShapePlan.ceilingHeight;
/** A drop that keeps head room even in the open floor: the lowest point is 2.05 m up. */
const DROP = 1.1;
/** Where the dining table stands in room A, unturned: 1.75 × 0.95, top at 0.75. */
const TABLE = { x: 3, z: 4 };

/** A project library of one ceiling pendant `drop` metres long, with or without `overHost`. */
function pendantBank(drop: number, overHost = true): LayoutCatalogue {
  const dims = [0.36, drop, 0.36] as const;
  return projectLayoutCatalogue({
    objects: [
      {
        id: ID.archetype,
        anchor: 'ceiling',
        dims,
        defaultVariant: ID.variant,
        variants: [{ id: ID.variant, dims }],
        ...(overHost ? { overHost: true as const } : {}),
      },
    ],
  });
}

function pendant(x: number, z: number): DemoAsset {
  return { id: ID.pendant, type: ID.archetype, asset: ID.archetype, position: { x, y: 0, z } };
}

function table(patch: Partial<DemoAsset> = {}): DemoAsset {
  return { id: ID.table, type: 'table', position: { x: TABLE.x, y: 0, z: TABLE.z }, rotationY: 0, ...patch };
}

function room(assets: DemoAsset[], patch: Partial<SceneData> = {}): SceneData {
  return { ...lShapePlan, assets, ...patch };
}

function lint(scene: SceneData, catalogue: LayoutCatalogue): LayoutIssue[] {
  return lintLayout(scene, solvePlan(scene), catalogue);
}

function codes(scene: SceneData, catalogue: LayoutCatalogue): string[] {
  return lint(scene, catalogue)
    .filter((issue) => issue.rule === 'over-host' || issue.rule === 'head-room')
    .map((issue) => issue.code);
}

/** The table's top, inset as `onSurface` insets it: the plan box a pendant's centre must stay in. */
function insetTop(scene: SceneData): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const item = lintContext(scene, solvePlan(scene)).items.find((candidate) => candidate.placement.id === ID.table)!;
  const xs = item.quad!.map((corner) => corner.x);
  const zs = item.quad!.map((corner) => corner.z);
  return { minX: Math.min(...xs) + 0.02, maxX: Math.max(...xs) - 0.02, minZ: Math.min(...zs) + 0.02, maxZ: Math.max(...zs) - 0.02 };
}

describe('over-host: a pendant that says overHost hangs over a host top', () => {
  test('over the table centre, well above it, it passes', () => {
    expect(codes(room([table(), pendant(TABLE.x, TABLE.z)]), pendantBank(1.5))).toEqual([]);
  });

  test('in the open floor it is refused, naming the pendant', () => {
    const issues = lint(room([table(), pendant(1, 1.5)]), pendantBank(1)).filter((issue) => issue.rule === 'over-host');
    expect(issues.map(({ code, severity, ids, params }) => ({ code, severity, ids, params }))).toEqual([
      { code: 'ceiling_object_not_over_host', severity: 'error', ids: [ID.pendant], params: { placement: ID.pendant } },
    ]);
  });

  test('too low over the table it is refused, with the unrounded gap, the host and the limit', () => {
    const issue = lint(room([table(), pendant(TABLE.x, TABLE.z)]), pendantBank(1.96)).find((candidate) => candidate.rule === 'over-host')!;
    if (issue.code !== 'ceiling_object_too_close_to_host') throw new Error(`expected a gap issue, got ${issue.code}`);
    expect(issue.severity).toBe('error');
    expect(issue.ids).toEqual([ID.pendant, ID.table]);
    expect(issue.params.host).toBe(ID.table);
    expect(issue.params.gap).toBeCloseTo(CEILING - 1.96 - 0.75, 12);
    expect(issue.params.min).toBe(OVER_HOST_GAP_M);
  });

  test(`a gap of exactly ${OVER_HOST_GAP_M} m passes; a millimetre less fails`, () => {
    const exact = CEILING - 0.75 - OVER_HOST_GAP_M;
    expect(codes(room([table(), pendant(TABLE.x, TABLE.z)]), pendantBank(exact))).toEqual([]);
    expect(codes(room([table(), pendant(TABLE.x, TABLE.z)]), pendantBank(exact + 0.001))).toEqual(['ceiling_object_too_close_to_host']);
  });

  test("over the inset top's corner it passes; just past its edge it fails", () => {
    const top = insetTop(room([table()]));
    expect(codes(room([table(), pendant(top.maxX, top.maxZ)]), pendantBank(DROP))).toEqual([]);
    expect(codes(room([table(), pendant(top.maxX + 0.001, TABLE.z)]), pendantBank(DROP))).toEqual(['ceiling_object_not_over_host']);
    expect(codes(room([table(), pendant(TABLE.x, top.minZ - 0.001)]), pendantBank(DROP))).toEqual(['ceiling_object_not_over_host']);
  });

  test('a mirrored, turned host holds it where its turned top lies', () => {
    // Turned a quarter, the table's long side runs along z: z = 4.7 lies on it, and off the unturned one.
    const turned = table({ rotationY: Math.PI / 2, mirror: { x: true, z: true } });
    expect(codes(room([turned, pendant(TABLE.x, 4.7)]), pendantBank(DROP))).toEqual([]);
    expect(codes(room([table(), pendant(TABLE.x, 4.7)]), pendantBank(DROP))).toEqual(['ceiling_object_not_over_host']);
  });

  test('a scaled host holds it over its scaled top, and its top rises with the scale', () => {
    const scaled = table({ scale: 1.4 });
    // x = 4.0 is past the unscaled top's edge (3.855) and inside the scaled one's (4.205).
    expect(codes(room([scaled, pendant(4, TABLE.z)]), pendantBank(DROP))).toEqual([]);
    expect(codes(room([table(), pendant(4, TABLE.z)]), pendantBank(DROP))).toEqual(['ceiling_object_not_over_host']);
    // The scaled top stands at 1.05: a 1.7 m drop ends 0.40 above it, 0.70 above an unscaled one.
    const close = lint(room([scaled, pendant(TABLE.x, TABLE.z)]), pendantBank(1.7)).find((issue) => issue.rule === 'over-host')!;
    if (close.code !== 'ceiling_object_too_close_to_host') throw new Error(`expected a gap issue, got ${close.code}`);
    expect(close.params.gap).toBeCloseTo(CEILING - 1.7 - 0.75 * 1.4, 12);
    expect(codes(room([table(), pendant(TABLE.x, TABLE.z)]), pendantBank(1.7))).toEqual([]);
  });

  test('without the fact, a pendant hangs anywhere it hung before', () => {
    expect(codes(room([table(), pendant(1, 1.5)]), pendantBank(1, false))).toEqual([]);
  });
});

describe('a document without the fact lints exactly as before', () => {
  /** The rules that existed before these two, run the way `lintLayout` runs every rule. */
  function lintBefore(scene: SceneData, catalogue: LayoutCatalogue): LayoutIssue[] {
    const ctx = lintContext(scene, solvePlan(scene), catalogue);
    const issues: LayoutIssue[] = [];
    for (const rule of LAYOUT_RULES) if (rule.id !== 'over-host' && rule.id !== 'head-room') rule.run(ctx, issues);
    return issues.sort((a, b) => layoutRuleOrder(a.rule) - layoutRuleOrder(b.rule) || a.ids.join().localeCompare(b.ids.join()));
  }

  test('the demo flat, its pendant over the dining table', () => {
    expect(lint(apartmentScene, shippedFacts)).toEqual(lintBefore(apartmentScene, shippedFacts));
  });

  test('a pendant in the open floor with head room to spare', () => {
    const scene = room([table(), pendant(1, 1.5)]);
    expect(lint(scene, pendantBank(1, false))).toEqual(lintBefore(scene, pendantBank(1, false)));
  });
});

describe('head-room: a ceiling piece in the open warns under 2.0 m, and never refuses', () => {
  /** The flush ceiling light of the shipped bank, `drop` deep: a ceiling fan's body. */
  function fanBank(drop: number): LayoutCatalogue {
    return (placement) => {
      const facts = shippedFacts(placement);
      return facts && placement.id === ID.fan ? { ...facts, dims: [1.2, drop, 1.2] } : facts;
    };
  }
  const fan = (x: number, z: number): DemoAsset => ({
    id: ID.fan,
    type: ARCHETYPE.ceiling_light,
    asset: ARCHETYPE.ceiling_light,
    position: { x, y: 0, z },
  });
  const LOW = { ceilingHeight: 2.4 };

  test('a 0.405 m fan under a 2.4 m ceiling reaches 1.995 m: a warning, with the unrounded lowest point', () => {
    const issues = lint(room([fan(2, 2)], LOW), fanBank(0.405)).filter((issue) => issue.rule === 'head-room');
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    if (issue.code !== 'ceiling_object_low_head_room') throw new Error(`expected head room, got ${issue.code}`);
    expect(issue.severity).toBe('warning');
    expect(issue.ids).toEqual([ID.fan]);
    expect(issue.params.lowest).toBeCloseTo(1.995, 12);
    expect(issue.params.min).toBe(HEAD_ROOM_M);
  });

  test('the same fan is not refused, by strict or by strict-new: a warning is information', () => {
    const catalogue = fanBank(0.405);
    for (const mode of ['strict', 'strict-new'] as const) {
      const model = new SceneModel(room([fan(2, 2)], LOW), CATALOGUE_REGISTRIES, {
        lint: (scene, plan) => lintLayout(scene, plan, catalogue),
      });
      const result = model.apply({
        baseRev: 0,
        ops: [{ op: 'move_object', assetId: ID.fan, position: { x: 2.5, y: 0, z: 2 } }],
        lint: mode,
      });
      if (!isApplyOk(result)) throw new Error(`${mode}: expected a commit, got ${result.error}: ${result.message}`);
      expect(result.issues?.map((issue) => issue.code)).toEqual(['ceiling_object_low_head_room']);
    }
  });

  test('a fan that keeps 2.0 m raises nothing', () => {
    expect(codes(room([fan(2, 2)], LOW), fanBank(0.4))).toEqual([]);
  });

  test('a pendant over the table, down to 1.6 m, raises no head-room warning', () => {
    const scene = room([table(), pendant(TABLE.x, TABLE.z)]);
    expect(codes(scene, pendantBank(CEILING - 1.6))).toEqual([]);
    expect(codes(scene, pendantBank(CEILING - 1.6, false))).toEqual([]);
  });

  test('the same pendant in the open warns, beside the over-host error', () => {
    expect(codes(room([table(), pendant(1, 1.5)]), pendantBank(CEILING - 1.6))).toEqual([
      'ceiling_object_not_over_host',
      'ceiling_object_low_head_room',
    ]);
  });
});
