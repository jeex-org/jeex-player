/**
 * The scene canvas's one replacement rule.
 *
 * Pure DOM: no `three`.
 */

import type { ViewerRoots } from './viewer-shell.js';

/**
 * Puts a new scene canvas in the old one's place, and in `roots`.
 *
 * A canvas holds one WebGL context for life. Once a stage has drawn on it,
 * that context is gone (lost by the browser, or released by
 * `RenderRuntime.dispose`), and a renderer built on it reads null where three
 * asks for the shader precision. The clone keeps every attribute the shell
 * gave the canvas; the listeners on it belonged to the stage that went.
 */
export function replaceSceneCanvas(roots: ViewerRoots): void {
  const fresh = roots.canvas.cloneNode(false) as HTMLCanvasElement;
  roots.canvas.replaceWith(fresh);
  roots.canvas = fresh;
}
