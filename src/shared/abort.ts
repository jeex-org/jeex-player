/**
 * Listener lifetime, as one object: an `AbortController` that a parent signal
 * can also fire.
 *
 * Every `addEventListener` in this project passes `{ signal }` and nothing
 * pairs an explicit `removeEventListener` with it. A module that owns listeners of its own therefore owns
 * a controller of its own — so its `dispose()` still means something on its
 * own — and LINKS it to the instance-wide signal the composition root holds,
 * so a viewer that is disposed unwinds every listener under it in one call.
 *
 * Invariant: the link costs nothing after either end fires. The `abort`
 * listener on the parent is registered with the child's own signal, so the
 * child aborting removes it; the parent aborting removes it through `once`.
 * A finished viewer therefore leaves no handler on a signal a host still holds.
 *
 * Pure module: `AbortController` is a platform global, not a DOM node
 * (Baseline widely available since 2019-03-25), so this runs under Bun as is.
 */

/**
 * `addEventListener` options for a lifetime that may not be known.
 *
 * `exactOptionalPropertyTypes` refuses `{ signal: undefined }`, and a unit
 * harness legitimately has no lifetime to give — so the property is either
 * present with a real signal or absent, and never spelled out at the call site.
 */
export function listenerOptions(signal?: AbortSignal): AddEventListenerOptions {
  return signal ? { signal } : {};
}

/**
 * A controller whose signal aborts when `parent` does, and independently when
 * the caller aborts it. `parent` already aborted aborts the child at once, with
 * the same reason.
 */
export function linkedAbortController(parent?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (!parent) return controller;
  if (parent.aborted) {
    controller.abort(parent.reason);
    return controller;
  }
  parent.addEventListener(
    'abort',
    () => {
      controller.abort(parent.reason);
    },
    { once: true, signal: controller.signal },
  );
  return controller;
}
