/**
 * The interior presets of the viewer editor (`editor-presets.ts`), driven with
 * a stub model and the real `edits` wiring: where a preset's batch goes in
 * each `edits` mode.
 */

import { describe, expect, test } from 'bun:test';
import { EditorPresets, type EditorPresetsDeps } from './editor-presets.js';
import { editsWiring } from './edits-wiring.js';
import { resolveViewerOptions } from './viewer-options.js';
import type { ViewerEditRequest } from './viewer-events.js';
import type { SceneOp } from '../scene/types.js';
import { FINISH } from '../materials/finish-ids.js';

/** Ids this file invents for its one-room scene. */
const ID = {
  room: '01a12ffa-e52b-7b9e-8d9b-c96d98830fe6',
  oak: '01a12ffa-e52c-7c3c-9aac-7725fb691c26',
} as const;

type PresetsHarness = {
  presets: EditorPresets;
  /** Every batch that reached the host. */
  sent: ViewerEditRequest[];
  /** Every batch the MODEL was asked to commit. */
  committed: Array<{ baseRev: number; ops: SceneOp[] }>;
  rev: () => number;
};

function presetsHarness(mode: 'local' | 'emit' | 'off'): PresetsHarness {
  const sent: ViewerEditRequest[] = [];
  const committed: Array<{ baseRev: number; ops: SceneOp[] }> = [];
  let rev = 4;
  const scene = {
    assets: [],
    walls: [],
    rooms: [{ id: ID.room, name: 'Room' }],
    interiors: [{ id: ID.oak, name: 'Oak', swatch: [FINISH.oak, FINISH.white], ops: [] }],
  };
  const deps = {
    model: {
      scene,
      registries: {},
      get rev() {
        return rev;
      },
      apply: (batch: { baseRev: number; ops: SceneOp[] }) => {
        committed.push(batch);
        rev += 1;
        return { rev, applied: batch.ops, touched: [] };
      },
    },
    ui: { setHint: () => {}, setPanelBusy: () => {} },
    edits: editsWiring(resolveViewerOptions({ edits: mode }), (edit) => sent.push(edit)),
    reopenPanel: () => {},
  } as unknown as EditorPresetsDeps;
  return { presets: new EditorPresets(deps), sent, committed, rev: () => rev };
}

describe('interior presets', () => {
  test("an interior preset in 'emit' sends its whole batch and commits nothing", () => {
    const built = presetsHarness('emit');
    const before = built.rev();
    built.presets.commitPreset(ID.oak);
    expect(built.committed).toEqual([]);
    expect(built.rev()).toBe(before);
    expect(built.sent).toHaveLength(1);
    expect(built.sent[0]!.baseRev).toBe(before);
  });

  /**
   * `__viewerDebug.applyPreset` is an AUTHORING surface behind
   * `options.debug`, driven by `scripts/browser-check/presets.ts`, and the host
   * never sees it. It commits in every mode.
   */
  test("the debug `applyPreset` is ungated: it commits even in 'emit'", () => {
    const built = presetsHarness('emit');
    const before = built.rev();
    built.presets.applyPreset(ID.oak);
    expect(built.rev()).toBeGreaterThan(before);
    expect(built.sent).toEqual([]);
  });
});
