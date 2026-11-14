/**
 * The draws the render gate commits (`src/render/render-demand.ts`), recorded with their kind, for
 * the component tests that count a burst of rest frames.
 */

import { expect, vi } from 'vitest';
import { RenderDemand, STEADY_AFTER_IDLE_TICKS, type DemandCounters } from '../../src/render/render-demand.js';

/**
 * A draw of the gate: answering a change or a camera move, the steady draw after the view rested, a
 * repeat of the settle window, or a rest frame of a resting walk or tour.
 */
export type DrawKind = 'change' | 'steady' | 'repeat' | 'rest';

/**
 * A draw a followed change made: its tick, counted from the change (the first tick after it is 1),
 * its kind, and for a rest frame its index.
 */
export type FollowedDraw = { at: number; kind: DrawKind; rest: number | null };

/** The gate's own state before a commit, read for the kind of the draw (`RenderDemand`). */
type GateState = { dirty: boolean; repeating: boolean; idle: number; resting: number | null };

/** The kind of the draw the gate is about to commit, read from its own state. */
function kindOf(demand: RenderDemand): DrawKind {
  const gate = demand as unknown as GateState;
  if (gate.dirty) return 'change';
  if (gate.repeating) return 'repeat';
  if (gate.resting !== null) return 'rest';
  return gate.idle >= STEADY_AFTER_IDLE_TICKS ? 'steady' : 'change';
}

/** Records every committed draw into `drawn`, its tick counted from `start`; answers the spy to restore. */
export function recordDraws(drawn: FollowedDraw[], start: DemandCounters): { mockRestore(): void } {
  const commit = Object.getOwnPropertyDescriptor(RenderDemand.prototype, 'commit')!.value as RenderDemand['commit'];
  return vi.spyOn(RenderDemand.prototype, 'commit').mockImplementation(function (this: RenderDemand, live) {
    const kind = kindOf(this);
    const frame = this.restFrame();
    commit.call(this, live);
    drawn.push({ at: this.counters().ticks - start.ticks, kind, rest: frame });
  });
}

/**
 * The first rest after `drawn` began: exactly `count` rest frames, numbered from 0, on consecutive
 * ticks, and no settle-window repeat right after any rest frame (a repeat there would mean the burst
 * itself brought new GPU resources and started itself again).
 */
export function expectOneBurst(what: string, drawn: readonly FollowedDraw[], count: number): void {
  const restarts = drawn.filter((draw, index) => draw.kind === 'repeat' && drawn[index - 1]?.kind === 'rest');
  expect(restarts, `${what}: no settle repeat after a rest frame`).toEqual([]);
  const last = drawn.findLastIndex((draw) => draw.kind !== 'rest');
  const burst = drawn.slice(last + 1);
  expect(
    burst.map((draw) => draw.rest),
    `${what}: the rest frames of the tier, numbered from 0`,
  ).toEqual(Array.from({ length: count }, (_, index) => index));
  expect(
    burst.map((draw) => draw.at - burst[0]!.at),
    `${what}: on consecutive ticks`,
  ).toEqual(Array.from({ length: count }, (_, index) => index));
}
