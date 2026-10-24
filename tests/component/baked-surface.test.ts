/**
 * The baked-surface policy in a real WebGL context, on small scenes read back
 * in linear float: what a baked surface keeps (the sun with its shadow, live
 * lamps, every specular term) and what it drops (ambient, hemisphere, light
 * probes, the probe grid, the environment's diffuse, the fill, baked lamps'
 * diffuse), per drawn light whatever three's light order, without a
 * recompile, across nested renders, copies, the lightmap binding's RGBM
 * decode and a context restore.
 *
 * Diffuse assertions use a grey `MeshPhysicalMaterial` with
 * `specularIntensity` 0, so no specular term hides in them.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { afterEach, describe, expect, test } from 'vitest';
import { decorateRgbm } from '../../src/lightmap/lightmap-shader.js';
import { markBakedSurface, setLampBaked } from '../../src/render/baked-surface.js';
import { APARTMENT_FILL_LIGHT_NAME, createLightingContext } from '../../src/lighting/lighting-context.js';
import { lightMasks } from '../../src/render/light-order.js';
import { packAtlas, type Rgb } from '../../src/render/walk-lighting/exterior-sh.js';
import { RoomGrid } from '../../src/render/walk-lighting/room-grid.js';
import { createWalkUniforms, installWalkPatch } from '../../src/render/walk-lighting/box-probe-patch.js';
import type { RoomBox } from '../../src/render/walk-lighting/room-volumes.js';

const SIZE = 32;
/** Linear tolerance of one channel. */
const TOL = 2e-3;

const opened: THREE.WebGLRenderer[] = [];

function renderer(): THREE.WebGLRenderer {
  const gl = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  gl.setPixelRatio(1);
  gl.setSize(SIZE, SIZE, false);
  gl.shadowMap.enabled = true;
  opened.push(gl);
  return gl;
}

afterEach(() => {
  for (const gl of opened.splice(0)) {
    gl.dispose();
    gl.forceContextLoss();
  }
});

/** Looks at the unit plane at the origin head-on: x and y of the view are world x and y in [-1, 1]. */
function camera(): THREE.OrthographicCamera {
  const view = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  view.position.set(0, 0, 5);
  view.lookAt(0, 0, 0);
  return view;
}

type Pixels = { at: (x: number, y: number) => [number, number, number] };

function read(gl: THREE.WebGLRenderer, scene: THREE.Scene, view: THREE.Camera = camera()): Pixels {
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.FloatType });
  gl.setRenderTarget(target);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  gl.render(scene, view);
  const data = new Float32Array(SIZE * SIZE * 4);
  gl.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, data);
  gl.setRenderTarget(null);
  target.dispose();
  return {
    at: (x, y) => {
      const i = 4 * (y * SIZE + x);
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    },
  };
}

/** Pixels in the sun's shadow (upper half, centre) and in the sun (lower half). */
const SHADOWED = [16, 24] as const;
const LIT = [16, 8] as const;
const CENTRE = [16, 16] as const;

const close = (a: readonly number[], b: readonly number[], tol = TOL): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
const luminance = (rgb: readonly number[]): number => 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;

function grey(options: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.LinearSRGBColorSpace),
    roughness: 1,
    metalness: 0,
    specularIntensity: 0,
    ...options,
  });
}

/** A uniform lightmap of `value` (linear), on the plane's own uv. */
function lightmap(value: number): THREE.DataTexture {
  const byte = Math.round(value * 255);
  const texture = new THREE.DataTexture(new Uint8Array([byte, byte, byte, 255]), 1, 1);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function bakedGrey(map = 0, options: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
  const material = grey({ lightMap: lightmap(map), lightMapIntensity: 1, ...options });
  markBakedSurface(material);
  return material;
}

function plane(material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.receiveShadow = true;
  return mesh;
}

/** The sun from +x+z with a slab beside the view whose shadow covers the plane's upper middle. */
function addSun(scene: THREE.Scene): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.name = 'jeex-lighting-sun';
  sun.position.set(5, 0, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(256, 256);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
  scene.add(sun, sun.target);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.6), new THREE.MeshBasicMaterial());
  slab.position.set(2.5, 0.5, 2.5);
  slab.castShadow = true;
  scene.add(slab);
  return sun;
}

/** A constant-irradiance probe grid over a box around the plane. */
function addGrid(scene: THREE.Scene): void {
  const volume: RoomBox = {
    roomId: 'grid',
    projection: { min: { x: -3, y: -3, z: -3 }, max: { x: 3, y: 3, z: 3 } },
    sampling: { min: { x: -3, y: -3, z: -3 }, max: { x: 3, y: 3, z: 3 } },
    selection: { min: { x: -3, y: -3, z: -3 }, max: { x: 3, y: 3, z: 3 } },
    resolution: { x: 2, y: 2, z: 2 },
  };
  const grid = new RoomGrid(volume);
  const coefficients: Rgb[] = Array.from({ length: 9 }, () => [0, 0, 0] as Rgb);
  coefficients[0] = [0.4 / 0.886227, 0.3 / 0.886227, 0.2 / 0.886227];
  const atlas = packAtlas(coefficients, 2);
  const texture = new THREE.Data3DTexture(atlas.data, 2, 2, atlas.depth);
  texture.type = THREE.FloatType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  grid.texture = texture;
  grid.resolution.set(2, 2, 2);
  scene.add(grid);
}

/** Every source of light a baked surface must not take: hemisphere, ambient, probe, grid, environment, fill. */
function addEverythingElse(gl: THREE.WebGLRenderer, scene: THREE.Scene, fill = 1): THREE.DirectionalLight {
  const sky = new THREE.HemisphereLight(0xffffff, 0x666666, 1);
  sky.name = 'jeex-lighting-sky';
  const probe = new THREE.LightProbe();
  probe.sh.coefficients[0]!.set(0.5, 0.5, 0.5);
  const fillLight = new THREE.DirectionalLight(0xbbddee, fill);
  fillLight.name = APARTMENT_FILL_LIGHT_NAME;
  fillLight.position.set(0, 0, 5);
  scene.add(sky, new THREE.AmbientLight(0xffffff, 0.3), probe, fillLight, fillLight.target);
  addGrid(scene);
  const pmrem = new THREE.PMREMGenerator(gl);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return fillLight;
}

describe('indirect and directional light on a baked surface', () => {
  test('a zero lightmap under the full rig equals an independent sun-only reference, lit and shadowed', () => {
    const gl = renderer();
    const full = new THREE.Scene();
    full.add(plane(bakedGrey(0)));
    addSun(full);
    addEverythingElse(gl, full);
    const reference = new THREE.Scene();
    reference.add(plane(grey()));
    addSun(reference);
    const unbaked = new THREE.Scene();
    unbaked.add(plane(grey()));
    addSun(unbaked);
    addEverythingElse(gl, unbaked);

    const got = read(gl, full);
    const want = read(gl, reference);
    const other = read(gl, unbaked);
    for (const [x, y] of [SHADOWED, LIT])
      expect({ x, y, got: got.at(x, y), ok: close(got.at(x, y), want.at(x, y)) }).toMatchObject({ ok: true });
    // The shadow is there, and the other sources are really lighting the unbaked plane.
    expect(luminance(want.at(...LIT))).toBeGreaterThan(4 * luminance(want.at(...SHADOWED)) + 0.05);
    expect(luminance(other.at(...SHADOWED))).toBeGreaterThan(luminance(want.at(...SHADOWED)) + 0.1);
  });

  test('a nonzero lightmap adds exactly its own contribution', () => {
    const gl = renderer();
    const lit = new THREE.Scene();
    lit.add(plane(bakedGrey(0.5)));
    addSun(lit);
    addEverythingElse(gl, lit);
    const reference = new THREE.Scene();
    reference.add(plane(grey()));
    addSun(reference);
    // The lightmap's contribution alone: an unbaked plane with the same lightmap in the dark.
    const alone = new THREE.Scene();
    alone.add(plane(grey({ lightMap: lightmap(0.5), lightMapIntensity: 1 })));
    const got = read(gl, lit);
    const sun = read(gl, reference);
    const map = read(gl, alone);
    expect(luminance(map.at(...CENTRE))).toBeGreaterThan(0.05);
    for (const [x, y] of [SHADOWED, LIT]) {
      const want = sun.at(x, y).map((v, c) => v + map.at(x, y)[c]!);
      expect({ x, y, ok: close(got.at(x, y), want) }).toMatchObject({ ok: true });
    }
  });

  test("the real apartment rig's fill is the light the policy drops, and its sun the one it keeps", () => {
    const gl = renderer();
    const lighting = createLightingContext(THREE, gl);
    const scene = new THREE.Scene();
    lighting.createApartmentRig().attach(scene);
    expect((scene.getObjectByName(APARTMENT_FILL_LIGHT_NAME) as THREE.DirectionalLight | undefined)?.isDirectionalLight).toBe(true);
    // Sorted as three does: the shadow-casting sun first, then the fill.
    expect(lightMasks(scene, camera()).directional).toEqual([1, 0]);
    lighting.dispose();
  });

  test('doubling the fill changes nothing on a baked surface and something on an unbaked one', () => {
    const gl = renderer();
    const readWith = (material: THREE.Material, fill: number): [number, number, number] => {
      const scene = new THREE.Scene();
      scene.add(plane(material));
      addSun(scene);
      addEverythingElse(gl, scene, fill);
      return read(gl, scene).at(...CENTRE);
    };
    const baked = bakedGrey(0.3);
    expect(close(readWith(baked, 1), readWith(baked, 2))).toBe(true);
    const plain = grey();
    expect(luminance(readWith(plain, 2)) - luminance(readWith(plain, 1))).toBeGreaterThan(0.02);
  });

  test('environment specular on a rough metal: a baked surface keeps it whole, multiple scattering included', () => {
    const gl = renderer();
    const readEnv = (material: THREE.Material): [number, number, number] => {
      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(gl);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      scene.add(plane(material));
      return read(gl, scene).at(...CENTRE);
    };
    const metal = { metalness: 1, roughness: 0.6, specularIntensity: 1 };
    const unbaked = readEnv(grey(metal));
    const baked = readEnv(bakedGrey(0, metal));
    expect(luminance(unbaked)).toBeGreaterThan(0.05);
    expect(close(baked, unbaked)).toBe(true);
  });
});

/* -------------------------------------------------------------------- lamps */

type Lamp = THREE.PointLight | THREE.SpotLight;

function pointLamp(): THREE.PointLight {
  const lamp = new THREE.PointLight(0xffeedd, 3, 0, 2);
  lamp.position.set(0.2, 0.1, 1);
  return lamp;
}

function spotLamp(): THREE.SpotLight {
  const lamp = new THREE.SpotLight(0xddeeff, 4, 0, 0.9, 0.2, 2);
  lamp.position.set(-0.2, 0, 1.2);
  lamp.target.position.set(0, 0, 0);
  return lamp;
}

/** The centre of `material`'s plane lit by `lamps` alone. */
function lampReading(gl: THREE.WebGLRenderer, material: THREE.Material, lamps: readonly Lamp[]): [number, number, number] {
  const scene = new THREE.Scene();
  scene.add(plane(material));
  for (const lamp of lamps) scene.add(lamp, ...((lamp as THREE.SpotLight).isSpotLight ? [(lamp as THREE.SpotLight).target] : []));
  const value = read(gl, scene).at(...CENTRE);
  for (const lamp of lamps) lamp.removeFromParent();
  return value;
}

describe('baked and live lamps', () => {
  for (const make of [pointLamp, spotLamp]) {
    const kind = make === pointLamp ? 'point' : 'spot';

    test(`${kind}: baked adds no diffuse to a baked surface; live and unmarked light it as an unbaked one`, () => {
      const gl = renderer();
      const lamp = make();
      const baked = bakedGrey(0);
      const plain = grey();
      const asUnbaked = lampReading(gl, plain, [lamp]);
      const dark = lampReading(gl, baked, []);
      expect(luminance(asUnbaked)).toBeGreaterThan(0.05);
      expect(close(lampReading(gl, baked, [lamp]), asUnbaked)).toBe(true); // unmarked
      setLampBaked(lamp, true);
      expect(close(lampReading(gl, baked, [lamp]), dark)).toBe(true);
      // A baked lamp still lights a surface that is not baked.
      expect(close(lampReading(gl, plain, [lamp]), asUnbaked)).toBe(true);
      setLampBaked(lamp, false);
      expect(close(lampReading(gl, baked, [lamp]), asUnbaked)).toBe(true);
    });
  }

  test('a baked lamp keeps its specular highlight on a glossy baked surface', () => {
    const gl = renderer();
    const lamp = pointLamp();
    setLampBaked(lamp, true);
    const glossy = { roughness: 0.25, specularIntensity: 1 };
    const baked = bakedGrey(0, glossy);
    const highlight = luminance(lampReading(gl, baked, [lamp])) - luminance(lampReading(gl, baked, []));
    const whole = luminance(lampReading(gl, grey(glossy), [lamp]));
    const diffuse = luminance(lampReading(gl, grey(), [lamp]));
    expect(highlight).toBeGreaterThan(0.02);
    // What the lamp adds to the unbaked glossy surface beyond its diffuse is the highlight the baked one keeps.
    expect(highlight).toBeLessThan(whole);
    expect(Math.abs(highlight - (whole - diffuse))).toBeLessThan(0.1 * whole + TOL);
  });

  test("mixed shadow and projected-texture spots: each one's diffuse is dropped exactly when it is baked", () => {
    const gl = renderer();
    const cookie = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    cookie.needsUpdate = true;
    const plain = spotLamp();
    const caster = spotLamp();
    caster.castShadow = true;
    caster.position.x = 0.3;
    const both = spotLamp();
    both.castShadow = true;
    both.map = cookie;
    both.position.y = 0.3;
    // Traversal order is the reverse of three's sorted order.
    const lamps = [plain, caster, both];
    const baked = bakedGrey(0);
    for (const target of lamps) {
      setLampBaked(target, true);
      const got = lampReading(gl, baked, lamps);
      const others = lamps.filter((lamp) => lamp !== target);
      const want = lampReading(gl, grey(), others);
      expect({ target: lamps.indexOf(target), ok: close(got, want) }).toEqual({ target: lamps.indexOf(target), ok: true });
      setLampBaked(target, false);
    }
  });

  test('a hidden ancestor and a camera layer leave the other lamps their own classification', () => {
    const gl = renderer();
    const baked = bakedGrey(0);
    const scene = new THREE.Scene();
    scene.add(plane(baked));
    const hidden = new THREE.Group();
    hidden.visible = false;
    hidden.add(pointLamp());
    const layered = pointLamp();
    layered.layers.set(2);
    const bakedLamp = pointLamp();
    bakedLamp.position.x = -0.4;
    setLampBaked(bakedLamp, true);
    const live = pointLamp();
    scene.add(hidden, layered, bakedLamp, live);
    const got = read(gl, scene).at(...CENTRE);
    const want = lampReading(gl, grey(), [pointLamp()]);
    expect(close(got, want)).toBe(true);
  });

  test('a render nested in another one applies its own lamps, and the outer render its own on return', () => {
    const gl = renderer();
    const baked = bakedGrey(0);
    const inner = new THREE.Scene();
    inner.add(plane(baked), pointLamp()); // live
    const innerTarget = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.FloatType });
    const outer = new THREE.Scene();
    const outerLamp = pointLamp();
    setLampBaked(outerLamp, true);
    const first = plane(baked);
    first.renderOrder = 0;
    const trigger = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.1),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    trigger.renderOrder = 1;
    trigger.onBeforeRender = (drawing) => {
      const previous = drawing.getRenderTarget();
      drawing.setRenderTarget(innerTarget);
      drawing.render(inner, camera());
      drawing.setRenderTarget(previous);
    };
    const second = plane(baked);
    second.renderOrder = 2;
    outer.add(first, trigger, second, outerLamp);
    const got = read(gl, outer).at(...CENTRE);
    const dark = lampReading(gl, bakedGrey(0), []);
    expect(close(got, dark)).toBe(true);
    const innerPixel = new Float32Array(4);
    gl.readRenderTargetPixels(innerTarget, CENTRE[0], CENTRE[1], 1, 1, innerPixel);
    innerTarget.dispose();
    const live = lampReading(gl, grey(), [pointLamp()]);
    expect(close([innerPixel[0]!, innerPixel[1]!, innerPixel[2]!], live)).toBe(true);
  });

  test('toggling a lamp and its intensity compiles nothing new', () => {
    const gl = renderer();
    const scene = new THREE.Scene();
    const lamp = pointLamp();
    scene.add(plane(bakedGrey(0.2)), lamp, spotLamp());
    addSun(scene);
    read(gl, scene);
    const programs = gl.info.programs?.length ?? 0;
    for (let i = 0; i < 6; i += 1) {
      setLampBaked(lamp, i % 2 === 0);
      lamp.intensity = 1 + i;
      read(gl, scene);
    }
    expect(gl.info.programs?.length).toBe(programs);
  });

  test('an unbaked surface beside a baked one draws exactly as alone', () => {
    const gl = renderer();
    const lamp = pointLamp();
    setLampBaked(lamp, true);
    const alone = new THREE.Scene();
    alone.add(plane(grey()), lamp);
    const before = read(gl, alone).at(...CENTRE);
    const beside = plane(bakedGrey(0.4));
    beside.position.z = -1; // behind, out of the centre's way
    alone.add(beside);
    expect(read(gl, alone).at(...CENTRE)).toEqual(before);
  });
});

/* -------------------------------------------------- composition and copies */

/** An RGBM lightmap texel: rgb 128, alpha 32 → 0.502 × 0.125 × 8 = 0.502 linear. */
function rgbmMap(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 32]), 1, 1);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

describe('composition', () => {
  test("the lightmap binding's RGBM decode composes with the walk patch and the baked mark in any registration order, as one program", () => {
    const gl = renderer();
    const uniforms = createWalkUniforms();
    const readOne = (order: 'decode first' | 'walk first'): { value: [number, number, number]; key: string } => {
      const material = grey({ lightMap: rgbmMap(), lightMapIntensity: 1 });
      const scene = new THREE.Scene();
      scene.add(plane(material));
      if (order === 'decode first') {
        decorateRgbm(material, 8);
        markBakedSurface(material);
        installWalkPatch(scene, uniforms);
      } else {
        installWalkPatch(scene, uniforms);
        markBakedSurface(material);
        decorateRgbm(material, 8);
      }
      return { value: read(gl, scene).at(...CENTRE), key: material.customProgramCacheKey() };
    };
    const a = readOne('decode first');
    const programs = gl.info.programs?.length ?? 0;
    const b = readOne('walk first');
    expect(b.key).toBe(a.key);
    expect(gl.info.programs?.length).toBe(programs);
    expect(close(a.value, b.value)).toBe(true);
    // Decoded: the RGBM texel reads as its decoded value on the grey albedo, not as rgb alone times eight.
    const plain = new THREE.Scene();
    plain.add(plane(grey({ lightMap: lightmap(128 / 255), lightMapIntensity: 1 })));
    expect(close(a.value, read(gl, plain).at(...CENTRE))).toBe(true);
  });

  test('a copy with the compile hooks assigned, marked again, is the only baked material drawn: its lamps are classified', () => {
    const gl = renderer();
    const source = bakedGrey(0);
    const clone = source.clone();
    Object.assign(clone, {
      onBeforeCompile: Reflect.get(source, 'onBeforeCompile'),
      customProgramCacheKey: Reflect.get(source, 'customProgramCacheKey'),
    });
    decorateRgbm(clone, 8);
    markBakedSurface(clone);
    const bakedLamp = pointLamp();
    setLampBaked(bakedLamp, true);
    const live = spotLamp();
    const got = lampReading(gl, clone, [bakedLamp, live]);
    const want = lampReading(gl, grey(), [spotLamp()]);
    expect(close(got, want)).toBe(true);
    // The source keeps its own list: no decode was added to it.
    expect(source.customProgramCacheKey()).not.toContain('rgbm');
  });
});

/* ------------------------------------------------------------ context loss */

describe('context restore', () => {
  test('the policy and the masks survive at once with a CPU-backed lightmap and direct lights', async () => {
    const gl = renderer();
    const scene = new THREE.Scene();
    scene.add(plane(bakedGrey(0.3)));
    addSun(scene);
    const bakedLamp = pointLamp();
    setLampBaked(bakedLamp, true);
    const live = spotLamp();
    scene.add(bakedLamp, live, live.target);
    const before = read(gl, scene);
    const lose = gl.getContext().getExtension('WEBGL_lose_context')!;
    const restored = new Promise<void>((resolve) => {
      gl.domElement.addEventListener('webglcontextrestored', () => resolve(), { once: true });
    });
    const lost = new Promise<void>((resolve) => {
      gl.domElement.addEventListener('webglcontextlost', () => resolve(), { once: true });
    });
    lose.loseContext();
    await lost;
    // A task later: the browser allows a restore only once the loss event's dispatch is over.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    lose.restoreContext();
    await restored;
    const after = read(gl, scene);
    for (const [x, y] of [SHADOWED, LIT, CENTRE]) expect({ x, y, ok: close(after.at(x, y), before.at(x, y)) }).toMatchObject({ ok: true });
  });
});
