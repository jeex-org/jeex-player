/**
 * Every layout issue carries a stable `code` and typed `params`, and its
 * English `message` is rendered from exactly those two.
 *
 * One case per code: a scene that raises it. Together the cases must raise
 * EVERY code of `LAYOUT_ISSUE_CODES` and nothing outside it, so a code with no
 * trigger or an issue with no code fails here. Every issue the cases raise is
 * then checked against the renderer and against the vocabularies its params
 * are taken from: ids are entity ids of the scene, faces name a wall and a
 * side, archetypes and anchors are catalogue values, never English words.
 */

import { describe, expect, test } from 'bun:test';

import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { bathTwoDoorsPlan } from '../fixtures/plan-bath-two-doors.js';
import { solvePlan } from '../plan/plan-solver.js';
import { ARCHETYPE } from '../assets/catalogue-ids.js';
import { ASSET_ANCHORS } from '../assets/asset-types.js';
import { lintLayout, type LayoutIssue } from './layout-lint.js';
import { LAYOUT_ISSUE_CODES, renderLayoutIssue, type LayoutIssueCode } from './layout-issue-codes.js';
import type { DemoAsset, Opening, SceneData, Wall } from '../scene/types.js';

/** Placement ids of the cases, fixed literals: the viewer mints no ids. */
const ID = {
  a: '01a17b10-5c00-7a00-8000-000000000001',
  b: '01a17b10-5c00-7a00-8000-000000000002',
  c: '01a17b10-5c00-7a00-8000-000000000003',
} as const;

const HALF = Math.PI;

function asset(id: string, type: string, x: number, y: number, z: number, rotationY = 0): DemoAsset {
  return { id, type, position: { x, y, z }, rotationY };
}

/** The L-shape plan furnished with `assets`, with optional document patches. */
function lShape(assets: DemoAsset[], patch: Partial<SceneData> = {}): SceneData {
  return { ...lShapePlan, assets, ...patch };
}

/** `door-ab` with `patch` authored on it. */
function doorAb(patch: Partial<Opening>): Partial<SceneData> {
  return {
    walls: lShapePlan.walls.map((wall): Wall =>
      wall.id === L_SHAPE.wall.wPart
        ? {
            ...wall,
            openings: (wall.openings ?? []).map((opening) => (opening.id === L_SHAPE.opening.doorAb ? { ...opening, ...patch } : opening)),
          }
        : wall,
    ),
  };
}

/** One case per code, in vocabulary order: the code and a scene that raises it. */
const CASES: ReadonlyArray<{ code: LayoutIssueCode; scene: SceneData }> = [
  { code: 'object_inside_wall', scene: lShape([asset(ID.a, 'wardrobe', 6, 0, 4, HALF / 2)]) },
  {
    code: 'objects_overlap',
    scene: lShape([asset(ID.a, 'sofa', 3, 0, 4), asset(ID.b, 'table', 3.2, 0, 4)]),
  },
  {
    code: 'mounted_objects_overlap',
    scene: lShape([asset(ID.a, 'art', 3, 1.5, 7.82, HALF), asset(ID.b, 'art', 3.1, 1.5, 7.82, HALF)]),
  },
  { code: 'door_clear_zone_blocked', scene: lShape([asset(ID.a, 'wardrobe', 5.3, 0, 2.5, -HALF / 2)]) },
  // A leaf wider than room B is deep sweeps through its east wall.
  { code: 'door_leaf_hits_wall', scene: lShape([], doorAb({ width: 4.6, swing: 'out' })) },
  {
    code: 'door_leaf_hits_object',
    scene: lShape([asset(ID.a, 'wardrobe', 6.5, 0, 3.4, HALF / 2)], doorAb({ hinge: 'b', swing: 'out' })),
  },
  { code: 'wall_hung_off_face', scene: lShape([asset(ID.a, 'art', 3, 1.5, 7.9, HALF)]) },
  { code: 'wall_hung_past_face_end', scene: lShape([asset(ID.a, 'art', 0.2, 1.5, 7.82, HALF)]) },
  { code: 'wall_hung_across_opening', scene: lShape([asset(ID.a, 'art', 4.15, 1.5, 0.18)]) },
  { code: 'wall_hung_centre_height', scene: lShape([asset(ID.a, 'art', 3, 1.9, 7.82, HALF)]) },
  { code: 'wall_hung_bottom_height', scene: lShape([asset(ID.a, 'upper-cabinet', 3, 1.0, 7.675, HALF)]) },
  { code: 'door_no_free_floor', scene: lShape([asset(ID.a, 'wardrobe', 5.0, 0, 2.5, -HALF / 2)]) },
  {
    code: 'doors_not_connected',
    scene: {
      ...bathTwoDoorsPlan,
      assets: [asset(ID.a, 'wardrobe', 0.37, 0, 1.0, HALF / 2), asset(ID.b, 'nightstand', 1.08, 0, 1.0)],
    },
  },
  { code: 'main_zone_unreachable', scene: lShape([asset(ID.a, 'bed', 3, 0, 4)]) },
  { code: 'window_blocked', scene: lShape([asset(ID.a, 'wardrobe', 4.15, 0, 0.45, HALF)]) },
  { code: 'raised_without_support', scene: lShape([asset(ID.a, 'chair', 3, 0.5, 4)]) },
  { code: 'floor_object_outside_rooms', scene: lShape([asset(ID.a, 'sofa', 20, 0, 20)]) },
  { code: 'floor_object_crosses_room', scene: lShape([asset(ID.a, 'sofa', 5.6, 0, 6.5, HALF / 2)]) },
  { code: 'ceiling_object_outside_rooms', scene: lShape([asset(ID.a, 'pendant', 20, 3.15, 20)]) },
  {
    code: 'ceiling_object_without_ceiling',
    scene: lShape([asset(ID.a, 'pendant', 8, 3.15, 2.5)], {
      rooms: lShapePlan.rooms.map((room) => (room.id === L_SHAPE.room.b ? { ...room, kind: 'loggia' as const } : room)),
    }),
  },
  { code: 'ceiling_object_out_of_band', scene: lShape([asset(ID.a, 'pendant', 3, 4.0, 4)]) },
  { code: 'object_taller_than_ceiling', scene: lShape([asset(ID.a, 'wardrobe', 3, 0, 7.55, HALF)], { ceilingHeight: 1.5 }) },
  { code: 'wall_object_out_of_height', scene: lShape([asset(ID.a, 'art', 3, 0.1, 7.82, HALF)]) },
  { code: 'wall_object_turned', scene: lShape([asset(ID.a, 'art', 3, 1.5, 7.82, HALF + 0.3)]) },
  { code: 'case_good_off_wall', scene: lShape([asset(ID.a, 'bookshelf', 3, 0, 4)]) },
  { code: 'wall_cabinet_outside_base_run', scene: lShape([asset(ID.a, 'upper-cabinet', 3, 1.81, 7.675, HALF)]) },
  {
    code: 'hood_off_hob_centre',
    scene: lShape([asset(ID.a, 'stove', 3, 0, 7.55, HALF), asset(ID.b, 'hood', 4, 1.9, 7.7, HALF)]),
  },
  {
    code: 'sofa_tv_distance',
    scene: lShape([asset(ID.a, 'sofa', 3, 0, 6.3, HALF), asset(ID.b, 'tv-unit', 3, 0, 7.6, HALF)]),
  },
  {
    code: 'floor_lamp_inside_seat',
    scene: lShape([asset(ID.a, 'sofa', 3, 0, 7.4, HALF), asset(ID.b, 'lamp', 3, 0, 7.4)]),
  },
  {
    code: 'chair_tuck_distance',
    scene: lShape([asset(ID.a, 'table', 3, 0, 4), asset(ID.b, 'chair', 3, 0, 5.6)]),
  },
  {
    code: 'chair_not_facing_table',
    scene: lShape([asset(ID.a, 'table', 3, 0, 4), asset(ID.b, 'chair', 3, 0, 5.6, HALF / 2)]),
  },
  { code: 'bed_head_off_wall', scene: lShape([asset(ID.a, 'bed', 3, 0, 4)]) },
  { code: 'double_bed_nightstands', scene: lShape([asset(ID.a, 'bed', 3, 0, 4)]) },
  {
    code: 'nightstands_out_of_line',
    scene: lShape([
      asset(ID.a, 'bed', 3, 0, 6.8),
      asset(ID.b, 'nightstand', 1.8, 0, 7.6, HALF),
      asset(ID.c, 'nightstand', 4.2, 0, 7.2, HALF),
    ]),
  },
  {
    code: 'wardrobe_front_blocked',
    scene: lShape([asset(ID.a, 'wardrobe', 3, 0, 7.55, HALF), asset(ID.b, 'armchair', 3, 0, 6.8)]),
  },
  { code: 'coat_rack_in_door_swing', scene: lShape([asset(ID.a, 'coat-rack', 1.4, 0, 0.6)]) },
  {
    code: 'mirror_off_host_centre',
    scene: lShape([asset(ID.a, 'console', 4.4, 0, 7.6, HALF), asset(ID.b, 'mirror', 3.2, 1.5, 7.8, HALF)]),
  },
  { code: 'entrance_axis_blocked', scene: lShape([asset(ID.a, 'dresser', 1.25, 0, 0.9)]) },
];

function lint(scene: SceneData): LayoutIssue[] {
  return lintLayout(scene, solvePlan(scene));
}

/** Every issue the cases raise, with the scene it came from. */
const RAISED = CASES.flatMap(({ scene }) => lint(scene).map((issue) => ({ issue, scene })));

/** Every entity id a scene names: what an id param may hold. */
function entityIds(scene: SceneData): Set<string> {
  return new Set([
    ...scene.walls.map((wall) => wall.id),
    ...scene.walls.flatMap((wall) => (wall.openings ?? []).map((opening) => opening.id)),
    ...scene.rooms.map((room) => room.id),
    ...scene.assets.map((placement) => placement.id),
  ]);
}

const ARCHETYPES: ReadonlySet<string> = new Set(Object.values(ARCHETYPE));
const ANCHORS: ReadonlySet<string> = new Set(ASSET_ANCHORS);

describe('every layout issue has a code', () => {
  for (const { code, scene } of CASES) {
    test(`${code} is raised by its case`, () => {
      expect(lint(scene).map((issue) => issue.code)).toContain(code);
    });
  }

  test('the cases raise exactly the vocabulary: no code without a trigger, no issue without a code', () => {
    const raised = new Set(RAISED.map(({ issue }) => issue.code));
    expect([...raised].sort()).toEqual([...LAYOUT_ISSUE_CODES].sort());
    expect(CASES.map((entry) => entry.code)).toEqual([...LAYOUT_ISSUE_CODES]);
  });

  test('the vocabulary is snake_case with no duplicates', () => {
    expect(new Set(LAYOUT_ISSUE_CODES).size).toBe(LAYOUT_ISSUE_CODES.length);
    for (const code of LAYOUT_ISSUE_CODES) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});

describe('the message is rendered from the code and the params', () => {
  test('every raised issue reads exactly what the renderer makes of its code and params', () => {
    for (const { issue } of RAISED) expect(issue.message).toBe(renderLayoutIssue(issue.code, issue.params));
  });

  test('one code always belongs to one rule', () => {
    const ruleOf = new Map<string, Set<string>>();
    for (const { issue } of RAISED) ruleOf.set(issue.code, (ruleOf.get(issue.code) ?? new Set()).add(issue.rule));
    for (const [code, rules] of ruleOf) expect({ code, rules: [...rules] }).toEqual({ code, rules: [[...rules][0]!] });
  });

  test('the English wording is the sentence the rule always wrote', () => {
    expect(renderLayoutIssue('double_bed_nightstands', { placement: ID.a, count: 1 })).toBe(
      `${ID.a} has 1 nightstand(s); a double bed takes one on each side`,
    );
    expect(
      renderLayoutIssue('wall_object_turned', { placement: ID.a, face: { wall: L_SHAPE.wall.wNA, side: 'L' }, degrees: 17.18873 }),
    ).toBe(`${ID.a} is turned 17.2° away from side L of wall ${L_SHAPE.wall.wNA}`);
    expect(renderLayoutIssue('sofa_tv_distance', { placement: ID.a, tv: ID.b, distance: 1.3, min: 2, max: 3 })).toBe(
      `${ID.a} is 1.30 m from ${ID.b}; keep 2..3 m`,
    );
    expect(renderLayoutIssue('main_zone_unreachable', { room: L_SHAPE.room.a, opening: L_SHAPE.opening.doorAb, width: 0.8 })).toBe(
      `the main zone of ${L_SHAPE.room.a} is not reachable on a 0.80 m path from ${L_SHAPE.opening.doorAb}`,
    );
  });
});

describe('params carry vocabulary values, never English', () => {
  test('ids are entity ids of the scene, faces a wall and a side, archetypes and anchors catalogue values, numbers finite', () => {
    for (const { issue, scene } of RAISED) {
      const ids = entityIds(scene);
      for (const [key, value] of Object.entries(issue.params as Record<string, unknown>)) {
        const where = `${issue.code}.${key}`;
        if (key === 'face') {
          const face = value as { wall: string; side: string };
          expect({ where, keys: Object.keys(face).sort() }).toEqual({ where, keys: ['side', 'wall'] });
          expect({ where, wall: ids.has(face.wall), side: ['L', 'R'].includes(face.side) }).toEqual({ where, wall: true, side: true });
        } else if (key === 'archetype') {
          expect({ where, archetype: ARCHETYPES.has(value as string) }).toEqual({ where, archetype: true });
        } else if (key === 'anchor') {
          expect({ where, anchor: ANCHORS.has(value as string) }).toEqual({ where, anchor: true });
        } else if (typeof value === 'number') {
          expect({ where, finite: Number.isFinite(value) }).toEqual({ where, finite: true });
        } else {
          expect({ where, id: typeof value === 'string' && ids.has(value) }).toEqual({ where, id: true });
        }
      }
    }
  });
});

describe('the code narrows the params', () => {
  test('a check of the code gives the params of that code, and only those', () => {
    const issue = lint(lShape([asset(ID.a, 'bed', 3, 0, 4)])).find((candidate) => candidate.code === 'double_bed_nightstands')!;
    if (issue.code !== 'double_bed_nightstands') throw new Error('no nightstand issue');
    const count: number = issue.params.count;
    expect(count).toBe(0);
    // @ts-expect-error a nightstand count names no wall face
    expect(issue.params.face).toBeUndefined();
    // @ts-expect-error the renderer refuses the params of another code
    const mismatched = (): string => renderLayoutIssue('double_bed_nightstands', { placement: ID.a, wall: ID.b, depth: 1 });
    expect(typeof mismatched).toBe('function');
  });
});
