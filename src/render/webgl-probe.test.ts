/**
 * The support probe without a browser: one WebGL 2 request, on the first
 * viewer's own canvas, with the renderer's attributes, kept and memoised.
 */

import { describe, expect, test } from 'bun:test';
import { RENDERER_CONTEXT_ATTRIBUTES, hasWebGL } from './webgl-probe.js';

describe('hasWebGL', () => {
  test('takes the context on the viewer canvas with the renderer attributes, keeps it, and probes once per process', () => {
    const original = (globalThis as { document?: unknown }).document;
    // A document must exist for the probe to run at all; it is never asked for an element.
    (globalThis as { document?: unknown }).document = {};
    const asked: Array<{ canvas: string; id: string; attributes: unknown }> = [];
    let lost = 0;
    const canvas = (name: string): HTMLCanvasElement =>
      ({
        getContext: (id: string, attributes: unknown) => {
          asked.push({ canvas: name, id, attributes });
          return { getExtension: () => ({ loseContext: () => (lost += 1) }) };
        },
      }) as unknown as HTMLCanvasElement;
    try {
      expect(hasWebGL(canvas('first'))).toBe(true);
      expect(hasWebGL(canvas('second'))).toBe(true);
      expect(hasWebGL(canvas('third'))).toBe(true);
      // One WebGL 2 request, on the first viewer's own canvas, with exactly the
      // attributes the renderer will ask for, and the context is NOT handed
      // back: the renderer takes it over instead of making a second one.
      expect(asked).toEqual([{ canvas: 'first', id: 'webgl2', attributes: RENDERER_CONTEXT_ATTRIBUTES }]);
      expect(lost).toBe(0);
    } finally {
      (globalThis as { document?: unknown }).document = original;
    }
  });
});
