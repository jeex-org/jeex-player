/**
 * The read-only map view: it reads like a `Map`, and no prototype trick reaches
 * the backing store.
 */

import { describe, expect, test } from 'bun:test';
import { isReadonlyMapView, readonlyMapView, type KeyedSource } from './readonly-map.js';

function view(): ReadonlyMap<string, number> {
  return readonlyMapView(
    new Map([
      ['a', 1],
      ['b', 2],
    ]),
  );
}

describe('readonlyMapView reads like a Map', () => {
  test('exposes get, has, size and the three iterators', () => {
    const subject = view();
    expect(subject.get('a')).toBe(1);
    expect(subject.get('missing')).toBeUndefined();
    expect(subject.has('b')).toBe(true);
    expect(subject.has('missing')).toBe(false);
    expect(subject.size).toBe(2);
    expect([...subject.keys()]).toEqual(['a', 'b']);
    expect([...subject.values()]).toEqual([1, 2]);
    expect([...subject.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect([...subject]).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  test('forEach hands out value, key and the view itself', () => {
    const subject = view();
    const seen: Array<[string, number, boolean]> = [];
    subject.forEach((value, key, map) => {
      seen.push([key, value, map === subject]);
    });
    expect(seen).toEqual([
      ['a', 1, true],
      ['b', 2, true],
    ]);
  });

  test('is frozen and recognised by isReadonlyMapView', () => {
    const subject = view();
    expect(Object.isFrozen(subject)).toBe(true);
    expect(isReadonlyMapView(subject)).toBe(true);
    expect(isReadonlyMapView(new Map())).toBe(false);
    expect(isReadonlyMapView(null)).toBe(false);
    expect(isReadonlyMapView({})).toBe(false);
  });
});

describe('readonlyMapView cannot be mutated', () => {
  test('it carries no mutators at all', () => {
    const subject = view() as unknown as Record<string, unknown>;
    for (const name of ['set', 'add', 'delete', 'clear']) expect(subject[name]).toBeUndefined();
  });

  test('borrowing Map.prototype mutators fails: the view owns no map slot', () => {
    const subject = view();
    expect(() => {
      Map.prototype.set.call(subject, 'x', 9);
    }).toThrow(TypeError);
    expect(() => {
      Map.prototype.delete.call(subject, 'a');
    }).toThrow(TypeError);
    expect(() => {
      Map.prototype.clear.call(subject);
    }).toThrow(TypeError);
    expect(subject.size).toBe(2);
    expect([...subject.keys()]).toEqual(['a', 'b']);
  });

  test('the backing store is unreachable from the view', () => {
    const backing = new Map([['a', 1]]);
    const subject = readonlyMapView(backing);
    const reachable = [...Object.getOwnPropertyNames(subject), ...Object.getOwnPropertySymbols(subject).map(String)];
    for (const key of reachable) {
      expect((subject as unknown as Record<string, unknown>)[key]).not.toBe(backing);
    }
    expect(Object.getPrototypeOf(subject)).toBe(Object.prototype);
  });

  test('a later write to the source is still reflected, so the view is not a copy', () => {
    const backing = new Map<string, number>([['a', 1]]);
    const subject = readonlyMapView(backing);
    backing.set('b', 2);
    expect(subject.size).toBe(2);
    expect(subject.get('b')).toBe(2);
  });
});

describe('readonlyMapView over a keyed source that is not a Map', () => {
  /**
   * A source keyed by a STRUCTURE, the way `scene/types.FaceMap` is: two
   * equal points address one entry. The view must delegate every lookup, so
   * the source's own notion of key equality is what answers.
   */
  type Point = { readonly x: number; readonly y: number };
  function pointSource(entries: readonly (readonly [Point, string])[]): KeyedSource<Point, string> {
    const store = new Map<string, readonly [Point, string]>();
    for (const entry of entries) store.set(`${entry[0].x},${entry[0].y}`, entry);
    const pairs = function* (): IterableIterator<[Point, string]> {
      for (const [point, value] of store.values()) yield [point, value];
    };
    return {
      get size() {
        return store.size;
      },
      get: (key) => store.get(`${key.x},${key.y}`)?.[1],
      has: (key) => store.has(`${key.x},${key.y}`),
      *keys() {
        for (const [point] of pairs()) yield point;
      },
      *values() {
        for (const [, value] of pairs()) yield value;
      },
      entries: pairs,
      [Symbol.iterator]: pairs,
    };
  }

  test('lookups use the source’s equality: a structurally equal key finds its entry', () => {
    const origin = { x: 0, y: 0 };
    const subject = readonlyMapView(pointSource([[origin, 'origin']]));
    expect(subject.get({ x: 0, y: 0 })).toBe('origin');
    expect(subject.has({ x: 0, y: 0 })).toBe(true);
    expect(subject.has({ x: 1, y: 0 })).toBe(false);
    expect(subject.size).toBe(1);
    expect([...subject.keys()]).toEqual([origin]);
    expect([...subject]).toEqual([[origin, 'origin']]);
  });

  test('it is frozen, recognised as a view and carries no mutators', () => {
    const subject = readonlyMapView(pointSource([]));
    expect(Object.isFrozen(subject)).toBe(true);
    expect(isReadonlyMapView(subject)).toBe(true);
    for (const name of ['set', 'delete', 'clear']) expect((subject as unknown as Record<string, unknown>)[name]).toBeUndefined();
  });
});
