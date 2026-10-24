/**
 * The light temperature as a host and the settings panel drive it: one value,
 * validated at the handle, reported once per change with its source, mirrored
 * into the panel, and applied to the live scene, later roots and the walk's
 * probes.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { ViewerLibError } from '../shared/errors.js';
import { tagArtificialLight } from '../assets/artificial-light.js';
import { LightTemperatureControl, type LightTemperatureChange } from './light-temperature-control.js';

function setup(initial: number | null = null) {
  const scene = new THREE.Scene();
  const lamp = tagArtificialLight(new THREE.PointLight('#ffd9a4', 2));
  scene.add(lamp);
  const original = lamp.color.toArray();
  const events: LightTemperatureChange[] = [];
  const panel: (number | null)[] = [];
  let draws = 0;
  let relights = 0;
  const control = new LightTemperatureControl({
    initial,
    scene: () => scene,
    invalidate: () => (draws += 1),
    relit: () => (relights += 1),
    emit: (change) => events.push(change),
    reflect: (value) => panel.push(value),
  });
  return { scene, lamp, original, control, events, panel, draws: () => draws, relights: () => relights };
}

describe('LightTemperatureControl', () => {
  test('starts at the mount option, «Original» by default', () => {
    expect(setup().control.value).toBeNull();
    expect(setup(3000).control.value).toBe(3000);
  });

  test('a host change tints, redraws, relights the walk, mirrors the panel and reports host as the source', () => {
    const { control, lamp, original, events, panel, draws, relights } = setup();
    control.set(5000, 'host');
    expect(control.value).toBe(5000);
    expect(lamp.color.toArray()).not.toEqual(original);
    expect(draws()).toBe(1);
    expect(relights()).toBe(1);
    expect(panel).toEqual([5000]);
    expect(events).toEqual([{ temperature: 5000, source: 'host' }]);
  });

  test('a panel change reports panel; «Original» restores the colour exactly', () => {
    const { control, lamp, original, events } = setup(4000);
    control.set(null, 'panel');
    expect(lamp.color.toArray()).toEqual(original);
    expect(events).toEqual([{ temperature: null, source: 'panel' }]);
  });

  test('an unchanged value does nothing at all', () => {
    const { control, events, draws, relights, panel } = setup(3000);
    control.set(3000, 'host');
    expect([events.length, draws(), relights(), panel.length]).toEqual([0, 0, 0, 0]);
  });

  test('an invalid value keeps the current one and throws bad-params naming lightTemperature', () => {
    const { control, events } = setup(5000);
    for (const bad of [2000, 7000, 3050, Number.NaN, '3000', undefined, {}]) {
      let thrown: unknown;
      try {
        control.set(bad, 'host');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ViewerLibError);
      expect((thrown as ViewerLibError).code).toBe('bad-params');
      expect((thrown as ViewerLibError).path).toBe('lightTemperature');
    }
    expect(control.value).toBe(5000);
    expect(events).toEqual([]);
  });

  test('a root built later takes the current value', () => {
    const { control } = setup(2700);
    const root = new THREE.Group();
    const lamp = tagArtificialLight(new THREE.PointLight('#ffd9a4', 2));
    root.add(lamp);
    const before = lamp.color.clone();
    control.apply(root);
    expect(lamp.color.r / lamp.color.b).toBeGreaterThan(before.r / before.b);
  });
});
