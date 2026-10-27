/**
 * The slot vocabulary, with no document in sight.
 *
 * Everything `HostSlots` does needs a DOM and is proved in
 * `tests/component/host-slots.test.ts`. What CAN be checked here is the part a
 * browser would never catch: that the slot names are a CLOSED set which does
 * not collide with the shell's own names, that the attribute is its own, and
 * that the refusal a host can see carries the code and the field it promises.
 */

import { describe, expect, test } from 'bun:test';
import {
  BOTTOM_LEFT_CLAIMED_ATTRIBUTE,
  BOTTOM_RIGHT_CLAIMED_ATTRIBUTE,
  MissingSlotError,
  SLOT_ATTRIBUTE,
  SLOT_NAMES,
} from './host-slots.js';
import { OVERLAY_NAMES, SHELL_ATTRIBUTE, SHELL_NAMES } from './viewer-shell.js';
import { ViewerLibError } from '../shared/errors.js';
import { TYPING_SELECTOR } from '../camera/camera-input.js';

describe('SLOT_NAMES', () => {
  test('is the nine slot names, in reading order', () => {
    expect([...SLOT_NAMES]).toEqual([
      'top-left',
      'top-center',
      'top-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
      'modal-root',
      'selection-anchor',
      'underlay',
    ]);
  });

  test('holds no duplicate', () => {
    expect(new Set(SLOT_NAMES).size).toBe(SLOT_NAMES.length);
  });

  /**
   * Two closed sets over the same root: a name that means a box for
   * the HOST must never also mean a node of the viewer's own shell, or
   * `byName` and `get` would answer for each other's nodes.
   */
  test('shares no name with SHELL_NAMES', () => {
    expect(new Set([...SLOT_NAMES, ...SHELL_NAMES]).size).toBe(SLOT_NAMES.length + SHELL_NAMES.length);
  });

  test('shares no name with the overlays that stamp their own', () => {
    const overlays = new Set<string>(Object.values(OVERLAY_NAMES));
    expect(SLOT_NAMES.filter((name) => overlays.has(name))).toEqual([]);
  });
});

describe('SLOT_ATTRIBUTE', () => {
  test('is `data-jeex-slot`', () => {
    expect(SLOT_ATTRIBUTE).toBe('data-jeex-slot');
  });

  /**
   * A DIFFERENT attribute from the shell's, so `[data-jeex]` selectors of the
   * chrome and `[data-jeex-slot]` selectors of the host's boxes never match
   * each other's nodes. (`data-jeex-slot` does not match `[data-jeex]`:
   * attribute selectors compare whole names.)
   */
  test('is not the shell attribute', () => {
    expect(SLOT_ATTRIBUTE).not.toBe(SHELL_ATTRIBUTE);
  });
});

describe('the bottom-corner claim attributes', () => {
  test('are their own two names, distinct from SLOT_ATTRIBUTE and each other', () => {
    expect(BOTTOM_RIGHT_CLAIMED_ATTRIBUTE).toBe('data-jeex-slot-bottom-right');
    expect(BOTTOM_LEFT_CLAIMED_ATTRIBUTE).toBe('data-jeex-slot-bottom-left');
    expect(BOTTOM_RIGHT_CLAIMED_ATTRIBUTE).not.toBe(BOTTOM_LEFT_CLAIMED_ATTRIBUTE);
    expect(BOTTOM_RIGHT_CLAIMED_ATTRIBUTE).not.toBe(SLOT_ATTRIBUTE);
  });
});

/**
 * `camera` sits BELOW `ui` in the layer order (`.dependency-cruiser.cjs`),
 * so `camera-input.ts` cannot import `SLOT_ATTRIBUTE` and keeps a literal copy
 * of it inside its own selector. This is the test that stops the two drifting —
 * it lives here because tests are exempt from the layer rules.
 */
describe('agreement with the camera layer', () => {
  test('TYPING_SELECTOR covers the slot attribute', () => {
    expect(TYPING_SELECTOR).toContain(`[${SLOT_ATTRIBUTE}]`);
  });
});

describe('MissingSlotError', () => {
  test('is a coded library error naming the slot that was not asked for', () => {
    const error = new MissingSlotError('top-left');
    expect(error).toBeInstanceOf(ViewerLibError);
    expect(error.code).toBe('bad-params');
    expect(error.name).toBe('MissingSlotError');
    expect(error.slotName).toBe('top-left');
    expect(error.message).toContain('top-left');
  });

  test('carries the slot in `detail`, so a logger sees it without parsing the message', () => {
    expect(new MissingSlotError('modal-root').detail).toEqual({ slotName: 'modal-root' });
  });
});
