/**
 * The beauty-pass scope: set for the duration of one draw, per renderer,
 * restored in `finally` (also when the draw throws), nested scopes unwound in
 * order.
 */

import { describe, expect, test } from 'bun:test';
import { scenePassOf, withScenePass } from './scene-pass.js';

const renderer = (): object => ({});

describe('withScenePass', () => {
  test('no scope outside a draw', () => {
    expect(scenePassOf(renderer())).toBeUndefined();
  });

  test('names the target, scene and camera during the draw and clears them after', () => {
    const r = renderer();
    const scope = { target: null, scene: 's', camera: 'c' };
    let seen: unknown;
    const answer = withScenePass(r, scope, () => {
      seen = scenePassOf(r);
      return 42;
    });
    expect(answer).toBe(42);
    expect(seen).toEqual(scope);
    expect(scenePassOf(r)).toBeUndefined();
  });

  test('is per renderer', () => {
    const a = renderer();
    const b = renderer();
    withScenePass(a, { target: null, scene: 's', camera: 'c' }, () => {
      expect(scenePassOf(b)).toBeUndefined();
    });
  });

  test('restores the outer scope after a nested one', () => {
    const r = renderer();
    const outer = { target: null, scene: 's', camera: 'c' };
    const inner = { target: 't', scene: 's', camera: 'capture' };
    withScenePass(r, outer, () => {
      withScenePass(r, inner, () => {
        expect(scenePassOf(r)).toEqual(inner);
      });
      expect(scenePassOf(r)).toEqual(outer);
    });
    expect(scenePassOf(r)).toBeUndefined();
  });

  test('clears the scope when the draw throws', () => {
    const r = renderer();
    expect(() =>
      withScenePass(r, { target: null, scene: 's', camera: 'c' }, () => {
        throw new Error('lost');
      }),
    ).toThrow('lost');
    expect(scenePassOf(r)).toBeUndefined();
  });
});
