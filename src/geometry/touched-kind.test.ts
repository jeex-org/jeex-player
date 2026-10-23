/**
 * The touched-entity text and dispatch over the `site` kind: a change of the
 * plan's orientation reads as `site` and reaches its own handler.
 */

import { describe, expect, test } from 'bun:test';
import { TOUCHED_SHELL, TOUCHED_SITE, sameTouched } from '../scene/scene-ops.js';
import { dispatchTouched, touchedText, type TouchedHandlers } from './touched-kind.js';

describe('the site kind', () => {
  test('reads as site, equals itself and nothing else', () => {
    expect(touchedText(TOUCHED_SITE)).toBe('site');
    expect(sameTouched(TOUCHED_SITE, { kind: 'site' })).toBe(true);
    expect(sameTouched(TOUCHED_SITE, TOUCHED_SHELL)).toBe(false);
  });

  test('reaches its own handler', () => {
    const seen: string[] = [];
    const record = (ctx: string[], entity: { kind: string }): void => {
      ctx.push(entity.kind);
    };
    const handlers: TouchedHandlers<string[]> = {
      shell: record,
      facade: record,
      floor: record,
      ceiling: record,
      trim: record,
      walls: record,
      face: record,
      asset: record,
      opening: record,
      camera: record,
      navigation: record,
      autotour: record,
      tourCheckpoints: record,
      site: (ctx) => ctx.push('site handler'),
    };
    dispatchTouched(seen, [TOUCHED_SITE, TOUCHED_SHELL], handlers);
    expect(seen).toEqual(['site handler', 'shell']);
  });
});
