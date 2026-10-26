/**
 * Contract tests for the Three.js geometry layer.
 *
 * These pin what the rest of the app reads off the built scene — `userData`
 * keys, the one-mesh-per-face invariant, the finish API and `rebuildOpening` —
 * so splitting `scene-builder.ts` cannot change them silently. Texture
 * generators return `null` without a `document`, so every material falls back
 * to a flat colour here; that does not affect geometry or bookkeeping.
 */

import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { BUILTIN_DEFAULT_CEILING } from '../materials/builtin-library.js';
import { firstFrameColour } from '../materials/library-material.js';
import { describe, expect, spyOn, test } from 'bun:test';
import { draftOf, type Draft } from '../shared/committed.js';
import * as THREE from 'three';
import { SceneBuilder, FURNITURE_GROUP_NAME, type UpgradeResult } from './scene-builder.js';
import { MAX_MODEL_PARALLEL, MAX_PROJECT_BYTES } from '../shared/limits.js';
import { projectBank } from '../assets/project-catalogue.js';
import { Picker } from './picker.js';
import { GLOW_GROUP_NAME } from './selection-glow.js';
import type { BakedProjectManifest } from '../assets/project-manifest.js';
import type { ModelOutcome, ModelRequest } from './model-source.js';
import { solvePlan, type SolvedPlan } from '../plan/plan-solver.js';
import { floorOutline } from '../plan/floor-outline.js';
import { jointCores } from '../plan/plan-joints.js';
import { SceneModel, isApplyOk } from '../scene/scene-model.js';
import {
  TOUCHED_FACADE,
  TOUCHED_SHELL,
  touchedAsset,
  touchedFace,
  touchedFloor,
  touchedRoomWalls,
  type SceneOp,
  type TouchedEntity,
} from '../scene/scene-ops.js';
import { bayPlan, lShapePlan } from '../fixtures/plan-l-shape.js';
import { BAY, L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { ARCHETYPE, OPENING_VARIANT, VARIANT } from '../assets/catalogue-ids.js';
import { ARC_TOL, arcFromChord } from '../plan/plan-geometry.js';
import { FaceMap, faceKey, type FaceKey, type SceneData } from '../scene/types.js';
import { HANGING, hangingManifest, modelFrameBox } from '../fixtures/hanging-pendant.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGltfModelSource } from './model-source.js';
import { parseProjectManifest } from '../assets/project-manifest.schema.js';
import { lampLightTag } from '../assets/artificial-light.js';
import { tintArtificialLights } from '../render/light-temperature.js';
import { setLampBaked } from '../render/baked-surface.js';
import { LAMP_PROJECT_FIXTURE as LAMPS } from '../../tests/fixtures/project/fixture-ids.js';
import { obstaclesFor } from '../assets/asset-footprint.js';
import { projectAssetFacts } from '../assets/asset-facts.js';
import { planDrawingInputs } from '../assets/plan-fixtures.js';
import { buildPlanDrawing } from '../plan/plan-drawing.js';
import { lintContext, lintLayout, projectLayoutCatalogue } from '../layout/layout-lint.js';

type Built = { scene: SceneData; plan: SolvedPlan; builder: SceneBuilder; root: THREE.Group };

function build(scene: SceneData): Built {
  const plan = solvePlan(scene);
  const builder = new SceneBuilder(scene, plan);
  const { root } = builder.build();
  return { scene, plan, builder, root };
}

type Bound = Built & { model: SceneModel; paint: (...ops: SceneOp[]) => void };

/**
 * A builder wired to a model, the way `main.ts` wires it.
 *
 * Painting is a PROJECTION of the document, so the only honest way to test it
 * is end to end: commit an operation and read the public getters back.
 */
function bound(scene: SceneData = lShapePlan): Bound {
  const model = new SceneModel(scene, CATALOGUE_REGISTRIES);
  const builder = new SceneBuilder(model.scene, model.plan);
  const { root } = builder.build();
  builder.bindModel(model);
  const paint = (...ops: SceneOp[]): void => {
    const result = model.apply({ baseRev: model.rev, ops });
    if (!isApplyOk(result)) throw new Error(`expected a commit, got ${result.error}: ${result.message}`);
  };
  return { scene: model.scene, plan: model.plan, builder, root, model, paint };
}

/** Every mesh under `root`, in traversal order. */
function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const list: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) list.push(object);
  });
  return list;
}

function wallMeshes(root: THREE.Object3D): THREE.Mesh[] {
  return meshes(root).filter((mesh) => mesh.userData['surface'] === 'wall');
}

function objectNamed(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? null;
}

/** Clone of `lShapePlan` whose room `b` is a loggia (no ceiling). */
function loggiaScene(): SceneData {
  const scene = draftOf(lShapePlan);
  const room = scene.rooms.find((candidate) => candidate.id === L_SHAPE.room.b);
  if (room) room.kind = 'loggia';
  return scene;
}

const FIXTURES: Array<[string, SceneData]> = [
  ['lShapePlan', lShapePlan],
  ['bayPlan', bayPlan],
];

const ROOM = L_SHAPE.room;
/** Room A's face of the 0.10 partition, the face the paint tests override. */
const A_PART = faceKey(ROOM.a, L_SHAPE.wall.wPart, 'L');
/** Ids nothing in the fixtures carries: fixed UUID v7 literals, never minted. */
const UNKNOWN_OPENING = '01a12ffa-bcf3-72d7-87cd-23d13a46d721';
const UNKNOWN_VARIANT = '01a12ffa-bcf4-7615-824b-4907317c257c';
const GHOST_ROOM = '01a12ffa-bcf5-7422-b5d7-64f60906f6f6';
const UNKNOWN_ASSET = '01a12ffa-bcf6-7e9a-bec8-2162d14c1fe0';

describe('furniture container', () => {
  test('is named FURNITURE_GROUP_NAME, the single source viewer-editor.ts and viewer-debug.ts read it by', () => {
    const { root } = build(lShapePlan);
    expect(objectNamed(root, FURNITURE_GROUP_NAME)).toBeTruthy();
    expect(objectNamed(root, FURNITURE_GROUP_NAME)?.type).toBe('Group');
  });
});

describe('wall face userData contract', () => {
  for (const [label, scene] of FIXTURES) {
    test(`${label}: every wall mesh carries the full painting contract`, () => {
      const { plan, root } = build(scene);
      const faces = wallMeshes(root);
      expect(faces.length).toBeGreaterThan(0);
      for (const mesh of faces) {
        const data = mesh.userData;
        const face = plan.faces.get(data['face'] as FaceKey);
        expect(face).toBeDefined();
        expect(mesh.name).toBe('wall-face');
        expect(data['wallId']).toBe(face!.wallId);
        expect(data['roomId']).toBe(face!.roomId ?? undefined);
        expect(data['isExteriorWall']).toBe(data['roomId'] === undefined);
        const normal = data['outwardNormal'] as { x: number; z: number };
        expect(Math.hypot(normal.x, normal.z)).toBeCloseTo(1, 6);
        expect(typeof data['resolveRoomId']).toBe('function');
        expect(typeof data['resolveFace']).toBe('function');
        const resolvedRoom = (data['resolveRoomId'] as () => string | null)();
        const resolvedFace = (data['resolveFace'] as () => FaceKey)();
        expect(resolvedFace).toEqual(data['face'] as FaceKey);
        expect(resolvedFace).toEqual(faceKey(resolvedRoom, data['wallId'] as string, face!.side));
      }
    });

    test(`${label}: exactly one mesh per solved face`, () => {
      const { plan, root } = build(scene);
      const built = new FaceMap<number>();
      for (const mesh of wallMeshes(root)) {
        const face = mesh.userData['face'] as FaceKey;
        built.set(face, (built.get(face) ?? 0) + 1);
      }
      expect(built.size).toBe(plan.faces.size);
      for (const face of plan.faces.keys()) expect(built.get(face)).toBe(1);
    });
  }

  test('facade faces point away from the building, room faces into the room', () => {
    const { plan, root } = build(lShapePlan);
    for (const mesh of wallMeshes(root)) {
      const face = plan.faces.get(mesh.userData['face'] as FaceKey)!;
      const outward = mesh.userData['outwardNormal'] as { x: number; z: number };
      const sign = face.roomId === null ? 1 : -1;
      expect(outward.x).toBeCloseTo(sign * face.normal.x, 9);
      expect(outward.z).toBeCloseTo(sign * face.normal.z, 9);
    }
  });
});

describe('wall joints', () => {
  for (const [label, scene] of [
    ['lShapePlan', lShapePlan],
    ['bayPlan', bayPlan],
  ] as const) {
    test(`${label}: every node that needs a core gets one, and no core is paintable`, () => {
      const { root } = build(scene);
      const joints = meshes(root).filter((mesh) => mesh.userData['wallJoint'] === true);
      const cores = jointCores(scene);
      expect(cores.length).toBeGreaterThan(0);
      expect(joints.map((mesh) => mesh.name).sort()).toEqual(cores.map((core) => `joint-${core.nodeId}`).sort());
      const degreeTwo = new Set(
        scene.nodes
          .filter((node) => scene.walls.filter((wall) => wall.a === node.id || wall.b === node.id).length >= 2)
          .map((node) => node.id),
      );
      for (const core of cores) expect(degreeTwo.has(core.nodeId)).toBe(true);
      for (const joint of joints) {
        // Not a painting unit: no `surface`, so it is neither pickable nor a
        // target of a finish scope, and `wallMeshes` never counts it as a face.
        expect(joint.userData['surface']).toBeUndefined();
        expect(joint.userData['face']).toBeUndefined();
        expect(Array.isArray(joint.userData['wallIds'])).toBe(true);
        expect((joint.userData['wallIds'] as string[]).length).toBeGreaterThanOrEqual(2);
        expect(joint.castShadow).toBe(true);
        expect(joint.receiveShadow).toBe(true);
      }
    });
  }

  test('every corner and T-junction of the L-shape plan is filled', () => {
    // Every node of `lShapePlan` turns or steps in thickness, so each one opens
    // a gap. `bayPlan` is the exception: its returns are TANGENT to the arc, so
    // the offsets meet with no wedge and those two nodes need no core.
    const cores = jointCores(lShapePlan)
      .map((core) => core.nodeId)
      .sort();
    expect(cores).toEqual(lShapePlan.nodes.map((node) => node.id).sort());
    const tangent = jointCores(bayPlan).map((core) => core.nodeId);
    expect(tangent).not.toContain(BAY.node.b1);
    expect(tangent).not.toContain(BAY.node.b2);
  });

  test('a joint core stands from the floor to the ceiling', () => {
    const { scene, root } = build(lShapePlan);
    const joint = meshes(root).find((mesh) => mesh.name === `joint-${L_SHAPE.node.n2}`);
    expect(joint).toBeDefined();
    joint!.geometry.computeBoundingBox();
    // In the world: the mesh's origin sits at the core's centre (`shell-origins.ts`).
    root.updateMatrixWorld(true);
    const box = joint!.geometry.boundingBox!.clone().applyMatrix4(joint!.matrixWorld);
    // Geometry positions are Float32, so metres carry six digits at best.
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(scene.ceilingHeight, 5);
    // The T-junction core is the slice of the 0.30 wall the 0.10 partition cuts
    // out of its north face (see `plan-joints.test.ts`).
    expect(box.min.x).toBeCloseTo(5.95, 5);
    expect(box.max.x).toBeCloseTo(6.05, 5);
  });

  test('a joint core wears the wall finish of a room its walls bound, behind the faces, never a face override', () => {
    const { root, plan, paint } = bound();
    const joints = meshes(root).filter((mesh) => mesh.userData['wallJoint'] === true);
    const colourOf = (mesh: THREE.Mesh): string => (mesh.material as THREE.MeshStandardMaterial).color.getHexString();
    const roomFace = (): THREE.Mesh => wallMeshes(root).find((mesh) => mesh.userData['roomId'] !== undefined)!;
    expect(joints.length).toBeGreaterThan(0);

    // White room walls on the default sand facade: the cores' tops read as the rooms' walls, not as sand.
    paint({ op: 'set_material', target: 'walls', material: FINISH.white });
    for (const joint of joints)
      expect({ joint: joint.name, colour: colourOf(joint) }).toEqual({ joint: joint.name, colour: colourOf(roomFace()) });
    paint({ op: 'set_material', target: 'walls', material: FINISH.graphite });
    for (const joint of joints)
      expect({ joint: joint.name, colour: colourOf(joint) }).toEqual({ joint: joint.name, colour: colourOf(roomFace()) });

    // Coplanar with a wall face wherever a core edge lies in it: the core must
    // lose that depth test, never flicker with the paint in front of it.
    for (const joint of joints) expect((joint.material as THREE.Material).polygonOffset).toBe(true);
    expect(wallMeshes(root).length).toBe(plan.faces.size);
    const jointMaterials = new Set(joints.map((joint) => joint.material));
    for (const mesh of wallMeshes(root)) expect(jointMaterials.has(mesh.material as THREE.Material)).toBe(false);
  });
});

describe('floors, ceilings and skirting', () => {
  test('one navigable floor per room, named floor-<roomId>', () => {
    const { scene, root } = build(lShapePlan);
    const floors = meshes(root).filter((mesh) => mesh.userData['surface'] === 'floor');
    expect(floors.map((mesh) => mesh.name).sort()).toEqual(scene.rooms.map((room) => `floor-${room.id}`).sort());
    for (const floor of floors) {
      expect(floor.userData['navigable']).toBe(true);
      expect(floor.name).toBe(`floor-${floor.userData['roomId']}`);
    }
  });

  test('a floor slab is built from the NOTCHED outline, not the room polygon', () => {
    const { scene, plan, root } = build(lShapePlan);
    for (const room of scene.rooms) {
      const floor = objectNamed(root, `floor-${room.id}`) as THREE.Mesh;
      const outline = floorOutline(plan, scene, room.id);
      const polygon = plan.rooms.find((candidate) => candidate.roomId === room.id)!.polygon;
      // Four corners per doorway, so the slab really grew where the door is.
      expect(outline.length).toBeGreaterThan(polygon.length);
      // Ear clipping gives N - 2 triangles per cap, and the sides two per edge.
      expect(floor.geometry.getAttribute('position').count).toBe(12 * outline.length - 12);
      expect(floor.userData['surface']).toBe('floor');
      expect(floor.userData['roomId']).toBe(room.id);
      expect(floor.userData['navigable']).toBe(true);
    }
  });

  test('ceilings are invisible, tagged and skipped for loggias', () => {
    const { root } = build(lShapePlan);
    for (const roomId of [L_SHAPE.room.a, L_SHAPE.room.b]) {
      const ceiling = objectNamed(root, `ceiling-${roomId}`);
      expect(ceiling).not.toBeNull();
      expect(ceiling!.userData['isCeiling']).toBe(true);
      expect(ceiling!.userData['roomId']).toBe(roomId);
      expect(ceiling!.visible).toBe(false);
    }
    const loggia = build(loggiaScene());
    expect(objectNamed(loggia.root, `ceiling-${L_SHAPE.room.a}`)).not.toBeNull();
    expect(objectNamed(loggia.root, `ceiling-${L_SHAPE.room.b}`)).toBeNull();
  });

  test('ceilings wear the default ceiling library material, flat in its first-frame colour', () => {
    const { root } = build(lShapePlan);
    const ceiling = objectNamed(root, `ceiling-${ROOM.a}`) as THREE.Mesh;
    const material = ceiling.material as THREE.MeshStandardMaterial;
    const binding = BUILTIN_DEFAULT_CEILING!;
    const draw = {
      id: FINISH.plaster_white,
      material: binding.material,
      rotation: binding.rotation,
      ...(binding.colour !== undefined && { colour: binding.colour }),
    };
    expect(material.name).toBe(FINISH.plaster_white);
    expect(material.color.getHex()).toBe(firstFrameColour(draw).getHex());
    expect(material.roughness).toBe(binding.material.facts.pbr.roughness ?? 1);
  });

  test('skirting boards carry metre UVs: their u runs as far as the board does', () => {
    const { root } = build(lShapePlan);
    const boards = meshes(root).filter((mesh) => mesh.name.endsWith('-skirting'));
    for (const board of boards) {
      const uv = board.geometry.getAttribute('uv');
      const us = Array.from({ length: uv.count }, (_, index) => uv.getX(index));
      board.geometry.computeBoundingBox();
      const box = board.geometry.boundingBox!;
      const run = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      expect({ name: board.name, short: Math.max(...us) - Math.min(...us) < run - 0.05 }).toEqual({ name: board.name, short: false });
    }
  });

  test('skirting boards are not paintable pick targets', () => {
    const { root } = build(lShapePlan);
    const boards = meshes(root).filter((mesh) => mesh.name.endsWith('-skirting'));
    expect(boards.length).toBeGreaterThan(0);
    for (const board of boards) {
      expect(board.userData['surface']).toBeUndefined();
      expect(board.userData['face']).toBeDefined();
      expect(typeof board.userData['wallId']).toBe('string');
    }
  });
});

describe('opening groups', () => {
  test('every opening group carries the pick contract', () => {
    const { scene, root } = build(lShapePlan);
    const expected = scene.walls.flatMap((wall) => (wall.openings ?? []).map((opening) => [wall.id, opening] as const));
    expect(expected.length).toBeGreaterThan(0);
    for (const [wallId, opening] of expected) {
      const group = objectNamed(root, opening.id);
      expect(group).toBeInstanceOf(THREE.Group);
      const data = group!.userData;
      expect(data['surface']).toBe('opening');
      expect(data['openingId']).toBe(opening.id);
      expect(data['wallId']).toBe(wallId);
      expect(data['openingType']).toBe(opening.type);
      expect(typeof data['entrance']).toBe('boolean');
    }
  });

  test('openingsList reports id, type, wall, entrance, variant and pick points', () => {
    const { builder } = build(lShapePlan);
    const list = builder.openingsList();
    expect(list.map((entry) => entry.id).sort()).toEqual(Object.values(L_SHAPE.opening).sort());
    for (const entry of list) {
      expect(Object.keys(entry).sort()).toEqual(['center', 'entrance', 'id', 'pick', 'type', 'variant', 'wallId']);
      expect(['door', 'window']).toContain(entry.type);
      expect(typeof entry.wallId).toBe('string');
      expect(typeof entry.variant).toBe('string');
      expect(Number.isFinite(entry.center.x) && Number.isFinite(entry.center.y) && Number.isFinite(entry.center.z)).toBe(true);
      expect(Number.isFinite(entry.pick.x) && Number.isFinite(entry.pick.y) && Number.isFinite(entry.pick.z)).toBe(true);
    }
    expect(list.find((entry) => entry.id === L_SHAPE.opening.doorEntry)!.entrance).toBe(true);
    expect(list.find((entry) => entry.id === L_SHAPE.opening.doorAb)!.entrance).toBe(false);
  });
});

describe('openings on curved walls', () => {
  /**
   * Guards against a FLAT window frame on the demo bay: with a 1.6 m radius
   * and a 1.6 m opening the sagitta is ~0.3 m, so a flat frame, glass and sill
   * board would leave the wall while the wall cut follows the arc. The frame
   * is built per chord of the same discretisation as the face.
   */
  const BAY_ARC = arcFromChord({ x: 0, z: 0 }, { x: 4, z: 0 }, 2, false);
  const BAY_THICKNESS = 0.3;

  function radialOffset(point: THREE.Vector3): number {
    return Math.abs(Math.hypot(point.x - BAY_ARC.centre.x, point.z - BAY_ARC.centre.z) - BAY_ARC.radius);
  }

  /** World-space vertices of every mesh of a group whose part passes `keep`. */
  function partVertices(group: THREE.Object3D, keep: (part: unknown) => boolean): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    group.updateMatrixWorld(true);
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!keep(object.userData['openingPart'])) return;
      const position = object.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i += 1) {
        out.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld));
      }
    });
    return out;
  }

  const FRAME_PARTS = new Set(['jamb', 'head', 'sill', 'bar-vertical', 'bar-horizontal']);

  test('every frame vertex stays inside the wall thickness plus the frame depth', () => {
    const { builder } = build(bayPlan);
    const group = builder.getOpeningGroup(BAY.opening.windowBay)!;
    // `window-pvc-white`, the default: frame depth 0.12.
    const limit = BAY_THICKNESS / 2 + 0.12 + 0.001;
    const vertices = partVertices(group, (part) => FRAME_PARTS.has(part as string));
    expect(vertices.length).toBeGreaterThan(100);
    for (const vertex of vertices) expect(radialOffset(vertex)).toBeLessThanOrEqual(limit);
  });

  test('the sill board follows the inner face instead of cutting through it', () => {
    const { builder } = build(bayPlan);
    const group = builder.getOpeningGroup(BAY.opening.windowBay)!;
    const board = partVertices(group, (part) => part === 'sill-board');
    expect(board.length).toBeGreaterThan(24);
    // Board centre line: inner face (R - t/2) minus the 0.07 stand-off, half
    // the 0.18 depth either side. Its back edge is seated 2 cm into the reveal
    // and the rest of it stands in the room; nothing reaches the wall centre.
    const inner = BAY_ARC.radius - BAY_THICKNESS / 2;
    for (const vertex of board) {
      const radius = Math.hypot(vertex.x - BAY_ARC.centre.x, vertex.z - BAY_ARC.centre.z);
      expect(radius).toBeLessThan(inner + 0.03);
      expect(radius).toBeGreaterThan(inner - 0.2);
    }
  });

  test('every glass pane hugs the arc, and there is one per glazed chord', () => {
    const { builder } = build(bayPlan);
    const group = builder.getOpeningGroup(BAY.opening.windowBay)!;
    const panes = partVertices(group, (part) => part === 'pane');
    // Every pane is a flat plane on its own chord, so it never leaves the arc
    // by more than the discretisation sagitta.
    expect(panes.length).toBeGreaterThan(0);
    for (const vertex of panes) expect(radialOffset(vertex)).toBeLessThanOrEqual(ARC_TOL + 1e-6);
  });

  test('the pick proxies are segmented and reachable from inside the room', () => {
    const { builder, root } = build(bayPlan);
    const proxies = meshes(root).filter((mesh) => mesh.name === `${BAY.opening.windowBay}-pick`);
    expect(proxies.length).toBeGreaterThan(4);
    const entry = builder.openingsList().find((item) => item.id === BAY.opening.windowBay)!;
    // A ray from the middle of the room towards the recorded pick point must
    // hit one of them: that is the click the browser-check performs.
    const origin = new THREE.Vector3(2, entry.pick.y, 2);
    const target = new THREE.Vector3(entry.pick.x, entry.pick.y, entry.pick.z);
    const raycaster = new THREE.Raycaster(origin, target.clone().sub(origin).normalize());
    const hits = raycaster.intersectObjects(proxies, false);
    expect(hits.length).toBeGreaterThan(0);
  });

  test('a rebuilt variant on the arc is curved too', () => {
    const { builder } = build(bayPlan);
    expect(builder.rebuildOpening(BAY.opening.windowBay, OPENING_VARIANT.window_graphite_grid)).toBe(true);
    const group = builder.getOpeningGroup(BAY.opening.windowBay)!;
    const parts = new Set<string>();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh && typeof object.userData['openingPart'] === 'string') {
        parts.add(object.userData['openingPart']);
      }
    });
    expect(parts.has('head')).toBe(true);
    expect(parts.has('bar-horizontal')).toBe(true);
    // `window-graphite-grid`: frame depth 0.10.
    const limit = BAY_THICKNESS / 2 + 0.1 + 0.001;
    for (const vertex of partVertices(group, (part) => FRAME_PARTS.has(part as string))) {
      expect(radialOffset(vertex)).toBeLessThanOrEqual(limit);
    }
  });

  test('the door on the straight wall of the same plan is untouched', () => {
    const { builder } = build(bayPlan);
    const group = builder.getOpeningGroup(BAY.opening.doorBay)!;
    let meshCount = 0;
    let vertexCount = 0;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshCount += 1;
      vertexCount += object.geometry.getAttribute('position').count;
      expect(object.userData['openingPart']).toBeUndefined();
    });
    expect(meshCount).toBe(9);
    expect(vertexCount).toBe(320);
  });
});

describe('straight walls keep the flat single-rectangle path', () => {
  /**
   * Regression guard for the curved-frame change: on a plan without arcs the
   * builder must produce byte-for-byte the same openings it did before. The
   * numbers below were captured from the build that preceded it; the two door
   * boxes were re-captured when the leaf rest angle became a quarter turn
   * (`door-swing.LEAF_REST_ANGLE_RAD`), which is what keeps a leaf inside its
   * own opening span instead of swinging past the jamb into the next wall.
   */
  const BEFORE: Record<string, { meshes: number; vertices: number; min: [number, number, number]; max: [number, number, number] }> = {
    [L_SHAPE.opening.doorEntry]: { meshes: 9, vertices: 320, min: [0.75, 0, -0.19], max: [1.75, 2.15, 0.86] },
    [L_SHAPE.opening.windowASouth]: { meshes: 9, vertices: 176, min: [3.09, 0.82, -0.19], max: [5.21, 2.35, 0.31] },
    [L_SHAPE.opening.windowBEast]: { meshes: 9, vertices: 176, min: [9.69, 0.82, 1.64], max: [10.19, 2.35, 3.36] },
    [L_SHAPE.opening.doorAb]: { meshes: 9, vertices: 320, min: [5.22, 0, 2.0445], max: [6.09, 2.1, 2.95] },
  };

  test('mesh counts, vertex counts and bounding boxes are unchanged', () => {
    const { builder } = build(lShapePlan);
    expect(
      builder
        .openingsList()
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(Object.keys(BEFORE).sort());
    for (const [id, expected] of Object.entries(BEFORE)) {
      const group = builder.getOpeningGroup(id)!;
      let meshCount = 0;
      let vertexCount = 0;
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshCount += 1;
        vertexCount += object.geometry.getAttribute('position').count;
      });
      expect([id, meshCount, vertexCount]).toEqual([id, expected.meshes, expected.vertices]);
      const box = new THREE.Box3().setFromObject(group);
      for (const [axis, index] of [
        ['x', 0],
        ['y', 1],
        ['z', 2],
      ] as const) {
        expect(box.min[axis]).toBeCloseTo(expected.min[index], 6);
        expect(box.max[axis]).toBeCloseTo(expected.max[index], 6);
      }
    }
  });
});

describe('rebuildOpening', () => {
  test('rejects a variant built for the other opening type and leaves the group in place', () => {
    const { builder, root } = build(lShapePlan);
    const before = objectNamed(root, L_SHAPE.opening.windowASouth);
    expect(builder.rebuildOpening(L_SHAPE.opening.windowASouth, OPENING_VARIANT.door_white_flat_bar)).toBe(false);
    expect(builder.rebuildOpening(L_SHAPE.opening.doorAb, OPENING_VARIANT.window_oak_vertical)).toBe(false);
    expect(builder.rebuildOpening(UNKNOWN_OPENING, OPENING_VARIANT.window_oak_vertical)).toBe(false);
    expect(builder.rebuildOpening(L_SHAPE.opening.windowASouth, UNKNOWN_VARIANT)).toBe(false);
    expect(objectNamed(root, L_SHAPE.opening.windowASouth)).toBe(before);
    expect(builder.getOpeningVariant(L_SHAPE.opening.windowASouth)).toBe(OPENING_VARIANT.window_pvc_white);
  });

  test('a valid variant swaps only that group, keeps the wall faces and disposes the old materials', () => {
    const { builder, root } = build(lShapePlan);
    const oldGroup = builder.getOpeningGroup(L_SHAPE.opening.windowASouth)!;
    const wallFaceIdentities = new FaceMap<THREE.Mesh>();
    for (const mesh of wallMeshes(root)) wallFaceIdentities.set(mesh.userData['face'] as FaceKey, mesh);
    const otherOpening = builder.getOpeningGroup(L_SHAPE.opening.windowBEast);
    // Owned materials only: the pick proxies share one `MeshBasicMaterial`.
    const owned = new Set<THREE.Material>();
    for (const mesh of meshes(oldGroup)) {
      const material = mesh.material as THREE.Material;
      if (material instanceof THREE.MeshStandardMaterial) owned.add(material);
    }
    expect(owned.size).toBeGreaterThan(0);
    const spies = [...owned].map((material) => spyOn(material, 'dispose'));

    expect(builder.rebuildOpening(L_SHAPE.opening.windowASouth, OPENING_VARIANT.window_graphite_grid)).toBe(true);

    for (const spy of spies) expect(spy).toHaveBeenCalled();
    const newGroup = builder.getOpeningGroup(L_SHAPE.opening.windowASouth)!;
    expect(newGroup).not.toBe(oldGroup);
    expect(oldGroup.parent).toBeNull();
    expect(newGroup.parent?.name).toBe('parametric-shell');
    expect(newGroup.userData['surface']).toBe('opening');
    expect(newGroup.userData['openingId']).toBe(L_SHAPE.opening.windowASouth);
    expect(builder.getOpeningVariant(L_SHAPE.opening.windowASouth)).toBe(OPENING_VARIANT.window_graphite_grid);
    expect(builder.getOpeningGroup(L_SHAPE.opening.windowBEast)).toBe(otherOpening);
    for (const mesh of wallMeshes(root)) expect(wallFaceIdentities.get(mesh.userData['face'] as FaceKey)).toBe(mesh);
    expect(wallMeshes(root).length).toBe(wallFaceIdentities.size);
    expect(builder.openingsList().find((entry) => entry.id === L_SHAPE.opening.windowASouth)!.variant).toBe(
      OPENING_VARIANT.window_graphite_grid,
    );
  });

  test('never disposes a bumpMap, which finishes.ts shares between materials', () => {
    // `finishes.ts` caches ONE bump clone per finish and repeat and hands the
    // same texture to every material that wants it (see its `bumpClones` map,
    // "callers must not dispose material.bumpMap"). Under Bun the generators
    // return null, so the shared clone is stood in for here.
    const { builder } = build(lShapePlan);
    const group = builder.getOpeningGroup(L_SHAPE.opening.windowASouth)!;
    const sharedBump = new THREE.Texture();
    const sharedSpy = spyOn(sharedBump, 'dispose');
    const standards = new Set<THREE.MeshStandardMaterial>();
    for (const mesh of meshes(group)) {
      const material = mesh.material as THREE.Material;
      if (material instanceof THREE.MeshStandardMaterial) standards.add(material);
    }
    const ownedMaps: THREE.Texture[] = [];
    for (const material of standards) {
      material.bumpMap = sharedBump;
      const own = new THREE.Texture();
      material.map = own;
      ownedMaps.push(own);
    }
    expect(ownedMaps.length).toBeGreaterThan(0);
    const ownedSpies = ownedMaps.map((texture) => spyOn(texture, 'dispose'));

    expect(builder.rebuildOpening(L_SHAPE.opening.windowASouth, OPENING_VARIANT.window_graphite_grid)).toBe(true);

    expect(sharedSpy).not.toHaveBeenCalled();
    // The colour map IS cloned per material, so it still has to go.
    for (const spy of ownedSpies) expect(spy).toHaveBeenCalled();
  });

  test('dispose never disposes a shared bumpMap either', () => {
    const { builder, root } = build(lShapePlan);
    const sharedBump = new THREE.Texture();
    const sharedSpy = spyOn(sharedBump, 'dispose');
    for (const mesh of meshes(root)) {
      const material = mesh.material as THREE.Material;
      if (material instanceof THREE.MeshStandardMaterial) material.bumpMap = sharedBump;
    }
    builder.dispose();
    expect(sharedSpy).not.toHaveBeenCalled();
  });

  test('rebuilding to the current variant is a no-op that keeps the group', () => {
    const { builder } = build(lShapePlan);
    const group = builder.getOpeningGroup(L_SHAPE.opening.doorAb);
    expect(builder.rebuildOpening(L_SHAPE.opening.doorAb, OPENING_VARIANT.door_white_flat_bar)).toBe(true);
    expect(builder.getOpeningGroup(L_SHAPE.opening.doorAb)).toBe(group);
  });
});

describe('determinism', () => {
  for (const [label, scene] of FIXTURES) {
    test(`${label}: two builds produce the same meshes in the same order`, () => {
      const first = meshes(build(scene).root).map((mesh) => mesh.name);
      const second = meshes(build(scene).root).map((mesh) => mesh.name);
      expect(second).toEqual(first);
    });
  }
});

describe('model binding, dispose and rebuild', () => {
  test('a committed paint reaches the meshes through onRevision alone', () => {
    const scene = draftOf(lShapePlan);
    const model = new SceneModel(scene, CATALOGUE_REGISTRIES);
    const builder = new SceneBuilder(model.scene, model.plan);
    builder.build();
    builder.bindModel(model);
    expect(builder.getRoomWall(ROOM.a)).toBe(FINISH.sand);
    model.apply({ baseRev: 0, ops: [{ op: 'set_material', target: ROOM.a, material: FINISH.sage }] });
    expect(builder.getRoomWall(ROOM.a)).toBe(FINISH.sage);
    expect(builder.getRoomWall(ROOM.b)).toBe(FINISH.sand);
    model.apply({ baseRev: 1, ops: [{ op: 'set_material', target: A_PART, material: FINISH.terra, scope: 'face' }] });
    expect(builder.getFaceWall(A_PART)).toBe(FINISH.terra);
    // Repainting the room drops the override again, without listing the face.
    model.apply({ baseRev: 2, ops: [{ op: 'set_material', target: ROOM.a, material: FINISH.white }] });
    expect(builder.getFaceWall(A_PART)).toBe(FINISH.white);
  });

  test('applyRevision separates the entities that are not its business from the ones that are', () => {
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    const builder = new SceneBuilder(model.scene, model.plan);
    builder.build();
    builder.bindModel(model);
    expect(builder.applyRevision([TOUCHED_FACADE, touchedAsset(UNKNOWN_ASSET), TOUCHED_SHELL])).toEqual({
      unhandled: [touchedAsset(UNKNOWN_ASSET), TOUCHED_SHELL],
      failed: [],
    });
    expect(SceneBuilder.needsRebuild([TOUCHED_FACADE])).toBe(false);
    expect(SceneBuilder.needsRebuild([touchedRoomWalls(ROOM.a), TOUCHED_SHELL])).toBe(true);
  });

  test('a paint it recognises but cannot perform comes back as DRIFT, not as routing', () => {
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    const builder = new SceneBuilder(model.scene, model.plan);
    builder.build();
    builder.bindModel(model);
    const ghosts = [touchedRoomWalls(GHOST_ROOM), touchedFloor(GHOST_ROOM), touchedFace(faceKey(GHOST_ROOM, L_SHAPE.wall.wW, 'L'))];
    expect(builder.applyRevision(ghosts)).toEqual({ unhandled: [], failed: ghosts });
  });

  test('bindModel reports drift to its sink, so the mount can rebuild', () => {
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    const builder = new SceneBuilder(model.scene, model.plan);
    builder.build();
    const drifts: TouchedEntity[][] = [];
    builder.bindModel(model, (failed) => {
      drifts.push([...failed]);
    });
    // A commit the shell handles: nothing drifted.
    model.apply({ baseRev: 0, ops: [{ op: 'set_material', target: ROOM.a, material: FINISH.white }] });
    expect(drifts).toEqual([]);
  });

  test('a scene with authored finishes builds already painted', () => {
    const scene = draftOf(lShapePlan);
    const bEast = faceKey(ROOM.b, L_SHAPE.wall.wE, 'L');
    scene.finishes = {
      rooms: { [ROOM.a]: { walls: FINISH.graphite, floor: FINISH.walnut } },
      faces: [{ ...bEast, finish: FINISH.terra }],
      facade: FINISH.sage,
    };
    const { builder } = build(scene);
    expect(builder.getRoomWall(ROOM.a)).toBe(FINISH.graphite);
    expect(builder.getFloorFinish(ROOM.a)).toBe(FINISH.walnut);
    expect(builder.getFaceWall(bEast)).toBe(FINISH.terra);
    expect(builder.getFacadeWall()).toBe(FINISH.sage);
  });

  test('dispose frees the geometries of everything it built', () => {
    const { builder, root } = build(lShapePlan);
    const geometries = meshes(root).map((mesh) => mesh.geometry);
    expect(geometries.length).toBeGreaterThan(0);
    const spies = geometries.map((geometry) => spyOn(geometry, 'dispose'));
    builder.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });

  test('rebuildAll re-solves the plan and produces a root without the removed opening', () => {
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    const builder = new SceneBuilder(model.scene, model.plan);
    const first = builder.build();
    builder.bindModel(model);
    expect(builder.openingsList().map((entry) => entry.id)).toContain(L_SHAPE.opening.doorAb);
    const applied = model.apply({ baseRev: 0, ops: [{ op: 'remove_opening', openingId: L_SHAPE.opening.doorAb }] });
    expect('touched' in applied && applied.touched).toEqual([TOUCHED_SHELL]);

    const rebuilt = builder.rebuildAll();
    expect(rebuilt.root).not.toBe(first.root);
    expect(builder.openingsList().map((entry) => entry.id)).not.toContain(L_SHAPE.opening.doorAb);
    // The shell is rebuilt from the model's re-solved plan, so the faces are back.
    expect(wallMeshes(rebuilt.root).length).toBeGreaterThan(0);
    expect(rebuilt.root.getObjectByName('parametric-shell')).toBeTruthy();
  });
});

describe('openings are built to the same heights the wall was cut to', () => {
  /**
   * A low ceiling with no authored heads: `plan-openings.effectiveOpening`
   * keeps a `CEILING_OPENING_MARGIN` below the ceiling, so the wall quads stop
   * at 1.95 m. Guards against the builder clamping to the raw ceiling instead,
   * which would put the frame head at 2.00 m, 5 cm above the hole it sits in.
   */
  function lowCeiling(): SceneData {
    const scene = draftOf(lShapePlan);
    scene.ceilingHeight = 2;
    for (const wall of scene.walls) {
      for (const opening of wall.openings ?? []) delete opening.head;
    }
    return scene;
  }

  test('the frame head equals the head of the quad opening, not the ceiling', () => {
    const scene = lowCeiling();
    const { plan, builder } = build(scene);
    const cut = [...plan.faces.values()].flatMap((face) => face.openings).find((o) => o.id === L_SHAPE.opening.doorAb);
    expect(cut).toBeDefined();
    expect(cut!.head).toBeCloseTo(1.95, 10);
    const group = builder.getOpeningGroup(L_SHAPE.opening.doorAb);
    expect(group).not.toBeNull();
    expect(new THREE.Box3().setFromObject(group!).max.y).toBeCloseTo(cut!.head, 6);
  });

  test('every opening the builder lists is centred on its own cut', () => {
    const scene = lowCeiling();
    const { plan, builder } = build(scene);
    const cuts = new Map([...plan.faces.values()].flatMap((face) => face.openings).map((o) => [o.id, o]));
    for (const entry of builder.openingsList()) {
      const cut = cuts.get(entry.id)!;
      expect(entry.center.y).toBeCloseTo((cut.sill + cut.head) / 2, 6);
    }
  });
});

/* --------------------------------------------- the project upgrade queue --- */

/**
 * A scene of six project objects, spread along +x, with the presentation
 * camera parked beyond the LAST of them.
 *
 * Document order is therefore the exact reverse of camera order, which is what
 * makes "nearest to the presentation camera first" a claim a test can fail.
 * The document is built by hand rather than validated: `SceneBuilder` takes a
 * `SceneData` and a `SolvedPlan`, and what is under test here is the queue,
 * not the validator.
 */
/** The queue bake's ids: fixed UUID v7 literals, one placement per box. */
const QUEUE = {
  project: '01a12ffa-ff10-7a22-934a-87439bdfdb1b',
  bake: '01a12ffa-ff11-7e9b-9164-78db83357e7a',
  workspace: '01a12ffa-ff12-70d2-a5f4-477045111a78',
  box: '01a12ffa-ff13-7fc2-9858-453ed112ea49',
  boxVariant: '01a12ffa-ff14-76da-8d20-b537c47798d5',
  oak: '01a12ffa-ff15-7265-9c82-60f74f1217f0',
  placements: [
    '01a12ffa-ff16-7360-9b06-d434ce0a9618',
    '01a12ffa-ff17-7a88-ab7f-0761306beeff',
    '01a12ffa-ff18-75dc-b12d-1b09d630c619',
    '01a12ffa-ff19-7205-aa3c-35579f97433d',
    '01a12ffa-ff1a-739c-b9fe-927178f3b668',
    '01a12ffa-ff1b-7872-9d6e-ec3682c57b19',
  ],
} as const;

/** Where the queue bake is served from: the project folder, by its UUIDs. */
const QUEUE_BASE_URL = `https://example.com/${QUEUE.workspace}/${QUEUE.project}/${QUEUE.bake}/`;

const PROJECT_LIBRARY = {
  manifestVersion: '1.0',
  id: QUEUE.project,
  publisher: QUEUE.workspace,
  license: 'CC0-1.0',
  objects: [
    {
      id: QUEUE.box,
      name: 'Box',
      category: 'furniture/boxes',
      dims: [0.5, 0.5, 0.5],
      anchor: 'floor',
      wallSnap: false,
      clearance: 0,
      tags: [],
      model: 'obj/box.glb',
      slots: ['frame'],
      defaultFinishes: { frame: QUEUE.oak },
      primarySlot: 'frame',
      variants: [{ id: QUEUE.boxVariant, name: 'Box', version: '1.0.0', pricing: { model: 'free' } }],
      defaultVariant: QUEUE.boxVariant,
    },
  ],
  materials: [{ id: QUEUE.oak, name: 'Queue oak', apply: ['floor', 'furniture'], generator: { kind: 'plank_floor', tone: '#b5855a' } }],
} as unknown as BakedProjectManifest['library'];

const PROJECT_MANIFEST = {
  format: 'jeex-project',
  formatVersion: 2,
  projectId: QUEUE.project,
  bakeId: QUEUE.bake,
  bakedAt: '2026-09-11T00:00:00.000Z',
  scene: 'scene.json',
  library: PROJECT_LIBRARY,
  rights: { workspaceId: QUEUE.workspace, perpetual: true, assets: [] },
  generator: { name: 'test', version: '1' },
} as unknown as BakedProjectManifest;

const QUEUE_COUNT = QUEUE.placements.length;

/** `lShapePlan` with six project boxes in it and a camera past the last one. */
function queueScene(): SceneData {
  const scene = draftOf(lShapePlan);
  scene.assetLibrary = QUEUE.project;
  scene.assets = QUEUE.placements.map((id, index) => ({
    id,
    type: 'box',
    asset: QUEUE.box,
    variant: QUEUE.boxVariant,
    position: { x: index, y: 0, z: 0 },
    rotationY: 0,
  }));
  scene.presentationCamera = { position: { x: QUEUE_COUNT + 10, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
  return scene;
}

type QueueProbe = {
  builder: SceneBuilder;
  order: string[];
  peakInFlight: number;
  warnings: Array<{ code: string; detail: unknown }>;
  release: () => void;
};

/**
 * Builds the queue scene with a model source whose every request is held open
 * until `release()`, so the pass's concurrency is observable rather than raced.
 */
function queueProbe(options: { bytesPerModel?: number; warnings?: readonly string[]; fail?: boolean } = {}): QueueProbe {
  const scene = queueScene();
  const order: string[] = [];
  const held: Array<() => void> = [];
  let inFlight = 0;
  let peakInFlight = 0;
  const warnings: Array<{ code: string; detail: unknown }> = [];
  const modelSource = async (request: ModelRequest): Promise<ModelOutcome> => {
    order.push(request.url);
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise<void>((resolve) => {
      held.push(resolve);
    });
    inFlight -= 1;
    if (options.fail) throw new TypeError('Failed to fetch');
    return {
      group: new THREE.Group(),
      triangles: 0,
      warnings: [...(options.warnings ?? [])],
      bytes: options.bytesPerModel ?? 0,
    };
  };
  const bank = projectBank(PROJECT_MANIFEST, QUEUE_BASE_URL);
  const builder = new SceneBuilder(scene, solvePlan(scene), {
    catalogue: bank.catalogue,
    resolveFinish: bank.resolveFinish,
    projectMaterials: PROJECT_MANIFEST.library.materials,
    // Every box shares one archetype, so the URL alone would not say WHICH
    // placement was queued; the resolver tags it with the placement id.
    modelUrl: (asset) => `${bank.modelUrl(asset)}#${asset.placementId}`,
    modelSource,
    log: { warn: (code, _message, detail) => warnings.push({ code, detail }), error: () => undefined },
  });
  builder.build();
  return {
    builder,
    order,
    get peakInFlight() {
      return peakInFlight;
    },
    warnings,
    release: () => {
      for (const resolve of held.splice(0)) resolve();
    },
  };
}

/** Runs the pass to completion, releasing whatever it holds until it stops asking. */
async function drain(probe: QueueProbe, signal: AbortSignal): Promise<UpgradeResult> {
  const pass = probe.builder.upgradeModels(signal);
  for (let i = 0; i < QUEUE_COUNT + 2; i += 1) {
    await Promise.resolve();
    probe.release();
    await Promise.resolve();
  }
  probe.release();
  return pass;
}

describe('upgrading a baked project', () => {
  test('the first frame is stand-ins, and they are not counted as degraded', () => {
    const scene = queueScene();
    const bank = projectBank(PROJECT_MANIFEST, QUEUE_BASE_URL);
    const builder = new SceneBuilder(scene, solvePlan(scene), {
      catalogue: bank.catalogue,
      resolveFinish: bank.resolveFinish,
      projectMaterials: PROJECT_MANIFEST.library.materials,
      modelUrl: (asset) => bank.modelUrl(asset),
    });
    const built = builder.build();
    expect(built.degradedAssets).toBe(0);
    const furniture = built.root.getObjectByName(FURNITURE_GROUP_NAME)!;
    expect(furniture.children).toHaveLength(QUEUE_COUNT);
    expect(furniture.children.map((group) => group.userData['degraded'])).toEqual(
      Array.from({ length: QUEUE_COUNT }, () => 'pending-model'),
    );
    builder.dispose();
  });

  test('no more than MAX_MODEL_PARALLEL models are in flight at once', async () => {
    const probe = queueProbe();
    const signal = new AbortController().signal;
    const pass = probe.builder.upgradeModels(signal);
    // Let every worker that is going to start, start.
    for (let i = 0; i < QUEUE_COUNT; i += 1) await Promise.resolve();
    expect(probe.order.length).toBe(MAX_MODEL_PARALLEL);
    expect(probe.peakInFlight).toBe(MAX_MODEL_PARALLEL);
    probe.release();
    for (let i = 0; i < QUEUE_COUNT + 4; i += 1) {
      await Promise.resolve();
      probe.release();
    }
    await pass;
    expect(probe.peakInFlight).toBeLessThanOrEqual(MAX_MODEL_PARALLEL);
    probe.builder.dispose();
  });

  test('the queue is ordered by distance to the presentation camera, not by document order', async () => {
    const probe = queueProbe();
    const result = await drain(probe, new AbortController().signal);
    expect(result.upgraded).toBe(QUEUE_COUNT);
    // The camera sits past the sixth box, so the nearest object is the LAST one
    // the document lists.
    expect(probe.order.map((url) => url.slice(url.indexOf('#') + 1))).toEqual([...QUEUE.placements].reverse());
    probe.builder.dispose();
  });

  test('a GLB defect is reported as `asset-defect` and the body is still swapped in', async () => {
    const probe = queueProbe({ warnings: ['bbox-off-by-9'] });
    const result = await drain(probe, new AbortController().signal);
    expect({ upgraded: result.upgraded, failed: result.failed }).toEqual({ upgraded: QUEUE_COUNT, failed: 0 });
    const defects = probe.warnings.filter((entry) => entry.code === 'asset-defect');
    expect(defects).toHaveLength(QUEUE_COUNT);
    // Both halves reach the host in one entry: what the SOURCE reported and
    // what dressing the body found (`empty-model`, because the stub carries no
    // meshes at all). The body is on screen either way.
    expect(defects[0]!.detail).toEqual({ placementId: QUEUE.placements[5], warnings: ['bbox-off-by-9', 'empty-model'] });
    probe.builder.dispose();
  });

  test('the pass stops at MAX_PROJECT_BYTES and says so', async () => {
    // Two models' worth of budget: the pass must stop long before six.
    const probe = queueProbe({ bytesPerModel: Math.ceil(MAX_PROJECT_BYTES / 2) });
    const result = await drain(probe, new AbortController().signal);
    expect(result.upgraded).toBeLessThan(QUEUE_COUNT);
    const budget = probe.warnings.filter((entry) => entry.code === 'project-budget');
    expect(budget.length).toBeGreaterThan(0);
    expect((budget[0]!.detail as { limit: number }).limit).toBe(MAX_PROJECT_BYTES);
    expect(result.budget).toBe(true);
    probe.builder.dispose();
  });

  test('failed loads are counted and their errors kept for the pass outcome', async () => {
    const probe = queueProbe({ fail: true });
    const result = await drain(probe, new AbortController().signal);
    expect({ upgraded: result.upgraded, failed: result.failed, budget: result.budget }).toEqual({
      upgraded: 0,
      failed: QUEUE_COUNT,
      budget: false,
    });
    expect(result.failures.length).toBe(QUEUE_COUNT);
    expect(result.failures.every((error) => error instanceof TypeError)).toBe(true);
    probe.builder.dispose();
  });

  test('an aborted pass stops where it stands', async () => {
    const probe = queueProbe();
    const controller = new AbortController();
    const pass = probe.builder.upgradeModels(controller.signal);
    for (let i = 0; i < QUEUE_COUNT; i += 1) await Promise.resolve();
    controller.abort();
    probe.release();
    for (let i = 0; i < QUEUE_COUNT + 4; i += 1) {
      await Promise.resolve();
      probe.release();
    }
    const result = await pass;
    expect(result.upgraded).toBeLessThanOrEqual(MAX_MODEL_PARALLEL);
    expect(probe.order.length).toBe(MAX_MODEL_PARALLEL);
    probe.builder.dispose();
  });
});

/**
 * The swap `upgradeModels` performs is the moment the PICK REGISTRIES go
 * stale: they are keyed by mesh (`geometry/picker.ts`), the stand-in's meshes
 * leave the graph, and the GLB's meshes carry no `surface`/`assetId` at all
 * until something registers them. The builder reports the swap; `SceneMount`
 * is what listens.
 */
/** The bed placements of the two describes below: fixed UUID v7 literals. */
const BED = { first: '01a12ffa-ff1c-721e-8a8e-e0b4cd8d5709', second: '01a12ffa-ff1d-77e0-a88c-a62bc3c3c105' } as const;

describe('the body swap is reported', () => {
  const PLACEMENT = BED.first;
  const swapScene: SceneData = {
    ...lShapePlan,
    assets: [{ id: PLACEMENT, type: 'bed', asset: ARCHETYPE.bed_double, position: { x: 3, y: 0, z: 4 }, rotationY: 0, room: ROOM.a }],
  };

  /** A source that answers every request with one box mesh, so the body is pickable. */
  function boxSource(): (request: ModelRequest) => Promise<ModelOutcome> {
    return () => {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2), new THREE.MeshStandardMaterial()));
      return Promise.resolve({ group, triangles: 12, warnings: [], bytes: 16 });
    };
  }

  function swapBuilder(): SceneBuilder {
    return new SceneBuilder(swapScene, solvePlan(swapScene), { modelUrl: () => 'https://models.test/bed.glb', modelSource: boxSource() });
  }

  function placementGroup(root: THREE.Group): THREE.Group {
    const group = root.getObjectByName(FURNITURE_GROUP_NAME)?.getObjectByName(PLACEMENT);
    if (!(group instanceof THREE.Group)) throw new Error(`no group for ${PLACEMENT}`);
    return group;
  }

  test('the callback names the group and the bodies that left it', async () => {
    const builder = swapBuilder();
    const built = builder.build();
    const group = placementGroup(built.root);
    const standIn = group.children[0]!;
    const swaps: Array<{ id: unknown; replaced: readonly THREE.Object3D[] }> = [];
    await builder.upgradeModels(new AbortController().signal, undefined, (swapped, replaced) => {
      swaps.push({ id: swapped.userData['assetId'], replaced });
    });
    expect(swaps).toHaveLength(1);
    expect(swaps[0]!.id).toBe(PLACEMENT);
    expect(swaps[0]!.replaced).toEqual([standIn]);
    // Reported AFTER the swap: a listener re-registers what is on screen now.
    expect(group.children.map((child) => child.name)).toEqual([`${VARIANT.bed_double_linen}-gltf`]);
    builder.dispose();
  });

  test('a selection aura is not a body and survives the swap', async () => {
    const builder = swapBuilder();
    const built = builder.build();
    const group = placementGroup(built.root);
    const aura = new THREE.Group();
    aura.name = GLOW_GROUP_NAME;
    group.add(aura);
    const replaced: THREE.Object3D[][] = [];
    await builder.upgradeModels(new AbortController().signal, undefined, (_group, bodies) => {
      replaced.push([...bodies]);
    });
    expect(replaced[0]!.map((body) => body.name)).toEqual([`${VARIANT.bed_double_linen}-procedural`]);
    expect(aura.parent).toBe(group);
    builder.dispose();
  });

  test('a listener that throws is reported and the pass goes on', async () => {
    const scene: SceneData = {
      ...swapScene,
      assets: [
        ...swapScene.assets,
        { id: BED.second, type: 'bed', asset: ARCHETYPE.bed_double, position: { x: 6, y: 0, z: 4 }, rotationY: 0, room: ROOM.a },
      ],
    };
    const errors: string[] = [];
    const builder = new SceneBuilder(scene, solvePlan(scene), {
      modelUrl: () => 'https://models.test/bed.glb',
      modelSource: boxSource(),
      log: { warn: () => undefined, error: (code) => errors.push(code) },
    });
    builder.build();
    const result = await builder.upgradeModels(new AbortController().signal, undefined, () => {
      throw new Error('a listener that cannot cope');
    });
    // Neither placement is stranded, and the failure is said out loud.
    expect(result).toEqual({ upgraded: 2, failed: 0, budget: false, failures: [] });
    expect(errors).toEqual(['listener-failed', 'listener-failed']);
    builder.dispose();
  });

  test('the pick registry follows the body onto the screen', async () => {
    const builder = swapBuilder();
    const built = builder.build();
    const picker = new Picker({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
    picker.register(built.root, () => false);
    for (const child of built.root.getObjectByName(FURNITURE_GROUP_NAME)!.children) {
      picker.registerFurniture(child, child.userData['assetId'] as string);
    }
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 100);
    camera.position.set(3, 4, 4);
    camera.lookAt(3, 0.2, 4);
    camera.updateMatrixWorld(true);
    built.root.updateMatrixWorld(true);
    expect(picker.pickSurface(400, 300, camera)).toEqual({ surface: 'furniture', assetId: PLACEMENT });

    // Exactly what `app/scene-mount.ts` does with the report.
    await builder.upgradeModels(new AbortController().signal, undefined, (group, bodies) => {
      for (const body of bodies) picker.unregister(body);
      picker.registerFurniture(group, group.userData['assetId'] as string);
    });
    built.root.updateMatrixWorld(true);
    expect(picker.pickSurface(400, 300, camera)).toEqual({ surface: 'furniture', assetId: PLACEMENT });

    // That it is the GLB answering and not the detached stand-in: what is not
    // on screen cannot be picked, and the stand-in is no longer on screen.
    placementGroup(built.root).children[0]!.visible = false;
    expect(picker.pickSurface(400, 300, camera)?.surface).toBe('floor');
    builder.dispose();
  });
});

/**
 * WHICH group the next pass upgrades after a variant swap, and with WHICH
 * variant.
 *
 * The defect this guards («when the armchair is swapped nothing changes»): the
 * replaced object keeps its stand-in for ever. Two windows make it.
 * `ViewerEditor.swapFurniture` ADDS the new group and leaves the old one to the
 * animator's tween, so for about a tenth of a second two groups answer to the
 * same name — and the pass it schedules starts one frame later. Meanwhile the
 * builder's own `this.scene` is the document it was CONSTRUCTED with; every
 * commit hands the model a new frozen object, and only `rebuildAll` re-reads
 * it, which a variant swap deliberately does not do.
 */
describe('a variant swap moves the upgrade onto the new body', () => {
  const PLACEMENT = BED.first;
  const CHOSEN = VARIANT.bed_platform;

  function variantScene(): SceneData {
    return {
      ...lShapePlan,
      assets: [
        {
          id: PLACEMENT,
          type: 'bed',
          asset: ARCHETYPE.bed_double,
          variant: VARIANT.bed_double_linen,
          position: { x: 3, y: 0, z: 4 },
          rotationY: 0,
          room: ROOM.a,
        },
      ],
    };
  }

  test('the pass upgrades the group that replaced the old one, with the variant the document now names', async () => {
    const model = new SceneModel(variantScene(), CATALOGUE_REGISTRIES);
    const requested: string[] = [];
    const builder = new SceneBuilder(model.scene, model.plan, {
      modelUrl: (asset) => `https://models.test/${asset.variantId}.glb`,
      modelSource: (request: ModelRequest): Promise<ModelOutcome> => {
        requested.push(request.variantId);
        const group = new THREE.Group();
        group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), new THREE.MeshStandardMaterial()));
        return Promise.resolve({ group, triangles: 12, warnings: [], bytes: 16 });
      },
    });
    const built = builder.build();
    builder.bindModel(model);
    const furniture = built.root.getObjectByName(FURNITURE_GROUP_NAME)!;
    const leaving = furniture.children[0] as THREE.Group;

    // The document commits the new variant...
    const applied = model.apply({ baseRev: model.rev, ops: [{ op: 'replace_asset_variant', assetId: PLACEMENT, variant: CHOSEN }] });
    expect(isApplyOk(applied)).toBe(true);
    // ...and the editor answers by ADDING the new group. The old one is still
    // attached: the animator removes it only when its tween ends.
    const arriving = builder.buildFurnitureVariant(model.scene.assets[0]!, CHOSEN);
    if (!arriving) throw new Error('the bank should offer the chosen variant');
    furniture.add(arriving);
    expect(furniture.children.filter((child) => child.name === PLACEMENT)).toHaveLength(2);

    const swapped: THREE.Object3D[] = [];
    const pass = await builder.upgradeModels(new AbortController().signal, undefined, (group) => swapped.push(group));

    expect(pass).toMatchObject({ upgraded: 1, failed: 0, budget: false, failures: [] });
    expect(swapped).toHaveLength(1);
    expect(swapped[0]).toBe(arriving);
    expect(arriving.userData['modelState']).toBe('gltf');
    // The body on its way out is left exactly as it was — nothing downloads
    // into a group nobody will draw.
    expect(leaving.userData['modelState']).toBe('procedural');
    // And the model fetched is the one the DOCUMENT names now, not the one the
    // builder was constructed with.
    expect(requested).toEqual([CHOSEN]);
    builder.dispose();
  });
});

/**
 * Ceiling bodies no builder made hang from the ceiling plane. The walk, the
 * plan and the layout lint read the catalogue facts, never the drawn origin,
 * so they say the same before and after the build, and what they say (a
 * ceiling item spans `y - height .. y`) is now what is drawn.
 */
describe('a hanging project pendant, through the builder', () => {
  /** A bank ceiling light: its builder draws it hanging, so it is left as it is. */
  const BANK_CEILING = '01a16c46-c3ca-70cc-959a-dadafbfea9fb';

  function hangingScene(): SceneData {
    const scene = draftOf(lShapePlan);
    scene.ceilingHeight = HANGING.ceiling;
    scene.assetLibrary = HANGING.project;
    scene.assets = [
      {
        id: HANGING.placement,
        type: HANGING.archetype,
        asset: HANGING.archetype,
        variant: HANGING.variant,
        room: ROOM.a,
        position: { x: 3, y: 0, z: 3 },
        rotationY: 0,
      },
      {
        id: BANK_CEILING,
        type: 'ceiling-light',
        asset: ARCHETYPE.ceiling_light,
        room: ROOM.a,
        position: { x: 2, y: 0, z: 2 },
        rotationY: 0,
      },
    ];
    return scene;
  }

  /** Every ceiling fact the walk, the plan and the lint compute, as plain data. */
  function facts(scene: SceneData, plan: SolvedPlan): unknown {
    const library = hangingManifest().library;
    const source = projectAssetFacts(library);
    const catalogue = projectLayoutCatalogue(library);
    return JSON.parse(
      JSON.stringify({
        obstacles: obstaclesFor(scene, source),
        plan: buildPlanDrawing(plan, scene, planDrawingInputs(scene, source)),
        lint: lintLayout(scene, plan, catalogue),
        mounts: lintContext(scene, plan, catalogue).items.map((item) => ({ id: item.placement.id, mount: item.mount })),
      }),
    ) as unknown;
  }

  function hangingBuilder(scene: SceneData): SceneBuilder {
    const manifest = hangingManifest();
    const bank = projectBank(manifest, QUEUE_BASE_URL);
    return new SceneBuilder(scene, solvePlan(scene), {
      catalogue: bank.catalogue,
      resolveFinish: bank.resolveFinish,
      modelUrl: (asset) => bank.modelUrl(asset),
      modelSource: () => Promise.resolve({ group: modelFrameBox(HANGING.dims), triangles: 12, warnings: [], bytes: 0 }),
    });
  }

  function worldBoxOf(root: THREE.Object3D, id: string): THREE.Box3 {
    const group = root.getObjectByName(FURNITURE_GROUP_NAME)!.getObjectByName(id)!;
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(group);
  }

  test('stand-in and GLB occupy the same world box, its top at the ceiling', async () => {
    const scene = hangingScene();
    const builder = hangingBuilder(scene);
    const { root } = builder.build();
    const standIn = worldBoxOf(root, HANGING.placement);
    const pass = await builder.upgradeModels(new AbortController().signal);
    expect(pass.upgraded).toBe(1);
    const glb = worldBoxOf(root, HANGING.placement);
    expect(glb.max.y).toBeCloseTo(HANGING.ceiling, 3);
    expect(glb.min.y).toBeCloseTo(HANGING.ceiling - HANGING.dims[1], 3);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(glb.min[axis]).toBeCloseTo(standIn.min[axis], 3);
      expect(glb.max[axis]).toBeCloseTo(standIn.max[axis], 3);
    }
    builder.dispose();
  });

  test('the document facts (walk obstacles, plan facts, layout lint) are unchanged by the build and the upgrade', async () => {
    const scene = hangingScene();
    const plan = solvePlan(scene);
    const before = facts(scene, plan);
    const builder = hangingBuilder(scene);
    builder.build();
    await builder.upgradeModels(new AbortController().signal);
    expect(facts(scene, plan)).toEqual(before);
    builder.dispose();
  });

  test('the drawn box after the upgrade matches the catalogue mount the walk and lint read', async () => {
    const scene = hangingScene();
    const before = facts(scene, solvePlan(scene));
    const builder = hangingBuilder(scene);
    const { root } = builder.build();
    await builder.upgradeModels(new AbortController().signal);
    const mounts = (before as { mounts: Array<{ id: string; mount: { low: number; high: number } }> }).mounts;
    // Within 5 mm: the bank ceiling light's builder draws 2 mm more than its catalogue drop.
    for (const id of [HANGING.placement, BANK_CEILING]) {
      const mount = mounts.find((entry) => entry.id === id)!.mount;
      const drawn = worldBoxOf(root, id);
      expect({ id, low: drawn.min.y, high: drawn.max.y }).toEqual({
        id,
        low: expect.closeTo(mount.low, 2),
        high: expect.closeTo(mount.high, 2),
      });
    }
    builder.dispose();
  });
});

/* ------------------------------------------------- lamp lights, upgraded --- */

const LAMP_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project-lamps');
const LAMP_BASE = 'https://lamps.test/bake/';

type EditableLamps = { library: { objects: Array<{ variants: Array<Record<string, unknown>> }> } };

/**
 * The committed lamp GLB at `path`, with a `KHR_lights_punctual` point light
 * of its own added when `foreignLight` says so: the defect a supplier's file
 * may carry, which the source strips (`light-in-model`).
 */
function lampGlb(path: string, foreignLight: boolean): ArrayBuffer {
  const bytes = new Uint8Array(readFileSync(join(LAMP_DIR, path)));
  if (!foreignLight) return bytes.slice().buffer;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    extensionsUsed?: string[];
    extensions?: Record<string, unknown>;
    nodes: Record<string, unknown>[];
    scenes: { nodes: number[] }[];
  };
  json.extensionsUsed = [...(json.extensionsUsed ?? []), 'KHR_lights_punctual'];
  json.extensions = { KHR_lights_punctual: { lights: [{ type: 'point', intensity: 5 }] } };
  json.nodes.push({ name: 'supplier_bulb', translation: [0, 0.3, 0], extensions: { KHR_lights_punctual: { light: 0 } } });
  json.scenes[0]!.nodes.push(json.nodes.length - 1);
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array((text.byteLength + 3) & ~3).fill(0x20);
  padded.set(text);
  const binary = bytes.subarray(20 + jsonLength);
  const glb = new Uint8Array(12 + 8 + padded.byteLength + binary.byteLength);
  const out = new DataView(glb.buffer);
  out.setUint32(0, 0x46546c67, true);
  out.setUint32(4, 2, true);
  out.setUint32(8, glb.byteLength, true);
  out.setUint32(12, padded.byteLength, true);
  out.setUint32(16, 0x4e4f534a, true);
  glb.set(padded, 20);
  glb.set(binary, 20 + padded.byteLength);
  return glb.buffer;
}

/** The lamp fixture's scene and bake through a real builder and the real GLB source. */
function lampBuilder(
  options: { edit?: (manifest: EditableLamps) => void; place?: (scene: Draft<SceneData>) => void; foreignLight?: boolean } = {},
): { builder: SceneBuilder; root: THREE.Group; warnings: Array<{ code: string; detail: unknown }> } {
  const raw = JSON.parse(readFileSync(join(LAMP_DIR, 'project.json'), 'utf8')) as EditableLamps;
  options.edit?.(raw);
  const manifest = parseProjectManifest(raw);
  const scene = draftOf(JSON.parse(readFileSync(join(LAMP_DIR, 'scene.json'), 'utf8')) as SceneData);
  options.place?.(scene);
  const bank = projectBank(manifest, LAMP_BASE);
  const fetch = ((url: string) =>
    Promise.resolve(
      new Response(lampGlb(url.slice(LAMP_BASE.length), options.foreignLight ?? false), { status: 200 }),
    )) as unknown as typeof globalThis.fetch;
  const warnings: Array<{ code: string; detail: unknown }> = [];
  const builder = new SceneBuilder(scene, solvePlan(scene), {
    catalogue: bank.catalogue,
    catalogueLibrary: bank.defaultLibrary,
    resolveFinish: bank.resolveFinish,
    projectMaterials: manifest.library.materials,
    modelUrl: (asset) => bank.modelUrl(asset),
    modelSource: createGltfModelSource({ fetch }),
    log: { warn: (code, _message, detail) => warnings.push({ code, detail }), error: () => undefined },
  });
  const { root } = builder.build();
  return { builder, root, warnings };
}

function lampGroup(root: THREE.Object3D, id: string): THREE.Group {
  const group = root.getObjectByName(FURNITURE_GROUP_NAME)?.getObjectByName(id);
  if (!(group instanceof THREE.Group)) throw new Error(`no group for ${id}`);
  return group;
}

function pointLights(root: THREE.Object3D): THREE.PointLight[] {
  const lights: THREE.PointLight[] = [];
  root.traverse((child) => {
    if ((child as THREE.PointLight).isPointLight) lights.push(child as THREE.PointLight);
  });
  return lights;
}

function worldOf(object: THREE.Object3D): THREE.Vector3 {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(new THREE.Vector3());
}

const TABLE_BULB = { kind: 'point', position: [0, 0.443, 0], colour: '#ffd9a4', lumens: 400, cutoff: 3 } as const;
const tableLights =
  (lights: readonly Record<string, unknown>[]) =>
  (manifest: EditableLamps): void => {
    manifest.library.objects[0]!.variants[0]!['lights'] = lights;
  };

describe('lamp lights survive the GLB upgrade', () => {
  test('the GLB body holds the SAME light, at the authored local position, at the same world position', async () => {
    const { builder, root } = lampBuilder();
    const group = lampGroup(root, LAMPS.placement.pendant);
    const [light] = pointLights(group);
    const standIn = light!.parent!;
    expect(light!.position.toArray()).toEqual([0, 0.063, 0]);
    const before = worldOf(light!);
    const swaps: Array<readonly THREE.Object3D[]> = [];
    const pass = await builder.upgradeModels(new AbortController().signal, undefined, (swapped, replaced) => {
      if (swapped === group) swaps.push(replaced);
    });
    expect(pass.upgraded).toBe(2);
    const after = pointLights(group);
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(light);
    expect(light!.parent).not.toBe(standIn);
    expect(light!.parent!.name).toBe(`${LAMPS.variant.pendant}-gltf`);
    expect(light!.position.toArray()).toEqual([0, 0.063, 0]);
    expect(worldOf(light!).distanceTo(before)).toBeLessThan(1e-6);
    // The light is not a body: the swap reports the stand-in alone.
    expect(swaps).toEqual([[standIn]]);
    expect(lampLightTag(light!)?.index).toBe(0);
    builder.dispose();
  });

  test('a lamp placed at scale 1.5 holds its light at 1.5 times the authored offset, distance and intensity unchanged', async () => {
    const { builder, root } = lampBuilder({
      place: (scene) => {
        scene.assets.find((asset) => asset.id === LAMPS.placement.tableLamp)!.scale = 1.5;
      },
    });
    await builder.upgradeModels(new AbortController().signal);
    const group = lampGroup(root, LAMPS.placement.tableLamp);
    const [light] = pointLights(group);
    const offset = worldOf(light!).sub(worldOf(group));
    expect(offset.y).toBeCloseTo(1.5 * 0.443, 6);
    expect(light!.distance).toBe(3);
    expect(light!.intensity).toBeCloseTo(1.2, 9);
    builder.dispose();
  });

  test('a tint and a bake mark ride along, and «Original» still restores the authored colour', async () => {
    const { builder, root } = lampBuilder();
    const [light] = pointLights(lampGroup(root, LAMPS.placement.tableLamp));
    const authored = light!.color.clone();
    tintArtificialLights(root, 2700);
    setLampBaked(light!, true);
    const tinted = light!.color.clone();
    const marks = { ...light!.userData };
    expect(tinted.equals(authored)).toBe(false);
    await builder.upgradeModels(new AbortController().signal);
    expect(pointLights(lampGroup(root, LAMPS.placement.tableLamp))).toEqual([light!]);
    expect(light!.color.equals(tinted)).toBe(true);
    expect(light!.userData).toEqual(marks);
    tintArtificialLights(root, null);
    expect(light!.color.equals(authored)).toBe(true);
    builder.dispose();
  });

  test("a light the GLB file brings is dropped and reported; only the variant's own light remains", async () => {
    const { builder, root } = lampBuilder({ foreignLight: true });
    const group = lampGroup(root, LAMPS.placement.tableLamp);
    const [own] = pointLights(group);
    await builder.upgradeModels(new AbortController().signal);
    expect(pointLights(group)).toEqual([own!]);
    expect(group.userData['modelWarnings']).toContain('light-in-model');
    builder.dispose();
  });

  test('a variant without lights has no light on its stand-in and none after the upgrade', async () => {
    const { builder, root } = lampBuilder({
      edit: (manifest) => {
        for (const object of manifest.library.objects) for (const variant of object.variants) delete variant['lights'];
      },
    });
    expect(pointLights(root)).toEqual([]);
    await builder.upgradeModels(new AbortController().signal);
    expect(pointLights(root)).toEqual([]);
    builder.dispose();
  });

  test('a placement mirrored on x keeps its off-axis light mirrored on the GLB body', async () => {
    const { builder, root } = lampBuilder({
      edit: tableLights([{ ...TABLE_BULB, position: [0.2, 0.443, 0] }]),
      place: (scene) => {
        scene.assets.find((asset) => asset.id === LAMPS.placement.tableLamp)!.mirror = { x: true };
      },
    });
    const group = lampGroup(root, LAMPS.placement.tableLamp);
    const inGroup = (): THREE.Vector3 => group.worldToLocal(worldOf(pointLights(group)[0]!));
    expect(inGroup().x).toBeCloseTo(-0.2, 6);
    await builder.upgradeModels(new AbortController().signal);
    expect(inGroup().x).toBeCloseTo(-0.2, 6);
    expect(inGroup().y).toBeCloseTo(0.443, 6);
    builder.dispose();
  });
});
