/**
 * Self-test for the listener-lifetime gate, against fixture
 * source strings rather than the real tree — `bun run scripts/listener-policy.ts`
 * (invoked by `check.sh`) is what proves the real tree is clean.
 */

import { describe, expect, test } from 'bun:test';
import { ALLOWLIST, applyAllowlist, scanSource } from './listener-policy.js';

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
  test('an allowlisted file:line is filtered out and reported separately', () => {
    const violations = [
      { file: 'src/fixtures/stubs.ts', line: 103, reason: 'options argument "{ once: true }" has no { signal } reachable in one hop' },
    ];
    const { real, allowlisted } = applyAllowlist(violations);
    expect(real).toEqual([]);
    expect(allowlisted).toHaveLength(1);
    expect(allowlisted[0]?.reason.length).toBeGreaterThan(0);
  });

  test('a violation at a different line in an allowlisted file is NOT covered', () => {
    const violations = [{ file: 'src/fixtures/stubs.ts', line: 99, reason: 'no { signal }' }];
    const { real, allowlisted } = applyAllowlist(violations);
    expect(real).toHaveLength(1);
    expect(allowlisted).toEqual([]);
  });

  test('every allowlist entry carries a non-empty reason and a date', () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('the real tree', () => {
  test('src/fixtures/stubs.ts:103 is the ONLY allowlist entry — a shrinking-residue check', () => {
    expect(ALLOWLIST).toHaveLength(1);
    expect(ALLOWLIST[0]).toMatchObject({ file: 'src/fixtures/stubs.ts', line: 103 });
  });
});
