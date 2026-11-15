/**
 * The room lighting decided per fragment, in a real browser on the GPU:
 *
 * - the room probes are seamless across a cube face edge at the roughest
 *   level (each probe face carries a one-texel border of its neighbours);
 * - a mirror surface (roughness at three's minimum) reads the probe's sharp
 *   level, the PMREM's mirror level, so a sharp edge stays sharp in it;
 * - the probe's roughness-to-level mapping, run on the GPU beside three's
 *   own `roughnessToMip`: level 0 at the mirror end, a continuous hand-over,
 *   and three's value exactly above it;
 * - the room grid a fragment is lit by is chosen per fragment from the room
 *   boxes, so a cabinet standing against a wall (partly outside the grid's
 *   inset sampling box) is lit by the room each face looks into and never by
 *   the exterior grid; a piece of an opening (a door leaf on the wall
 *   centreline between two rooms) takes one room's grid, the room of its
 *   origin, across its whole face.
 *
 * Measurements are written to `test-results/room-lighting-fragments.json`
 * (git-ignored).
 */

import * as THREE from 'three';
import { afterAll, describe, expect, test } from 'vitest';
import { commands } from 'vitest/browser';
import { WalkLighting } from '../../src/render/walk-post.js';
import { createLightingContext } from '../../src/lighting/lighting-context.js';
import type { RoomProbe } from '../../src/render/walk-lighting/room-volumes.js';
import { PROBE_HANDOVER_ROUGHNESS, PROBE_MIP_GLSL, PROBE_PMREM_MAX_LOD } from '../../src/render/walk-lighting/box-probe-patch.js';
import { closeContainers, openContainer } from './support.js';

const TIMEOUT_MS = 300_000;
const HEIGHT_M = 2.6;
const results: Record<string, unknown> = {};

afterAll(async () => {
  closeContainers();
  await commands.writeFile('test-results/room-lighting-fragments.json', JSON.stringify(results, null, 2));
});

type Rect = { x0: number; x1: number; z0: number; z1: number };

const matte = (hex: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9 });

function box(scene: THREE.Scene, material: THREE.Material, min: [number, number, number], max: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), material);
  mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

/** Four walls (except `open`), a ceiling and a floor around `r`, grey and matte, each a thin box. */
function shell(scene: THREE.Scene, r: Rect, open: 'x0' | 'x1' | null = null): void {
  const grey = matte(0x9a9a9a);
  const t = 0.02;
  if (open !== 'x0') box(scene, grey, [r.x0 - t, 0, r.z0], [r.x0, HEIGHT_M, r.z1]);
  if (open !== 'x1') box(scene, grey, [r.x1, 0, r.z0], [r.x1 + t, HEIGHT_M, r.z1]);
  box(scene, grey, [r.x0, 0, r.z0 - t], [r.x1, HEIGHT_M, r.z0]);
  box(scene, grey, [r.x0, 0, r.z1], [r.x1, HEIGHT_M, r.z1 + t]);
  box(scene, grey, [r.x0, HEIGHT_M, r.z0], [r.x1, HEIGHT_M + t, r.z1]);
  box(scene, grey, [r.x0, -t, r.z0], [r.x1, 0, r.z1]);
}

/** An unlit panel the probes see as a light source of `colour` (linear, above 1 for a bright source). */
function panel(scene: THREE.Scene, colour: [number, number, number], min: [number, number, number], max: [number, number, number]): void {
  box(scene, new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...colour, THREE.LinearSRGBColorSpace) }), min, max);
}

const square = (r: Rect) => [
  { x: r.x0, z: r.z0 },
  { x: r.x1, z: r.z0 },
  { x: r.x1, z: r.z1 },
  { x: r.x0, z: r.z1 },
];

/** A renderer, the apartment rig without its sun and the room lighting over `rooms`, baked and live. */
function world(
  rooms: Array<{ id: string; rect: Rect }>,
  doors: Array<{ into: string; other: string | null }>,
  build: (scene: THREE.Scene) => void,
) {
  const size = { w: 320, h: 240 };
  const container = openContainer(size.w, size.h);
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const gl = new THREE.WebGLRenderer({ canvas });
  gl.setPixelRatio(1);
  gl.setSize(size.w, size.h, false);
  gl.shadowMap.enabled = true;
  const context = createLightingContext(THREE, gl);
  const scene = new THREE.Scene();
  context.createApartmentRig().attach(scene);
  (scene.getObjectByName('jeex-lighting-sun') as THREE.Light).intensity = 0;
  build(scene);
  const lighting = new WalkLighting(gl, scene);
  lighting.load({
    volumes: {
      rooms: rooms.map((room) => ({ roomId: room.id, polygon: square(room.rect), halfWall: 0.05 })),
      ceilingHeight: HEIGHT_M,
      doors,
      furniture: [],
    },
    furniture: null,
  });
  for (let frame = 0; frame < 4000 && lighting.phase !== 'live'; frame += 1) lighting.frame(true);
  expect(lighting.phase).toBe('live');
  const shoot = (position: THREE.Vector3Like, target: THREE.Vector3Like, options: { fov?: number; up?: THREE.Vector3Like } = {}) => {
    const camera = new THREE.PerspectiveCamera(options.fov ?? 50, size.w / size.h, 0.02, 50);
    if (options.up) camera.up.set(options.up.x, options.up.y, options.up.z);
    camera.position.copy(position);
    camera.lookAt(target.x, target.y, target.z);
    camera.updateMatrixWorld();
    const target2 = new THREE.WebGLRenderTarget(size.w, size.h, { type: THREE.FloatType });
    gl.setRenderTarget(target2);
    gl.render(scene, camera);
    const pixels = new Float32Array(size.w * size.h * 4);
    gl.readRenderTargetPixels(target2, 0, 0, size.w, size.h, pixels);
    gl.setRenderTarget(null);
    target2.dispose();
    const at = (x: number, y: number): [number, number, number] => {
      const i = (y * size.w + x) * 4;
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    };
    return { camera, at };
  };
  const probes = (): readonly RoomProbe[] => (lighting as unknown as { volumes: { probes: RoomProbe[] } }).volumes.probes;
  const dispose = (): void => {
    lighting.dispose();
    context.dispose();
    gl.dispose();
    gl.forceContextLoss();
  };
  return { size, shoot, probes, dispose };
}

/** `jeexProbeMip` and three r187's own `roughnessToMip` (over the probe's levels) at each roughness, on the GPU. */
function probeLevels(roughness: readonly number[]): Array<{ ours: number; three: number }> {
  const chunk = THREE.ShaderChunk.envmap_common_pars_fragment;
  const three = /float roughnessToMip\( const in float roughness \) \{[\s\S]*?\n\t\t\}/.exec(chunk)?.[0];
  expect(three).toBeDefined();
  const canvas = document.createElement('canvas');
  openContainer(8, 8).appendChild(canvas);
  const gl = new THREE.WebGLRenderer({ canvas });
  const target = new THREE.WebGLRenderTarget(roughness.length, 1, { type: THREE.FloatType });
  const material = new THREE.ShaderMaterial({
    uniforms: { values: { value: [...roughness] } },
    defines: { ENVMAP_MAX_LOD: `${PROBE_PMREM_MAX_LOD}.0`, COUNT: roughness.length },
    vertexShader: 'void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
    fragmentShader: `uniform float values[ COUNT ];
${PROBE_MIP_GLSL}
${three!}
void main() {
	float r = values[ int( gl_FragCoord.x ) ];
	gl_FragColor = vec4( jeexProbeMip( r ), roughnessToMip( r ), 0.0, 1.0 );
}`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const scene = new THREE.Scene();
  scene.add(quad);
  gl.setRenderTarget(target);
  gl.render(scene, new THREE.OrthographicCamera());
  const pixels = new Float32Array(roughness.length * 4);
  gl.readRenderTargetPixels(target, 0, 0, roughness.length, 1, pixels);
  gl.setRenderTarget(null);
  target.dispose();
  material.dispose();
  gl.dispose();
  gl.forceContextLoss();
  return roughness.map((_, i) => ({ ours: pixels[i * 4]!, three: pixels[i * 4 + 1]! }));
}

const luminance = ([r, g, b]: readonly number[]): number => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;

describe('room lighting decided per fragment', { timeout: TIMEOUT_MS }, () => {
  test('a rough metal floor (roughness 1) lit by one room’s probe reads the same on both sides of a cube face edge, within 1 %', () => {
    const A: Rect = { x0: 0, x1: 4, z0: 0, z1: 4 };
    const w = world([{ id: '019a8b3c-1f00-7000-8000-00000000000a', rect: A }], [], (scene) => {
      shell(scene, A);
      // A warm panel under the far half of the ceiling: across the edge read below, the probe's light falls
      // steeply from its upper face to its side face, so a seam would show as a step.
      panel(scene, [4, 1.2, 0.6], [2.05, HEIGHT_M - 0.03, 0], [4, HEIGHT_M - 0.01, 4]);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 4),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(2, 0.001, 2);
      scene.add(floor);
    });
    // Roughness 1 reflects along the normal; box-projected onto the ceiling, a floor point (x, 0, z) reads the
    // probe along (x - px, H - py, z - pz), which crosses from the +Y face to the -X face where x - px = py - H.
    const probe = w.probes()[0]!.position;
    const edgeX = probe.x - (HEIGHT_M - probe.y);
    const { camera, at } = w.shoot(
      { x: edgeX, y: 1.2, z: probe.z },
      { x: edgeX, y: 0, z: probe.z },
      { fov: 10, up: { x: 0, y: 0, z: -1 } },
    );
    const pixel = (x: number): { px: number; py: number } => {
      const p = new THREE.Vector3(x, 0, probe.z).project(camera);
      return { px: Math.round(((p.x + 1) / 2) * w.size.w), py: Math.round(((p.y + 1) / 2) * w.size.h) };
    };
    const edge = pixel(edgeX);
    // The pixels either side of the edge, about a millimetre of floor apart.
    const before = at(edge.px - 1, edge.py);
    const after = at(edge.px + 1, edge.py);
    const mean = (luminance(before) + luminance(after)) / 2;
    const step = Math.abs(luminance(before) - luminance(after)) / mean;
    // The reflection is the probe's: the warm panel tints it, which the studio environment never does.
    results['seam'] = { probe, edgeX, edge, before, after, step };
    expect(before[0] / before[2]).toBeGreaterThan(1.3);
    expect(step).toBeLessThan(0.01);
    w.dispose();
  });

  test('the probe’s roughness-to-level mapping reads level 0 at the mirror end and hands over to three’s own, unchanged above', () => {
    const below = PROBE_HANDOVER_ROUGHNESS - 1e-4;
    const [mirror, clamped, justBelow, handOver, rough, roughest] = probeLevels([0.02, 0.045, below, PROBE_HANDOVER_ROUGHNESS, 0.5, 1]);
    results['levels'] = { mirror, clamped, justBelow, handOver, rough, roughest };
    // A mirror finish (0.02) and three's minimum roughness (0.045) read the mirror level alone.
    expect(mirror!.ours).toBe(0);
    expect(clamped!.ours).toBe(0);
    // At the hand-over the read is three's own value; just below it, within the slope's step. The two are
    // separate GPU expressions, so they are compared to 5e-6 of a level (a compiler may order the operations
    // otherwise); a hand-over off by 0.005 of roughness already misses three's level by over 0.02.
    expect(handOver!.ours).toBeCloseTo(handOver!.three, 5);
    expect(Math.abs(justBelow!.ours - justBelow!.three)).toBeLessThan(2e-3);
    // Rough surfaces keep three's mapping, to the same 5e-6 of a level.
    expect(rough!.ours).toBeCloseTo(rough!.three, 5);
    expect(roughest!.ours).toBeCloseTo(roughest!.three, 5);
  });

  test('a mirror floor (roughness at three’s minimum) reads the probe’s sharp level: ceiling stripes keep their contrast', () => {
    const A: Rect = { x0: 0, x1: 4, z0: 0, z1: 4 };
    const w = world([{ id: '019a8b3c-1f00-7000-8000-00000000000c', rect: A }], [], (scene) => {
      shell(scene, A);
      // Bright stripes under the ceiling, 8 cm apart: about five probe texels each at the probe's distance.
      for (let x = 0.4; x < 3.6; x += 0.16) panel(scene, [4, 4, 4], [x, HEIGHT_M - 0.03, 0.4], [x + 0.08, HEIGHT_M - 0.01, 3.6]);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 4),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0, metalness: 1 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(2, 0.001, 2);
      scene.add(floor);
    });
    const probe = w.probes()[0]!.position;
    const { at } = w.shoot({ x: probe.x, y: 1.2, z: probe.z }, { x: probe.x, y: 0, z: probe.z }, { fov: 30, up: { x: 0, y: 0, z: -1 } });
    // One row across the stripes' reflection, through the image centre.
    const row = Array.from({ length: 200 }, (_, i) => luminance(at(60 + i, w.size.h / 2)));
    const max = Math.max(...row);
    const min = Math.min(...row);
    const contrast = (max - min) / (max + min);
    results['mirror'] = { probe, max, min, contrast };
    // The probe's mirror level alone keeps 0.89 of it, three's blend at 0.045 0.77; a level one roughness step blurrier (0.106) leaves 0.65.
    expect(contrast).toBeGreaterThan(0.72);
    w.dispose();
  });

  test('a cabinet against a wall is lit by the room each face looks into, a door leaf in its opening by the room of its origin on both faces', () => {
    // Two rooms on either side of a 0.1 m wall at x = 4.0 to 4.1, a closed door leaf filling its opening.
    const A: Rect = { x0: 0, x1: 4, z0: 0, z1: 4 };
    const B: Rect = { x0: 4.1, x1: 8.1, z0: 0, z1: 4 };
    const roomA = '019a8b3c-1f00-7000-8000-0000000000a1';
    const roomB = '019a8b3c-1f00-7000-8000-0000000000b1';
    const w = world(
      [
        { id: roomA, rect: A },
        { id: roomB, rect: B },
      ],
      [{ into: roomA, other: roomB }],
      (scene) => {
        shell(scene, A, 'x1');
        shell(scene, B, 'x0');
        const grey = matte(0x9a9a9a);
        // The shared wall with a 0.8 m opening at z 2.5 to 3.3 under a header at 2.0 m.
        box(scene, grey, [4, 0, 0], [4.1, HEIGHT_M, 2.5]);
        box(scene, grey, [4, 0, 3.3], [4.1, HEIGHT_M, 4]);
        box(scene, grey, [4, 2, 2.5], [4.1, HEIGHT_M, 3.3]);
        // Room A is lit red, room B green, each by a panel on its far wall.
        panel(scene, [6, 0.3, 0.3], [0.01, 0.4, 0.5], [0.03, 2.2, 3.5]);
        panel(scene, [0.3, 6, 0.3], [8.07, 0.4, 0.5], [8.09, 2.2, 3.5]);
        const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
        // The cabinet stands on room A's floor against the shared wall, deeper than the grid's inset.
        box(scene, white, [3.4, 0, 0.8], [4, 0.9, 1.8]);
        // The door leaf fills the opening, 4 cm thick, its faces 3 cm inside the wall's faces, built as the
        // opening builder builds it: a leaf group in the opening's group, its origin on the wall centreline,
        // where room A (the room it swings into, listed first) holds it.
        const opening = new THREE.Group();
        opening.userData['surface'] = 'opening';
        const leaf = new THREE.Group();
        leaf.userData['isDoorLeaf'] = true;
        leaf.position.set(4.05, 0, 2.5);
        const face = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2, 0.8), white.clone());
        face.position.set(0, 1, 0.4);
        leaf.add(face);
        opening.add(leaf);
        scene.add(opening);
      },
    );
    const centre = (from: THREE.Vector3Like, to: THREE.Vector3Like): [number, number, number] => {
      const { at } = w.shoot(from, to, { fov: 10 });
      return at(w.size.w / 2, w.size.h / 2);
    };
    const cabinetFront = centre({ x: 1.5, y: 0.5, z: 1.3 }, { x: 3.4, y: 0.5, z: 1.3 });
    const cabinetTop = centre({ x: 3.0, y: 1.8, z: 1.3 }, { x: 3.7, y: 0.9, z: 1.3 });
    const leafA = centre({ x: 1.5, y: 1, z: 2.9 }, { x: 4.03, y: 1, z: 2.9 });
    const leafB = centre({ x: 6.6, y: 1, z: 2.9 }, { x: 4.07, y: 1, z: 2.9 });
    results['rooms'] = { cabinetFront, cabinetTop, leafA, leafB };
    for (const red of [cabinetFront, cabinetTop, leafA]) expect(red[0]).toBeGreaterThan(red[1] * 2);
    // The leaf's face into room B is lit by room A's grid too.
    expect(leafB[0]).toBeGreaterThan(leafB[1] * 2);
    w.dispose();
  });
});
