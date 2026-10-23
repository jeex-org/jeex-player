/**
 * Contract tests for the lighting context and its rigs, with real three.js
 * objects and a stub renderer: Bun has no WebGL, so the namespace handed in
 * carries a `PMREMGenerator` that answers a plain render target. Every class
 * in the namespace is a counting subclass, which is how the tests see that
 * each object was built by the caller's engine and released again.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { createLightingContext, type LightingContext } from './lighting-context.js';
import { LightingError, type LightingErrorCode } from './lighting-error.js';
import { apartmentEnvironmentIntensity, LIGHTING_STANDARD, referenceEnvironmentIntensity } from './lighting-standard.js';
import type { LightingRenderer, LightingThree } from './lighting-three.js';
import { fitShadowFrustum } from './shadow-fit.js';
import { sunDirection } from './sun-direction.js';

type Ledger = {
  textures: THREE.DataTexture[];
  targets: THREE.WebGLRenderTarget[];
  generators: number;
  disposedGenerators: number;
  disposed: Set<object>;
};

function engine(overrides: Partial<Record<keyof LightingThree, unknown>> = {}, failPmrem = false) {
  const ledger: Ledger = { textures: [], targets: [], generators: 0, disposedGenerators: 0, disposed: new Set() };
  class CountedTexture extends THREE.DataTexture {
    constructor(...args: ConstructorParameters<typeof THREE.DataTexture>) {
      super(...args);
      ledger.textures.push(this);
      this.addEventListener('dispose', () => ledger.disposed.add(this));
    }
  }
  class StubGenerator {
    constructor(_renderer: unknown) {
      ledger.generators += 1;
    }
    fromEquirectangular(source: THREE.DataTexture): THREE.WebGLRenderTarget {
      if (failPmrem) throw new Error('no GPU');
      const target = new THREE.WebGLRenderTarget(source.image.width / 4, source.image.width / 4);
      ledger.targets.push(target);
      target.addEventListener('dispose', () => ledger.disposed.add(target));
      return target;
    }
    dispose(): void {
      ledger.disposedGenerators += 1;
    }
  }
  class OwnGroup extends THREE.Group {}
  class OwnDirectional extends THREE.DirectionalLight {}
  class OwnHemisphere extends THREE.HemisphereLight {}
  const three = {
    REVISION: THREE.REVISION,
    ColorManagement: THREE.ColorManagement,
    NeutralToneMapping: THREE.NeutralToneMapping,
    SRGBColorSpace: THREE.SRGBColorSpace,
    LinearSRGBColorSpace: THREE.LinearSRGBColorSpace,
    PCFShadowMap: THREE.PCFShadowMap,
    HalfFloatType: THREE.HalfFloatType,
    RGBAFormat: THREE.RGBAFormat,
    LinearFilter: THREE.LinearFilter,
    EquirectangularReflectionMapping: THREE.EquirectangularReflectionMapping,
    DataTexture: CountedTexture,
    PMREMGenerator: StubGenerator,
    Group: OwnGroup,
    DirectionalLight: OwnDirectional,
    HemisphereLight: OwnHemisphere,
    ...overrides,
  } as unknown as LightingThree;
  return { three, ledger, OwnGroup, OwnDirectional, OwnHemisphere };
}

function stubRenderer(maxTextureSize = 16_384): LightingRenderer {
  return {
    capabilities: { maxTextureSize },
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 0.5,
    outputColorSpace: THREE.LinearSRGBColorSpace,
  } as unknown as LightingRenderer;
}

function codeOf(run: () => unknown): LightingErrorCode | 'none' | 'other' {
  try {
    run();
    return 'none';
  } catch (error) {
    return error instanceof LightingError ? error.code : 'other';
  }
}

function lightsOf(scene: THREE.Scene): THREE.Light[] {
  const lights: THREE.Light[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Light).isLight) lights.push(object as THREE.Light);
  });
  return lights;
}

function context(): { lighting: LightingContext; ledger: Ledger } {
  const { three, ledger } = engine();
  return { lighting: createLightingContext(three, stubRenderer()), ledger };
}

describe('creation', () => {
  test('a foreign revision is refused before anything is allocated, naming both revisions', () => {
    const { three, ledger } = engine({ REVISION: '185' });
    const renderer = stubRenderer();
    let message = '';
    try {
      createLightingContext(three, renderer);
    } catch (error) {
      expect(error).toBeInstanceOf(LightingError);
      expect((error as LightingError).code).toBe('engine-revision');
      message = (error as Error).message;
    }
    expect(message).toContain('186');
    expect(message).toContain('185');
    expect(ledger.textures.length + ledger.targets.length + ledger.generators).toBe(0);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  });

  test('colour management off, or a foreign working space, is refused before anything is allocated', () => {
    for (const management of [
      { enabled: false, workingColorSpace: THREE.LinearSRGBColorSpace },
      { enabled: true, workingColorSpace: THREE.SRGBColorSpace },
    ]) {
      const { three, ledger } = engine({ ColorManagement: management });
      expect(codeOf(() => createLightingContext(three, stubRenderer()))).toBe('colour-management');
      expect(ledger.textures.length + ledger.targets.length + ledger.generators).toBe(0);
    }
    // The global was only read, never written.
    expect(THREE.ColorManagement.enabled).toBe(true);
  });

  test('sets the display transform and PCF shadows on the renderer', () => {
    const { three } = engine();
    const renderer = stubRenderer();
    createLightingContext(three, renderer);
    expect(renderer.toneMapping).toBe(THREE.NeutralToneMapping);
    expect(renderer.toneMappingExposure).toBe(1);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
  });

  test('keeps the PMREM target and releases the source texture and the generator', () => {
    const { ledger } = context();
    expect(ledger.textures).toHaveLength(1);
    const source = ledger.textures[0]!;
    expect(source.type).toBe(THREE.HalfFloatType);
    expect(source.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(source.image.width).toBe(LIGHTING_STANDARD.environment.recipe.width);
    expect(ledger.disposed.has(source)).toBe(true);
    expect(ledger.generators).toBe(1);
    expect(ledger.disposedGenerators).toBe(1);
    expect(ledger.disposed.has(ledger.targets[0]!)).toBe(false);
  });

  test('a failed prefilter releases the source texture and the generator', () => {
    const { three, ledger } = engine({}, true);
    expect(codeOf(() => createLightingContext(three, stubRenderer()))).toBe('other');
    expect(ledger.disposed.has(ledger.textures[0]!)).toBe(true);
    expect(ledger.disposedGenerators).toBe(1);
  });
});

describe('rigs', () => {
  test('the reference rig: the environment at the calibrated intensity and one white unshadowed key', () => {
    const { three, OwnDirectional, OwnGroup } = engine();
    const lighting = createLightingContext(three, stubRenderer());
    const scene = new THREE.Scene();
    lighting.createReferenceRig().attach(scene);
    expect(scene.environment).not.toBeNull();
    expect(scene.environmentIntensity).toBe(referenceEnvironmentIntensity());
    const lights = lightsOf(scene);
    expect(lights).toHaveLength(1);
    const key = lights[0] as THREE.DirectionalLight;
    expect(key).toBeInstanceOf(OwnDirectional);
    expect(key.parent).toBeInstanceOf(OwnGroup);
    expect(key.color.getHex()).toBe(0xffffff);
    expect(key.intensity).toBe(1);
    expect(key.castShadow).toBe(false);
  });

  test("the apartment rig: the standard's sky, shadow-casting sun and shadowless fill", () => {
    const { three, OwnDirectional, OwnHemisphere } = engine();
    const lighting = createLightingContext(three, stubRenderer());
    const scene = new THREE.Scene();
    lighting.createApartmentRig().attach(scene);
    const { apartment } = LIGHTING_STANDARD;
    expect(scene.environmentIntensity).toBe(apartmentEnvironmentIntensity());
    const lights = lightsOf(scene);
    expect(lights).toHaveLength(3);
    const sky = lights.find((light) => light instanceof OwnHemisphere) as THREE.HemisphereLight;
    expect(sky.intensity).toBe(apartment.hemisphere.intensity);
    expect(sky.color.getHexString()).toBe(new THREE.Color(apartment.hemisphere.sky).getHexString());
    const directional = lights.filter((light) => light instanceof OwnDirectional) as THREE.DirectionalLight[];
    const sun = directional.find((light) => light.castShadow)!;
    const fill = directional.find((light) => !light.castShadow)!;
    expect(sun.intensity).toBe(apartment.sun.intensity);
    expect(sun.position.toArray()).toEqual([...apartment.sun.position]);
    expect(sun.target.position.toArray()).toEqual([...apartment.sun.target]);
    expect(sun.target.parent).toBe(sun.parent);
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(sun.shadow.camera.right).toBe(apartment.sun.shadow.extent);
    expect(sun.shadow.bias).toBe(apartment.sun.shadow.bias);
    expect(fill.intensity).toBe(apartment.fill.intensity);
    expect(fill.position.toArray()).toEqual([...apartment.fill.position]);
  });

  test('a shadow map size is honoured, and lowered to the renderer maximum', () => {
    const { three } = engine();
    const sizeOf = (lighting: LightingContext, shadowMapSize: number): number => {
      const scene = new THREE.Scene();
      lighting.createApartmentRig({ shadowMapSize }).attach(scene);
      return (lightsOf(scene).find((light) => light.castShadow) as THREE.DirectionalLight).shadow.mapSize.x;
    };
    expect(sizeOf(createLightingContext(three, stubRenderer()), 512)).toBe(512);
    expect(sizeOf(createLightingContext(three, stubRenderer(1024)), 4096)).toBe(1024);
  });

  test('every refused option is bad-options, before any scene changes', () => {
    const { lighting } = context();
    for (const options of [
      { shadowMapSize: 0 },
      { shadowMapSize: 1000 },
      { shadowMapSize: 8192 },
      { shadowMapSize: 2048.5 },
      { shadowMapSize: Number.NaN },
      { shadowMapSize: '2048' },
      { colour: 'red' },
    ]) {
      expect(codeOf(() => lighting.createApartmentRig(options as never))).toBe('bad-options');
    }
    let message = '';
    try {
      lighting.createApartmentRig({ shadowMapSize: 1000 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('shadowMapSize');
  });
});

describe('attachment', () => {
  test('one rig per scene, across contexts', () => {
    const first = context().lighting;
    const second = context().lighting;
    const scene = new THREE.Scene();
    first.createReferenceRig().attach(scene);
    const before = scene.children.length;
    expect(codeOf(() => first.createApartmentRig().attach(scene))).toBe('scene-has-rig');
    expect(codeOf(() => second.createReferenceRig().attach(scene))).toBe('scene-has-rig');
    expect(scene.children.length).toBe(before);
    expect(scene.environmentIntensity).toBe(referenceEnvironmentIntensity());
  });

  test('a rig on one scene cannot be attached to another', () => {
    const { lighting } = context();
    const rig = lighting.createReferenceRig();
    const one = new THREE.Scene();
    const two = new THREE.Scene();
    rig.attach(one);
    expect(codeOf(() => rig.attach(two))).toBe('rig-attached');
    expect(rig.scene).toBe(one);
    expect(two.children).toHaveLength(0);
  });

  test('attaching twice and detaching early change nothing and throw nothing', () => {
    const { lighting } = context();
    const rig = lighting.createApartmentRig();
    expect(codeOf(() => rig.detach())).toBe('none');
    const scene = new THREE.Scene();
    rig.attach(scene);
    const children = scene.children.length;
    expect(codeOf(() => rig.attach(scene))).toBe('none');
    expect(scene.children.length).toBe(children);
  });

  test('detach restores the environment, its intensity and its rotation', () => {
    const { lighting } = context();
    const scene = new THREE.Scene();
    const own = new THREE.Texture();
    scene.environment = own;
    scene.environmentIntensity = 0.3;
    scene.environmentRotation.set(0.1, 0.2, 0.3, 'YXZ');
    const rig = lighting.createReferenceRig();
    rig.attach(scene);
    expect(scene.environmentRotation.toArray()).toEqual([0, 0, 0, 'YXZ']);
    rig.detach();
    expect(lightsOf(scene)).toHaveLength(0);
    expect(scene.environment).toBe(own);
    expect(scene.environmentIntensity).toBe(0.3);
    expect(scene.environmentRotation.toArray()).toEqual([0.1, 0.2, 0.3, 'YXZ']);
  });

  test("a caller's own environment set meanwhile survives the detach", () => {
    const { lighting } = context();
    const scene = new THREE.Scene();
    const rig = lighting.createReferenceRig();
    rig.attach(scene);
    const mine = new THREE.Texture();
    scene.environment = mine;
    scene.environmentIntensity = 2;
    scene.environmentRotation.set(0, 1, 0);
    rig.detach();
    expect(scene.environment).toBe(mine);
    expect(scene.environmentIntensity).toBe(2);
    expect(scene.environmentRotation.y).toBe(1);
  });

  test('after a detach the scene takes another rig', () => {
    const { lighting } = context();
    const scene = new THREE.Scene();
    const rig = lighting.createReferenceRig();
    rig.attach(scene);
    rig.detach();
    expect(codeOf(() => lighting.createApartmentRig().attach(scene))).toBe('none');
  });
});

describe('disposal', () => {
  test('a rig and a context dispose idempotently', () => {
    const { lighting } = context();
    const rig = lighting.createApartmentRig();
    rig.dispose();
    expect(codeOf(() => rig.dispose())).toBe('none');
    lighting.dispose();
    expect(codeOf(() => lighting.dispose())).toBe('none');
    expect(lighting.disposed).toBe(true);
  });

  test('a disposed rig releases its shadow map and cannot be attached', () => {
    const { lighting } = context();
    const rig = lighting.createApartmentRig();
    const scene = new THREE.Scene();
    rig.attach(scene);
    const sun = lightsOf(scene).find((light) => light.castShadow) as THREE.DirectionalLight;
    let released = false;
    sun.shadow.dispose = () => {
      released = true;
    };
    rig.dispose();
    expect(released).toBe(true);
    expect(lightsOf(scene)).toHaveLength(0);
    expect(codeOf(() => rig.attach(scene))).toBe('disposed');
  });

  test('disposing the context first detaches its rigs, restores the scene and releases the environment', () => {
    const { lighting, ledger } = context();
    const scene = new THREE.Scene();
    const rig = lighting.createReferenceRig();
    rig.attach(scene);
    lighting.dispose();
    expect(rig.scene).toBeNull();
    expect(scene.environment).toBeNull();
    expect(scene.environmentIntensity).toBe(1);
    expect(lightsOf(scene)).toHaveLength(0);
    expect(ledger.disposed.has(ledger.targets[0]!)).toBe(true);
    expect(codeOf(() => rig.attach(scene))).toBe('disposed');
    expect(codeOf(() => lighting.createReferenceRig())).toBe('disposed');
    expect(codeOf(() => lighting.createApartmentRig())).toBe('disposed');
  });

  test('two contexts: disposing one leaves the other lighting its scene', () => {
    const one = context();
    const two = context();
    const first = new THREE.Scene();
    const scene = new THREE.Scene();
    one.lighting.createReferenceRig().attach(first);
    two.lighting.createApartmentRig().attach(scene);
    one.lighting.dispose();
    expect(lightsOf(first)).toHaveLength(0);
    expect(lightsOf(scene)).toHaveLength(3);
    expect(scene.environment).toBe(two.ledger.targets[0]!.texture);
    expect(two.ledger.disposed.has(two.ledger.targets[0]!)).toBe(false);
  });

  test('never disposes what the caller owns', () => {
    const { lighting } = context();
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial();
    const geometry = new THREE.BoxGeometry();
    scene.add(new THREE.Mesh(geometry, material));
    let disposed = 0;
    material.addEventListener('dispose', () => (disposed += 1));
    geometry.addEventListener('dispose', () => (disposed += 1));
    lighting.createApartmentRig().attach(scene);
    lighting.dispose();
    expect(disposed).toBe(0);
    expect(scene.children).toHaveLength(1);
  });
});

describe('the apartment rig sun', () => {
  function sunOf(scene: THREE.Scene): THREE.DirectionalLight {
    return lightsOf(scene).find((light) => light.castShadow) as THREE.DirectionalLight;
  }

  function attached(options?: Parameters<LightingContext['createApartmentRig']>[0], maxTextureSize?: number) {
    const { three } = engine();
    const lighting = createLightingContext(three, stubRenderer(maxTextureSize));
    const scene = new THREE.Scene();
    const rig = lighting.createApartmentRig(options);
    rig.attach(scene);
    return { rig, scene, sun: sunOf(scene) };
  }

  /** Everything a setter must leave alone: the other lights and the environment. */
  function others(scene: THREE.Scene): string {
    const lights = lightsOf(scene)
      .filter((light) => !light.castShadow)
      .map((light) => [light.type, light.intensity, light.position.toArray(), light.color.getHexString()]);
    return JSON.stringify({ lights, environment: scene.environment?.uuid, intensity: scene.environmentIntensity });
  }

  test('reports its effective shadow map size: 2048 by default, lowered to the renderer maximum', () => {
    expect(attached().rig.shadowMapSize).toBe(2048);
    expect(attached({ shadowMapSize: 512 }).rig.shadowMapSize).toBe(512);
    expect(attached({ shadowMapSize: 4096 }, 2048).rig.shadowMapSize).toBe(2048);
  });

  test('shadows stay live unless caching is asked for', () => {
    const { sun } = attached();
    expect(sun.shadow.autoUpdate).toBe(true);
    expect(attached({ shadowCache: false }).sun.shadow.autoUpdate).toBe(true);
  });

  test('a cached sun is drawn on the first render and afterwards only when told', () => {
    const { rig, sun } = attached({ shadowCache: true });
    expect(sun.shadow.autoUpdate).toBe(false);
    expect(sun.shadow.needsUpdate).toBe(true);
    // What three does after it drew the map.
    sun.shadow.needsUpdate = false;
    rig.markShadowDirty();
    expect(sun.shadow.needsUpdate).toBe(true);
    sun.shadow.needsUpdate = false;
    rig.setSunDirection([0, 1, 0]);
    expect(sun.shadow.needsUpdate).toBe(true);
    sun.shadow.needsUpdate = false;
    rig.setShadowFrustum(fitShadowFrustum([{ min: [0, 0, 0], max: [5, 3, 5] }], [0, 1, 0], rig.shadowMapSize));
    expect(sun.shadow.needsUpdate).toBe(true);
  });

  test('a non-boolean cache option is refused as bad-options', () => {
    const { lighting } = context();
    expect(codeOf(() => lighting.createApartmentRig({ shadowCache: 'yes' } as never))).toBe('bad-options');
  });

  test('setting the sun direction moves the light along the opposite of it and leaves the rest alone', () => {
    const { rig, scene, sun } = attached();
    const before = others(scene);
    const target = sun.target.position.clone();
    const direction = sunDirection({ northDeg: 30, sun: 'evening' }).direction;
    rig.setSunDirection(direction);
    const travel = sun.target.position.clone().sub(sun.position).normalize();
    travel.toArray().forEach((value, axis) => expect(value).toBeCloseTo(-direction[axis]!, 9));
    expect(sun.target.position.toArray()).toEqual(target.toArray());
    expect(others(scene)).toBe(before);
  });

  test('setting the frustum puts the light, its target, the camera up and the planes where the fit says', () => {
    const { rig, sun } = attached();
    const boxes = [
      { min: [0, 0, 0], max: [9, 2.7, 7] },
      { min: [-2, -0.2, 3], max: [1, 1, 12] },
    ] as const;
    const direction = sunDirection({ northDeg: 0, sun: 'noon' }).direction;
    const fit = fitShadowFrustum(boxes, direction, rig.shadowMapSize);
    rig.setShadowFrustum(fit);
    const camera = sun.shadow.camera;
    expect(sun.position.toArray()).toEqual([...fit.position]);
    expect(sun.target.position.toArray()).toEqual([...fit.target]);
    expect(camera.up.toArray()).toEqual([...fit.up]);
    expect([camera.left, camera.right, camera.top, camera.bottom, camera.near, camera.far]).toEqual([
      fit.left,
      fit.right,
      fit.top,
      fit.bottom,
      fit.near,
      fit.far,
    ]);
    expect(sun.shadow.bias).toBe(fit.bias);
    expect(sun.shadow.normalBias).toBe(fit.normalBias);
    const fresh = new THREE.OrthographicCamera(fit.left, fit.right, fit.top, fit.bottom, fit.near, fit.far);
    expect(camera.projectionMatrix.toArray()).toEqual(fresh.projectionMatrix.toArray());
    sun.updateMatrixWorld(true);
    sun.target.updateMatrixWorld(true);
    sun.shadow.updateMatrices(sun);
    const clip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    for (const box of boxes) {
      for (const x of [box.min[0], box.max[0]])
        for (const y of [box.min[1], box.max[1]])
          for (const z of [box.min[2], box.max[2]]) {
            const ndc = new THREE.Vector3(x, y, z).applyMatrix4(clip);
            for (const axis of ndc.toArray()) expect(Math.abs(axis)).toBeLessThanOrEqual(1 + 1e-9);
          }
    }
  });

  test('a bad direction or frustum is refused as bad-options and the sun is unchanged', () => {
    const { rig, sun } = attached();
    const snapshot = (): string =>
      JSON.stringify([
        sun.position.toArray(),
        sun.target.position.toArray(),
        sun.shadow.camera.toJSON(),
        sun.shadow.bias,
        sun.shadow.normalBias,
      ]);
    const before = snapshot();
    const good = fitShadowFrustum([{ min: [0, 0, 0], max: [4, 3, 4] }], [0, 1, 0], 2048);
    const refusals: Array<() => unknown> = [
      () => rig.setSunDirection([0, 0, 0]),
      () => rig.setSunDirection([Number.NaN, 1, 0]),
      () => rig.setSunDirection([0, -1, 0]),
      () => rig.setSunDirection([1, 0, 0]),
      () => rig.setShadowFrustum({ ...good, left: Number.NaN }),
      () => rig.setShadowFrustum({ ...good, left: good.right }),
      () => rig.setShadowFrustum({ ...good, top: good.bottom - 1 }),
      () => rig.setShadowFrustum({ ...good, near: good.far }),
      () => rig.setShadowFrustum({ ...good, position: [0, Number.POSITIVE_INFINITY, 0] }),
      () => rig.setShadowFrustum({ ...good, up: [0, 0, 0] }),
      () => rig.setShadowFrustum({ ...good, position: good.target }),
      () => rig.setShadowFrustum({ ...good, bias: Number.NaN }),
    ];
    for (const run of refusals) expect(codeOf(run)).toBe('bad-options');
    expect(snapshot()).toBe(before);
  });

  test('a disposed rig refuses its setters', () => {
    const { rig } = attached();
    rig.dispose();
    expect(codeOf(() => rig.setSunDirection([0, 1, 0]))).toBe('disposed');
    expect(codeOf(() => rig.markShadowDirty())).toBe('disposed');
  });
});
