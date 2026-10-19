/**
 * The library's one logging seam. Nothing in `src/` writes to the console
 * except this file: everything raises a `LogEntry` on a sink the host may
 * replace with `ViewerOptions.onLog`.
 *
 * Why a seam at all: a library embedded in someone else's page does not own
 * their console. A host that ships its own telemetry wants the warning as
 * structure — a `code` it can count, a `detail` it can index — not a sentence
 * to regex, and a host running a hundred viewers wants to turn the noise off
 * entirely. The default sink is the console, prefixed, so a page that asks for
 * nothing still sees every warning in its console.
 *
 * `code` is a stable kebab-case id, chosen the way a validator rule is: it
 * survives a reworded message, which is what a host's log filter keys on.
 *
 * Invariant: `check.sh` greps `src/` for `console.<method>(` and fails on any
 * hit outside this file and `embed/host.ts` (whose host-side handle must not
 * import a line of viewer code).
 *
 * Lowest layer: this module imports nothing, so the plan solver, the camera
 * rigs and the composition root all report through the same sink.
 */

export type LogLevel = 'warn' | 'error';

/** One thing the viewer wants to say, as structure rather than a sentence. */
export type LogEntry = {
  level: LogLevel;
  /** Stable kebab-case id of what happened: `walkspawn-derived`, `option-invalid`. */
  code: string;
  message: string;
  /** Whatever the entry knew beyond its message; opaque to the sink. */
  detail?: unknown;
};

/** Where log entries go. `ViewerOptions.onLog` is a host-supplied one. */
export type LogSink = (entry: LogEntry) => void;

/** Prefix of anything this library writes to the console. */
export const LOG_PREFIX = '[jeex-viewer]';

/**
 * The default sink: the console, prefixed and code-tagged.
 *
 * The only `console.*` in `src/` outside `embed/host.ts`. `detail` is passed as
 * a second argument rather than stringified, so a devtools console keeps it
 * inspectable.
 */
export const consoleSink: LogSink = (entry) => {
  const line = `${LOG_PREFIX} ${entry.code}: ${entry.message}`;
  if (entry.detail === undefined) {
    if (entry.level === 'error') console.error(line);
    else console.warn(line);
    return;
  }
  if (entry.level === 'error') console.error(line, entry.detail);
  else console.warn(line, entry.detail);
};

/** What a module holds instead of reaching for the console. */
export type Logger = {
  warn(code: string, message: string, detail?: unknown): void;
  error(code: string, message: string, detail?: unknown): void;
};

/**
 * A logger over `sink`, or over the console when the host named none.
 *
 * A sink that throws is swallowed: a host's telemetry callback failing must not
 * take down the frame that was only trying to mention something.
 */
export function createLogger(sink?: LogSink): Logger {
  const target = sink ?? consoleSink;
  const emit = (level: LogLevel, code: string, message: string, detail?: unknown): void => {
    try {
      target(detail === undefined ? { level, code, message } : { level, code, message, detail });
    } catch {
      // Nothing to report it to: the reporter is what failed.
    }
  };
  return {
    warn: (code, message, detail) => emit('warn', code, message, detail),
    error: (code, message, detail) => emit('error', code, message, detail),
  };
}

/** The logger a module uses when nothing handed it one. */
export const defaultLogger: Logger = createLogger();
