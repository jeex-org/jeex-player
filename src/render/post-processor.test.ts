/**
 * Which camera modes render through the walk and tour post-processing chain:
 * a function of the mode alone, so a tour that starts in its overview
 * (dollhouse) shell is processed from its first frame.
 */

import { describe, expect, test } from 'bun:test';
import { isPostProcessed } from './post-processor.js';
import type { ViewerMode } from '../scene/types.js';

describe('isPostProcessed', () => {
  test('walk and tour render through the chain', () => {
    expect(isPostProcessed('walk')).toBe(true);
    expect(isPostProcessed('tour')).toBe(true);
  });

  test('the editing modes render straight to the screen', () => {
    const editing: ViewerMode[] = ['plan2d', 'plan3d', 'orbit'];
    expect(editing.map((mode) => isPostProcessed(mode))).toEqual([false, false, false]);
  });

  test('no camera stack yet: direct', () => {
    expect(isPostProcessed(undefined)).toBe(false);
  });

  test('the shell state is not an input: a tour in its dollhouse overview is processed', () => {
    // The tour starts in the dollhouse shell (`CameraDirector.setMode`); the
    // function takes the mode alone, so nothing about the shell can veto it.
    expect(isPostProcessed.length).toBe(1);
    expect(isPostProcessed('tour')).toBe(true);
  });
});
