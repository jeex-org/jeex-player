/**
 * How many times longer than on a developer machine an e2e wait may take
 * here: `JEEX_E2E_TIME_SCALE`, unset means 1. A hosted CI runner sets it in
 * `browser.yml`; a machine with a GPU leaves it alone.
 *
 * On SwiftShader one frame of the demo apartment costs about 1.2 s on four
 * hardware threads (0.82 fps, one page, 1280 x 720), and every Playwright
 * round trip (`evaluate`, `hover`, `press`) waits behind the frame in flight:
 * in a 10 s CPU profile of the page the main thread spends 99% in native GL
 * calls and under 1% in script. A spec that switches modes five times, or
 * scrolls, clicks and waits for the camera, needs minutes there, where a GPU
 * draws the same frame in milliseconds.
 *
 * One factor for every budget: `playwright.config.ts` scales the test and
 * `expect` defaults with it, and every budget written inside a spec or in
 * `support.ts` goes through `scaled`. A fixed observation window (how long
 * the canvas must stay still, how long a reply must NOT come) is not a
 * budget and is not scaled.
 */

function readScale(value: string | undefined): number {
  const scale = Number(value ?? 1);
  if (!Number.isFinite(scale) || scale < 1) throw new Error(`JEEX_E2E_TIME_SCALE must be a number >= 1, got ${String(value)}`);
  return scale;
}

const E2E_TIME_SCALE = readScale(process.env['JEEX_E2E_TIME_SCALE']);

/** A budget of `ms` on a developer machine, stretched by `JEEX_E2E_TIME_SCALE`. */
export function scaled(ms: number): number {
  return ms * E2E_TIME_SCALE;
}
