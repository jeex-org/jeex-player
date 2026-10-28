/**
 * Dev-only performance meter: mounts the viewer in walk mode, plays one fixed
 * scripted walk and prints the frame-time numbers in the bottom strip, sized
 * to stay readable in a phone screenshot. Nothing leaves the page — the owner
 * opens it, waits for DONE and sends the picture.
 *
 * The script is the same input sequence on every page: short forward holds
 * alternating with 90-degree drag turns. A single "forward, turn, forward"
 * wedges against a wall at a different distance per project and then draws
 * nothing at rest — the numbers would not compare — and the projects'
 * authored tours are different routes that hug fixtures. From the shared
 * spawn the repeating turns keep the camera moving on every page for the
 * whole window.
 *
 * `?project=<url>` mounts that bake (`dev/project.ts`'s path); without it the
 * bundled demo apartment mounts, the way `dev/scroll-tour.ts` does. Both paths
 * are always walk mode, tour off, analytics off.
 */

import { mountViewer, type ViewerHandle } from '../src/app/viewer-api.js';
import { CAMERA_TUNING } from '../src/camera/camera-tuning.js';
import { LocalFixtureRepository } from '../src/demo/fixture-repository.js';

/** Each forward hold of the walk. */
const HOLD_MS = 1_200;
/** One drag step of the turn; ~400 ms across ~24 moves, like a finger. */
const TURN_MS = 400;
const TURN_STEPS = 24;
/** A 90-degree turn in horizontal drag pixels, at the walk look sensitivity the camera is tuned to. */
const TURN_PX = Math.round(Math.PI / 2 / CAMERA_TUNING.walk.lookRadPerPx);
/** The measured walk window. */
const WALK_MEASURE_MS = 12_000;
/** Frame samples inside the first 1.5 s are warm-up: shaders, bake settle. */
const WARMUP_MS = 1_500;
/** The lighting bake has this long to reach `live` before the walk starts anyway. */
const BAKE_BUDGET_MS = 45_000;
const BAKE_POLL_MS = 250;
/** The scene has this long to become ready before the page reports a failure. */
const LOAD_BUDGET_MS = 60_000;
/** A frame at or above this many milliseconds misses 30 fps. */
const SLOW_FRAME_MS = 33;
/** How often the live `measuring…` counter redraws. */
const COUNTER_MS = 200;
/** The GPU renderer string is truncated to roughly this many characters. */
const GPU_MAX_CHARS = 60;

const startedAt = performance.now();

const statusOut = document.querySelector<HTMLElement>('#meter-status');
const p50Out = document.querySelector<HTMLElement>('#meter-p50');
const slowOut = document.querySelector<HTMLElement>('#meter-slow');
const demandOut = document.querySelector<HTMLElement>('#meter-demand');
const tierOut = document.querySelector<HTMLElement>('#meter-tier');
const gpuOut = document.querySelector<HTMLElement>('#meter-gpu');
const deviceOut = document.querySelector<HTMLElement>('#meter-device');
const timingOut = document.querySelector<HTMLElement>('#meter-timing');

function say(text: string): void {
  if (statusOut) statusOut.textContent = text;
}

function line(out: HTMLElement | null, text: string): void {
  if (out) out.textContent = text;
}

/** The strip's tier line, from the debug readout; silent while the surface is absent. */
function printTier(): void {
  const state = window.__viewerDebug?.quality();
  if (state && tierOut) tierOut.textContent = `tier: ${state.mode} → ${state.tier}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The unmasked renderer string from the page's own probe canvas. */
function gpuRenderer(): string {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return 'n/a (no webgl2)';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const value = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    return value.length > GPU_MAX_CHARS ? `${value.slice(0, GPU_MAX_CHARS)}…` : value;
  } catch {
    return 'n/a (probe failed)';
  }
}

/** `w` on the shell root, the way a real key lands (`camera-input.ts` listens there). */
function pressKey(handle: ViewerHandle, type: 'keydown' | 'keyup'): void {
  handle.element.dispatchEvent(new KeyboardEvent(type, { key: 'w', bubbles: true }));
}

/** A synthetic one-finger horizontal drag across `canvas`, left to right: a right turn. */
async function dragTurn(canvas: HTMLCanvasElement): Promise<void> {
  const rect = canvas.getBoundingClientRect();
  const y = Math.round(rect.top + rect.height / 2);
  const fromX = Math.round(rect.left + rect.width / 2 - TURN_PX / 2);
  const pointerId = 9_100;
  const options = { clientY: y, bubbles: true, pointerId };
  canvas.dispatchEvent(new PointerEvent('pointerdown', { ...options, clientX: fromX }));
  for (let step = 1; step <= TURN_STEPS; step += 1) {
    await sleep(TURN_MS / TURN_STEPS);
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...options, clientX: Math.round(fromX + (TURN_PX * step) / TURN_STEPS) }));
  }
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...options, clientX: fromX + TURN_PX }));
}

/** The strip lines that make up the copied result, in on-screen order. */
const RESULT_LINE_IDS = [
  'meter-status',
  'meter-p50',
  'meter-slow',
  'meter-demand',
  'meter-tier',
  'meter-gpu',
  'meter-device',
  'meter-timing',
] as const;

/** Wires the copy button: the strip lines plus the page URL and the user agent. */
function wireCopyButton(): void {
  const button = document.querySelector<HTMLButtonElement>('#meter-copy');
  button?.addEventListener('click', () => {
    const lines = RESULT_LINE_IDS.map((id) => document.querySelector<HTMLElement>(`#${id}`)?.textContent ?? '').filter(Boolean);
    const text = `${lines.join('\n')}\nurl: ${window.location.href}\nua: ${navigator.userAgent}`;
    // The page runs on HTTPS (tailnet) or localhost, where the async clipboard
    // API exists; anywhere else the click still says so instead of throwing.
    if (!navigator.clipboard) {
      button.textContent = 'copy failed — send a screenshot';
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        if (button) {
          button.textContent = 'copied ✓';
          setTimeout(() => {
            button.textContent = 'copy result';
          }, 2_000);
        }
      })
      .catch(() => {
        if (button) button.textContent = 'copy failed — send a screenshot';
      });
  });
}

/** Nearest-rank percentile over an ascending-sorted array. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

/**
 * Waits for the walk lighting to reach `live`, at most `BAKE_BUDGET_MS`.
 * Returns the state to report when the budget ran out first, `null` on `live`.
 */
async function waitBakeLive(): Promise<string | null> {
  const deadline = performance.now() + BAKE_BUDGET_MS;
  for (;;) {
    const state = window.__viewerDebug?.walkLighting().state;
    if (state === 'live') return null;
    // A terminal state never becomes `live`: waiting the full budget out
    // would stall a failing run for nothing.
    if (state === 'failed' || state === 'empty' || state === 'off' || performance.now() >= deadline) return state ?? 'off';
    await sleep(BAKE_POLL_MS);
  }
}

async function main(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('meter: no #stage container');
  wireCopyButton();

  const params = new URL(window.location.href).searchParams;
  const project = params.get('project');
  // ?quality=low|high|auto forces the tier for a measurement; the default auto
  // is what a published embed gets.
  const qualityParam = params.get('quality');
  const quality = qualityParam === 'low' || qualityParam === 'high' ? qualityParam : 'auto';
  const handle = mountViewer(stage, {
    // Development pages never send telemetry.
    analytics: 'off',
    scene: project === null ? { repository: new LocalFixtureRepository() } : { url: project },
    view: { mode: 'walk' },
    tour: { mode: 'off' },
    quality,
  });

  say('loading scene…');
  const loadResult = await Promise.race([handle.ready.then(() => 'ready' as const), sleep(LOAD_BUDGET_MS).then(() => 'timeout' as const)]);
  if (loadResult === 'timeout') {
    throw new Error(`scene not ready in ${LOAD_BUDGET_MS / 1000} s (project: ${project ?? 'bundled demo'})`);
  }
  const readySeconds = (performance.now() - startedAt) / 1000;

  say('waiting for lighting bake…');
  const bakeMissed = await waitBakeLive();

  // The frame sampler runs beside the walk: one rAF loop, one delta per frame,
  // the first WARMUP_MS of them kept out of the statistics. A delta measures
  // the PREVIOUS tick's work, so it is filed by whether the PREVIOUS tick drew
  // (`prevDrew`, set after the bucketing): a tick whose frame drew nothing
  // (the camera stood still, render-on-demand skipped the draw) goes to
  // `idle` — its cheap delta would hide the real cost of the frames that did
  // render.
  const samples: number[] = [];
  let frames = 0;
  let idle = 0;
  let warmUp = 0;
  let last = 0;
  let walking = true;
  let lastDraw = -Infinity;
  let lastDraws = -1;
  let prevDrew = true;

  const sample = (now: number): void => {
    const delta = now - last;
    last = now;
    frames += 1;
    const draws = window.__viewerDebug?.renderDemand()?.draws ?? -1;
    const drew = draws !== lastDraws;
    lastDraws = draws;
    if (warmUp < WARMUP_MS) {
      warmUp += delta;
    } else if (prevDrew) {
      samples.push(delta);
    } else {
      idle += 1;
    }
    prevDrew = drew;
    if (walking) {
      if (now - lastDraw >= COUNTER_MS) {
        lastDraw = now;
        const recent = samples.slice(-30);
        const fps = recent.length > 0 ? 1000 / (recent.reduce((sum, ms) => sum + ms, 0) / recent.length) : 0;
        say(`measuring… ${((now - walkStartedAt) / 1000).toFixed(1)}s · ${frames}f · ${fps.toFixed(0)}fps`);
        printTier();
      }
      requestAnimationFrame(sample);
    }
  };

  const canvas = document.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
  if (!canvas) throw new Error('meter: no scene canvas');

  const demandBefore = window.__viewerDebug?.renderDemand();
  const walkStartedAt = performance.now();
  last = walkStartedAt;
  requestAnimationFrame(sample);

  // Forward holds with a 90-degree turn between them: the turn always moves
  // the camera, so a wall never starves the frame stream for long.
  while (performance.now() - walkStartedAt < WALK_MEASURE_MS) {
    const remaining = WALK_MEASURE_MS - (performance.now() - walkStartedAt);
    if (remaining <= TURN_MS) break;
    pressKey(handle, 'keydown');
    await sleep(Math.min(HOLD_MS, remaining - TURN_MS));
    pressKey(handle, 'keyup');
    await sleep(80);
    await dragTurn(canvas);
    await sleep(80);
  }

  walking = false;
  const walkSeconds = (performance.now() - walkStartedAt) / 1000;

  const demandAfter = window.__viewerDebug?.renderDemand();
  const draws = (demandAfter?.draws ?? 0) - (demandBefore?.draws ?? 0);
  const ticks = (demandAfter?.ticks ?? 0) - (demandBefore?.ticks ?? 0);

  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const slow = samples.filter((ms) => ms >= SLOW_FRAME_MS).length;
  const share = samples.length > 0 ? (slow / samples.length) * 100 : 0;

  line(p50Out, `p50 ${p50.toFixed(1)} ms  p95 ${p95.toFixed(1)} ms`);
  line(slowOut, `>=33ms: ${slow} (${share.toFixed(1)}%)  drawn: ${samples.length}/${frames}`);
  line(demandOut, `draws: ${draws}  idle: ${idle}  ticks: ${ticks}`);
  line(gpuOut, `DPR ${window.devicePixelRatio.toFixed(2)}  buffer ${canvas.width}x${canvas.height}`);
  line(deviceOut, `GPU: ${gpuRenderer()}`);
  line(timingOut, `ready ${readySeconds.toFixed(1)}s  walk ${walkSeconds.toFixed(1)}s`);
  printTier();
  say(bakeMissed === null ? 'DONE' : `DONE · bake not live (state=${bakeMissed})`);
}

main().catch((error: unknown) => {
  say(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
});
