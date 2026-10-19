/**
 * Two viewers on one page whose SOURCES are of different kinds: a baked
 * project folder on the left, a bare inline scene document on the right.
 *
 * `dev/embed-two.ts` already proves input, locale and the page globals are per
 * instance. This page proves the thing the baked-project format added: the
 * CATALOGUE is per instance too. Before the format the object bank, the finish
 * bank and the model resolver were module singletons, so one page could only
 * ever have one of each; after it, each viewer answers `project()` for itself —
 * the manifest on the left, `null` on the right — and draws the bodies its own
 * source named: a GLB out of the bake, and a procedural body out of the shipped
 * builders.
 *
 * `tests/e2e/project.spec.ts` drives it. A dev page rather than a fixture a
 * test constructs, for the same reason `dev/project.ts` is one: the `scene.url`
 * path only exists in a real page.
 */

import { mountViewer, type ViewerHandle } from '../src/app/viewer-api.js';
import { apartmentScene } from '../src/demo/scene-data.js';

/** The fixture bake the dev server serves as static files. */
const PROJECT_URL = '/tests/fixtures/project/project.json';

function stage(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (!element) throw new Error(`project-two: no #${id} container`);
  return element;
}

async function main(): Promise<void> {
  const project = mountViewer(stage('stage-project'), { scene: { url: PROJECT_URL }, tour: { mode: 'off' } });
  // A structured clone so the two viewers cannot even in principle be looking
  // at one object: `getScene()` hands back a copy, and this is the other side
  // of the same guarantee.
  const bare = mountViewer(stage('stage-bare'), { scene: { document: structuredClone(apartmentScene) }, tour: { mode: 'off' } });

  window.jeexProjectPair = { project, bare };

  await Promise.all([project.ready, bare.ready]);
  window.__projectTwoReady = true;
}

declare global {
  interface Window {
    /** Both handles, so a spec can ask each one what it loaded. */
    jeexProjectPair?: { project: ViewerHandle; bare: ViewerHandle };
    /** Set once BOTH viewers have rendered their first frame. */
    __projectTwoReady?: boolean;
  }
}

void main();
