import { describe, expect, test } from 'bun:test';
import {
  MAX_PROJECT_BYTES,
  MAX_PROJECT_TEXTURE_BYTES,
  MAX_PROJECT_TEXTURE_FILES,
  MAX_TEXTURE_FILE_BYTES,
  MAX_TEXTURE_PARALLEL,
  TEXTURE_FETCH_DEADLINE_MS,
} from './limits.js';

/**
 * The texture limits are read BY NAME outside this repository: a catalogue
 * bake checks its output against the same three numbers before it writes a
 * manifest. The names and the values are the contract, so both are pinned.
 */
describe('texture limits', () => {
  test('the three constants carry the agreed values', () => {
    expect({ MAX_TEXTURE_FILE_BYTES, MAX_PROJECT_TEXTURE_BYTES, MAX_PROJECT_TEXTURE_FILES }).toEqual({
      MAX_TEXTURE_FILE_BYTES: 2_097_152,
      MAX_PROJECT_TEXTURE_BYTES: 50_331_648,
      MAX_PROJECT_TEXTURE_FILES: 512,
    });
  });

  test('one texture job has thirty seconds, from resolving its URL to its last byte, and four run at once', () => {
    expect(TEXTURE_FETCH_DEADLINE_MS).toBe(30_000);
    expect(MAX_TEXTURE_PARALLEL).toBe(4);
  });

  test('the model budget stays a separate number', () => {
    expect(MAX_PROJECT_BYTES).toBe(96 * 1024 * 1024);
  });
});
