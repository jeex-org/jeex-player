/**
 * Self-test for the library's version constant: it is a valid semver.
 *
 * `bunfig.toml`'s `[define]` deliberately substitutes a FIXED placeholder
 * (`0.0.0-test`) under `bun test`, not the real `package.json#version` — a
 * test-time constant that changed on every release bump would be a second
 * place that has to move in lockstep with the real one for no benefit. The
 * equality with `package.json#version` is a BUILD-time fact, so it is proven
 * where the real value is actually substituted: a Vite build, asserted by
 * `tests/e2e/scene-request.spec.ts` against `window.JeexViewer.VIEWER_VERSION`
 * on the built IIFE page.
 */

import { describe, expect, test } from 'bun:test';
import { VIEWER_VERSION } from './version.js';

describe('VIEWER_VERSION', () => {
  test('is a semver string', () => {
    expect(VIEWER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
