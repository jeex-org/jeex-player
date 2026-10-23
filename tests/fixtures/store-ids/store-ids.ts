/**
 * The demo apartment exported as a baked project whose library carries
 * store-minted UUIDs: every archetype and variant id is one the built-in bank
 * has never seen, and `dims` are the models' overall bounding boxes. Only what
 * the floor questions read is kept: the library's objects and the scene's
 * placements, which stand on the demo apartment's own plan.
 */

import data from './store-ids.json';
import type { FactsLibrary } from '../../../src/assets/asset-facts.js';
import type { DemoAsset } from '../../../src/scene/types.js';

export const STORE_IDS = data as unknown as { readonly library: FactsLibrary; readonly assets: DemoAsset[] };
