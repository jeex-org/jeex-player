/**
 * The tour-camera tool's obstacles come from the mounted document's bank, so a
 * checkpoint dropped onto a baked project's own sofa is judged against it.
 */

import { describe, expect, test } from 'bun:test';
import { STORE_IDS } from '../../tests/fixtures/store-ids/store-ids.js';
import { projectAssetFacts, shippedAssetFacts, type AssetFactsSource } from '../assets/asset-facts.js';
import { apartmentScene } from '../demo/scene-data.js';
import { checkpointsWiring } from './checkpoints-wiring.js';
import type { SceneMount } from './scene-mount.js';
import type { ViewerEvents } from './viewer-events.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { HandleCommands } from './handle-commands.js';

function obstaclesWith(facts: AssetFactsSource): number {
  const mount = { model: { scene: { ...apartmentScene, assets: STORE_IDS.assets } }, assetFacts: () => facts } as unknown as SceneMount;
  const wiring = checkpointsWiring({
    visible: () => true,
    events: {} as ViewerEvents,
    mount: () => mount,
    stage: () => undefined,
    handle: () => ({}) as HandleCommands,
    ui: {} as ViewerUI,
  });
  return wiring.obstacles().length;
}

describe('checkpoints read the mounted document’s bank', () => {
  test('the store-id flat has its 44 obstacles through its own library, none through the shipped bank', () => {
    expect(obstaclesWith(projectAssetFacts(STORE_IDS.library))).toBe(44);
    expect(obstaclesWith(shippedAssetFacts)).toBe(0);
  });
});
