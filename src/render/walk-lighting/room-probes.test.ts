import { describe, expect, test } from 'bun:test';
import { RoomProbes, type ProbeCapture } from './room-probes.js';
import type { UniformState } from './box-probe-patch.js';

function setup(size = 256) {
  let state: UniformState = 'editing';
  const mirror = { visible: true };
  const grids = { visible: false };
  const captured: { at: number[]; state: UniformState; mirror: boolean; grids: boolean }[] = [];
  const copied: number[] = [];
  let disposed = 0;
  const capture: ProbeCapture = (position) => {
    captured.push({
      at: [position.x, position.y, position.z],
      state,
      mirror: mirror.visible,
      grids: grids.visible,
    });
    return { texture: {} as never, size, dispose: () => (disposed += 1) };
  };
  const probes = new RoomProbes({
    probes: [
      { roomId: 'a', position: { x: 1, y: 1.5, z: 1 } },
      { roomId: 'b', position: { x: 4, y: 1.5, z: 1 } },
    ],
    rig: { setState: (next) => (state = next) },
    mirrors: () => [mirror],
    grids,
    capture,
    copy: (_source, room) => copied.push(room),
  });
  return { probes, captured, copied, mirror, grids, state: () => state, disposed: () => disposed };
}

describe('RoomProbes', () => {
  test('captures one room per frame at its probe point into its layers', () => {
    const { probes, captured, copied, disposed } = setup();
    expect(probes.step()).toBe(false);
    expect(probes.step()).toBe(true);
    expect(captured.map((c) => c.at)).toEqual([
      [1, 1.5, 1],
      [4, 1.5, 1],
    ]);
    expect(copied).toEqual([0, 1]);
    expect(disposed()).toBe(2);
  });

  test('captures in the capture state with mirrors hidden and the grids on, and puts everything back', () => {
    const { probes, captured, mirror, grids, state } = setup();
    probes.step();
    expect(captured[0]).toMatchObject({ state: 'capture', mirror: false, grids: true });
    expect([state(), mirror.visible, grids.visible]).toEqual(['editing', true, false]);
  });

  test('re-captures one room on request', () => {
    const { probes, captured } = setup();
    while (!probes.step());
    probes.recapture(['b']);
    expect(probes.step()).toBe(true);
    expect(captured.at(-1)!.at).toEqual([4, 1.5, 1]);
    expect(captured).toHaveLength(3);
  });

  test('fails loudly when a probe’s PMREM is not the cube the array copies', () => {
    const { probes, state } = setup(512);
    expect(() => probes.step()).toThrow(/layout/);
    expect(state()).toBe('editing');
  });
});
