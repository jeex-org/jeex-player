/**
 * The three EMBED FORMS, each on the dev page built to expose it:
 * `dev/embed-two.html` (two `mountViewer` instances),
 * `dev/embed-element.html` (`<jeex-viewer>` in a shadow root) and
 * `dev/embed-iframe.html` (the host helper over `postMessage`).
 *
 * ---------------------------------------------------------------------------
 *
 * `checkEmbedTwo` — the component claim, checked on the one page that can tell
 * its three halves apart: `dev/embed-two.html`, which mounts two viewers side
 * by side.
 *
 * - INPUT is per instance: keys are listened for on each shell root, which a
 *   `pointerdown` on its canvas focuses.
 * - LOCALE is per instance: the second mounts `ru` and answers in Russian
 *   while the first answers in English.
 * - The page GLOBALS have one owner: the first mount claims them, disposing it
 *   takes them down, and the second keeps rendering because they were never
 *   its.
 *
 * Everything is read through the OWNER's `__viewerDebug` (the first viewer) or
 * through DOM state the viewers write themselves — the second viewer has no
 * debug surface at all, which is the point.
 *
 * The area runs LAST and leaves the browser on this page; the runner reopens
 * the demo before its screenshot.
 */

import type { CheckContext } from './context.js';
import { nameSelector } from './page-code.js';

/** How long an event raised by an attribute change is waited for, ms. */
const EVENT_WAIT_MS = 8000;

/** How long a message with the wrong origin is watched for a reply, ms. */
const NO_REPLY_MS = 300;

/** `scene.name` of the second document `dev/embed-element.ts` serves. */
const SWAPPED_SCENE_NAME = 'Flat B · swapped through src';

/** Milliseconds of held `w`; a walker covers well over a centimetre in that. */
const WALK_MS = 700;
/** Movement below this is frame jitter, not a walk. */
const MOVED_M = 0.05;

/** Page code: dispatches a held-then-released `w` at one element. */
function pressW(target: string): string {
  return `(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const at = ${target};
    at.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    await pause(${WALK_MS});
    at.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
    await pause(80);
    const c = window.__viewerDebug ? window.__viewerDebug.camera() : null;
    return JSON.stringify(c);
  })()`;
}

const ROOTS = "[...document.querySelectorAll('.jeex-viewer')]";

type Camera = { x: number; y: number; z: number };

function moved(a: Camera | null, b: Camera | null): number {
  if (!a || !b) return Number.NaN;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export async function checkEmbedTwo(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, url, shotDir, cameraAt } = ctx;

  await run(['open', new URL('dev/embed-two.html', url).href]);
  await run(['wait', '--fn', 'window.__embedTwoReady === true']);

  // ---- Two shells, one owner of the page globals ----
  const mounted = await evalValue<{ roots: number; canvases: number; ids: number; debug: boolean; ready: boolean }>(`(() => {
    return JSON.stringify({
      roots: ${ROOTS}.length,
      canvases: document.querySelectorAll('${nameSelector('scene-canvas')}').length,
      ids: document.querySelectorAll('.jeex-viewer [id]').length,
      debug: Boolean(window.__viewerDebug),
      ready: window.__appReady === true,
    });
  })()`);
  assert(mounted.roots === 2, `the page mounts two viewers, saw ${mounted.roots}`);
  assert(mounted.canvases === 2, `each viewer builds its own canvas, saw ${mounted.canvases}`);
  assert(mounted.ids === 0, `two shells on one page carry no id at all, saw ${mounted.ids}`);
  assert(mounted.debug, 'the first viewer claims window.__viewerDebug');
  assert(mounted.ready, 'the owner reports __appReady');
  summary.push(`embed-two: ${mounted.roots} viewers, ${mounted.canvases} canvases, 0 ids, one globals owner`);

  // ---- Locale is per instance ----
  // The mode buttons' descriptions are translated when the fragment is built;
  // the visible mode name stays `Walk` in both.
  const locales = await evalValue<{ first: string; second: string }>(`(() => {
    const label = (root) => root.querySelector('[data-mode="walk"]').title;
    const roots = ${ROOTS};
    return JSON.stringify({ first: label(roots[0]), second: label(roots[1]) });
  })()`);
  assert(locales.first === 'Walk mode', `the first viewer stays English | "${locales.first}"`);
  assert(locales.second === 'Режим прогулки', `the second viewer speaks Russian | "${locales.second}"`);
  summary.push(`embed-two locale: "${locales.first}" and "${locales.second}" at once`);

  // ---- A press on a canvas gives THAT viewer the keyboard ----
  const focused = await evalValue<{ second: boolean; first: boolean }>(`(() => {
    const roots = ${ROOTS};
    const press = (root) => {
      const canvas = root.querySelector('${nameSelector('scene-canvas')}');
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true, pointerId: 771 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10, bubbles: true, pointerId: 771 }));
      return document.activeElement === root;
    };
    return JSON.stringify({ second: press(roots[1]), first: press(roots[0]) });
  })()`);
  assert(focused.second, 'a press on the second canvas focuses the second root');
  assert(focused.first, 'a press on the first canvas focuses the first root');

  // ---- `w` walks the viewer it was sent to, and only that one ----
  // Both are in walk mode, so a `window`-level key listener would move both:
  // this guards against one.
  // Only the FIRST viewer has a debug surface, so its camera is the probe: it
  // must move for its own key and stand still for everyone else's.
  const start = await cameraAt();
  const afterSecond = await evalValue<Camera | null>(pressW(`${ROOTS}[1]`));
  const strayed = moved(start, afterSecond);
  assert(strayed < MOVED_M, `a key sent to the second viewer must not move the first | moved ${strayed.toFixed(3)} m`);

  const afterHostInput = await evalValue<Camera | null>(pressW("document.getElementById('host-input')"));
  const typed = moved(start, afterHostInput);
  assert(typed < MOVED_M, `typing in the host page's own input must not walk a camera | moved ${typed.toFixed(3)} m`);

  const afterFirst = await evalValue<Camera | null>(pressW(`${ROOTS}[0]`));
  const walkedFirst = moved(start, afterFirst);
  assert(walkedFirst > MOVED_M, `a key sent to the first viewer must walk it | moved ${walkedFirst.toFixed(3)} m`);
  summary.push(
    `embed-two input: own key ${walkedFirst.toFixed(2)} m, sibling's key ${strayed.toFixed(2)} m, host input ${typed.toFixed(2)} m`,
  );

  await run(['screenshot', `${shotDir}/A-two.png`]);

  // ---- Disposing the owner takes its markup and the globals, and no more ----
  // `dispose()` leaves the host DOM as it found it: the disposed
  // viewer's shell goes, its container is left empty, and the SECOND viewer —
  // its markup, its canvas and the one adopted stylesheet they shared — is
  // untouched.
  const disposed = await evalValue<{
    debug: boolean;
    ready: boolean;
    readyAt: boolean;
    roots: number;
    canvases: number;
    stageA: number;
    sheets: number;
  }>(`(() => {
    window.jeexPair.disposeFirst();
    return JSON.stringify({
      debug: Boolean(window.__viewerDebug),
      ready: window.__appReady === true,
      readyAt: window.__viewerReadyAt !== undefined,
      roots: ${ROOTS}.length,
      canvases: document.querySelectorAll('${nameSelector('scene-canvas')}').length,
      stageA: document.getElementById('stage-a').children.length,
      sheets: document.adoptedStyleSheets.length,
    });
  })()`);
  assert(!disposed.debug, 'disposing the owner removes __viewerDebug');
  assert(!disposed.ready, 'disposing the owner clears __appReady');
  assert(!disposed.readyAt, 'disposing the owner removes __viewerReadyAt');
  assert(disposed.roots === 1, `dispose removes the shell it built, saw ${disposed.roots} root(s)`);
  assert(disposed.stageA === 0, `the disposed viewer's container is left empty, saw ${disposed.stageA} child(ren)`);
  assert(disposed.canvases === 1, 'the second viewer keeps its canvas and the first one takes its own away');
  assert(disposed.sheets === 1, `the sheet the second viewer still uses stays adopted, saw ${disposed.sheets}`);

  // The second viewer is still RENDERING, not merely still in the DOM: its
  // mini-map card is written from a frame hook (`viewer-api.syncMinimap`), so
  // a mode switch that reaches the card proves the frame loop is alive.
  const alive = await evalValue<{ before: string; after: string }>(`(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const second = ${ROOTS}[0];
    const card = () => second.querySelector('${nameSelector('minimap')}').dataset.visible;
    const before = card();
    second.querySelector('[data-mode="orbit"]').click();
    await pause(400);
    return JSON.stringify({ before, after: card() });
  })()`);
  assert(alive.before === 'true', `the second viewer shows its map in walk | ${alive.before}`);
  assert(
    alive.after === 'false',
    `the second viewer's frame loop must survive the first one's dispose | map ${alive.before} -> ${alive.after}`,
  );
  summary.push('embed-two dispose: shell, canvas and globals gone with the owner; the second viewer still renders on the shared sheet');
}

/**
 * `<jeex-viewer>` on `dev/embed-element.html`: the same viewer reached through
 * a tag, an open shadow root and `CustomEvent`s.
 *
 * Four claims, none of which the ES-module form can make:
 *
 * - the events are COMPOSED — the page listens on `document` and still hears
 *   `jeex-ready`, which a shadow root would otherwise swallow;
 * - the viewer is really INSIDE the shadow root, and nothing of it is in the
 *   host's own tree;
 * - `view` and `src` stay live after the mount — one switches the mode, the
 *   other loads a scene and raises `jeex-scene` — and a frozen attribute
 *   warns instead;
 * - removing the element disposes the viewer and, since it is this page's only
 *   one, takes the page globals with it.
 *
 * Every mutation is idempotent (`agent-browser` retries a failed `eval`):
 * setting an attribute to the value it already has still fires the reaction,
 * and the removal step reads the element defensively.
 *
 * Runs after `checkEmbedTwo` and leaves the browser on this page; the runner
 * reopens the demo before its screenshot.
 */
export async function checkEmbedElement(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, url, shotDir } = ctx;

  await run(['open', new URL('dev/embed-element.html', url).href]);
  await run(['wait', '--fn', 'window.jeexElement && window.jeexElement.events.includes("jeex-ready")']);

  // ---- The shadow root holds the viewer, and the events get out of it ----
  const mounted = await evalValue<{
    shadow: boolean;
    inShadow: boolean;
    inLight: number;
    events: string[];
    hasHandle: boolean;
    hasTour: boolean;
  }>(`(() => {
    const el = document.getElementById('viewer');
    return JSON.stringify({
      shadow: Boolean(el.shadowRoot),
      inShadow: Boolean(el.shadowRoot && el.shadowRoot.querySelector('${nameSelector('viewer')}')),
      inLight: document.querySelectorAll('${nameSelector('viewer')}').length,
      events: window.jeexElement.events,
      hasHandle: Boolean(el.viewer),
      hasTour: Boolean(el.tour),
    });
  })()`);
  assert(mounted.shadow, 'the element attaches an open shadow root by default');
  assert(mounted.inShadow, 'the viewer shell is built inside that shadow root');
  assert(mounted.inLight === 0, `nothing of the viewer is in the host's own tree, saw ${mounted.inLight}`);
  assert(mounted.events.includes('jeex-ready'), `jeex-ready must reach a document listener | ${JSON.stringify(mounted.events)}`);
  assert(mounted.hasHandle && mounted.hasTour, 'el.viewer and el.tour are the handle and its tour');
  summary.push(`<jeex-viewer>: shell in the shadow root, 0 in light DOM, ${mounted.events.length} composed events heard on document`);

  await run(['screenshot', `${shotDir}/E-element.png`]);

  // ---- `view` is live after the mount ----
  const walked = await evalValue<{ mode: string; events: string[] }>(`(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const el = document.getElementById('viewer');
    el.setAttribute('view', 'walk');
    await pause(500);
    return JSON.stringify({ mode: el.viewer.getMode(), events: window.jeexElement.events });
  })()`);
  assert(walked.mode === 'walk', `a new view attribute switches the mode | got ${walked.mode}`);
  assert(walked.events.includes('jeex-mode'), `the mode change is reported as jeex-mode | ${JSON.stringify(walked.events)}`);

  // ---- a frozen attribute says so instead of pretending ----
  //
  // Read through the element's own `onLog` sink rather than by patching
  // `console.warn`: the viewer writes to a SINK now (`shared/logger.ts`), and
  // attribute changes are collected and flushed in one microtask, so a probe
  // that restored the console synchronously would look before the warning.
  const frozen = await evalValue<{ code: string | null; attribute: string | null }>(`(async () => {
    const el = document.getElementById('viewer');
    const entries = [];
    const previous = el.onLog;
    el.onLog = (entry) => entries.push(entry);
    try {
      el.setAttribute('minimap', '0');
      await Promise.resolve();
    } finally {
      el.onLog = previous;
    }
    const entry = entries[0] ?? null;
    return JSON.stringify({ code: entry?.code ?? null, attribute: entry?.detail?.attribute ?? null });
  })()`);
  assert(frozen.code === 'attribute-read-once', `changing a mount-time attribute after the mount warns | code ${frozen.code}`);
  assert(frozen.attribute === 'minimap', `and the warning names the attribute | got ${frozen.attribute}`);
  summary.push(`<jeex-viewer> live attributes: view -> ${walked.mode}, minimap -> one warning and no change`);

  // ---- `src` loads another scene, and says so ----
  const swapped = await evalValue<{ scene: boolean; name: string | null }>(`(async () => {
    const el = document.getElementById('viewer');
    const scene = new Promise((resolve) => {
      document.addEventListener('jeex-scene', () => resolve(true), { once: true });
      setTimeout(() => resolve(false), ${EVENT_WAIT_MS});
    });
    el.setAttribute('src', window.jeexElement.secondScene);
    const heard = await scene;
    const brand = el.shadowRoot.querySelector('${nameSelector('brand-context')}');
    return JSON.stringify({ scene: heard, name: brand ? brand.textContent.trim() : null });
  })()`);
  assert(swapped.scene, 'a new src attribute loads a scene and raises jeex-scene');
  assert(swapped.name === SWAPPED_SCENE_NAME, `the second document is really on screen | brand context "${String(swapped.name)}"`);
  summary.push(`<jeex-viewer> src swap: jeex-scene heard, brand context now "${String(swapped.name)}"`);

  // ---- removing the element disposes the viewer it owned ----
  const removed = await evalValue<{ present: boolean; debug: boolean; ready: boolean }>(`(() => {
    const el = document.getElementById('viewer');
    if (el) el.remove();
    return JSON.stringify({
      present: Boolean(document.getElementById('viewer')),
      debug: Boolean(window.__viewerDebug),
      ready: window.__appReady === true,
    });
  })()`);
  assert(!removed.present, 'the element is out of the DOM');
  assert(!removed.debug, 'disconnecting the element disposes the viewer that owned __viewerDebug');
  assert(!removed.ready, 'disconnecting the element clears __appReady');
  summary.push('<jeex-viewer> dispose: the element left the DOM and took its viewer and the page globals with it');
}

/**
 * The iframe form on `dev/embed-iframe.html`: a host page that holds
 * `embed/host.ts` and nothing else, driving `embed.html` over `postMessage`.
 *
 * The four claims, and each is one a fake window cannot make:
 *
 * - `await embed.ready` resolves across a real document boundary, with the
 *   commands issued before it queued rather than lost;
 * - `progress()` is a real round trip: a `TourProgress` built in the frame
 *   arrives in the host page;
 * - the frame answers ONLY the origin it was given. A message posted at
 *   another target origin never reaches it, and one that does reach it with a
 *   foreign `channel` is dropped — neither draws a reply;
 * - `dispose()` tells the frame and then takes the iframe out of the page.
 *
 * Every step is idempotent: the probes only read, and a re-run of the dispose
 * step finds the frame already gone and says so.
 *
 * Runs after `checkEmbedElement` and leaves the browser on this page; the
 * runner reopens the demo before its screenshot.
 */
export async function checkEmbedFrame(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, url, shotDir } = ctx;

  await run(['open', new URL('dev/embed-iframe.html', url).href]);
  await run(['wait', '--fn', 'window.jeexEmbed && window.jeexEmbed.ready === true']);

  // ---- The frame is built the way the host asked, and it booted ----
  const built = await evalValue<{
    frames: number;
    host: string | null;
    viewerId: string | null;
    view: string | null;
    allow: string | null;
    sandbox: string | null;
    events: string[];
  }>(`(() => {
    const frame = document.querySelector('#stage iframe');
    const query = new URL(frame.src).searchParams;
    return JSON.stringify({
      frames: document.querySelectorAll('#stage iframe').length,
      host: query.get('host'),
      viewerId: query.get('viewerId'),
      view: query.get('view'),
      allow: frame.getAttribute('allow'),
      sandbox: frame.getAttribute('sandbox'),
      events: window.jeexEmbed.events,
    });
  })()`);
  assert(built.frames === 1, `the helper builds one frame, saw ${built.frames}`);
  assert(built.host === new URL(url).origin, `the frame is told which origin to answer | ${String(built.host)}`);
  assert(built.viewerId === 'dev-frame', `the viewer id travels in the query | ${String(built.viewerId)}`);
  assert(built.view === 'tour', `the viewer options travel in their query spelling | view=${String(built.view)}`);
  assert(built.allow === 'fullscreen', `the frame is allowed fullscreen | ${String(built.allow)}`);
  assert(built.sandbox === 'allow-scripts allow-same-origin', `the frame is sandboxed | ${String(built.sandbox)}`);
  assert(built.events.includes('ready'), `the host heard the frame's ready event | ${JSON.stringify(built.events)}`);
  summary.push(`embed iframe: one frame, host=${String(built.host)}, viewerId=${String(built.viewerId)}, ready heard`);

  await run(['screenshot', `${shotDir}/E-iframe.png`]);

  // ---- A command round trip carries a value back ----
  const progress = await evalValue<{ progress: { state: string; fraction: number; length: number } | null; mode: string }>(`(async () => {
    const embed = window.jeexEmbed.embed;
    const progress = await embed.progress();
    const mode = await embed.getMode();
    return JSON.stringify({ progress, mode });
  })()`);
  assert(progress.progress !== null, "progress() answers with the frame's own TourProgress, not null");
  assert(
    typeof progress.progress!.fraction === 'number' && progress.progress!.length > 0,
    `the TourProgress is a real one | ${JSON.stringify(progress.progress)}`,
  );
  assert(progress.mode === 'tour', `getMode() round-trips the frame's mode | ${progress.mode}`);
  summary.push(`embed iframe round trip: progress ${JSON.stringify(progress.progress)}, mode ${progress.mode}`);

  // ---- The frame answers nobody else ----
  // Two ways a message fails to become a reply, checked together: one never
  // arrives (its TARGET origin is not the frame's, so the browser drops it),
  // and one arrives on the right origin carrying a foreign channel. Neither
  // may draw an answer, and a well-formed one right after them must — so the
  // step cannot pass by the transport being broken.
  const ignored = await evalValue<{ strayReplies: number; goodReply: boolean }>(`(async () => {
    const frame = document.querySelector('#stage iframe');
    const shape = (over) => Object.assign({
      channel: 'jeex-embed', version: 1, viewerId: 'dev-frame',
      kind: 'command', id: 'stray', method: 'getMode',
    }, over);
    let strayReplies = 0;
    const watch = (event) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (data && data.kind === 'reply' && data.id === 'stray') strayReplies += 1;
    };
    window.addEventListener('message', watch);
    // (1) right shape, wrong TARGET origin: the browser never delivers it.
    frame.contentWindow.postMessage(shape({}), 'https://not-this-frame.example');
    // (2) right origin, foreign channel: the bridge drops it.
    frame.contentWindow.postMessage(shape({ channel: 'some-other-widget' }), window.location.origin);
    await new Promise((resolve) => setTimeout(resolve, ${NO_REPLY_MS}));
    window.removeEventListener('message', watch);
    const goodReply = await window.jeexEmbed.embed.getMode();
    return JSON.stringify({ strayReplies, goodReply: goodReply === 'tour' });
  })()`);
  assert(ignored.strayReplies === 0, `a message the frame was not addressed by draws no reply | saw ${ignored.strayReplies}`);
  assert(ignored.goodReply, 'the frame still answers a well-formed command, so the silence was a refusal');
  summary.push(`embed iframe origin: 0 replies to a stray message in ${NO_REPLY_MS} ms, a real command still answered`);

  // ---- dispose tells the frame, then removes it ----
  const disposed = await evalValue<{ frames: number; events: string[] }>(`(async () => {
    if (document.querySelector('#stage iframe')) window.jeexEmbed.embed.dispose();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return JSON.stringify({
      frames: document.querySelectorAll('#stage iframe').length,
      events: window.jeexEmbed.events,
    });
  })()`);
  assert(disposed.frames === 0, `dispose() removes the frame | ${disposed.frames} left`);
  summary.push(`embed iframe dispose: frame removed, events ${JSON.stringify(disposed.events)}`);
}
