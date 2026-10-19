/**
 * First contact with the page: it loads, it is ready inside the budget, it
 * does not overflow its window, and the document it mounted breaks no hard
 * furniture-layout rule.
 */

import { READY_BUDGET_MS, type CheckContext } from './context.js';
import { SHELL_NAMES } from '../../src/ui/viewer-shell.js';

/** Load, readiness budget, viewport overflow and the furniture-layout linter.
 * Leaves the page on `?view=tour` with the tour playing. */
export async function checkBoot(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, literal, withQuery } = ctx;
  const openedAt = Date.now();
  // The tour engages at start only in `view.mode: 'tour'`; the plain page
  // opens on 360 and is checked further down.
  await run(['open', withQuery('view=tour')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const wallClockMs = Date.now() - openedAt;
  // The wall clock includes the CLI round trips, so the budget is asserted on
  // the IN-PAGE measurement: `performance.now()` at the moment `__appReady` was
  // set, i.e. milliseconds from navigation start to a usable viewer.
  const readyMs = await evalValue<number>('window.__viewerReadyAt ?? -1');
  // Printed before the assertions, so a run that fails later still reports it.
  console.log(`  time to __appReady: ${readyMs} ms in-page (wall clock ${wallClockMs} ms, includes CLI round trips)`);
  assert(readyMs > 0, 'the page must expose __viewerReadyAt when it becomes ready');
  assert(readyMs < READY_BUDGET_MS, `the viewer should be ready within ${READY_BUDGET_MS} ms, took ${readyMs} ms`);
  summary.push(`ready in ${Math.round(readyMs)} ms in-page (budget ${READY_BUDGET_MS} ms)`);
  // ---- The shell the viewer built: every name present, exactly once ----
  // `createViewerShell` builds the shell markup (the page carries none), so the
  // page is where its output is checked: one root under the host container,
  // every documented name resolving under it, and no page id left behind.
  const shell = await evalValue<{ roots: number; hostChildren: number; missing: string[]; duplicated: string[]; ids: string[] }>(`(() => {
    const NAMES = ${literal([...SHELL_NAMES])};
    const roots = [...document.querySelectorAll('.jeex-viewer')];
    const root = roots[0];
    const missing = [];
    const duplicated = [];
    for (const name of NAMES) {
      if (name === 'viewer') continue;
      const found = root.querySelectorAll('[data-jeex="' + name + '"]');
      if (found.length === 0) missing.push(name);
      if (found.length > 1) duplicated.push(name);
    }
    return JSON.stringify({
      roots: roots.length,
      hostChildren: document.getElementById('app').children.length,
      missing,
      duplicated,
      ids: [...root.querySelectorAll('[id]')].map((node) => node.id),
    });
  })()`);
  assert(shell.roots === 1, `the demo page mounts exactly one viewer, saw ${shell.roots}`);
  assert(shell.hostChildren === 1, `the viewer adds one child to its container, saw ${shell.hostChildren}`);
  assert(shell.missing.length === 0, `the shell must carry every name | missing ${JSON.stringify(shell.missing)}`);
  assert(shell.duplicated.length === 0, `each name appears once | duplicated ${JSON.stringify(shell.duplicated)}`);
  assert(shell.ids.length === 0, `the shell must carry no page id | found ${JSON.stringify(shell.ids)}`);
  summary.push(`shell: 1 root, ${SHELL_NAMES.length} names, 0 ids`);

  const metrics = await evalValue<{ ready: boolean; width: number; height: number; scrollWidth: number; scrollHeight: number }>(
    'JSON.stringify({ ready: window.__appReady === true, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight })',
  );
  assert(metrics.ready, 'app should expose ready state');
  assert(metrics.scrollWidth <= metrics.width && metrics.scrollHeight <= metrics.height, 'page must not overflow viewport');

  // ---- Furniture layout: the running document must break no hard rule ----
  const layout = await evalValue<{ errors: number; warnings: number; worst: string[] }>(`(() => {
    const issues = window.__viewerDebug.layoutIssues();
    return JSON.stringify({
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      worst: issues.slice(0, 5).map((issue) => 'rule ' + issue.rule + ' ' + issue.severity + ': ' + issue.message),
    });
  })()`);
  console.log(`  layout linter: ${layout.errors} error(s), ${layout.warnings} warning(s)`);
  for (const line of layout.worst) console.log(`    ${line}`);
  assert(layout.errors === 0, `the demo layout must break no hard rule; got ${layout.errors}`);
  summary.push(`layout linter clean (${layout.errors} errors, ${layout.warnings} warnings)`);
}
