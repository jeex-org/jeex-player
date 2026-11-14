import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { POSE_TOLERANCE, RenderDemand, STEADY_AFTER_IDLE_TICKS } from './render-demand.js';

/** The modes that draw on demand. */
const ON_DEMAND = ['walk', 'tour', 'orbit', 'plan3d'];

function camera(): THREE.PerspectiveCamera {
  const live = new THREE.PerspectiveCamera(60, 1.5, 0.05, 100);
  live.position.set(1, 1.6, 2);
  return live;
}

/** A demand that has displayed `live` in `mode` (its first picture and, once at rest, the steady one), clean afterwards. */
function displayed(live: THREE.Camera, mode = 'walk'): RenderDemand {
  const demand = new RenderDemand();
  const drawn: boolean[] = [];
  for (let tick = 0; tick <= STEADY_AFTER_IDLE_TICKS; tick += 1) {
    const draws = demand.shouldDraw(live, mode);
    drawn.push(draws);
    if (draws) demand.commit(live);
  }
  // Outside the on-demand modes every tick draws.
  if (ON_DEMAND.includes(mode)) expect(drawn).toEqual([true, false, false, true]);
  return demand;
}

describe('RenderDemand', () => {
  test('the first tick draws: nothing has been displayed yet', () => {
    expect(new RenderDemand().shouldDraw(camera(), 'walk')).toBe(true);
  });

  test('a still camera with nothing pending does not draw in walk, tour, orbit and plan3d', () => {
    const live = camera();
    for (const mode of ON_DEMAND) {
      const demand = displayed(live, mode);
      for (let tick = 0; tick < 60; tick += 1) expect(demand.shouldDraw(live, mode)).toBe(false);
    }
  });

  test('the flat plan and an unknown mode draw on every tick (the flat plan is held to its heartbeat by the runtime)', () => {
    const live = camera();
    for (const mode of ['plan2d', undefined]) {
      const demand = displayed(live, mode);
      expect(demand.shouldDraw(live, mode)).toBe(true);
      demand.commit(live);
      expect(demand.shouldDraw(live, mode)).toBe(true);
    }
  });

  describe.each(ON_DEMAND)('in %s', (mode) => {
    test('invalidate asks for one draw, and demand accumulates until a commit', () => {
      const live = camera();
      const demand = displayed(live, mode);
      demand.invalidate();
      expect(demand.shouldDraw(live, mode)).toBe(true);
      // No commit (the draw threw): the demand stays.
      expect(demand.shouldDraw(live, mode)).toBe(true);
      demand.commit(live);
      // Nothing until the view has rested, then the steady draw of the same inputs, then nothing.
      for (let tick = 1; tick < STEADY_AFTER_IDLE_TICKS; tick += 1) expect(demand.shouldDraw(live, mode)).toBe(false);
      expect(demand.shouldDraw(live, mode)).toBe(true);
      demand.commit(live);
      expect(demand.shouldDraw(live, mode)).toBe(false);
    });

    test('a move draws, and the matrix is read after updating it', () => {
      const live = camera();
      const demand = displayed(live, mode);
      live.position.x += 0.01;
      expect(demand.shouldDraw(live, mode)).toBe(true);
    });

    test('drift below the tolerance per tick draws once it adds up against the last displayed picture', () => {
      const live = camera();
      const demand = displayed(live, mode);
      const step = POSE_TOLERANCE * 0.3;
      const drawnAt: number[] = [];
      for (let tick = 1; tick <= 12; tick += 1) {
        live.position.x += step;
        if (demand.shouldDraw(live, mode)) {
          drawnAt.push(tick);
          demand.commit(live);
        }
      }
      // 0.3 of the tolerance per tick: the fourth step since the last picture crosses it.
      expect(drawnAt).toEqual([4, 8, 12]);
    });

    test('a change of camera object, projection or layers at the same pose draws', () => {
      const live = camera();
      const twin = live.clone();
      expect(displayed(live, mode).shouldDraw(twin, mode)).toBe(true);

      const zoomed = displayed(live, mode);
      live.fov = 50;
      live.updateProjectionMatrix();
      expect(zoomed.shouldDraw(live, mode)).toBe(true);

      const layered = camera();
      const demand = displayed(layered, mode);
      layered.layers.enable(5);
      expect(demand.shouldDraw(layered, mode)).toBe(true);
    });
  });

  /** Ticks `demand` `count` times with `live` in `mode`, committing every draw; `change(tick)` runs before each tick. */
  function run(demand: RenderDemand, live: THREE.Camera, count: number, change: (tick: number) => void = () => undefined, mode = 'orbit') {
    const drawn: boolean[] = [];
    for (let tick = 0; tick < count; tick += 1) {
      change(tick);
      const draws = demand.shouldDraw(live, mode);
      drawn.push(draws);
      if (draws) demand.commit(live);
    }
    return { drawn, draws: drawn.filter(Boolean).length };
  }

  // The first picture of a changed scene is not always the steady one: on ANGLE's OpenGL backend
  // on NVIDIA its antialiased edges sometimes resolve differently from a later draw of identical
  // inputs, and a resting view would keep that picture until the next change. So the picture the
  // view rests on is drawn once more, after three ticks with no change.
  test('a single change draws, then once more when the view has rested three ticks, then nothing', () => {
    const live = camera();
    const demand = displayed(live, 'orbit');
    demand.invalidate();
    const { drawn } = run(demand, live, 30);
    expect(drawn.slice(0, 5)).toEqual([true, false, false, true, false]);
    expect(drawn.filter(Boolean).length).toBe(2);
  });

  test('a sparse drag (a change every third tick) draws as its changes do, plus one steady draw at its end', () => {
    const live = camera();
    const demand = displayed(live, 'orbit');
    const drag = run(demand, live, 30, (tick) => {
      if (tick % 3 === 0) demand.invalidate();
    });
    expect(drag.draws).toBe(10);
    expect(run(demand, live, 40).draws).toBe(1);
  });

  test('a change on every tick draws every tick, and its steady draw comes only after it stops', () => {
    const live = camera();
    const demand = displayed(live, 'orbit');
    expect(run(demand, live, 20, () => demand.invalidate()).draws).toBe(20);
    expect(run(demand, live, 40).draws).toBe(1);
  });

  test('a repeat draws the unchanged inputs once more: after a change it is the steady draw, alone it owes nothing', () => {
    const live = camera();
    const demand = displayed(live, 'orbit');
    demand.invalidate();
    const afterChange = run(demand, live, 10, (tick) => {
      if (tick === 1) demand.repeat();
    });
    expect(afterChange.drawn.slice(0, 3)).toEqual([true, true, false]);
    expect(afterChange.draws).toBe(2);
    demand.repeat();
    expect(run(demand, live, 10).draws).toBe(1);
  });

  test('a draw with another camera object is followed by one steady draw once the view rests', () => {
    // The first picture after the render camera changes is not the steady one (measured: the
    // top view's first frame differed from a later, identical-input frame in 7 runs of 10).
    const live = camera();
    const top = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    const demand = displayed(live, 'orbit');
    const { drawn } = run(demand, top, 10, () => undefined, 'plan3d');
    expect(drawn).toEqual([true, false, false, true, false, false, false, false, false, false]);
  });

  test('a layer or projection change at the same pose is followed by one steady draw once the view rests', () => {
    const layered = camera();
    const byLayers = displayed(layered, 'orbit');
    layered.layers.enable(5);
    expect(run(byLayers, layered, 10).drawn).toEqual([true, false, false, true, false, false, false, false, false, false]);

    const zoomed = camera();
    const byProjection = displayed(zoomed, 'orbit');
    zoomed.fov = 50;
    zoomed.updateProjectionMatrix();
    expect(run(byProjection, zoomed, 10).drawn).toEqual([true, false, false, true, false, false, false, false, false, false]);
  });

  test('a camera move before the steady draw replaces the debt: its draw, then nothing', () => {
    const live = camera();
    const demand = displayed(live, 'orbit');
    demand.invalidate();
    const { drawn } = run(demand, live, 30, (tick) => {
      if (tick === 1) live.position.x += 0.01;
    });
    expect(drawn.slice(0, 2)).toEqual([true, true]);
    expect(drawn.filter(Boolean).length).toBe(2);
  });

  test('a change whose draw failed, then a commit in a mode that always draws, owes only the switch back', () => {
    const live = camera();
    const demand = displayed(live, 'plan2d');
    // A tick in walk asks to draw a change; the draw throws, nothing is committed.
    demand.invalidate();
    expect(demand.shouldDraw(live, 'walk')).toBe(true);
    // The flat plan draws and commits: the failed answer is not its debt.
    expect(demand.shouldDraw(live, 'plan2d')).toBe(true);
    demand.commit(live);
    // Back in walk: the switch draws and owes its own steady draw, nothing more.
    const { drawn } = run(demand, live, 10, () => undefined, 'walk');
    expect(drawn.slice(0, 5)).toEqual([true, false, false, true, false]);
    expect(drawn.filter(Boolean).length).toBe(2);
  });

  test('a mode switch at the same pose draws, between any two modes', () => {
    const live = camera();
    expect(displayed(live, 'walk').shouldDraw(live, 'tour')).toBe(true);
    expect(displayed(live, 'orbit').shouldDraw(live, 'plan3d')).toBe(true);
    expect(displayed(live, 'plan3d').shouldDraw(live, 'orbit')).toBe(true);
    expect(displayed(live, 'plan2d').shouldDraw(live, 'orbit')).toBe(true);
  });

  test('counts ticks and display draws', () => {
    const live = camera();
    const demand = displayed(live);
    demand.shouldDraw(live, 'walk');
    demand.shouldDraw(live, 'walk');
    expect(demand.counters()).toEqual({ ticks: STEADY_AFTER_IDLE_TICKS + 3, draws: 2, insetDraws: 0 });
  });

  test('counts inset draws apart from display draws', () => {
    const live = camera();
    const demand = displayed(live, 'orbit');
    demand.insetDrawn();
    expect(demand.counters()).toEqual({ ticks: STEADY_AFTER_IDLE_TICKS + 1, draws: 2, insetDraws: 1 });
  });
});

describe('RenderDemand rest frames (a resting walk or tour converges)', () => {
  const N = 6;
  /** The idle ticks before rest frame 0, which comes where the steady draw would. */
  const WAIT: null[] = Array.from({ length: STEADY_AFTER_IDLE_TICKS - 1 }, () => null);

  /**
   * Ticks `demand` `count` times with `live` in `mode` and `restFrames` asked for, committing every
   * draw; answers each tick's draw as `null` (no draw), `'change'` (a draw answering a change, not
   * a rest frame) or the rest frame's index.
   */
  function rest(
    demand: RenderDemand,
    live: THREE.Camera,
    count: number,
    mode: string | undefined = 'walk',
    restFrames = N,
    change: (tick: number) => void = () => undefined,
  ): Array<number | 'change' | null> {
    const drawn: Array<number | 'change' | null> = [];
    for (let tick = 0; tick < count; tick += 1) {
      change(tick);
      if (!demand.shouldDraw(live, mode, restFrames)) {
        drawn.push(null);
        continue;
      }
      drawn.push(demand.restFrame() ?? 'change');
      demand.commit(live);
    }
    return drawn;
  }

  /** A demand that drew its first picture of `live` in `mode` and nothing since. */
  function first(live: THREE.Camera, mode: string | undefined = 'walk'): RenderDemand {
    const demand = new RenderDemand();
    expect(demand.shouldDraw(live, mode, N)).toBe(true);
    expect(demand.restFrame()).toBeNull();
    demand.commit(live);
    return demand;
  }

  test.each(['walk', 'tour'])('in %s a resting view draws N rest frames on consecutive ticks, numbered from 0, then rests', (mode) => {
    const live = camera();
    expect(rest(first(live, mode), live, N + 10, mode)).toEqual([...WAIT, 0, 1, 2, 3, 4, 5, ...Array.from({ length: 8 }, () => null)]);
  });

  test.each(['orbit', 'plan3d'])('in %s a resting view draws today`s steady draw and nothing more', (mode) => {
    const live = camera();
    expect(rest(first(live, mode), live, 10, mode)).toEqual([null, null, 'change', null, null, null, null, null, null, null]);
  });

  test('the flat plan draws on every tick and none of its draws is a rest frame', () => {
    const live = camera();
    expect(rest(first(live, 'plan2d'), live, 5, 'plan2d')).toEqual(['change', 'change', 'change', 'change', 'change']);
  });

  test('a walk drag whose camera moves every third tick draws only its changes; the burst follows once the view has rested', () => {
    const live = camera();
    const demand = first(live);
    const drag = rest(demand, live, 30, 'walk', 32, (tick) => {
      if (tick % 3 === 0) live.position.x += 0.01;
    });
    expect(drag).toEqual(Array.from({ length: 30 }, (_, tick) => (tick % 3 === 0 ? 'change' : null)));
    // The drag's last two ticks were idle; the third idle tick, where the steady draw would come, starts the burst.
    expect(rest(demand, live, 40, 'walk', 32)).toEqual([
      ...Array.from({ length: 32 }, (_, index) => index),
      ...Array.from({ length: 8 }, () => null),
    ]);
  });

  test('stops at the count it is given: 32 and 8', () => {
    for (const count of [32, 8]) {
      const live = camera();
      const drawn = rest(first(live), live, count + 20, 'walk', count);
      expect(drawn.filter((draw) => typeof draw === 'number')).toEqual(Array.from({ length: count }, (_, index) => index));
      expect(drawn.slice(WAIT.length + count)).toEqual(Array.from({ length: 20 - WAIT.length }, () => null));
    }
  });

  test('asked for no rest frames, a walk draws as it did without them: its changes and their steady draws, none a rest frame', () => {
    const live = camera();
    const demand = new RenderDemand();
    const drawn = rest(demand, live, 50, 'walk', 0, (tick) => {
      if (tick === 5 || tick === 6 || tick === 30) demand.invalidate();
      if (tick === 12) live.position.x += 0.01;
      if (tick === 20) demand.repeat();
    });
    // The first picture and its steady draw; two changes and their one steady draw; a move, which
    // owes nothing; a repeat alone, which owes nothing; a change and its steady draw.
    const draws = [0, 3, 5, 6, 9, 12, 20, 30, 33];
    expect(drawn).toEqual(Array.from({ length: 50 }, (_, tick) => (draws.includes(tick) ? 'change' : null)));
    expect(demand.counters()).toEqual({ ticks: 50, draws: draws.length, insetDraws: 0 });
  });

  describe('every change resets: its draw is not a rest frame, and the next rest starts again at 0', () => {
    const causes: Array<[string, (demand: RenderDemand, live: THREE.PerspectiveCamera) => string | undefined]> = [
      [
        'invalidate (an edit, a texture, a light bake, a door, a selection, a resize, a context restore)',
        (demand) => (demand.invalidate(), 'walk'),
      ],
      ['a camera move beyond the tolerance', (_demand, live) => ((live.position.x += POSE_TOLERANCE * 2), 'walk')],
      ['a settle-window repeat', (demand) => (demand.repeat(), 'walk')],
      ['a mode change', () => 'tour'],
      [
        'another projection',
        (_demand, live) => {
          live.fov += 1;
          live.updateProjectionMatrix();
          return 'walk';
        },
      ],
    ];
    test.each(causes)('%s', (_name, cause) => {
      const live = camera();
      const demand = first(live);
      expect(rest(demand, live, WAIT.length + 3)).toEqual([...WAIT, 0, 1, 2]);
      const mode = cause(demand, live);
      expect(rest(demand, live, N + 5, mode)).toEqual(['change', ...WAIT, 0, 1, 2, 3, 4, 5, null, null]);
    });

    test('a camera drift below the tolerance does not reset the rest frames', () => {
      const live = camera();
      const demand = first(live);
      expect(rest(demand, live, N + 4, 'walk', N, () => (live.position.x += POSE_TOLERANCE * 0.3))).toEqual([
        ...WAIT,
        0,
        1,
        2,
        3,
        4,
        5,
        null,
        null,
      ]);
    });

    test('a settle window that holds draws repeats, not rest frames; the rest frames follow when it closes', () => {
      const live = camera();
      const demand = first(live);
      expect(rest(demand, live, 8, 'walk', N, (tick) => tick < 3 && demand.repeat())).toEqual([
        'change',
        'change',
        'change',
        ...WAIT,
        0,
        1,
        2,
      ]);
    });
  });

  test('a rest frame pays the steady draw a change owes: no extra draw after the rest frames', () => {
    const live = camera();
    const demand = first(live);
    rest(demand, live, N);
    demand.invalidate();
    const drawn = rest(demand, live, N + 10);
    expect(drawn.filter((draw) => draw !== null)).toEqual(['change', 0, 1, 2, 3, 4, 5]);
  });

  test('rest frames are counted draws that end at N', () => {
    const live = camera();
    const demand = first(live);
    rest(demand, live, N + 20);
    expect(demand.counters()).toEqual({ ticks: N + 21, draws: N + 1, insetDraws: 0 });
  });

  test('a failed rest frame is drawn again with the same index', () => {
    const live = camera();
    const demand = first(live);
    expect(rest(demand, live, WAIT.length)).toEqual(WAIT);
    expect(demand.shouldDraw(live, 'walk', N)).toBe(true);
    expect(demand.restFrame()).toBe(0);
    // The draw threw: nothing committed.
    expect(demand.shouldDraw(live, 'walk', N)).toBe(true);
    expect(demand.restFrame()).toBe(0);
  });
});
