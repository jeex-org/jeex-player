/**
 * The beauty pass of the frame being drawn, per renderer.
 *
 * Some objects do work from `onBeforeRender` that must happen once per frame,
 * in the frame's own picture and nowhere else: a mirror re-renders the room
 * for its reflection. three calls that hook in EVERY pass that draws the
 * object (the transmission pass, the occlusion input of the walk chain, a
 * checkpoint inset preview, a swatch), so the hook needs to know which pass is
 * the frame's picture. Whoever draws that picture (the runtime's direct
 * render, the walk chain's scene pass, a still capture) names its target,
 * scene and camera here for the duration of the draw; a hook compares what is
 * bound with that scope (`assets/mirror-capture.ts`).
 *
 * Invariant: a scope lives exactly as long as its draw. It is set before the
 * draw and the previous one (usually none) is put back in `finally`, so a
 * draw that throws never leaves a stale scope behind for the next pass.
 *
 * Pure module: no `three`, no DOM. The renderer is a key, nothing more.
 */

/** The beauty pass being drawn: the bound target (`null` for the screen), the scene and the camera. */
export type ScenePass = { readonly target: unknown; readonly scene: unknown; readonly camera: unknown };

const scopes = new WeakMap<object, ScenePass>();

/** Runs `draw` with `scope` as `renderer`'s beauty pass and restores the previous scope afterwards. */
export function withScenePass<T>(renderer: object, scope: ScenePass, draw: () => T): T {
  const previous = scopes.get(renderer);
  scopes.set(renderer, scope);
  try {
    return draw();
  } finally {
    if (previous === undefined) scopes.delete(renderer);
    else scopes.set(renderer, previous);
  }
}

/** The beauty pass `renderer` is drawing now, or `undefined` outside one. */
export function scenePassOf(renderer: object): ScenePass | undefined {
  return scopes.get(renderer);
}
