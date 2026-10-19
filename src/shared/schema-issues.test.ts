import { describe, expect, test } from 'bun:test';
import { badParams, firstIssue, issueDetail, issuePath, MAX_REPORTED_ISSUES, type SchemaIssue } from './schema-issues.js';

const issue = (path: readonly (string | number)[], message = 'Invalid input'): SchemaIssue => ({ path, message });

describe('issuePath', () => {
  test('the root is the empty string', () => {
    expect(issuePath(issue([]))).toBe('');
  });

  test('spells an index as a bracket and a key as a dot', () => {
    expect(issuePath(issue(['walls', 3, 'openings', 1, 'head']))).toBe('walls[3].openings[1].head');
  });

  test('spells the paths the scene validator already publishes', () => {
    expect(issuePath(issue(['units']))).toBe('units');
    expect(issuePath(issue(['storey', 'elevation']))).toBe('storey.elevation');
    expect(issuePath(issue(['storey', 'name']))).toBe('storey.name');
  });

  test('a leading index needs no dot before its bracket', () => {
    expect(issuePath(issue([0, 'x']))).toBe('[0].x');
  });
});

describe('firstIssue', () => {
  test('is the first in declaration order, which is the order a schema reports', () => {
    const found = firstIssue([issue(['schemaVersion']), issue(['nodes'])]);
    expect(found?.path).toEqual(['schemaVersion']);
  });

  test('is undefined when nothing was found', () => {
    expect(firstIssue([])).toBeUndefined();
  });
});

describe('issueDetail', () => {
  test('caps the list a hostile document can grow and keeps the true total', () => {
    const many = Array.from({ length: 25 }, (_, index) => issue(['walls', index, 'thickness'], `bad ${index}`));
    const detail = issueDetail(many);
    expect(detail.issues.length).toBe(MAX_REPORTED_ISSUES);
    expect(detail.total).toBe(25);
    expect(detail.issues[0]).toEqual({ path: 'walls[0].thickness', message: 'bad 0' });
    expect(detail.issues[MAX_REPORTED_ISSUES - 1]).toEqual({ path: 'walls[9].thickness', message: 'bad 9' });
  });

  test('reports a short list whole', () => {
    const detail = issueDetail([issue(['units'], "Unsupported unit 'ft'")]);
    expect(detail).toEqual({ issues: [{ path: 'units', message: "Unsupported unit 'ft'" }], total: 1 });
  });

  test('the cap is a real cap', () => {
    expect(MAX_REPORTED_ISSUES).toBe(10);
  });
});

describe('badParams', () => {
  test('speaks for the first issue: code, path, sentence and capped detail', () => {
    const error = badParams('importScene', [issue(['storey', 'elevation'], 'Invalid input'), issue(['nodes'], 'Too small')]);
    expect(error.code).toBe('bad-params');
    expect(error.path).toBe('storey.elevation');
    expect(error.message).toBe('importScene: storey.elevation Invalid input');
    expect(error.detail).toEqual({
      issues: [
        { path: 'storey.elevation', message: 'Invalid input' },
        { path: 'nodes', message: 'Too small' },
      ],
      total: 2,
    });
  });

  test('names the seam alone when the issue is at the root', () => {
    const error = badParams('importScene', [issue([], 'Scene must be an object')]);
    expect(error.path).toBe('');
    expect(error.message).toBe('importScene: Scene must be an object');
  });

  /**
   * A refusal with nothing to refuse is the CALLER's bug, not the document's:
   * it must not throw from inside an error factory, and it must not claim the
   * document was bad.
   */
  test('an empty issue list is the caller getting it wrong, reported as internal', () => {
    const error = badParams('importScene', []);
    expect(error.code).toBe('internal');
    expect(error.detail).toEqual({ issues: [], total: 0 });
    expect(error.message).toContain('importScene');
  });
});
