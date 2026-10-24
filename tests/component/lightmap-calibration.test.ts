/**
 * The calibration of the player's lightmap path on the bake's calibration
 * room, measured in a real WebGL context.
 *
 * The lighting is reduced to what the baked-surface policy keeps: the
 * lightmap and the live direct sun, no environment, hemisphere, fill, probes
 * or lamps. Readings are linear (a float target, no tone mapping). The
 * intensity and sun-split measurements give the shell zero-specular physical
 * materials, so a pixel is exactly `albedo / π` times the irradiance.
 *
 * - intensity: the sky-only plate's irradiance against π × the sky radiance;
 * - orientation: the corner lamp's landmark on the floor against the point
 *   under the lamp;
 * - sun split: four renders (lightmap off/on × sun off/on) inside the
 *   window's sun footprint;
 * - the standard material against a CPU-decoded float lightmap;
 * - transforms: re-centred vertices with compensating transforms render the same;
 * - diagnostics (printed, not gating): the footprint against its ring with
 *   the sun off, and chart-edge contamination per mip level.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { createLightingContext } from '../../src/lighting/lighting-context.js';
import { rgbmDecode } from '../../src/lightmap/rgbm.js';
import { CALIBRATION_LAMP, CALIBRATION_ROOM, GOLDEN_LEVELS } from '../fixtures/lightmap-calibration/calibration-facts.js';
import {
  FLOOR_PPM,
  boundCalibration,
  closeRenderers,
  floorCamera,
  floorPoint,
  meshOf,
  plateCamera,
  readLevel,
  renderLinear,
  showOnly,
  type Calibration,
} from './lightmap-support.js';

afterEach(closeRenderers);

const [ROOM_W, , ROOM_D] = CALIBRATION_ROOM.size;
const FLOOR_W = ROOM_W * FLOOR_PPM;
const FLOOR_H = ROOM_D * FLOOR_PPM;

const peak = (pixels: Float32Array, i: number): number => Math.max(pixels[4 * i]!, pixels[4 * i + 1]!, pixels[4 * i + 2]!);

/** Renders the floor alone (plus the shell as shadow casters when `casters`) from above. */
function renderFloor(calibration: Calibration, casters = false): Float32Array {
  const { shell, scene, gl } = calibration;
  showOnly(shell, meshOf(shell, 'floor').name);
  if (casters)
    for (const role of ['ceiling', 'wallFront', 'wallBack', 'wallLeft', 'wallRight'] as const) meshOf(shell, role).visible = true;
  return renderLinear(gl, scene, floorCamera(), FLOOR_W, FLOOR_H);
}

function setLightmap(shell: THREE.Object3D, on: boolean): void {
  shell.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (material?.lightMap) material.lightMapIntensity = on ? Math.PI : 0;
  });
}

/** The live sun of the sidecar, with shadows from the shell. */
function addSun(calibration: Calibration): THREE.DirectionalLight {
  const { bake } = calibration.loaded;
  const [dx, dy, dz] = bake.sun.direction;
  const sun = new THREE.DirectionalLight(0xffffff, bake.sun.strength);
  sun.color.setRGB(...bake.sun.color, THREE.LinearSRGBColorSpace);
  sun.target.position.set(ROOM_W / 2, 0, ROOM_D / 2);
  sun.position.set(ROOM_W / 2 - dx * 12, -dy * 12, ROOM_D / 2 - dz * 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  calibration.scene.add(sun, sun.target);
  calibration.gl.shadowMap.enabled = true;
  calibration.shell.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return sun;
}

/** The window projected along the sun onto the floor, (x, z) corners in order. */
function footprint(direction: readonly number[]): [number, number][] {
  const [dx, dy, dz] = direction as [number, number, number];
  return CALIBRATION_ROOM.window.map(([x, y, z]) => {
    const t = -y / dy;
    return [x + dx * t, z + dz * t];
  });
}

/** Signed distance from (x, z) into a convex polygon (positive inside). */
function inset(poly: [number, number][], x: number, z: number): number {
  let sign = 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % poly.length]!;
    const cross = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    const d = cross / Math.hypot(bx - ax, bz - az);
    if (sign === 0) sign = Math.sign(d);
    nearest = Math.min(nearest, d * sign);
  }
  return nearest;
}

describe('lightmap calibration', () => {
  test('intensity: the sky-only plate reads π × the sky radiance within 3 %', async () => {
    const calibration = await boundCalibration({ zeroSpecular: true });
    const { shell, scene, gl } = calibration;
    showOnly(shell, meshOf(shell, 'plate').name);
    const size = 80;
    const pixels = renderLinear(gl, scene, plateCamera(), size, size);
    let sum = 0;
    let n = 0;
    for (let j = 4; j < size - 4; j++)
      for (let i = 4; i < size - 4; i++) {
        const at = 4 * (j * size + i);
        sum += (pixels[at]! + pixels[at + 1]! + pixels[at + 2]!) / 3;
        n++;
      }
    const irradiance = ((sum / n) * Math.PI) / CALIBRATION_ROOM.plate.albedo;
    const factor = (Math.PI * CALIBRATION_ROOM.skyRadiance * CALIBRATION_ROOM.plate.albedo) / (sum / n);
    console.info(
      `lightmap calibration: plate irradiance ${irradiance.toFixed(4)} (expected ${(Math.PI * CALIBRATION_ROOM.skyRadiance).toFixed(4)}), factor ${factor.toFixed(4)}`,
    );
    expect(Math.abs(irradiance / (Math.PI * CALIBRATION_ROOM.skyRadiance) - 1)).toBeLessThan(0.03);
    calibration.loaded.dispose();
  });

  test('orientation: the lamp landmark on the floor lands within 0.15 m of the point under the lamp', async () => {
    const calibration = await boundCalibration({ zeroSpecular: true });
    const pixels = renderFloor(calibration);
    let top = 0;
    for (let i = 0; i < FLOOR_W * FLOOR_H; i++) top = Math.max(top, peak(pixels, i));
    let [sx, sz, sw] = [0, 0, 0];
    for (let j = 0; j < FLOOR_H; j++)
      for (let i = 0; i < FLOOR_W; i++) {
        const v = peak(pixels, j * FLOOR_W + i);
        if (v < 0.9 * top) continue;
        const [x, z] = floorPoint(i, j);
        sx += x * v;
        sz += z * v;
        sw += v;
      }
    const [lx, , lz] = CALIBRATION_LAMP.position;
    const error = Math.hypot(sx / sw - lx, sz / sw - lz);
    // A mirrored (x) or flipped (z) atlas would put it near (3.3, 2.4) or (0.7, 0.6).
    console.info(
      `lightmap calibration: lamp landmark at (${(sx / sw).toFixed(3)}, ${(sz / sw).toFixed(3)}), ${error.toFixed(3)} m from the point under the lamp`,
    );
    expect(error).toBeLessThan(0.15);
    calibration.loaded.dispose();
  });

  test('sun split: with the lightmap bound the live sun adds exactly its direct term, once', async () => {
    const calibration = await boundCalibration({ zeroSpecular: true });
    const sun = addSun(calibration);
    const render = (lightmap: boolean, lit: boolean): Float32Array => {
      setLightmap(calibration.shell, lightmap);
      sun.visible = lit;
      return renderFloor(calibration, true);
    };
    const both = render(true, true);
    const lmOnly = render(true, false);
    const sunOnly = render(false, true);
    const neither = render(false, false);
    const { bake } = calibration.loaded;
    const poly = footprint(bake.sun.direction);
    const cos = -bake.sun.direction[1];
    const [ar, ag, ab] = CALIBRATION_ROOM.floorAlbedo;
    const analytic = [ar, ag, ab].map((albedo, c) => (albedo / Math.PI) * bake.sun.strength * cos * bake.sun.color[c]!);
    let [n, deltaRatio, analyticRatio] = [0, 0, 0];
    let [footSum, footN, ringSum, ringN] = [0, 0, 0, 0];
    const centre = poly.reduce(([a, b], [x, z]) => [a + x / poly.length, b + z / poly.length], [0, 0]);
    const ring = poly.map(([x, z]): [number, number] => [centre[0] + (x - centre[0]) * 1.8, centre[1] + (z - centre[1]) * 1.8]);
    for (let j = 0; j < FLOOR_H; j++)
      for (let i = 0; i < FLOOR_W; i++) {
        const [x, z] = floorPoint(i, j);
        const at = 4 * (j * FLOOR_W + i);
        const inside = inset(poly, x, z);
        if (inside > 0) {
          footSum += lmOnly[at]!;
          footN++;
        } else if (inset(ring, x, z) > 0 && x > 0.2 && x < ROOM_W - 0.2 && z < ROOM_D - 0.2) {
          ringSum += lmOnly[at]!;
          ringN++;
        }
        if (inside < 0.15) continue;
        n++;
        for (let c = 0; c < 3; c++) {
          const withMap = both[at + c]! - lmOnly[at + c]!;
          const without = sunOnly[at + c]! - neither[at + c]!;
          deltaRatio += withMap / without / 3;
          analyticRatio += withMap / analytic[c]! / 3;
        }
      }
    deltaRatio /= n;
    analyticRatio /= n;
    console.info(
      `lightmap calibration: sun split over ${String(n)} footprint pixels: (lightmap+sun − lightmap) / (sun − none) = ${deltaRatio.toFixed(4)}, against the analytic direct term ${analyticRatio.toFixed(4)}`,
    );
    console.info(
      `lightmap calibration (diagnostic): sun off, footprint / ring of the red lightmap channel = ${(footSum / footN / (ringSum / ringN)).toFixed(3)}`,
    );
    expect(n).toBeGreaterThan(200);
    expect(Math.abs(deltaRatio - 1)).toBeLessThan(0.02);
    expect(Math.abs(analyticRatio - 1)).toBeLessThan(0.03);
    calibration.loaded.dispose();
  });

  test('the standard material matches the same floor lit by a CPU-decoded float lightmap', async () => {
    const calibration = await boundCalibration();
    const { shell, gl, loaded } = calibration;
    const rgbm = renderFloor(calibration);
    const range = loaded.bake.contract.encoding.range;
    const levels = GOLDEN_LEVELS.map(({ level, width, height }) => {
      const bytes = readLevel(gl, loaded.pages[0]!.texture, level, width, height);
      const data = new Uint16Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const decoded = rgbmDecode([bytes[4 * i]!, bytes[4 * i + 1]!, bytes[4 * i + 2]!, bytes[4 * i + 3]!], range);
        for (let c = 0; c < 3; c++) data[4 * i + c] = THREE.DataUtils.toHalfFloat(decoded[c]!);
        data[4 * i + 3] = THREE.DataUtils.toHalfFloat(1);
      }
      return { data, width, height };
    });
    const reference = new THREE.DataTexture(levels[0]!.data, levels[0]!.width, levels[0]!.height, THREE.RGBAFormat, THREE.HalfFloatType);
    reference.mipmaps = levels;
    Object.assign(reference, {
      generateMipmaps: false,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.NoColorSpace,
      flipY: false,
      channel: 1,
      needsUpdate: true,
    });
    const floor = meshOf(shell, 'floor');
    const source = floor.material as THREE.MeshStandardMaterial;
    const plain = new THREE.MeshStandardMaterial({ color: source.color, roughness: source.roughness, metalness: source.metalness });
    plain.lightMap = reference;
    plain.lightMapIntensity = Math.PI;
    floor.material = plain;
    const float = renderFloor(calibration);
    const errors: number[] = [];
    for (let i = 0; i < FLOOR_W * FLOOR_H; i++) {
      const want = peak(float, i);
      if (want > 0.01) errors.push(Math.abs(peak(rgbm, i) - want) / want);
    }
    errors.sort((a, b) => a - b);
    const mean = errors.reduce((s, e) => s + e, 0) / errors.length;
    const p95 = errors[Math.floor(0.95 * errors.length)]!;
    console.info(
      `lightmap calibration: standard material, RGBM against a float lightmap over ${String(errors.length)} floor pixels: mean ${(100 * mean).toFixed(3)} %, p95 ${(100 * p95).toFixed(3)} %`,
    );
    expect(mean).toBeLessThan(0.005);
    expect(p95).toBeLessThan(0.025);
    reference.dispose();
    loaded.dispose();
  });

  test('transforms: re-centred vertices with compensating mesh and parent transforms render the same', async () => {
    const calibration = await boundCalibration();
    const before = renderFloor(calibration);
    const floor = meshOf(calibration.shell, 'floor');
    floor.geometry.computeBoundingBox();
    const centre = floor.geometry.boundingBox!.getCenter(new THREE.Vector3());
    floor.geometry.translate(-centre.x, -centre.y, -centre.z);
    const room = new THREE.Group();
    room.position.set(1, 0, 0.5);
    calibration.shell.add(room);
    room.add(floor);
    floor.position.copy(centre).sub(room.position);
    const after = renderFloor(calibration);
    let worst = 0;
    for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(after[i]! - before[i]!));
    expect(worst).toBeLessThan(1e-3);
    calibration.loaded.dispose();
  });

  test('diagnostic: chart-edge contamination per mip level (printed, not gating)', async () => {
    const calibration = await boundCalibration();
    const { bake, pages } = calibration.loaded;
    const range = bake.contract.encoding.range;
    const lines: string[] = [];
    for (const { level, width, height } of GOLDEN_LEVELS) {
      const bytes = readLevel(calibration.gl, pages[0]!.texture, level, width, height);
      const value = (x: number, y: number): number =>
        Math.max(
          ...rgbmDecode(
            [
              bytes[4 * (y * width + x)]!,
              bytes[4 * (y * width + x) + 1]!,
              bytes[4 * (y * width + x) + 2]!,
              bytes[4 * (y * width + x) + 3]!,
            ],
            range,
          ),
        );
      let worst = 0;
      for (const { rect } of bake.bindings) {
        const s = 2 ** level;
        const [x0, y0, x1, y1] = [
          Math.ceil(rect.x / s),
          Math.ceil(rect.y / s),
          Math.floor((rect.x + rect.w) / s) - 1,
          Math.floor((rect.y + rect.h) / s) - 1,
        ];
        if (x1 - x0 < 6 || y1 - y0 < 6) continue;
        for (let x = x0 + 3; x <= x1 - 3; x += 1) {
          for (const [edge, inner] of [
            [y0, y0 + 3],
            [y1, y1 - 3],
          ] as const) {
            const ref = value(x, inner);
            if (ref > 0.02) worst = Math.max(worst, Math.abs(value(x, edge) / ref - 1));
          }
        }
      }
      lines.push(`level ${String(level)}: ${(100 * worst).toFixed(1)} %`);
    }
    console.info(`lightmap calibration (diagnostic): largest chart edge row against the row 3 texels in, ${lines.join(', ')}`);
    expect(lines).toHaveLength(4);
    calibration.loaded.dispose();
  });

  test('full rig: with the player lighting rig and the baked-surface marks nothing the bake carries is added again', async () => {
    // The bake's lamp is in the room and marked baked by the binding.
    const lamp = new THREE.PointLight(0xffffff, 40, 0, 2);
    const calibration = await boundCalibration({
      zeroSpecular: true,
      beforeBind: (shell) => {
        const placement = new THREE.Group();
        placement.userData['assetId'] = CALIBRATION_LAMP.id;
        lamp.position.set(...CALIBRATION_LAMP.position);
        placement.add(lamp);
        shell.add(placement);
      },
    });
    expect(lamp.userData['jeexBaked']).toBe(true);
    const lighting = createLightingContext(THREE, calibration.gl);
    const rig = lighting.createApartmentRig();
    rig.attach(calibration.scene);
    const sun = calibration.scene.getObjectByName('jeex-lighting-sun') as THREE.DirectionalLight;
    const full = renderFloor(calibration, true);
    // The reference: the rig's sun alone, everything the bake carries switched off.
    const environment = calibration.scene.environment;
    calibration.scene.environment = null;
    const others: [THREE.Light, number][] = [];
    calibration.scene.traverse((object) => {
      const light = object as THREE.Light;
      if (light.isLight && light !== sun) {
        others.push([light, light.intensity]);
        light.intensity = 0;
      }
    });
    const sunOnly = renderFloor(calibration, true);
    calibration.scene.environment = environment;
    for (const [light, intensity] of others) light.intensity = intensity;
    let worst = 0;
    let peakValue = 0;
    for (let i = 0; i < full.length; i += 4) {
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(full[i + c]! - sunOnly[i + c]!));
      peakValue = Math.max(peakValue, peak(sunOnly, i / 4));
    }
    console.info(`lightmap calibration: full rig against its sun alone, worst ${worst.toExponential(2)} of peak ${peakValue.toFixed(4)}`);
    expect(peakValue).toBeGreaterThan(0.05);
    expect(worst).toBeLessThan(2e-3 * Math.max(1, peakValue));
    lighting.dispose();
    calibration.loaded.dispose();
  });
});
