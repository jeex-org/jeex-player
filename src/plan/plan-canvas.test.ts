/**
 * `paintPlan` buckets `drawing.primitives` once and paints through one table
 * (`PRIMITIVE_PAINTERS`) in a fixed order; these tests pin that
 * every kind is still drawn exactly once per primitive and in the declared
 * order, using a recording stub instead of a real canvas.
 */

import { describe, expect, test } from 'bun:test';
import { paintPlan } from './plan-canvas.js';
import type { PlanDrawing, PlanTransform } from './plan-drawing.js';

/** One `fill`/`stroke` call, tagged with the paint state at the moment it fired. */
type Call = { method: 'fill' | 'stroke'; fillStyle: string; strokeStyle: string; lineWidth: number };

/** A minimal `CanvasRenderingContext2D` that only records geometry-terminating calls. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 1 };
  const noop = (): void => undefined;
  const ctx = {
    canvas: { width: 800, height: 600 },
    lineJoin: 'round',
    lineCap: 'butt',
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) as unknown as DOMMatrix,
    setTransform: noop,
    save: noop,
    restore: noop,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    arc: noop,
    fill: () => calls.push({ method: 'fill', ...state }),
    stroke: () => calls.push({ method: 'stroke', ...state }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const TRANSFORM: PlanTransform = { scale: 10, ox: 0, oy: 0 };

/** The one room of `DRAWING`. */
const ROOM_ID = '01a12ff3-e150-7620-ab3b-4aaec2b6a5f2';

/** One primitive of every painted kind, plus a `room` primitive to prove the highlight pre-pass does not disturb the order. */
const DRAWING: PlanDrawing = {
  bounds: { min: { x: 0, z: 0 }, max: { x: 10, z: 10 } },
  primitives: [
    {
      kind: 'room',
      id: ROOM_ID,
      polygon: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
      ],
    },
    {
      kind: 'wall',
      polygon: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
      ],
    },
    {
      kind: 'opening',
      quad: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
      ],
      type: 'window',
    },
    {
      kind: 'window',
      quad: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
      ],
    },
    { kind: 'leaf', from: { x: 0, z: 0 }, to: { x: 1, z: 1 } },
    { kind: 'swing', centre: { x: 0, z: 0 }, radius: 1, a0: 0, a1: Math.PI / 2 },
    {
      kind: 'fixture',
      polygon: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
      ],
      category: 'tub',
    },
  ],
};

/** Classifies a recorded call by the (fillStyle | strokeStyle, lineWidth) signature each painter leaves — the six are pairwise distinct in the 'drawing' palette. */
function kindOf(call: Call): string {
  if (call.method === 'fill') return call.fillStyle === '#101010' ? 'wall' : 'opening';
  if (call.strokeStyle === '#3d3d3d') return 'window';
  if (call.lineWidth === 1.1) return 'leaf';
  if (call.lineWidth === 0.8) return 'swing';
  return 'fixture';
}

describe('paintPlan primitive order', () => {
  test('draws each painted kind exactly once, in declared order: wall, opening, window, leaf, swing, fixture', () => {
    const { ctx, calls } = recordingContext();
    paintPlan(ctx, DRAWING, TRANSFORM, 'drawing');
    const order = calls.map((call) => kindOf(call));
    expect(order).toEqual(['wall', 'opening', 'window', 'leaf', 'swing', 'fixture']);
  });

  test('the minimap style skips the detail layer (leaf, swing, fixture) but keeps the order of what it does draw', () => {
    const { ctx, calls } = recordingContext();
    paintPlan(ctx, DRAWING, TRANSFORM, 'minimap');
    const order = calls.map((call) => (call.method === 'fill' ? (call.fillStyle === '#2b302f' ? 'wall' : 'opening') : 'window'));
    expect(order).toEqual(['wall', 'opening', 'window']);
  });

  test('two primitives of the same kind both draw, back to back', () => {
    const { ctx, calls } = recordingContext();
    const twoWalls: PlanDrawing = {
      bounds: DRAWING.bounds,
      primitives: [
        {
          kind: 'wall',
          polygon: [
            { x: 0, z: 0 },
            { x: 1, z: 0 },
            { x: 1, z: 1 },
          ],
        },
        {
          kind: 'wall',
          polygon: [
            { x: 2, z: 0 },
            { x: 3, z: 0 },
            { x: 3, z: 1 },
          ],
        },
        {
          kind: 'window',
          quad: [
            { x: 0, z: 0 },
            { x: 1, z: 0 },
            { x: 1, z: 1 },
          ],
        },
      ],
    };
    paintPlan(ctx, twoWalls, TRANSFORM, 'drawing');
    expect(calls.map((call) => kindOf(call))).toEqual(['wall', 'wall', 'window']);
  });

  test('an empty drawing paints nothing beyond the paper fill', () => {
    const { ctx, calls } = recordingContext();
    paintPlan(ctx, { bounds: DRAWING.bounds, primitives: [] }, TRANSFORM, 'drawing');
    expect(calls).toEqual([]);
  });
});
