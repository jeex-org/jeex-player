/**
 * The demo apartment's shell three ways (see `lightmap-shell.html`): live,
 * adopted from a shipped shell file, and adopted with a lightmap bound. The
 * shell file is the player's own export given UV1 by the tests' stand-in
 * unwrap; the lightmap is the calibration page, so its light means nothing
 * here, only that every lit surface takes it. The largest pixel difference
 * between the live and the adopted view is printed and left on
 * `window.__shellRoundTrip` for a scripted check.
 */

import * as THREE from 'three';
import { apartmentScene } from '../src/demo/scene-data.js';
import { standInSidecar, standInUnwrap } from '../src/fixtures/shell-unwrap.js';
import { SceneBuilder } from '../src/geometry/scene-builder.js';
import type { LightBake } from '../src/lightmap/light-bake.js';
import { applyBakedShell } from '../src/lightmap/baked-shell.js';
import { exportShellForBake, SHIPPED_FINISHES } from '../src/lightmap/shell-export.js';
import { shellInputsHash } from '../src/lightmap/shell-inputs.js';
import { solvePlan } from '../src/plan/plan-solver.js';
import CALIBRATION from '../tests/fixtures/lightmap-calibration/sidecar.json' with { type: 'json' };

declare global {
  interface Window {
    __shellRoundTrip?: { ready: boolean; liveVsAdopted: number; adoptedPixelsOff: number; liveVsBaked: number; bound: number };
  }
}

const SIZE = 720;
const FIXTURE = new URL('/tests/fixtures/lightmap-calibration/', location.href);
const readout = document.querySelector<HTMLElement>('#readout')!;

function canvasRenderer(id: string): THREE.WebGLRenderer {
  const gl = new THREE.WebGLRenderer({
    canvas: document.querySelector<HTMLCanvasElement>(`#${id}`)!,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  gl.setPixelRatio(1);
  gl.setSize(SIZE, SIZE, false);
  gl.toneMapping = THREE.NeutralToneMapping;
  return gl;
}

const root = new SceneBuilder(apartmentScene, solvePlan(apartmentScene)).build().root;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#202828');
scene.add(root, new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(4, 10, 6);
scene.add(sun);
const box = new THREE.Box3().setFromObject(root.getObjectByName('parametric-shell')!);
const centre = box.getCenter(new THREE.Vector3());
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(centre.x + 7, 13, centre.z + 11);
camera.lookAt(centre);

function draw(id: string): Uint8Array {
  const gl = canvasRenderer(id);
  gl.render(scene, camera);
  const context = gl.getContext();
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  context.readPixels(0, 0, SIZE, SIZE, context.RGBA, context.UNSIGNED_BYTE, pixels);
  return pixels;
}

const worst = (a: Uint8Array, b: Uint8Array): number => a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i]!)), 0);

/** Pixels whose largest channel differs by more than 4 / 255 (an anti-aliased edge moved by float rounding differs by little more). */
const off = (a: Uint8Array, b: Uint8Array): number => {
  let count = 0;
  for (let i = 0; i < a.length; i += 4)
    if (Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!)) > 4) count += 1;
  return count;
};

const live = draw('live');
let n = 0;
const exported = await exportShellForBake(apartmentScene, {
  mintId: () => `01a1f100-0000-7000-8000-${(n++).toString(16).padStart(12, '0')}`,
  finishes: SHIPPED_FINISHES,
});
const unwrapped = await standInUnwrap(exported.glb);
const bake = await standInSidecar(unwrapped, CALIBRATION as unknown as LightBake, apartmentScene.id, await shellInputsHash(apartmentScene));
const outcome = await applyBakedShell({
  sidecarUrl: new URL('https://bake.invalid/sidecar.json'),
  shellUrl: new URL('https://bake.invalid/shell.glb'),
  scene: apartmentScene,
  root,
  fetchBytes: async (url) => {
    const name = url.pathname.split('/').at(-1)!;
    if (name === 'sidecar.json') return new Blob([JSON.stringify(bake)]);
    if (name === 'shell.glb') return new Blob([unwrapped.glb]);
    return (await fetch(new URL(name, FIXTURE))).blob();
  },
});
if (!outcome.applied) throw outcome.error;
const baked = draw('baked');
outcome.bound.unbind();
const adopted = draw('adopted');
const result = {
  ready: true,
  liveVsAdopted: worst(live, adopted),
  adoptedPixelsOff: off(live, adopted),
  liveVsBaked: worst(live, baked),
  bound: bake.bindings.length,
};
window.__shellRoundTrip = result;
readout.textContent = `largest pixel difference, live vs adopted: ${String(result.liveVsAdopted)} / 255 (${String(result.adoptedPixelsOff)} of ${String(SIZE * SIZE)} pixels off by more than 4); live vs baked: ${String(result.liveVsBaked)}; ${String(result.bound)} meshes bound`;
