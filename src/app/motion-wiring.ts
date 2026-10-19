/**
 * The motion environment: the one place `matchMedia` is read
 * for `prefers-reduced-motion`, so the camera layer and `viewer-options.ts`
 * never have to.
 *
 * Two different questions live here on purpose. `resolveViewerOptions` asks
 * once, at mount, whether an ENGAGED tour should start playing or paused —
 * frozen for the life of the instance, the same as every other option.
 * `watchMotion` answers a second, LIVE question for the camera stack: is the
 * NEXT scripted travel instant. Under `motion: 'auto'` that tracks the media
 * query for as long as the viewer is mounted; under `'full'` or `'reduced'`
 * it never changes, because the host already said what it wants.
 */

import type { ViewerOptions } from './viewer-options.js';

/**
 * The visitor's current `prefers-reduced-motion` preference, or `false` where
 * `matchMedia` is unavailable (a non-browser test harness) rather than
 * throwing — the mount still resolves, it just cannot see the preference.
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Whether scripted camera motion should be instant, given the mount option and the environment. */
export function resolveMotionInstant(motion: ViewerOptions['motion'], reducedMotion: boolean): boolean {
  return motion === 'reduced' || (motion === 'auto' && reducedMotion);
}

/**
 * Reports the resolved instant/animated state to `onChange` once immediately
 * (the caller has one place to seed a field from), then again on every later
 * change for as long as `signal` is not aborted. Only `motion: 'auto'` keeps
 * listening: `'full'` and `'reduced'` are an explicit override the media
 * query has no say over, so one report is the whole story.
 */
export function watchMotion(deps: { motion: ViewerOptions['motion']; signal: AbortSignal; onChange: (instant: boolean) => void }): void {
  deps.onChange(resolveMotionInstant(deps.motion, prefersReducedMotion()));
  if (deps.motion !== 'auto' || typeof matchMedia !== 'function') return;
  const query = matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', (event) => deps.onChange(resolveMotionInstant(deps.motion, event.matches)), { signal: deps.signal });
}
