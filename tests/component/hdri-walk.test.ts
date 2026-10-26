/**
 * A host sky in a real browser, on the committed synthetic fixtures: the sign
 * of its rotation pinned by rendering (the sun spot in the sky, its
 * reflection in a mirror-like sphere and the analytic sun's shadow agree),
 * the open-air look over a plan without a closed room, and the viewer's walk
 * on the demo apartment (nothing fetched in orbit, both files on the first
 * walk entry, live after the swap, orbit unchanged after, no refetch).
 * Measurements go to `test-results/hdri-walk.json` (git-ignored), with the
 * renderer that drew them.
 */

import * as THREE from 'three';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { HdriSky, loadHdriEnvironment, loadHdriSky, WalkLighting } from '../../src/render/walk-post.js';
import { hdriTarget } from '../../src/app/hdri-wiring.js';
import { hdriSunDirection } from '../../src/lighting/hdri-calibration.js';
import type { HdriEntry } from '../../src/lighting/hdri-entry.js';
import { createLightingContext } from '../../src/lighting/lighting-context.js';
import { prepareSunShadow } from '../../src/render/sun-shadow.js';
import type { SceneData } from '../../src/scene/types.js';
import { closeContainers, demoScene, nextFrame, openContainer, softwareRasteriser, until } from './support.js';

const MOUNT_TIMEOUT_MS = 300_000;
const DEG = Math.PI / 180;
const results: Record<string, unknown> = {};
afterAll(async () => {
  closeContainers();
  await commands.writeFile('test-results/hdri-walk.json', JSON.stringify(results, null, 2));
});

const fixture = (name: string): string => new URL(`/tests/fixtures/hdri/${name}`, location.href).href;
async function fixtureEntry(): Promise<HdriEntry> {
  const sidecar = (await (await fetch(fixture('sky.json'))).json()) as { sun: HdriEntry['sun'] };
  return { environmentUrl: fixture('sky-1k.jpg'), skyUrl: fixture('sky-256.avif'), sun: sidecar.sun };
}

/** Both files of `entry`, as the walk lighting controller loads them. */
async function loadPair(gl: THREE.WebGLRenderer, entry: HdriEntry) {
  const signal = new AbortController().signal;
  const [environment, sky] = await Promise.all([loadHdriEnvironment(gl, entry, signal), loadHdriSky(entry, signal)]);
  return {
    environment,
    sky,
    dispose: () => {
      environment.dispose();
      sky.dispose();
    },
  };
}

function rendererString(gl: THREE.WebGLRenderer): string {
  const context = gl.getContext();
  const info = context.getExtension('WEBGL_debug_renderer_info');
  return String(info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER));
}

/** A unit direction at a clockwise azimuth and an elevation, degrees. */
const towards = (azimuthDeg: number, elevationDeg: number): THREE.Vector3 =>
  new THREE.Vector3(
    Math.sin(azimuthDeg * DEG) * Math.cos(elevationDeg * DEG),
    Math.sin(elevationDeg * DEG),
    Math.cos(azimuthDeg * DEG) * Math.cos(elevationDeg * DEG),
  );

describe('rotation of a host sky, pinned by rendering', () => {
  test(
    'at north 30 and noon the sun spot, its reflection and the shadows all stand at world azimuth 210°',
    async () => {
      const SIZE = 160;
      const canvas = document.createElement('canvas');
      openContainer(SIZE, SIZE).appendChild(canvas);
      const gl = new THREE.WebGLRenderer({ canvas });
      gl.setSize(SIZE, SIZE, false);
      const context = createLightingContext(THREE, gl);
      const scene = new THREE.Scene();
      const rig = context.createApartmentRig();
      rig.attach(scene);
      const root = new THREE.Group();
      scene.add(root);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2, 0.15), new THREE.MeshStandardMaterial({ color: 0x808080 }));
      post.position.set(0, 1, 0);
      post.castShadow = true;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 96, 48),
        new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0 }),
      );
      sphere.position.set(0, 1, 0);
      sphere.visible = false;
      root.add(ground, post, sphere);
      const site = { northDeg: 30, sun: 'noon' as const };
      const sun = prepareSunShadow(root, { rooms: [], ceilingHeight: 2.6, site }, { rooms: [] }, rig);
      const entry = await fixtureEntry();
      const pair = await loadPair(gl, entry);
      const view = hdriTarget({ noon: entry }, site, 'off')!.view;
      const sky = new HdriSky({ scene, renderer: gl, exterior: () => null, sun: () => sun });
      sky.install({ environment: pair.environment, sky: pair.sky, view });
      sky.apply('display');
      const W = 210;
      const toSun = new THREE.Vector3(...hdriSunDirection(30, 180, entry.sun.elevationDeg));
      expect(toSun.distanceTo(towards(W, entry.sun.elevationDeg))).toBeLessThan(1e-9);

      const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
      const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.FloatType });
      const shoot = (from: THREE.Vector3, look: THREE.Vector3): Float32Array => {
        camera.position.copy(from);
        camera.lookAt(look);
        camera.updateMatrixWorld();
        gl.setRenderTarget(target);
        gl.render(scene, camera);
        const pixels = new Float32Array(SIZE * SIZE * 4);
        gl.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
        gl.setRenderTarget(null);
        return pixels;
      };
      const lum = (p: Float32Array, x: number, y: number): number => {
        const i = (y * SIZE + x) * 4;
        return 0.2126 * p[i]! + 0.7152 * p[i + 1]! + 0.0722 * p[i + 2]!;
      };
      /** The weakest channel: high only where the light is white (the sun), not where it is saturated red (the marker). */
      const white = (p: Float32Array, x: number, y: number): number => {
        const i = (y * SIZE + x) * 4;
        return Math.min(p[i]!, p[i + 1]!, p[i + 2]!);
      };
      /** Centroid of the pixels above 90 % of the whitest, in pixels from the lower left corner. */
      const brightest = (p: Float32Array, inside: (x: number, y: number) => boolean = () => true): { x: number; y: number } => {
        let peak = 0;
        for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) if (inside(x, y)) peak = Math.max(peak, white(p, x, y));
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let y = 0; y < SIZE; y += 1)
          for (let x = 0; x < SIZE; x += 1)
            if (inside(x, y) && white(p, x, y) >= peak * 0.9) {
              sx += x;
              sy += y;
              n += 1;
            }
        return { x: sx / n, y: sy / n };
      };
      const pixelOf = (point: THREE.Vector3): { x: number; y: number } => {
        const ndc = point.clone().project(camera);
        return { x: ((ndc.x + 1) / 2) * SIZE, y: ((ndc.y + 1) / 2) * SIZE };
      };
      const eye = new THREE.Vector3(0, 1.5, 8);
      const degreesPerPixel = 30 / SIZE;

      // 1. The sun spot in the sky stands where the analytic sun shines from.
      const spot = brightest(shoot(eye, eye.clone().add(toSun)));
      const spotOff = Math.hypot(spot.x - SIZE / 2, spot.y - SIZE / 2) * degreesPerPixel;
      // 2. The red marker is 90° clockwise of the sun, never counter-clockwise.
      const redAt = (azimuth: number): number[] => {
        const p = shoot(eye, eye.clone().add(towards(azimuth, 12)));
        const i = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
        return [p[i]!, p[i + 1]!, p[i + 2]!];
      };
      const clockwise = redAt(W + 90);
      const counter = redAt(W - 90);
      // 3. The post's shadow falls away from the sun.
      const top = new THREE.Vector3(0, 9, 0.001);
      const down = shoot(top, new THREE.Vector3(0, 0, 0));
      const along = (azimuth: number): number => {
        const at = pixelOf(towards(azimuth, 0).multiplyScalar(1.4));
        return lum(down, Math.round(at.x), Math.round(at.y));
      };
      const shadowed = along(W + 180);
      const lit = along(W);
      // 4. The sphere reflects the sun spot on the side facing the sun.
      post.visible = false;
      sphere.visible = true;
      // The environment's reflection alone: a mirror shows every punctual light as a dot of its own.
      for (const name of ['jeex-lighting-sun', 'jeex-lighting-fill', 'jeex-lighting-sky'])
        (scene.getObjectByName(name) as THREE.Light).visible = false;
      const flat = new THREE.Vector3(toSun.x, 0, toSun.z).normalize();
      const from = sphere.position
        .clone()
        .add(flat.clone().multiplyScalar(3))
        .add(new THREE.Vector3(0, 0.5, 0));
      const mirror = shoot(from, sphere.position);
      const toCamera = from.clone().sub(sphere.position).normalize();
      const normal = toSun.clone().add(toCamera).normalize();
      const predicted = pixelOf(sphere.position.clone().add(normal.multiplyScalar(0.5)));
      const centre = pixelOf(sphere.position);
      const radius = Math.abs(pixelOf(sphere.position.clone().add(new THREE.Vector3(0, 0.5, 0))).y - centre.y);
      const highlight = brightest(mirror, (x, y) => Math.hypot(x - centre.x, y - centre.y) < radius * 0.95);
      const highlightOff = Math.hypot(highlight.x - predicted.x, highlight.y - predicted.y);

      results['rotationSign'] = {
        renderer: rendererString(gl),
        spotOff,
        clockwise,
        counter,
        shadowed,
        lit,
        highlight,
        predicted,
        highlightOff,
      };
      expect(spotOff).toBeLessThan(3);
      expect(clockwise[0]!).toBeGreaterThan(clockwise[1]! * 3);
      expect(counter[0]!).toBeLessThan(counter[2]! * 1.5);
      expect(shadowed).toBeLessThan(lit * 0.7);
      expect(highlightOff).toBeLessThan(6);

      sky.apply('off');
      sky.dispose();
      pair.dispose();
      sun.dispose();
      target.dispose();
      context.dispose();
      gl.dispose();
      gl.forceContextLoss();
    },
    MOUNT_TIMEOUT_MS,
  );
});

describe('a plan without a closed room', () => {
  test(
    'shows the sky in the open-air look: hemisphere and fill silent, editing exposure, both back after',
    async () => {
      const canvas = document.createElement('canvas');
      openContainer(64, 64).appendChild(canvas);
      const gl = new THREE.WebGLRenderer({ canvas });
      gl.setSize(64, 64, false);
      const context = createLightingContext(THREE, gl);
      const scene = new THREE.Scene();
      context.createApartmentRig().attach(scene);
      const lighting = new WalkLighting(gl, scene);
      lighting.load({ volumes: { rooms: [], ceilingHeight: 2.6, doors: [], furniture: [] }, furniture: null });
      const entry = await fixtureEntry();
      const pair = await loadPair(gl, entry);
      lighting.setHdri({ environment: pair.environment, sky: pair.sky, view: hdriTarget({ noon: entry }, {}, 'off')!.view });
      const hemisphere = scene.getObjectByName('jeex-lighting-sky') as THREE.Light;
      const fill = scene.getObjectByName('jeex-lighting-fill') as THREE.Light;
      const before = [hemisphere.intensity, fill.intensity, gl.toneMappingExposure];
      lighting.frame(true);
      expect(lighting.hdriState).toBe('display');
      expect(scene.background).toBe(pair.sky.texture);
      expect([hemisphere.intensity, fill.intensity, gl.toneMappingExposure]).toEqual([0, 0, before[2]]);
      lighting.frame(false);
      expect(lighting.hdriState).toBe('off');
      expect([hemisphere.intensity, fill.intensity, gl.toneMappingExposure]).toEqual(before);
      lighting.dispose();
      pair.dispose();
      context.dispose();
      gl.dispose();
      gl.forceContextLoss();
    },
    MOUNT_TIMEOUT_MS,
  );
});

describe('walk on the demo apartment with a host sky', { timeout: MOUNT_TIMEOUT_MS }, () => {
  let handle: ViewerHandle;
  const debug = () => window.__viewerDebug!;
  /** The fixture files fetched through the page's `fetch` since the test began. */
  const fetched: string[] = [];
  const requests = (): string[] => fetched.filter((name) => name.includes('/tests/fixtures/hdri/sky-'));

  // Two full walk bakes, the first walk's and the swap's: past any sensible wait on a software rasteriser (`softwareRasteriser`).
  test.skipIf(softwareRasteriser())(
    'nothing in orbit; both files on the first walk; live after the swap; orbit unchanged; no refetch',
    async () => {
      const entry = await fixtureEntry();
      const realFetch = globalThis.fetch.bind(globalThis);
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        fetched.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        return realFetch(input, init);
      });
      const scene: SceneData = { ...demoScene(), site: { northDeg: 30, sun: 'noon' } };
      handle = mountViewer(openContainer(480, 320), {
        scene: { repository: new InlineSceneRepository(scene) },
        tour: { mode: 'off' },
        doors: { autoOpen: false },
        debug: true,
        lighting: { hdri: { noon: entry } },
      });
      await handle.ready;
      for (let i = 0; i < 10; i += 1) await nextFrame();
      expect(requests()).toEqual([]);
      const orbitBefore = new Uint8Array(
        await (await handle.capture.still({ width: 200, height: 150, caption: false })).blob.arrayBuffer(),
      );
      handle.setMode('walk');
      await until(() => debug().hdri().state === 'live', `the sky live (now ${JSON.stringify(debug().hdri())})`, MOUNT_TIMEOUT_MS - 60_000);
      expect(debug().walkLighting().state).toBe('live');
      expect(debug().hdri()).toMatchObject({ preset: 'noon', cubeSize: 256 });
      expect(requests().sort()).toEqual([entry.environmentUrl, entry.skyUrl].sort());
      expect(debug().sunShadow()!.elevation).toBeCloseTo(entry.sun.elevationDeg, 6);
      results['demoWalk'] = { hdri: debug().hdri(), sun: debug().sunShadow(), lighting: debug().walkLighting().stats };
      handle.setMode('orbit');
      for (let i = 0; i < 5; i += 1) await nextFrame();
      expect(debug().sunShadow()!.elevation).toBe(55);
      const orbitAfter = new Uint8Array(await (await handle.capture.still({ width: 200, height: 150, caption: false })).blob.arrayBuffer());
      expect(orbitAfter.length).toBe(orbitBefore.length);
      expect(orbitAfter.every((value, i) => value === orbitBefore[i])).toBe(true);
      handle.setMode('tour');
      for (let i = 0; i < 5; i += 1) await nextFrame();
      handle.setMode('walk');
      await until(() => debug().hdri().state === 'live', 'the sky live again', 120_000);
      expect(requests()).toHaveLength(2);
      handle.dispose();
      vi.restoreAllMocks();
    },
  );
});
