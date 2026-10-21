/**
 * Playwright script (a developer tool, in the role `scripts/browser-check.ts`
 * plays for the rest of the viewer): drives `dev/video-frames.html` against an
 * already-running dev server, calls `capture.frames` for one or more aspects,
 * writes each frame to `<out>/<aspect-slug>/frame-NNNNN.png`, and prints the
 * `ffmpeg` command line that assembles them into a clip — running it itself
 * when `ffmpeg` is on `PATH`.
 *
 * This script plus `ffmpeg` IS the `fast` video
 * pipeline; no video codec lives in the library, and `ffmpeg` is never a
 * runtime dependency of it — only of this standalone tool.
 *
 * Usage, against a dev server of its own (`VIEWER_URL` defaults to the dev
 * server on 3700, see `browser-check/session.ts`):
 *
 *   npm run dev -- --port 3703 --strictPort
 *   VIEWER_URL=http://127.0.0.1:3703/ bun run scripts/video-frames.ts
 *
 * Every parameter is an environment variable (`video-frames-env.ts`); the
 * defaults — 12 frames of `9:16` and `16:9` — are the smoke check this script
 * IS: it exits 1 if what it wrote does not match the frame count and pixel
 * size it asked for. `FRAMES_TO=2` reproduces the acceptance clip (a
 * 2-second `9:16` run).
 */

import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveViewerUrl } from './browser-check/session.js';
import { headlessWebglLaunch } from '../tests/headless-webgl.js';
import { waitForBoot } from '../tests/e2e/support.js';
import type { Aspect } from '../src/app/video-frames.js';
import type { FramesRunRequest, FramesRunResult } from '../dev/video-frames.js';
import { readFramesEnv } from './video-frames-env.js';

/** Mirrors `video-frames.ts`'s own table: `width = height * ratio`. */
const ASPECT_RATIO: Record<Aspect, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };

const { fps: FPS, height: HEIGHT, from: FROM_S, to: TO_S, aspects: ASPECTS, out: OUT_DIR } = readFramesEnv(process.env);

/** How many samples `[FROM_S, TO_S]` takes at `FPS` — `video-frames.ts`'s own `frameCount` formula. */
const EXPECTED_COUNT = Math.max(1, Math.round((TO_S - FROM_S) * FPS) + 1);

/** `aspect:` is not a filesystem-safe directory name. */
function slug(aspect: Aspect): string {
  return aspect.replace(':', 'x');
}

/** A PNG's own `width`/`height`, read straight out of its IHDR chunk (always the first 25 bytes) — no image library needed for eight bytes. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** `ffmpeg`'s own argv for assembling one aspect's frames into a clip; also the printable command when `ffmpeg` is missing. */
function ffmpegArgs(aspect: Aspect): string[] {
  const dir = join(OUT_DIR, slug(aspect));
  return [
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    join(dir, 'frame-%05d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    join(OUT_DIR, `${slug(aspect)}.mp4`),
  ];
}

function ffmpegCommandLine(aspect: Aspect): string {
  return ['ffmpeg', ...ffmpegArgs(aspect)].map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ');
}

function hasFfmpeg(): boolean {
  try {
    return spawnSync('ffmpeg', ['-version']).status === 0;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const base = resolveViewerUrl();
  const url = new URL('dev/video-frames.html', base).href;
  const browser = await chromium.launch({ headless: true, ...headlessWebglLaunch() });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(url);
    await waitForBoot(page, 'window.__videoFramesReady === true');

    const ffmpegPresent = hasFfmpeg();
    for (const aspect of ASPECTS) {
      const width = Math.round(HEIGHT * ASPECT_RATIO[aspect]);
      console.log(`  -- ${aspect} (${String(width)}x${String(HEIGHT)}, ${String(EXPECTED_COUNT)} frames)`);
      const dir = join(OUT_DIR, slug(aspect));
      mkdirSync(dir, { recursive: true });

      const frameRequest: FramesRunRequest = { aspect, height: HEIGHT, fps: FPS, from: FROM_S, to: TO_S, caption: true };
      const run: FramesRunResult = await page.evaluate((request) => window.__captureFrames!(request), frameRequest);

      if (run.frames.length !== EXPECTED_COUNT) {
        throw new Error(`${aspect}: expected ${String(EXPECTED_COUNT)} frames, got ${String(run.frames.length)}`);
      }
      for (const frame of run.frames) {
        const bytes = Buffer.from(frame.png, 'base64');
        const size = pngSize(bytes);
        if (size.width !== width || size.height !== HEIGHT) {
          throw new Error(
            `${aspect} frame ${String(frame.index)}: expected ${String(width)}x${String(HEIGHT)}, got ${String(size.width)}x${String(size.height)}`,
          );
        }
        writeFileSync(join(dir, `frame-${String(frame.index).padStart(5, '0')}.png`), bytes);
      }
      console.log(`     wrote ${String(run.frames.length)} PNGs to ${dir}`);

      const command = ffmpegCommandLine(aspect);
      if (ffmpegPresent) {
        const result = spawnSync('ffmpeg', ffmpegArgs(aspect), { stdio: 'inherit' });
        if (result.status !== 0) throw new Error(`ffmpeg exited ${String(result.status)} assembling ${aspect}`);
        console.log(`     assembled ${OUT_DIR}/${slug(aspect)}.mp4`);
      } else {
        console.log(`     ffmpeg not on PATH; assemble with:\n       ${command}`);
      }
    }

    if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join('; ')}`);
    console.log(`Video-frames check passed: ${ASPECTS.join(', ')}, ${String(EXPECTED_COUNT)} frames each, written to ${OUT_DIR}.`);
  } finally {
    await browser.close();
  }
}

declare global {
  interface Window {
    __captureFrames?: (request: FramesRunRequest) => Promise<FramesRunResult>;
    __videoFramesReady?: boolean;
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
