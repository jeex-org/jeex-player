/**
 * An error as a report may describe it: a fixed code, a stage, a standard
 * class name and the player's own stack frames, or nothing at all.
 *
 * Invariant: the error's message is never read into a report, and a report
 * about an exception (`exception`, `rejection`, `other`) exists only when the
 * stack has at least one frame in the player's own files. Codes the player
 * detects itself (a failed fetch, a refused document, a lost context) are the
 * player's by construction and carry no frames. Errors that are the HOST's
 * mistake (no scene source, bad parameters, a disposed handle) are not
 * reported: they say nothing about the player.
 *
 * Pure module: no `three`, no DOM.
 */

import { ViewerLibError, type ViewerErrorCode } from '../shared/errors.js';
import { ownFrames, parseStack, type OwnFrame } from './stack-frames.js';
import { ERROR_NAMES, STACK_CODES, type ErrorName, type ErrorStage, type TelemetryErrorCode } from './vocabulary.js';

/** What one error report says, before the context and the count are added. */
export type ErrorReport = { code: TelemetryErrorCode; stage: ErrorStage; name: ErrorName; frames: OwnFrame[] };

const NAMES: ReadonlySet<string> = new Set(ERROR_NAMES);

/** The class name of `error` when it is a standard one, else `Error`. */
export function errorName(error: unknown): ErrorName {
  const name = error instanceof Error || (typeof error === 'object' && error !== null) ? (error as { name?: unknown }).name : undefined;
  return typeof name === 'string' && NAMES.has(name) ? (name as ErrorName) : 'Error';
}

/**
 * The stack of `error` without its message. V8 starts the stack with
 * `name: message`, which may span several lines; that prefix is cut off
 * before any line is parsed.
 */
function stackOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const stack = (error as { stack?: unknown }).stack;
  if (typeof stack !== 'string') return '';
  const message = (error as { message?: unknown }).message;
  const name = (error as { name?: unknown }).name;
  const head = typeof message === 'string' ? message : '';
  const prefix = `${typeof name === 'string' ? name : 'Error'}: ${head}`;
  if (head !== '' && stack.startsWith(prefix)) return `Error\n${stack.slice(prefix.length)}`;
  return stack;
}

/**
 * The report for `error` raised at `stage` under `code`, or `null` when it may
 * not be reported. `isOwn` decides which script URLs are the player's.
 */
export function reportOf(code: TelemetryErrorCode, stage: ErrorStage, error: unknown, isOwn: (url: string) => boolean): ErrorReport | null {
  const name = errorName(error);
  if (!STACK_CODES.has(code)) return { code, stage, name, frames: [] };
  const frames = ownFrames(parseStack(stackOf(error)), isOwn);
  return frames.length === 0 ? null : { code, stage, name, frames };
}

/** Two reports with the same key are one report with a count. */
export function reportKey(report: ErrorReport): string {
  return [report.code, report.stage, report.name, ...report.frames.map((frame) => `${frame.file}:${frame.line}:${frame.column}`)].join('|');
}

/**
 * The telemetry code of a viewer error, or `null` when the error is the host's
 * and not the player's. `cause` is the original throw, read for its class and
 * its coded detail only.
 */
export function codeOfViewerError(code: ViewerErrorCode, cause: unknown): TelemetryErrorCode | null {
  switch (code) {
    case 'webgl-unavailable':
      return 'webgl_unavailable';
    case 'context-lost':
      return 'context_lost';
    case 'scene-invalid':
      return 'scene_format';
    case 'project-invalid':
      return 'manifest_format';
    case 'model-external-resource':
      return 'model_format';
    case 'scene-load':
      return loadCode(cause);
    case 'internal':
      return 'exception';
    case 'no-scene-source':
    case 'bad-params':
    case 'not-ready':
    case 'disposed':
      return null;
  }
}

/** A load failure by what the loader recorded: a size cap, an unreadable body, or the network. */
function loadCode(cause: unknown): TelemetryErrorCode {
  if (!(cause instanceof ViewerLibError)) return 'network';
  const detail = cause.detail;
  if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>;
    if ('limit' in record) return 'size_limit';
    if (record['reason'] === 'glb-parse') return 'model_format';
    if ('contentType' in record || cause.message.includes('not JSON')) return 'scene_format';
  }
  return 'network';
}
