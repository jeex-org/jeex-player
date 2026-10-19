/**
 * A frozen read-only view over a `Map`, for keyed state that is handed out but
 * must never be edited by whoever receives it.
 *
 * Invariant: the backing store is reachable ONLY through the closure the view's
 * own methods capture. That is the whole point. `Object.freeze` does not stop
 * `map.set(...)`, and shadowing the mutators with throwing own properties does
 * not stop `Map.prototype.set.call(map, ...)` either — the receiver still owns
 * the internal map slot, so a borrowed mutator writes straight into it. A view
 * is a plain object with no such slot: every borrowed `Map.prototype` method
 * fails with a `TypeError`, and nothing on the object references the store.
 *
 * The view satisfies the built-in `ReadonlyMap<K, V>` interface, so consumers
 * keep using `get` / `has` / `size` / the three iterators unchanged. A source
 * that is not a `Map` but reads like one — `scene/types.FaceMap`, keyed by a
 * structure — gets the same view over its own read half (`ReadonlyKeyed`), and
 * its lookups keep the source's semantics because every call is delegated.
 *
 * Pure module: no `three`, no DOM.
 */

/** Brand of a view, so `deepFreeze` can descend into its values. */
const VIEW_BRAND = Symbol('jeex.readonlyMapView');

/** True when `value` was produced by `readonlyMapView`. */
export function isReadonlyMapView(value: unknown): value is ReadonlyMap<unknown, unknown> {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[VIEW_BRAND] === true;
}

/** The read half of a keyed collection: what a `Map` offers, and what a `FaceMap` offers too. */
export type KeyedSource<K, V> = {
  readonly size: number;
  get(key: K): V | undefined;
  has(key: K): boolean;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
  [Symbol.iterator](): IterableIterator<[K, V]>;
};

/** A view over a `KeyedSource`: its read half plus `forEach`, and no mutator. */
export type ReadonlyKeyed<K, V> = KeyedSource<K, V> & {
  forEach(callback: (value: V, key: K, map: ReadonlyKeyed<K, V>) => void, thisArg?: unknown): void;
};

/**
 * Wraps `source` in a frozen read-only view. The view stays live: it reads
 * whatever `source` holds at call time, so the caller must drop its own
 * reference for the result to be genuinely immutable.
 */
export function readonlyMapView<K, V>(source: Map<K, V>): ReadonlyMap<K, V>;
export function readonlyMapView<K, V>(source: KeyedSource<K, V>): ReadonlyKeyed<K, V>;
export function readonlyMapView<K, V>(source: KeyedSource<K, V>): ReadonlyKeyed<K, V> {
  const view = {
    get size(): number {
      return source.size;
    },
    get: (key: K) => source.get(key),
    has: (key: K) => source.has(key),
    keys: () => source.keys(),
    values: () => source.values(),
    entries: () => source.entries(),
    forEach(callback: (value: V, key: K, map: ReadonlyKeyed<K, V>) => void, thisArg?: unknown): void {
      for (const [key, value] of source) callback.call(thisArg, value, key, frozen);
    },
    [Symbol.iterator]: () => source[Symbol.iterator](),
    [VIEW_BRAND]: true,
  };
  const frozen: ReadonlyKeyed<K, V> = Object.freeze(view);
  return frozen;
}
