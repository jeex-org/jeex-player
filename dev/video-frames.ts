/**
 * Dev harness for `capture.frames` (`src/app/video-frames.ts`):
 * mounts the demo apartment and exposes a frames run both the on-page
 * controls and `scripts/video-frames.ts` (a Playwright script) drive.
 *
 * `npm run dev:frames`, never part of the production bundle. The page's own
 * job is the same as `scroll-tour.ts`'s: build a real viewer with `mountViewer`
 * and stay out of the way — no fetch of `index.html`, no shell cloning.
 */

import { mountViewer, type ViewerHandle } from '../src/app/viewer-api.js';
import { LocalFixtureRepository } from '../src/demo/fixture-repository.js';
import type { Aspect } from '../src/app/video-frames.js';

/** Keeps `String.fromCharCode(...bytes)` off the call stack for a large frame. */
const BASE64_CHUNK = 0x8000;

/** One frame's PNG, base64 — what crosses to a Playwright script through `page.evaluate`'s return value. */
export type FrameOut = { index: number; timeS: number; png: string };

export type FramesRunRequest = {
  aspect: Aspect;
  height: number;
  fps: 24 | 25 | 30;
  from?: number;
  to?: number;
  caption?: boolean;
};

export type FramesRunResult = { frames: FrameOut[]; count: number; durationS: number };

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(at, at + BASE64_CHUNK));
  }
  return btoa(binary);
}

async function main(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('video-frames: no #stage container');

  const handle = mountViewer(stage, {
    // Development pages never send telemetry; `/dev/telemetry.html` is the one that tests it.
    analytics: 'off',
    scene: { repository: new LocalFixtureRepository() },
    view: { mode: 'tour' },
    tour: { mode: 'paused', progressBar: false },
  });
  window.jeexVideoFrames = handle;
  await handle.ready;

  const statusEl = document.querySelector<HTMLElement>('#status');
  const thumbsEl = document.querySelector<HTMLElement>('#thumbs');

  /** Runs one `capture.frames` request, collecting every PNG as base64 alongside its own thumbnail on the page. */
  async function runFrames(request: FramesRunRequest): Promise<FramesRunResult> {
    const frames: FrameOut[] = [];
    const result = await handle.capture.frames({
      ...request,
      onFrame: async (frame) => {
        const bytes = new Uint8Array(await frame.blob.arrayBuffer());
        frames.push({ index: frame.index, timeS: frame.timeS, png: toBase64(bytes) });
        if (statusEl) statusEl.textContent = `frame ${String(frame.index + 1)}`;
        if (thumbsEl) {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(frame.blob);
          thumbsEl.append(img);
        }
      },
    });
    return { frames, count: result.frames, durationS: result.durationS };
  }
  window.__captureFrames = runFrames;
  window.__videoFramesReady = true;

  document.querySelector<HTMLButtonElement>('#run')?.addEventListener('click', () => {
    const aspect = (document.querySelector<HTMLSelectElement>('#aspect')?.value ?? '9:16') as Aspect;
    const fps = Number(document.querySelector<HTMLSelectElement>('#fps')?.value ?? '24') as 24 | 25 | 30;
    const height = Number(document.querySelector<HTMLInputElement>('#height')?.value ?? '320');
    const durationS = Number(document.querySelector<HTMLInputElement>('#duration')?.value ?? '2');
    thumbsEl?.replaceChildren();
    if (statusEl) statusEl.textContent = 'capturing…';
    void runFrames({ aspect, height, fps, from: 0, to: durationS }).then((result) => {
      if (statusEl) statusEl.textContent = `${String(result.count)} frames, ${result.durationS.toFixed(2)}s`;
    });
  });
}

declare global {
  interface Window {
    /**
     * The mounted viewer's handle. Declared locally (not reused from
     * `main.ts`'s `jeexViewer`) so this file type-checks on its own under
     * `tsconfig.scripts.json`, which `scripts/video-frames.ts` pulls it into
     * but which never sees `src/main.ts`.
     */
    jeexVideoFrames?: ViewerHandle;
    /** What `scripts/video-frames.ts` calls through `page.evaluate`. */
    __captureFrames?: (request: FramesRunRequest) => Promise<FramesRunResult>;
    /** Set once the viewer is mounted and `__captureFrames` is live. */
    __videoFramesReady?: boolean;
  }
}

void main();
