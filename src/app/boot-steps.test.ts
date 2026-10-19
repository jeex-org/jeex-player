/**
 * The boot table. It exists so the loading bar's story can be read in one
 * place, which is only true while the steps stay in order and end at 100.
 */

import { describe, expect, test } from 'bun:test';
import { BOOT_STEPS } from './boot-steps.js';
import { isMessageKey } from '../ui/messages.js';

describe('BOOT_STEPS', () => {
  const steps = Object.values(BOOT_STEPS);

  test('runs forwards: every step is further along than the one before it', () => {
    const percents = steps.map((step) => step.percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(new Set(percents).size).toBe(percents.length);
  });

  test('starts inside the bar and ends at the end of it', () => {
    expect(steps[0]!.percent).toBeGreaterThan(0);
    expect(steps.at(-1)!.percent).toBe(100);
  });

  test('every label is a key the catalogue actually has', () => {
    for (const step of steps) expect([step.label, isMessageKey(step.label)]).toEqual([step.label, true]);
  });
});
