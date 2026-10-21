/**
 * Mounts the viewer with `scene: { url }`, the one form that goes through
 * `FetchSceneRepository` and therefore actually sends the `Accept:
 * application/json; jeex-viewer=<version>` header over the network.
 *
 * A dev page rather than a fixture the test drives directly: `mountViewer`'s
 * `scene.url` path is only reachable through a real page, and
 * `tests/e2e/scene-request.spec.ts` intercepts the request with
 * `page.route` — the demo apartment answers it, so no scene JSON has to be
 * committed as a static asset just for this one request.
 */

import { mountViewer } from '../src/app/viewer-api.js';

const SCENE_URL = '/e2e-fixtures/scene-request.json';

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('scene-request: no #stage container');

mountViewer(stage, { scene: { url: SCENE_URL }, analytics: 'off' });
