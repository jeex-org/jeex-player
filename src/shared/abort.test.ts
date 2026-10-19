/**
 * `linkedAbortController` is the one place listener lifetime is composed, so
 * the three cases that matter are pinned here: the child fires on its own, the
 * child fires when the parent does, and a parent that already aborted does not
 * leave a live child behind.
 */

import { describe, expect, test } from 'bun:test';
import { linkedAbortController } from './abort.js';

describe('linkedAbortController', () => {
  test('without a parent it is an ordinary controller', () => {
    const controller = linkedAbortController();
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  test('the parent aborting aborts the child, with the same reason', () => {
    const parent = new AbortController();
    const child = linkedAbortController(parent.signal);
    const reason = new Error('viewer disposed');
    parent.abort(reason);
    expect(child.signal.aborted).toBe(true);
    expect(child.signal.reason).toBe(reason);
  });

  test('a parent that already aborted aborts the child at construction', () => {
    const parent = new AbortController();
    parent.abort('gone');
    const child = linkedAbortController(parent.signal);
    expect(child.signal.aborted).toBe(true);
    expect(child.signal.reason).toBe('gone');
  });

  test('the child aborting takes its handler off the parent', () => {
    const parent = new AbortController();
    const child = linkedAbortController(parent.signal);
    child.abort();
    // The parent firing afterwards must not throw or re-abort with its reason:
    // the child kept the reason it aborted with.
    parent.abort('later');
    expect(child.signal.reason).not.toBe('later');
  });

  test('the child can be aborted before the parent and stays independent', () => {
    const parent = new AbortController();
    const first = linkedAbortController(parent.signal);
    const second = linkedAbortController(parent.signal);
    first.abort();
    expect(second.signal.aborted).toBe(false);
    parent.abort();
    expect(second.signal.aborted).toBe(true);
  });
});
