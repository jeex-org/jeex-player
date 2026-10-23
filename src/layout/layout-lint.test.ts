import { describe, expect, test } from 'bun:test';

import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { solvePlan } from '../plan/plan-solver.js';
import { LEAF_REST_ANGLE_RAD, doorLeafQuad, doorSweepQuads, resolveDoorSwing } from '../plan/door-swing.js';
import { openingFrameWidth } from '../assets/opening-frame.js';
import { overlapDepth, quadContains } from './layout-geometry.js';
import { obbQuad, spanQuad } from '../plan/plan-geometry.js';
import { countIssues, describeIssues, lintLayout, projectLayoutCatalogue, type LayoutIssue, type LayoutRule } from './layout-lint.js';
import type { DemoAsset, Opening, SceneData, Wall } from '../scene/types.js';

/** Ids of the placements the tests furnish the L-shape plan with (and of the one project archetype and its variant), keyed by the readable id each replaces. */
const ITEM = {
  aWardrobe: '01a12ff7-92c8-7f89-afe2-9e00b9e81adb',
  bWardrobe: '01a12ff7-92c9-768e-9c46-5eca78ebb608',
  boxSofa: '01a12ff7-92ca-7ec0-b14e-52118059e174',
  boxSofaVariant: '01a12ff8-1a33-7443-b8c7-79adb568f9aa',
  pSofa: '01a12ff7-92cb-740f-a46e-ee34653afd10',
  aSofa: '01a12ff7-92cc-79ad-98fd-3d841e69bf41',
  aTable: '01a12ff7-92cd-79e3-8375-3a6bae757862',
  aMirror: '01a12ff7-92ce-7d68-84e7-071de2750c66',
  aArt: '01a12ff7-92cf-713f-8480-c13b425a2b4f',
  aDresser: '01a12ff7-92d0-7599-9b04-6ed74fd54ecb',
  aConsole: '01a12ff7-92d1-7380-8416-33e1ee6a56f2',
  aCoatRack: '01a12ff7-92d2-772a-a4b1-ae15c2fe408a',
  aLamp: '01a12ff7-92d3-715b-be04-ed3aa0fdb47a',
  aBookshelf: '01a12ff7-92d4-7d4e-9647-3d6162273f73',
  aTableLamp: '01a12ff7-92d5-79cf-8624-d02083dd46c0',
  aNightstand: '01a12ff7-92d6-7ae0-80cc-6913d1d78acb',
  aDesk: '01a12ff7-92d7-7d06-9853-fe127d63dd34',
  aChair: '01a12ff7-92d8-7682-8861-c2b8e7ff4b5f',
  plant: '01a16a50-2000-7000-8000-000000000001',
  plantVariant: '01a16a50-2000-7000-8000-000000000002',
} as const;

/** The L-shape fixture re-furnished: the plan is fixed, the contents are the test input. */
function sceneWith(assets: DemoAsset[], patchWall?: (wall: Wall) => Wall): SceneData {
  return {
    ...lShapePlan,
    assets,
    walls: patchWall ? lShapePlan.walls.map(patchWall) : lShapePlan.walls,
  };
}

function lint(scene: SceneData): LayoutIssue[] {
  return lintLayout(scene, solvePlan(scene));
}

function ofRule(issues: LayoutIssue[], rule: LayoutRule): LayoutIssue[] {
  return issues.filter((issue) => issue.rule === rule);
}

/** `door-ab` with the given hinge and swing authored on it. */
function withDoor(patch: Partial<Opening>) {
  return (wall: Wall): Wall =>
    wall.id === L_SHAPE.wall.wPart
      ? {
          ...wall,
          openings: (wall.openings ?? []).map((opening) => (opening.id === L_SHAPE.opening.doorAb ? { ...opening, ...patch } : opening)),
        }
      : wall;
}

describe('layout geometry', () => {
  test('boxes that only touch do not overlap, boxes that interpenetrate report the depth', () => {
    const a = obbQuad({ x: 0, z: 0, hx: 0.5, hz: 0.5, angle: 0 });
    expect(overlapDepth(a, obbQuad({ x: 1.0, z: 0, hx: 0.5, hz: 0.5, angle: 0 }))).toBeCloseTo(0, 6);
    expect(overlapDepth(a, obbQuad({ x: 1.4, z: 0, hx: 0.5, hz: 0.5, angle: 0 }))).toBe(0);
    expect(overlapDepth(a, obbQuad({ x: 0.8, z: 0, hx: 0.5, hz: 0.5, angle: 0 }))).toBeCloseTo(0.2, 6);
  });

  test('rotation is taken into account: a turned box misses what its bbox would hit', () => {
    const turned = obbQuad({ x: 0, z: 0, hx: 1, hz: 0.1, angle: Math.PI / 2 });
    // The box now runs along z, so a neighbour on +x at 0.5 is clear of it.
    expect(overlapDepth(turned, obbQuad({ x: 0.5, z: 0, hx: 0.2, hz: 0.2, angle: 0 }))).toBe(0);
    expect(overlapDepth(turned, obbQuad({ x: 0, z: 0.5, hx: 0.2, hz: 0.2, angle: 0 }))).toBeGreaterThan(0);
  });

  test('spanQuad measures along the direction it is given and across its left normal', () => {
    const quad = spanQuad({ x: 0, z: 0 }, { x: 2, z: 0 }, [0, 1], [-0.5, 0.5]);
    expect(quadContains(obbQuad({ x: 0.5, z: 0, hx: 0.5, hz: 0.5, angle: 0 }), quad, 1e-6)).toBe(true);
  });
});

describe('door swing', () => {
  const plan = solvePlan(lShapePlan);
  const wall = lShapePlan.walls.find((candidate) => candidate.id === L_SHAPE.wall.wPart)!;
  const opening = wall.openings![0]!;

  test('an authored hinge and swing win over the default', () => {
    const swing = resolveDoorSwing(lShapePlan, plan, wall, { ...opening, hinge: 'b', swing: 'out' }, openingFrameWidth);
    expect(swing.hinge).toBe('b');
    expect(swing.swing).toBe('out');
    // `w-part` runs n2 (6, 0) -> n5 (6, 5); hinge 'b' is the jamb at the larger z.
    expect(swing.pivot.z).toBeGreaterThan(opening.center);
    // 'out' is the right of a -> b, so the leaf opens towards +x, into room B.
    expect(swing.open.x).toBeCloseTo(1, 6);
    expect(swing.roomId).toBe(L_SHAPE.room.b);
  });

  test('the default swings into the larger room and hinges away from the wall end', () => {
    const swing = resolveDoorSwing(lShapePlan, plan, wall, opening, openingFrameWidth);
    expect(swing.swing).toBe('in');
    expect(swing.roomId).toBe(L_SHAPE.room.a);
    expect(swing.open.x).toBeCloseTo(-1, 6);
    // Off-centre openings hinge on the jamb with more wall beside it.
    const nearA = resolveDoorSwing(lShapePlan, plan, wall, { ...opening, center: 0.8 }, openingFrameWidth);
    expect(nearA.hinge).toBe('b');
    const nearB = resolveDoorSwing(lShapePlan, plan, wall, { ...opening, center: 4.2 }, openingFrameWidth);
    expect(nearB.hinge).toBe('a');
  });

  test('the closed leaf lies in the opening and the resting leaf stands square to the wall', () => {
    const swing = resolveDoorSwing(lShapePlan, plan, wall, opening, openingFrameWidth);
    for (const corner of doorLeafQuad(swing, 0)) {
      expect(Math.abs(corner.x - 6)).toBeLessThan(0.05);
      expect(corner.z).toBeGreaterThan(2.0);
      expect(corner.z).toBeLessThan(3.0);
    }
    const rest = doorLeafQuad(swing, LEAF_REST_ANGLE_RAD);
    const tip = rest.reduce((far, corner) => (Math.abs(corner.x - 6) > Math.abs(far.x - 6) ? corner : far), rest[0]!);
    expect(6 - tip.x).toBeCloseTo(swing.leaf, 2);
    expect(Math.abs(tip.z - swing.pivot.z)).toBeLessThan(0.05);
  });

  test('the swept sector never turns past a quarter and stays on the swing side', () => {
    const swing = resolveDoorSwing(lShapePlan, plan, wall, opening, openingFrameWidth);
    for (const quad of doorSweepQuads(swing)) {
      for (const corner of quad) expect(corner.x).toBeLessThanOrEqual(6 + 0.03);
    }
  });
});

describe('hard rules', () => {
  test('rule 1 catches an object buried in a wall and clears one standing flush against it', () => {
    const buried = lint(sceneWith([{ id: ITEM.aWardrobe, type: 'wardrobe', position: { x: 6, y: 0, z: 4 }, rotationY: Math.PI / 2 }]));
    expect(ofRule(buried, 'inside-a-wall').map((issue) => issue.ids[0])).toEqual([ITEM.aWardrobe]);

    // Room A's north face is at z = 7.85; a 0.60 deep wardrobe centred at 7.55 touches it.
    const flush = lint(sceneWith([{ id: ITEM.aWardrobe, type: 'wardrobe', position: { x: 3, y: 0, z: 7.55 }, rotationY: Math.PI }]));
    expect(ofRule(flush, 'inside-a-wall')).toEqual([]);
  });

  test('rule 2 catches interpenetration but lets a table lamp stand on its nightstand', () => {
    const clash = lint(
      sceneWith([
        { id: ITEM.aSofa, type: 'sofa', position: { x: 3, y: 0, z: 4 } },
        { id: ITEM.aTable, type: 'table', position: { x: 3.2, y: 0, z: 4 } },
      ]),
    );
    expect(ofRule(clash, 'no-interpenetration')).toHaveLength(1);

    const onTop = lint(
      sceneWith([
        { id: ITEM.aNightstand, type: 'nightstand', position: { x: 3, y: 0, z: 7.6 }, rotationY: Math.PI },
        { id: ITEM.aTableLamp, type: 'table-lamp', position: { x: 3, y: 0.56, z: 7.6 } },
      ]),
    );
    expect(ofRule(onTop, 'no-interpenetration')).toEqual([]);
  });

  test('rule 3 keeps both sides of a door clear', () => {
    // `door-ab` sits at (6, 2.5); room A is on -x, room B on +x.
    const issues = ofRule(
      lint(sceneWith([{ id: ITEM.aWardrobe, type: 'wardrobe', position: { x: 5.3, y: 0, z: 2.5 }, rotationY: -Math.PI / 2 }])),
      'door-clear-zone',
    );
    expect(issues.map((issue) => issue.ids)).toEqual([[L_SHAPE.opening.doorAb, ITEM.aWardrobe]]);
  });

  test('rule 4 follows the authored swing: the same object blocks one side and not the other', () => {
    const asset: DemoAsset = { id: ITEM.bWardrobe, type: 'wardrobe', position: { x: 6.5, y: 0, z: 3.4 }, rotationY: Math.PI / 2 };
    const intoB = ofRule(lint(sceneWith([asset], withDoor({ hinge: 'b', swing: 'out' }))), 'door-swing-path');
    expect(intoB.map((issue) => issue.ids)).toEqual([[L_SHAPE.opening.doorAb, ITEM.bWardrobe]]);
    const intoA = ofRule(lint(sceneWith([asset], withDoor({ hinge: 'b', swing: 'in' }))), 'door-swing-path');
    expect(intoA).toEqual([]);
  });

  test('rule 4 never lets a leaf sweep through a wall', () => {
    for (const scene of [sceneWith([], withDoor({ hinge: 'a' })), sceneWith([], withDoor({ hinge: 'b' }))]) {
      expect(ofRule(lint(scene), 'door-swing-path')).toEqual([]);
    }
  });

  test('rule 5 checks the back plane, the span, the openings and the mounting height', () => {
    // Room A's north face is z = 7.85; art is 0.05 deep, so its centre sits at 7.82.
    const good = lint(sceneWith([{ id: ITEM.aArt, type: 'art', position: { x: 3, y: 1.5, z: 7.82 }, rotationY: Math.PI }]));
    expect(ofRule(good, 'wall-hung')).toEqual([]);

    const tooHigh = lint(sceneWith([{ id: ITEM.aArt, type: 'art', position: { x: 3, y: 1.9, z: 7.82 }, rotationY: Math.PI }]));
    expect(ofRule(tooHigh, 'wall-hung').map((issue) => issue.message)).toEqual([
      expect.stringContaining('hangs at 1.90 m') as unknown as string,
    ]);

    const sunk = lint(sceneWith([{ id: ITEM.aArt, type: 'art', position: { x: 3, y: 1.5, z: 7.9 }, rotationY: Math.PI }]));
    expect(ofRule(sunk, 'wall-hung').some((issue) => issue.message.includes('off side'))).toBe(true);

    // The south face carries `window-a-south` from x = 3.15 to 5.15, sill 0.82.
    const acrossWindow = lint(sceneWith([{ id: ITEM.aArt, type: 'art', position: { x: 4.15, y: 1.5, z: 0.18 }, rotationY: 0 }]));
    expect(ofRule(acrossWindow, 'wall-hung').some((issue) => issue.ids.includes(L_SHAPE.opening.windowASouth))).toBe(true);
  });

  test('rule 6 reports a door with no free floor in front of it', () => {
    const issues = ofRule(
      lint(sceneWith([{ id: ITEM.aWardrobe, type: 'wardrobe', position: { x: 5.0, y: 0, z: 2.5 }, rotationY: -Math.PI / 2 }])),
      'circulation',
    );
    expect(issues.some((issue) => issue.ids.includes(L_SHAPE.opening.doorAb))).toBe(true);
  });

  test('rule 7 lets a low object stand under a window and refuses a tall one', () => {
    const low = lint(sceneWith([{ id: ITEM.aDesk, type: 'desk', position: { x: 4.15, y: 0, z: 0.5 }, rotationY: Math.PI }]));
    expect(ofRule(low, 'window-clearance')).toEqual([]);
    const tall = lint(sceneWith([{ id: ITEM.aWardrobe, type: 'wardrobe', position: { x: 4.15, y: 0, z: 0.45 }, rotationY: Math.PI }]));
    expect(ofRule(tall, 'window-clearance').map((issue) => issue.ids)).toEqual([[L_SHAPE.opening.windowASouth, ITEM.aWardrobe]]);
  });
});

describe('the bank of a baked project', () => {
  /** One project archetype, in the shape `projectLayoutCatalogue` reads. */
  const library = {
    objects: [
      {
        id: ITEM.boxSofa,
        anchor: 'floor' as const,
        dims: [2.1, 0.85, 0.95] as [number, number, number],
        defaultVariant: ITEM.boxSofaVariant,
        variants: [{ id: ITEM.boxSofaVariant }],
      },
    ],
  };

  test('sees the project object AND the legacy placement the shipped bank still owns', () => {
    // A project document carries `type`-only placements no exporter rewrote:
    // a linter that reads only the manifest reports half a room.
    const scene = sceneWith([
      { id: ITEM.pSofa, type: ITEM.boxSofa, asset: ITEM.boxSofa, position: { x: 3, y: 0, z: 4 } },
      { id: ITEM.aTable, type: 'table', position: { x: 3.2, y: 0, z: 4 } },
    ]);
    const issues = lintLayout(scene, solvePlan(scene), projectLayoutCatalogue(library));

    expect(ofRule(issues, 'no-interpenetration').map((issue) => [...issue.ids].sort())).toEqual([[ITEM.aTable, ITEM.pSofa].sort()]);
  });

  /** A rug and a plant of a baked library: overall boxes, with the floor share declared. */
  const floorShare = {
    objects: [
      {
        id: ITEM.boxSofa,
        anchor: 'floor' as const,
        category: 'decor/rugs',
        dims: [2, 0.4, 1.4] as [number, number, number],
        layout: { blockingHeight: 0.02 },
        defaultVariant: ITEM.boxSofaVariant,
        variants: [{ id: ITEM.boxSofaVariant }],
      },
      {
        id: ITEM.plant,
        anchor: 'floor' as const,
        category: 'decor/plants',
        dims: [0.8, 1.6, 0.6] as [number, number, number],
        layout: { footprint: 0.25 },
        defaultVariant: ITEM.plantVariant,
        variants: [{ id: ITEM.plantVariant }],
      },
    ],
  };

  test('reads the same floor footprint as the walk: none for a rug, the fraction for a plant, an explicit box when declared', () => {
    const catalogue = projectLayoutCatalogue(floorShare);
    const at = { x: 3, y: 0, z: 4 };
    expect(catalogue({ id: ITEM.pSofa, type: ITEM.boxSofa, asset: ITEM.boxSofa, position: at })?.footprint).toBeNull();
    expect(catalogue({ id: ITEM.pSofa, type: ITEM.plant, asset: ITEM.plant, position: at })?.footprint).toEqual({ hx: 0.1, hz: 0.075 });
    expect(
      catalogue({ id: ITEM.pSofa, type: ITEM.plant, asset: ITEM.plant, position: at, collision: { hx: 0.5, hz: 0.5 } })?.footprint,
    ).toEqual({
      hx: 0.5,
      hz: 0.5,
    });
  });

  test('a project rug under a table raises nothing', () => {
    const scene = sceneWith([
      { id: ITEM.pSofa, type: ITEM.boxSofa, asset: ITEM.boxSofa, position: { x: 3, y: 0, z: 4 } },
      { id: ITEM.aTable, type: 'table', position: { x: 3.2, y: 0, z: 4 } },
    ]);
    const issues = lintLayout(scene, solvePlan(scene), projectLayoutCatalogue(floorShare));
    expect(issues.filter((issue) => issue.ids.includes(ITEM.pSofa))).toEqual([]);
  });
});

describe('soft rules', () => {
  test('rule 8 warns about a case good marooned in the middle of a room', () => {
    const issues = ofRule(
      lint(sceneWith([{ id: ITEM.aBookshelf, type: 'bookshelf', position: { x: 3, y: 0, z: 4 } }])),
      'case-goods-on-a-wall',
    );
    expect(issues.map((issue) => issue.ids)).toEqual([[ITEM.aBookshelf]]);
    expect(issues[0]!.severity).toBe('warning');
  });

  test('rule 10 warns when a floor lamp stands inside the sofa', () => {
    const issues = ofRule(
      lint(
        sceneWith([
          { id: ITEM.aSofa, type: 'sofa', position: { x: 3, y: 0, z: 7.4 }, rotationY: Math.PI },
          { id: ITEM.aLamp, type: 'lamp', position: { x: 3, y: 0, z: 7.4 } },
        ]),
      ),
      'seating-group',
    );
    expect(issues.map((issue) => issue.ids)).toEqual([[ITEM.aLamp, ITEM.aSofa]]);
  });

  test('rule 11 warns about a chair that is not tucked to its table', () => {
    const issues = ofRule(
      lint(
        sceneWith([
          { id: ITEM.aTable, type: 'table', position: { x: 3, y: 0, z: 4 } },
          { id: ITEM.aChair, type: 'chair', position: { x: 3, y: 0, z: 5.6 } },
        ]),
      ),
      'dining-tuck',
    );
    expect(issues.some((issue) => issue.message.includes('tuck it'))).toBe(true);
  });
});

describe('reporting', () => {
  test('an empty room raises nothing and describes as a clean bill', () => {
    const issues = lint(sceneWith([]));
    expect(issues).toEqual([]);
    expect(countIssues(issues)).toEqual({ errors: 0, warnings: 0, byRule: {} });
    expect(describeIssues(issues)).toBe('0 error(s), 0 warning(s)');
  });

  test('describeIssues names the rule, the severity, the place and the tally', () => {
    const issues = lint(sceneWith([{ id: ITEM.aWardrobe, type: 'wardrobe', position: { x: 6, y: 0, z: 4 }, rotationY: Math.PI / 2 }]));
    const text = describeIssues(issues);
    expect(text).toContain('rule inside-a-wall error');
    expect(text).toContain(ITEM.aWardrobe);
    expect(text.split('\n').at(-1)).toContain('error(s)');
  });
});

/**
 * Rule 14, the hall. Three separate questions in one rule, so three cases —
 * the L-shape fixture's entrance is `door-entry` on `w-s-a`, 1.25 m from node
 * `n1`, swinging into room `a`.
 */
describe('rule hall', () => {
  test('a coat rack inside a door swing is reported, with the gap it left', () => {
    const rack: DemoAsset = { id: ITEM.aCoatRack, type: 'coat-rack', position: { x: 1.4, y: 0, z: 0.6 } };
    const issues = ofRule(lint(sceneWith([rack])), 'hall');
    const swing = issues.find((issue) => issue.message.includes('from the swing'));
    expect(swing?.ids).toEqual([ITEM.aCoatRack, L_SHAPE.opening.doorEntry]);
    expect(swing?.message).toContain(`from the swing of ${L_SHAPE.opening.doorEntry}`);
  });

  test('a coat rack well clear of every swing is not', () => {
    const rack: DemoAsset = { id: ITEM.aCoatRack, type: 'coat-rack', position: { x: 4.6, y: 0, z: 6.6 } };
    expect(ofRule(lint(sceneWith([rack])), 'hall').some((issue) => issue.message.includes('swing'))).toBe(false);
  });

  test('a mirror hung off the centre of its host is reported, with the offset', () => {
    // The console runs along the south wall, so "sideways" is the x axis.
    const host: DemoAsset = { id: ITEM.aConsole, type: 'console', position: { x: 4.4, y: 0, z: 7.6 }, rotationY: Math.PI };
    const mirror: DemoAsset = { id: ITEM.aMirror, type: 'mirror', position: { x: 3.2, y: 1.5, z: 7.8 }, rotationY: Math.PI };
    const issues = ofRule(lint(sceneWith([host, mirror])), 'hall');
    const offset = issues.find((issue) => issue.ids.includes(ITEM.aMirror));
    expect(offset?.ids).toEqual([ITEM.aMirror, ITEM.aConsole]);
    expect(offset?.message).toContain(`off the centre of ${ITEM.aConsole}`);
  });

  test('a mirror centred over its host is not', () => {
    const host: DemoAsset = { id: ITEM.aConsole, type: 'console', position: { x: 4.4, y: 0, z: 7.6 }, rotationY: Math.PI };
    const mirror: DemoAsset = { id: ITEM.aMirror, type: 'mirror', position: { x: 4.4, y: 1.5, z: 7.8 }, rotationY: Math.PI };
    expect(ofRule(lint(sceneWith([host, mirror])), 'hall').some((issue) => issue.message.includes('off the centre'))).toBe(false);
  });

  test('furniture standing on the axis from the entrance into the flat is reported', () => {
    const blocker: DemoAsset = { id: ITEM.aDresser, type: 'dresser', position: { x: 1.25, y: 0, z: 0.9 } };
    const issues = ofRule(lint(sceneWith([blocker])), 'hall');
    const axis = issues.find((issue) => issue.message.includes('on the axis'));
    expect(axis?.ids).toEqual([L_SHAPE.opening.doorEntry, ITEM.aDresser]);
    expect(axis?.message).toContain(`into ${L_SHAPE.room.a}`);
  });

  test('the same piece away from the axis is not', () => {
    const blocker: DemoAsset = { id: ITEM.aDresser, type: 'dresser', position: { x: 4.6, y: 0, z: 4 } };
    expect(ofRule(lint(sceneWith([blocker])), 'hall').some((issue) => issue.message.includes('on the axis'))).toBe(false);
  });
});
