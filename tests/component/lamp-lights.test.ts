/**
 * The lamp lights of a baked project in a real browser: the lamp fixture
 * (`tests/fixtures/project-lamps/`, a table lamp and a pendant whose variants
 * carry a `lights` fact) mounted by url under a light temperature, its GLBs
 * swapped in over the stand-ins, and each lamp holding exactly its one fact
 * light, tinted to the current temperature.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { lampLightTag } from '../../src/assets/artificial-light.js';
import { tintArtificialLights } from '../../src/render/light-temperature.js';
import { LAMP_PROJECT_FIXTURE as LAMPS } from '../fixtures/project/fixture-ids.js';
import { closeContainers, openContainer, until } from './support.js';

const PROJECT_URL = '/tests/fixtures/project-lamps/project.json';
const TEMPERATURE = 3000;
/** A mount, a fetch, two GLBs and the frame-paced upgrade on the software rasteriser. */
const MOUNT_TIMEOUT_MS = 180_000;

let handle: ViewerHandle | undefined;

afterEach(() => {
  handle?.dispose();
  handle = undefined;
  closeContainers();
});

/** The colour a light authored `hex` has under `TEMPERATURE`, by the same tint the viewer applies. */
function tinted(hex: string): number[] {
  const light = new THREE.PointLight(hex);
  light.userData['artificialLight'] = { colour: light.color.toArray() };
  tintArtificialLights(light, TEMPERATURE);
  return light.color.toArray();
}

describe('lamp lights of a baked project', () => {
  test(
    'each lamp holds one tagged light on its GLB body, tinted to the current temperature',
    async () => {
      let live: THREE.Scene | null = null;
      const add = Object.getOwnPropertyDescriptor(THREE.Object3D.prototype, 'add')!.value as THREE.Object3D['add'];
      const caught = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
        if ((this as THREE.Scene).isScene && objects.some((object) => object.name === 'jeex-lighting-apartment-rig'))
          live ??= this as THREE.Scene;
        return add.apply(this, objects);
      });
      handle = mountViewer(openContainer(480, 320), {
        scene: { url: PROJECT_URL },
        tour: { mode: 'off' },
        debug: false,
        lighting: { temperature: TEMPERATURE },
      });
      await handle.ready;
      await until(() => live !== null, 'the live scene', 60_000);
      caught.mockRestore();
      const models = (): Array<{ id: string; state: string }> => window.__viewerDebug?.assetModels() ?? [];
      await until(() => models().length === 2 && models().every((model) => model.state === 'gltf'), 'both lamp GLBs', 120_000);

      expect(handle.getState().lightTemperature).toBe(TEMPERATURE);
      const lights: THREE.PointLight[] = [];
      live!.traverse((object) => {
        if (lampLightTag(object) !== null) lights.push(object as THREE.PointLight);
      });
      const byPlacement = (id: string): THREE.PointLight[] => lights.filter((light) => lampLightTag(light)!.placementId === id);
      for (const id of [LAMPS.placement.tableLamp, LAMPS.placement.pendant]) {
        const own = byPlacement(id);
        expect({ id, count: own.length }).toEqual({ id, count: 1 });
        const light = own[0]!;
        // On the GLB body, not on a stand-in left behind.
        expect(light.parent?.name.endsWith('-gltf')).toBe(true);
        expect(light.color.toArray().map((value) => Number(value.toFixed(6)))).toEqual(
          tinted('#ffd9a4').map((value) => Number(value.toFixed(6))),
        );
      }
      expect(lights).toHaveLength(2);
    },
    MOUNT_TIMEOUT_MS,
  );
});
