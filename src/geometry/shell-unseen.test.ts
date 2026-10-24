/**
 * Which triangles of the built shell a walk can never see, as the builders
 * record them: the demo apartment's classes counted per kind, checked
 * against the geometry they describe, and the one end-cap rule that depends
 * on the neighbouring wall (a collinear continuation covers the cap, a
 * thickness jog leaves it exposed).
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { apartmentScene } from '../demo/scene-data.js';
import { solvePlan } from '../plan/plan-solver.js';
import { draftOf } from '../shared/committed.js';
import type { SceneData } from '../scene/types.js';
import { SceneBuilder } from './scene-builder.js';
import { unseenTriangles } from './shell-unseen.js';

function shellOf(scene: SceneData): THREE.Object3D {
  const root = new SceneBuilder(scene, solvePlan(scene)).build().root;
  root.updateMatrixWorld(true);
  return root.getObjectByName('parametric-shell')!;
}

type Triangle = { normal: THREE.Vector3; centroid: THREE.Vector3; unseen: boolean };

function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
}

/** The world-space triangles of `mesh` with their recorded flag (absent record: all seen). */
function triangles(mesh: THREE.Mesh): Triangle[] {
  const flags = unseenTriangles(mesh.geometry);
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.index;
  const corner = (i: number) => mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i) : i));
  return Array.from({ length: triangleCount(mesh.geometry) }, (_, t) => {
    const [a, b, c] = [corner(3 * t), corner(3 * t + 1), corner(3 * t + 2)];
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    return { normal, centroid: a.clone().add(b).add(c).divideScalar(3), unseen: flags?.[t] === 1 };
  });
}

function kindOf(mesh: THREE.Mesh): string {
  const data = mesh.userData;
  if (mesh.name === 'site-slab' || mesh.name === 'site-ground') return 'site';
  if (data['surface'] === 'floor') return 'floor';
  if (data['isCeiling'] === true) return 'ceiling';
  if (data['surface'] === 'wall') return 'wall';
  if (mesh.name === 'wall-face-skirting') return 'skirting';
  if (data['wallJoint'] === true) return 'joint';
  return 'other';
}

const shell = shellOf(apartmentScene);
const meshes: THREE.Mesh[] = [];
shell.traverse((object) => {
  if (object instanceof THREE.Mesh) meshes.push(object);
});
const H = apartmentScene.ceilingHeight;

describe('the triangles a walk can never see', () => {
  test('every recorded shell mesh has one flag per triangle, and the record adds no userData', () => {
    for (const mesh of meshes) {
      const flags = unseenTriangles(mesh.geometry);
      if (flags) expect(flags.length).toBe(triangleCount(mesh.geometry));
      expect(Object.keys(mesh.userData).some((key) => /unseen/i.test(key))).toBe(false);
    }
  });

  test('on the demo apartment: floors, walls, skirtings and joint cores carry unseen triangles, nothing else does', () => {
    const counts: Record<string, [number, number]> = {};
    for (const mesh of meshes) {
      const kind = kindOf(mesh);
      const all = triangles(mesh);
      const entry = (counts[kind] ??= [0, 0]);
      entry[0] += all.filter((triangle) => triangle.unseen).length;
      entry[1] += all.length;
    }
    // Counted independently from the classification rule before the builders recorded anything: walls 384 backs,
    // 278 bottoms, 168 chord caps, 208 caps covered by another quad, 240 face-end caps; the 8 end-cap triangles where
    // a 0.3 m wall continues collinearly into a 0.1 m one stay seen (the jog's step).
    expect({ floor: counts['floor'], wall: counts['wall'], skirting: counts['skirting'], joint: counts['joint'] }).toEqual({
      floor: [384, 500],
      wall: [1278, 2304],
      skirting: [308, 924],
      joint: [46, 276],
    });
    expect(counts['ceiling']![0]).toBe(0);
    expect(counts['site']![0]).toBe(0);
  });

  test('a floor keeps only its top; a junction core loses only its bottom', () => {
    for (const mesh of meshes.filter((m) => kindOf(m) === 'floor'))
      for (const triangle of triangles(mesh))
        expect(triangle.unseen).toBe(!(triangle.normal.y > 0.99 && Math.abs(triangle.centroid.y) < 1e-6));
    for (const mesh of meshes.filter((m) => kindOf(m) === 'joint'))
      for (const triangle of triangles(mesh)) expect(triangle.unseen).toBe(triangle.normal.y < -0.99);
  });

  test('a wall face keeps its front and its top, and loses its bottom on the floor', () => {
    for (const mesh of meshes.filter((m) => kindOf(m) === 'wall')) {
      for (const triangle of triangles(mesh)) {
        if (triangle.normal.y > 0.99 && Math.abs(triangle.centroid.y - H) < 1e-6) expect(triangle.unseen).toBe(false);
        if (triangle.normal.y < -0.99 && Math.abs(triangle.centroid.y) < 1e-6) expect(triangle.unseen).toBe(true);
      }
    }
  });

  test('a skirting board loses its bottom and the side against the wall', () => {
    for (const mesh of meshes.filter((m) => kindOf(m) === 'skirting')) {
      const unseen = triangles(mesh).filter((triangle) => triangle.unseen);
      expect(unseen.every((triangle) => triangle.normal.y < -0.99 || Math.abs(triangle.normal.y) < 1e-6)).toBe(true);
      expect(unseen.filter((triangle) => triangle.normal.y < -0.99).length).toBe(unseen.length / 2);
    }
  });

  test('the long side a skirting board keeps seen faces the room: just in front of it is no wall', () => {
    // Every wall prism drawn from both sides, so a point inside one is told by the ray leaving it upwards.
    const walls = meshes
      .filter((m) => kindOf(m) === 'wall')
      .map((wall) => {
        const solid = new THREE.Mesh(wall.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
        solid.matrixWorld.copy(wall.matrixWorld);
        return solid;
      });
    const up = new THREE.Vector3(0, 1, 0);
    let checked = 0;
    for (const mesh of meshes.filter((m) => kindOf(m) === 'skirting')) {
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.index;
      triangles(mesh).forEach((triangle, t) => {
        if (triangle.unseen || Math.abs(triangle.normal.y) > 1e-6) return;
        const corners = [0, 1, 2].map((k) =>
          mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(3 * t + k) : 3 * t + k)),
        );
        const longest = Math.max(...corners.map((corner, k) => corner.distanceTo(corners[(k + 1) % 3]!)));
        if (longest <= 0.2) return;
        const origin = triangle.centroid.clone().addScaledVector(triangle.normal, 0.002);
        const caster = new THREE.Raycaster(origin, up);
        expect(caster.intersectObjects(walls, false)).toEqual([]);
        checked += 1;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
});

/** The demo with its straight wall `wallId` split at its midpoint into two collinear walls; the second half `thickness` thick. */
function splitWall(wallId: string, thickness: number): { scene: SceneData; mid: THREE.Vector3; halves: [string, string] } {
  const scene = draftOf(apartmentScene) as unknown as {
    nodes: Array<{ id: string; p: { x: number; z: number } }>;
    walls: Array<{ id: string; a: string; b: string; thickness: number; role?: unknown }>;
  };
  const wall = scene.walls.find((w) => w.id === wallId)!;
  const a = scene.nodes.find((n) => n.id === wall.a)!.p;
  const b = scene.nodes.find((n) => n.id === wall.b)!.p;
  const node = '01a1c000-0000-7000-8000-000000000001';
  const half = '01a1c000-0000-7000-8000-000000000002';
  scene.nodes.push({ id: node, p: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 } });
  scene.walls.push({ ...wall, id: half, a: node, b: wall.b, thickness });
  wall.b = node;
  return { scene: scene as unknown as SceneData, mid: new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2), halves: [wallId, half] };
}

/** A straight demo wall whose faces have no openings. */
function plainWall(): string {
  const faces = [...solvePlan(apartmentScene).faces.values()];
  return apartmentScene.walls.find((wall) => {
    const own = faces.filter((face) => face.wallId === wall.id);
    return own.length === 2 && own.every((face) => face.openings.length === 0 && !face.arc);
  })!.id;
}

/** The end-cap triangles of the wall faces of `halves` that stand at `mid`. */
function capsAt(scene: SceneData, halves: readonly string[], mid: THREE.Vector3): Triangle[] {
  const caps: Triangle[] = [];
  shellOf(scene).traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData['surface'] !== 'wall' || !halves.includes(object.userData['wallId'] as string))
      return;
    for (const triangle of triangles(object)) {
      const flat = new THREE.Vector3(triangle.centroid.x, 0, triangle.centroid.z);
      if (Math.abs(triangle.normal.y) < 1e-6 && flat.distanceTo(mid) < 0.2) caps.push(triangle);
    }
  });
  return caps.filter(
    (triangle) => Math.abs(new THREE.Vector3(triangle.centroid.x, 0, triangle.centroid.z).sub(mid).dot(triangle.normal)) < 1e-6,
  );
}

describe('an end cap at a node of two collinear walls', () => {
  const wallId = plainWall();
  const thickness = apartmentScene.walls.find((wall) => wall.id === wallId)!.thickness;

  test('is unseen when the walls are equally thick: the next wall covers it', () => {
    const { scene, mid, halves } = splitWall(wallId, thickness);
    const caps = capsAt(scene, halves, mid);
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.every((triangle) => triangle.unseen)).toBe(true);
  });

  test('is seen at a thickness jog: the step stays exposed', () => {
    const { scene, mid, halves } = splitWall(wallId, thickness * 0.5);
    const caps = capsAt(scene, halves, mid);
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.some((triangle) => triangle.unseen)).toBe(false);
  });
});
