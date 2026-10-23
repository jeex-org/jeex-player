/**
 * Library materials on a room surface, drawn in a REAL WebGL context from maps
 * that went through the real decode path (`createImageBitmap` behind the
 * texture source), and read back pixel by pixel.
 *
 * The canvas baselines elsewhere tolerate a third of the range, which would
 * let a swapped channel or a flipped image through; every fixture here is
 * built so the property it pins shows up as a large, deterministic difference
 * between two readings: tint, tile count, grain direction, normal direction,
 * ARM channels, the mask cutoff and an upright image on a wall.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { attachLibraryMaps, createLibraryMaterial, type LibraryThreeMaterial } from '../../src/materials/library-material.js';
import { applyLibraryTransform, libraryAngle, libraryTextureMatrix } from '../../src/materials/library-uv.js';
import { TextureSource } from '../../src/materials/texture-source.js';
import type { LibraryDraw } from '../../src/materials/room-finish.js';
import type { LibraryMapRole, LibraryMaterial, LibraryPbr } from '../../src/materials/finish-types.js';
import { createLogger } from '../../src/shared/logger.js';

const SIZE = 64;
const VERSION = '01a167f6-0409-7047-b2b7-9297ca140b6a';
/** The pixel size of every fixture map. */
const MAP = 128;

const opened: THREE.WebGLRenderer[] = [];
const sources: TextureSource[] = [];

afterEach(() => {
  for (const source of sources.splice(0)) source.dispose();
  for (const renderer of opened.splice(0)) {
    renderer.dispose();
    renderer.forceContextLoss();
  }
});

/** RGBA pixels of a `MAP`-square image, one call per pixel (`x` right, `y` down, as a canvas has it). */
function image(pixel: (x: number, y: number) => readonly [number, number, number, number]): ImageData {
  const data = new ImageData(MAP, MAP);
  for (let y = 0; y < MAP; y += 1) {
    for (let x = 0; x < MAP; x += 1) data.data.set(pixel(x, y), (y * MAP + x) * 4);
  }
  return data;
}

/** `data` as PNG bytes, the way a bake ships an image file. */
async function encode(data: ImageData): Promise<Blob> {
  const canvas = new OffscreenCanvas(MAP, MAP);
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** A scan with the given maps at 128 px, its facts overridden. */
function scan(roles: readonly LibraryMapRole[], facts: Partial<LibraryMaterial['facts']> = {}): LibraryMaterial {
  return {
    versionId: VERSION,
    kind: 'scan',
    facts: { tileM: [1, 1], grain: 'none', suitability: 'continuous', colourMode: 'natural', averageColour: '#808080', pbr: {}, ...facts },
    maps: Object.fromEntries(
      roles.map((role) => [
        role,
        {
          colourSpace: role === 'albedo' || role === 'albedoTint' ? 'srgb' : 'linear',
          files: { '128': `tex/${VERSION}/${role}.128.webp` },
        },
      ]),
    ),
  };
}

/** The material of `draw`, its maps loaded through a texture source over `images` and attached. */
async function loaded(draw: LibraryDraw, images: Partial<Record<LibraryMapRole, ImageData>>): Promise<LibraryThreeMaterial> {
  const blobs = new Map<string, Blob>();
  for (const [role, data] of Object.entries(images)) blobs.set(`tex/${VERSION}/${role}.128.webp`, await encode(data));
  const source = new TextureSource({
    baseUrl: 'https://fixture.test/',
    log: createLogger(() => undefined),
    maxAnisotropy: 1,
    fetch: async (url) => new Response(blobs.get(new URL(url).pathname.slice(1))),
  });
  sources.push(source);
  const material = createLibraryMaterial(draw);
  const views: Partial<Record<LibraryMapRole, THREE.Texture>> = {};
  for (const role of Object.keys(images) as LibraryMapRole[]) {
    const view = await source.acquire({ versionId: VERSION, role, size: '128', path: `tex/${VERSION}/${role}.128.webp` }, material);
    if (view) views[role] = view;
  }
  attachLibraryMaps(material, draw, views);
  return material;
}

/** A `width` by `height` plane facing +z, its texture coordinates in metres from its lower-left corner. */
function metrePlane(width: number, height: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let index = 0; index < position.count; index += 1)
    uv.setXY(index, position.getX(index) + width / 2, position.getY(index) + height / 2);
  return geometry;
}

/**
 * Renders `material` on a `width` by `height` metre plane that fills the
 * canvas, lit by `lights`, and answers the canvas as linear-ish 0..1 RGB rows
 * (row 0 at the TOP of the picture).
 */
function render(
  material: THREE.Material,
  width: number,
  height: number,
  lights: readonly THREE.Light[],
  background = '#000000',
): number[][][] {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  opened.push(renderer);
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  for (const light of lights) scene.add(light);
  const geometry = metrePlane(width, height);
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 10);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  geometry.dispose();
  const rows: number[][][] = [];
  for (let y = SIZE - 1; y >= 0; y -= 1) {
    const row: number[][] = [];
    for (let x = 0; x < SIZE; x += 1) row.push([0, 1, 2].map((channel) => pixels[(y * SIZE + x) * 4 + channel]! / 255));
    rows.push(row);
  }
  return rows;
}

/** Mean of channel `channel` over the pixel rectangle `[x0, x1) × [y0, y1)`. */
function mean(rows: number[][][], channel: number, x0 = 0, x1 = SIZE, y0 = 0, y1 = SIZE): number {
  let sum = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) sum += rows[y]![x]![channel]!;
  return sum / ((x1 - x0) * (y1 - y0));
}

/** Plain white light from the front, the camera's side. */
const frontLight = (): THREE.Light[] => [new THREE.AmbientLight('#ffffff', 2)];

/** A draw of `material`. */
const drawOf = (material: LibraryMaterial, colour?: string, rotation = 0): LibraryDraw => ({
  id: VERSION,
  material,
  ...(colour !== undefined && { colour }),
  rotation,
});

describe('library materials on a real context', () => {
  test('tint: a red tint over a mid-grey tint map draws red, with no green or blue', async () => {
    const material = scan(['albedoTint'], {
      colourMode: 'tintable',
      tint: { recipe: 'luma-mid@1', suggestedColours: [{ name: 'Mist', hex: '#c9d6df' }] },
    });
    const grey = image(() => [128, 128, 128, 255]);
    const rows = render(await loaded(drawOf(material, '#ff0000'), { albedoTint: grey }), 1, 1, frontLight());
    expect(mean(rows, 0)).toBeGreaterThan(0.2);
    expect(mean(rows, 1)).toBeLessThan(0.02);
    expect(mean(rows, 2)).toBeLessThan(0.02);
  });

  test('tint brightness: a mid-grey tint map in the scan’s own colour draws like that colour as a plain map', async () => {
    const tintable = scan(['albedoTint'], {
      colourMode: 'tintable',
      tint: { recipe: 'luma-mid@1', suggestedColours: [{ name: 'Natural', hex: '#9a8d7a' }] },
    });
    const natural = scan(['albedo']);
    const grey = image(() => [128, 128, 128, 255]);
    const beige = image(() => [0x9a, 0x8d, 0x7a, 255]);
    const tinted = render(await loaded(drawOf(tintable, '#9a8d7a'), { albedoTint: grey }), 1, 1, frontLight());
    const plain = render(await loaded(drawOf(natural), { albedo: beige }), 1, 1, frontLight());
    for (const channel of [0, 1, 2]) expect(Math.abs(mean(tinted, channel) - mean(plain, channel))).toBeLessThan(0.02);
  });

  test('tile size: a [2, 1] scan repeats exactly twice along a 4 m wall', async () => {
    const material = scan(['albedo'], { tileM: [2, 1] });
    // Left half black, right half white: one dark-to-light edge per tile.
    const stripes = image((x) => (x < MAP / 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const built = await loaded(drawOf(material), { albedo: stripes });
    applyLibraryTransform(built, libraryTextureMatrix([2, 1], 0));
    const row = render(built, 4, 4, frontLight())[SIZE / 2]!;
    let rises = 0;
    for (let x = 1; x < SIZE; x += 1) if (row[x - 1]![0]! < 0.3 && row[x]![0]! > 0.3) rises += 1;
    expect(rises).toBe(2);
  });

  test('grain: planks along u follow the long side of a room', async () => {
    const material = scan(['albedo'], { grain: 'along_u' });
    // Bands across v: the planks run along u.
    const planks = image((_, y) => (Math.floor(y / 16) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const built = await loaded(drawOf(material), { albedo: planks });
    // The plane's "up" is the room's z: a room long along z.
    const outline = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 6 },
      { x: 0, z: 6 },
    ];
    applyLibraryTransform(built, libraryTextureMatrix([1, 1], libraryAngle(material.facts, 'floor', outline, 0)));
    const rows = render(built, 6, 6, frontLight());
    // Along a plank (the column) the colour holds; across planks (the row) it changes.
    const column = rows.map((row) => row[SIZE / 2]![0]!);
    const across = rows[SIZE / 2]!.map((pixel) => pixel[0]!);
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(spread(column)).toBeLessThan(0.1);
    expect(spread(across)).toBeGreaterThan(0.5);
  });

  test('normal direction: a normal map tilted towards +u is lit brighter from +u than from -u', async () => {
    const material = scan(['albedo', 'normal'], { pbr: { roughness: 1 } });
    const white = image(() => [255, 255, 255, 255]);
    // OpenGL tangent space: (0.6, 0, 0.8) encoded as 0.5 + n / 2.
    const tilted = image(() => [204, 128, 230, 255]);
    const lit = async (side: 1 | -1): Promise<number> => {
      const built = await loaded(drawOf(material), { albedo: white, normal: tilted });
      const light = new THREE.DirectionalLight('#ffffff', 2);
      light.position.set(side * 4, 0, 1);
      return mean(render(built, 1, 1, [light]), 0);
    };
    expect(await lit(1)).toBeGreaterThan((await lit(-1)) + 0.1);
  });

  test('ARM: the low-roughness half shows the sharper highlight', async () => {
    const material = scan(['albedo', 'arm'], { pbr: { roughness: 1 } });
    const grey = image(() => [60, 60, 60, 255]);
    // AO 1 everywhere, roughness 0.2 on the left half and 1 on the right, metal 0.
    const arm = image((x) => [255, x < MAP / 2 ? 51 : 255, 0, 255]);
    const built = await loaded(drawOf(material), { albedo: grey, arm });
    const light = new THREE.DirectionalLight('#ffffff', 6);
    light.position.set(0, 0, 1);
    const rows = render(built, 1, 1, [light]);
    expect(mean(rows, 0, 0, SIZE / 2)).toBeGreaterThan(mean(rows, 0, SIZE / 2) + 0.05);
  });

  test('ARM: the blue channel makes a surface metallic only when metalness is 1', async () => {
    const white = image(() => [255, 255, 255, 255]);
    const metalArm = image(() => [255, 128, 255, 255]);
    const reading = async (pbr: LibraryPbr): Promise<number> => {
      const built = await loaded(drawOf(scan(['albedo', 'arm'], { pbr })), { albedo: white, arm: metalArm });
      return mean(render(built, 1, 1, frontLight()), 0);
    };
    const plain = await reading({});
    const metal = await reading({ metalness: 1 });
    // A metal has no diffuse term: under plain ambient light it reads far darker.
    expect(metal).toBeLessThan(plain - 0.2);
  });

  test('mask: alpha 0.4 is cut away and alpha 0.6 is kept', async () => {
    const material = scan(['albedo'], { pbr: { alphaMode: 'mask' } });
    const half = image((x) => [255, 255, 255, x < MAP / 2 ? 102 : 153]);
    const rows = render(await loaded(drawOf(material), { albedo: half }), 1, 1, frontLight(), '#ff0000');
    // The cut half shows the red background, the kept half is white.
    expect(mean(rows, 1, 0, SIZE / 2)).toBeLessThan(0.05);
    expect(mean(rows, 1, SIZE / 2)).toBeGreaterThan(0.5);
  });

  test('orientation: a mark in the top row of the image stands at the top of the tile on a wall', async () => {
    const material = scan(['albedo']);
    const marked = image((_, y) => (y < MAP / 4 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const rows = render(await loaded(drawOf(material), { albedo: marked }), 1, 1, frontLight());
    expect(mean(rows, 0, 0, SIZE, 0, SIZE / 4)).toBeGreaterThan(0.5);
    expect(mean(rows, 0, 0, SIZE, SIZE / 2, SIZE)).toBeLessThan(0.05);
  });
});
