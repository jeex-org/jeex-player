/**
 * Which objects the walk chain's ambient-occlusion input sees: opaque meshes
 * on layer 0 only. Glass, pick proxies, overlays, shadow-only casters and
 * helpers are hidden for the input pass and restored afterwards, also when the
 * pass throws.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { occludes, withOccludersOnly } from './ao-occluders.js';
import { FLOOR_RING_LAYER, SHADOW_ONLY_LAYER } from '../shared/render-layers.js';

const box = (material: THREE.Material | THREE.Material[] = new THREE.MeshStandardMaterial()): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(), material);

describe('occludes', () => {
  test('an opaque visible mesh on layer 0 occludes', () => {
    expect(occludes(box())).toBe(true);
  });

  test('a mesh that also carries a custom layer still occludes; one only on custom layers does not', () => {
    const wall = box();
    wall.layers.enable(SHADOW_ONLY_LAYER);
    expect(occludes(wall)).toBe(true);
    const ceiling = box();
    ceiling.layers.set(SHADOW_ONLY_LAYER);
    expect(occludes(ceiling)).toBe(false);
    const ring = box();
    ring.layers.set(FLOOR_RING_LAYER);
    expect(occludes(ring)).toBe(false);
  });

  test('transparent, translucent, transmissive, invisible and colour-masked materials do not occlude', () => {
    expect(occludes(box(new THREE.MeshStandardMaterial({ transparent: true })))).toBe(false);
    expect(occludes(box(new THREE.MeshStandardMaterial({ opacity: 0.5 })))).toBe(false);
    expect(occludes(box(new THREE.MeshPhysicalMaterial({ transmission: 0.92 })))).toBe(false);
    expect(occludes(box(new THREE.MeshBasicMaterial({ visible: false })))).toBe(false);
    expect(occludes(box(new THREE.MeshBasicMaterial({ colorWrite: false })))).toBe(false);
    expect(occludes(box(new THREE.MeshPhysicalMaterial({ transmission: 0 })))).toBe(true);
  });

  test('a material array occludes only when every material is opaque', () => {
    expect(occludes(box([new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]))).toBe(true);
    expect(occludes(box([new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial({ transparent: true })]))).toBe(false);
  });

  test('a hidden mesh, lines, points and helpers do not occlude', () => {
    const hidden = box();
    hidden.visible = false;
    expect(occludes(hidden)).toBe(false);
    expect(occludes(new THREE.Line(new THREE.BufferGeometry()))).toBe(false);
    expect(occludes(new THREE.Points(new THREE.BufferGeometry()))).toBe(false);
    expect(occludes(new THREE.AxesHelper())).toBe(false);
  });
});

describe('withOccludersOnly', () => {
  function scene() {
    const root = new THREE.Scene();
    const wall = box();
    const glass = box(new THREE.MeshPhysicalMaterial({ transmission: 0.92 }));
    const proxy = box(new THREE.MeshBasicMaterial({ visible: false }));
    const ring = box();
    ring.layers.set(FLOOR_RING_LAYER);
    const helper = new THREE.AxesHelper();
    const already = box(new THREE.MeshStandardMaterial({ transparent: true }));
    already.visible = false;
    const group = new THREE.Group();
    group.add(glass, proxy);
    root.add(wall, group, ring, helper, already);
    return { root, wall, glass, proxy, ring, helper, already, group };
  }

  test('hides every non-occluder during the draw and restores exactly what it hid', () => {
    const s = scene();
    const seen = withOccludersOnly(s.root, () => [s.wall, s.glass, s.proxy, s.ring, s.helper, s.already, s.group].map((o) => o.visible));
    expect(seen).toEqual([true, false, false, false, false, false, true]);
    expect([s.wall, s.glass, s.proxy, s.ring, s.helper, s.already, s.group].map((o) => o.visible)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      true,
    ]);
  });

  test('restores the visibility when the draw throws', () => {
    const s = scene();
    expect(() =>
      withOccludersOnly(s.root, () => {
        throw new Error('lost context');
      }),
    ).toThrow('lost context');
    expect([s.glass.visible, s.proxy.visible, s.ring.visible, s.helper.visible]).toEqual([true, true, true, true]);
  });
});
