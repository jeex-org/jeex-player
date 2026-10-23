import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { solvePlan } from '../plan/plan-solver.js';
import { apartmentScene } from '../demo/scene-data.js';
import { createBuilderContext } from './builder-context.js';
import { ShellBuilder } from './shell-builder.js';
import { OpeningBuilder } from './opening-builder.js';
import { FRAME_SHIFT_M, rebaseOpeningFrames, rebaseShellOrigins, SHELL_ORIGIN_OFFSET_M } from './shell-origins.js';
import { SceneBuilder } from './scene-builder.js';
import { Dollhouse } from './dollhouse.js';

const scene = apartmentScene;
const plan = solvePlan(scene);

/** The shell and the openings as the scene builder makes them, before any rebase. */
function rawShell(): THREE.Group {
  const ctx = createBuilderContext(scene, plan);
  const group = new THREE.Group();
  new ShellBuilder(ctx).build(group);
  new OpeningBuilder(ctx).build(group);
  group.updateMatrixWorld(true);
  return group;
}

type Snapshot = Map<string, { world: number[]; uv: number[] | null; position: THREE.Vector3 }>;

function snapshot(root: THREE.Object3D): Snapshot {
  root.updateMatrixWorld(true);
  const out: Snapshot = new Map();
  const v = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    const world: number[] = [];
    for (let i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      world.push(v.x, v.y, v.z);
    }
    const uv = object.geometry.getAttribute('uv');
    out.set(object.uuid, { world, uv: uv ? Array.from(uv.array as Float32Array) : null, position: object.position.clone() });
  });
  return out;
}

const meshes = (root: THREE.Object3D, keep: (mesh: THREE.Mesh) => boolean): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && keep(object)) out.push(object);
  });
  return out;
};

const origin = (mesh: THREE.Object3D): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);

const roomPolygon = (roomId: string) => plan.rooms.find((room) => room.roomId === roomId)!.polygon;

function insidePolygon(p: { x: number; z: number }, polygon: readonly { x: number; z: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

describe('rebaseShellOrigins', () => {
  const shell = rawShell();
  const before = snapshot(shell);
  rebaseShellOrigins(shell, plan, scene.ceilingHeight);
  shell.updateMatrixWorld(true);
  const after = snapshot(shell);

  test('leaves every world-space vertex and every UV where it was', () => {
    let worst = 0;
    for (const [uuid, then] of before) {
      const now = after.get(uuid)!;
      expect(now.uv).toEqual(then.uv);
      for (let i = 0; i < then.world.length; i += 1) worst = Math.max(worst, Math.abs(now.world[i]! - then.world[i]!));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  test('puts every room wall face and skirting origin inside its own room, a facade face outside every room', () => {
    for (const mesh of meshes(shell, (m) => m.userData['surface'] === 'wall')) {
      const roomId = mesh.userData['roomId'] as string | undefined;
      const at = origin(mesh);
      if (roomId === undefined) {
        expect(plan.rooms.some((room) => insidePolygon(at, room.polygon))).toBe(false);
      } else {
        expect(insidePolygon(at, roomPolygon(roomId))).toBe(true);
      }
    }
    for (const board of meshes(shell, (m) => m.name === 'wall-face-skirting')) {
      const face = plan.faces.get(board.userData['face'])!;
      if (face.roomId !== null) expect(insidePolygon(origin(board), roomPolygon(face.roomId))).toBe(true);
    }
  });

  test('lifts floor origins 0.1 m above the floor and drops ceiling origins 0.1 m below the ceiling, inside their rooms', () => {
    for (const floor of meshes(shell, (m) => m.userData['surface'] === 'floor')) {
      const at = origin(floor);
      expect(at.y).toBeCloseTo(SHELL_ORIGIN_OFFSET_M.floor, 6);
      expect(insidePolygon(at, roomPolygon(floor.userData['roomId']))).toBe(true);
    }
    for (const ceiling of meshes(shell, (m) => m.userData['isCeiling'] === true)) {
      const at = origin(ceiling);
      expect(at.y).toBeCloseTo(scene.ceilingHeight - SHELL_ORIGIN_OFFSET_M.ceiling, 6);
      expect(insidePolygon(at, roomPolygon(ceiling.userData['roomId']))).toBe(true);
    }
  });

  test('keeps the slab, the ground and every parametric wall height where they were', () => {
    for (const name of ['site-slab', 'site-ground']) {
      const mesh = shell.getObjectByName(name)!;
      expect(mesh.position.toArray()).toEqual(before.get(mesh.uuid)!.position.toArray());
    }
    for (const part of meshes(shell, (m) => m.userData['isParametricWall'] === true)) {
      expect(part.position.y).toBe(before.get(part.uuid)!.position.y);
    }
  });

  test('moves an interior door frame off the centreline towards the side its leaf opens into', () => {
    let doors = 0;
    shell.traverse((group) => {
      const leaf = group.children.find((child) => child.userData['isDoorLeaf'] === true);
      if (!leaf || leaf.userData['isExteriorWall'] === true) return;
      const openSign = leaf.userData['openSign'] as number;
      for (const part of group.children.filter((child) => child.userData['isParametricWall'] === true)) {
        const shift = part.position.z - before.get(part.uuid)!.position.z;
        expect(shift).toBeCloseTo(openSign * FRAME_SHIFT_M, 9);
      }
      doors += 1;
    });
    expect(doors).toBeGreaterThan(3);
  });

  test('is idempotent: a second pass moves nothing', () => {
    const again = snapshot(shell);
    rebaseShellOrigins(shell, plan, scene.ceilingHeight);
    for (const [uuid, then] of again) expect(snapshot(shell).get(uuid)!.position.toArray()).toEqual(then.position.toArray());
  });
});

describe('rebaseOpeningFrames', () => {
  test('moves the frames of one rebuilt door group and keeps their vertices', () => {
    const ctx = createBuilderContext(scene, plan);
    const builder = new OpeningBuilder(ctx);
    const root = new THREE.Group();
    builder.build(root);
    const group = root.children.find((child) => child.children.some((leaf) => leaf.userData['isDoorLeaf'] === true && !leaf.userData['isExteriorWall']))!;
    const before = snapshot(group);
    rebaseOpeningFrames(group);
    const after = snapshot(group);
    for (const [uuid, then] of before) {
      const now = after.get(uuid)!;
      for (let i = 0; i < then.world.length; i += 1) expect(now.world[i]!).toBeCloseTo(then.world[i]!, 5);
    }
  });
});

describe('SceneBuilder', () => {
  test('rebases the shell it builds', () => {
    const builder = new SceneBuilder(scene, plan);
    const { root } = builder.build();
    root.updateMatrixWorld(true);
    const floor = meshes(root, (m) => m.userData['surface'] === 'floor')[0]!;
    expect(origin(floor).y).toBeCloseTo(SHELL_ORIGIN_OFFSET_M.floor, 6);
    builder.dispose();
  });
});

describe('dollhouse round trip', () => {
  test('full to dollhouse and back keeps every rebased part where the pass put it', () => {
    const builder = new SceneBuilder(scene, plan);
    const { root } = builder.build();
    const before = snapshot(root);
    const dollhouse = new Dollhouse(() => []);
    dollhouse.prepare(plan, root);
    dollhouse.setState('dollhouse');
    dollhouse.setState('full');
    const after = snapshot(root);
    for (const [uuid, then] of before) {
      expect(after.get(uuid)!.position.toArray()).toEqual(then.position.toArray());
    }
    builder.dispose();
  });
});
