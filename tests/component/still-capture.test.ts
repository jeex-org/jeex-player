/**
 * Still capture, against a REAL WebGL context.
 *
 * The subject is the read-back path — render target in, PNG out — so the scene
 * is the smallest one that carries it: a lit box, not the demo apartment
 * (a component test mounts the smallest scene that carries its claim). What the
 * apartment is for is `capture-commands.test.ts`, which is about the commands.
 *
 * Two properties are load-bearing beyond the picture itself: the renderer is
 * BORROWED (its render target, clear colour and the borrowed root all go back
 * exactly as they were), and nothing is left on the GPU afterwards.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { captureStill } from '../../src/render/still-capture.js';
import { createLightingContext } from '../../src/lighting/lighting-context.js';
import { closeContainers } from './support.js';

const renderers: THREE.WebGLRenderer[] = [];

function openRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderers.push(renderer);
  return renderer;
}

/** A bright box under a bright light, filling the frame: something unmistakable to read back. */
function litBox(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight('#ffffff', 3));
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshStandardMaterial({ color: '#c86432' })));
  return scene;
}

/** The pose used everywhere below: straight at the box from a metre and a half out. */
const POSE = { position: { x: 0, y: 0, z: 3 }, target: { x: 0, y: 0, z: 0 } };

/** The decoded pixels of a captured PNG. */
async function decode(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** One pixel of an `ImageData`, as `[r, g, b, a]`. */
function pixelAt(image: ImageData, x: number, y: number): [number, number, number, number] {
  const at = (y * image.width + x) * 4;
  return [image.data[at]!, image.data[at + 1]!, image.data[at + 2]!, image.data[at + 3]!];
}

afterEach(() => {
  for (const renderer of renderers.splice(0)) {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  closeContainers();
});

describe('captureStill', () => {
  test('renders a PNG of the requested size', async () => {
    const renderer = openRenderer();
    const still = await captureStill(renderer, litBox(), { width: 640, height: 360, pose: POSE });
    expect(still.blob.type).toBe('image/png');
    expect(still.width).toBe(640);
    expect(still.height).toBe(360);
    const image = await decode(still.blob);
    expect(image.width).toBe(640);
    expect(image.height).toBe(360);
  });

  test('the centre of the picture is the lit object, neither black nor transparent', async () => {
    const renderer = openRenderer();
    const still = await captureStill(renderer, litBox(), { width: 64, height: 64, pose: POSE });
    const image = await decode(still.blob);
    const [red, green, blue, alpha] = pixelAt(image, 32, 32);
    expect(alpha).toBe(255);
    expect(red + green + blue).toBeGreaterThan(30);
    // The box is a warm orange; a picture that came back grey would mean the
    // display pass dropped the material rather than the tone mapping.
    expect(red).toBeGreaterThan(blue);
  });

  test('pixelRatio multiplies the pixels, not the requested size', async () => {
    const renderer = openRenderer();
    const still = await captureStill(renderer, litBox(), { width: 32, height: 24, pose: POSE, pixelRatio: 2 });
    expect(still.width).toBe(64);
    expect(still.height).toBe(48);
    const image = await decode(still.blob);
    expect(image.width).toBe(64);
  });

  test('the renderer is borrowed: its target and clear colour come back untouched', async () => {
    const renderer = openRenderer();
    renderer.setClearColor('#123456', 0.5);
    await captureStill(renderer, litBox(), { width: 32, height: 32, pose: POSE });
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.getClearColor(new THREE.Color()).getHexString()).toBe('123456');
    expect(renderer.getClearAlpha()).toBeCloseTo(0.5, 5);
  });

  test('a borrowed root goes back to the parent it came from, with its lights', async () => {
    const renderer = openRenderer();
    const parent = new THREE.Group();
    const root = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
    parent.add(root);
    const lights = new THREE.Group();
    lights.add(new THREE.AmbientLight('#ffffff', 3));
    const still = await captureStill(renderer, root, { width: 32, height: 32, pose: POSE }, lights);
    expect(root.parent).toBe(parent);
    expect(lights.parent).toBeNull();
    const image = await decode(still.blob);
    expect(pixelAt(image, 16, 16)[0]).toBeGreaterThan(30);
  });

  test('nothing is left on the GPU: geometries and textures return to their baseline', async () => {
    const renderer = openRenderer();
    const scene = litBox();
    // One capture first, so the baseline includes whatever the scene itself
    // uploads; the second is the one under test.
    await captureStill(renderer, scene, { width: 32, height: 32, pose: POSE });
    const before = { ...renderer.info.memory };
    await captureStill(renderer, scene, { width: 32, height: 32, pose: POSE });
    expect(renderer.info.memory.geometries).toBe(before.geometries);
    expect(renderer.info.memory.textures).toBe(before.textures);
  });

  test('refuses a size it cannot render', async () => {
    const renderer = openRenderer();
    await expect(captureStill(renderer, litBox(), { width: 0, height: 100, pose: POSE })).rejects.toThrow(/width/);
    await expect(captureStill(renderer, litBox(), { width: 100, height: Number.NaN, pose: POSE })).rejects.toThrow(/height/);
  });
});

describe('a still and the live view', () => {
  test('agree on a lit surface within 2 %', async () => {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    renderers.push(renderer);
    renderer.setPixelRatio(1);
    renderer.setSize(32, 32, false);
    const lighting = createLightingContext(THREE, renderer);
    const scene = new THREE.Scene();
    lighting.createApartmentRig().attach(scene);
    // A lit, coloured surface filling the frame, facing the camera and the sun.
    const material = new THREE.MeshStandardMaterial({ color: '#b07850', roughness: 0.8 });
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), material);
    surface.position.set(8, 2, 5);
    surface.lookAt(12.5, 15.5, -6.5);
    scene.add(surface);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(surface.quaternion);
    const eye = surface.position.clone().addScaledVector(normal, 3);
    const pose = { position: { x: eye.x, y: eye.y, z: eye.z }, target: { x: 8, y: 2, z: 5 } };

    // Live: the canvas, read in the same task as its render.
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 160);
    camera.position.copy(eye);
    camera.lookAt(8, 2, 5);
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const live = new Uint8Array(4);
    gl.readPixels(16, 16, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, live);

    const still = pixelAt(await decode((await captureStill(renderer, scene, { width: 32, height: 32, pose })).blob), 16, 15);
    for (let channel = 0; channel < 3; channel += 1) {
      expect({ channel, live: live[channel]!, close: Math.abs(still[channel]! - live[channel]!) <= live[channel]! * 0.02 + 1 }).toEqual({
        channel,
        live: live[channel]!,
        close: true,
      });
    }
    lighting.dispose();
    surface.geometry.dispose();
    material.dispose();
  });
});
