/**
 * The lamp lights of a baked project in a real browser: the lamp fixture
 * (`tests/fixtures/project-lamps/`, a table lamp and a pendant whose variants
 * carry a `lights` fact) mounted by url under a light temperature, its GLBs
 * swapped in over the stand-ins, and each lamp holding exactly its one fact
 * light, tinted to the current temperature.
 *
 * The cluster bake (`project-cluster.json` in the same folder, its own scene)
 * pins how a variant's heads load when there is more than one: heads that
 * cluster together — same colour and cutoff, within the 0.5 m linkage — are
 * ONE light at their centroid carrying the summed lumens, and heads past the
 * linkage stay one light per head.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { lampLightTag } from '../../src/assets/artificial-light.js';
import { lampCandela } from '../../src/lighting/lamp-units.js';
import { tintArtificialLights } from '../../src/render/light-temperature.js';
import { LAMP_PROJECT_FIXTURE as LAMPS } from '../fixtures/project/fixture-ids.js';
import { closeContainers, openContainer, until } from './support.js';

const PROJECT_URL = '/tests/fixtures/project-lamps/project.json';
/** The cluster bake: same folder, its own scene, the same stand-in GLBs. */
const CLUSTER_PROJECT_URL = '/tests/fixtures/project-lamps/project-cluster.json';
const TEMPERATURE = 3000;
/** A mount, a fetch, two GLBs and the frame-paced upgrade on the software rasteriser. */
const MOUNT_TIMEOUT_MS = 180_000;

/**
 * The two placements of the cluster bake's scene, named by their UUIDs (the
 * ids live only in the fixture's own JSON: `fixture-ids.ts` pins the first
 * lamp project and is not this bake's index).
 */
const CLUSTER = {
  /** Four heads on the corners of a 0.3 m square: one cluster under the 0.5 m linkage. */
  quad: '01a18304-6a72-7b80-91c0-22545f687ae8',
  /** Two heads 0.6 m apart on the pendant's axis: past the linkage, two lights. */
  pair: '01a18306-8d61-72b0-95a0-1263e49fadcd',
} as const;

let handle: ViewerHandle | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  handle?.dispose();
  handle = undefined;
  closeContainers();
});

/** The colour a light authored `hex` has under `TEMPERATURE`, by the same tint the viewer applies. */
function tinted(hex: string): number[] {
  const light = new THREE.PointLight(hex);
  light.userData['artificialLight'] = { colour: light.color.toArray() };
  tintArtificialLights(light, TEMPERATURE);
  return rounded(light.color.toArray());
}

/** Rounds a vector or colour array to a millionth, for exact assertions. */
function rounded(values: number[] | { toArray(): number[] }): number[] {
  const raw = Array.isArray(values) ? values : values.toArray();
  return raw.map((value) => Number(value.toFixed(6)));
}

/**
 * Mounts a lamp project and resolves the live scene: the rig is caught through
 * a one-shot spy on `Object3D.add`, restored in a `finally` so a failure never
 * leaves the patch installed for later tests in the worker.
 */
async function mountLiveScene(url: string): Promise<THREE.Scene> {
  let live: THREE.Scene | null = null;
  const add = Object.getOwnPropertyDescriptor(THREE.Object3D.prototype, 'add')!.value as THREE.Object3D['add'];
  const caught = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
    if ((this as THREE.Scene).isScene && objects.some((object) => object.name === 'jeex-lighting-apartment-rig'))
      live ??= this as THREE.Scene;
    return add.apply(this, objects);
  });
  try {
    handle = mountViewer(openContainer(480, 320), {
      scene: { url },
      tour: { mode: 'off' },
      debug: false,
      lighting: { temperature: TEMPERATURE },
    });
    await handle.ready;
    await until(() => live !== null, 'the live scene', 60_000);
    const models = (): Array<{ id: string; state: string }> => window.__viewerDebug?.assetModels() ?? [];
    await until(() => models().length === 2 && models().every((model) => model.state === 'gltf'), 'both lamp GLBs', 120_000);
  } finally {
    caught.mockRestore();
  }
  return live!;
}

describe('lamp lights of a baked project', () => {
  test(
    'each lamp holds one tagged light on its GLB body, tinted to the current temperature',
    async () => {
      const live = await mountLiveScene(PROJECT_URL);

      expect(handle!.getState().lightTemperature).toBe(TEMPERATURE);
      const lights: THREE.PointLight[] = [];
      live.traverse((object) => {
        if (lampLightTag(object) !== null) lights.push(object as THREE.PointLight);
      });
      const byPlacement = (id: string): THREE.PointLight[] => lights.filter((light) => lampLightTag(light)!.placementId === id);
      for (const id of [LAMPS.placement.tableLamp, LAMPS.placement.pendant]) {
        const own = byPlacement(id);
        expect({ id, count: own.length }).toEqual({ id, count: 1 });
        const light = own[0]!;
        // On the GLB body, not on a stand-in left behind.
        expect(light.parent?.name.endsWith('-gltf')).toBe(true);
        expect(rounded(light.color)).toEqual(tinted('#ffd9a4'));
      }
      expect(lights).toHaveLength(2);
    },
    MOUNT_TIMEOUT_MS,
  );

  test(
    'four clustered heads load as one light at their centroid; two heads 0.6 m apart stay two',
    async () => {
      const live = await mountLiveScene(CLUSTER_PROJECT_URL);

      expect(handle!.getState().lightTemperature).toBe(TEMPERATURE);
      const lights: THREE.PointLight[] = [];
      live.traverse((object) => {
        if (lampLightTag(object) !== null) lights.push(object as THREE.PointLight);
      });
      const byPlacement = (id: string): THREE.PointLight[] => lights.filter((light) => lampLightTag(light)!.placementId === id);

      // The four heads sit on the corners of a 0.3 m square — same colour and
      // cutoff, every pair within the 0.5 m linkage — so they load as ONE
      // light: the summed lumens at the summed candela, the centroid of the
      // four authored positions, the first head's fact index and its name.
      const quad = byPlacement(CLUSTER.quad);
      expect({ id: CLUSTER.quad, count: quad.length }).toEqual({ id: CLUSTER.quad, count: 1 });
      const merged = quad[0]!;
      expect(merged.parent?.name.endsWith('-gltf')).toBe(true);
      const mergedTag = lampLightTag(merged)!;
      expect({ index: mergedTag.index, lumens: mergedTag.lumens, cutoff: mergedTag.cutoff }).toEqual({
        index: 0,
        lumens: 1600,
        cutoff: 3,
      });
      expect(merged.name).toBe(`${CLUSTER.quad}-light`);
      expect(merged.intensity).toBeCloseTo(lampCandela(1600), 9);
      expect(merged.distance).toBe(3);
      // Centroid of [±0.15, 0.443, ±0.15]: the single head the four stand in for.
      expect(rounded(merged.position)).toEqual([0, 0.443, 0]);
      expect(rounded(merged.color)).toEqual(tinted('#ffd9a4'));

      // The pendant's two heads are 0.6 m apart on its axis — same colour and
      // cutoff, but past the linkage — so each keeps its own fact: its own
      // position, lumens, candela, cutoff, index and name.
      const pair = byPlacement(CLUSTER.pair);
      expect({ id: CLUSTER.pair, count: pair.length }).toEqual({ id: CLUSTER.pair, count: 2 });
      const [head0, head1] = pair.sort((a, b) => lampLightTag(a)!.index - lampLightTag(b)!.index);
      expect(head0!.name).toBe(`${CLUSTER.pair}-light`);
      expect(head1!.name).toBe(`${CLUSTER.pair}-light-2`);
      expect(rounded(head0!.position)).toEqual([0, 0.063, 0]);
      expect(rounded(head1!.position)).toEqual([0, 0.663, 0]);
      for (const head of [head0!, head1!]) {
        expect(head.parent?.name.endsWith('-gltf')).toBe(true);
        expect(head.distance).toBe(5.2);
        expect(head.intensity).toBeCloseTo(lampCandela(600), 9);
        expect(lampLightTag(head)!.lumens).toBe(600);
        expect(rounded(head.color)).toEqual(tinted('#ffd9a4'));
      }

      expect(lights).toHaveLength(3);
    },
    MOUNT_TIMEOUT_MS,
  );
});
