/**
 * Every layout issue carries a stable `code` and typed `params`, and its
 * English `message` is rendered from exactly those two.
 *
 * One case per code: a scene that raises it, the rule that code belongs to,
 * and the exact English sentence the rule wrote before the codes existed.
 * Together the cases must raise EVERY code of `LAYOUT_ISSUE_CODES` and nothing
 * outside it, so a code with no trigger or an issue with no code fails here.
 * Every issue the cases raise is then checked against the vocabularies its
 * params are taken from: ids are entity ids of the scene, faces name a wall
 * and a side, archetypes and anchors are catalogue values, never English words.
 */

import { describe, expect, test } from 'bun:test';

import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { bathTwoDoorsPlan } from '../fixtures/plan-bath-two-doors.js';
import { solvePlan } from '../plan/plan-solver.js';
import { ARCHETYPE } from '../assets/catalogue-ids.js';
import { ASSET_ANCHORS } from '../assets/asset-types.js';
import { lintLayout, type LayoutIssue, type LayoutRule } from './layout-lint.js';
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

/**
 * One case per code, in vocabulary order: the code, its rule (the README
 * table's column), the sentence its issue reads, word for word, and a scene
 * that raises it.
 */
const CASES: ReadonlyArray<{ code: LayoutIssueCode; rule: LayoutRule; message: string; scene: SceneData }> = [
  {
    code: 'object_inside_wall',
    rule: 'inside-a-wall',
    message: '01a17b10-5c00-7a00-8000-000000000001 is 0.10 m inside wall 01a12fe6-aebe-78b3-8554-a8c1fed044b8',
    scene: lShape([asset(ID.a, 'wardrobe', 6, 0, 4, HALF / 2)]),
  },
  {
    code: 'objects_overlap',
    rule: 'no-interpenetration',
    message: '01a17b10-5c00-7a00-8000-000000000001 and 01a17b10-5c00-7a00-8000-000000000002 overlap by 0.95 m',
    scene: lShape([asset(ID.a, 'sofa', 3, 0, 4), asset(ID.b, 'table', 3.2, 0, 4)]),
  },
  {
    code: 'mounted_objects_overlap',
    rule: 'no-interpenetration',
    message: '01a17b10-5c00-7a00-8000-000000000001 and 01a17b10-5c00-7a00-8000-000000000002 overlap by 0.05 m on the wall',
    scene: lShape([asset(ID.a, 'art', 3, 1.5, 7.82, HALF), asset(ID.b, 'art', 3.1, 1.5, 7.82, HALF)]),
  },
  {
    code: 'door_clear_zone_blocked',
    rule: 'door-clear-zone',
    message:
      '01a17b10-5c00-7a00-8000-000000000001 stands in the clear zone of 01a12fe6-aec2-73c9-8e44-82e9390b275e (01a12fe6-aec3-734d-bf23-be82cedaff5e side)',
    scene: lShape([asset(ID.a, 'wardrobe', 5.3, 0, 2.5, -HALF / 2)]),
  },
  // A leaf wider than room B is deep sweeps through its east wall.
  {
    code: 'door_leaf_hits_wall',
    rule: 'door-swing-path',
    message: 'the leaf of 01a12fe6-aec2-73c9-8e44-82e9390b275e sweeps through wall 01a12fe6-aeb9-7f83-b1ed-5a460f0be208',
    scene: lShape([], doorAb({ width: 4.6, swing: 'out' })),
  },
  {
    code: 'door_leaf_hits_object',
    rule: 'door-swing-path',
    message: 'the leaf of 01a12fe6-aec2-73c9-8e44-82e9390b275e sweeps through 01a17b10-5c00-7a00-8000-000000000001',
    scene: lShape([asset(ID.a, 'wardrobe', 6.5, 0, 3.4, HALF / 2)], doorAb({ hinge: 'b', swing: 'out' })),
  },
  {
    code: 'wall_hung_off_face',
    rule: 'wall-hung',
    message: '01a17b10-5c00-7a00-8000-000000000001 hangs 0.025 m off side L of wall 01a12fe6-aebc-75e2-993d-b8adf26e3610 (allowed 0..0.02)',
    scene: lShape([asset(ID.a, 'art', 3, 1.5, 7.9, HALF)]),
  },
  {
    code: 'wall_hung_past_face_end',
    rule: 'wall-hung',
    message:
      '01a17b10-5c00-7a00-8000-000000000001 runs off the end of side L of wall 01a12fe6-aebc-75e2-993d-b8adf26e3610 (5.12..5.70 of 5.70 m)',
    scene: lShape([asset(ID.a, 'art', 0.2, 1.5, 7.82, HALF)]),
  },
  {
    code: 'wall_hung_across_opening',
    rule: 'wall-hung',
    message: '01a17b10-5c00-7a00-8000-000000000001 hangs across opening 01a12fe6-aec0-7007-881f-2a18a04c89a4',
    scene: lShape([asset(ID.a, 'art', 4.15, 1.5, 0.18)]),
  },
  {
    code: 'wall_hung_centre_height',
    rule: 'wall-hung',
    message: '01a17b10-5c00-7a00-8000-000000000001 hangs at 1.90 m; 01a12fdf-14f0-7c5c-8c88-88574be9bf84 centres belong in 1.45..1.55 m',
    scene: lShape([asset(ID.a, 'art', 3, 1.9, 7.82, HALF)]),
  },
  {
    code: 'wall_hung_bottom_height',
    rule: 'wall-hung',
    message: '01a17b10-5c00-7a00-8000-000000000001 has its bottom at 0.64 m; 01a12fdf-14d9-7056-9d84-d5860b41bc6c belongs in 1.40..1.50 m',
    scene: lShape([asset(ID.a, 'upper-cabinet', 3, 1.0, 7.675, HALF)]),
  },
  {
    code: 'door_no_free_floor',
    rule: 'circulation',
    message: '01a12fe6-aec2-73c9-8e44-82e9390b275e has no 0.80 m of free floor in front of it inside 01a12fe6-aec3-734d-bf23-be82cedaff5e',
    scene: lShape([asset(ID.a, 'wardrobe', 5.0, 0, 2.5, -HALF / 2)]),
  },
  {
    code: 'doors_not_connected',
    rule: 'circulation',
    message:
      'no 0.60 m path from 01a17a4c-b813-73d4-ac79-9170721708c9 to 01a17a4c-b813-73d5-be10-ccc5373e70c2 across 01a17a4c-b813-73d6-9677-0469c1b74282',
    scene: {
      ...bathTwoDoorsPlan,
      assets: [asset(ID.a, 'wardrobe', 0.37, 0, 1.0, HALF / 2), asset(ID.b, 'nightstand', 1.08, 0, 1.0)],
    },
  },
  {
    code: 'main_zone_unreachable',
    rule: 'circulation',
    message:
      'the main zone of 01a12fe6-aec3-734d-bf23-be82cedaff5e is not reachable on a 0.80 m path from 01a12fe6-aebf-7606-9c9d-3135ba3254fc',
    scene: lShape([asset(ID.a, 'bed', 3, 0, 4)]),
  },
  {
    code: 'window_blocked',
    rule: 'window-clearance',
    message: '01a17b10-5c00-7a00-8000-000000000001 is 2.34 m tall and blocks window 01a12fe6-aec0-7007-881f-2a18a04c89a4',
    scene: lShape([asset(ID.a, 'wardrobe', 4.15, 0, 0.45, HALF)]),
  },
  {
    code: 'raised_without_support',
    rule: 'on-floor',
    message: '01a17b10-5c00-7a00-8000-000000000001 stands 0.50 m above the floor on no top that may hold it',
    scene: lShape([asset(ID.a, 'chair', 3, 0.5, 4)]),
  },
  {
    code: 'floor_object_outside_rooms',
    rule: 'on-floor',
    message: '01a17b10-5c00-7a00-8000-000000000001 stands outside every room',
    scene: lShape([asset(ID.a, 'sofa', 20, 0, 20)]),
  },
  {
    code: 'floor_object_crosses_room',
    rule: 'on-floor',
    message:
      "01a17b10-5c00-7a00-8000-000000000001 does not fit inside room 01a12fe6-aec3-734d-bf23-be82cedaff5e: its footprint crosses the room's outline",
    scene: lShape([asset(ID.a, 'sofa', 5.6, 0, 6.5, HALF / 2)]),
  },
  {
    code: 'ceiling_object_outside_rooms',
    rule: 'ceiling-hung',
    message: '01a17b10-5c00-7a00-8000-000000000001 hangs outside every room',
    scene: lShape([asset(ID.a, 'pendant', 20, 3.15, 20)]),
  },
  {
    code: 'ceiling_object_without_ceiling',
    rule: 'ceiling-hung',
    message: '01a17b10-5c00-7a00-8000-000000000001 hangs in 01a12fe6-aec4-7ba4-b1e8-ea477580cc86, which has no ceiling',
    scene: lShape([asset(ID.a, 'pendant', 8, 3.15, 2.5)], {
      rooms: lShapePlan.rooms.map((room) => (room.id === L_SHAPE.room.b ? { ...room, kind: 'loggia' as const } : room)),
    }),
  },
  {
    code: 'ceiling_object_out_of_band',
    rule: 'ceiling-hung',
    message: '01a17b10-5c00-7a00-8000-000000000001 spans 2.95..4.00 m; it must hang between 0.00 m and the 3.15 m ceiling',
    scene: lShape([asset(ID.a, 'pendant', 3, 4.0, 4)]),
  },
  {
    code: 'object_taller_than_ceiling',
    rule: 'height-fit',
    message: '01a17b10-5c00-7a00-8000-000000000001 is 2.34 m tall and does not fit under the 1.50 m ceiling',
    scene: lShape([asset(ID.a, 'wardrobe', 3, 0, 7.55, HALF)], { ceilingHeight: 1.5 }),
  },
  {
    code: 'wall_object_out_of_height',
    rule: 'height-fit',
    message: "01a17b10-5c00-7a00-8000-000000000001 spans -0.29..0.49 m, outside the wall's 0..3.15 m",
    scene: lShape([asset(ID.a, 'art', 3, 0.1, 7.82, HALF)]),
  },
  {
    code: 'wall_object_turned',
    rule: 'wall-facing',
    message: '01a17b10-5c00-7a00-8000-000000000001 is turned 17.2° away from side L of wall 01a12fe6-aebc-75e2-993d-b8adf26e3610',
    scene: lShape([asset(ID.a, 'art', 3, 1.5, 7.82, HALF + 0.3)]),
  },
  {
    code: 'case_good_off_wall',
    rule: 'case-goods-on-a-wall',
    message: '01a17b10-5c00-7a00-8000-000000000001 stands 2.85 m off the nearest wall face; case goods belong against a wall',
    scene: lShape([asset(ID.a, 'bookshelf', 3, 0, 4)]),
  },
  {
    code: 'wall_cabinet_outside_base_run',
    rule: 'kitchen-run',
    message:
      '01a17b10-5c00-7a00-8000-000000000001 (2.25..3.45 on side L of wall 01a12fe6-aebc-75e2-993d-b8adf26e3610) is not inside the base run',
    scene: lShape([asset(ID.a, 'upper-cabinet', 3, 1.81, 7.675, HALF)]),
  },
  {
    code: 'hood_off_hob_centre',
    rule: 'kitchen-run',
    message: '01a17b10-5c00-7a00-8000-000000000002 sits 1.00 m off the centre of 01a17b10-5c00-7a00-8000-000000000001 (total 1.01 m)',
    scene: lShape([asset(ID.a, 'stove', 3, 0, 7.55, HALF), asset(ID.b, 'hood', 4, 1.9, 7.7, HALF)]),
  },
  {
    code: 'sofa_tv_distance',
    rule: 'seating-group',
    message: '01a17b10-5c00-7a00-8000-000000000001 is 1.30 m from 01a17b10-5c00-7a00-8000-000000000002; keep 2..3 m',
    scene: lShape([asset(ID.a, 'sofa', 3, 0, 6.3, HALF), asset(ID.b, 'tv-unit', 3, 0, 7.6, HALF)]),
  },
  {
    code: 'floor_lamp_inside_seat',
    rule: 'seating-group',
    message: '01a17b10-5c00-7a00-8000-000000000002 stands inside 01a17b10-5c00-7a00-8000-000000000001; a floor lamp belongs beside the arm',
    scene: lShape([asset(ID.a, 'sofa', 3, 0, 7.4, HALF), asset(ID.b, 'lamp', 3, 0, 7.4)]),
  },
  {
    code: 'chair_tuck_distance',
    rule: 'dining-tuck',
    message: '01a17b10-5c00-7a00-8000-000000000002 sits -2.32 m from 01a17b10-5c00-7a00-8000-000000000001; tuck it to -0.42..0.12 m',
    scene: lShape([asset(ID.a, 'table', 3, 0, 4), asset(ID.b, 'chair', 3, 0, 5.6)]),
  },
  {
    code: 'chair_not_facing_table',
    rule: 'dining-tuck',
    message: '01a17b10-5c00-7a00-8000-000000000002 does not face 01a17b10-5c00-7a00-8000-000000000001',
    scene: lShape([asset(ID.a, 'table', 3, 0, 4), asset(ID.b, 'chair', 3, 0, 5.6, HALF / 2)]),
  },
  {
    code: 'bed_head_off_wall',
    rule: 'bedroom',
    message: 'the head of 01a17b10-5c00-7a00-8000-000000000001 stands 2.73 m off the wall',
    scene: lShape([asset(ID.a, 'bed', 3, 0, 4)]),
  },
  {
    code: 'double_bed_nightstands',
    rule: 'bedroom',
    message: '01a17b10-5c00-7a00-8000-000000000001 has 0 nightstand(s); a double bed takes one on each side',
    scene: lShape([asset(ID.a, 'bed', 3, 0, 4)]),
  },
  {
    code: 'nightstands_out_of_line',
    rule: 'bedroom',
    message: 'the nightstands of 01a17b10-5c00-7a00-8000-000000000001 are 0.40 m out of line with the bed head',
    scene: lShape([
      asset(ID.a, 'bed', 3, 0, 6.8),
      asset(ID.b, 'nightstand', 1.8, 0, 7.6, HALF),
      asset(ID.c, 'nightstand', 4.2, 0, 7.2, HALF),
    ]),
  },
  {
    code: 'wardrobe_front_blocked',
    rule: 'bedroom',
    message: '01a17b10-5c00-7a00-8000-000000000002 stands in the 0.9 m the doors of 01a17b10-5c00-7a00-8000-000000000001 need',
    scene: lShape([asset(ID.a, 'wardrobe', 3, 0, 7.55, HALF), asset(ID.b, 'armchair', 3, 0, 6.8)]),
  },
  {
    code: 'coat_rack_in_door_swing',
    rule: 'hall',
    message: '01a17b10-5c00-7a00-8000-000000000001 stands 0.00 m from the swing of 01a12fe6-aebf-7606-9c9d-3135ba3254fc',
    scene: lShape([asset(ID.a, 'coat-rack', 1.4, 0, 0.6)]),
  },
  {
    code: 'mirror_off_host_centre',
    rule: 'hall',
    message: '01a17b10-5c00-7a00-8000-000000000002 is 1.20 m off the centre of 01a17b10-5c00-7a00-8000-000000000001',
    scene: lShape([asset(ID.a, 'console', 4.4, 0, 7.6, HALF), asset(ID.b, 'mirror', 3.2, 1.5, 7.8, HALF)]),
  },
  {
    code: 'entrance_axis_blocked',
    rule: 'hall',
    message:
      '01a17b10-5c00-7a00-8000-000000000001 stands on the axis from 01a12fe6-aebf-7606-9c9d-3135ba3254fc into 01a12fe6-aec3-734d-bf23-be82cedaff5e',
    scene: lShape([asset(ID.a, 'dresser', 1.25, 0, 0.9)]),
  },
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
  for (const { code, rule, message, scene } of CASES) {
    test(`${code} is raised by its case, under its rule, with its sentence`, () => {
      const issue = lint(scene).find((candidate) => candidate.code === code);
      expect({ code: issue?.code, rule: issue?.rule, message: issue?.message }).toEqual({ code, rule, message });
    });
  }

  test('the cases raise exactly the vocabulary: no code without a trigger, no issue without a code', () => {
    const raised = new Set(RAISED.map(({ issue }) => issue.code));
    expect([...raised].sort()).toEqual([...LAYOUT_ISSUE_CODES].sort());
    expect(CASES.map((entry) => entry.code)).toEqual([...LAYOUT_ISSUE_CODES]);
  });

  test('the vocabulary is snake_case', () => {
    for (const code of LAYOUT_ISSUE_CODES) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  test('every raised issue reads what the renderer makes of it', () => {
    for (const { issue } of RAISED) expect(issue.message).toBe(renderLayoutIssue(issue));
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
    const insideWall = { placement: ID.a, wall: ID.b, depth: 1 };
    // @ts-expect-error the renderer refuses the params of another code
    const mismatched = (): string => renderLayoutIssue({ code: 'double_bed_nightstands', params: insideWall });
    void mismatched;
    const anyCode = issue.code as LayoutIssueCode;
    // @ts-expect-error a code of the union with params of one code is not a detail
    const unionPair = (): string => renderLayoutIssue({ code: anyCode, params: issue.params });
    void unionPair;
  });
});
