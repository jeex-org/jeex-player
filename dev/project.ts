/**
 * Mounts the viewer on a BAKED PROJECT folder: `scene.url` points at a
 * `project.json`, and everything on screen — the object bank, the GLB bodies,
 * the room finishes — comes from that folder rather than from the bundle.
 *
 * A dev page rather than a fixture a test drives directly, for the same reason
 * `scene-request.ts` is one: the `scene.url` path only exists in a real page.
 * The project is `tests/fixtures/project/`, which the dev server already
 * serves as static files at its own path — one GLB of a few hundred triangles
 * and two generator materials, so nothing binary beyond that fixture lives in
 * the repository.
 *
 * `?project=<url>` points it at another bake — a local copy of the demo
 * apartment, or one on a CDN — without touching this file.
 */

import { mountViewer, type ViewerHandle } from '../src/app/viewer-api.js';
import { isViewerLibError } from '../src/shared/errors.js';
import type { LogEntry } from '../src/shared/logger.js';

/** The fixture bake the dev server serves; `?project=` replaces it. */
const DEFAULT_PROJECT = '/tests/fixtures/project/project.json';

const url = new URL(window.location.href).searchParams.get('project') ?? DEFAULT_PROJECT;

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('project: no #stage container');

/**
 * Every `onLog` entry, on the page and on `window`.
 *
 * `asset-defect` and `project-budget` are the two codes this page exists to
 * make visible, and a browser check reads them off
 * `window.__projectLog` rather than out of the console.
 */
const entries: LogEntry[] = [];
window.__projectLog = entries;

const handle = mountViewer(stage, {
  // Development pages never send telemetry; `/dev/telemetry.html` is the one that tests it.
  analytics: 'off',
  scene: { url },
  tour: { mode: 'off' },
  onLog: (entry) => {
    entries.push(entry);
  },
});

// The handle itself, so a spec can ask `project()` the way a host would rather
// than reading the label this page prints from it.
window.jeexProject = handle;

/**
 * What the FIRST frame with furniture in it showed, kept for whoever asks
 * later.
 *
 * A baked project has no procedural bodies: the first frame is `dims`
 * stand-ins and the GLBs replace them afterwards. That transition
 * cannot be observed from OUTSIDE the page — over a warm cache the swap is
 * done before an automation's first poll lands — so the page samples it
 * itself, on every animation frame from the mount, and keeps the first sample
 * that had any bodies at all. `scripts/browser-check/project.ts` reads it.
 */
const firstFrame: ReturnType<NonNullable<Window['__viewerDebug']>['assetModels']> = [];
window.__projectFirstFrame = firstFrame;

const sampleFirstFrame = (): void => {
  const bodies = window.__viewerDebug?.assetModels() ?? [];
  if (bodies.length > 0) {
    firstFrame.push(...bodies);
    return;
  }
  requestAnimationFrame(sampleFirstFrame);
};
requestAnimationFrame(sampleFirstFrame);

/**
 * Why the mount FAILED, when it did.
 *
 * A bake whose manifest does not pass the schema must not be half-read: the
 * mount is rejected outright with `project-invalid`. That rejection
 * lands on `handle.ready`, which no page global reports — `__appReady` stays
 * false and there is nothing on screen to look at — so the page records the
 * code where an automation can read it. `?project=` is what points this page at
 * such a bake (`tests/fixtures/project-invalid/`, and any other broken folder).
 */
const label = document.querySelector<HTMLElement>('#project-label');

handle.ready
  .then(() => {
    // The manifest a host would read for its own chrome (a listing card, a
    // downloads menu): printed here so the page shows at a glance which bake is
    // on screen and that `project()` answered at all.
    const project = handle.project();
    if (!label) return;
    label.textContent = project
      ? `${project.manifest.title ?? project.manifest.projectId} · bake ${project.manifest.bakeId} · ${project.baseUrl}`
      : 'not a project: a bare scene';
  })
  .catch((error: unknown) => {
    const failure = {
      code: isViewerLibError(error) ? error.code : 'unknown',
      path: isViewerLibError(error) ? error.path : undefined,
      message: error instanceof Error ? error.message : String(error),
    };
    window.__projectError = failure;
    if (label) label.textContent = `refused: ${failure.code} · ${failure.message}`;
  });

declare global {
  interface Window {
    /** The mounted handle, so an automation can call `project()` itself. */
    jeexProject?: ViewerHandle;
    /** Every `onLog` entry the mount produced; `asset-defect` and `project-budget` are why. */
    __projectLog?: LogEntry[];
    /** The first frame that had furniture in it, sampled from a frame loop armed at mount time. */
    __projectFirstFrame?: ReturnType<NonNullable<Window['__viewerDebug']>['assetModels']>;
    /** Why the mount was refused, when it was: `{ code, path?, message }`. */
    __projectError?: { code: string; path?: string | undefined; message: string };
  }
}
