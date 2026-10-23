/**
 * The debug surface's two lazy `layout/` modules: `layout-lint.ts` and
 * `free-space.ts`, armed together and only for a page whose debug capability
 * is on (`viewer-debug.ts`, `layoutIssues` and `suggestPlacement`), so a
 * production bundle never pays for them.
 *
 * Invariant: each accessor answers `null` until ITS module has landed; a
 * failed fetch is reported once through the library's log sink and the next
 * `loadLayoutModules` retries.
 */

import { defaultLogger } from '../shared/logger.js';

/**
 * Module-level caches for the lazy `layout/` imports (see the `layoutIssues`
 * doc comment on `ViewerDebugApi`): fired at most once per page load, on the
 * first `installViewerDebug` call whose host has the debug capability on. A
 * page that mounts, disposes and remounts the viewer behind `?debug=1` reuses
 * these same modules instead of importing them again.
 */
let layoutLint: typeof import('../layout/layout-lint.js') | null = null;
let freeSpace: typeof import('../layout/free-space.js') | null = null;
let layoutModulesLoading = false;

/**
 * Arms BOTH lazy layout modules at once.
 *
 * Measured on the full build rather than assumed: two dynamic
 * import sites make TWO chunks — `lazy-layout-lint` (6.5 KB gzip) and
 * `lazy-free-space` (1.7 KB gzip), the second importing `lintContext` and
 * `lintLayout` from the first. So this is one arming point for two downloads
 * that are useless apart, started together instead of one waiting on the other
 * to be asked for.
 *
 * The two caches are read separately, because the two dynamic imports resolve
 * as two microtasks: each accessor answers its own empty value until ITS
 * module has landed.
 */
export function loadLayoutModules(): void {
  if (layoutModulesLoading) return;
  layoutModulesLoading = true;
  // A chunk fetch CAN fail — an offline dev server, a stale hash after a
  // redeploy — and the accessors have no error channel of their own: they
  // would answer `[]` and `null` for the rest of the page session, and a
  // browser check polling them would only see an opaque timeout. So the
  // failure is reported once through the library's own sink, and the flag is
  // released so the next `installViewerDebug` (one per document) retries; a
  // chunk that did land by then is a module-map hit and costs nothing.
  const armed = [import('../layout/layout-lint.js'), import('../layout/free-space.js')] as const;
  void armed[0].then((module) => {
    layoutLint = module;
  });
  void armed[1].then((module) => {
    freeSpace = module;
  });
  void Promise.all(armed).catch((cause: unknown) => {
    layoutModulesLoading = false;
    defaultLogger.warn('debug-layout-chunk', 'the lazy layout modules did not load; layoutIssues and suggestPlacement stay empty', cause);
  });
}

/** `layout/layout-lint.ts`, once loaded; `null` before. */
export function layoutLintModule(): typeof import('../layout/layout-lint.js') | null {
  return layoutLint;
}

/** `layout/free-space.ts`, once loaded; `null` before. */
export function freeSpaceModule(): typeof import('../layout/free-space.js') | null {
  return freeSpace;
}
