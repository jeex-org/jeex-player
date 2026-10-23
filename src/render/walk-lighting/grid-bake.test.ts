import { describe, expect, test } from 'bun:test';
import { GridBake, type BakeGrid } from './grid-bake.js';
import type { UniformState } from './box-probe-patch.js';

type Call = { grid: string; start: number; count: number; pass: number; visible: string[]; hidden: boolean; state: UniformState };

function setup(options: { probesPerFrame: number; throwOn?: number; only?: string } = { probesPerFrame: 5 }) {
  const calls: Call[] = [];
  let state: UniformState = 'editing';
  const furniture = { visible: true };
  const mirror = { visible: true };
  const all: BakeGrid[] = [];
  const grid = (name: string, probes: number): BakeGrid & { name: string } => {
    const g = {
      name,
      visible: false,
      resolution: { x: probes, y: 1, z: 1 },
      bake(_renderer: unknown, _scene: unknown, o: { start: number; count: number; pass: number }) {
        if (options.throwOn !== undefined && calls.length === options.throwOn) throw new Error('lost');
        calls.push({
          grid: name,
          start: o.start,
          count: o.count,
          pass: o.pass,
          // three makes the baking grid visible itself; the rest is ours.
          visible: all.filter((other) => other.visible || other === g).map((other) => (other as unknown as { name: string }).name),
          hidden: !furniture.visible && !mirror.visible,
          state,
        });
      },
    };
    all.push(g);
    return g;
  };
  const a = grid('a', 7);
  const b = grid('b', 3);
  const exterior = grid('exterior', 0);
  all.pop();
  all.push(exterior);
  const bake = new GridBake({
    renderer: {} as never,
    scene: {} as never,
    grids: [a, b],
    ...(options.only === undefined ? {} : { targets: [a, b].filter((g) => g.name === options.only) }),
    exterior,
    rig: { setState: (next) => (state = next) },
    exclusions: () => [furniture, mirror],
    probesPerFrame: options.probesPerFrame,
    cubemapSize: 8,
  });
  return { bake, calls, a, b, exterior, furniture, mirror, state: () => state };
}

describe('GridBake', () => {
  test('pass 0 of every grid, then pass 1 of every grid, a fixed number of probes per frame', () => {
    const { bake, calls } = setup();
    let frames = 0;
    while (!bake.step()) frames += 1;
    expect(frames + 1).toBe(4);
    expect(calls.map((c) => [c.grid, c.pass, c.start, c.count])).toEqual([
      ['a', 0, 0, 5],
      ['a', 0, 5, 2],
      ['b', 0, 0, 3],
      ['a', 1, 0, 5],
      ['a', 1, 5, 2],
      ['b', 1, 0, 3],
    ]);
    expect(bake.done).toBe(true);
    expect(bake.step()).toBe(true);
  });

  test('pass 0 sees only the baking grid, pass 1 every room grid and the exterior grid', () => {
    const { bake, calls } = setup();
    while (!bake.step());
    expect(calls.filter((c) => c.pass === 0).map((c) => c.visible)).toEqual([['a'], ['a'], ['b']]);
    for (const call of calls.filter((c) => c.pass === 1)) expect(call.visible).toEqual(['a', 'b', 'exterior']);
  });

  test('every call runs in the capture state with the exclusions hidden; between frames all is back', () => {
    const { bake, calls, a, b, exterior, furniture, mirror, state } = setup();
    bake.step();
    expect(calls.every((c) => c.state === 'capture' && c.hidden)).toBe(true);
    expect([state(), furniture.visible, mirror.visible, a.visible, b.visible, exterior.visible]).toEqual([
      'editing',
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  test('restores everything when a call throws, and rethrows', () => {
    const { bake, furniture, a, state } = setup({ probesPerFrame: 20, throwOn: 1 });
    expect(() => bake.step()).toThrow('lost');
    expect([state(), furniture.visible, a.visible]).toEqual(['editing', true, false]);
  });

  test('counts frames and probes for the measurement', () => {
    const { bake } = setup();
    while (!bake.step());
    expect(bake.stats.frames).toBe(4);
    expect(bake.stats.probes).toBe(20);
  });
});

describe('GridBake of some grids', () => {
  test('bakes only the targets, with every room grid visible in pass 1', () => {
    const { bake, calls } = setup({ probesPerFrame: 100, only: 'b' });
    expect(bake.step()).toBe(true);
    expect(calls.map((c) => [c.grid, c.pass, c.visible])).toEqual([
      ['b', 0, ['b']],
      ['b', 1, ['a', 'b', 'exterior']],
    ]);
  });
});
