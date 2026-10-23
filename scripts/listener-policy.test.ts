/**
 * Self-test for the listener-lifetime gate, against fixture
 * source strings rather than the real tree — `bun run scripts/listener-policy.ts`
 * (invoked by `check.sh`) is what proves the real tree is clean.
 */

import { describe, expect, test } from 'bun:test';
import { ALLOWLIST, applyAllowlist, scanMarkers, scanSource, type AllowlistEntry } from './listener-policy.js';

describe('scanSource: passing shapes', () => {
  test('an inline object literal naming signal passes', () => {
    const source = `
      export class Widget {
        bind(target: HTMLElement, signal: AbortSignal): void {
          target.addEventListener('click', this.onClick, { signal });
        }
      }
    `;
    expect(scanSource('src/widget.ts', source)).toEqual([]);
  });

  test('an inline object literal with signal alongside other options passes', () => {
    const source = `
      canvas.addEventListener('wheel', this.onWheel, {
        passive: false,
        signal: this.listeners.signal,
      });
    `;
    expect(scanSource('src/widget.ts', source)).toEqual([]);
  });

  test('an identifier bound to an object literal naming signal passes (identifier-bound)', () => {
    const source = `
      export class Widget {
        bind(): void {
          const listener: AddEventListenerOptions = { signal: this.listeners.signal };
          this.button.addEventListener('click', this.onClick, listener);
          this.other.addEventListener('keydown', this.onKey, listener);
        }
      }
    `;
    expect(scanSource('src/widget.ts', source)).toEqual([]);
  });

  test('an identifier bound to a helper call that carries signal passes (the listenerOptions(signal) pattern)', () => {
    const source = `
      export class Widget {
        bind(signal?: AbortSignal): void {
          const listener = listenerOptions(signal);
          this.button.addEventListener('click', this.onClick, listener);
        }
      }
    `;
    expect(scanSource('src/widget.ts', source)).toEqual([]);
  });

  test('a multi-line call whose options object names signal passes', () => {
    const source = `
      this.canvas.ownerDocument.addEventListener(
        'visibilitychange',
        () => {
          if (this.isVisible()) this.resume();
          else this.pause();
        },
        { signal: this.listeners.signal },
      );
    `;
    expect(scanSource('src/widget.ts', source)).toEqual([]);
  });

  test('a mention inside a block comment is not a call site', () => {
    const source = `
      /**
       * Types \`element.addEventListener('jeex-ready', …)\` with no options at all.
       */
      type EventMap = { 'jeex-ready': CustomEvent };
    `;
    expect(scanSource('src/widget.ts', source)).toEqual([]);
  });

  test('an apostrophe in a line comment does not open a string that swallows the options argument', () => {
    const source = `
      const listener = listenerOptions(this.deps.signal);
      root.addEventListener(
        'focusout',
        () => {
          // the root's own focus
          check();
        },
        listener,
      );
      later(() => {
        // the toolbar's button
      });
    `;
    expect(scanSource('src/widget.ts', source)).toEqual([]);
  });

  test('a // inside a string is not a line comment', () => {
    const source = `
      const url = 'https://example.org/';
      button.addEventListener('click', () => open(url), { signal });
    `;
    expect(scanSource('src/widget.ts', source)).toEqual([]);
  });

  test('a bare method declaration (no leading dot) is not a call site', () => {
    const source = `
      export type FakeTarget = {
        addEventListener(type: string, handler: Listener, options?: { signal?: AbortSignal }): void;
      };
    `;
    expect(scanSource('src/widget.ts', source)).toEqual([]);
  });
});

describe('scanSource: failing shapes', () => {
  test('no options argument at all fails', () => {
    const source = `target.addEventListener('click', this.onClick);`;
    const violations = scanSource('src/widget.ts', source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: 'src/widget.ts', line: 1 });
    expect(violations[0]?.reason).toContain('no options argument');
  });

  test('an options object without signal fails', () => {
    const source = `target.addEventListener('click', this.onClick, { once: true });`;
    const violations = scanSource('src/widget.ts', source);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain('no { signal }');
  });

  test('an identifier bound to a const with no signal fails', () => {
    const source = `
      const listener = { once: true };
      target.addEventListener('click', this.onClick, listener);
    `;
    const violations = scanSource('src/widget.ts', source);
    expect(violations).toHaveLength(1);
  });

  test('an identifier with no resolvable declaration in the file fails', () => {
    const source = `target.addEventListener('click', this.onClick, options);`;
    const violations = scanSource('src/widget.ts', source);
    expect(violations).toHaveLength(1);
  });

  test('the line number points at the call, not the file start', () => {
    const source = `
      // padding
      // more padding
      target.addEventListener('click', this.onClick, { once: true });
    `;
    const violations = scanSource('src/widget.ts', source);
    expect(violations[0]?.line).toBe(4);
  });
});

describe('applyAllowlist', () => {
  const FILE = 'src/widget.ts';
  const ENTRY: AllowlistEntry = {
    file: FILE,
    marker: 'self-abort',
    date: '2026-10-22',
    reason: 'a reason long enough to explain the call',
  };

  /** Scans a fixture and applies a one-entry list to it, the way the script runs over the tree. */
  function run(source: string, allowlist: readonly AllowlistEntry[] = [ENTRY]) {
    return applyAllowlist(scanSource(FILE, source), scanMarkers(FILE, source), new Set([FILE]), allowlist);
  }

  test('a marker on the line above the call, named by an entry, covers it', () => {
    const { real, allowlisted, problems } = run(`
      // listener-policy: allow self-abort
      signal.addEventListener('abort', onAbort, { once: true });
    `);
    expect(real).toEqual([]);
    expect(problems).toEqual([]);
    expect(allowlisted).toEqual([ENTRY]);
  });

  test('a marker on the call line itself covers it', () => {
    const { real, problems } = run(`
      signal.addEventListener('abort', onAbort, { once: true }); // listener-policy: allow self-abort
    `);
    expect(real).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('lines added above the call do not break the entry — it is matched by marker, not line', () => {
    const { real, problems } = run(`
      import { a } from './a.js';
      import { b } from './b.js';
      import { c } from './c.js';
      // listener-policy: allow self-abort
      signal.addEventListener('abort', onAbort, { once: true });
    `);
    expect(real).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('another failing call in the same file is NOT covered by that marker', () => {
    const { real } = run(`
      // listener-policy: allow self-abort
      signal.addEventListener('abort', onAbort, { once: true });
      target.addEventListener('click', onClick, { once: true });
    `);
    expect(real).toHaveLength(1);
    expect(real[0]?.line).toBe(4);
  });

  test('a marker at the end of a call line does not reach the call on the next line', () => {
    const { real } = run(`
      signal.addEventListener('abort', onAbort, { once: true }); // listener-policy: allow self-abort
      target.addEventListener('click', onClick, { once: true });
    `);
    expect(real).toHaveLength(1);
    expect(real[0]?.line).toBe(3);
  });

  test('a marker exempts one call: a second failing call on the covered line stays real and is reported', () => {
    const { real, allowlisted, problems } = run(`
      // listener-policy: allow self-abort
      signal.addEventListener('abort', onAbort, { once: true }); target.addEventListener('click', onClick, { once: true });
    `);
    expect(allowlisted).toEqual([ENTRY]);
    expect(real).toHaveLength(1);
    expect(problems).toEqual([{ file: FILE, line: 2, reason: expect.stringContaining('covers more than one') }]);
  });

  test('marker text inside a string or template literal is not a marker', () => {
    const { real } = run(`
      const help = '// listener-policy: allow self-abort';
      signal.addEventListener('abort', onAbort, { once: true });
      target.addEventListener('// listener-policy: allow self-abort', onClick, { once: true });
    `);
    expect(real).toHaveLength(2);
  });

  test('a marker two lines above the call does not reach it', () => {
    const { real, problems } = run(`
      // listener-policy: allow self-abort

      signal.addEventListener('abort', onAbort, { once: true });
    `);
    expect(real).toHaveLength(1);
    expect(problems.map((problem) => problem.reason)).toEqual([expect.stringContaining('sits on no addEventListener call')]);
  });

  test('a marker with no entry fails, and does not exempt its call', () => {
    const { real, problems } = run(
      `
      // listener-policy: allow unexplained
      signal.addEventListener('abort', onAbort, { once: true });
    `,
      [],
    );
    expect(real).toHaveLength(1);
    expect(problems).toEqual([{ file: FILE, line: 2, reason: expect.stringContaining('has no ALLOWLIST entry') }]);
  });

  test('an entry whose marker is not in its file fails as stale', () => {
    const { problems } = run(`target.addEventListener('click', onClick, { signal });`);
    expect(problems).toEqual([{ file: FILE, line: null, reason: expect.stringContaining('has no allow marker') }]);
  });

  test('an entry for a file this run did not scan is not reported', () => {
    const { problems } = applyAllowlist([], [], new Set([FILE]), [{ ...ENTRY, file: 'src/elsewhere.ts' }]);
    expect(problems).toEqual([]);
  });

  test('a marker on a call that already passes fails as unneeded', () => {
    const { problems } = run(`
      // listener-policy: allow self-abort
      target.addEventListener('click', onClick, { signal });
    `);
    expect(problems.map((problem) => problem.reason)).toEqual([expect.stringContaining('sits on no addEventListener call')]);
  });

  test('a marker id repeated in one file fails', () => {
    const { problems } = run(`
      // listener-policy: allow self-abort
      signal.addEventListener('abort', onAbort, { once: true });
      // listener-policy: allow self-abort
      other.addEventListener('abort', onAbort, { once: true });
    `);
    expect(problems).toContainEqual({ file: FILE, line: 4, reason: expect.stringContaining('unique per file') });
  });

  test('every allowlist entry carries a non-empty reason, a date and a marker id', () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.marker).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('the real tree', () => {
  test('the fake canvas abort bookkeeping in src/fixtures/stubs.ts is the ONLY allowlist entry — a shrinking-residue check', () => {
    expect(ALLOWLIST).toHaveLength(1);
    expect(ALLOWLIST[0]).toMatchObject({ file: 'src/fixtures/stubs.ts', marker: 'fake-canvas-abort-bookkeeping' });
  });
});
