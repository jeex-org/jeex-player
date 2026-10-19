import { describe, expect, test } from 'bun:test';
import { arcSegments, dist } from './plan-geometry.js';
import { PlanError, assertPlanarEmbedding, assignRooms, buildGraph, halfEdgeArc } from './plan-graph.js';
import type { PlanNode, Room, Wall } from '../scene/types.js';
import { FINISH } from '../materials/finish-ids.js';

/** Ids of the inline plans below, keyed by the readable id each replaces. */
const ID = {
  s1: '01a12ff5-5c18-71e7-af17-59daec34a718',
  s2: '01a12ff5-5c19-76d6-a8a2-84792cc14fb5',
  s3: '01a12ff5-5c1a-70d2-ab72-e3f86321c086',
  s4: '01a12ff5-5c1b-7ec4-893b-16c2667d02a9',
  sqS: '01a12ff5-5c1c-78a2-890e-34264a515794',
  sqE: '01a12ff5-5c1d-7a87-934e-4147a8f0aa85',
  sqN: '01a12ff5-5c1e-7974-9d4d-69f79fa24dc2',
  sqW: '01a12ff5-5c1f-7836-937f-6b9d28fbbb20',
  n1: '01a12ff5-5c20-7d80-8c66-5fa5f2232364',
  n2: '01a12ff5-5c21-76d7-818b-f96be34147a1',
  n3: '01a12ff5-5c22-77ed-a3fe-3885ed648fce',
  n4: '01a12ff5-5c23-7494-ba4e-e690980337d2',
  n5: '01a12ff5-5c24-7633-bf80-43e6876387d3',
  n6: '01a12ff5-5c25-7f6d-a6d1-8e156e952679',
  n7: '01a12ff5-5c26-706e-a01b-439949639af8',
  n8: '01a12ff5-5c27-7777-8be5-9aec6b28e8b5',
  wSA: '01a12ff5-5c28-775d-9429-1cacd517241e',
  wSB: '01a12ff5-5c29-717d-8b43-95303e8c9c8e',
  wE: '01a12ff5-5c2a-75cd-94ce-0304ed544666',
  wNB: '01a12ff5-5c2b-7a1a-9017-019392b37ff9',
  wStep: '01a12ff5-5c2c-77ab-a0cc-a4a8cb5d563d',
  wNA: '01a12ff5-5c2d-744d-8d73-bdd779ef8c73',
  wW: '01a12ff5-5c2e-7089-882a-bcdd92aca8d7',
  wPart: '01a12ff5-5c2f-7dd5-84d4-a72c036e2d01',
  wStub: '01a12ff5-5c30-7321-ada5-f9cb872d780c',
  a: '01a12ff5-5c31-7aea-9b16-ac88768bb1ab',
  b: '01a12ff5-5c32-72c3-9a6c-67cddaedcc40',
  c: '01a12ff5-5c33-785b-81ce-58f8da586b91',
  orphan: '01a12ff5-5c34-72ec-84c3-31ca77ce6d44',
  nope: '01a12ff5-5c35-7e07-9358-9a0d6c56228d',
  sqX: '01a12ff5-5c36-7507-8b21-b4f47b8ef031',
  sqLoop: '01a12ff5-5c37-7c82-84e5-1d55b33b31a0',
  f1: '01a12ff5-5c38-74e3-83cd-0c7c1a8d2dd6',
  f2: '01a12ff5-5c39-7a8d-ac55-94bcc16d406a',
  f3: '01a12ff5-5c3a-7cb5-8792-db31a5e988cf',
  f4: '01a12ff5-5c3b-7858-9e10-2620ed3c0b77',
  fS: '01a12ff5-5c3c-706a-8e87-e1d5368667e1',
  fE: '01a12ff5-5c3d-7a6e-a96f-357c1a3e7d52',
  fN: '01a12ff5-5c3e-7316-819e-64586b1147eb',
  fW: '01a12ff5-5c3f-7477-bce7-c3496b78f2f6',
  b1: '01a12ff5-5c40-7080-9b45-d41ed972c7e8',
  b2: '01a12ff5-5c41-776c-b204-78670133b496',
  b3: '01a12ff5-5c42-7dd0-b5b4-4b60b8acc2d3',
  b4: '01a12ff5-5c43-716f-9824-44b1c2e75c04',
  bay: '01a12ff5-5c44-7428-a15a-9a09cf723b91',
  bayE: '01a12ff5-5c45-7de4-8cf2-c93fae7ade1a',
  bayN: '01a12ff5-5c46-7a18-afce-2d780434352b',
  bayW: '01a12ff5-5c47-7f00-8807-ca6ff9913b6b',
  t1: '01a12ff5-5c48-7854-950d-f27f756f9e56',
  t2: '01a12ff5-5c49-7884-9875-351010c1ade5',
  t3: '01a12ff5-5c4a-7141-b224-bf0b7a502551',
  t4: '01a12ff5-5c4b-7fa4-bc3d-b7ab115e5d89',
  tS: '01a12ff5-5c4c-731e-a081-692560cea0d6',
  tE: '01a12ff5-5c4d-76ae-aad3-6c6c55819749',
  tN: '01a12ff5-5c4e-76c7-8cc4-7856fd389f0b',
  tW: '01a12ff5-5c4f-72f9-8ae6-cfa5bc3a3c33',
  x1: '01a12ff5-5c50-7430-bbf5-0a5eac870708',
  x2: '01a12ff5-5c51-721e-be4f-001b3e063ff5',
  x3: '01a12ff5-5c52-747e-94a6-2fbf1658f27b',
  x4: '01a12ff5-5c53-7735-8f4d-fe782388c4a8',
  xA: '01a12ff5-5c54-76a0-b934-a0db52163cb1',
  xB: '01a12ff5-5c55-79eb-8072-4376efe71bc6',
  j1: '01a12ff5-5c56-7f6a-99f5-6e37bce0b24c',
  j2: '01a12ff5-5c57-7947-a3f7-c10e540ca334',
  j3: '01a12ff5-5c58-774e-8514-5c3d06fa76c7',
  j4: '01a12ff5-5c59-7eb8-b6f3-86bcc3ce465c',
  jBase: '01a12ff5-5c5a-71cc-9d76-6c5b51b67d13',
  jStem: '01a12ff5-5c5b-75fd-a4ef-78245381b451',
  o1: '01a12ff5-5c5c-700a-83c6-d76ba8ce1600',
  o2: '01a12ff5-5c5d-79a2-97cb-450a4498dc8b',
  o3: '01a12ff5-5c5e-798c-a5fd-6f5af55f2f79',
  o4: '01a12ff5-5c5f-7804-be72-0315d9345aa7',
  oA: '01a12ff5-5c60-76ec-a33f-70f03be02b44',
  oB: '01a12ff5-5c61-764d-b55f-a0ece31fdd28',
  c1: '01a12ff5-5c62-7c09-9820-f6f5987ff1af',
  c2: '01a12ff5-5c63-7b85-a399-c9b960e319f3',
  c3: '01a12ff5-5c64-7c5e-8616-791c8572bedb',
  cA: '01a12ff5-5c65-7e8b-82cf-63c34b0293cd',
  cB: '01a12ff5-5c66-7c85-9d26-26748a91c908',
  a1: '01a12ff5-5c67-72f4-b9a0-5abed22f31e6',
  a2: '01a12ff5-5c68-7a84-b92c-b908ea09e952',
  curve: '01a12ff5-5c69-7358-85e9-61558c1f907f',
  stem: '01a12ff5-5c6a-7fdb-a9ae-2e6afb5c781c',
  m1: '01a12ff5-5c6b-7f5f-af51-c5642af05d8a',
  m2: '01a12ff5-5c6c-7f53-b5f8-5dabcd02de98',
  m3: '01a12ff5-5c6d-78ac-a7c4-452f1429d7c5',
  m4: '01a12ff5-5c6e-73c9-9778-3b04f1a5ff54',
  mBase: '01a12ff5-5c6f-7638-9707-cf46c9d4415f',
  mStem: '01a12ff5-5c70-7de1-b6c1-d056135a7fd0',
  sqCut: '01a12ff5-5c71-7976-af43-870930b1257b',
  sqBar: '01a12ff5-5c72-7037-961f-214448f426f2',
} as const;

const node = (id: string, x: number, z: number): PlanNode => ({ id, p: { x, z } });
const wall = (id: string, a: string, b: string, thickness = 0.3): Wall => ({ id, a, b, thickness });
const room = (id: string, x: number, z: number): Room => ({
  id,
  name: id,
  anchor: { x, z },
  floorMaterial: FINISH.oak,
});

/** Unit-ish square: one room face, one facade face. */
const squareNodes = [node(ID.s1, 0, 0), node(ID.s2, 4, 0), node(ID.s3, 4, 4), node(ID.s4, 0, 4)];
const squareWalls = [wall(ID.sqS, ID.s1, ID.s2), wall(ID.sqE, ID.s2, ID.s3), wall(ID.sqN, ID.s3, ID.s4), wall(ID.sqW, ID.s4, ID.s1)];

/**
 * The reference L-shape plan: room A on the left (x < 6, z 0..8), room B on the
 * right (x 6..10, z 0..5). The boundary at x = 6 is a 0.10 partition below
 * z = 5 and a 0.30 outer wall above it, so room A steps by 0.10 at z = 5.
 */
const lNodes = [
  node(ID.n1, 0, 0),
  node(ID.n2, 6, 0),
  node(ID.n3, 10, 0),
  node(ID.n4, 10, 5),
  node(ID.n5, 6, 5),
  node(ID.n6, 6, 8),
  node(ID.n7, 0, 8),
];
const lWalls: Wall[] = [
  wall(ID.wSA, ID.n1, ID.n2),
  wall(ID.wSB, ID.n2, ID.n3),
  wall(ID.wE, ID.n3, ID.n4),
  wall(ID.wNB, ID.n4, ID.n5),
  wall(ID.wStep, ID.n5, ID.n6),
  wall(ID.wNA, ID.n6, ID.n7),
  wall(ID.wW, ID.n7, ID.n1),
  { id: ID.wPart, a: ID.n2, b: ID.n5, thickness: 0.1, role: 'partition' },
];
const roomA = room(ID.a, 3, 4);
const roomB = room(ID.b, 8, 2.5);

describe('buildGraph', () => {
  test('a closed square yields one positive room face and one negative facade', () => {
    const graph = buildGraph(squareNodes, squareWalls);
    expect(graph.faces.length).toBe(1);
    expect(graph.faces[0]!.signedArea).toBeCloseTo(16, 9);
    expect(graph.facade.signedArea).toBeCloseTo(-16, 9);
    expect(graph.faces[0]!.edges.length).toBe(4);
    expect(graph.facade.edges.length).toBe(4);
  });

  test('the room face walks every wall on its L side', () => {
    const graph = buildGraph(squareNodes, squareWalls);
    for (const edge of graph.faces[0]!.edges) {
      expect(edge.side).toBe('L');
      expect(edge.forward).toBe(true);
    }
    for (const edge of graph.facade.edges) expect(edge.side).toBe('R');
  });

  test('nodes and walls are indexed by id', () => {
    const graph = buildGraph(squareNodes, squareWalls);
    expect(graph.nodes.get(ID.s3)!.p).toEqual({ x: 4, z: 4 });
    expect(graph.walls.get(ID.sqN)!.a).toBe(ID.s3);
  });

  test('the L-shape plan yields two room faces plus a facade', () => {
    const graph = buildGraph(lNodes, lWalls);
    expect(graph.faces.length).toBe(2);
    const areas = graph.faces.map((f) => f.signedArea).sort((x, y) => x - y);
    expect(areas[0]).toBeCloseTo(20, 9); // room B: 4 x 5
    expect(areas[1]).toBeCloseTo(48, 9); // room A: 6 x 8
    expect(graph.facade.signedArea).toBeLessThan(0);
  });

  test('the partition is L in one room and R in the other', () => {
    const graph = buildGraph(lNodes, lWalls);
    const assigned = assignRooms(graph, [roomA, roomB]);
    const sides = new Map<string, 'L' | 'R'>();
    for (const [face, r] of assigned) {
      const edge = face.edges.find((e) => e.wallId === ID.wPart);
      expect(edge).toBeDefined();
      sides.set(r.id, edge!.side);
    }
    expect(sides.get(ID.a)).toBe('L');
    expect(sides.get(ID.b)).toBe('R');
  });

  test('room A walks five edges, room B four', () => {
    const graph = buildGraph(lNodes, lWalls);
    const assigned = assignRooms(graph, [roomA, roomB]);
    for (const [face, r] of assigned) {
      expect(face.edges.length).toBe(r.id === ID.a ? 5 : 4);
    }
  });
});

describe('buildGraph is a function of the plan, not of the document order', () => {
  /** `(from, wallId, side)` — the tuple the graph breaks every tie by. */
  const startOf = (face: { edges: readonly { from: string; wallId: string; side: string }[] }): string => {
    const first = face.edges[0]!;
    return `${first.from}/${first.wallId}/${first.side}`;
  };

  test('a face cycle starts at its smallest half-edge, not at the first wall declared', () => {
    const graph = buildGraph(squareNodes, squareWalls);
    // Room face: s1/sq-s/L is the minimum of s1/sq-s/L, s2/sq-e/L, s3/sq-n/L, s4/sq-w/L.
    expect(startOf(graph.faces[0]!)).toBe(`${ID.s1}/${ID.sqS}/L`);
    // Facade: s1/sq-w/R beats s2/sq-s/R, s3/sq-e/R, s4/sq-n/R on the node id.
    expect(startOf(graph.facade)).toBe(`${ID.s1}/${ID.sqW}/R`);
  });

  test('the same square declared back to front gives the same graph', () => {
    const forward = buildGraph(squareNodes, squareWalls);
    const backward = buildGraph([...squareNodes].reverse(), [...squareWalls].reverse());
    expect(backward.faces.map(startOf)).toEqual(forward.faces.map(startOf));
    expect(backward.faces[0]!.edges).toEqual(forward.faces[0]!.edges);
    expect(backward.faces[0]!.polygon).toEqual(forward.faces[0]!.polygon);
    expect(backward.facade.edges).toEqual(forward.facade.edges);
    expect(backward.facade.polygon).toEqual(forward.facade.polygon);
  });

  test('the L-shape faces keep their order and their loops when the walls are reversed', () => {
    const forward = buildGraph(lNodes, lWalls);
    const backward = buildGraph([...lNodes].reverse(), [...lWalls].reverse());
    // Room A (n1/w-s-a/L) sorts before room B (n2/w-s-b/L) whatever the document says.
    expect(forward.faces.map(startOf)).toEqual([`${ID.n1}/${ID.wSA}/L`, `${ID.n2}/${ID.wSB}/L`]);
    expect(backward.faces.map(startOf)).toEqual(forward.faces.map(startOf));
    for (let i = 0; i < forward.faces.length; i += 1) {
      expect(backward.faces[i]!.edges).toEqual(forward.faces[i]!.edges);
      expect(backward.faces[i]!.polygon).toEqual(forward.faces[i]!.polygon);
    }
  });

  test('the angular fan at a node survives a reversal, tie-break included', () => {
    // n2 has degree 3 (w-s-a, w-s-b, w-part); the fan decides `next`, so an
    // order that moved with the document would re-cut the faces themselves.
    const forward = buildGraph(lNodes, lWalls);
    const backward = buildGraph([...lNodes].reverse(), [...lWalls].reverse());
    const around = (graph: ReturnType<typeof buildGraph>, nodeId: string): string[] =>
      graph.faces
        .flatMap((f) => f.edges)
        .concat(graph.facade.edges)
        .filter((e) => e.from === nodeId)
        .map((e) => `${e.wallId}:${e.side}`)
        .sort();
    expect(around(backward, ID.n2)).toEqual(around(forward, ID.n2));
    expect(around(forward, ID.n2)).toEqual([`${ID.wPart}:L`, `${ID.wSA}:R`, `${ID.wSB}:L`].sort());
  });
});

describe('buildGraph errors', () => {
  test('a dangling wall raises DANGLING_NODE', () => {
    const nodes = [...lNodes, node(ID.n8, 3, 3)];
    const walls = [...lWalls, wall(ID.wStub, ID.n1, ID.n8)];
    expect(() => buildGraph(nodes, walls)).toThrow(PlanError);
    try {
      buildGraph(nodes, walls);
    } catch (error) {
      expect((error as PlanError).planCode).toBe('DANGLING_NODE');
    }
  });

  test('a refusal quoting a node id bounds what the document put there', () => {
    const id = `https://intranet.example/hr ${'S'.repeat(400)}`;
    try {
      buildGraph([...squareNodes, node(id, 9, 9)], squareWalls);
      throw new Error('expected PlanError');
    } catch (error) {
      const { message } = error as PlanError;
      expect(message).toContain('<url>');
      expect(message).toContain(`${'S'.repeat(32)}…`);
      expect(message).not.toContain('intranet');
      expect(message.length).toBeLessThanOrEqual(300);
    }
  });

  test('an unreferenced node raises DANGLING_NODE', () => {
    expect(() => buildGraph([...squareNodes, node(ID.orphan, 9, 9)], squareWalls)).toThrow(PlanError);
  });

  test('a wall pointing at a missing node raises BAD_REF', () => {
    const walls = [...squareWalls, wall(ID.sqX, ID.s1, ID.nope)];
    try {
      buildGraph(squareNodes, walls);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('BAD_REF');
    }
  });

  test('a wall with a === b raises BAD_REF', () => {
    try {
      buildGraph(squareNodes, [...squareWalls, wall(ID.sqLoop, ID.s1, ID.s1)]);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('BAD_REF');
    }
  });

  test('two disjoint squares raise DISCONNECTED', () => {
    const far = [node(ID.f1, 20, 0), node(ID.f2, 24, 0), node(ID.f3, 24, 4), node(ID.f4, 20, 4)];
    const farWalls = [wall(ID.fS, ID.f1, ID.f2), wall(ID.fE, ID.f2, ID.f3), wall(ID.fN, ID.f3, ID.f4), wall(ID.fW, ID.f4, ID.f1)];
    try {
      buildGraph([...squareNodes, ...far], [...squareWalls, ...farWalls]);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('DISCONNECTED');
    }
  });

  test('an arc whose radius is below half the chord raises BAD_ARC', () => {
    const walls: Wall[] = [{ ...wall(ID.sqS, ID.s1, ID.s2), arc: { radius: 1.5, ccw: false } }, ...squareWalls.slice(1)];
    try {
      buildGraph(squareNodes, walls);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('BAD_ARC');
    }
  });
});

describe('assignRooms', () => {
  test('two anchors inside one face raise MULTI_ANCHOR', () => {
    const graph = buildGraph(lNodes, lWalls);
    try {
      assignRooms(graph, [room(ID.a, 3, 4), room(ID.b, 2, 6)]);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('MULTI_ANCHOR');
    }
  });

  test('a face without an anchor raises NO_ANCHOR', () => {
    const graph = buildGraph(lNodes, lWalls);
    try {
      assignRooms(graph, [roomA]);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('NO_ANCHOR');
    }
  });

  test('a room anchored outside the building raises NO_ANCHOR', () => {
    const graph = buildGraph(lNodes, lWalls);
    try {
      assignRooms(graph, [roomA, roomB, room(ID.c, 50, 50)]);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('NO_ANCHOR');
    }
  });
});

describe('arc walls', () => {
  /** 3.2 m chord with radius 1.6 is a half circle bulging away from the room. */
  const arcNodes = [node(ID.b1, 0, 0), node(ID.b2, 3.2, 0), node(ID.b3, 3.2, 3), node(ID.b4, 0, 3)];
  const arcWalls: Wall[] = [
    { ...wall(ID.bay, ID.b1, ID.b2), arc: { radius: 1.6, ccw: false } },
    wall(ID.bayE, ID.b2, ID.b3),
    wall(ID.bayN, ID.b3, ID.b4),
    wall(ID.bayW, ID.b4, ID.b1),
  ];

  test('the face polygon carries arcSegments + 1 points on the arc edge', () => {
    const graph = buildGraph(arcNodes, arcWalls);
    const face = graph.faces[0]!;
    const arc = halfEdgeArc(
      graph,
      face.edges.find((e) => e.wallId === ID.bay)!,
    )!;
    expect(arc.radius).toBeCloseTo(1.6, 12);
    expect(arc.centre.x).toBeCloseTo(1.6, 12);
    expect(arc.centre.z).toBeCloseTo(0, 12);
    const onCircle = face.polygon.filter((p) => Math.abs(dist(p, arc.centre) - 1.6) < 1e-9);
    expect(onCircle.length).toBe(arcSegments(1.6, Math.PI) + 1);
  });

  test('the bay adds area compared to the straight wall', () => {
    const graph = buildGraph(arcNodes, arcWalls);
    const straight = buildGraph(arcNodes, [wall(ID.bay, ID.b1, ID.b2), ...arcWalls.slice(1)]);
    expect(graph.faces[0]!.signedArea).toBeGreaterThan(straight.faces[0]!.signedArea);
    // 3.2 x 3 rectangle plus a half disc of radius 1.6, minus discretisation loss.
    const ideal = 9.6 + (Math.PI * 1.6 * 1.6) / 2;
    expect(graph.faces[0]!.signedArea).toBeLessThan(ideal);
    expect(ideal - graph.faces[0]!.signedArea).toBeLessThan(0.02);
  });

  test('the facade sees the same circle from the other side', () => {
    const graph = buildGraph(arcNodes, arcWalls);
    const edge = graph.facade.edges.find((e) => e.wallId === ID.bay)!;
    expect(edge.side).toBe('R');
    const arc = halfEdgeArc(graph, edge)!;
    expect(arc.centre.x).toBeCloseTo(1.6, 12);
    expect(arc.centre.z).toBeCloseTo(0, 12);
    expect(arc.sweep).toBeCloseTo(-Math.PI, 12);
  });
});

describe('impossible curved-wall offsets', () => {
  /** 0.60 square whose south side is a semicircle of radius 0.30. */
  const tinyNodes = [node(ID.t1, 0, 0), node(ID.t2, 0.6, 0), node(ID.t3, 0.6, 0.6), node(ID.t4, 0, 0.6)];
  const tinyWalls = (thickness: number): Wall[] => [
    { id: ID.tS, a: ID.t1, b: ID.t2, thickness, arc: { radius: 0.3, ccw: false } },
    wall(ID.tE, ID.t2, ID.t3, 0.1),
    wall(ID.tN, ID.t3, ID.t4, 0.1),
    wall(ID.tW, ID.t4, ID.t1, 0.1),
  ];

  test('an arc whose inner offset radius is below the minimum raises BAD_ARC', () => {
    // radius 0.30 with thickness 0.52 leaves an inner radius of 0.04.
    try {
      buildGraph(tinyNodes, tinyWalls(0.52));
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('BAD_ARC');
      expect((error as PlanError).message).toContain(ID.tS);
    }
  });

  test('an arc whose radius equals half its thickness raises BAD_ARC', () => {
    try {
      buildGraph(tinyNodes, tinyWalls(0.6));
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('BAD_ARC');
    }
  });

  test('an inner radius of exactly MIN_INNER_RADIUS is accepted', () => {
    expect(() => buildGraph(tinyNodes, tinyWalls(0.5))).not.toThrow();
  });
});

describe('assertPlanarEmbedding', () => {
  test('accepts the square and the L-shape plan', () => {
    expect(() => assertPlanarEmbedding(squareNodes, squareWalls)).not.toThrow();
    expect(() => assertPlanarEmbedding(lNodes, lWalls)).not.toThrow();
  });

  test('two centrelines crossing without a shared node raise NON_PLANAR', () => {
    const nodes = [node(ID.x1, 0, 0), node(ID.x2, 4, 4), node(ID.x3, 0, 4), node(ID.x4, 4, 0)];
    const walls = [wall(ID.xA, ID.x1, ID.x2), wall(ID.xB, ID.x3, ID.x4)];
    try {
      assertPlanarEmbedding(nodes, walls);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('NON_PLANAR');
      expect((error as PlanError).message).toContain(ID.xA);
      expect((error as PlanError).message).toContain(ID.xB);
      expect((error as PlanError).message).toContain('2.0000');
    }
  });

  test('a T-junction without a node raises NON_PLANAR', () => {
    const nodes = [node(ID.j1, 0, 0), node(ID.j2, 4, 0), node(ID.j3, 2, 0), node(ID.j4, 2, 3)];
    const walls = [wall(ID.jBase, ID.j1, ID.j2), wall(ID.jStem, ID.j3, ID.j4)];
    try {
      assertPlanarEmbedding(nodes, walls);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('NON_PLANAR');
    }
  });

  test('a collinear overlap of two separate walls raises NON_PLANAR', () => {
    const nodes = [node(ID.o1, 0, 0), node(ID.o2, 4, 0), node(ID.o3, 2, 0), node(ID.o4, 6, 0)];
    const walls = [wall(ID.oA, ID.o1, ID.o2), wall(ID.oB, ID.o3, ID.o4)];
    try {
      assertPlanarEmbedding(nodes, walls);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('NON_PLANAR');
    }
  });

  test('walls sharing a node and overlapping beyond it raise NON_PLANAR', () => {
    const nodes = [node(ID.o1, 0, 0), node(ID.o2, 4, 0), node(ID.o4, 6, 0)];
    const walls = [wall(ID.oA, ID.o1, ID.o2), wall(ID.oB, ID.o1, ID.o4)];
    try {
      assertPlanarEmbedding(nodes, walls);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('NON_PLANAR');
    }
  });

  test('collinear walls meeting head to head at a shared node are planar', () => {
    const nodes = [node(ID.c1, 0, 0), node(ID.c2, 4, 0), node(ID.c3, 9, 0)];
    const walls = [wall(ID.cA, ID.c1, ID.c2), wall(ID.cB, ID.c2, ID.c3)];
    expect(() => assertPlanarEmbedding(nodes, walls)).not.toThrow();
  });

  test('a segment crossing an arc raises NON_PLANAR', () => {
    const nodes = [node(ID.a1, 0, 0), node(ID.a2, 4, 0), node(ID.s1, 2, -3), node(ID.s2, 2, 1)];
    const walls: Wall[] = [{ ...wall(ID.curve, ID.a1, ID.a2), arc: { radius: 2, ccw: false } }, wall(ID.stem, ID.s1, ID.s2)];
    try {
      assertPlanarEmbedding(nodes, walls);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('NON_PLANAR');
      expect((error as PlanError).message).toContain(ID.curve);
    }
  });

  test('a segment clear of the same arc is planar', () => {
    const nodes = [node(ID.a1, 0, 0), node(ID.a2, 4, 0), node(ID.s1, 2, -3), node(ID.s2, 2, -2.5)];
    const walls: Wall[] = [{ ...wall(ID.curve, ID.a1, ID.a2), arc: { radius: 2, ccw: false } }, wall(ID.stem, ID.s1, ID.s2)];
    expect(() => assertPlanarEmbedding(nodes, walls)).not.toThrow();
  });

  test('a near miss inside EPS_PLANAR counts as an intersection', () => {
    const nodes = [node(ID.m1, 0, 0), node(ID.m2, 4, 0), node(ID.m3, 2, -5e-5), node(ID.m4, 2, -2)];
    const walls = [wall(ID.mBase, ID.m1, ID.m2), wall(ID.mStem, ID.m3, ID.m4)];
    try {
      assertPlanarEmbedding(nodes, walls);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('NON_PLANAR');
    }
  });

  test('a gap of one millimetre is no intersection', () => {
    const nodes = [node(ID.m1, 0, 0), node(ID.m2, 4, 0), node(ID.m3, 2, -1e-3), node(ID.m4, 2, -2)];
    const walls = [wall(ID.mBase, ID.m1, ID.m2), wall(ID.mStem, ID.m3, ID.m4)];
    expect(() => assertPlanarEmbedding(nodes, walls)).not.toThrow();
  });

  test('buildGraph rejects a non-planar plan before it walks any face', () => {
    const crossing = [...squareWalls, wall(ID.sqCut, ID.s1, ID.s3), wall(ID.sqBar, ID.s2, ID.s4)];
    try {
      buildGraph(squareNodes, crossing);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('NON_PLANAR');
    }
  });

  test('a diagonal that only meets the square at its own nodes stays planar', () => {
    expect(() => assertPlanarEmbedding(squareNodes, [...squareWalls, wall(ID.sqCut, ID.s1, ID.s3)])).not.toThrow();
  });
});
