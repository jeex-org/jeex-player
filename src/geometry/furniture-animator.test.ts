import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { FurnitureAnimator } from './furniture-animator.js';

describe('FurnitureAnimator.moved', () => {
  test('a group stood anew during a show ripple ends the ripple at its NEW pose', () => {
    const container = new THREE.Group();
    const group = new THREE.Group();
    container.add(group);
    const animator = new FurnitureAnimator();
    animator.attach(container);
    animator.setVisible(true);
    expect(
      animator.moved(group, () => {
        group.position.y = 2.4;
        group.scale.setScalar(1.5);
        return true;
      }),
    ).toBe(true);
    // Long after every staggered item has finished.
    animator.update(performance.now() + 10_000);
    expect(group.position.y).toBeCloseTo(2.4, 6);
    expect(group.scale.x).toBeCloseTo(1.5, 6);
  });
});

describe('FurnitureAnimator.takeMoved', () => {
  test('names every group a ripple touched, its final frame included, and nothing once it is over', () => {
    const container = new THREE.Group();
    const a = new THREE.Group();
    const b = new THREE.Group();
    container.add(a, b);
    const animator = new FurnitureAnimator();
    animator.attach(container);
    expect(animator.takeMoved()).toEqual([]);
    animator.setVisible(false);
    animator.update(performance.now() + 10_000);
    expect(new Set(animator.takeMoved())).toEqual(new Set([a, b]));
    expect(container.visible).toBe(false);
    animator.update(performance.now() + 20_000);
    expect(animator.takeMoved()).toEqual([]);
  });

  test('a swap names both groups until it settles', () => {
    const container = new THREE.Group();
    const old = new THREE.Group();
    const fresh = new THREE.Group();
    container.add(old, fresh);
    const animator = new FurnitureAnimator();
    animator.attach(container);
    animator.swap(old, fresh, 1, () => undefined, 0);
    animator.update(50);
    expect(new Set(animator.takeMoved())).toEqual(new Set([old, fresh]));
    animator.update(10_000);
    expect(new Set(animator.takeMoved())).toEqual(new Set([old, fresh]));
    animator.update(20_000);
    expect(animator.takeMoved()).toEqual([]);
  });
});
