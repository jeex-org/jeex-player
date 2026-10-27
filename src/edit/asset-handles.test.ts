import { describe, expect, test } from 'bun:test';
import {
  BAR_GAP_M,
  BAR_LENGTH_M,
  HANDLE_GRACE_PX,
  RING_LIFT_M,
  RING_MARGIN_M,
  handleAt,
  handleShape,
  type HandleTarget,
} from './asset-handles.js';

/** A top view at 100 px a metre, plan +x to the right and plan +z down the screen. */
const project = (point: { x: number; z: number }) => ({ x: point.x * 100, y: point.z * 100 });
/** Up the screen in that view is plan −z. */
const UP = { x: 0, z: -1 };

const chair: HandleTarget = { surface: 'floor', position: { x: 2, y: 0, z: 3 }, hx: 0.3, hz: 0.4, rotationY: 0, ceiling: 2.7 };
const pendant: HandleTarget = { ...chair, surface: 'ceiling', position: { x: 2, y: 2.4, z: 3 } };
const mirror: HandleTarget = { surface: 'wall', position: { x: 1, y: 1.6, z: 0.05 }, hx: 0.3, hz: 0.02, rotationY: 0, ceiling: 2.7 };

describe('which handle an object gets', () => {
  test('a floor object: a ring round its footprint, on the floor', () => {
    expect(handleShape(chair, 'orbit', UP)).toEqual({ kind: 'yaw', centre: { x: 2, y: RING_LIFT_M, z: 3 }, radius: 0.5 + RING_MARGIN_M });
  });

  test('a ceiling object: the same ring, just under the ceiling', () => {
    const shape = handleShape(pendant, 'plan3d', UP);
    expect(shape?.kind === 'yaw' ? shape.centre.y : null).toBeCloseTo(2.7 - RING_LIFT_M, 9);
  });

  test('a wall object: a bar beside it in the top view, running up the screen; none in orbit', () => {
    const shape = handleShape(mirror, 'plan3d', UP);
    if (shape?.kind !== 'height') throw new Error('expected the height bar');
    // Beside the body along the face (its own x axis), the gap past its half width.
    expect(shape.from.x).toBeCloseTo(1 + 0.3 + BAR_GAP_M, 9);
    expect(shape.to.x).toBeCloseTo(shape.from.x, 9);
    expect(shape.from.z - shape.to.z).toBeCloseTo(BAR_LENGTH_M, 9);
    expect(handleShape(mirror, 'orbit', UP)).toBeNull();
  });
});

describe('what a press grabs', () => {
  const ring = handleShape(chair, 'plan3d', UP);

  test('a press on the ring, or within the grace of it, grabs the yaw handle', () => {
    const radius = (0.5 + RING_MARGIN_M) * 100;
    expect(handleAt(ring, project, { x: 200 + radius, y: 300 })).toBe('yaw');
    expect(handleAt(ring, project, { x: 200, y: 300 - radius - HANDLE_GRACE_PX + 1 })).toBe('yaw');
  });

  test('a press inside the ring, on the body, or past the grace grabs nothing', () => {
    const radius = (0.5 + RING_MARGIN_M) * 100;
    expect(handleAt(ring, project, { x: 200, y: 300 })).toBeNull();
    expect(handleAt(ring, project, { x: 200 + radius + HANDLE_GRACE_PX + 2, y: 300 })).toBeNull();
    expect(handleAt(null, project, { x: 0, y: 0 })).toBeNull();
  });

  test('a press on the bar grabs the height handle', () => {
    const bar = handleShape(mirror, 'plan3d', UP);
    const x = (1 + 0.3 + BAR_GAP_M) * 100;
    expect(handleAt(bar, project, { x, y: 5 })).toBe('height');
    expect(handleAt(bar, project, { x: x + 40, y: 5 })).toBeNull();
  });
});
