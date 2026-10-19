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
