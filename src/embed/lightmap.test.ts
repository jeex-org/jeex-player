/**
 * The public `jeex-viewer/lightmap` entry: a façade test, not a behaviour test —
 * `lightmap/*.test.ts` cover the lights and the shell themselves. Proven here:
 *
 * - the entry is USABLE on its own, the way a bake pipeline uses it: the demo
 *   apartment's lights and shell are produced and each checked against its own
 *   schema, with every name imported from `./lightmap.js` alone;
 * - the export surface is EXACTLY the module header's documented list.
 */

import { describe, expect, test } from 'bun:test';
import { apartmentScene } from '../demo/scene-data.js';
import * as entry from './lightmap.js';
import {
  BAKE_LIGHTS_RECIPE,
  BAKE_SKY_HEMISPHERE_RECIPE,
  SHIPPED_BANK,
  SHIPPED_FINISHES,
  bakeLights,
  exportShellForBake,
  judgeBakeLights,
  judgeShellGltf,
} from './lightmap.js';

/** UUID v7 ids in sequence, the way a bake pipeline mints them. */
function minter(): () => string {
  let next = 0;
  return () => `01a1c000-0000-7000-8000-${(next++).toString(16).padStart(12, '0')}`;
}

describe('jeex-viewer/lightmap entry', () => {
  test("the demo apartment's bake lights come out under the published recipe and pass their own schema", () => {
    const lights = bakeLights(apartmentScene, SHIPPED_BANK);
    expect(lights.recipe).toBe(BAKE_LIGHTS_RECIPE);
    expect(judgeBakeLights(lights).ok).toBe(true);
    expect(BAKE_SKY_HEMISPHERE_RECIPE).toMatch(/@\d+$/);
  });

  test("the demo apartment's shell exports for the bake and its glTF passes the shell schema", async () => {
    const shell = await exportShellForBake(apartmentScene, { mintId: minter(), finishes: SHIPPED_FINISHES });
    // A GLB: a 12-byte header, then the JSON chunk's length, its type, and the JSON.
    const view = new DataView(shell.glb);
    const json: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(shell.glb, 20, view.getUint32(12, true))));
    expect(judgeShellGltf(json).ok).toBe(true);
  });

  test('the value surface is exactly the documented list', () => {
    expect(Object.keys(entry).sort()).toEqual(
      [
        'BAKE_LIGHTS_RECIPE',
        'BAKE_SKY_HEMISPHERE_RECIPE',
        'SHIPPED_BANK',
        'SHIPPED_FINISHES',
        'bakeLights',
        'bakeLightsSchema',
        'exportShellForBake',
        'judgeBakeLights',
        'judgeShellGltf',
        'shellGltfSchema',
      ].sort(),
    );
  });
});
