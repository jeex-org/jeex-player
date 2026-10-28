/**
 * The construction bag of the render runtime (`render-runtime.ts`), beside it
 * rather than in it: that file sits at its 700-line limit and this type is
 * data, so a quality-tier change that had to grow the runtime grew this
 * instead. It imports the runtime's collaborators one way; nothing imports it
 * back.
 *
 * Pure module: types only.
 */

import type * as THREE from 'three';
import type { ViewportBox } from './viewport-box.js';
import type { LightingContext } from '../lighting/lighting-context.js';

export type RenderRuntimeOptions = {
  canvas: HTMLCanvasElement;
  viewport: ViewportBox;
  /** The drawing buffer's device-pixel-ratio ceiling; a quality tier retunes it live (`setPixelRatioCap`). */
  pixelRatioCap?: number;
  shadowMapSize?: number;
  /**
   * Injection seams. Bun has no WebGL context and no `requestAnimationFrame`,
   * so the unit test drives the loop with stubs; production uses the defaults.
   */
  createRenderer?: (canvas: HTMLCanvasElement) => THREE.WebGLRenderer;
  /** The lighting standard bound to the renderer; production builds it with the player's three.js. */
  createLighting?: (renderer: THREE.WebGLRenderer) => LightingContext;
  scheduleFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  /**
   * The context is gone: the loop has already been stopped and nothing will be
   * drawn until it comes back. The composition root shows the user what
   * happened and emits the public `error` event.
   */
  onContextLost?: (() => void) | undefined;
  /**
   * The browser gave the context back. Every GPU resource was dropped with it,
   * so the composition root re-mounts the committed document; this runtime
   * resumes the loop itself.
   */
  onContextRestored?: (() => void) | undefined;
  /** The mounted viewer's lifetime; aborting it unwinds every listener here. */
  signal?: AbortSignal | undefined;
  /** A frame hook threw. The frame goes on; the composition root reports it. */
  onError?: ((error: unknown) => void) | undefined;
  /** The camera mode now: every mode but `plan2d` draws on demand (`render-demand.ts`). */
  mode?: (() => string | undefined) | undefined;
};
