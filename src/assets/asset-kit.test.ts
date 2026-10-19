/**
 * Invariants of the shared geometry cache, for the parts a builder cannot check
 * for itself: that a frustum really is the solid it was asked for, that its
 * arrises stay crisp, and that the cache keeps handing out the same buffer.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { GeometryCache, type BladeSpec } from './asset-kit.js';

/** A plain oval blade; each test below varies the one field it is about. */
const FLAT_BLADE: BladeSpec = { width: 0.3, waist: 0.5, blunt: 1, crease: 0, curl: 0, pinch: 0, wave: 0, rows: 6, cols: 3 };

describe('GeometryCache.frustum', () => {
  test('spans the requested bottom rectangle, top rectangle and height', () => {
    const cache = new GeometryCache();
    const geometry = cache.frustum(0.9, 0.5, 0.3, 0.2, 0.4);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // The widest section is the bottom, so the bounds report it.
    expect(box.max.x - box.min.x).toBeCloseTo(0.9, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(0.5, 6);
    expect(box.max.y - box.min.y).toBeCloseTo(0.4, 6);
    expect(box.min.y).toBeCloseTo(-0.2, 6);
    cache.dispose();
  });

  test('`topZ` offsets the top face, which is how a back face is left vertical', () => {
    const cache = new GeometryCache();
    const bottomDepth = 0.5;
    const topDepth = 0.2;
    const geometry = cache.frustum(0.9, bottomDepth, 0.3, topDepth, 0.4, (topDepth - bottomDepth) / 2);
    const position = geometry.getAttribute('position');
    // Every vertex on the back (-Z) side sits on one plane: the face is vertical.
    const back = -bottomDepth / 2;
    let onBackPlane = 0;
    for (let i = 0; i < position.count; i += 1) {
      if (Math.abs(position.getZ(i) - back) < 1e-6) onBackPlane += 1;
    }
    // The back face contributes all six of its vertices, and the four faces
    // that meet it contribute three each.
    expect(onBackPlane).toBe(18);
    cache.dispose();
  });

  test('every facet keeps one flat normal, so the arrises stay crisp', () => {
    const cache = new GeometryCache();
    const geometry = cache.frustum(0.9, 0.5, 0.3, 0.2, 0.4, -0.15);
    expect(geometry.index).toBeNull();
    const normal = geometry.getAttribute('normal');
    expect(normal.count).toBe(36); // 12 triangles, no shared vertices
    for (let triangle = 0; triangle < normal.count / 3; triangle += 1) {
      const first = new THREE.Vector3().fromBufferAttribute(normal, triangle * 3);
      for (const offset of [1, 2]) {
        const other = new THREE.Vector3().fromBufferAttribute(normal, triangle * 3 + offset);
        expect(first.angleTo(other)).toBeCloseTo(0, 6);
      }
    }
    cache.dispose();
  });

  test('all six faces point outwards', () => {
    const cache = new GeometryCache();
    const geometry = cache.frustum(0.9, 0.5, 0.3, 0.2, 0.4, -0.15);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const centroid = new THREE.Vector3();
    const face = new THREE.Vector3();
    for (let triangle = 0; triangle < position.count / 3; triangle += 1) {
      centroid.set(0, 0, 0);
      for (const offset of [0, 1, 2]) centroid.add(new THREE.Vector3().fromBufferAttribute(position, triangle * 3 + offset));
      centroid.divideScalar(3);
      face.fromBufferAttribute(normal, triangle * 3);
      // A convex solid around the origin: every facet normal leans away from it.
      expect(face.dot(centroid)).toBeGreaterThan(0);
    }
    cache.dispose();
  });

  test('the same frustum is one shared buffer', () => {
    const cache = new GeometryCache();
    const first = cache.frustum(0.9, 0.5, 0.3, 0.2, 0.4, -0.15);
    expect(cache.frustum(0.9, 0.5, 0.3, 0.2, 0.4, -0.15)).toBe(first);
    expect(cache.frustum(0.9, 0.5, 0.3, 0.2, 0.4)).not.toBe(first);
    expect(cache.size()).toBe(2);
    cache.dispose();
  });
});

describe('GeometryCache.blade', () => {
  test('is one unit long from a base at the origin, and no wider than its spec', () => {
    const cache = new GeometryCache();
    const geometry = cache.blade(FLAT_BLADE);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(1, 6);
    expect(box.max.x).toBeLessThanOrEqual(FLAT_BLADE.width + 1e-6);
    expect(box.min.x).toBeGreaterThanOrEqual(-FLAT_BLADE.width - 1e-6);
    // A flat blade stays in its own plane.
    expect(box.max.z - box.min.z).toBeCloseTo(0, 6);
    cache.dispose();
  });

  test('is widest exactly at its waist, which is what separates a leaflet from a fiddle leaf', () => {
    const cache = new GeometryCache();
    for (const waist of [0.3, 0.7]) {
      const geometry = cache.blade({ ...FLAT_BLADE, waist, rows: 11 });
      const position = geometry.getAttribute('position');
      let widest = { x: 0, y: 0 };
      for (let i = 0; i < position.count; i += 1) {
        const x = Math.abs(position.getX(i));
        if (x > widest.x) widest = { x, y: position.getY(i) };
      }
      expect(widest.x).toBeCloseTo(FLAT_BLADE.width, 6);
      expect(widest.y).toBeCloseTo(waist, 6);
    }
    cache.dispose();
  });

  test('`crease` folds the edges back and keeps the midrib in the plane', () => {
    const cache = new GeometryCache();
    const crease = 0.18;
    const geometry = cache.blade({ ...FLAT_BLADE, crease, rows: 11 });
    geometry.computeBoundingBox();
    // The deepest fold is at the widest rib, where the fold scale is 1.
    expect(geometry.boundingBox!.min.z).toBeCloseTo(-crease, 6);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      if (Math.abs(position.getX(i)) < 1e-9) expect(position.getZ(i)).toBeCloseTo(0, 6);
    }
    cache.dispose();
  });

  test('the fold is crisp: the midrib carries one normal per half, a flat blade only one', () => {
    const cache = new GeometryCache();
    const midribNormals = (crease: number): THREE.Vector3[] => {
      const geometry = cache.blade({ ...FLAT_BLADE, crease, rows: 11 });
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const found: THREE.Vector3[] = [];
      for (let i = 0; i < position.count; i += 1) {
        if (Math.abs(position.getX(i)) > 1e-9 || Math.abs(position.getY(i) - 0.5) > 1e-9) continue;
        found.push(new THREE.Vector3().fromBufferAttribute(normal, i));
      }
      return found;
    };
    const folded = midribNormals(0.2);
    expect(folded).toHaveLength(2);
    expect(folded[0]!.angleTo(folded[1]!)).toBeGreaterThan(0.1);
    const flat = midribNormals(0);
    expect(flat).toHaveLength(2);
    expect(flat[0]!.angleTo(flat[1]!)).toBeCloseTo(0, 6);
    cache.dispose();
  });

  test('`curl` bends the tip back, `pinch` narrows the middle and `wave` ripples the edge', () => {
    const cache = new GeometryCache();
    const curled = cache.blade({ ...FLAT_BLADE, curl: 0.25, rows: 11 });
    curled.computeBoundingBox();
    expect(curled.boundingBox!.min.z).toBeCloseTo(-0.25, 6);
    const widthAt = (spec: BladeSpec, y: number): number => {
      const position = cache.blade(spec).getAttribute('position');
      let widest = 0;
      for (let i = 0; i < position.count; i += 1) {
        if (Math.abs(position.getY(i) - y) > 1e-6) continue;
        widest = Math.max(widest, Math.abs(position.getX(i)));
      }
      return widest;
    };
    const plain = { ...FLAT_BLADE, rows: 11 };
    expect(widthAt({ ...plain, pinch: 0.4 }, 0.4)).toBeLessThan(widthAt(plain, 0.4));
    // A wavy edge is not a monotone envelope: some rib is wider than the plain
    // blade's at the same height and some is narrower.
    const wavy = { ...plain, wave: 0.2 };
    const deltas = [0.1, 0.3, 0.5, 0.7].map((y) => widthAt(wavy, y) - widthAt(plain, y));
    expect(Math.max(...deltas)).toBeGreaterThan(0);
    expect(Math.min(...deltas)).toBeLessThan(0);
    cache.dispose();
  });

  test('every normal is a unit vector - the collapsed base and tip ribs produce no NaN', () => {
    const cache = new GeometryCache();
    const normal = cache
      .blade({ width: 0.24, waist: 0.66, blunt: 0.7, crease: 0.09, curl: 0.14, pinch: 0.3, wave: 0.12, rows: 7, cols: 2 })
      .getAttribute('normal');
    for (let i = 0; i < normal.count; i += 1) {
      expect(new THREE.Vector3().fromBufferAttribute(normal, i).length()).toBeCloseTo(1, 5);
    }
    cache.dispose();
  });

  test('`blunt` holds the blade broad and rounds the tip off instead of tapering to a point', () => {
    const cache = new GeometryCache();
    const widthAt = (blunt: number, y: number): number => {
      const position = cache.blade({ ...FLAT_BLADE, blunt, rows: 11 }).getAttribute('position');
      let widest = 0;
      for (let i = 0; i < position.count; i += 1) {
        if (Math.abs(position.getY(i) - y) > 1e-6) continue;
        widest = Math.max(widest, Math.abs(position.getX(i)));
      }
      return widest;
    };
    // Broader everywhere but the waist, where both still reach the full width.
    expect(widthAt(0.6, 0.5)).toBeCloseTo(widthAt(1, 0.5), 6);
    expect(widthAt(0.6, 0.9)).toBeGreaterThan(widthAt(1, 0.9) * 1.5);
    expect(widthAt(0.6, 1)).toBeCloseTo(0, 6);
    cache.dispose();
  });

  test('the same blade spec is one shared buffer', () => {
    const cache = new GeometryCache();
    const first = cache.blade(FLAT_BLADE);
    expect(cache.blade({ ...FLAT_BLADE })).toBe(first);
    expect(cache.blade({ ...FLAT_BLADE, waist: 0.66 })).not.toBe(first);
    expect(cache.size()).toBe(2);
    cache.dispose();
  });
});

describe('GeometryCache.tube', () => {
  const ARCH: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 0],
    [0, 0.5, 0.1],
    [0, 0.9, 0.4],
  ];

  test('sweeps the curve and adds its radius to the bounds', () => {
    const cache = new GeometryCache();
    const radius = 0.02;
    const geometry = cache.tube(ARCH, radius, 10, 6);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeGreaterThanOrEqual(-radius - 1e-6);
    expect(box.max.y).toBeLessThanOrEqual(0.9 + radius + 1e-6);
    expect(box.max.y).toBeGreaterThan(0.9 - radius);
    expect(box.max.z).toBeGreaterThan(0.4 - radius);
    expect(box.max.x - box.min.x).toBeCloseTo(radius * 2, 2);
    cache.dispose();
  });

  test('`taper` thins the far end and leaves the first ring at full radius', () => {
    const cache = new GeometryCache();
    const radius = 0.04;
    const tubular = 8;
    const radial = 5;
    const position = cache.tube(ARCH, radius, tubular, radial, 0.3).getAttribute('position');
    const ringRadius = (ring: number, centre: THREE.Vector3): number => {
      let largest = 0;
      for (let spoke = 0; spoke <= radial; spoke += 1) {
        const vertex = new THREE.Vector3().fromBufferAttribute(position, ring * (radial + 1) + spoke);
        largest = Math.max(largest, vertex.distanceTo(centre));
      }
      return largest;
    };
    expect(ringRadius(0, new THREE.Vector3(0, 0, 0))).toBeCloseTo(radius, 4);
    expect(ringRadius(tubular, new THREE.Vector3(0, 0.9, 0.4))).toBeCloseTo(radius * 0.3, 4);
    cache.dispose();
  });

  test('a tapered sweep keeps unit normals', () => {
    const cache = new GeometryCache();
    const normal = cache.tube(ARCH, 0.03, 8, 5, 0.4).getAttribute('normal');
    for (let i = 0; i < normal.count; i += 1) {
      expect(new THREE.Vector3().fromBufferAttribute(normal, i).length()).toBeCloseTo(1, 5);
    }
    cache.dispose();
  });

  test('the same sweep is one shared buffer', () => {
    const cache = new GeometryCache();
    const first = cache.tube(ARCH, 0.02, 8, 5);
    expect(cache.tube(ARCH, 0.02, 8, 5)).toBe(first);
    expect(cache.tube(ARCH, 0.02, 8, 5, 0.5)).not.toBe(first);
    expect(cache.size()).toBe(2);
    cache.dispose();
  });
});
