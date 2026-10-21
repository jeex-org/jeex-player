import { describe, expect, test } from 'bun:test';
import { ViewerLibError } from '../shared/errors.js';
import { codeOfViewerError, errorName, reportKey, reportOf } from './error-report.js';

const own = (url: string) => url.startsWith('https://cdn.example/jeex/');

function thrown(name: string, message: string, frames: string[]): Error {
  const error = new Error(message);
  error.name = name;
  error.stack = [`${name}: ${message}`, ...frames.map((frame) => `    at f (${frame})`)].join('\n');
  return error;
}

describe('reportOf', () => {
  test('an exception with an own frame is reported without its message', () => {
    const error = thrown('TypeError', 'cannot read x of https://site.example/?email=a@b.example', [
      'https://cdn.example/jeex/jeex-viewer.js:3:9',
    ]);
    const report = reportOf('exception', 'tour', error, own);
    expect(report).toEqual({
      code: 'exception',
      stage: 'tour',
      name: 'TypeError',
      frames: [{ file: 'jeex-viewer.js', line: 3, column: 9 }],
    });
    expect(JSON.stringify(report)).not.toContain('email');
    expect(JSON.stringify(report)).not.toContain('cannot read');
  });

  test('a multi-line message whose lines look like frames is never parsed', () => {
    const message = 'boom\n    at f (https://cdn.example/jeex/jeex-viewer.js:99:99)';
    const error = thrown('Error', message, ['https://cdn.example/jeex/jeex-viewer.js:1:2']);
    expect(reportOf('exception', 'runtime', error, own)?.frames).toEqual([{ file: 'jeex-viewer.js', line: 1, column: 2 }]);
  });

  test('an exception with no own frame is not reported', () => {
    const error = thrown('TypeError', 'site bug', ['https://site.example/app.js:1:1', 'chrome-extension://abc/x.js:2:2']);
    expect(reportOf('exception', 'runtime', error, own)).toBeNull();
    expect(reportOf('rejection', 'runtime', 'a string reason', own)).toBeNull();
  });

  test('a code the player detects itself carries no frames and needs none', () => {
    expect(reportOf('network', 'scene_load', new TypeError('Failed to fetch'), own)).toEqual({
      code: 'network',
      stage: 'scene_load',
      name: 'TypeError',
      frames: [],
    });
  });

  test('a free-text name is reported as Error', () => {
    expect(errorName(Object.assign(new Error('x'), { name: 'Payment for someone@example.org' }))).toBe('Error');
    expect(errorName('a string')).toBe('Error');
    expect(errorName(new RangeError('x'))).toBe('RangeError');
  });

  test('the dedupe key ignores the message', () => {
    const a = reportOf('exception', 'tour', thrown('TypeError', 'one', ['https://cdn.example/jeex/jeex-viewer.js:3:9']), own)!;
    const b = reportOf('exception', 'tour', thrown('TypeError', 'two', ['https://cdn.example/jeex/jeex-viewer.js:3:9']), own)!;
    expect(reportKey(a)).toBe(reportKey(b));
  });
});

describe('codeOfViewerError', () => {
  test('host mistakes are not the player’s errors', () => {
    for (const code of ['no-scene-source', 'bad-params', 'not-ready', 'disposed'] as const)
      expect(codeOfViewerError(code, undefined)).toBeNull();
  });

  test('load failures by what the loader recorded', () => {
    expect(codeOfViewerError('scene-load', new TypeError('Failed to fetch'))).toBe('network');
    expect(codeOfViewerError('scene-load', new ViewerLibError('scene-load', 'x', { detail: { status: 404, url: 'u' } }))).toBe('network');
    expect(codeOfViewerError('scene-load', new ViewerLibError('scene-load', 'x', { detail: { url: 'u', limit: 1 } }))).toBe('size_limit');
    expect(codeOfViewerError('scene-load', new ViewerLibError('scene-load', 'x', { detail: { url: 'u', reason: 'glb-parse' } }))).toBe(
      'model_format',
    );
    expect(
      codeOfViewerError(
        'scene-load',
        new ViewerLibError('scene-load', 'x', { detail: { status: 200, url: 'u', contentType: 'text/html' } }),
      ),
    ).toBe('scene_format');
  });

  test('the rest map one to one', () => {
    expect(codeOfViewerError('scene-invalid', undefined)).toBe('scene_format');
    expect(codeOfViewerError('project-invalid', undefined)).toBe('manifest_format');
    expect(codeOfViewerError('webgl-unavailable', undefined)).toBe('webgl_unavailable');
    expect(codeOfViewerError('context-lost', undefined)).toBe('context_lost');
    expect(codeOfViewerError('model-external-resource', undefined)).toBe('model_format');
    expect(codeOfViewerError('internal', undefined)).toBe('exception');
  });
});
