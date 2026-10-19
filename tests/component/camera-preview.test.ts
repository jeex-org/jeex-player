/**
 * The camera-preview card: it stands in the mini-map's corner exactly while a
 * tour checkpoint is focused, speaks two words to the eye and a sentence to the
 * screen reader, and steps over a host box claimed at `bottom-right`.
 *
 * The scissored render itself needs a live WebGL renderer and is proved by the
 * host editor's screenshots; what a browser proves here is the layout contract.
 */

import { afterEach, describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { CameraPreview, LOOK_RAD_PER_PX, PREVIEW_ACTIVE_ATTRIBUTE } from '../../src/ui/camera-preview.js';
import { BOTTOM_RIGHT_CLAIMED_ATTRIBUTE } from '../../src/ui/host-slots.js';
import type { CheckpointOverlay } from '../../src/camera/checkpoint-overlay.js';
import type { TourCheckpoint, ViewerMode } from '../../src/scene/types.js';
import { closeContainers, openShell, type Shell } from './support.js';

/** The one checkpoint this file focuses, by fixed UUID v7. */
const CAM_ID = '01a12ffa-de43-7ef6-ab4e-a6c77eeabb82';

const CAM: TourCheckpoint = { id: CAM_ID, position: { x: 1, y: 1.6, z: 1 }, yaw: 0, pitch: 0 };

type World = { active: TourCheckpoint | null; mode: ViewerMode; commits: string[]; looked: string[] };

function build(): { shell: Shell; preview: CameraPreview; world: World } {
  const shell = openShell();
  const world: World = { active: null, mode: 'orbit', commits: [], looked: [] };
  // The overlay's side of the drag: a mutable working pose, a change signal, one commit.
  const overlay = {
    activeCheckpoint: () => world.active,
    hideForPreview: () => null,
    editable: () => world.mode === 'orbit',
    rev: () => 4,
    working: (id: string) => (world.active?.id === id ? world.active : undefined),
    changed: () => undefined,
    commit: (summary: string) => world.commits.push(summary),
    revert: () => undefined,
  } as unknown as CheckpointOverlay;
  const preview = new CameraPreview({
    container: shell.roots.viewport,
    root: shell.roots.root,
    scene: () => new THREE.Scene(),
    renderer: () => undefined,
    overlay: () => overlay,
    mode: () => world.mode,
    messages: shell.messages,
    onLookThrough: (id) => world.looked.push(id),
  });
  return { shell, preview, world };
}

afterEach(() => {
  closeContainers();
});

describe('the camera preview', () => {
  test('shows only while a checkpoint is focused, and flags the root so the map steps aside', () => {
    const { shell, preview, world } = build();
    preview.render();
    expect(preview.element.dataset['visible']).toBe('false');
    expect(getComputedStyle(preview.element).display).toBe('none');
    world.active = CAM;
    preview.render();
    expect(preview.element.dataset['visible']).toBe('true');
    expect(shell.roots.root.getAttribute(PREVIEW_ACTIVE_ATTRIBUTE)).toBe('true');
    world.active = null;
    preview.render();
    expect(shell.roots.root.hasAttribute(PREVIEW_ACTIVE_ATTRIBUTE)).toBe(false);
    preview.dispose();
  });

  test('never shows in the 2D plan, whose renderer is off', () => {
    const { preview, world } = build();
    world.active = CAM;
    world.mode = 'plan2d';
    preview.render();
    expect(preview.element.dataset['visible']).toBe('false');
    preview.dispose();
  });

  test('a short visible title, a full sentence for the screen reader', () => {
    const { shell, preview } = build();
    expect(preview.element.dataset['label']).toBe(shell.messages.t('cameraPreview.title'));
    expect(preview.element.getAttribute('aria-label')).toBe(shell.messages.t('cameraPreview.label'));
    expect(shell.messages.t('cameraPreview.title').length).toBeLessThan(shell.messages.t('cameraPreview.label').length);
    preview.dispose();
  });

  test('rises over a host box claimed at bottom-right', () => {
    const { shell, preview, world } = build();
    world.active = CAM;
    preview.render();
    const free = preview.element.getBoundingClientRect().bottom;
    shell.roots.root.setAttribute(BOTTOM_RIGHT_CLAIMED_ATTRIBUTE, 'true');
    const lifted = preview.element.getBoundingClientRect().bottom;
    expect(free - lifted).toBeCloseTo(64, 0);
    preview.dispose();
  });

  test('a drag inside the card turns the camera — yaw across, pitch up and down — and commits ONCE', () => {
    const { preview, world } = build();
    world.active = { ...CAM, position: { ...CAM.position } };
    preview.render();
    const window = preview.element.querySelector<HTMLElement>('.camera-preview-window')!;
    const box = window.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    const fire = (type: string, dx: number, dy: number): void => {
      window.dispatchEvent(
        new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, clientX: at.clientX + dx, clientY: at.clientY + dy }),
      );
    };
    // «Drag to aim» teaches the gesture until the first drag.
    const caption = preview.element.querySelector<HTMLElement>('.camera-preview-caption')!;
    expect(caption.textContent).toBe('Drag to aim');
    expect(getComputedStyle(caption).opacity).toBe('1');
    fire('pointerdown', 0, 0);
    expect(preview.element.dataset['taught']).toBeUndefined();
    fire('pointermove', 20, 0);
    fire('pointermove', 40, -20);
    fire('pointerup', 40, -20);
    expect(preview.element.dataset['taught']).toBe('true');
    expect(world.commits).toHaveLength(1);
    expect(world.active.yaw).toBeCloseTo(40 * LOOK_RAD_PER_PX, 9);
    expect(world.active.pitch).toBeCloseTo(-20 * LOOK_RAD_PER_PX, 9);
    preview.dispose();
  });

  test('a press without a drag commits nothing; «Look through» names the active camera', () => {
    const { preview, world } = build();
    world.active = { ...CAM, position: { ...CAM.position } };
    preview.render();
    const window = preview.element.querySelector<HTMLElement>('.camera-preview-window')!;
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3, button: 0 }));
    expect(world.commits).toEqual([]);
    preview.element.querySelector<HTMLButtonElement>('.camera-preview-look')!.click();
    expect(world.looked).toEqual([CAM_ID]);
    preview.dispose();
  });
});
