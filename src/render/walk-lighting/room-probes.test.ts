import { describe, expect, test } from 'bun:test';
import { RoomProbes, type ProbeCapture } from './room-probes.js';
import { atlasLayout, type UniformState } from './box-probe-patch.js';

function setup(height = 512) {
  let state: UniformState = 'editing';
  const mirror = { visible: true };
  const grids = [{ visible: false }, { visible: false }];
  const exterior = { visible: false };
  const captured: { at: number[]; state: UniformState; mirror: boolean; grids: boolean[] }[] = [];
  const copied: { x: number; y: number }[] = [];
  let disposed = 0;
  const capture: ProbeCapture = (position) => {
    captured.push({
      at: [position.x, position.y, position.z],
      state,
      mirror: mirror.visible,
      grids: [...grids, exterior].map((g) => g.visible),
    });
    return { texture: {} as never, width: 384, height, dispose: () => (disposed += 1) };
  };
  const probes = new RoomProbes({
    probes: [
      { roomId: 'a', position: { x: 1, y: 1.5, z: 1 } },
      { roomId: 'b', position: { x: 4, y: 1.5, z: 1 } },
    ],
    layout: atlasLayout(2),
    rig: { setState: (next) => (state = next) },
    mirrors: () => [mirror],
    grids,
    exterior,
    capture,
    copy: (_source, tile) => copied.push(tile),
  });
  return { probes, captured, copied, mirror, grids, exterior, state: () => state, disposed: () => disposed };
}

describe('RoomProbes', () => {
  test('captures one room per frame at its probe point into its atlas tile', () => {
    const { probes, captured, copied, disposed } = setup();
    expect(probes.step()).toBe(false);
    expect(probes.step()).toBe(true);
    expect(captured.map((c) => c.at)).toEqual([
      [1, 1.5, 1],
      [4, 1.5, 1],
    ]);
    expect(copied).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 512 },
    ]);
    expect(disposed()).toBe(2);
  });

  test('captures in the capture state with mirrors hidden and every grid visible, and puts everything back', () => {
    const { probes, captured, mirror, grids, exterior, state } = setup();
    probes.step();
    expect(captured[0]).toMatchObject({ state: 'capture', mirror: false, grids: [true, true, true] });
    expect([state(), mirror.visible, grids[0]!.visible, exterior.visible]).toEqual(['editing', true, false, false]);
  });

  test('re-captures one room on request', () => {
    const { probes, captured } = setup();
    while (!probes.step());
    probes.recapture(['b']);
    expect(probes.step()).toBe(true);
    expect(captured.at(-1)!.at).toEqual([4, 1.5, 1]);
    expect(captured).toHaveLength(3);
  });

  test('fails loudly when the probe layout is not the atlas tile layout', () => {
    const { probes, state } = setup(256);
    expect(() => probes.step()).toThrow(/layout/);
    expect(state()).toBe('editing');
  });
});
