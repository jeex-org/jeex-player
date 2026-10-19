/**
 * What the viewer's own panel does with an edit made in it: the `edits` mode
 * and the sink an emitted batch goes to, in one table.
 *
 * Invariant: a table, not behaviour — the same shape and the same reason as
 * `director-wiring.ts`. Nothing here decides WHEN an edit happens or what it
 * contains; it answers two questions the seams ask (`viewer-editor.ts` for the
 * commit, `director-wiring.ts` for whether a click may open a panel at all) and
 * pulls the sink for nobody. Building it raises no event in any mode.
 *
 * Why the sink is handed in rather than reached for: `ViewerEvents` belongs to
 * the composition root, and a table that fetched it would be a service locator.
 *
 * Pure module: no `three`, no DOM.
 */

import type { ViewerEditRequest } from './viewer-events.js';
import type { ViewerOptions } from './viewer-options.js';

/** `'local' | 'emit' | 'off'`, as `ViewerOptions` declares it. */
export type EditsMode = ViewerOptions['edits'];

/** Whether a click may open a panel at all, and where a panel's batch goes. */
export type EditsWiring = {
  mode: EditsMode;
  onEdit: (edit: ViewerEditRequest) => void;
};

/**
 * The `edits` mode the built-in UI actually runs under. `readonly: true` is
 * `'off'` whatever `edits` says: no
 * click opens a finish, furniture or door-variant panel and the interior
 * selector is not offered. Derived, never written back: a handle read of
 * `options.edits` still answers what the host set.
 */
export function effectiveEditsMode(options: Pick<ViewerOptions, 'edits' | 'readonly'>): EditsMode {
  return options.readonly ? 'off' : options.edits;
}

export function editsWiring(options: ViewerOptions, emit: (edit: ViewerEditRequest) => void): EditsWiring {
  return { mode: effectiveEditsMode(options), onEdit: emit };
}
