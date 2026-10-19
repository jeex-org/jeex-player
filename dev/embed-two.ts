/**
 * Executable acceptance test of "the viewer is a component": two of them in one
 * page, from one bundle, with nothing shared but the stylesheet.
 *
 * What this page exists to prove (`scripts/browser-check/embed.ts` asserts it):
 *
 * - INPUT is per instance. Keys are listened for on each shell root, which a
 *   `pointerdown` on its canvas focuses, so `W` walks the viewer that was
 *   clicked and leaves the other one — and the host page's `<input>` — alone.
 * - LOCALE is per instance. The second mounts with `locale: 'ru'` and its
 *   chrome answers in Russian while the first answers in English.
 * - GLOBALS have ONE owner. The first mount claims `window.__viewerDebug`,
 *   `__appReady` and `__viewerReadyAt`; disposing it takes them down and the
 *   second keeps rendering, because they were never its.
 *
 * It is a dev page (`npm run dev:embed`), never part of the production bundle.
 */

import { mountViewer, type ViewerHandle } from '../src/app/viewer-api.js';
import { LocalFixtureRepository } from '../src/demo/fixture-repository.js';

function stage(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (!element) throw new Error(`embed-two: no #${id} container`);
  return element;
}

async function main(): Promise<void> {
  // One repository per viewer on purpose: a host normally has its own source
  // for each, and sharing one would prove nothing about independence.
  const scene = () => ({ repository: new LocalFixtureRepository() });
  const first = mountViewer(stage('stage-a'), { scene: scene(), view: { mode: 'walk' }, tour: { mode: 'off' } });
  const second = mountViewer(stage('stage-b'), { scene: scene(), view: { mode: 'walk' }, tour: { mode: 'off' }, locale: 'ru' });

  window.jeexPair = {
    first,
    second,
    disposeFirst: () => {
      first.dispose();
    },
    cycle: (times) => mountCycle(times),
  };

  await Promise.all([first.ready, second.ready]);
  window.__embedTwoReady = true;
}

/** What one `mountCycle` run leaves behind, for the browser check to assert on. */
export type CycleReport = {
  /** Most children the cycle container ever held at once; one viewer is one child. */
  maxChildren: number;
  /** Children left in the container after the last `dispose()`; must be zero. */
  childrenAfter: number;
  /** Canvases in the whole document afterwards: the page's own two and nothing else. */
  canvases: number;
  /** Sheets adopted into the document: the ONE component sheet the pair still holds. */
  sheets: number;
};

/**
 * Mounts and disposes a viewer `times` over in ONE container, then reports what
 * the container and the document are left holding.
 *
 * This is the mount/dispose leak test: a
 * SPA route or a React StrictMode double-effect does exactly this, and before
 * `dispose()` removed its shell each cycle left a dead `.jeex-viewer` subtree,
 * its listeners and a live WebGL context behind — sixteen of those and the
 * browser refuses the next one.
 *
 * Two of the cycles wait for a full boot and the rest dispose in the same task
 * that mounted, because BOTH are real host behaviour and they exercise
 * different paths: a finished viewer, and a boot cut short mid-frame.
 */
async function mountCycle(times: number): Promise<CycleReport> {
  const host = document.createElement('div');
  host.style.setProperty('position', 'absolute');
  host.style.setProperty('inset-block-start', '-10000px');
  host.style.setProperty('inline-size', '320px');
  host.style.setProperty('block-size', '240px');
  document.body.appendChild(host);
  let maxChildren = 0;
  for (let index = 0; index < times; index += 1) {
    const handle = mountViewer(host, {
      scene: { repository: new LocalFixtureRepository() },
      view: { mode: 'orbit' },
      tour: { mode: 'off' },
    });
    maxChildren = Math.max(maxChildren, host.children.length);
    if (index === 0 || index === times - 1) await handle.ready.catch(() => undefined);
    maxChildren = Math.max(maxChildren, host.children.length);
    handle.dispose();
  }
  const report: CycleReport = {
    maxChildren,
    childrenAfter: host.children.length,
    canvases: document.querySelectorAll('canvas').length,
    sheets: document.adoptedStyleSheets.length,
  };
  host.remove();
  return report;
}

declare global {
  interface Window {
    /** The two handles, so the browser check can drive either one. */
    jeexPair?: {
      first: ViewerHandle;
      second: ViewerHandle;
      disposeFirst: () => void;
      /** Mount → dispose, `times` over in one container; see `CycleReport`. */
      cycle: (times: number) => Promise<CycleReport>;
    };
    /** Set once both viewers have rendered their first frame. */
    __embedTwoReady?: boolean;
  }
}

void main();
