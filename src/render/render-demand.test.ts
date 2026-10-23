import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { POSE_TOLERANCE, RenderDemand } from './render-demand.js';

function camera(): THREE.PerspectiveCamera {
  const live = new THREE.PerspectiveCamera(60, 1.5, 0.05, 100);
  live.position.set(1, 1.6, 2);
  return live;
}

/** A demand that has displayed `live` once in `mode`, clean afterwards. */
function displayed(live: THREE.Camera, mode = 'walk'): RenderDemand {
  const demand = new RenderDemand();
  expect(demand.shouldDraw(live, mode)).toBe(true);
  demand.commit(live);
  return demand;
}

describe('RenderDemand', () => {
  test('the first tick draws: nothing has been displayed yet', () => {
    expect(new RenderDemand().shouldDraw(camera(), 'walk')).toBe(true);
  });

  test('a still camera with nothing pending does not draw in walk and tour', () => {
    const live = camera();
    for (const mode of ['walk', 'tour']) {
      const demand = displayed(live, mode);
      for (let tick = 0; tick < 60; tick += 1) expect(demand.shouldDraw(live, mode)).toBe(false);
    }
  });

  test('editing modes and an unknown mode draw on every tick', () => {
    const live = camera();
    for (const mode of ['plan2d', 'plan3d', 'orbit', undefined]) {
      const demand = displayed(live, mode);
      expect(demand.shouldDraw(live, mode)).toBe(true);
      demand.commit(live);
      expect(demand.shouldDraw(live, mode)).toBe(true);
    }
  });

  test('invalidate asks for one draw, and demand accumulates until a commit', () => {
    const live = camera();
    const demand = displayed(live);
    demand.invalidate();
    expect(demand.shouldDraw(live, 'walk')).toBe(true);
    // No commit (the draw threw): the demand stays.
    expect(demand.shouldDraw(live, 'walk')).toBe(true);
    demand.commit(live);
    expect(demand.shouldDraw(live, 'walk')).toBe(false);
  });

  test('a move draws, and the matrix is read after updating it', () => {
    const live = camera();
    const demand = displayed(live);
    live.position.x += 0.01;
    expect(demand.shouldDraw(live, 'walk')).toBe(true);
  });

  test('drift below the tolerance per tick draws once it adds up against the last displayed picture', () => {
    const live = camera();
    const demand = displayed(live);
    const step = POSE_TOLERANCE * 0.3;
    const drawnAt: number[] = [];
    for (let tick = 1; tick <= 12; tick += 1) {
      live.position.x += step;
      if (demand.shouldDraw(live, 'walk')) {
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
    expect(displayed(live).shouldDraw(twin, 'walk')).toBe(true);

    const zoomed = displayed(live);
    live.fov = 50;
    live.updateProjectionMatrix();
    expect(zoomed.shouldDraw(live, 'walk')).toBe(true);

    const layered = camera();
    const demand = displayed(layered);
    layered.layers.enable(5);
    expect(demand.shouldDraw(layered, 'walk')).toBe(true);
  });

  test('a mode switch at the same pose draws', () => {
    const live = camera();
    expect(displayed(live, 'walk').shouldDraw(live, 'tour')).toBe(true);
  });

  test('counts ticks and display draws', () => {
    const live = camera();
    const demand = displayed(live);
    demand.shouldDraw(live, 'walk');
    demand.shouldDraw(live, 'walk');
    expect(demand.counters()).toEqual({ ticks: 3, draws: 1 });
  });
});
