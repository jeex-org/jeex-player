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
