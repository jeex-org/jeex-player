/**
 * The `edits` table: three modes, three shapes, and a sink that is only ever
 * pulled by one of them.
 *
 * It is a table rather than behaviour (`director-wiring.ts`'s own header says
 * the same of itself), so what there is to test is exactly that: the mode goes
 * through untouched and `onEdit` is the sink it was handed.
 */

import { describe, expect, test } from 'bun:test';
import { editsWiring, effectiveEditsMode } from './edits-wiring.js';
import { resolveViewerOptions } from './viewer-options.js';
import type { ViewerEditRequest } from './viewer-events.js';
import { FINISH } from '../materials/finish-ids.js';

/** The room the sample edit paints; any UUID, since nothing resolves it here. */
const ROOM = '01a12ffa-e52e-736f-a547-35459332a4a4';

function wiringFor(mode: 'local' | 'emit' | 'off'): { sent: ViewerEditRequest[]; wiring: ReturnType<typeof editsWiring> } {
  const sent: ViewerEditRequest[] = [];
  const wiring = editsWiring(resolveViewerOptions({ edits: mode }), (edit) => sent.push(edit));
  return { sent, wiring };
}

describe('editsWiring', () => {
  test('carries the resolved mode through, unchanged', () => {
    for (const mode of ['local', 'emit', 'off'] as const) {
      expect(wiringFor(mode).wiring.mode).toBe(mode);
    }
  });

  test('the default mount is `local`: a published tour is untouched by this option existing', () => {
    expect(editsWiring(resolveViewerOptions(), () => undefined).mode).toBe('local');
  });

  test('`onEdit` is the sink it was given, and reaches it verbatim', () => {
    const { sent, wiring } = wiringFor('emit');
    const edit: ViewerEditRequest = { ops: [{ op: 'set_material', target: ROOM, material: FINISH.oak }], baseRev: 7 };
    wiring.onEdit(edit);
    expect(sent).toEqual([edit]);
  });

  /**
   * The sink exists in all three modes — the table does not decide when to pull
   * it, the SEAMS do (`viewer-editor.ts`, `director-wiring.ts`). Nothing here
   * may call it by itself, or a `local` mount would raise events it never
   * promised.
   */
  test('building the table raises nothing at all, in any mode', () => {
    for (const mode of ['local', 'emit', 'off'] as const) {
      expect(wiringFor(mode).sent).toEqual([]);
    }
  });
});

describe('effectiveEditsMode (read-only)', () => {
  test('without read-only it is the resolved `edits` option, unchanged', () => {
    for (const mode of ['local', 'emit', 'off'] as const) {
      expect(effectiveEditsMode(resolveViewerOptions({ edits: mode }))).toBe(mode);
    }
  });

  test('read-only turns every mode off: no click opens an editing panel', () => {
    for (const mode of ['local', 'emit', 'off'] as const) {
      expect(effectiveEditsMode(resolveViewerOptions({ edits: mode, readonly: true }))).toBe('off');
    }
  });

  test('the wiring carries the effective mode, and the options keep what the host set', () => {
    const options = resolveViewerOptions({ edits: 'emit', readonly: true });
    expect(editsWiring(options, () => undefined).mode).toBe('off');
    expect(options.edits).toBe('emit');
  });
});
