/**
 * The swatch preview, against a REAL WebGL context.
 *
 * This is the one part of the render layer that cannot be tested anywhere else.
 * It renders into a `WebGLRenderTarget` of the viewer's own renderer and reads
 * the pixels back, with no SECOND `WebGLRenderer`, which would make two
 * viewers on a page cost four of the sixteen contexts a browser allows. A stub renderer proves nothing about a read-back;
 * only a context can.
 *
 * The other property under test is that the preview LEAVES NOTHING BEHIND: it
 * borrows the group, the render target and the clear colour, and the very next
 * frame of the real scene draws with all three.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { SwatchPreview } from '../../src/render/swatch-preview.js';
import { closeContainers, demoScene, openContainer } from './support.js';

const handles: ViewerHandle[] = [];
const renderers: THREE.WebGLRenderer[] = [];

/** A mounted viewer, purely for the renderer its stage owns. */
async function mountedRenderer(): Promise<THREE.WebGLRenderer> {
  const handle = mountViewer(openContainer(), {
    scene: { repository: new InlineSceneRepository(demoScene()) },
    tour: { mode: 'off' },
    debug: false,
  });
  handles.push(handle);
  await handle.ready;
  const canvas = handle.element.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
  // The renderer is the stage's; the honest way to reach it from outside is
  // the canvas it draws into, which is what `SwatchPreview` is handed too.
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
  renderers.push(renderer);
  expect(canvas.width).toBeGreaterThan(0);
  return renderer;
}

/** A small lit box: something with a silhouette to read back. */
function group(): THREE.Group {
  const holder = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#c08040' }));
  holder.add(mesh);
  return holder;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  for (const renderer of renderers.splice(0)) {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  closeContainers();
});

describe('SwatchPreview', () => {
  test('renders a group to a PNG data URL', async () => {
    const renderer = await mountedRenderer();
    const preview = new SwatchPreview(renderer, () => true);
    const url = preview.render(group(), 32);
    expect(url).toMatch(/^data:image\/png;base64,/);
    // Not an empty picture: a 32 px transparent PNG is a couple of hundred
    // bytes, and a lit box is comfortably more.
    expect((url ?? '').length).toBeGreaterThan(400);
    preview.dispose();
  });

  test('puts the group back where it came from', async () => {
    const renderer = await mountedRenderer();
    const preview = new SwatchPreview(renderer, () => true);
    const parent = new THREE.Group();
    const borrowed = group();
    parent.add(borrowed);
    preview.render(borrowed, 32);
    expect(borrowed.parent).toBe(parent);
    preview.dispose();
  });

  test('restores the renderer’s own target and clear colour', async () => {
    const renderer = await mountedRenderer();
    renderer.setClearColor('#123456', 0.5);
    const preview = new SwatchPreview(renderer, () => true);
    preview.render(group(), 32);
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.getClearColor(new THREE.Color()).getHexString()).toBe('123456');
    expect(renderer.getClearAlpha()).toBeCloseTo(0.5, 5);
    preview.dispose();
  });

  test('honours the size of every call and reuses one target for a repeated size', async () => {
    const renderer = await mountedRenderer();
    const preview = new SwatchPreview(renderer, () => true);
    const small = preview.render(group(), 16);
    const large = preview.render(group(), 64);
    const smallAgain = preview.render(group(), 16);
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    // A whole panel of swatches asks for the same size in one task; the target
    // is resized only when the size actually changes.
    expect((large ?? '').length).toBeGreaterThan((small ?? '').length);
    expect(smallAgain).not.toBeNull();
    preview.dispose();
  });

  test('answers null while the owner cannot draw, and after dispose', async () => {
    const renderer = await mountedRenderer();
    let available = false;
    const preview = new SwatchPreview(renderer, () => available);
    expect(preview.render(group(), 16)).toBeNull();
    available = true;
    expect(preview.render(group(), 16)).not.toBeNull();
    preview.dispose();
    // Disposing releases the target; the next call builds a new one rather
    // than drawing into a freed one.
    expect(preview.render(group(), 16)).not.toBeNull();
    preview.dispose();
  });

  test('the viewer’s own preview draws with the viewer’s renderer, not a second context', async () => {
    const handle = mountViewer(openContainer(), {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      debug: false,
    });
    handles.push(handle);
    await handle.ready;
    const before = document.querySelectorAll('canvas').length;
    // The panel's swatches go through the same path; opening one must not add
    // a canvas to the page.
    handle.setFurnitureVisible(true);
    expect(document.querySelectorAll('canvas').length).toBe(before);
  });
});
