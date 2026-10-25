/**
 * Lamp scope in walk and tour, in a real browser: every lamp feeds the room
 * grids (also when nested under a mesh or a transmissive body, and the bank's
 * own bulbs), and a lamp's direct light stays in its room.
 *
 * Oracles: a zero-specular grey card (`specularIntensity` 0, roughness 1,
 * metalness 0) read in a float render target, so the reading is linear light
 * before tone mapping; the mask is the central `CARD_MASK_PX` square of the
 * frame, which the card fills. Each test states its tolerance. Readings are
 * written to `test-results/lamp-scope.json` (git-ignored).
 */

import * as THREE from 'three';
import { afterAll, describe, expect, test } from 'vitest';
import { commands } from 'vitest/browser';
import { WalkLighting } from '../../src/render/walk-post.js';
import { createLightingContext } from '../../src/lighting/lighting-context.js';
import { tagArtificialLight } from '../../src/assets/artificial-light.js';
import { buildLamp } from '../../src/assets/asset-builders-lighting-decor.js';
import { GeometryCache, makeBuildKit } from '../../src/assets/asset-kit.js';
import { FinishRegistry } from '../../src/assets/asset-finishes.js';
import type { ResolvedAsset } from '../../src/assets/asset-resolver.js';
import { openContainer } from './support.js';

const TIMEOUT_MS = 300_000;
const HEIGHT_M = 2.6;
const SIZE = { w: 96, h: 96 };
/** Side of the central square the readings average, pixels. */
const CARD_MASK_PX = 16;

const results: Record<string, unknown> = {};
const record = (name: string, value: unknown): void => {
  results[name] = value;
};
afterAll(async () => {
  await commands.writeFile('test-results/lamp-scope.json', JSON.stringify(results, null, 2));
});

type Box = { x0: number; x1: number; z0: number; z1: number };
type Vec = [number, number, number];

const square = (b: Box) => [
  { x: b.x0, z: b.z0 },
  { x: b.x1, z: b.z0 },
  { x: b.x1, z: b.z1 },
  { x: b.x0, z: b.z1 },
];

/** A closed matte room: four walls, a ceiling and a floor facing in, origins inside. */
function shell(scene: THREE.Scene, b: Box, material: THREE.Material): void {
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const planes: Array<{ size: [number, number]; at: Vec; rot: Vec }> = [
    { size: [w, HEIGHT_M], at: [cx, HEIGHT_M / 2, b.z0 + 0.01], rot: [0, 0, 0] },
    { size: [w, HEIGHT_M], at: [cx, HEIGHT_M / 2, b.z1 - 0.01], rot: [0, Math.PI, 0] },
    { size: [d, HEIGHT_M], at: [b.x0 + 0.01, HEIGHT_M / 2, cz], rot: [0, Math.PI / 2, 0] },
    { size: [d, HEIGHT_M], at: [b.x1 - 0.01, HEIGHT_M / 2, cz], rot: [0, -Math.PI / 2, 0] },
    { size: [w, d], at: [cx, HEIGHT_M - 0.01, cz], rot: [Math.PI / 2, 0, 0] },
    { size: [w, d], at: [cx, 0, cz], rot: [-Math.PI / 2, 0, 0] },
  ];
  for (const plane of planes) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...plane.size), material);
    mesh.position.set(...plane.at);
    mesh.rotation.set(...plane.rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

/** A zero-specular grey card facing `normal`, centred at `at`. */
function card(at: Vec, normal: Vec, size = 0.5): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshPhysicalMaterial({ color: 0x808080, roughness: 1, metalness: 0, specularIntensity: 0 }),
  );
  mesh.position.set(...at);
  mesh.lookAt(at[0] + normal[0], at[1] + normal[1], at[2] + normal[2]);
  return mesh;
}

export type LampKind = 'mesh' | 'transmissive' | 'bank';

/** A lamp placement under the furniture group: its light nested as the kind says. Answers its lights. */
function lamp(furniture: THREE.Object3D, kind: LampKind, at: Vec, intensity: number, distance: number): THREE.PointLight[] {
  const placement = new THREE.Group();
  placement.userData['assetId'] = `lamp-${kind}`;
  placement.position.set(...at);
  furniture.add(placement);
  if (kind === 'bank') {
    const kit = makeBuildKit(new GeometryCache(), new FinishRegistry([]), {}, () => {});
    const asset = { placementId: 'bank-lamp', dims: [0.4, 1.6, 0.4], options: { lightIntensity: intensity, lightDistance: distance } };
    const body = buildLamp(asset as unknown as ResolvedAsset, kit);
    // The bulb at the placement's point, wherever the builder put it.
    body.position.y = -(body.children.find((c) => (c as THREE.PointLight).isPointLight)?.position.y ?? 0);
    placement.add(body);
  } else {
    const material =
      kind === 'transmissive'
        ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, roughness: 0.2 })
        : new THREE.MeshStandardMaterial({ color: 0x404040 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), material);
    body.add(tagArtificialLight(new THREE.PointLight('#ffd9a4', intensity, distance, 2)));
    placement.add(body);
  }
  const lights: THREE.PointLight[] = [];
  placement.traverse((object) => {
    if ((object as THREE.PointLight).isPointLight) lights.push(object as THREE.PointLight);
  });
  return lights;
}

/** A renderer, the apartment rig, the scene `build` makes and the room lighting over `rooms`. */
function world(rooms: Array<{ id: string; box: Box }>, build: (scene: THREE.Scene, furniture: THREE.Group) => void) {
  const container = openContainer(SIZE.w, SIZE.h);
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const gl = new THREE.WebGLRenderer({ canvas });
  gl.setPixelRatio(1);
  gl.setSize(SIZE.w, SIZE.h, false);
  gl.shadowMap.enabled = true;
  const context = createLightingContext(THREE, gl);
  const scene = new THREE.Scene();
  context.createApartmentRig().attach(scene);
  const furniture = new THREE.Group();
  furniture.name = 'furniture';
  scene.add(furniture);
  build(scene, furniture);
  const lighting = new WalkLighting(gl, scene);
  const doc = () => ({
    volumes: {
      rooms: rooms.map((r) => ({ roomId: r.id, polygon: square(r.box), halfWall: 0.05 })),
      ceilingHeight: HEIGHT_M,
      doors: [],
      furniture: [],
    },
    furniture,
  });
  /** A fresh bake: the document loaded again, frames until live. */
  const bake = (): void => {
    lighting.load(doc());
    for (let frame = 0; frame < 4000 && lighting.phase !== 'live'; frame += 1) lighting.frame(true);
    expect(lighting.phase).toBe('live');
  };
  /** Mean linear luminance of the central mask seen from `from` towards `to`. */
  const read = (from: Vec, to: Vec): number => {
    const camera = new THREE.PerspectiveCamera(30, SIZE.w / SIZE.h, 0.05, 50);
    camera.position.set(...from);
    camera.lookAt(...to);
    camera.updateMatrixWorld();
    const target = new THREE.WebGLRenderTarget(SIZE.w, SIZE.h, { type: THREE.FloatType });
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    const pixels = new Float32Array(CARD_MASK_PX * CARD_MASK_PX * 4);
    gl.readRenderTargetPixels(target, (SIZE.w - CARD_MASK_PX) / 2, (SIZE.h - CARD_MASK_PX) / 2, CARD_MASK_PX, CARD_MASK_PX, pixels);
    gl.setRenderTarget(null);
    target.dispose();
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
    return sum / (pixels.length / 4);
  };
  const dispose = (): void => {
    lighting.dispose();
    context.dispose();
    gl.dispose();
    gl.forceContextLoss();
  };
  return { gl, scene, furniture, lighting, bake, read, dispose };
}

const A: Box = { x0: 0, x1: 4, z0: 0, z1: 4 };
const GREY = () => new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.95 });

describe('lamps feed the room grids', { timeout: TIMEOUT_MS }, () => {
  // The lamp in one corner, its cutoff 1.2 m; the card 3.3 m away, beyond the cutoff, so its reading has no direct lamp term.
  const LAMP_AT: Vec = [0.8, 1.0, 0.8];
  const CARD_AT: Vec = [3.7, 1.2, 3.0];
  const EYE: Vec = [2.2, 1.2, 3.0];
  /** Relative rise the bounce must clear: far above the reading noise of two identical bakes (0 on a deterministic rasteriser). */
  const MIN_RISE = 0.01;

  for (const kind of ['mesh', 'transmissive', 'bank'] as const) {
    test(`a ${kind} lamp's light reaches the grid: a card beyond its cutoff reads brighter after a bake with the lamp on`, () => {
      let lights: THREE.PointLight[] = [];
      const w = world([{ id: 'a', box: A }], (scene, furniture) => {
        shell(scene, A, GREY());
        scene.add(card(CARD_AT, [-1, 0, 0]));
        lights = lamp(furniture, kind, LAMP_AT, 40, 1.2);
      });
      try {
        expect(lights).toHaveLength(1);
        for (const light of lights) light.intensity = 0;
        w.bake();
        const off = w.read(EYE, CARD_AT);
        for (const light of lights) light.intensity = 40;
        w.bake();
        const on = w.read(EYE, CARD_AT);
        record(`grid-${kind}`, { off, on, rise: on / off - 1 });
        expect(on / off - 1).toBeGreaterThan(MIN_RISE);
      } finally {
        w.dispose();
      }
    });
  }
});

const B: Box = { x0: 4, x1: 8, z0: 0, z1: 4 };

describe('source rooms', { timeout: TIMEOUT_MS }, () => {
  test('every tagged lamp, fact-like or bank, carries its room after the load; a lamp outside every room carries -2; an untagged light none', () => {
    const lights: Record<string, THREE.PointLight> = {};
    const w = world(
      [
        { id: 'a', box: A },
        { id: 'b', box: B },
      ],
      (scene, furniture) => {
        shell(scene, A, GREY());
        shell(scene, B, GREY());
        lights['a'] = lamp(furniture, 'mesh', [1, 1, 1], 5, 2)[0]!;
        lights['b'] = lamp(furniture, 'bank', [6, 1, 2], 5, 2)[0]!;
        lights['outside'] = lamp(furniture, 'transmissive', [-1, 1, 2], 5, 2)[0]!;
        const plain = new THREE.PointLight('#ffffff', 1, 2, 2);
        plain.position.set(2, 1, 2);
        scene.add(plain);
        lights['plain'] = plain;
      },
    );
    try {
      w.bake();
      const room = (name: string): unknown => lights[name]!.userData['jeexLampRoom'];
      expect([0, 1]).toContain(room('a'));
      expect([0, 1]).toContain(room('b'));
      expect(room('a')).not.toBe(room('b'));
      expect(room('outside')).toBe(-2);
      expect(room('plain')).toBeUndefined();
    } finally {
      w.dispose();
    }
  });
});
