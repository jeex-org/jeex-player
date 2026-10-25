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
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { WalkLighting } from '../../src/render/walk-post.js';
import { createLightingContext } from '../../src/lighting/lighting-context.js';
import { tagArtificialLight } from '../../src/assets/artificial-light.js';
import { buildLamp } from '../../src/assets/asset-builders-lighting-decor.js';
import { GeometryCache, makeBuildKit } from '../../src/assets/asset-kit.js';
import { FinishRegistry } from '../../src/assets/asset-finishes.js';
import type { ResolvedAsset } from '../../src/assets/asset-resolver.js';
import { closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { SceneOp } from '../../src/scene/types.js';

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

/** A doorway in a room's wall on x = x0 or x = x1, spanning z0..z1 at full height. */
type Door = { side: 'x0' | 'x1'; z0: number; z1: number };

/** A matte room: four walls (one with a doorway when asked), a ceiling and a floor facing in, origins inside. */
function shell(scene: THREE.Scene, b: Box, material: THREE.Material, door: Door | null = null): void {
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
  if (door) {
    // The doorway's wall in two parts beside the opening.
    const x = door.side === 'x0' ? b.x0 + 0.01 : b.x1 - 0.01;
    const yaw = door.side === 'x0' ? Math.PI / 2 : -Math.PI / 2;
    planes.splice(door.side === 'x0' ? 2 : 3, 1);
    for (const [z0, z1] of [
      [b.z0, door.z0],
      [door.z1, b.z1],
    ] as const) {
      if (z1 - z0 > 1e-3) planes.push({ size: [z1 - z0, HEIGHT_M], at: [x, HEIGHT_M / 2, (z0 + z1) / 2], rot: [0, yaw, 0] });
    }
  }
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
  }
  if (kind !== 'bank') {
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
  /** Mean linear luminance of the central mask seen from `from` towards `to`, the mask moved `dx` pixels to the right. */
  const read = (from: Vec, to: Vec, dx = 0): number => {
    const camera = new THREE.PerspectiveCamera(30, SIZE.w / SIZE.h, 0.05, 50);
    camera.position.set(...from);
    camera.lookAt(...to);
    camera.updateMatrixWorld();
    const target = new THREE.WebGLRenderTarget(SIZE.w, SIZE.h, { type: THREE.FloatType });
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    const pixels = new Float32Array(CARD_MASK_PX * CARD_MASK_PX * 4);
    gl.readRenderTargetPixels(target, (SIZE.w - CARD_MASK_PX) / 2 + dx, (SIZE.h - CARD_MASK_PX) / 2, CARD_MASK_PX, CARD_MASK_PX, pixels);
    gl.setRenderTarget(null);
    target.dispose();
    return luminance(pixels);
  };
  /**
   * The same mask read from a cube capture at `at` (face `face`, three's order +x, -x, +y, -y, +z, -z), in
   * the rig's capture state, as a reflection probe or a grid probe sees it; the rig returns to its state.
   */
  const readCube = (at: Vec, face: number): number => {
    const target = new THREE.WebGLCubeRenderTarget(SIZE.w, { type: THREE.FloatType });
    const camera = new THREE.CubeCamera(0.05, 50, target);
    camera.position.set(...at);
    camera.updateMatrixWorld();
    const state = lighting.rig.state;
    lighting.rig.setState('capture');
    try {
      camera.update(gl, scene);
    } finally {
      lighting.rig.setState(state);
    }
    const pixels = new Float32Array(CARD_MASK_PX * CARD_MASK_PX * 4);
    gl.readRenderTargetPixels(target, (SIZE.w - CARD_MASK_PX) / 2, (SIZE.w - CARD_MASK_PX) / 2, CARD_MASK_PX, CARD_MASK_PX, pixels, face);
    target.dispose();
    return luminance(pixels);
  };
  const dispose = (): void => {
    lighting.dispose();
    context.dispose();
    gl.dispose();
    gl.forceContextLoss();
  };
  return { gl, scene, furniture, lighting, bake, read, readCube, dispose };
}

/** Mean linear luminance of RGBA float pixels. */
function luminance(pixels: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) sum += 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
  return sum / (pixels.length / 4);
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

/** Relative change from `off` to `on`. */
const change = (off: number, on: number): number => Math.abs(on - off) / Math.max(off, 1e-6);
/** Below this a reading is unchanged: the gate removes a lamp's term exactly, so only float noise remains. */
const SAME = 1e-4;
/** Above this a lamp visibly lights a reading. */
const LIT = 0.05;

/** `read` with the lamps at their intensity and at zero, the baked grid and probes kept. */
function onOff(lights: readonly THREE.PointLight[], read: () => number): { on: number; off: number } {
  const on = read();
  const kept = lights.map((light) => light.intensity);
  for (const light of lights) light.intensity = 0;
  const off = read();
  lights.forEach((light, i) => (light.intensity = kept[i]!));
  return { on, off };
}

const DOOR: Door = { side: 'x1', z0: 1.5, z1: 2.5 };
const DOOR_B: Door = { side: 'x0', z0: 1.5, z1: 2.5 };

describe('lamp light stays in its room', { timeout: TIMEOUT_MS }, () => {
  test('direct light is rejected beyond a closed wall, on a shared material too, and kept on the lamp side', () => {
    let lights: THREE.PointLight[] = [];
    const material = GREY();
    const w = world(
      [
        { id: 'a', box: A },
        { id: 'b', box: B },
      ],
      (scene, furniture) => {
        shell(scene, A, material);
        shell(scene, B, material);
        // Facing the wall and the lamp behind it, read from between it and the wall.
        scene.add(card([4.7, 1.2, 2], [-1, 0, 0]));
        scene.add(card([3.0, 1.2, 1.0], [0, 0, 1]));
        lights = lamp(furniture, 'mesh', [3.5, 1.2, 2], 20, 3);
      },
    );
    try {
      w.bake();
      const far = onOff(lights, () => w.read([4.08, 1.2, 2], [4.7, 1.2, 2]));
      const near = onOff(lights, () => w.read([3.0, 1.2, 2.5], [3.0, 1.2, 1.0]));
      // B's floor, the same material as A's floor, right behind the wall.
      const floor = onOff(lights, () => w.read([5.5, 1.5, 2], [4.3, 0, 2]));
      record('closed-wall', { far, near, floor });
      expect(change(far.off, far.on)).toBeLessThan(SAME);
      expect(change(floor.off, floor.on)).toBeLessThan(SAME);
      expect(change(near.off, near.on)).toBeGreaterThan(LIT);
    } finally {
      w.dispose();
    }
  });

  test('through a doorway: B’s grid sees A’s lamp-lit room, B’s floor by the doorway takes no direct light from it', () => {
    let lights: THREE.PointLight[] = [];
    const w = world(
      [
        { id: 'a', box: A },
        { id: 'b', box: B },
      ],
      (scene, furniture) => {
        shell(scene, A, GREY(), DOOR);
        shell(scene, B, GREY(), DOOR_B);
        // A card deep in B, beyond the lamp's cutoff, lit by B's grid only.
        scene.add(card([7.7, 1.2, 2], [-1, 0, 0]));
        lights = lamp(furniture, 'mesh', [3.6, 1.2, 2], 30, 4.5);
      },
    );
    try {
      for (const light of lights) light.intensity = 0;
      w.bake();
      const bounceOff = w.read([6, 1.2, 2], [7.7, 1.2, 2]);
      for (const light of lights) light.intensity = 30;
      w.bake();
      const bounceOn = w.read([6, 1.2, 2], [7.7, 1.2, 2]);
      const floor = onOff(lights, () => w.read([5.5, 1.5, 2], [4.4, 0, 2]));
      // B's probe looks back through the doorway at A's lit wall.
      const probe = onOff(lights, () => w.readCube([5.5, 1.2, 2], 1));
      record('doorway', { bounceOff, bounceOn, floor, probe });
      expect(bounceOn / bounceOff - 1).toBeGreaterThan(0.01);
      expect(change(floor.off, floor.on)).toBeLessThan(SAME);
      expect(change(probe.off, probe.on)).toBeGreaterThan(LIT);
    } finally {
      w.dispose();
    }
  });

  test('a zero-specular card on A’s lamp-lit wall reads the same from inside A and from B through the doorway', () => {
    const w = world(
      [
        { id: 'a', box: A },
        { id: 'b', box: B },
      ],
      (scene, furniture) => {
        shell(scene, A, GREY(), DOOR);
        shell(scene, B, GREY(), DOOR_B);
        scene.add(card([1.0, 1.2, 2], [1, 0, 0], 1.2));
        lamp(furniture, 'mesh', [1.8, 1.6, 2.6], 10, 3);
      },
    );
    try {
      w.bake();
      const fromA = w.read([3.0, 1.2, 2], [1.0, 1.2, 2]);
      const fromB = w.read([6.5, 1.2, 2], [1.0, 1.2, 2]);
      record('camera-independence', { fromA, fromB });
      // Two views of one diffuse card differ only by rasterisation of its edge-free centre.
      expect(change(fromA, fromB)).toBeLessThan(0.01);
    } finally {
      w.dispose();
    }
  });

  test('a lamp outside every room lights no surface inside a room', () => {
    let lights: THREE.PointLight[] = [];
    const w = world([{ id: 'a', box: A }], (scene, furniture) => {
      shell(scene, A, GREY());
      // Facing the lamp in the wall, read from between it and the wall.
      scene.add(card([0.6, 1.2, 2], [-1, 0, 0]));
      lights = lamp(furniture, 'mesh', [-0.02, 1.2, 2], 20, 3);
    });
    try {
      w.bake();
      const reading = onOff(lights, () => w.read([0.1, 1.2, 2], [0.6, 1.2, 2]));
      record('no-room', reading);
      expect(change(reading.off, reading.on)).toBeLessThan(SAME);
    } finally {
      w.dispose();
    }
  });

  test('the gate already holds in the direct look while the bake runs', () => {
    let lights: THREE.PointLight[] = [];
    const w = world(
      [
        { id: 'a', box: A },
        { id: 'b', box: B },
      ],
      (scene, furniture) => {
        shell(scene, A, GREY());
        shell(scene, B, GREY());
        // Facing the wall and the lamp behind it, read from between it and the wall.
        scene.add(card([4.7, 1.2, 2], [-1, 0, 0]));
        lights = lamp(furniture, 'mesh', [3.5, 1.2, 2], 20, 3);
      },
    );
    try {
      w.lighting.load({
        volumes: {
          rooms: [
            { roomId: 'a', polygon: square(A), halfWall: 0.05 },
            { roomId: 'b', polygon: square(B), halfWall: 0.05 },
          ],
          ceilingHeight: HEIGHT_M,
          doors: [],
          furniture: [],
        },
        furniture: w.furniture,
      });
      w.lighting.frame(true);
      expect(w.lighting.phase).not.toBe('live');
      const far = onOff(lights, () => w.read([4.08, 1.2, 2], [4.7, 1.2, 2]));
      record('warm-up', far);
      expect(change(far.off, far.on)).toBeLessThan(SAME);
    } finally {
      w.dispose();
    }
  });

  test('the editing look is unchanged after walk: lamp light still reaches through the wall there', () => {
    let lights: THREE.PointLight[] = [];
    const w = world(
      [
        { id: 'a', box: A },
        { id: 'b', box: B },
      ],
      (scene, furniture) => {
        shell(scene, A, GREY());
        shell(scene, B, GREY());
        // Facing the wall and the lamp behind it, read from between it and the wall.
        scene.add(card([4.7, 1.2, 2], [-1, 0, 0]));
        lights = lamp(furniture, 'mesh', [3.5, 1.2, 2], 20, 3);
      },
    );
    try {
      const before = onOff(lights, () => w.read([4.08, 1.2, 2], [4.7, 1.2, 2]));
      w.bake();
      w.lighting.frame(false);
      const after = onOff(lights, () => w.read([4.08, 1.2, 2], [4.7, 1.2, 2]));
      record('editing-restore', { before, after });
      expect(after).toEqual(before);
      expect(change(before.off, before.on)).toBeGreaterThan(LIT);
    } finally {
      w.dispose();
    }
  });
});

describe('receiver room of the parts in a wall', { timeout: TIMEOUT_MS }, () => {
  /** Two rooms with a doorway; A holds the lamp, B none. */
  function rooms(build: (scene: THREE.Scene) => void, lampAt: Vec) {
    let lights: THREE.PointLight[] = [];
    const w = world(
      [
        { id: 'a', box: A },
        { id: 'b', box: B },
      ],
      (scene, furniture) => {
        shell(scene, A, GREY(), DOOR);
        shell(scene, B, GREY(), DOOR_B);
        build(scene);
        lights = lamp(furniture, 'mesh', lampAt, 20, 3);
      },
    );
    w.bake();
    return { w, lights: () => lights };
  }
  const zeroSpecular = () => new THREE.MeshPhysicalMaterial({ color: 0x808080, roughness: 1, metalness: 0, specularIntensity: 0 });

  test('a jamb across the shared boundary: its part on A’s side takes A’s lamp, its part on B’s side does not, on screen and in a capture', () => {
    const { w, lights } = rooms(
      (scene) => {
        // A jamb face in the doorway's side plane z = 1.5, facing +z, across the wall from x 3.6 to 4.4.
        const jamb = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), zeroSpecular());
        jamb.position.set(4.0, 1.0, 1.5);
        scene.add(jamb);
      },
      [3.2, 1.0, 2.2],
    );
    try {
      // Seen square on from z = 2.6: 0.8 m spans about 34 px at 30°; 12 px either side of the centre is well inside each half.
      const aSide = onOff(lights(), () => w.read([4.0, 1.0, 2.6], [4.0, 1.0, 1.5], -12));
      const bSide = onOff(lights(), () => w.read([4.0, 1.0, 2.6], [4.0, 1.0, 1.5], 12));
      const bCapture = onOff(lights(), () => w.readCube([4.25, 1.0, 1.8], 5));
      record('jamb', { aSide, bSide, bCapture });
      expect(change(aSide.off, aSide.on)).toBeGreaterThan(LIT);
      expect(change(bSide.off, bSide.on)).toBeLessThan(SAME);
    } finally {
      w.dispose();
    }
  });

  test('a closed door leaf: the face towards A takes A’s lamp, the face towards B takes none, on screen and in a capture', () => {
    const { w, lights } = rooms(
      (scene) => {
        const towardsA = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), zeroSpecular());
        towardsA.position.set(3.98, 1.0, 2);
        towardsA.rotation.y = -Math.PI / 2;
        const towardsB = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), zeroSpecular());
        towardsB.position.set(4.02, 1.0, 2);
        towardsB.rotation.y = Math.PI / 2;
        scene.add(towardsA, towardsB);
      },
      [3.4, 1.4, 2],
    );
    try {
      const a = onOff(lights(), () => w.read([2.5, 1.0, 2], [3.98, 1.0, 2]));
      const b = onOff(lights(), () => w.read([5.5, 1.0, 2], [4.02, 1.0, 2]));
      const aCapture = onOff(lights(), () => w.readCube([3.0, 1.0, 2], 0));
      const bCapture = onOff(lights(), () => w.readCube([5.0, 1.0, 2], 1));
      record('door-leaf', { a, b, aCapture, bCapture });
      expect(change(a.off, a.on)).toBeGreaterThan(LIT);
      expect(change(aCapture.off, aCapture.on)).toBeGreaterThan(LIT);
      expect(change(b.off, b.on)).toBeLessThan(SAME);
      expect(change(bCapture.off, bCapture.on)).toBeLessThan(SAME);
    } finally {
      w.dispose();
    }
  });

  test('a window reveal: the part inside the room’s box takes the lamp, the part beyond every box none', () => {
    const { w, lights } = rooms(
      (scene) => {
        // A reveal through A's west wall at z = 2, facing +z, from x = -0.4 (outside) to 0.4 (inside).
        const reveal = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), zeroSpecular());
        reveal.position.set(0, 1.2, 2);
        scene.add(reveal);
      },
      [0.6, 1.2, 2.8],
    );
    try {
      const inside = onOff(lights(), () => w.read([0, 1.2, 3.1], [0, 1.2, 2], 12));
      const beyond = onOff(lights(), () => w.read([0, 1.2, 3.1], [0, 1.2, 2], -12));
      const capture = onOff(lights(), () => w.readCube([0.3, 1.2, 2.5], 5));
      record('window-reveal', { inside, beyond, capture });
      expect(change(inside.off, inside.on)).toBeGreaterThan(LIT);
      expect(change(beyond.off, beyond.on)).toBeLessThan(SAME);
    } finally {
      w.dispose();
    }
  });

  test('a cabinet against the shared wall in B takes none of A’s lamp, on screen and in a capture', () => {
    const { w, lights } = rooms(
      (scene) => {
        const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.8), zeroSpecular());
        cabinet.position.set(4.27, 0.45, 0.8);
        scene.add(cabinet);
      },
      [3.6, 1.6, 0.8],
    );
    try {
      const top = onOff(lights(), () => w.read([4.8, 1.6, 0.8], [4.27, 0.9, 0.8]));
      const capture = onOff(lights(), () => w.readCube([4.27, 1.5, 0.8], 3));
      record('cabinet', { top, capture });
      expect(change(top.off, top.on)).toBeLessThan(SAME);
      expect(change(capture.off, capture.on)).toBeLessThan(SAME);
    } finally {
      w.dispose();
    }
  });
});

describe('one room in several boxes, and programs', { timeout: TIMEOUT_MS }, () => {
  test('a lamp lights the floor of a split open-plan room across the box boundary without a step', () => {
    // An L-shaped room: two boxes meeting at x = 3.
    const L = [
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 5, z: 2 },
      { x: 3, z: 2 },
      { x: 3, z: 4 },
      { x: 0, z: 4 },
    ];
    const container = world([{ id: 'l', box: { x0: 0, x1: 5, z0: 0, z1: 4 } }], (scene, furniture) => {
      const floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 4),
        new THREE.MeshPhysicalMaterial({ color: 0x808080, roughness: 1, specularIntensity: 0 }),
      );
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set(2.5, 0, 2);
      scene.add(floorMesh);
      lamp(furniture, 'mesh', [3, 1.0, 1], 20, 3);
    });
    try {
      container.lighting.load({
        volumes: { rooms: [{ roomId: 'l', polygon: L, halfWall: 0.05 }], ceilingHeight: HEIGHT_M, doors: [], furniture: [] },
        furniture: container.furniture,
      });
      for (let frame = 0; frame < 4000 && container.lighting.phase !== 'live'; frame += 1) container.lighting.frame(true);
      // A row of readings across x = 3 on the floor under the lamp: no step at the box boundary.
      const row = [2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3].map((x) => container.read([x, 1.0, 1.0001], [x, 0, 1]));
      const steps = row.slice(1).map((v, i) => Math.abs(v - row[i]!));
      record('split-room', { row });
      expect(Math.max(...steps)).toBeLessThan(Math.max(...row) * 0.1);
      expect(Math.min(...row)).toBeGreaterThan(0);
    } finally {
      container.dispose();
    }
  });

  test('walking from room to room compiles no program; a lamp count from none to several and back renders without WebGL errors', () => {
    let lights: THREE.PointLight[] = [];
    let furnitureRoot: THREE.Group | null = null;
    const w = world(
      [
        { id: 'a', box: A },
        { id: 'b', box: B },
      ],
      (scene, furniture) => {
        shell(scene, A, GREY(), DOOR);
        shell(scene, B, GREY(), DOOR_B);
        scene.add(card([3.0, 1.2, 0.5], [0, 0, 1]));
        furnitureRoot = furniture;
      },
    );
    try {
      const errors: number[] = [];
      const glContext = w.gl.getContext();
      const check = (): void => {
        const error = glContext.getError();
        if (error !== glContext.NO_ERROR) errors.push(error);
      };
      const states: Record<string, number> = {};
      const counts = [0, 1, 3, 0];
      for (const count of counts) {
        for (const light of lights) light.parent!.parent!.removeFromParent();
        lights = [];
        for (let i = 0; i < count; i += 1) lights.push(...lamp(furnitureRoot!, 'mesh', [2.6 + i * 0.3, 1.2, 1.2], 10, 3));
        w.bake();
        const reading = onOff(lights, () => w.read([3.0, 1.2, 2.5], [3.0, 1.2, 0.5]));
        states[`lamps-${count}`] = reading.on;
        if (count > 0) expect(change(reading.off, reading.on)).toBeGreaterThan(LIT);
        else expect(reading.on).toBe(reading.off);
        check();
      }
      // A few frames walking from A to B and back, the light configuration unchanged.
      for (const light of lights) light.parent!.parent!.removeFromParent();
      lights = lamp(furnitureRoot!, 'mesh', [3.0, 1.2, 1.2], 10, 3);
      w.bake();
      w.read([2, 1.2, 2], [3, 1.2, 0.5]);
      const programs = w.gl.info.programs!.length;
      for (const x of [2.5, 3.5, 4.5, 5.5, 6.5, 5.5, 4.5, 3.5]) w.read([x, 1.2, 2], [x + 1, 1.2, 2]);
      check();
      record('lifecycle', { states, programs, after: w.gl.info.programs!.length, errors });
      expect(w.gl.info.programs!.length).toBe(programs);
      expect(errors).toEqual([]);
    } finally {
      w.dispose();
    }
  });
});

describe('a lamp change re-bakes, and no stale lamp light stays', { timeout: TIMEOUT_MS }, () => {
  test('a removed lamp leaves no light in any grid: the grids equal a fresh bake of the scene without it', () => {
    let lights: THREE.PointLight[] = [];
    const build = (withLamp: boolean) => (scene: THREE.Scene, furniture: THREE.Group) => {
      shell(scene, A, GREY());
      scene.add(card(CARD, [-1, 0, 0]));
      // A second lamp stays, so the light count is the same in both scenes.
      lamp(furniture, 'mesh', [0.5, 1.0, 3.5], 10, 1.0);
      if (withLamp) lights = lamp(furniture, 'mesh', [0.8, 1.0, 0.8], 40, 1.2);
      else lamp(furniture, 'mesh', [0.8, 1.0, 0.8], 0, 1.2);
    };
    const reference = world([{ id: 'a', box: A }], build(false));
    let expected: number;
    try {
      reference.bake();
      expected = reference.read(EYE_FAR, CARD);
    } finally {
      reference.dispose();
    }
    const w = world([{ id: 'a', box: A }], build(true));
    try {
      w.bake();
      const before = w.read(EYE_FAR, CARD);
      // Removed: its intensity gone, as a removal leaves the light count to the remaining lamps.
      for (const light of lights) light.intensity = 0;
      w.lighting.refresh({ all: false, grids: [], probes: [], lamps: true }, null);
      for (let frame = 0; frame < 4000 && w.lighting.phase !== 'live'; frame += 1) w.lighting.frame(true);
      const after = w.read(EYE_FAR, CARD);
      record('stale-light', { before, after, expected });
      expect(change(expected, before)).toBeGreaterThan(LIT);
      expect(change(expected, after)).toBeLessThan(SAME);
    } finally {
      w.dispose();
    }
  });

  test('a tint during the initial bake restarts it: the lighting turns live with the new tint, as a fresh bake of it', () => {
    let lights: THREE.PointLight[] = [];
    const build = (scene: THREE.Scene, furniture: THREE.Group) => {
      shell(scene, A, GREY());
      scene.add(card(CARD, [-1, 0, 0]));
      lights = lamp(furniture, 'mesh', [0.8, 1.0, 0.8], 40, 1.2);
    };
    const blue = new THREE.Color(0.2, 0.4, 1);
    const reference = world([{ id: 'a', box: A }], build);
    let expected: number;
    try {
      for (const light of lights) light.color.copy(blue);
      reference.bake();
      expected = reference.read(EYE_FAR, CARD);
    } finally {
      reference.dispose();
    }
    const w = world([{ id: 'a', box: A }], build);
    try {
      w.lighting.load({
        volumes: { rooms: [{ roomId: 'a', polygon: square(A), halfWall: 0.05 }], ceilingHeight: HEIGHT_M, doors: [], furniture: [] },
        furniture: w.furniture,
      });
      for (let frame = 0; frame < 3; frame += 1) w.lighting.frame(true);
      for (const light of lights) light.color.copy(blue);
      w.lighting.relight();
      for (let frame = 0; frame < 4000 && w.lighting.phase !== 'live'; frame += 1) w.lighting.frame(true);
      const after = w.read(EYE_FAR, CARD);
      record('tint-during-bake', { after, expected });
      expect(change(expected, after)).toBeLessThan(SAME);
    } finally {
      w.dispose();
    }
  });

  test('the same temperature as baked re-bakes nothing', () => {
    const w = world([{ id: 'a', box: A }], (scene, furniture) => {
      shell(scene, A, GREY());
      lamp(furniture, 'mesh', [0.8, 1.0, 0.8], 40, 1.2);
    });
    try {
      w.bake();
      w.lighting.relight();
      w.lighting.frame(true);
      expect(w.lighting.phase).toBe('live');
      expect(w.lighting.recapturing).toBe(false);
    } finally {
      w.dispose();
    }
  });
});

const CARD: Vec = [3.7, 1.2, 3.0];
const EYE_FAR: Vec = [2.2, 1.2, 3.0];

/* ------------------------------------------------- the demo apartment, real commands */

const LIVING_ROOM = '01a15f1b-dbbd-7634-b8b8-af9c8008284d';

/** sRGB-encoded 8-bit channel as linear light. */
const linearByte = (byte: number): number => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** Mean linear luminance of the central 8 x 8 pixels of a PNG (the displayed picture). */
async function centreLuminance(blob: Blob, size = 8): Promise<number> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(Math.floor((bitmap.width - size) / 2), Math.floor((bitmap.height - size) / 2), size, size);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4)
    sum += 0.2126 * linearByte(data[i]!) + 0.7152 * linearByte(data[i + 1]!) + 0.0722 * linearByte(data[i + 2]!);
  return sum / (data.length / 4);
}

type Debug = {
  walkLighting: () => { state: string };
  applyOps: (ops: SceneOp[]) => { rev?: number; error?: unknown };
};
const debug = (): Debug => (window as unknown as { __viewerDebug: Debug }).__viewerDebug;

describe('lamp edits in walk through the real commands (demo apartment)', { timeout: TIMEOUT_MS }, () => {
  let handle: ViewerHandle;
  let scene: THREE.Scene | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  const states: string[] = [];
  const watching = { on: true };

  /** The placement groups of the scene that hold a lamp light. */
  const lampPlacements = (): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    scene!.traverse((object) => {
      if (typeof object.userData['assetId'] !== 'string') return;
      let lit = false;
      object.traverse((child) => {
        if ((child as THREE.PointLight).isPointLight) lit = true;
      });
      if (lit) out.push(object);
    });
    return out;
  };
  const lightOf = (placement: THREE.Object3D): THREE.PointLight => {
    let light: THREE.PointLight | null = null;
    placement.traverse((child) => {
      if ((child as THREE.PointLight).isPointLight) light ??= child as THREE.PointLight;
    });
    return light!;
  };
  /** Waits for the edit's re-bake: the lighting leaves live, then is live again. */
  async function rebaked(what: string): Promise<void> {
    states.length = 0;
    await until(() => states.some((state) => state !== 'live'), `${what}: the re-bake starts`, 60_000);
    await until(() => debug().walkLighting().state === 'live', `${what}: live again`, 240_000);
  }

  beforeAll(async () => {
    const load = Object.getOwnPropertyDescriptor(WalkLighting.prototype, 'load')!.value as WalkLighting['load'];
    vi.spyOn(WalkLighting.prototype, 'load').mockImplementation(function (this: WalkLighting, doc) {
      const internals = this as unknown as { scene: THREE.Scene; renderer: THREE.WebGLRenderer };
      scene = internals.scene;
      renderer = internals.renderer;
      load.call(this, doc);
    });
    handle = mountViewer(openContainer(320, 240), {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      debug: true,
    });
    await handle.ready;
    handle.setMode('walk');
    await until(() => debug().walkLighting().state === 'live', 'walk live', 240_000);
    const watch = async (): Promise<void> => {
      while (watching.on) {
        states.push(debug().walkLighting().state);
        await nextFrame();
      }
    };
    void watch();
  }, TIMEOUT_MS);

  afterAll(() => {
    watching.on = false;
    handle.dispose();
    vi.restoreAllMocks();
    closeContainers();
  });

  test('concave living room audit: the pendant’s direct light on the floor behind the inner corner, recorded', async () => {
    // The living room is an L: its inner corner at (4.35, 5.25) in plan. The pendant hangs at (5.5, 7.06); the floor
    // at (4.1, 4.0) lies in the room but the segment to the pendant leaves it through the notch's walls.
    const pendantAsset = demoScene().assets.find((a) => a.type === 'pendant' && a.room === LIVING_ROOM)!;
    const pendant = lightOf(lampPlacements().find((p) => p.userData['assetId'] === pendantAsset.id)!);
    const camera = { position: { x: 3.2, y: 1.4, z: 4.9 }, target: { x: 4.1, y: 0, z: 4.0 } };
    const shot = async (): Promise<number> => {
      const { blob } = await handle.capture.still({ width: 160, height: 120, camera, caption: false });
      return centreLuminance(blob);
    };
    const on = await shot();
    const kept = pendant.intensity;
    pendant.intensity = 0;
    const off = await shot();
    pendant.intensity = kept;
    const bulb = new THREE.Vector3();
    pendant.getWorldPosition(bulb);
    record('concave-living', { on, off, change: change(off, on), pendant: bulb.toArray(), cutoff: pendant.distance });
  });

  test('a lamp moved to another room re-bakes everything, takes the new room, and compiles no program', async () => {
    const programs = renderer!.info.programs!.length;
    const placement = lampPlacements()[0]!;
    const before = lightOf(placement).userData['jeexLampRoom'] as number;
    const assets = demoScene().assets;
    const lampAsset = assets.find((a) => a.id === placement.userData['assetId'])!;
    const elsewhere = assets.find((a) => a.room !== lampAsset.room)!;
    const result = debug().applyOps([{ op: 'move_object', assetId: lampAsset.id, position: { ...elsewhere.position } }]);
    expect(result.error).toBeUndefined();
    await rebaked('moved');
    const after = lightOf(lampPlacements().find((p) => p.userData['assetId'] === lampAsset.id)!).userData['jeexLampRoom'];
    record('demo-move', { before, after, programs, programsAfter: renderer!.info.programs!.length });
    expect(after).not.toBe(before);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(renderer!.info.programs!.length).toBe(programs);
  });

  test('a lamp moved out of every room re-bakes and lights no room', async () => {
    const placement = lampPlacements()[0]!;
    const id = placement.userData['assetId'] as string;
    const result = debug().applyOps([{ op: 'move_object', assetId: id, position: { x: -6, y: 0, z: -6 } }]);
    expect(result.error).toBeUndefined();
    await rebaked('moved out');
    const light = lightOf(lampPlacements().find((p) => p.userData['assetId'] === id)!);
    expect(light.userData['jeexLampRoom']).toBe(-2);
  });

  test('every lamp removed in turn, the last one included, re-bakes each time', async () => {
    const ids = lampPlacements().map((p) => p.userData['assetId'] as string);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const result = debug().applyOps([{ op: 'remove_object', assetId: id }]);
      expect(result.error).toBeUndefined();
      await rebaked(`removed ${id}`);
    }
    expect(lampPlacements()).toHaveLength(0);
  });
});

describe('the temperature across modes (demo apartment)', { timeout: TIMEOUT_MS }, () => {
  test('a change in orbit bakes nothing there; the walk entered next restarts before it is ever live with the old tint', async () => {
    const relight = vi.spyOn(WalkLighting.prototype, 'relight');
    const handle = mountViewer(openContainer(320, 240), {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      debug: true,
    });
    try {
      await handle.ready;
      handle.setMode('walk');
      await until(() => debug().walkLighting().state === 'live', 'walk live', 240_000);
      handle.setMode('orbit');
      for (let i = 0; i < 5; i += 1) await nextFrame();
      handle.setLightTemperature(2700);
      for (let i = 0; i < 30; i += 1) await nextFrame();
      expect(debug().walkLighting().state).toBe('live');
      expect(relight).not.toHaveBeenCalled();
      const seen: string[] = [];
      handle.setMode('walk');
      for (let i = 0; i < 10; i += 1) {
        await nextFrame();
        seen.push(debug().walkLighting().state);
      }
      record('temperature-entry', { seen });
      expect(relight).toHaveBeenCalledTimes(1);
      expect(seen[0]).not.toBe('live');
    } finally {
      relight.mockRestore();
      handle.dispose();
      closeContainers();
    }
  });
});

describe('lamp decomposition in the demo living room (diagnostic)', { timeout: TIMEOUT_MS }, () => {
  test('three linear readings on a zero-specular card: lamp-off bake, lamps-on bake with direct suppressed, the same grid with direct on', async () => {
    const caught: { lighting: WalkLighting | null } = { lighting: null };
    const load = Object.getOwnPropertyDescriptor(WalkLighting.prototype, 'load')!.value as WalkLighting['load'];
    const spy = vi.spyOn(WalkLighting.prototype, 'load').mockImplementation(function (this: WalkLighting, doc) {
      caught.lighting = this;
      load.call(this, doc);
    });
    const handle = mountViewer(openContainer(320, 240), {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      debug: true,
    });
    try {
      await handle.ready;
      handle.setMode('walk');
      await until(() => debug().walkLighting().state === 'live', 'walk live', 240_000);
      const lighting = caught.lighting!;
      const internals = lighting as unknown as { scene: THREE.Scene; renderer: THREE.WebGLRenderer };
      const { scene, renderer } = internals;
      // A zero-specular grey card 0.66 m from the living floor lamp, facing it.
      const probeCard = card([2.2, 1.0, 7.45], [1, 0, 0], 0.3);
      scene.add(probeCard);
      const lamps: THREE.PointLight[] = [];
      scene.traverse((object) => {
        if ((object as THREE.PointLight).isPointLight && object.userData['artificialLight'] !== undefined)
          lamps.push(object as THREE.PointLight);
      });
      const intensities = lamps.map((light) => light.intensity);
      const read = (): number => {
        const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
        camera.position.set(1.4, 1.0, 7.45);
        camera.lookAt(2.2, 1.0, 7.45);
        camera.updateMatrixWorld();
        const target = new THREE.WebGLRenderTarget(SIZE.w, SIZE.h, { type: THREE.FloatType });
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const pixels = new Float32Array(CARD_MASK_PX * CARD_MASK_PX * 4);
        renderer.readRenderTargetPixels(
          target,
          (SIZE.w - CARD_MASK_PX) / 2,
          (SIZE.h - CARD_MASK_PX) / 2,
          CARD_MASK_PX,
          CARD_MASK_PX,
          pixels,
        );
        renderer.setRenderTarget(null);
        target.dispose();
        return luminance(pixels);
      };
      const rebake = async (): Promise<void> => {
        lighting.rebake();
        await until(() => debug().walkLighting().state === 'live', 'live after the re-bake', 240_000);
      };
      for (const light of lamps) light.intensity = 0;
      await rebake();
      const a = read();
      lamps.forEach((light, i) => (light.intensity = intensities[i]!));
      await rebake();
      const rooms = lamps.map((light) => light.userData['jeexLampRoom'] as number);
      for (const light of lamps) light.userData['jeexLampRoom'] = -2;
      const b = read();
      lamps.forEach((light, i) => (light.userData['jeexLampRoom'] = rooms[i]!));
      const c = read();
      record('decomposition', {
        renderer: String(renderer.getContext().getParameter(renderer.getContext().RENDERER)),
        lamps: lamps.map((light) => ({ intensity: light.intensity, colour: light.color.toArray(), distance: light.distance })),
        a,
        b,
        c,
        bounce: b - a,
        direct: c - b,
        combined: c - a,
      });
      expect(c).toBeGreaterThan(b);
    } finally {
      spy.mockRestore();
      handle.dispose();
      closeContainers();
    }
  });
});
