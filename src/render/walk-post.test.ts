/**
 * The walk chain's tuning: the values the spec names, frozen. The chain itself
 * needs a WebGL context and is proved in `tests/component/walk-post.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { WALK_POST_TUNING } from './walk-post.js';

describe('WALK_POST_TUNING', () => {
  test('GTAO at 0.3 m world radius on a half-resolution buffer, half-float targets without multisampling', () => {
    expect(WALK_POST_TUNING).toEqual({ aoRadiusM: 0.3, aoResolutionScale: 0.5, colourType: THREE.HalfFloatType, samples: 0 });
  });

  test('is frozen', () => {
    expect(Object.isFrozen(WALK_POST_TUNING)).toBe(true);
  });
});
