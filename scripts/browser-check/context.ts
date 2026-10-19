/**
 * What one area of the check is handed: the browser session, the page probes,
 * the gesture probe and the screenshot directory.
 *
 * Areas are plain `async (ctx) => void` functions and share nothing but this.
 * They run in the order the runner lists them, and each one leaves the page in
 * a state it documents, because the next one starts from there.
 */

import { createSession, type Session } from './session.js';
import { createProbes, type Probes } from './probes.js';
import { createGestureProbe, type GestureProbe } from './gestures-probe.js';

export type CheckContext = Session &
  Probes & {
    /** Where the run drops its screenshots; a reviewer points `SHOT_DIR` at a temporary directory. */
    shotDir: string;
    gestures: GestureProbe;
  };

/**
 * Loose upper bound on navigation-to-`__appReady`, milliseconds. It is a
 * regression tripwire for a build that starts blocking the first frame, not a
 * performance target: a dev build on a busy machine is comfortably inside it.
 */
export const READY_BUDGET_MS = 5000;

export function createContext(url: string, shotDir: string): CheckContext {
  const session = createSession(url);
  return { ...session, ...createProbes(session), shotDir, gestures: createGestureProbe(session) };
}
