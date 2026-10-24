/**
 * The library maps in flight, read in a test: every `LibrarySurface.load`
 * that started and has not yet attached its maps (or given up). A scene is
 * at rest only once this is zero, because a map that lands later changes the
 * picture and asks for a frame (`attached` → `invalidate`).
 *
 * Test-local interception, installed once per file; `delayMs` holds every
 * load back before it starts, which is how a test makes a map land late on
 * purpose.
 */

import { vi } from 'vitest';
import { LibrarySurface } from '../../src/geometry/library-surface.js';

export type LibraryMaps = {
  /** Loads started and not yet settled. */
  pending(): number;
  /** Holds every load that starts from now on back by `ms` (0 to stop). */
  delay(ms: number): void;
};

export function trackLibraryMaps(): LibraryMaps {
  let pending = 0;
  let delayMs = 0;
  const load = Object.getOwnPropertyDescriptor(LibrarySurface.prototype, 'load')!.value as LibrarySurface['load'];
  vi.spyOn(LibrarySurface.prototype, 'load').mockImplementation(async function (this: LibrarySurface, textures) {
    pending += 1;
    try {
      if (delayMs > 0) {
        const held = delayMs;
        await new Promise((resolve) => {
          setTimeout(resolve, held);
        });
      }
      await load.call(this, textures);
    } finally {
      pending -= 1;
    }
  });
  return {
    pending: () => pending,
    delay: (ms) => {
      delayMs = ms;
    },
  };
}
