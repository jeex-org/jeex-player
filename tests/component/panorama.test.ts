/**
 * The equirectangular panorama, against a REAL WebGL context.
 *
 * The subject is the PROJECTION — a cube of six faces flattened into one 2:1
 * image — so the scene is a box the camera stands inside with a different
 * colour above and below: the cheapest thing that proves up is up, down is
 * down, and the two ends of the image meet.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { capturePanorama } from '../../src/render/panorama.js';
import { whiteBalanceMatrix } from '../../src/render/white-balance.js';
import { closeContainers } from './support.js';

const renderers: THREE.WebGLRenderer[] = [];

function openRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderers.push(renderer);
  return renderer;
}

/**
 * A room from the inside: a box with its faces turned inward, a pale ceiling
 * and a dark floor, lit flatly so the read-back is about the projection and
 * not about shading.
 */
function insideARoom(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight('#ffffff', 3));
  const walls = new THREE.MeshBasicMaterial({ color: '#808080', side: THREE.BackSide });
  const ceiling = new THREE.MeshBasicMaterial({ color: '#f0f0f0', side: THREE.BackSide });
  const floor = new THREE.MeshBasicMaterial({ color: '#101010', side: THREE.BackSide });
  // BoxGeometry material order: +x, -x, +y (ceiling), -y (floor), +z, -z.
  const box = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), [walls, walls, ceiling, floor, walls, walls]);
  scene.add(box);
  return scene;
}

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

/** Mean luminance of one image row, 0…255. */
function rowMean(image: ImageData, y: number): number {
  let total = 0;
  for (let x = 0; x < image.width; x += 1) {
    const at = (y * image.width + x) * 4;
    total += (image.data[at]! + image.data[at + 1]! + image.data[at + 2]!) / 3;
  }
  return total / image.width;
}

/** Mean luminance of one image column, 0…255. */
function columnMean(image: ImageData, x: number): number {
  let total = 0;
  for (let y = 0; y < image.height; y += 1) {
    const at = (y * image.width + x) * 4;
    total += (image.data[at]! + image.data[at + 1]! + image.data[at + 2]!) / 3;
  }
  return total / image.height;
}

afterEach(() => {
  for (const renderer of renderers.splice(0)) {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  closeContainers();
});

describe('capturePanorama', () => {
  test('is twice as wide as it is high, at the requested width', async () => {
    const renderer = openRenderer();
    const panorama = await capturePanorama(renderer, insideARoom(), { width: 512, position: { x: 0, y: 0, z: 0 }, faceSize: 128 });
    expect(panorama.width).toBe(512);
    expect(panorama.height).toBe(256);
    const image = await decode(panorama.blob);
    expect(image.width).toBe(512);
    expect(image.height).toBe(256);
  });

  test('up is up: the ceiling band is brighter than the floor band', async () => {
    const renderer = openRenderer();
    const panorama = await capturePanorama(renderer, insideARoom(), { width: 256, position: { x: 0, y: 0, z: 0 }, faceSize: 128 });
    const image = await decode(panorama.blob);
    const ceiling = rowMean(image, Math.round(image.height * 0.25));
    const floor = rowMean(image, Math.round(image.height * 0.75));
    expect(ceiling).toBeGreaterThan(floor + 20);
  });

  test('the seam is invisible: the two ends of the image are the same direction', async () => {
    const renderer = openRenderer();
    const panorama = await capturePanorama(renderer, insideARoom(), { width: 256, position: { x: 0, y: 0, z: 0 }, faceSize: 128 });
    const image = await decode(panorama.blob);
    expect(Math.abs(columnMean(image, 0) - columnMean(image, image.width - 1))).toBeLessThan(8);
  });

  test('nothing is left on the GPU: geometries and textures return to their baseline', async () => {
    const renderer = openRenderer();
    const scene = insideARoom();
    const spec = { width: 128, position: { x: 0, y: 0, z: 0 }, faceSize: 64 };
    await capturePanorama(renderer, scene, spec);
    const before = { ...renderer.info.memory };
    await capturePanorama(renderer, scene, spec);
    expect(renderer.info.memory.geometries).toBe(before.geometries);
    expect(renderer.info.memory.textures).toBe(before.textures);
  });

  test('a borrowed root goes back to the parent it came from', async () => {
    const renderer = openRenderer();
    const parent = new THREE.Group();
    const root = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), new THREE.MeshBasicMaterial({ color: '#888888', side: THREE.BackSide }));
    parent.add(root);
    await capturePanorama(renderer, root, { width: 128, position: { x: 0, y: 0, z: 0 }, faceSize: 64 });
    expect(root.parent).toBe(parent);
  });

  test('a white balance applies once in the display pass, clamped at zero; without one nothing changes', async () => {
    /** A uniform box of linear colour `rgb` around the camera. */
    const uniform = (rgb: readonly number[]): THREE.Scene => {
      const scene = new THREE.Scene();
      const colour = new THREE.Color().setRGB(rgb[0]!, rgb[1]!, rgb[2]!, THREE.LinearSRGBColorSpace);
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), new THREE.MeshBasicMaterial({ color: colour, side: THREE.BackSide })));
      return scene;
    };
    const centre = (image: ImageData): number[] => {
      const at = ((image.height >> 1) * image.width + (image.width >> 1)) * 4;
      return [image.data[at]!, image.data[at + 1]!, image.data[at + 2]!];
    };
    const matrix = whiteBalanceMatrix([1, 0.6, 0.35], 0.8);
    const colour = [0.6, 0.3, 0.05];
    const balanced = [0, 1, 2].map((r) => Math.max(0, matrix[r * 3]! * colour[0]! + matrix[r * 3 + 1]! * colour[1]! + matrix[r * 3 + 2]! * colour[2]!));
    const spec = { width: 128, position: { x: 0, y: 0, z: 0 }, faceSize: 32 };
    const renderer = openRenderer();
    const got = centre(await decode((await capturePanorama(renderer, uniform(colour), { ...spec, whiteBalance: matrix })).blob));
    const want = centre(await decode((await capturePanorama(renderer, uniform(balanced), spec)).blob));
    for (let channel = 0; channel < 3; channel += 1) expect(Math.abs(got[channel]! - want[channel]!)).toBeLessThanOrEqual(1);
    const plain = centre(await decode((await capturePanorama(renderer, uniform(colour), spec)).blob));
    expect(plain).not.toEqual(got);
  });
});
