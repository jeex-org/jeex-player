/**
 * The boot sequence as data: what the loading bar shows, and when.
 *
 * One table in order rather than literals scattered through `init()`, so the
 * bar's story is read here, not by tracing the function, so a step that moves, or a step that is added, is one
 * edit and stays monotonic (`boot-steps.test.ts` asserts that it does).
 */

import type { MessageKey } from '../ui/messages.js';

type BootStep = {
  /** Where the loading bar stands after this step, `0..100`. */
  percent: number;
  /** What the label says while the step runs. */
  label: MessageKey;
};

/**
 * In order. `support` is first because a browser with no WebGL never reaches
 * the rest, and `ready` is 100 because the bar is about to be hidden.
 */
export const BOOT_STEPS = {
  support: { percent: 12, label: 'loading.support' },
  scene: { percent: 20, label: 'loading.scene' },
  geometry: { percent: 28, label: 'loading.geometry' },
  furniture: { percent: 56, label: 'loading.furniture' },
  ready: { percent: 100, label: 'loading.ready' },
} as const satisfies Record<string, BootStep>;
