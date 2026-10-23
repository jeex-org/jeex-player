/**
 * What the highlight reports to the frame loop: whether the tick changed the
 * picture, so walk and tour redraw while the tint fades and once after a set,
 * a clear or a recolour (`render-demand.ts`). The tint itself is pinned by the
 * component test `tests/component/selection-highlight.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { HIGHLIGHT_FADE_MS, SelectionHighlight } from './selection-highlight.js';

function wallScene(): THREE.Group {
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  wall.userData['surface'] = 'wall';
  wall.userData['wallId'] = 'w1';
  root.add(wall);
  return root;
}

/** Ticks of `step` ms from `from`, answering what `update` said on each. */
function run(highlight: SelectionHighlight, from: number, ticks: number, step = 50): boolean[] {
  return Array.from({ length: ticks }, (_, index) => highlight.update(from + index * step));
}

describe('SelectionHighlight.update reports picture changes', () => {
  test('a set draws through the fade, the settled tint once, then rests', () => {
    const root = wallScene();
    const highlight = new SelectionHighlight(() => root);
    expect(highlight.update(0)).toBe(false);
    highlight.set({ kind: 'wall', id: 'w1' });
    const ticks = Math.ceil(HIGHLIGHT_FADE_MS / 50) + 4;
    const changed = run(highlight, 1000, ticks);
    const settledAt = changed.lastIndexOf(true);
    expect(changed.slice(0, settledAt + 1).every(Boolean)).toBe(true);
    expect(settledAt).toBe(Math.ceil(HIGHLIGHT_FADE_MS / 50));
    expect(changed.slice(settledAt + 1).some(Boolean)).toBe(false);
  });

  test('a clear and a recolour of a settled tint each draw once', () => {
    const root = wallScene();
    const highlight = new SelectionHighlight(() => root);
    highlight.set({ kind: 'wall', id: 'w1' });
    run(highlight, 0, 20);
    highlight.setColour(0x00ff00);
    expect(run(highlight, 2000, 3)).toEqual([true, false, false]);
    highlight.set(null);
    expect(run(highlight, 3000, 3)).toEqual([true, false, false]);
  });
});
