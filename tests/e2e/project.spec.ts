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
import { LIBRARY_PROJECT_FIXTURE, PROJECT_FIXTURE } from '../fixtures/project/fixture-ids.js';
import { serveKtx2LibraryProject, waitForBoot } from './support.js';
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

/* ------------------------------------------------------ library materials --- */

/** The bake dressed in library materials, opened by the same dev page. */
const LIBRARY_PROJECT = '/dev/project.html?project=/tests/fixtures/project-library/project.json';
/** Every texture file of that bake. */
const LIBRARY_TEXTURES = '**/tests/fixtures/project-library/tex/**';
/** The living-room floor (the plank scan) and ceiling (the paint), by their shell mesh names. */
const LIVING_FLOOR = `floor-${LIBRARY_PROJECT_FIXTURE.room.living}`;
const LIVING_CEILING = `ceiling-${LIBRARY_PROJECT_FIXTURE.room.living}`;
/** How long the maps may take to arrive once released. Local static files; generous anyway. */
const MAPS_TIMEOUT_MS = scaled(30_000);

test('a library project is ready flat, before any texture arrives, and then draws its maps', async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested: string[] = [];
  await page.route(LIBRARY_TEXTURES, async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    await held;
    await route.continue();
  });
  await page.goto(LIBRARY_PROJECT);
  await waitForBoot(page, 'window.__appReady === true');

  // Ready, and every library surface in its flat first-frame colour.
  const first = await page.evaluate(
    ([floor, ceiling]) => [window.__viewerDebug!.surfaceMaterial(floor!), window.__viewerDebug!.surfaceMaterial(ceiling!)],
    [LIVING_FLOOR, LIVING_CEILING],
  );
  expect(first).toEqual([
    { colour: '#806040', maps: [], mapSize: null },
    { colour: '#f1eee8', maps: [], mapSize: null },
  ]);

  release();
  await page.waitForFunction((floor) => (window.__viewerDebug!.surfaceMaterial(floor)?.maps.length ?? 0) > 0, LIVING_FLOOR, {
    timeout: MAPS_TIMEOUT_MS,
  });
  const drawn = await page.evaluate((floor) => window.__viewerDebug!.surfaceMaterial(floor), LIVING_FLOOR);
  // The scan's maps, drawn in the running app: albedo as is (white factor), normal, and one ARM image on three slots.
  expect(drawn).toEqual({
    colour: '#ffffff',
    maps: ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap'],
    mapSize: expect.any(Number),
  });
  expect([256, 512]).toContain(drawn!.mapSize);
  // One size per map, each fetched once; the paint has no map at all.
  expect(requested).toHaveLength(3);
  expect(new Set(requested.map((path) => path.replace(/^.*\/(\w+)\.\d+\.webp$/, '$1')))).toEqual(new Set(['albedo', 'normal', 'arm']));
  // WebP only: the KTX2 transcoder is never asked for.
  const transcoder = await page.evaluate(() =>
    performance.getEntriesByType('resource').filter((entry) => entry.name.includes('lazy-jeex-viewer-basis-transcoder-')),
  );
  expect(transcoder).toEqual([]);
  expect(await page.evaluate(() => (window.__projectLog ?? []).map((entry) => entry.code))).toEqual([]);
});

test('a library project shipped as KTX2 draws its maps through the transcoder, fetched once per file', async ({ page, request }) => {
  const served = await serveKtx2LibraryProject(page, request);
  await page.goto(LIBRARY_PROJECT);
  await waitForBoot(page, 'window.__appReady === true');
  await page.waitForFunction((floor) => (window.__viewerDebug!.surfaceMaterial(floor)?.maps.length ?? 0) > 0, LIVING_FLOOR, {
    timeout: MAPS_TIMEOUT_MS,
  });
  const drawn = await page.evaluate((floor) => window.__viewerDebug!.surfaceMaterial(floor), LIVING_FLOOR);
  expect(drawn).toEqual({ colour: '#ffffff', maps: ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap'], mapSize: 256 });
  expect(served.maps()).toHaveLength(3);
  expect(served.transcoder()).toEqual({ js: 1, wasm: 1 });
  expect(await page.evaluate(() => (window.__projectLog ?? []).map((entry) => entry.code))).toEqual([]);
});

test('a texture over the per-file cap is cancelled: its surface keeps its colour, with a warning and no retry', async ({ page }) => {
  const albedo: string[] = [];
  await page.route('**/tests/fixtures/project-library/tex/**/albedo.*', async (route) => {
    albedo.push(route.request().url());
    // Three MiB with no Content-Length a reader could trust: only the count of bytes read can refuse it.
    await route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.alloc(3 * 1024 * 1024) });
  });
  await page.goto(LIBRARY_PROJECT);
  await waitForBoot(page, 'window.__appReady === true');
  await page.waitForFunction(() => (window.__projectLog ?? []).some((entry) => entry.code === 'texture-too-large'), undefined, {
    timeout: MAPS_TIMEOUT_MS,
  });
  await page.waitForFunction((floor) => (window.__viewerDebug!.surfaceMaterial(floor)?.maps.length ?? 0) > 0, LIVING_FLOOR, {
    timeout: MAPS_TIMEOUT_MS,
  });
  const floor = await page.evaluate((name) => window.__viewerDebug!.surfaceMaterial(name), LIVING_FLOOR);
  // The normal and ARM maps arrived; the colour map did not, so the colour is still the scan's average.
  expect(floor!.maps).not.toContain('map');
  expect(floor!.colour).toBe('#806040');
  expect(albedo).toHaveLength(1);
});

test('the document texture budget stops texture work: no request after it, the surfaces stay flat, one warning names the limit', async ({
  page,
  request,
}) => {
  // Nine library materials of four 512 px maps each (36 files) on nine surfaces, every file 2 MiB: the 48 MiB
  // budget is reached at the 24th, and the files still queued then are never asked for.
  const base = '/tests/fixtures/project-library/';
  const manifest = (await (await request.get(`${base}project.json`)).json()) as Record<string, any>;
  const scene = (await (await request.get(`${base}scene.json`)).json()) as Record<string, any>;
  const id = (index: number, kind: number) => `01a1683e-d6ff-7${kind}00-8000-${index.toString(16).padStart(12, '0')}`;
  const roles = ['albedo', 'normal', 'roughness', 'ao'];
  const materials = Array.from({ length: 9 }, (_, index) => ({
    id: id(index, 1),
    name: `Heavy ${index}`,
    apply: ['floor', 'wall', 'ceiling', 'trim', 'facade'],
    library: {
      versionId: id(index, 2),
      kind: 'scan',
      facts: { tileM: [1, 1], grain: 'none', suitability: 'continuous', colourMode: 'natural', averageColour: '#808080', pbr: {} },
      maps: Object.fromEntries(
        roles.map((role) => [
          role,
          {
            colourSpace: role === 'albedo' ? 'srgb' : 'linear',
            ...(role === 'normal' && { convention: 'opengl' }),
            files: { '512': `tex/${id(index, 2)}/${role}.512.webp` },
          },
        ]),
      ),
    },
  }));
  manifest['library'].materials = [...manifest['library'].materials.filter((material: object) => !('library' in material)), ...materials];
  const [living, bedroom] = [LIBRARY_PROJECT_FIXTURE.room.living, LIBRARY_PROJECT_FIXTURE.room.bedroom];
  const surfaces = (offset: number) => ({
    floor: materials[offset]!.id,
    walls: materials[offset + 1]!.id,
    ceiling: materials[offset + 2]!.id,
    trim: materials[offset + 3]!.id,
  });
  scene['finishes'] = { facade: materials[8]!.id, rooms: { [living]: surfaces(0), [bedroom]: surfaces(4) } };
  // By pathname: a glob would also match the page's own `?project=` query.
  await page.route(
    (url) => url.pathname === `${base}project.json`,
    (route) => route.fulfill({ json: manifest }),
  );
  await page.route(
    (url) => url.pathname === `${base}scene.json`,
    (route) => route.fulfill({ json: scene }),
  );
  const requested: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith(`${base}tex/`),
    async (route) => {
      requested.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.alloc(2 * 1024 * 1024) });
    },
  );

  await page.goto(LIBRARY_PROJECT);
  await waitForBoot(page, 'window.__appReady === true');
  await page.waitForFunction(() => (window.__projectLog ?? []).some((entry) => entry.code === 'texture-budget'), undefined, {
    timeout: MAPS_TIMEOUT_MS,
  });
  // Let anything still in flight settle, then count.
  await page.waitForTimeout(500);
  expect(requested.length).toBeGreaterThanOrEqual(24);
  // At most the jobs already running when the budget was reached (four at a time) came after it.
  expect(requested.length).toBeLessThanOrEqual(28);
  const log = await page.evaluate(() => window.__projectLog ?? []);
  expect(log.filter((entry) => entry.code === 'texture-budget')).toHaveLength(1);
  expect(log.find((entry) => entry.code === 'texture-budget')!.message).toContain('MAX_PROJECT_TEXTURE_BYTES');
  expect(await page.evaluate((floor) => window.__viewerDebug!.surfaceMaterial(floor)?.colour, LIVING_FLOOR)).toBe('#808080');
});
