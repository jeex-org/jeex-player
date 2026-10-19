/**
 * The two states a piece of library data can be in, expressed in the type
 * system rather than only in prose: `Committed<T>` is state somebody else owns
 * and nobody may edit, `Draft<T>` is a private copy whose whole purpose is to
 * be edited.
 *
 * Invariant: `Committed<T>` is the compile-time half of `SceneModel`'s runtime
 * deep freeze. The model freezes what it hands out, so `model.scene.rooms[0].name = 'x'`
 * throws in production; before this type it also COMPILED, which made the
 * strongest invariant of the data model invisible to every consumer. The two
 * must be changed together: whatever `deepFreeze` walks into, `Committed`
 * marks readonly.
 *
 * `Draft<T>` is the exact inverse, and `draftOf` is the only way to obtain one:
 * a structural deep copy that no one else holds a reference to, which is what
 * makes dropping `readonly` from its type sound.
 *
 * Pure module: no `three`, no DOM.
 */

/**
 * Values neither mapper may descend into.
 *
 * `string & {}` — the "any other string" arm of `DemoAssetType` — is assignable
 * to `object`, so without this branch a mapper walks into `String`'s own
 * methods and turns the union into a `{ charAt, concat, ... }` object. Every
 * primitive is immutable already, so passing them through is also correct.
 */
type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/**
 * Deeply readonly `T`.
 *
 * The object branch is a HOMOMORPHIC mapped type, so arrays stay arrays,
 * tuples keep their length (`swatch: readonly [string, string]`) and optional
 * properties stay optional. Functions pass through unchanged — mapping over a
 * signature would erase it — and a `Map`/`Set` becomes its read-only interface
 * rather than an object with mapped methods.
 */
export type Committed<T> = T extends Primitive
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<K, Committed<V>>
      : T extends ReadonlySet<infer V>
        ? ReadonlySet<Committed<V>>
        : T extends object
          ? { readonly [K in keyof T]: Committed<T[K]> }
          : T;

/** Deeply mutable `T`: the exact inverse of `Committed<T>`, member for member. */
export type Draft<T> = T extends Primitive
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends ReadonlyMap<infer K, infer V>
      ? Map<K, Draft<V>>
      : T extends ReadonlySet<infer V>
        ? Set<Draft<V>>
        : T extends object
          ? { -readonly [K in keyof T]: Draft<T[K]> }
          : T;

/**
 * A private, deeply mutable copy of `value`.
 *
 * `structuredClone` where the runtime has it (every browser and Bun), the
 * `JSON` round trip otherwise, so the pure layer runs anywhere. The scene
 * document is plain JSON data by schema, so neither loses anything.
 */
export function draftOf<T>(value: T): Draft<T> {
  // The one cast in this module, and the reason the module exists: the value
  // returned is a fresh deep copy nothing else holds a reference to, so it is
  // genuinely mutable — `structuredClone` simply cannot say so in its own
  // signature, which is `<T>(value: T) => T`.
  const copy = typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
  return copy as Draft<T>;
}
