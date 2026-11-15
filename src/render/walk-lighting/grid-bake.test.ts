import { describe, expect, test } from 'bun:test';
import { GridBake, type BakeGrid } from './grid-bake.js';
import type { UniformState } from './box-probe-patch.js';

type Call = {
  grid: string;
  start: number;
  count: number;
  pass: number;
  lit: boolean;
  hidden: boolean;
  masks: number[];
  state: UniformState;
};

function setup(options: { probesPerFrame: number; throwOn?: number; only?: string } = { probesPerFrame: 5 }) {
  const calls: Call[] = [];
  const baked: string[] = [];
  let state: UniformState = 'editing';
  const furniture = { visible: true };
  const mirror = { visible: true };
  const lit = { visible: false };
  // Furniture renderables: a body, a transmissive body, a shade with a non-default mask.
  const renderables = [{ layers: { mask: 1 } }, { layers: { mask: 1 } }, { layers: { mask: 5 } }];
  const grid = (name: string, probes: number): BakeGrid & { name: string } => ({
    name,
    resolution: { x: probes, y: 1, z: 1 },
    bake(_renderer: unknown, _scene: unknown, o: { start: number; count: number; pass: number }) {
      if (options.throwOn !== undefined && calls.length === options.throwOn) throw new Error('lost');
      calls.push({
        grid: name,
        start: o.start,
        count: o.count,
        pass: o.pass,
        lit: lit.visible,
        hidden: !furniture.visible && !mirror.visible,
        masks: renderables.map((r) => r.layers.mask),
        state,
      });
    },
  });
  const a = grid('a', 7);
  const b = grid('b', 3);
  const bake = new GridBake({
    renderer: {} as never,
    scene: {} as never,
    grids: [a, b],
    ...(options.only === undefined ? {} : { targets: [a, b].filter((g) => g.name === options.only) }),
    lit,
    baked: (done) => baked.push(`${(done as unknown as { name: string }).name}:${calls.at(-1)!.pass}`),
    rig: { setState: (next) => (state = next) },
    exclusions: () => [furniture, mirror],
    layerExclusions: () => renderables,
    probesPerFrame: options.probesPerFrame,
    cubemapSize: 8,
  });
  return { bake, calls, baked, a, b, lit, furniture, mirror, renderables, state: () => state };
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

  test('pass 0 bakes with the grids off, pass 1 with them on', () => {
    const { bake, calls } = setup();
    while (!bake.step());
    expect(calls.filter((c) => c.pass === 0).map((c) => c.lit)).toEqual([false, false, false]);
    for (const call of calls.filter((c) => c.pass === 1)) expect(call.lit).toBe(true);
  });

  test('hands each grid to the packed atlas when a pass has finished it', () => {
    const { bake, baked } = setup();
    while (!bake.step());
    expect(baked).toEqual(['a:0', 'b:0', 'a:1', 'b:1']);
  });

  test('every call runs in the capture state with the exclusions hidden; between frames all is back', () => {
    const { bake, calls, lit, furniture, mirror, state } = setup({ probesPerFrame: 12 });
    bake.step();
    expect(calls.some((c) => c.lit)).toBe(true);
    expect(calls.every((c) => c.state === 'capture' && c.hidden)).toBe(true);
    expect([state(), furniture.visible, mirror.visible, lit.visible]).toEqual(['editing', true, true, false]);
  });

  test('every call sees the furniture renderables on no layer; between frames each has its own mask back', () => {
    const { bake, calls, renderables } = setup();
    bake.step();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.masks).toEqual([0, 0, 0]);
    expect(renderables.map((r) => r.layers.mask)).toEqual([1, 1, 5]);
  });

  test('puts every layer mask back when a call throws', () => {
    const { bake, renderables } = setup({ probesPerFrame: 20, throwOn: 1 });
    expect(() => bake.step()).toThrow('lost');
    expect(renderables.map((r) => r.layers.mask)).toEqual([1, 1, 5]);
  });

  test('restores everything when a call throws, and rethrows', () => {
    const { bake, furniture, lit, state } = setup({ probesPerFrame: 20, throwOn: 3 });
    expect(() => bake.step()).toThrow('lost');
    expect([state(), furniture.visible, lit.visible]).toEqual(['editing', true, false]);
  });

  test('counts frames and probes for the measurement', () => {
    const { bake } = setup();
    while (!bake.step());
    expect(bake.stats.frames).toBe(4);
    expect(bake.stats.probes).toBe(20);
  });
});

describe('GridBake of no grids', () => {
  test('is done at once and bakes nothing', () => {
    const { bake, calls } = setup({ probesPerFrame: 5, only: 'none' });
    expect(bake.done).toBe(true);
    expect(bake.step()).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('GridBake of some grids', () => {
  test('bakes only the targets, with the grids on in pass 1', () => {
    const { bake, calls, baked } = setup({ probesPerFrame: 100, only: 'b' });
    expect(bake.step()).toBe(true);
    expect(calls.map((c) => [c.grid, c.pass, c.lit])).toEqual([
      ['b', 0, false],
      ['b', 1, true],
    ]);
    expect(baked).toEqual(['b:0', 'b:1']);
  });
});
