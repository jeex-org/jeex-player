/**
 * The bootstrap BOTH frame pages share: the demo's `embed.html`
 * (`src/main-embed.ts`) and the library's public `dist-lib/embed.html`
 * (`embed/frame-entry.ts`), so the page a site owner frames behaves exactly
 * like the one this repository tests.
 *
 * What it does, in order:
 *
 * 1. Mounts the viewer into `#app` with the query's options, through
 *    `embedPageOptions` (no `debug`, read-only unless `readonly=0`). With no
 *    `?scene=` it mounts `fallbackScene` when the page has one (the demo
 *    apartment) and otherwise lets the viewer report `no-scene-source`, the
 *    library's own rule: it ships no apartment.
 * 2. Gives `#jeex-size`, the page's content box (`ui/styles/frame.css`), the
 *    `?ratio=` aspect ratio.
 * 3. Watches that box. Every change in its size is announced twice: to the
 *    browser with `window.requestResize()` where responsive iframes exist and
 *    the page is framed (`<meta name="responsive-embedded-sizing">` in the
 *    page opts in; `embed/frame-resize.ts` says when the call is allowed), and
 *    to the host helper as the bridge's `size` event, the fallback everywhere
 *    else.
 * 4. Installs the postMessage bridge when `?host=` is an exact origin.
 */

import { mountViewerAs } from '../app/viewer-api.js';
import { FrameSite } from './frame-site.js';
import type { ViewerHandle } from '../app/viewer-handle.js';
import { NO_SCENE_SOURCE, type SceneRepository } from '../scene/scene-repository.js';
import { ViewerLibError } from '../shared/errors.js';
import { createLogger, type Logger } from '../shared/logger.js';
import { installFrameBridge } from './frame-bridge.js';
import { RATIO_PARAM, embedPageOptions, framePageRatio, hostOriginFrom } from './frame-page.js';
import { frameResizeRequester } from './frame-resize.js';
import { HOST_PARAM, VIEWER_ID_PARAM } from './host.js';
import type { EmbedEventMap } from './protocol.js';
import { cssAspectRatio } from './ratio.js';

/** The page's mount point; the frame CSS makes it fill the frame. */
export const FRAME_APP_ID = 'app';
/** The page's content box, the one the frame is sized by. */
export const FRAME_SIZE_ID = 'jeex-size';

type FrameSize = EmbedEventMap['size'];

/**
 * The source a frame with no `?scene=` and no fallback mounts against: it
 * refuses, so the failure is the viewer's own error card and `error` event
 * (relayed to the host) rather than a throw out of the page's module, which
 * would leave a blank frame and nothing for the host to hear.
 */
const MISSING_SCENE: SceneRepository = {
  load: () => Promise.reject(new ViewerLibError('no-scene-source', NO_SCENE_SOURCE)),
};

/**
 * Reports the content box's size whenever it changes: one `ResizeObserver`,
 * any number of listeners, each told the current size the moment it joins.
 */
type SizeWatch = {
  /** Subscribes to every size report; the bridge's `sizes` option. */
  subscribe: (listener: (size: FrameSize) => void) => () => void;
  /** Stops observing. */
  stop: () => void;
};

function watchSize(box: HTMLElement, win: Window, log: Logger): SizeWatch {
  const listeners = new Set<(size: FrameSize) => void>();
  const requestResize = frameResizeRequester(win, (error) => {
    log.warn(
      'resize-request-refused',
      'the browser refused window.requestResize() (the frame is not an <iframe>, or the page lacks <meta name="responsive-embedded-sizing">); frame-sizing will not follow this page, the size event still does',
      { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
    );
  });
  let current: FrameSize | null = null;
  const measure = (): void => {
    const rect = box.getBoundingClientRect();
    const size = { width: Math.round(rect.width), height: Math.round(rect.height) };
    if (current !== null && current.width === size.width && current.height === size.height) return;
    current = size;
    requestResize();
    for (const listener of [...listeners]) listener(size);
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  observer?.observe(box);
  measure();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (current !== null) listener(current);
      return () => {
        listeners.delete(listener);
      };
    },
    stop: () => {
      observer?.disconnect();
      listeners.clear();
    },
  };
}

/** A booted frame page: its viewer, and the teardown of everything the page added around it. */
export type FramePage = {
  handle: ViewerHandle;
  /** Uninstalls the bridge, stops the size watch, disposes the viewer. */
  dispose: () => void;
};

/**
 * Boots a frame page in `doc`, reading `win.location.search`. Returns the
 * viewer handle and a teardown, which the demo page runs on a hot reload so
 * no old bridge or observer keeps answering beside the new one.
 */
export function bootFramePage(doc: Document, win: Window, fallbackScene?: SceneRepository): FramePage {
  const container = doc.querySelector<HTMLElement>(`#${FRAME_APP_ID}`);
  if (!container) throw new ViewerLibError('internal', `embed page: no #${FRAME_APP_ID} container to mount the viewer in`);

  const query = new URLSearchParams(win.location.search);
  const options = embedPageOptions(win.location.search);
  const log = createLogger(options.onLog);
  const scene = options.scene?.url ? options.scene : { repository: fallbackScene ?? MISSING_SCENE };
  const site = new FrameSite(win);
  const handle = mountViewerAs({ embed: 'iframe', site }, container, { ...options, scene });

  const box = doc.querySelector<HTMLElement>(`#${FRAME_SIZE_ID}`);
  let sizes: SizeWatch | undefined;
  if (box) {
    const ratio = framePageRatio(query, (raw) => {
      log.warn('ratio-invalid', `refusing ?${RATIO_PARAM}=${raw}: not a ratio like 16:9, 4:3 or 1; using 16:9`, { ratio: raw });
    });
    box.style.setProperty('aspect-ratio', cssAspectRatio(ratio));
    sizes = watchSize(box, win, log);
  }

  const hostOrigin = hostOriginFrom(query, HOST_PARAM, (raw) => {
    // Said out loud rather than swallowed: a host that mistyped its own origin
    // otherwise sees a frame that simply never answers.
    log.warn('host-origin-refused', `refusing ?host=${raw}: not an exact http(s) origin, so no postMessage bridge was installed`, {
      host: raw,
    });
  });
  const uninstall = hostOrigin
    ? installFrameBridge(handle, {
        hostOrigin,
        target: win.parent,
        viewerId: query.get(VIEWER_ID_PARAM) ?? undefined,
        sizes: sizes?.subscribe,
        site,
      })
    : undefined;
  return {
    handle,
    dispose: () => {
      uninstall?.();
      sizes?.stop();
      handle.dispose();
    },
  };
}
