/**
 * Door state is VIEW state: these tests pin the state machine and its clock,
 * with no scene and no DOM in sight.
 */

import { describe, expect, test } from 'bun:test';
import {
  DOOR_ANIMATION_MS,
  DOOR_AUTO_CLOSE_M,
  DOOR_AUTO_OPEN_M,
  DOOR_PASSABLE_T,
  DoorStates,
  doorAutomation,
  doorsToAutoOpen,
} from './door-state.js';

/** Opening ids, fixed UUID v7 literals in ascending order (the closed-id lists below are sorted). */
const DOOR = {
  one: '01a13011-777c-73ef-afef-876efa95f6d1',
  two: '01a13011-777d-7123-9ec2-9446327ce055',
  a: '01a13011-777e-720a-9f85-9fcfb9f9c483',
  b: '01a13011-777f-76b3-9770-622642e00aae',
  c: '01a13011-7780-7219-a01a-248cf49d68c6',
  d: '01a13011-7781-7047-8586-ff9c03c7e15c',
} as const;

function states(...ids: string[]): DoorStates {
  return new DoorStates(ids.length > 0 ? ids : [DOOR.one, DOOR.two]);
}

describe('initial state', () => {
  test('every known door starts open', () => {
    const doors = states();
    expect(doors.get(DOOR.one)).toEqual({ id: DOOR.one, phase: 'open', t: 1, rest: 'open', auto: false, armed: true });
    expect(doors.get(DOOR.two)!.t).toBe(1);
    expect(doors.closedIds().size).toBe(0);
    expect(doors.list().map((door) => door.id)).toEqual([DOOR.one, DOOR.two]);
  });

  test('an unknown id is unknown, never invented', () => {
    const doors = states();
    expect(doors.get('nope')).toBeUndefined();
    expect(doors.toggle('nope', 0)).toBeNull();
    doors.close('nope', 0);
    expect(doors.closedIds().has('nope')).toBe(false);
  });

  test('a record handed out is a copy', () => {
    const doors = states();
    const record = doors.get(DOOR.one)!;
    record.t = 0;
    expect(doors.get(DOOR.one)!.t).toBe(1);
  });
});

describe('toggle', () => {
  test('open -> closing -> closed after the animation', () => {
    const doors = states();
    expect(doors.toggle(DOOR.one, 1000)).toBe('closing');
    expect(doors.get(DOOR.one)!.phase).toBe('closing');
    expect(doors.closedIds().has(DOOR.one)).toBe(true);

    expect(doors.update(1000 + DOOR_ANIMATION_MS / 2)).toEqual([DOOR.one]);
    const midway = doors.get(DOOR.one)!;
    expect(midway.phase).toBe('closing');
    expect(midway.t).toBeCloseTo(0.5, 6);

    expect(doors.update(1000 + DOOR_ANIMATION_MS)).toEqual([DOOR.one]);
    expect(doors.get(DOOR.one)).toMatchObject({ id: DOOR.one, phase: 'closed', t: 0, rest: 'closed' });
    // A settled door reports nothing on later frames.
    expect(doors.update(9000)).toEqual([]);
  });

  test('closed -> opening -> open', () => {
    const doors = states();
    doors.toggle(DOOR.one, 0);
    doors.update(DOOR_ANIMATION_MS);
    expect(doors.toggle(DOOR.one, DOOR_ANIMATION_MS)).toBe('opening');
    expect(doors.closedIds().has(DOOR.one)).toBe(false);
    doors.update(2 * DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.one)).toEqual({ id: DOOR.one, phase: 'open', t: 1, rest: 'open', auto: false, armed: true });
  });

  test('a toggle mid-animation reverses from the current t without a jump', () => {
    const doors = states();
    doors.toggle(DOOR.one, 0);
    doors.update(DOOR_ANIMATION_MS * 0.4);
    const before = doors.get(DOOR.one)!.t;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(1);

    expect(doors.toggle(DOOR.one, DOOR_ANIMATION_MS * 0.4)).toBe('opening');
    // The reversal starts exactly where the closing left the leaf.
    expect(doors.get(DOOR.one)!.t).toBeCloseTo(before, 10);
    doors.update(DOOR_ANIMATION_MS * 0.4 + 1);
    expect(doors.get(DOOR.one)!.t).toBeGreaterThanOrEqual(before);
    // A partial travel takes a proportional time: the leaf keeps its speed.
    doors.update(DOOR_ANIMATION_MS * 0.4 + DOOR_ANIMATION_MS * (1 - before) + 1e-6);
    expect(doors.get(DOOR.one)!.phase).toBe('open');
  });

  test('t stays inside [0, 1] whatever the clock does', () => {
    const doors = states();
    doors.toggle(DOOR.one, 1000);
    doors.update(-5000);
    expect(doors.get(DOOR.one)!.t).toBeLessThanOrEqual(1);
    expect(doors.get(DOOR.one)!.t).toBeGreaterThanOrEqual(0);
    doors.update(1e9);
    expect(doors.get(DOOR.one)!.t).toBe(0);
  });
});

describe('open and close', () => {
  test('open is a no-op on an open or opening door', () => {
    const doors = states();
    doors.open(DOOR.one, 0);
    expect(doors.get(DOOR.one)).toEqual({ id: DOOR.one, phase: 'open', t: 1, rest: 'open', auto: false, armed: true });
    doors.close(DOOR.one, 0);
    doors.update(DOOR_ANIMATION_MS * 0.3);
    doors.open(DOOR.one, DOOR_ANIMATION_MS * 0.3);
    const opening = doors.get(DOOR.one)!;
    doors.open(DOOR.one, DOOR_ANIMATION_MS * 0.4);
    // The second call must not restart the animation from the current t.
    doors.update(DOOR_ANIMATION_MS * 0.4);
    expect(doors.get(DOOR.one)!.t).toBeGreaterThan(opening.t);
  });

  test('close is a no-op on a closed or closing door', () => {
    const doors = states();
    doors.close(DOOR.one, 0);
    const closing = doors.get(DOOR.one)!;
    doors.close(DOOR.one, 100);
    expect(doors.get(DOOR.one)!.t).toBe(closing.t);
    doors.update(DOOR_ANIMATION_MS);
    doors.close(DOOR.one, DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.one)!.phase).toBe('closed');
  });
});

describe('closedIds', () => {
  test('contains closing and closed, not opening or open', () => {
    const doors = new DoorStates([DOOR.a, DOOR.b, DOOR.c, DOOR.d]);
    doors.close(DOOR.a, 0);
    doors.close(DOOR.b, 0);
    doors.update(DOOR_ANIMATION_MS);
    doors.open(DOOR.b, DOOR_ANIMATION_MS);
    expect([...doors.closedIds()].sort()).toEqual([DOOR.a]);

    doors.close(DOOR.c, DOOR_ANIMATION_MS);
    expect([...doors.closedIds()].sort()).toEqual([DOOR.a, DOOR.c]);
    expect(doors.get(DOOR.c)!.phase).toBe('closing');
  });

  test('the set handed out is a copy, so editing it cannot reach the state', () => {
    const doors = states();
    (doors.closedIds() as Set<string>).add(DOOR.one);
    expect(doors.closedIds().has(DOOR.one)).toBe(false);
  });
});

describe('reset', () => {
  test('keeps the state of surviving ids, adds new ones open, drops the gone', () => {
    const doors = new DoorStates([DOOR.a, DOOR.b]);
    doors.close(DOOR.a, 0);
    doors.update(DOOR_ANIMATION_MS);
    doors.reset([DOOR.a, DOOR.c]);
    expect(doors.get(DOOR.a)).toMatchObject({ id: DOOR.a, phase: 'closed', t: 0 });
    expect(doors.get(DOOR.b)).toBeUndefined();
    expect(doors.get(DOOR.c)).toEqual({ id: DOOR.c, phase: 'open', t: 1, rest: 'open', auto: false, armed: true });
    expect([...doors.closedIds()]).toEqual([DOOR.a]);
  });
});

describe('doorsToAutoOpen', () => {
  const doors = [
    { id: 'ahead', center: { x: 0, y: 1, z: -1 } },
    { id: 'behind', center: { x: 0, y: 1, z: 1 } },
    { id: 'far', center: { x: 0, y: 1, z: -4 } },
  ];
  const camera = { x: 0, z: 0 };
  const forward = { x: 0, z: -1 };

  test('only the closed doors in front of the camera and within reach', () => {
    const closed = new Set(['ahead', 'behind', 'far']);
    expect(doorsToAutoOpen(doors, camera, forward, closed)).toEqual(['ahead']);
  });

  test('an open door is left alone', () => {
    expect(doorsToAutoOpen(doors, camera, forward, new Set(['far']))).toEqual([]);
  });

  test('the reach is DOOR_AUTO_OPEN_M around the camera', () => {
    const edge = [{ id: 'edge', center: { x: 0, y: 1, z: -(DOOR_AUTO_OPEN_M + 0.01) } }];
    expect(doorsToAutoOpen(edge, camera, forward, new Set(['edge']))).toEqual([]);
    const inside = [{ id: 'edge', center: { x: 0, y: 1, z: -(DOOR_AUTO_OPEN_M - 0.01) } }];
    expect(doorsToAutoOpen(inside, camera, forward, new Set(['edge']))).toEqual(['edge']);
  });
});

describe('blockingIds', () => {
  test('is physical: a leaf still in the doorway blocks, a leaf mostly out of it does not', () => {
    const doors = new DoorStates(['opening', 'closing']);
    // `opening` starts shut and is a third of the way open; `closing` starts
    // open and has barely begun to swing.
    doors.close('opening', 0);
    doors.update(DOOR_ANIMATION_MS);
    doors.open('opening', DOOR_ANIMATION_MS);
    doors.update(DOOR_ANIMATION_MS * 1.4);
    doors.close('closing', DOOR_ANIMATION_MS * 1.4);
    doors.update(DOOR_ANIMATION_MS * 1.5);

    const swingingOpen = doors.get('opening')!;
    const swingingShut = doors.get('closing')!;
    expect(swingingOpen.phase).toBe('opening');
    expect(swingingOpen.t).toBeLessThan(DOOR_PASSABLE_T);
    expect(swingingShut.phase).toBe('closing');
    expect(swingingShut.t).toBeGreaterThan(DOOR_PASSABLE_T);

    expect([...doors.blockingIds()]).toEqual(['opening']);
    // The pre-automation rule says the opposite of both, which is why the two
    // sets exist side by side.
    expect([...doors.closedIds()]).toEqual(['closing']);
  });

  test('the set handed out is a copy', () => {
    const doors = states();
    (doors.blockingIds() as Set<string>).add(DOOR.one);
    expect(doors.blockingIds().has(DOOR.one)).toBe(false);
  });
});

describe('latchedIds', () => {
  test('only a door shut by hand and not yet armed again', () => {
    const doors = new DoorStates(['byHand', 'byAutomation']);
    doors.close('byHand', 0);
    doors.update(DOOR_ANIMATION_MS);
    expect([...doors.latchedIds()]).toEqual(['byHand']);

    // Walking away arms it again: it is shut, but approaching will open it.
    doors.release('byHand', DOOR_ANIMATION_MS);
    expect([...doors.latchedIds()]).toEqual([]);

    // A door the automation shut behind the walker is armed by construction.
    doors.hold('byAutomation', DOOR_ANIMATION_MS);
    doors.release('byAutomation', DOOR_ANIMATION_MS);
    doors.update(2 * DOOR_ANIMATION_MS);
    expect([...doors.latchedIds()]).toEqual([]);
  });
});

describe('rearm: the escape from a latch that distance cannot give', () => {
  test('a latched door is armed again without the leaf moving at all', () => {
    const doors = new DoorStates([DOOR.one]);
    doors.close(DOOR.one, 0);
    doors.update(DOOR_ANIMATION_MS);
    expect([...doors.latchedIds()]).toEqual([DOOR.one]);

    expect(doors.rearm(DOOR.one)).toBe(true);
    // Armed, and otherwise untouched: still shut, still rest-closed, still not
    // the automation's. Opening it is the next frame's `hold`, if the pose
    // earns one.
    expect(doors.get(DOOR.one)).toMatchObject({ phase: 'closed', t: 0, rest: 'closed', auto: false, armed: true });
    expect([...doors.latchedIds()]).toEqual([]);
    expect([...doors.blockingIds()]).toEqual([DOOR.one]);
    expect([...doors.closedIds()]).toEqual([DOOR.one]);
  });

  test('an already armed door is left as it is, and an unknown one answers false', () => {
    const doors = new DoorStates([DOOR.one]);
    expect(doors.rearm(DOOR.one)).toBe(true);
    expect(doors.get(DOOR.one)).toMatchObject({ phase: 'open', t: 1, rest: 'open', armed: true });
    expect(doors.rearm('no-such-door')).toBe(false);
  });
});

describe('hold and release', () => {
  test('a held door opens, and a release returns it to its rest state', () => {
    const doors = states();
    doors.close(DOOR.one, 0);
    doors.release(DOOR.one, 0);
    doors.update(DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.one)).toMatchObject({ phase: 'closed', rest: 'closed', auto: false, armed: true });

    doors.hold(DOOR.one, DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.one)).toMatchObject({ phase: 'opening', rest: 'closed', auto: true });
    doors.update(2 * DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.one)).toMatchObject({ phase: 'open', t: 1, rest: 'closed', auto: true });

    doors.release(DOOR.one, 2 * DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.one)).toMatchObject({ phase: 'closing', auto: false });
    doors.update(3 * DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.one)).toMatchObject({ phase: 'closed', t: 0, rest: 'closed' });
  });

  test('a rest-OPEN door is never shut by a release', () => {
    const doors = states();
    doors.release(DOOR.one, 0);
    doors.update(DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.one)).toMatchObject({ phase: 'open', t: 1, rest: 'open' });
  });

  test('hold does not touch the rest state, so the door still knows it is shut', () => {
    const doors = states();
    doors.close(DOOR.one, 0);
    doors.release(DOOR.one, 0);
    doors.update(DOOR_ANIMATION_MS);
    doors.hold(DOOR.one, DOOR_ANIMATION_MS);
    doors.update(2 * DOOR_ANIMATION_MS);
    doors.hold(DOOR.one, 2 * DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.one)!.rest).toBe('closed');
    expect(doors.get(DOOR.one)!.phase).toBe('open');
  });
});

describe('doorAutomation', () => {
  const camera = { x: 0, z: 0 };
  const forward = { x: 0, z: -1 };
  /** A door `metres` straight ahead of the camera, and one straight behind. */
  const ahead = (metres: number) => [{ id: DOOR.d, center: { x: 0, y: 1.05, z: -metres } }];
  const behind = (metres: number) => [{ id: DOOR.d, center: { x: 0, y: 1.05, z: metres } }];

  /** One door, shut and armed: what a rest-closed door of the scene looks like. */
  function shut(): DoorStates {
    const doors = new DoorStates([DOOR.d]);
    doors.close(DOOR.d, 0);
    doors.release(DOOR.d, 0);
    doors.update(DOOR_ANIMATION_MS);
    return doors;
  }

  test('a rest-closed door ahead is held, the same door behind is not', () => {
    const doors = shut();
    expect(doorAutomation(ahead(1.5), doors.list(), camera, forward)).toEqual({ hold: [DOOR.d], release: [] });
    expect(doorAutomation(behind(1.5), doors.list(), camera, forward)).toEqual({ hold: [], release: [] });
  });

  test('a door beside the walker still opens: only a door squarely behind is skipped', () => {
    const doors = shut();
    const beside = [{ id: DOOR.d, center: { x: 1.4, y: 1.05, z: 0 } }];
    expect(doorAutomation(beside, doors.list(), camera, forward).hold).toEqual([DOOR.d]);
  });

  test('a rest-open door is left alone at any distance', () => {
    const doors = new DoorStates([DOOR.d]);
    expect(doorAutomation(ahead(1.5), doors.list(), camera, forward)).toEqual({ hold: [], release: [] });
    expect(doorAutomation(ahead(9), doors.list(), camera, forward)).toEqual({ hold: [], release: [] });
  });

  test('hysteresis: an auto-held door in the band is left alone, and released beyond it', () => {
    const doors = shut();
    doors.hold(DOOR.d, DOOR_ANIMATION_MS);
    doors.update(2 * DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.d)!.auto).toBe(true);

    const between = (DOOR_AUTO_OPEN_M + DOOR_AUTO_CLOSE_M) / 2;
    expect(doorAutomation(ahead(between), doors.list(), camera, forward)).toEqual({ hold: [], release: [] });
    expect(doorAutomation(ahead(DOOR_AUTO_CLOSE_M + 0.2), doors.list(), camera, forward)).toEqual({ hold: [], release: [DOOR.d] });
  });

  test('shutting a held door by hand latches it until the walker has left', () => {
    const doors = shut();
    doors.hold(DOOR.d, DOOR_ANIMATION_MS);
    doors.update(2 * DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.d)!.phase).toBe('open');

    // The HUD click: rest closed, off the automation, and not armed.
    doors.toggle(DOOR.d, 2 * DOOR_ANIMATION_MS);
    doors.update(3 * DOOR_ANIMATION_MS);
    expect(doors.get(DOOR.d)).toMatchObject({ phase: 'closed', rest: 'closed', auto: false, armed: false });
    // Standing in the same spot does NOT open it again.
    expect(doorAutomation(ahead(1.5), doors.list(), camera, forward)).toEqual({ hold: [], release: [] });

    // Walking away arms it; coming back opens it.
    const away = doorAutomation(ahead(DOOR_AUTO_CLOSE_M + 0.2), doors.list(), camera, forward);
    expect(away.release).toEqual([DOOR.d]);
    for (const id of away.release) doors.release(id, 3 * DOOR_ANIMATION_MS);
    expect(doorAutomation(ahead(1.5), doors.list(), camera, forward).hold).toEqual([DOOR.d]);
  });

  test('the pitch of the gaze does not shrink the field of view', () => {
    const doors = shut();
    // Looking at the floor two metres ahead: the plan projection of the gaze is
    // short, but the door is still in front.
    const pitched = { x: 0, z: -0.35 };
    expect(doorAutomation(ahead(1.5), doors.list(), camera, pitched).hold).toEqual([DOOR.d]);
  });

  test('a door with no state, and a walker standing in the doorway', () => {
    const doors = shut();
    expect(doorAutomation([{ id: 'other', center: { x: 0, y: 1, z: -1 } }], doors.list(), camera, forward)).toEqual({
      hold: [],
      release: [],
    });
    expect(doorAutomation(ahead(0), doors.list(), camera, forward).hold).toEqual([DOOR.d]);
  });
});
