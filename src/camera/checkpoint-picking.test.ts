/**
 * Screen-space picking and the gesture arithmetic of the camera tool: the
 * fixed priority, the grace radius, the click-away distance, the relative yaw
 * sweep and the «no change» tolerance.
 */

import { describe, expect, test } from 'bun:test';
import {
  DESELECT_PX,
  GRACE_PX,
  YAW_SNAP_RAD,
  YawSweep,
  cursorFor,
  pitchFromDrag,
  distanceToLoop,
  distanceToSegment,
  floorAngle,
  nearestActiveHandle,
  pickHandle,
  sameList,
  samePose,
  type ActiveShapes,
  type ScreenPoint,
} from './checkpoint-picking.js';

/** Ids of the tour cameras on screen. */
const CAM = {
  a: '01a12ffa-7375-77ed-8c5b-123880fb2929',
  b: '01a12ffa-7376-7cc6-a338-5e81d7da7bca',
  c: '01a12ffa-7377-774e-8ddf-52e0b2428066',
} as const;

/** A ring of `radius` px around `centre`, 48 points. */
function ring(centre: ScreenPoint, radius: number): ScreenPoint[] {
  return Array.from({ length: 48 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2;
    return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
  });
}

/** An active camera at (400, 300) seen from the side: footprint 60 px below, arrow above, pitch slider to the right, ring around the footprint. */
const SHAPES: ActiveShapes = {
  body: { at: { x: 400, y: 300 }, radius: 14 },
  footprint: { at: { x: 400, y: 360 }, radius: 8 },
  height: [
    { x: 400, y: 266 },
    { x: 400, y: 210 },
  ],
  pitch: [
    { x: 434, y: 272 },
    { x: 434, y: 328 },
  ],
  ring: ring({ x: 400, y: 360 }, 80),
  wedgeTip: { x: 470, y: 360 },
};

describe('the pitch slider drag', () => {
  const LIMIT = (50 / 180) * Math.PI;
  const degrees = (radians: number): number => (radians * 180) / Math.PI;

  test('0.25° per pixel, relative to the grab; a drag UP tilts the view up', () => {
    expect(degrees(pitchFromDrag(0, -40, false, LIMIT))).toBeCloseTo(10, 9);
    expect(degrees(pitchFromDrag((-5 / 180) * Math.PI, 20, false, LIMIT))).toBeCloseTo(-10, 9);
  });

  test('Shift snaps to 5° steps, and the result never leaves ±50°', () => {
    expect(degrees(pitchFromDrag(0, -30, true, LIMIT))).toBeCloseTo(10, 9);
    expect(degrees(pitchFromDrag(0, -4000, false, LIMIT))).toBeCloseTo(50, 9);
    expect(degrees(pitchFromDrag(0, 4000, true, LIMIT))).toBeCloseTo(-50, 9);
  });
});

describe('screen-space distances', () => {
  test('segment distance clamps to the end points', () => {
    expect(distanceToSegment({ x: 0, y: 5 }, { x: -10, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 13, y: 4 }, { x: -10, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  test('a closed loop measures its closing segment too', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(distanceToLoop({ x: -3, y: 5 }, square)).toBe(3);
  });
});

describe('pickHandle', () => {
  const active = { id: CAM.a, shapes: SHAPES };

  test('a press at the body centre MOVES, it never lifts', () => {
    expect(pickHandle({ x: 400, y: 300 }, active, [])).toEqual({ id: CAM.a, kind: 'move' });
    // Just above the body, still inside the body's grace: the body outranks the arrow.
    expect(pickHandle({ x: 400, y: 284 }, active, [])).toEqual({ id: CAM.a, kind: 'move' });
  });

  test('the arrow above the body lifts, the ring and the wedge tip turn', () => {
    expect(pickHandle({ x: 404, y: 230 }, active, [])).toEqual({ id: CAM.a, kind: 'height' });
    expect(pickHandle({ x: 400 + 80, y: 360 - 12 }, active, [])?.kind).toBe('yaw');
    expect(pickHandle({ x: 400, y: 360 + 80 + GRACE_PX - 1 }, active, [])?.kind).toBe('yaw');
  });

  test('the slider beside the body tilts; the body still outranks it inside its own grace, and the slider outranks the ring', () => {
    expect(pickHandle({ x: 436, y: 285 }, active, [])).toEqual({ id: CAM.a, kind: 'pitch' });
    expect(cursorFor('pitch')).toBe('ns-resize');
    // Between the body's rim and the slider: both within grace, the body wins.
    expect(pickHandle({ x: 422, y: 300 }, active, [])?.kind).toBe('move');
    // The slider's foot near the ring's top arc: both within grace, pitch wins over yaw.
    const overRing = { id: CAM.a, shapes: { ...SHAPES, ring: ring({ x: 434, y: 420 }, 80) } };
    expect(pickHandle({ x: 434, y: 335 }, overRing, [])?.kind).toBe('pitch');
    // A mode without the slider (plan3d) never answers pitch.
    expect(pickHandle({ x: 436, y: 285 }, { id: CAM.a, shapes: { ...SHAPES, pitch: null } }, [])?.kind).not.toBe('pitch');
  });

  test('a near miss inside the grace radius is claimed; beyond it the press belongs to the orbit', () => {
    expect(pickHandle({ x: 400 + 14 + GRACE_PX - 1, y: 300 }, active, [])).toEqual({ id: CAM.a, kind: 'move' });
    expect(pickHandle({ x: 200, y: 100 }, active, [])).toBeNull();
  });

  test('priority is fixed: a higher-ranked handle wins over a nearer lower-ranked one', () => {
    // The ring passes 2 px from this point; the footprint's rim is 10 px away. Move wins.
    const crowded: ActiveShapes = { ...SHAPES, ring: ring({ x: 400, y: 360 }, 20) };
    expect(pickHandle({ x: 400 + 18, y: 360 }, { id: CAM.a, shapes: crowded }, [])).toEqual({ id: CAM.a, kind: 'move' });
  });

  test('seen from straight above, the arrow collapses onto the body — the body still wins', () => {
    const topDown: ActiveShapes = {
      ...SHAPES,
      height: [
        { x: 400, y: 300 },
        { x: 400, y: 298 },
      ],
    };
    expect(pickHandle({ x: 401, y: 299 }, { id: CAM.a, shapes: topDown }, [])).toEqual({ id: CAM.a, kind: 'move' });
  });

  test('inactive cameras are selected by body, footprint or badge, the nearest winning', () => {
    const markers = [
      { id: CAM.b, body: { at: { x: 100, y: 100 }, radius: 14 }, footprint: null, badge: { x: 100, y: 70 } },
      { id: CAM.c, body: { at: { x: 130, y: 100 }, radius: 14 }, footprint: null, badge: null },
    ];
    expect(pickHandle({ x: 110, y: 100 }, null, markers)).toEqual({ id: CAM.b, kind: 'move' });
    expect(pickHandle({ x: 124, y: 100 }, null, markers)).toEqual({ id: CAM.c, kind: 'move' });
    expect(pickHandle({ x: 100, y: 62 }, null, markers)).toEqual({ id: CAM.b, kind: 'move' });
  });

  test('the click-away distance is measured against every handle of the active camera', () => {
    expect(nearestActiveHandle({ x: 400, y: 300 }, SHAPES)).toBe(0);
    // Between the grace radius and the deselect radius: not claimed, not a deselect either.
    const between = { x: 400 + 20, y: 240 };
    expect(pickHandle(between, { id: CAM.a, shapes: SHAPES }, [])).toBeNull();
    expect(nearestActiveHandle(between, SHAPES)).toBeLessThanOrEqual(DESELECT_PX);
    expect(nearestActiveHandle({ x: 40, y: 40 }, SHAPES)).toBeGreaterThan(DESELECT_PX);
    expect(nearestActiveHandle({ x: 40, y: 40 }, null)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('YawSweep', () => {
  test('a 90° sweep turns the camera 90° whatever the grab angle', () => {
    for (const start of [0, 1, -2.5, 3]) {
      const sweep = new YawSweep(0.2, start);
      let yaw = 0;
      for (let step = 1; step <= 9; step += 1) yaw = sweep.update(start + (step / 9) * (Math.PI / 2), false);
      expect(yaw).toBeCloseTo(0.2 + Math.PI / 2, 9);
    }
  });

  test('the first move never snaps the camera to face the pointer', () => {
    const sweep = new YawSweep(-0.3, 2.9);
    expect(sweep.update(2.9, false)).toBeCloseTo(-0.3, 12);
  });

  test('a sweep across the ±PI seam keeps turning the same way', () => {
    const sweep = new YawSweep(0, 3);
    sweep.update(3.1, false);
    expect(sweep.update(-3.1, false)).toBeCloseTo(2 * Math.PI - 6.1 + 0, 9);
  });

  test('Shift snaps the result to 15°', () => {
    const sweep = new YawSweep(0, 0);
    const yaw = sweep.update(0.2, true);
    expect(Math.abs(yaw / YAW_SNAP_RAD - Math.round(yaw / YAW_SNAP_RAD))).toBeLessThan(1e-9);
    expect(yaw).toBeCloseTo(YAW_SNAP_RAD, 12);
  });

  test('floorAngle follows the yaw convention: +Z is 0, +X is +90°', () => {
    expect(floorAngle({ x: 1, z: 1 }, { x: 1, z: 3 })).toBeCloseTo(0, 12);
    expect(floorAngle({ x: 1, z: 1 }, { x: 3, z: 1 })).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('samePose / sameList', () => {
  const pose = { id: 'a', position: { x: 1, y: 1.6, z: 2 }, yaw: 0.5, pitch: -0.1 };

  test('within 1 mm and 0.1° is the same shot', () => {
    expect(samePose(pose, { ...pose, position: { x: 1.0009, y: 1.6, z: 2 }, yaw: 0.5 + 0.001 })).toBe(true);
    expect(samePose(pose, { ...pose, position: { x: 1.002, y: 1.6, z: 2 } })).toBe(false);
    expect(samePose(pose, { ...pose, pitch: -0.1 + 0.002 })).toBe(false);
    expect(samePose(pose, { ...pose, name: 'Hall' })).toBe(false);
  });

  test('a yaw across the seam is compared the short way round', () => {
    expect(samePose({ ...pose, yaw: Math.PI - 0.0005 }, { ...pose, yaw: -Math.PI + 0.0005 })).toBe(true);
  });

  test('order and length matter', () => {
    const other = { ...pose, id: 'b' };
    expect(sameList([pose, other], [pose, other])).toBe(true);
    expect(sameList([pose, other], [other, pose])).toBe(false);
    expect(sameList([pose], [pose, other])).toBe(false);
  });
});
