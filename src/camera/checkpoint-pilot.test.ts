/**
 * The look-through pilot: it holds the camera's own height over the walk
 * rig's eye, lifts with E/Q inside the ceiling band, ends itself with Enter
 * (keep) or Esc (cancel), and hands back the eye it ended at.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { CheckpointPilot } from './checkpoint-pilot.js';

/** A key target that runs `capture: true` listeners first, as the DOM does at the target, and stops on `stopImmediatePropagation`. */
class FakeKeys {
  private readonly listeners: Array<{ listener: (event: unknown) => void; capture: boolean }> = [];
  addEventListener(_type: string, listener: (event: unknown) => void, options?: boolean | AddEventListenerOptions): void {
    this.listeners.push({ listener, capture: typeof options === 'boolean' ? options : options?.capture === true });
  }
  removeEventListener(_type: string, listener: (event: unknown) => void): void {
    const index = this.listeners.findIndex((entry) => entry.listener === listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }
  press(key: string): boolean {
    let claimed = false;
    const ordered = [...this.listeners.filter((entry) => entry.capture), ...this.listeners.filter((entry) => !entry.capture)];
    for (const { listener } of ordered) {
      if (claimed) break;
      listener({
        key,
        preventDefault: () => {},
        stopImmediatePropagation: () => {
          claimed = true;
        },
      });
    }
    return claimed;
  }
}

/** The id of the camera the pilot looks through. */
const CAM_ID = '01a12ffa-7378-75a4-a919-9ca4fd80f2be';

function pilot(): { pilot: CheckpointPilot; camera: THREE.PerspectiveCamera; keys: FakeKeys; ends: boolean[] } {
  const camera = new THREE.PerspectiveCamera();
  const keys = new FakeKeys();
  const ends: boolean[] = [];
  return {
    pilot: new CheckpointPilot({ camera, keys: keys as unknown as HTMLElement, onKeyEnd: (commit) => ends.push(commit) }),
    camera,
    keys,
    ends,
  };
}

describe('CheckpointPilot', () => {
  test('holds its height over whatever the walk rig did this frame', () => {
    const { pilot: p, camera } = pilot();
    p.begin(CAM_ID, 1.1, 3, 4);
    camera.position.set(2, 1.65, 3);
    p.update();
    expect(camera.position.y).toBe(1.1);
  });

  test('E raises, Q lowers, inside the floor band and under the ceiling', () => {
    const { pilot: p, keys } = pilot();
    p.begin(CAM_ID, 1.5, 2.4, 0);
    expect(keys.press('e')).toBe(true);
    expect(p.height).toBeCloseTo(1.55, 9);
    for (let press = 0; press < 40; press += 1) keys.press('e');
    expect(p.height).toBeCloseTo(2.2, 9);
    for (let press = 0; press < 80; press += 1) keys.press('q');
    expect(p.height).toBeCloseTo(0.3, 9);
  });

  test('Enter keeps, Esc cancels; keys are left alone outside a look-through', () => {
    const { pilot: p, keys, ends } = pilot();
    expect(keys.press('Enter')).toBe(false);
    p.begin(CAM_ID, 1.5, 3, 0);
    keys.press('Enter');
    keys.press('Escape');
    expect(ends).toEqual([true, false]);
    expect(keys.press('w')).toBe(false);
  });

  test('Enter and Esc of a look-through are not heard by a key listener bound before the pilot (the pilot loads late)', () => {
    const keys = new FakeKeys();
    const heard: string[] = [];
    keys.addEventListener('keydown', (event) => heard.push((event as { key: string }).key));
    const ends: boolean[] = [];
    const p = new CheckpointPilot({
      camera: new THREE.PerspectiveCamera(),
      keys: keys as unknown as HTMLElement,
      onKeyEnd: (commit) => ends.push(commit),
    });
    p.begin(CAM_ID, 1.5, 3, 0);
    expect(keys.press('Enter')).toBe(true);
    expect(keys.press('Escape')).toBe(true);
    expect(ends).toEqual([true, false]);
    expect(heard).toEqual([]);
    keys.press('w');
    expect(heard).toEqual(['w']);
  });

  test('dispose lets go of the keys, even mid look-through: a Retry rebuilds on the same root', () => {
    const { pilot: p, keys, ends } = pilot();
    p.begin(CAM_ID, 1.5, 3, 0);
    p.dispose();
    expect(keys.press('Enter')).toBe(false);
    expect(keys.press('e')).toBe(false);
    expect(ends).toEqual([]);
    expect(p.id).toBeNull();
  });

  test('end answers the eye at the held height with the look, once', () => {
    const { pilot: p, camera } = pilot();
    p.begin(CAM_ID, 1.2, 3, 9);
    camera.position.set(2, 1.65, 3);
    camera.lookAt(2, 1.65, 8);
    const result = p.end()!;
    expect(result.id).toBe(CAM_ID);
    expect(result.baseRev).toBe(9);
    expect(result.eye.position.toArray()).toEqual([2, 1.2, 3]);
    expect(result.eye.target.z - result.eye.position.z).toBeCloseTo(1, 9);
    expect(p.end()).toBeNull();
    expect(p.id).toBeNull();
  });
});
