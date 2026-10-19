/**
 * `SelectionHighlight`: what it tints, what it restores, and that it never
 * touches a material another mesh is sharing.
 *
 * A component test rather than a `bun:test` one because `src/render` holds a
 * 0.90 line-coverage floor in the Vitest browser tier
 * (`scripts/coverage-check.ts` `COMPONENT_LAYER_FLOORS`), which a file covered
 * only by `bun test` would report as zero.
 */

import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { HIGHLIGHT_FADE_MS, SelectionHighlight, highlightMatches } from '../../src/render/selection-highlight.js';
import { faceKey } from '../../src/scene/types.js';

/** The entities these meshes stand for, by fixed UUID v7. */
const ID = {
  wallA: '01a12ffa-de44-74af-926f-8dd87ae49179',
  wallB: '01a12ffa-de45-7248-8d18-602746a6634f',
  wallGone: '01a12ffa-de46-7632-9b50-ac8be6805f85',
  kitchen: '01a12ffa-de47-7596-8cbe-0a603867f51d',
  living: '01a12ffa-de48-786c-9fa0-3ffac23ba419',
  sofa: '01a12ffa-de49-7c3a-ba4e-2e7a3a98dac5',
  door: '01a12ffa-de4a-7795-8de1-e6859afea822',
} as const;

function mesh(userData: Record<string, unknown>, material: THREE.Material = new THREE.MeshStandardMaterial()): THREE.Mesh {
  const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  Object.assign(object.userData, userData);
  return object;
}

function rootWith(...objects: THREE.Object3D[]): THREE.Object3D {
  const root = new THREE.Group();
  root.add(...objects);
  return root;
}

describe('highlightMatches', () => {
  test('a wall matches by wallId, a floor by roomId, furniture by assetId, an opening by openingId', () => {
    expect(highlightMatches(mesh({ surface: 'wall', wallId: ID.wallA }), { kind: 'wall', id: ID.wallA })).toBe(true);
    expect(highlightMatches(mesh({ surface: 'wall', wallId: ID.wallB }), { kind: 'wall', id: ID.wallA })).toBe(false);
    expect(highlightMatches(mesh({ surface: 'floor', roomId: ID.kitchen }), { kind: 'room', id: ID.kitchen })).toBe(true);
    expect(highlightMatches(mesh({ surface: 'furniture', assetId: ID.sofa }), { kind: 'furniture', id: ID.sofa })).toBe(true);
    expect(highlightMatches(mesh({ surface: 'opening', openingId: ID.door }), { kind: 'opening', id: ID.door })).toBe(true);
  });

  test('a wall joint core is never a highlight target: it carries no surface', () => {
    expect(highlightMatches(mesh({ wallJoint: true, wallIds: [ID.wallA] }), { kind: 'wall', id: ID.wallA })).toBe(false);
  });
});

describe('SelectionHighlight', () => {
  test('tints both faces of a wall and restores the exact materials on clear', () => {
    const shared = new THREE.MeshStandardMaterial();
    const left = mesh({ surface: 'wall', wallId: ID.wallA, face: faceKey(ID.kitchen, ID.wallA, 'L') }, shared);
    const right = mesh({ surface: 'wall', wallId: ID.wallA, face: faceKey(ID.living, ID.wallA, 'R') }, shared);
    const other = mesh({ surface: 'wall', wallId: ID.wallB }, shared);
    const root = rootWith(left, right, other);
    const highlight = new SelectionHighlight(() => root);

    highlight.set({ kind: 'wall', id: ID.wallA });
    expect(highlight.count).toBe(2);
    expect(left.material).not.toBe(shared);
    expect(right.material).not.toBe(shared);
    // The shared material is untouched: the other wall must not light up.
    expect(other.material).toBe(shared);
    expect(shared.emissiveIntensity).toBe(1);

    highlight.set(null);
    expect(left.material).toBe(shared);
    expect(right.material).toBe(shared);
    expect(highlight.count).toBe(0);
    expect(highlight.target).toBeNull();
  });

  test('the tint arrives over the fade window rather than popping', () => {
    const target = mesh({ surface: 'furniture', assetId: ID.sofa });
    const highlight = new SelectionHighlight(() => rootWith(target));
    highlight.set({ kind: 'furniture', id: ID.sofa });
    highlight.update(0);
    const first = (target.material as THREE.MeshStandardMaterial).emissiveIntensity;
    highlight.update(HIGHLIGHT_FADE_MS / 2);
    const mid = (target.material as THREE.MeshStandardMaterial).emissiveIntensity;
    highlight.update(HIGHLIGHT_FADE_MS * 2);
    const full = (target.material as THREE.MeshStandardMaterial).emissiveIntensity;
    expect(first).toBeLessThan(mid);
    expect(mid).toBeLessThan(full);
  });

  test('reapply picks the target up again in a rebuilt scene', () => {
    let root = rootWith(mesh({ surface: 'wall', wallId: ID.wallA }));
    const highlight = new SelectionHighlight(() => root);
    highlight.set({ kind: 'wall', id: ID.wallA });
    expect(highlight.count).toBe(1);

    root = rootWith(mesh({ surface: 'wall', wallId: ID.wallA }), mesh({ surface: 'wall', wallId: ID.wallA }));
    highlight.reapply();
    expect(highlight.count).toBe(2);
    expect(highlight.target).toEqual({ kind: 'wall', id: ID.wallA });
  });

  test('a target that the rebuild removed is dropped in silence', () => {
    let root = rootWith(mesh({ surface: 'wall', wallId: ID.wallA }));
    const highlight = new SelectionHighlight(() => root);
    highlight.set({ kind: 'wall', id: ID.wallA });
    root = rootWith(mesh({ surface: 'wall', wallId: ID.wallGone }));
    highlight.reapply();
    expect(highlight.count).toBe(0);
    expect(highlight.target).toBeNull();
  });

  test('a material with no emissive channel is left alone rather than broken', () => {
    const basic = new THREE.MeshBasicMaterial();
    const target = mesh({ surface: 'wall', wallId: ID.wallA }, basic);
    const highlight = new SelectionHighlight(() => rootWith(target));
    highlight.set({ kind: 'wall', id: ID.wallA });
    expect(target.material).toBe(basic);
    expect(highlight.count).toBe(0);
  });
});
