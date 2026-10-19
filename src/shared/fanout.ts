/**
 * One listener list, with one set of rules, for every fan-out in the project.
 *
 * There were four of them — `ViewerEvents`, `TourEvents`, `SceneModel`'s
 * revision listeners and `RenderRuntime`'s frame hooks — each carrying its own
 * copy of the same three decisions, and they had drifted. The three
 * decisions are:
 *
 * 1. **Copy before iterating.** A subscriber that unsubscribes itself — or the
 *    one after it — mid-emission must not make the list skip an entry.
 * 2. **One try/catch per subscriber.** A host page's callback is not the
 *    viewer's code: one that throws must not take the others down, must not
 *    abort the frame, and must not turn a committed batch into a thrown call.
 * 3. **Failures go to an injected sink.** The owner decides where — an `onLog`
 *    entry, an `error` event, a collected list — and the sink runs inside its
 *    own try/catch, because a sink is a listener too.
 *
 * Ordering invariant: subscribers are notified in registration order. A `Set`
 * gives that, and it also makes `add` idempotent — subscribing the same
 * function twice leaves one subscription, and one unsubscribe ends it.
 *
 * The payload is a TUPLE, so the frame hooks (`delta, now`) share the class
 * with the single-payload fan-outs without allocating a wrapper object every
 * frame. `Fanout<[ViewerError]>.emit(error)` reads the same as before.
 *
 * Lowest layer: this module imports nothing.
 */

/** What a `Fanout` does with a subscriber that threw. */
export type FanoutFailure = (error: unknown) => void;

/**
 * A fan-out of any payload, for an owner holding several: `Fanout<[A]>` and
 * `Fanout<[B]>` share no supertype otherwise, because the callback parameter is
 * contravariant. This is the part every owner's teardown needs.
 */
export type AnyFanout = { clear(): void; readonly size: number };

export class Fanout<A extends readonly unknown[]> {
  private readonly listeners = new Set<(...args: A) => void>();
  private readonly onFailure: FanoutFailure | undefined;

  /**
   * `onFailure` is called once per throwing subscriber, with the throw as it
   * came. It runs inside its own try/catch: a sink that throws is swallowed,
   * because there is nothing left to report it to.
   */
  constructor(onFailure?: FanoutFailure) {
    this.onFailure = onFailure;
  }

  /** Subscribes; the returned function unsubscribes, and is idempotent. */
  add(callback: (...args: A) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /** Unsubscribes `callback` if it is subscribed; for a caller that kept no closure. */
  remove(callback: (...args: A) => void): void {
    this.listeners.delete(callback);
  }

  /** Notifies every current subscriber, in registration order. */
  emit(...args: A): void {
    // The copy is what makes rule 1 hold: `Set` iteration is live, so a
    // subscriber that unsubscribed the next one would otherwise skip it.
    for (const listener of [...this.listeners]) {
      try {
        listener(...args);
      } catch (error) {
        try {
          this.onFailure?.(error);
        } catch {
          // The reporter is what failed.
        }
      }
    }
  }

  /** Drops every subscriber; part of the owner's teardown. */
  clear(): void {
    this.listeners.clear();
  }

  /** How many subscribers are registered right now. */
  get size(): number {
    return this.listeners.size;
  }
}
