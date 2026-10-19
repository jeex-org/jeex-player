/**
 * Readings the check takes from a running page: where the camera stands, what
 * the tour bar says, and the one click that applies a finish.
 *
 * Every probe reads a MACHINE-READABLE attribute or a `__viewerDebug` call,
 * never the copy on screen: translating the UI must not break the check
 * (`src/ui/messages.ts`).
 */

import type { Session } from './session.js';
import { nameSelector } from './page-code.js';

export type Camera = { x: number; y: number; z: number };
export type Pick = { hit: boolean; x?: number; y?: number; reason?: string };

export function distance(a: Camera, b: Camera): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export type Probes = {
  cameraAt: () => Promise<Camera>;
  tourState: () => Promise<string>;
  tourProgressText: () => Promise<string>;
  tourBar: () => Promise<{ visible: string; state: string; valuenow: number }>;
  applyFinish: (finishId: string) => Promise<void>;
  distance: (a: Camera, b: Camera) => number;
};

export function createProbes(session: Session): Probes {
  const { evalValue, assert, literal } = session;
  return {
    distance,
    cameraAt: () => evalValue<Camera>('JSON.stringify(window.__viewerDebug?.camera())'),
    /** The tour's machine-readable state pill; never its copy. */
    tourState: () => evalValue<string>(`document.querySelector('${nameSelector('tour-status')}')?.dataset.state ?? 'none'`),
    tourProgressText: () => evalValue<string>(`document.querySelector('${nameSelector('tour-status-progress')}')?.textContent ?? ''`),
    /** `tour-bar[data-visible][data-state]` plus `tour-track[aria-valuenow]`. */
    tourBar: () =>
      evalValue(`(() => {
      const bar = document.querySelector('${nameSelector('tour-bar')}');
      const track = document.querySelector('${nameSelector('tour-track')}');
      return JSON.stringify({
        visible: bar?.dataset.visible ?? 'none',
        state: bar?.dataset.state ?? 'none',
        valuenow: Number(track?.getAttribute('aria-valuenow') ?? -1),
      });
    })()`),
    /** Clicks the swatch of a finish id in the open panel; throws when it is absent. */
    applyFinish: async (finishId: string) => {
      const applied = await evalValue<boolean>(
        `(() => { const s = document.querySelector('.finish-swatch[data-finish=' + CSS.escape(${literal(finishId)}) + ']');` +
          ' if (!s) return false; s.click(); return true; })()',
      );
      assert(applied, `the open finish panel should offer the ${finishId} swatch`);
    },
  };
}
