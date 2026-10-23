/**
 * The settings panel's decisions without a DOM: where the slider rests,
 * what a slider position means, the read-out in every state, and which key
 * closes the panel. The DOM half is `tests/component/settings-panel.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { createMessages } from './messages.js';
import { SLIDER_REST_K, sliderPosition, temperatureText, temperatureTone, valueFromSlider } from './settings-panel.js';

const en = createMessages('en');

describe('the temperature slider', () => {
  test('rests at 4000 K while «Original», and on the value otherwise', () => {
    expect(SLIDER_REST_K).toBe(4000);
    expect(sliderPosition(null)).toBe('4000');
    expect(sliderPosition(2700)).toBe('2700');
  });

  test('the first adjustment from «Original» is a temperature one step from the rest: it leaves «Original»', () => {
    expect(valueFromSlider('4100')).toBe(4100);
    expect(valueFromSlider('3900')).toBe(3900);
    // A position the range input itself would never give is no temperature.
    expect(valueFromSlider('3950')).toBeNull();
    expect(valueFromSlider('')).toBeNull();
  });
});

describe('the read-out', () => {
  test('says «Original», or the kelvin and the tone', () => {
    expect(temperatureText(null, en)).toBe('Original');
    expect(temperatureText(3000, en)).toBe('3000 K · warm');
    expect(temperatureText(4000, en)).toBe('4000 K · neutral');
    expect(temperatureText(6500, en)).toBe('6500 K · cool');
  });

  test('follows the locale', () => {
    expect(temperatureText(null, createMessages('de'))).toBe('Original');
    expect(temperatureText(3000, createMessages('ru'))).toBe('3000 К · тёплая');
  });

  test('the tone bands: warm to 3300 K, neutral to 4600 K, cool above', () => {
    expect([2700, 3300, 3400, 4600, 4700, 6500].map((kelvin) => temperatureTone(kelvin))).toEqual([
      'warm',
      'warm',
      'neutral',
      'neutral',
      'cool',
      'cool',
    ]);
  });
});
