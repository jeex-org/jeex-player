/**
 * What a mounted viewer SAYS when something goes wrong: the sink its warnings
 * go to, and the pair of things a failure raises.
 *
 * It is one responsibility, taken out of the composition root because it is
 * policy rather than wiring: a failure is always BOTH a user-facing card and a
 * machine-readable `error` event, and the two must never drift apart: an
 * event emitted after a `dispose()` that had already cleared the listeners
 * would mean a boot failure reached nobody at all.
 *
 * Invariant: `raiseFailure` emits BEFORE it tears anything down, and it stops
 * short of releasing the context — the card it is about to show lives in the
 * shell, and its Retry button re-runs this instance's boot.
 */

import { consoleSink, createLogger, type Logger } from '../shared/logger.js';
import type { ViewerError } from './viewer-events.js';
import type { ViewerOptions } from './viewer-options.js';

/**
 * This instance's logger, over a sink read at CALL time.
 *
 * `options` is a getter rather than the object, because the composition root
 * builds its fan-outs in field initialisers — before its own `options` field is
 * assigned in the constructor body.
 */
export function instanceLogger(options: () => ViewerOptions | undefined): Logger {
  return createLogger((entry) => (options()?.onLog ?? consoleSink)(entry));
}

/** What `raiseFailure` needs of the running viewer. */
type FailureDeps = {
  emitError: (error: ViewerError) => void;
  /** Everything that exists once per BOOT; the shell and the events survive it. */
  teardown: () => void;
  showError: (title: string, message: string, retry: boolean) => void;
};

/** The user-facing card AND the machine-readable event, from one place. */
export function raiseFailure(deps: FailureDeps, failure: ViewerError, title: string, retry: boolean): void {
  deps.emitError(failure);
  deps.teardown();
  deps.showError(title, failure.message, retry);
}
