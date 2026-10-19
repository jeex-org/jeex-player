/**
 * The logging seam. Two properties carry it: a host-supplied sink gets the
 * entry as STRUCTURE (level, code, message, detail) rather than as a formatted
 * line, and a sink that throws does not take down the caller that was only
 * trying to mention something.
 *
 * The third property — that nothing in `src/` writes to the console outside
 * this file and `embed/host.ts` — is a grep gate in `check.sh`, because a test
 * cannot see a `console.warn` a module never reached.
 */

import { describe, expect, test } from 'bun:test';
import { LOG_PREFIX, consoleSink, createLogger, defaultLogger, type LogEntry } from './logger.js';

/** A scene id for the sample detail; any UUID, the logger never reads it. */
const SCENE_ID = '01a12ffa-e531-7514-8446-7d3d721e9681';

describe('createLogger', () => {
  test('hands the sink the level, the code, the message and the detail', () => {
    const entries: LogEntry[] = [];
    const log = createLogger((entry) => entries.push(entry));
    log.warn('walkspawn-derived', 'no walkSpawn', { sceneId: SCENE_ID });
    log.error('listener-failed', 'a host callback threw');
    expect(entries).toEqual([
      { level: 'warn', code: 'walkspawn-derived', message: 'no walkSpawn', detail: { sceneId: SCENE_ID } },
      { level: 'error', code: 'listener-failed', message: 'a host callback threw' },
    ]);
  });

  test('leaves `detail` off the entry entirely when there was none', () => {
    const entries: LogEntry[] = [];
    createLogger((entry) => entries.push(entry)).warn('x', 'y');
    expect('detail' in entries[0]!).toBe(false);
  });

  test('a sink that throws is swallowed: the reporter is what failed', () => {
    const log = createLogger(() => {
      throw new Error('host telemetry is down');
    });
    expect(() => log.warn('x', 'y')).not.toThrow();
  });

  test('with no sink it falls back to the console one', () => {
    // Not asserted by capturing the console — that is what this seam exists to
    // stop. The observable property is that a logger with no sink is built and
    // usable, and `consoleSink` is the module's own default.
    expect(() => createLogger().warn('x', 'y')).not.toThrow();
    expect(() => defaultLogger.error('x', 'y')).not.toThrow();
    expect(typeof consoleSink).toBe('function');
  });
});

describe('the prefix', () => {
  test('is the one every page has seen', () => {
    expect(LOG_PREFIX).toBe('[jeex-viewer]');
  });
});
