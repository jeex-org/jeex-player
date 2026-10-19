/**
 * The three rules every fan-out in the project shares through this module: copy
 * before iterating, one try/catch per subscriber, failures to an injected sink.
 *
 * The re-entrancy cases are the ones easiest to get wrong — a
 * subscriber that unsubscribes ITSELF, and one that unsubscribes ITS NEIGHBOUR
 * — so they are asserted here once, and once again per consumer.
 */

import { describe, expect, test } from 'bun:test';
import { Fanout } from './fanout.js';

describe('Fanout', () => {
  test('notifies every subscriber in registration order', () => {
    const seen: string[] = [];
    const fanout = new Fanout<[string]>();
    fanout.add((value) => seen.push(`a:${value}`));
    fanout.add((value) => seen.push(`b:${value}`));
    fanout.emit('x');
    expect(seen).toEqual(['a:x', 'b:x']);
  });

  test('the returned unsubscribe stops that subscriber and no other', () => {
    const seen: string[] = [];
    const fanout = new Fanout<[string]>();
    const off = fanout.add((value) => seen.push(`a:${value}`));
    fanout.add((value) => seen.push(`b:${value}`));
    off();
    fanout.emit('x');
    expect(seen).toEqual(['b:x']);
    expect(fanout.size).toBe(1);
  });

  test('adding the same callback twice leaves one subscription', () => {
    const seen: string[] = [];
    const fanout = new Fanout<[string]>();
    const listener = (value: string): void => void seen.push(value);
    fanout.add(listener);
    fanout.add(listener);
    fanout.emit('x');
    expect(seen).toEqual(['x']);
    expect(fanout.size).toBe(1);
  });

  test('a subscriber that unsubscribes ITSELF does not skip the next one', () => {
    const seen: string[] = [];
    const fanout = new Fanout<[string]>();
    const off = fanout.add((value) => {
      seen.push(`a:${value}`);
      off();
    });
    fanout.add((value) => seen.push(`b:${value}`));
    fanout.emit('one');
    fanout.emit('two');
    expect(seen).toEqual(['a:one', 'b:one', 'b:two']);
  });

  test('a subscriber that unsubscribes ITS NEIGHBOUR still lets it run this round', () => {
    // The copy is taken before the walk, so the neighbour is notified for the
    // emission already under way and never again.
    const seen: string[] = [];
    const fanout = new Fanout<[string]>();
    fanout.add((value) => {
      seen.push(`a:${value}`);
      offB();
    });
    const offB = fanout.add((value) => seen.push(`b:${value}`));
    fanout.emit('one');
    fanout.emit('two');
    expect(seen).toEqual(['a:one', 'b:one', 'a:two']);
  });

  test('one throwing subscriber is reported and the rest still run', () => {
    const failures: unknown[] = [];
    const seen: string[] = [];
    const fanout = new Fanout<[string]>((error) => failures.push(error));
    fanout.add(() => {
      throw new Error('host callback exploded');
    });
    fanout.add((value) => seen.push(value));
    fanout.emit('x');
    expect(seen).toEqual(['x']);
    expect((failures[0] as Error).message).toBe('host callback exploded');
  });

  test('a failure sink that throws is swallowed: the reporter is what failed', () => {
    const fanout = new Fanout<[string]>(() => {
      throw new Error('telemetry is down');
    });
    fanout.add(() => {
      throw new Error('host callback exploded');
    });
    expect(() => fanout.emit('x')).not.toThrow();
  });

  test('with no sink at all a throwing subscriber is still contained', () => {
    const seen: string[] = [];
    const fanout = new Fanout<[string]>();
    fanout.add(() => {
      throw new Error('nobody is listening');
    });
    fanout.add((value) => seen.push(value));
    expect(() => fanout.emit('x')).not.toThrow();
    expect(seen).toEqual(['x']);
  });

  test('clear drops everyone, and remove drops one by identity', () => {
    const seen: string[] = [];
    const fanout = new Fanout<[string]>();
    const listener = (value: string): void => void seen.push(value);
    fanout.add(listener);
    fanout.add((value) => seen.push(`other:${value}`));
    fanout.remove(listener);
    expect(fanout.size).toBe(1);
    fanout.clear();
    fanout.emit('x');
    expect(seen).toEqual([]);
    expect(fanout.size).toBe(0);
  });

  test('a multi-argument payload reaches every subscriber intact', () => {
    // The frame hooks are `(delta, now)`; a tuple payload keeps them allocation
    // free rather than wrapping each frame in an object.
    const seen: Array<[number, number]> = [];
    const fanout = new Fanout<[number, number]>();
    fanout.add((delta, now) => seen.push([delta, now]));
    fanout.emit(0.016, 1234);
    expect(seen).toEqual([[0.016, 1234]]);
  });
});
