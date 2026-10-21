import { describe, expect, test } from 'bun:test';

import { createSession, resolveViewerUrl, withViewerOptions } from './session.js';

/**
 * `assert` is the one failure path in the browser-check runner that needs no
 * browser to exercise: it is a synchronous throw, and it is what every area
 * (`checkBoot`, `checkDoors`, ...) calls when a measured value is wrong. A
 * check that never throws on a false condition would silently pass no
 * matter what the page did — the bug class this file guards against is a
 * failure not reaching the process exit code, and it starts here: if
 * `assert` does not throw, `browser-check.ts`'s `catch` never runs and
 * `process.exitCode` never gets set.
 */
describe('assert', () => {
  test('throws on a false condition, with the message', () => {
    const session = createSession('http://example.invalid/');
    expect(() => session.assert(false, 'the thing should be true')).toThrow('Browser check failed: the thing should be true');
  });

  test('does not throw on a true condition', () => {
    const session = createSession('http://example.invalid/');
    expect(() => session.assert(true, 'unreachable')).not.toThrow();
  });
});

/**
 * `VIEWER_URL` is free-form: the documented examples carry no query
 * (`http://localhost:3703/`), but a run that wants the debug surface passes
 * `http://127.0.0.1:3708/?debug=1`, and `a11y.ts` has to add `view=tour` and
 * `motion=reduced` to whatever it was given.
 *
 * Composing that with a bare `?` produced `…/?debug=1?view=tour&motion=reduced`,
 * which `URLSearchParams` reads as `debug="1?view=tour"` and `motion="reduced"`
 * — `view` silently gone. The tour is then not engaged, the reduced-motion
 * assertion sees `ready` instead of `paused`, and the check blames the viewer
 * for a URL the check itself built.
 */
describe('withViewerOptions', () => {
  test('adds options to a bare url', () => {
    expect(withViewerOptions('http://127.0.0.1:3708/', { view: 'tour', motion: 'reduced' })).toBe(
      'http://127.0.0.1:3708/?view=tour&motion=reduced',
    );
  });

  test('KEEPS a query the url already carries instead of orphaning it behind a second ?', () => {
    const composed = withViewerOptions('http://127.0.0.1:3708/?debug=1', { view: 'tour', motion: 'reduced' });
    const params = new URL(composed).searchParams;
    expect(params.get('debug')).toBe('1');
    expect(params.get('view')).toBe('tour');
    expect(params.get('motion')).toBe('reduced');
    expect(composed).not.toContain('?debug=1?');
  });

  test('an option replaces the same option already in the url, rather than appearing twice', () => {
    const composed = withViewerOptions('http://127.0.0.1:3708/?view=orbit', { view: 'tour' });
    const params = new URL(composed).searchParams;
    expect(params.getAll('view')).toEqual(['tour']);
  });

  test('leaves the hash and the path alone', () => {
    expect(withViewerOptions('http://127.0.0.1:3708/sub/page#frag', { view: 'tour' })).toBe(
      'http://127.0.0.1:3708/sub/page?view=tour#frag',
    );
  });

  // The module's convention for bad operator input is one actionable line
  // (`requireAgentBrowser`'s CLI probe),
  // not a raw `TypeError: Invalid URL` from the middle of an area check.
  test('a VIEWER_URL that is not a URL fails naming itself, not with a bare TypeError', () => {
    expect(() => withViewerOptions('127.0.0.1:3708', { view: 'tour' })).toThrow(
      'browser-check: VIEWER_URL is not a usable URL: "127.0.0.1:3708"',
    );
  });
});

describe('no telemetry from the check', () => {
  test('a scenario query keeps analytics=off, and the default page carries it', () => {
    const session = createSession('http://example.invalid/');
    expect(new URL(session.withQuery('?view=tour')).searchParams.get('analytics')).toBe('off');
    expect(new URL(session.withQuery('?view=tour')).searchParams.get('view')).toBe('tour');
    expect(new URL(resolveViewerUrl()).searchParams.get('analytics')).toBe('off');
  });
});
