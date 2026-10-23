import { afterEach, describe, expect, test } from 'bun:test';
import { debugFlags } from './debug-flags.js';

const page = globalThis as { __JEEX_DEBUG_FLAGS__?: unknown };

afterEach(() => {
  delete page.__JEEX_DEBUG_FLAGS__;
});

describe('debugFlags', () => {
  test('every switch is off when the page set nothing', () => {
    expect(debugFlags()).toEqual({ noTransmission: false, noArm: false });
  });

  test("reads the page's global", () => {
    page.__JEEX_DEBUG_FLAGS__ = { noTransmission: true };
    expect(debugFlags()).toEqual({ noTransmission: true, noArm: false });
    page.__JEEX_DEBUG_FLAGS__ = { noArm: true };
    expect(debugFlags()).toEqual({ noTransmission: false, noArm: true });
  });

  test('a malformed global turns every switch off', () => {
    for (const source of [null, 'noArm', 1, [], { noArm: 'yes' }, { noTransmission: 1 }]) {
      expect(debugFlags(source), JSON.stringify(source)).toEqual({ noTransmission: false, noArm: false });
    }
  });

  test('unknown keys are ignored', () => {
    expect(debugFlags({ noArm: true, other: 1 })).toEqual({ noTransmission: false, noArm: true });
  });
});
