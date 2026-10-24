/**
 * The camera-preview card: it stands in the mini-map's corner exactly while a
 * tour checkpoint is focused, speaks two words to the eye and a sentence to the
 * screen reader, and steps over a host box claimed at `bottom-right`.
 *
 * The scissored render itself needs a live WebGL renderer and is proved by the
 * host editor's screenshots; what a browser proves here is the layout contract,
 * and the on-demand contract: every change of the card asks for a main frame,
 * and the inset is drawn only over a main frame that was drawn.
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

type World = {
  active: TourCheckpoint | null;
  mode: ViewerMode;
  commits: string[];
  looked: string[];
  /** Redraw requests the card made. */
  changes: number;
  /** Inset renders that reached the renderer. */
  renders: number;
  /** Inset draws the card reported. */
  insetDraws: number;
};

/** The renderer surface the inset uses, counting renders, over the shell's canvas. */
function fakeRenderer(shell: Shell, world: World): THREE.WebGLRenderer {
  return {
    domElement: shell.roots.canvas,
    autoClear: true,
    getViewport: (target: THREE.Vector4) => target,
    setScissorTest: () => undefined,
    setScissor: () => undefined,
    setViewport: () => undefined,
    render: () => {
      world.renders += 1;
    },
  } as unknown as THREE.WebGLRenderer;
}

function build(): { shell: Shell; preview: CameraPreview; world: World } {
  const shell = openShell();
  const world: World = { active: null, mode: 'orbit', commits: [], looked: [], changes: 0, renders: 0, insetDraws: 0 };
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
    renderer: () => fakeRenderer(shell, world),
    overlay: () => overlay,
    mode: () => world.mode,
    messages: shell.messages,
    onLookThrough: (id) => world.looked.push(id),
    onChange: () => (world.changes += 1),
    onInsetDrawn: () => (world.insetDraws += 1),
  });
  return { shell, preview, world };
}

afterEach(() => {
  closeContainers();
});

describe('the camera preview', () => {
  test('shows only while a checkpoint is focused, and flags the root so the map steps aside', () => {
    const { shell, preview, world } = build();
    preview.sync();
    expect(preview.element.dataset['visible']).toBe('false');
    expect(getComputedStyle(preview.element).display).toBe('none');
    world.active = CAM;
    preview.sync();
    expect(preview.element.dataset['visible']).toBe('true');
    expect(shell.roots.root.getAttribute(PREVIEW_ACTIVE_ATTRIBUTE)).toBe('true');
    world.active = null;
    preview.sync();
    expect(shell.roots.root.hasAttribute(PREVIEW_ACTIVE_ATTRIBUTE)).toBe(false);
    preview.dispose();
  });

  test('never shows in the 2D plan, whose renderer is off', () => {
    const { preview, world } = build();
    world.active = CAM;
    world.mode = 'plan2d';
    preview.sync();
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
    preview.sync();
    const free = preview.element.getBoundingClientRect().bottom;
    shell.roots.root.setAttribute(BOTTOM_RIGHT_CLAIMED_ATTRIBUTE, 'true');
    const lifted = preview.element.getBoundingClientRect().bottom;
    expect(free - lifted).toBeCloseTo(64, 0);
    preview.dispose();
  });

  test('a drag inside the card turns the camera — yaw across, pitch up and down — and commits ONCE', () => {
    const { preview, world } = build();
    world.active = { ...CAM, position: { ...CAM.position } };
    preview.sync();
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
    preview.sync();
    const window = preview.element.querySelector<HTMLElement>('.camera-preview-window')!;
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3, button: 0 }));
    expect(world.commits).toEqual([]);
    preview.element.querySelector<HTMLButtonElement>('.camera-preview-look')!.click();
    expect(world.looked).toEqual([CAM_ID]);
    preview.dispose();
  });
});

describe('the camera preview under on-demand drawing', () => {
  /** Runs `change`, then one sync, and answers whether that asked for a main frame. */
  function asks(preview: CameraPreview, world: World, change: () => void): boolean {
    const before = world.changes;
    change();
    preview.sync();
    return world.changes > before;
  }

  test('opening, aiming, a mode change, a moved or resized card and closing each ask for a main frame; nothing changed asks nothing', () => {
    const { shell, preview, world } = build();
    preview.sync();
    expect(asks(preview, world, () => undefined)).toBe(false);
    expect(asks(preview, world, () => (world.active = { ...CAM, position: { ...CAM.position } }))).toBe(true);
    expect(asks(preview, world, () => undefined)).toBe(false);
    expect(asks(preview, world, () => (world.active = { ...world.active!, yaw: world.active!.yaw + 0.2 }))).toBe(true);
    expect(asks(preview, world, () => (world.active = { ...CAM, position: { x: 2, y: 1.6, z: 1 } }))).toBe(true);
    expect(asks(preview, world, () => (world.mode = 'plan3d'))).toBe(true);
    // A host box claimed under the card moves it: a relocation the card itself never initiated.
    expect(asks(preview, world, () => shell.roots.root.setAttribute(BOTTOM_RIGHT_CLAIMED_ATTRIBUTE, 'true'))).toBe(true);
    expect(asks(preview, world, () => (preview.element.style.width = '260px'))).toBe(true);
    expect(asks(preview, world, () => undefined)).toBe(false);
    // Closing asks too: the main picture must be drawn again without the old inset.
    expect(asks(preview, world, () => (world.active = null))).toBe(true);
    expect(asks(preview, world, () => undefined)).toBe(false);
    preview.dispose();
  });

  test('the page scrolling or the viewer moving on it, with the card open, asks for no frame', () => {
    const { shell, preview, world } = build();
    world.active = CAM;
    preview.sync();
    // The card and the canvas move together: the inset's place on the canvas is unchanged.
    expect(asks(preview, world, () => (shell.container.style.marginTop = '40px'))).toBe(false);
    expect(asks(preview, world, () => (shell.container.style.marginLeft = '25px'))).toBe(false);
    preview.dispose();
  });

  test('the inset is drawn once per main draw, never on a tick without one, and not while closed', () => {
    const { preview, world } = build();
    world.active = CAM;
    preview.sync();
    // Main draw 1: the inset follows it once.
    preview.drawAfter(1);
    expect(world.renders).toBe(1);
    expect(world.insetDraws).toBe(1);
    // Skipped ticks: the main draw counter did not move, whatever the clock says.
    for (let tick = 0; tick < 10; tick += 1) preview.drawAfter(1);
    expect(world.renders).toBe(1);
    preview.drawAfter(2);
    expect(world.renders).toBe(2);
    world.active = null;
    preview.sync();
    preview.drawAfter(3);
    expect(world.renders).toBe(2);
    expect(world.insetDraws).toBe(2);
    preview.dispose();
  });
});
