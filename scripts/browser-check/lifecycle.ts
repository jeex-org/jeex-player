/**
 * The viewer's LIFECYCLE in a real page: what happens when the browser takes
 * the WebGL context away and gives it back.
 *
 * These are the two things a unit test cannot reach. `WEBGL_lose_context` is a
 * real driver reset as far as the renderer is concerned, and the second
 * `getContext('webgl2')` on the canvas hands back the very context three.js is
 * drawing with — the platform returns the existing context for a context id it
 * already created, so no debug hook has to expose the renderer.
 *
 * Leaves the page on the plain demo URL with the viewer running.
 */

import type { CheckContext } from './context.js';
import { nameSelector } from './page-code.js';
import { runSteps, waitFor } from './step.js';

/** How many mount → dispose cycles the leak check runs in one container. */
const MOUNT_CYCLES = 20;

/**
 * How long a restored context may take to reach a drawn frame, ms.
 *
 * Longer than the usual predicate budget: the restore re-mounts the whole
 * document — geometry, materials, textures, the camera stack — on a GPU that
 * has just come back.
 */
const RESTORE_TIMEOUT_MS = 20_000;

/**
 * Mount → dispose, twenty times over in ONE container.
 *
 * A SPA route change and a React StrictMode double-effect both do exactly this,
 * and it is the case a unit test cannot reach: the container must hold at most
 * one viewer at a time and none at the end, the document must not accumulate
 * canvases (a page is capped at about sixteen WebGL contexts), and the one
 * adopted component stylesheet must survive — the two viewers this page mounts
 * are still using it.
 *
 * Leaves the browser on `dev/embed-two.html`, which is where `checkEmbedTwo`
 * also runs; this area is ordered right after it.
 */
export async function checkMountCycles(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, url } = ctx;
  let before = 0;
  let report = { maxChildren: -1, childrenAfter: -1, canvases: -1, sheets: -1 };
  await runSteps([
    {
      name: 'open the two-viewer page',
      run: async () => {
        await run(['open', new URL('dev/embed-two.html', url).href]);
        await waitFor(ctx, 'window.__embedTwoReady === true', 'both viewers on the page to be ready');
        before = await evalValue<number>("document.querySelectorAll('canvas').length");
      },
    },
    {
      name: `mount → dispose × ${MOUNT_CYCLES} in one container`,
      run: async () => {
        await run(['eval', `window.__jeexCycle = null; window.jeexPair.cycle(${MOUNT_CYCLES}).then((r) => (window.__jeexCycle = r))`]);
        await waitFor(ctx, 'window.__jeexCycle !== null', `${MOUNT_CYCLES} mount/dispose cycles to finish`, RESTORE_TIMEOUT_MS);
        report = await evalValue('JSON.stringify(window.__jeexCycle)');
      },
    },
    {
      name: 'the container and the document are as they were',
      run: () => {
        assert(report.maxChildren <= 1, `a container holds at most one viewer at a time, saw ${report.maxChildren}`);
        assert(report.childrenAfter === 0, `dispose must leave the container empty, saw ${report.childrenAfter} child(ren)`);
        assert(
          report.canvases === before,
          `canvases must not grow over ${MOUNT_CYCLES} cycles: ${before} before, ${report.canvases} after`,
        );
        assert(report.sheets === 1, `the component sheet stays adopted while a viewer still uses it, saw ${report.sheets}`);
        summary.push(
          `mount → dispose × ${MOUNT_CYCLES}: max ${report.maxChildren} child, 0 after, canvases ${before} → ${report.canvases}, 1 sheet`,
        );
        return Promise.resolve();
      },
    },
  ]);
}

/**
 * `ready` after `loadScene` means a FRAME of the new scene was drawn.
 *
 * `init()` waits for one, and so does `loadScene`: this guards against a
 * `ready` emitted in the same task as the mount, where a host that swapped
 * scenes and screenshotted on `ready` would get the previous picture. A frame counter running
 * alongside is the only way to tell the two apart from outside.
 *
 * Runs on `?debug=1`, which is what makes `exportScene()` available — the
 * check needs a valid document and the demo's own is the honest one to reuse.
 * Leaves the page on the debug URL.
 */
export async function checkLoadSceneReady(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, withQuery } = ctx;
  await run(['open', withQuery('debug=1')]);
  await waitFor(ctx, 'window.__appReady === true', 'the debug page to be ready');
  await run([
    'eval',
    `(() => {
      window.__jeexFrames = 0;
      const tick = () => { window.__jeexFrames += 1; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      window.__jeexReadyAt = null;
      window.jeexViewer.on('ready', (info) => { if (window.__jeexReadyAt === null) window.__jeexReadyAt = { frame: window.__jeexFrames, sceneId: info.sceneId }; });
      const document_ = window.__viewerDebug.exportScene();
      window.__jeexCalledAt = window.__jeexFrames;
      window.__jeexSwapped = false;
      window.jeexViewer.loadScene({ document: document_ }).then(() => { window.__jeexSwapped = true; });
      return true;
    })()`,
  ]);
  await waitFor(ctx, 'window.__jeexSwapped === true', 'loadScene to resolve');
  const swap = await evalValue<{ calledAt: number; ready: { frame: number; sceneId: string } | null }>(
    'JSON.stringify({ calledAt: window.__jeexCalledAt, ready: window.__jeexReadyAt })',
  );
  assert(swap.ready !== null, 'loadScene must emit a ready event for the new scene');
  const readyFrame = swap.ready?.frame ?? -1;
  assert(
    readyFrame > swap.calledAt,
    `ready must arrive after a frame of the new scene | called at ${swap.calledAt}, ready at ${readyFrame}`,
  );
  summary.push(`loadScene ready: frame ${swap.calledAt} -> ${readyFrame} (scene ${swap.ready?.sceneId ?? 'none'})`);
}

/**
 * The viewer mounts on a page that enforces Trusted Types.
 *
 * `dev/embed-tt.html` carries `require-trusted-types-for 'script'` in a CSP
 * meta tag. Under it, ANY string assigned to `innerHTML` — or to any other DOM
 * XSS sink — throws a `TypeError`, so a component that builds its shell from an
 * HTML string cannot mount at all. Two viewers coming up is the proof that none
 * does; the page's console is checked for the `TypeError` a regression would
 * raise.
 *
 * `style-src 'self'` on the same page proves the other half: the component
 * stylesheet arrives as a constructed sheet, so the host needs no
 * `'unsafe-inline'` for it.
 *
 * Leaves the browser on `dev/embed-tt.html`.
 */
export async function checkTrustedTypes(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, url } = ctx;
  await run(['open', new URL('dev/embed-tt.html', url).href]);
  await waitFor(ctx, 'window.__embedTwoReady === true', 'both viewers to mount under Trusted Types');
  const mounted = await evalValue<{ enforced: boolean; roots: number; canvases: number; sheets: number }>(`(() => {
    // Proof that the policy is ENFORCED, not merely that the API exists:
    // window.trustedTypes is there in Chromium whatever the CSP says, so the
    // check is an actual assignment to a sink, which must throw here.
    let enforced = false;
    try {
      document.createElement('div').innerHTML = '<b>x</b>';
    } catch (error) {
      enforced = error instanceof TypeError;
    }
    return JSON.stringify({
      enforced,
      roots: document.querySelectorAll('.jeex-viewer').length,
      canvases: document.querySelectorAll('${nameSelector('scene-canvas')}').length,
      sheets: document.adoptedStyleSheets.length,
    });
  })()`);
  assert(mounted.enforced, 'the Trusted Types page must actually block a string assigned to innerHTML');
  assert(mounted.roots === 2, `both viewers must mount under Trusted Types, saw ${mounted.roots}`);
  assert(mounted.canvases === 2, `both canvases must be built under Trusted Types, saw ${mounted.canvases}`);
  assert(mounted.sheets === 1, `the constructed sheet must be adopted under style-src 'self', saw ${mounted.sheets}`);
  // The page's own console: a shell built from a string would have thrown a
  // `TypeError` here long before the two viewers came up.
  const { output } = await run(['console', '--json']);
  assert(!output.includes('TypeError'), `no TypeError may reach the page under Trusted Types | ${output.slice(0, 400)}`);
  summary.push('Trusted Types: 2 viewers mounted under require-trusted-types-for, 1 adopted sheet, no TypeError');
}

/** Lose the GL context, expect the card and the `context-lost` error, restore it, expect the scene back. */
export async function checkContextLoss(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, url } = ctx;
  await run(['open', url]);
  await waitFor(ctx, 'window.__appReady === true', 'the demo page to be ready');

  // The host's own subscription: `context-lost` has to reach a page that only
  // ever listens to the public event, not just the card.
  await run([
    'eval',
    `(() => {
      window.__jeexErrors = [];
      window.jeexViewer.on('error', (error) => window.__jeexErrors.push(error.code));
      const canvas = document.querySelector('${nameSelector('scene-canvas')}');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      window.__jeexLose = gl.getExtension('WEBGL_lose_context');
      return Boolean(window.__jeexLose);
    })()`,
  ]);
  const hasExtension = await evalValue<boolean>('Boolean(window.__jeexLose)');
  assert(hasExtension, 'the browser must expose WEBGL_lose_context for the context-loss check');

  await run(['eval', 'window.__jeexLose.loseContext()']);
  await waitFor(ctx, "window.__jeexErrors.includes('context-lost')", 'the context-lost event to reach the host');
  const lost = await evalValue<{ card: boolean; ui: boolean }>(`(() => {
    const card = document.querySelector('${nameSelector('error-state')}');
    const ui = document.querySelector('${nameSelector('viewer-ui')}');
    return JSON.stringify({ card: !card.classList.contains('is-hidden'), ui: !ui.classList.contains('is-hidden') });
  })()`);
  assert(lost.card, 'a lost context must raise the error card');
  assert(!lost.ui, 'a lost context must take the running chrome off screen');

  await run(['eval', 'window.__jeexLose.restoreContext()']);
  // A predicate, not a duration: the card comes down when the re-mounted
  // document is on screen, and how long that takes is the GPU's business.
  await waitFor(
    ctx,
    `document.querySelector('${nameSelector('error-state')}').classList.contains('is-hidden') && window.__viewerDebug.rooms().length > 0`,
    'the restored context to rebuild the scene',
    RESTORE_TIMEOUT_MS,
  );
  const back = await evalValue<{ ui: boolean; canvases: number; rooms: number }>(`(() => {
    const ui = document.querySelector('${nameSelector('viewer-ui')}');
    return JSON.stringify({
      ui: !ui.classList.contains('is-hidden'),
      canvases: document.querySelectorAll('${nameSelector('scene-canvas')}').length,
      rooms: window.__viewerDebug.rooms().length,
    });
  })()`);
  assert(back.ui, 'a restored context must bring the chrome back');
  assert(back.canvases === 1, `the restore must reuse the one canvas, saw ${back.canvases}`);
  assert(back.rooms > 0, 'the restored viewer must rebuild the committed document');
  summary.push(`context loss: error card + context-lost event, restored on the same canvas (${back.rooms} rooms rebuilt)`);
}
