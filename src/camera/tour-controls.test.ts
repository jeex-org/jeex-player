/**
 * The public tour surface: what a landing page calls and what it is told back.
 *
 * The host is stubbed here — the director's own half (engage without pausing,
 * `pauseOnInput`) is covered in `camera-director.test.ts` against a real
 * controller — so these tests are about routing and about the listener
 * registry: nothing reaches the player without tour mode being engaged first,
 * and one throwing subscriber never takes the others down with it.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { apartmentScene } from '../demo/scene-data.js';
import { TourPlayer, type TourProgress, type TourState } from './tour-player.js';
import { TourEvents, createTourControls, replayPendingTourCommand } from './tour-controls.js';
import { collectLogger } from '../fixtures/stubs.js';

function harness(options: { player?: boolean } = {}) {
  const calls: string[] = [];
  // The fan-out's own sink, so a deliberately throwing subscriber is reported
  // here rather than on the process console (`stubs.collectLogger`).
  const logged = collectLogger();
  const events = new TourEvents(logged.log);
  const player =
    options.player === false
      ? null
      : new TourPlayer(apartmentScene, () => undefined, {
          onState: (state) => events.emitState(state),
          onProgress: (progress) => events.emitProgress(progress),
        });
  let mode: 'orbit' | 'tour' = 'orbit';
  const controls = createTourControls(
    {
      engageTour: () => {
        calls.push('engage');
        if (mode === 'tour') return null;
        mode = 'tour';
        return { position: new THREE.Vector3(1, 2, 3), target: new THREE.Vector3(4, 1, 5) };
      },
      toggleTour: () => {
        calls.push('toggle');
      },
      player: () => player,
    },
    events,
  );
  return { controls, events, player, calls, logged, mode: () => mode };
}

describe('tour controls routing', () => {
  test('play engages tour mode before it starts the player', () => {
    const { controls, calls, mode, player } = harness();
    controls.play();
    expect(calls).toEqual(['engage']);
    expect(mode()).toBe('tour');
    expect(player!.getState()).toBe('playing');
  });

  test('pause leaves tour mode engaged', () => {
    const { controls, mode, player } = harness();
    controls.play();
    controls.pause();
    expect(player!.getState()).toBe('paused');
    expect(mode()).toBe('tour');
  });

  test('every seek engages tour mode, so the frame pump keeps ticking the clip', () => {
    const { controls, calls, mode, player } = harness();
    controls.seek(0.5);
    controls.seekDistance(3);
    controls.seekTime(2);
    expect(calls).toEqual(['engage', 'engage', 'engage']);
    expect(mode()).toBe('tour');
    expect(player!.getState()).toBe('paused');
  });

  test('toggle is the tour button, not a second play path', () => {
    const { controls, calls } = harness();
    controls.toggle();
    expect(calls).toEqual(['toggle']);
  });

  test('the units agree: fraction, metres and seconds address the same point', () => {
    const { controls } = harness();
    controls.seek(0.5);
    const byFraction = controls.progress()!;
    controls.seek(0);
    controls.seekDistance(byFraction.distance);
    expect(controls.progress()!.fraction).toBeCloseTo(0.5, 6);
    controls.seek(0);
    controls.seekTime(byFraction.elapsed);
    expect(controls.progress()!.fraction).toBeCloseTo(0.5, 2);
  });

  test('before the camera stack exists nothing reaches it, and progress says so', () => {
    const { controls, calls } = harness({ player: false });
    controls.play();
    controls.pause();
    controls.seek(0.5);
    controls.stop();
    expect(calls).toEqual([]);
    // `null`, not a fabricated `{ state: 'ready', fraction: 0 }`: a host has to
    // be able to tell "no clip yet" from "at the start of the clip".
    expect(controls.progress()).toBeNull();
  });
});

describe('commands issued before the clip exists', () => {
  /**
   * A host holds `handle.tour` from the moment `mountViewer` returns, which is
   * before the scene has loaded. The LAST command is remembered and replayed on
   * the first route; the ones before it are not, because these are transport
   * controls and a queue would run the camera through every position the host
   * mentioned while it waited.
   */
  /** Controls over a host whose player appears only when `arrive()` is called. */
  function deferredHarness() {
    const { player } = harness();
    const calls: string[] = [];
    let live: typeof player = null;
    const controls = createTourControls(
      {
        engageTour: () => {
          calls.push('engage');
          return null;
        },
        toggleTour: () => {
          calls.push('toggle');
        },
        player: () => live,
        onSpeed: (speed) => calls.push(`speed:${speed}`),
      },
      new TourEvents(),
    );
    return {
      controls,
      calls,
      player,
      arrive: () => {
        live = player;
      },
    };
  }

  test('a play issued before readiness starts the clip when it arrives', () => {
    const { controls: deferred, calls, player, arrive } = deferredHarness();

    deferred.play();
    expect(calls).toEqual([]);
    expect(deferred.progress()).toBeNull();

    arrive();
    replayPendingTourCommand(deferred);
    expect(player!.getState()).toBe('playing');
    expect(calls).toEqual(['engage']);

    // Replaying twice must not restart it: the command is consumed.
    player!.pause();
    replayPendingTourCommand(deferred);
    expect(player!.getState()).toBe('paused');
  });

  test('the LAST command wins: a seek after a play lands on the fraction, not running', () => {
    const { controls: deferred, player, arrive } = deferredHarness();

    deferred.play();
    deferred.seek(0.62);
    arrive();
    replayPendingTourCommand(deferred);
    expect(deferred.progress()!.fraction).toBeCloseTo(0.62, 6);
    // The `play` before it was superseded, so the clip is not running.
    expect(player!.getState()).not.toBe('playing');
  });

  // The speed is a setting, not a transport command — it never displaces one.
  test('a speed setting made before the clip exists is announced at once and applied when the clip arrives', () => {
    const { controls: deferred, calls, player, arrive } = deferredHarness();
    deferred.play();
    deferred.setSpeed(2);
    deferred.setSpeed(2);
    expect(calls).toEqual(['speed:2']);
    arrive();
    replayPendingTourCommand(deferred);
    expect(player!.progress().speed).toBe(2);
    expect(player!.getState()).toBe('playing');
    expect(deferred.progress()!.speed).toBe(2);
  });
});

describe('the speed setting', () => {
  test('anything but 0.5, 1 or 2 is refused and changes nothing', () => {
    const { controls, player } = harness();
    for (const bad of [3, 0, -1, Number.NaN, '2', null]) {
      expect(() => controls.setSpeed(bad as never)).toThrow(expect.objectContaining({ code: 'bad-params' }));
    }
    expect(player!.progress().speed).toBe(1);
  });
});

describe('the listener registry', () => {
  test('state, progress and ended reach their subscribers', () => {
    const { controls, player } = harness();
    const states: TourState[] = [];
    const progress: TourProgress[] = [];
    let ended = 0;
    controls.on('state', (state) => states.push(state));
    controls.on('progress', (value) => progress.push(value));
    controls.on('ended', () => {
      ended += 1;
    });

    controls.play();
    player!.update(0.5);
    expect(states).toEqual(['playing']);
    expect(progress.length).toBeGreaterThan(0);
    expect(ended).toBe(0);

    controls.seek(1);
    expect(states).toEqual(['playing', 'ended']);
    expect(ended).toBe(1);
  });

  test('unsubscribing stops the delivery', () => {
    const { controls } = harness();
    const seen: TourState[] = [];
    const off = controls.on('state', (state) => seen.push(state));
    controls.seek(0.2);
    off();
    controls.play();
    expect(seen).toEqual(['paused']);
  });

  test('a throwing subscriber is contained and the others still run', () => {
    const { controls, logged } = harness();
    const seen: TourState[] = [];
    controls.on('state', () => {
      throw new Error('host page bug');
    });
    controls.on('state', (state) => seen.push(state));
    controls.seek(0.3);
    expect(seen).toEqual(['paused']);
    expect(logged.entries).toHaveLength(1);
    expect(logged.entries[0]?.code).toBe('listener-failed');
    expect(logged.entries[0]?.message).toContain('tour state listener failed');
  });

  test('a subscriber that unsubscribes from inside its own callback is safe', () => {
    const { controls } = harness();
    const seen: TourState[] = [];
    const off = controls.on('state', (state) => {
      seen.push(state);
      off();
    });
    controls.seek(0.3);
    controls.play();
    expect(seen).toEqual(['paused']);
  });

  test('a subscriber that unsubscribes ITS NEIGHBOUR still lets it hear this transition', () => {
    // The fan-out copies before it walks (`shared/fanout.ts`).
    const { controls } = harness();
    const seen: string[] = [];
    controls.on('state', (state) => {
      seen.push(`a:${state}`);
      offB();
    });
    const offB = controls.on('state', (state) => seen.push(`b:${state}`));
    controls.seek(0.3);
    controls.play();
    expect(seen).toEqual(['a:paused', 'b:paused', 'a:playing']);
  });

  test('clear() drops every subscriber, as viewer teardown does', () => {
    const { controls, events } = harness();
    const seen: TourState[] = [];
    controls.on('state', (state) => seen.push(state));
    events.clear();
    controls.seek(0.4);
    expect(seen).toEqual([]);
  });
});
