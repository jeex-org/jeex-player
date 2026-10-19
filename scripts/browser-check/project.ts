/**
 * A BAKED PROJECT opened by url: `dev/project.html` points the viewer at
 * `tests/fixtures/project/project.json`, and everything on screen comes out of
 * that folder — the object bank, the GLB body, the two generator finishes.
 *
 * What only a real page can show, and what this area therefore asserts:
 *
 * - `handle.project()` answers with the manifest the viewer VALIDATED, so a
 *   host's own chrome can read `title`, `media` and `rights` off it;
 * - the first frame carries the `dims` stand-in (`degraded: 'pending-model'`)
 *   and nothing else, because a project object has no builder and `ready`
 *   means "drawn" with no network in it;
 * - the GLB then REPLACES it, in the same group, drawing triangles of its own;
 * - not one request leaves the project folder.
 *
 * Leaves the browser on `dev/project.html`; the runner reopens the demo before
 * its own screenshot.
 */

import { PROJECT_FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';
import type { CheckContext } from './context.js';
import { runSteps, waitFor } from './step.js';

/** How long the fixture GLB may take to arrive and swap in, ms. Local static file, generous anyway. */
const SWAP_TIMEOUT_MS = 15_000;

/** The folder the bake is served from; every request the page makes must start with it. */
const PROJECT_PATH = '/tests/fixtures/project/';

/** One furniture body per `assetModels()` entry, as the debug surface reports it. */
type AssetModel = { id: string; state: string; degraded?: string; triangles: number };

/** Page code: `assetModels()` as JSON, or `[]` before a root exists. */
const MODELS = 'JSON.stringify(window.__viewerDebug ? window.__viewerDebug.assetModels() : [])';

export async function checkProjectLoad(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, url } = ctx;
  let first: AssetModel[] = [];

  await runSteps([
    {
      name: 'open the project page and read the first frame',
      run: async () => {
        await run(['open', new URL('dev/project.html', url).href]);
        await waitFor(ctx, 'window.__appReady === true', 'the project to mount');
        // The PAGE sampled the first frame, not this poll: over a warm cache
        // the GLB is in before an automation's first round trip lands, and a
        // check that polled from out here would read the swapped body and
        // report a stand-in that never existed (`dev/project.ts`).
        await waitFor(ctx, 'window.__projectFirstFrame.length > 0', 'the first frame with furniture in it');
        first = await evalValue<AssetModel[]>('JSON.stringify(window.__projectFirstFrame)');
        assert(first.length === 1, `the fixture bake places one object, saw ${first.length}`);
        const stand = first[0];
        assert(stand?.degraded === 'pending-model', `the first frame is a dims stand-in | ${JSON.stringify(stand)}`);
        assert((stand?.triangles ?? 0) > 0, 'the stand-in is drawn, not an empty group');
      },
    },
    {
      name: 'the manifest reaches the host through handle.project()',
      run: async () => {
        // The page prints what `handle.project()` answered; reading the LABEL
        // rather than calling the handle again is what proves a host outside
        // the viewer can get at it.
        const label = await evalValue<string>("JSON.stringify(document.querySelector('#project-label').textContent)");
        assert(label.includes('Fixture project'), `the page names the bake it loaded | "${label}"`);
        assert(label.includes(`bake ${PROJECT_FIXTURE.bakeId}`), `the bake id is on the handle | "${label}"`);
        assert(label.includes(PROJECT_PATH), `baseUrl is the manifest folder | "${label}"`);

        const scene = await evalValue<{ library: string | null; id: string }>(`(() => {
          const doc = window.__viewerDebug.exportScene ? window.__viewerDebug.exportScene() : null;
          return JSON.stringify({ library: doc ? (doc.assetLibrary ?? null) : null, id: doc ? doc.id : '' });
        })()`);
        assert(scene.library === PROJECT_FIXTURE.projectId, `the document came from the bake | ${JSON.stringify(scene)}`);
      },
    },
    {
      name: 'the GLB replaces the stand-in',
      run: async () => {
        await waitFor(
          ctx,
          "window.__viewerDebug.assetModels().every((body) => body.state === 'gltf')",
          'every body to be swapped for its GLB',
          SWAP_TIMEOUT_MS,
        );
        const after = await evalValue<AssetModel[]>(MODELS);
        const body = after[0];
        assert(body?.degraded === undefined, `a swapped body is no longer a stand-in | ${JSON.stringify(body)}`);
        assert((body?.triangles ?? 0) > 0, `the GLB draws triangles | ${JSON.stringify(body)}`);
        summary.push(
          `project: ${first[0]?.triangles ?? 0}-triangle stand-in → ${body?.triangles ?? 0}-triangle GLB, ` +
            `library = the project id, no onLog entries`,
        );
      },
    },
    {
      name: 'nothing was fetched from outside the project folder',
      run: async () => {
        // The page records every `onLog` entry; `asset-defect` and
        // `project-budget` are the two this area would otherwise miss
        // entirely, because neither is a failure.
        const log = await evalValue<string[]>('JSON.stringify((window.__projectLog || []).map((e) => e.code))');
        assert(log.length === 0, `a clean bake logs nothing | ${JSON.stringify(log)}`);
        const outside = await evalValue<string[]>(`(() => {
          const entries = performance.getEntriesByType('resource').map((entry) => entry.name);
          const fixture = new URL('${PROJECT_PATH}', location.origin).href;
          return JSON.stringify(entries.filter((name) => name.includes('/tests/fixtures/') && !name.startsWith(fixture)));
        })()`);
        assert(outside.length === 0, `every fixture request stayed inside the bake | ${JSON.stringify(outside)}`);
      },
    },
  ]);
}
