/**
 * A BAKED PROJECT in a real browser, against a real server.
 *
 * Three facts only a page can carry, one test each:
 *
 * 1. `dev/project.html` opens `tests/fixtures/project/` by `scene.url`: the
 *    first frame with furniture in it is a `dims` STAND-IN, the GLB out of the
 *    bake then replaces it, and `handle.project()` hands the host the manifest
 *    the viewer validated.
 * 2. `dev/project-two.html` puts a bake beside a bare inline scene. Catalogue
 *    state is per instance: each viewer answers `project()` for itself.
 * 3. A manifest that fails the schema is refused outright, with
 *    `project-invalid`, rather than half-read.
 *
 * The stand-in is the delicate one. It exists for exactly the stretch of frames
 * between the build and the fetch that replaces it, and over a warm cache that
 * stretch is shorter than one round trip out to Playwright — so the PAGE
 * samples it from a frame loop armed at mount time (`dev/project.ts`,
 * `__projectFirstFrame`) and this spec reads what the page kept. A spec that
 * polled `assetModels()` from out here would read the swapped body and report a
 * stand-in that never existed, and a gate run was once lost to exactly that.
 */

import { expect, test } from '@playwright/test';
import { PROJECT_FIXTURE } from '../fixtures/project/fixture-ids.js';
import { waitForBoot } from './support.js';
import { scaled } from './time-scale.js';

/** The bake the dev server serves as static files; every request must stay inside it. */
const PROJECT_PATH = '/tests/fixtures/project/';

/** A copy of that manifest whose `scene` climbs out of the folder — text only, no binaries. */
const INVALID_PROJECT = '/tests/fixtures/project-invalid/project.json';

/** How long the fixture GLB may take to arrive and swap in. A local static file; generous anyway. */
const SWAP_TIMEOUT_MS = scaled(30_000);

test('opens a bake by url: a stand-in first, then the GLB, and the manifest on the handle', async ({ page }) => {
  await page.goto('/dev/project.html');
  await waitForBoot(page, 'window.__appReady === true');

  // What the page kept of the first frame that had furniture in it.
  await page.waitForFunction('window.__projectFirstFrame.length > 0');
  const first = await page.evaluate(() => window.__projectFirstFrame ?? []);
  expect(first).toEqual([expect.objectContaining({ id: PROJECT_FIXTURE.placement.sofa, state: 'procedural', degraded: 'pending-model' })]);
  expect(first[0]!.triangles).toBeGreaterThan(0);

  // The GLB replaces it, in the same group, drawing triangles of its own.
  await page.waitForFunction("window.__viewerDebug.assetModels().every((body) => body.state === 'gltf')", undefined, {
    timeout: SWAP_TIMEOUT_MS,
  });
  const swapped = await page.evaluate(() => window.__viewerDebug!.assetModels());
  expect(swapped).toHaveLength(1);
  expect(swapped[0]!.degraded).toBeUndefined();
  expect(swapped[0]!.triangles).toBeGreaterThan(0);

  // `project()` answers with the manifest the viewer VALIDATED, so a host's own
  // chrome can read `title`, `media` and `rights` off it.
  const project = await page.evaluate(() => {
    const info = window.jeexProject?.project() ?? null;
    return (
      info && {
        libraryId: info.manifest.library.id,
        projectId: info.manifest.projectId,
        bakeId: info.manifest.bakeId,
        baseUrl: info.baseUrl,
      }
    );
  });
  expect(project).not.toBeNull();
  expect(project!.libraryId).toBe(PROJECT_FIXTURE.projectId);
  expect(project!.projectId).toBe(PROJECT_FIXTURE.projectId);
  expect(project!.bakeId).toBe(PROJECT_FIXTURE.bakeId);
  expect(project!.baseUrl).toBe(new URL(PROJECT_PATH, page.url()).href);

  // The document came out of the bake, and a clean bake logs nothing.
  expect(await page.evaluate(() => window.__viewerDebug!.exportScene!()?.assetLibrary)).toBe(PROJECT_FIXTURE.projectId);
  expect(await page.evaluate(() => (window.__projectLog ?? []).map((entry) => entry.code))).toEqual([]);
});

test('a bake and a bare scene on one page do not share catalogue state', async ({ page }) => {
  await page.goto('/dev/project-two.html');
  await waitForBoot(page, 'window.__projectTwoReady === true');

  const answers = await page.evaluate(() => {
    const pair = window.jeexProjectPair!;
    const read = (handle: (typeof pair)['project']) => ({
      libraryId: handle.project()?.manifest.library.id ?? null,
      sceneLibrary: handle.getScene()?.assetLibrary ?? null,
      sceneId: handle.getScene()?.id ?? null,
    });
    return { project: read(pair.project), bare: read(pair.bare) };
  });

  // Each viewer answers for ITSELF: the manifest on the left, `null` on the right.
  expect(answers.project.libraryId).toBe(PROJECT_FIXTURE.projectId);
  expect(answers.bare.libraryId).toBeNull();
  expect(answers.project.sceneLibrary).toBe(PROJECT_FIXTURE.projectId);
  expect(answers.bare.sceneLibrary).toBeNull();
  expect(answers.project.sceneId).not.toBe(answers.bare.sceneId);

  // The page globals belong to the FIRST viewer (`viewer-globals.ts`), which is
  // the bake — so what `assetModels()` reports is the bake's one object and not
  // the demo apartment's furniture. A shared catalogue would show both.
  await page.waitForFunction("window.__viewerDebug.assetModels().every((body) => body.state === 'gltf')", undefined, {
    timeout: SWAP_TIMEOUT_MS,
  });
  const bodies = await page.evaluate(() => window.__viewerDebug!.assetModels());
  expect(bodies.map((body) => body.id)).toEqual([PROJECT_FIXTURE.placement.sofa]);
});

test('a manifest that fails the schema is refused with `project-invalid`', async ({ page }) => {
  // The dev server serves every source module as a request of its own, and
  // the browser's default resource-timing buffer holds 250 entries: past it the
  // manifest's own entry is dropped and the check below would see nothing.
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10_000));
  await page.goto(`/dev/project.html?project=${encodeURIComponent(INVALID_PROJECT)}`);

  await page.waitForFunction('window.__projectError !== undefined');
  const failure = await page.evaluate(() => window.__projectError!);
  expect(failure.code).toBe('project-invalid');
  expect(failure.path).toBe('scene');

  // Refused OUTRIGHT, not half-read: no first frame, and nothing was fetched
  // out of the folder the bad `scene` pointed at.
  expect(await page.evaluate(() => window.__appReady === true)).toBe(false);
  const fetched = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname)
      .filter((path) => path.startsWith('/tests/fixtures/')),
  );
  expect(fetched).toEqual([INVALID_PROJECT]);
});
