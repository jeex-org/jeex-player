/**
 * The public event fan-out. Two properties carry it: one throwing subscriber
 * must not take the others down (a host page's callback is not the viewer's
 * code), and a subscriber that unsubscribes itself mid-emission must not skip
 * the one after it.
 */

import { describe, expect, test } from 'bun:test';
import { ViewerEvents, sceneErrorCode, toViewerError, type ViewerEditRequest } from './viewer-events.js';
import { SceneValidationError, ViewerLibError } from '../shared/errors.js';
import { collectLogger } from '../fixtures/stubs.js';
import { FINISH } from '../materials/finish-ids.js';

/** The room the sample edit paints; any UUID, since nothing resolves it here. */
const ROOM = '01a12ffa-e52f-7100-b943-81b7c12533f0';

// A deliberately throwing subscriber is reported on the fan-out's INJECTED
// logger (`stubs.collectLogger`), never on the process console — so no test
// here patches a global, and a throwing test leaves nothing to restore.

describe('ViewerEvents', () => {
  test('delivers to every subscriber of that event and to no other', () => {
    const events = new ViewerEvents();
    const modes: string[] = [];
    const scenes: string[] = [];
    events.on('mode', (mode) => modes.push(mode));
    events.on('mode', (mode) => modes.push(`again:${mode}`));
    events.on('scene', (info) => scenes.push(info.sceneId));

    events.emit('mode', 'walk');
    expect(modes).toEqual(['walk', 'again:walk']);
    expect(scenes).toEqual([]);
  });

  test('unsubscribing stops delivery, and stops it only for that subscriber', () => {
    const events = new ViewerEvents();
    const seen: string[] = [];
    const off = events.on('mode', (mode) => seen.push(`a:${mode}`));
    events.on('mode', (mode) => seen.push(`b:${mode}`));
    off();
    events.emit('mode', 'orbit');
    expect(seen).toEqual(['b:orbit']);
  });

  test('a subscriber that throws is reported and skipped; the rest still run', () => {
    const collected = collectLogger();
    const events = new ViewerEvents(collected.log);
    const seen: string[] = [];
    events.on('mode', () => {
      throw new Error('host callback exploded');
    });
    events.on('mode', (mode) => seen.push(mode));

    events.emit('mode', 'tour');
    expect(seen).toEqual(['tour']);
    expect(collected.entries).toHaveLength(1);
    expect(collected.entries[0]?.level).toBe('error');
    expect(collected.entries[0]?.code).toBe('listener-failed');
    expect(collected.entries[0]?.message).toContain('viewer mode listener failed');
  });

  test('a subscriber that unsubscribes itself does not skip the next one', () => {
    const events = new ViewerEvents();
    const seen: string[] = [];
    const off = events.on('mode', (mode) => {
      seen.push(`a:${mode}`);
      off();
    });
    events.on('mode', (mode) => seen.push(`b:${mode}`));
    events.emit('mode', 'walk');
    expect(seen).toEqual(['a:walk', 'b:walk']);
  });

  test('a subscriber that unsubscribes ITS NEIGHBOUR still lets it hear this event', () => {
    // The fan-out copies before it walks (`shared/fanout.ts`).
    const events = new ViewerEvents();
    const seen: string[] = [];
    events.on('mode', (mode) => {
      seen.push(`a:${mode}`);
      offB();
    });
    const offB = events.on('mode', (mode) => seen.push(`b:${mode}`));
    events.emit('mode', 'walk');
    events.emit('mode', 'orbit');
    expect(seen).toEqual(['a:walk', 'b:walk', 'a:orbit']);
  });

  test('clear drops every subscriber of every event', () => {
    const events = new ViewerEvents();
    const seen: string[] = [];
    events.on('mode', () => seen.push('mode'));
    events.on('error', () => seen.push('error'));
    events.clear();
    events.emit('mode', 'orbit');
    events.emit('error', { code: 'internal', message: 'x' });
    expect(seen).toEqual([]);
  });
});

describe('toViewerError', () => {
  test('keeps the original message and the original throw', () => {
    const cause = new Error('Scene validation failed: room ghost has no polygon');
    const error = toViewerError('scene-invalid', cause, 'unknown');
    expect(error).toEqual({ code: 'scene-invalid', message: cause.message, cause });
  });

  test('falls back to the given message only for a throw that is not an Error', () => {
    expect(toViewerError('internal', 'a string', 'unknown scene error').message).toBe('unknown scene error');
  });

  test('carries the path and the detail of a coded throw', () => {
    const cause = new SceneValidationError('wall-thickness-range', 'Scene validation failed: too thick', {
      path: 'walls[2].thickness',
      detail: { thickness: 0.9 },
    });
    const error = toViewerError('scene-invalid', cause, 'unknown');
    expect(error.path).toBe('walls[2].thickness');
    expect(error.detail).toEqual({ thickness: 0.9 });
  });
});

describe('the edit event', () => {
  test('a subscriber gets the ops and the revision they were computed against', () => {
    const events = new ViewerEvents();
    const seen: ViewerEditRequest[] = [];
    events.on('edit', (edit) => seen.push(edit));
    const edit: ViewerEditRequest = { ops: [{ op: 'set_material', target: ROOM, material: FINISH.oak }], baseRev: 3 };
    events.emit('edit', edit);
    expect(seen).toEqual([edit]);
  });

  test('`clear()` takes the edit subscribers with everything else', () => {
    const events = new ViewerEvents();
    const seen: ViewerEditRequest[] = [];
    events.on('edit', (edit) => seen.push(edit));
    events.clear();
    events.emit('edit', { ops: [], baseRev: 0 });
    expect(seen).toEqual([]);
  });

  test('a throwing subscriber is reported as `listener-failed` and the others still hear it', () => {
    const log = collectLogger();
    const events = new ViewerEvents(log.log);
    const seen: number[] = [];
    events.on('edit', () => {
      throw new Error('host blew up');
    });
    events.on('edit', (edit) => seen.push(edit.baseRev));
    events.emit('edit', { ops: [], baseRev: 9 });
    expect(seen).toEqual([9]);
    expect(log.codes()).toEqual(['listener-failed']);
  });
});

describe('sceneErrorCode', () => {
  test('reads the code off the error rather than sniffing its message', () => {
    expect(sceneErrorCode(new SceneValidationError('scene-not-object', 'nope'))).toBe('scene-invalid');
    expect(sceneErrorCode(new ViewerLibError('no-scene-source', 'viewer: no scene source'))).toBe('no-scene-source');
    expect(sceneErrorCode(new ViewerLibError('scene-load', 'Scene fetch failed: 404 /x.json'))).toBe('scene-load');
  });

  test("a host repository's own throw is a source failure", () => {
    // The old sniff matched on `Scene validation failed`, so a host error that
    // happened to start that way was reported as an invalid DOCUMENT.
    expect(sceneErrorCode(new Error('Scene validation failed: my own backend said so'))).toBe('scene-load');
    expect(sceneErrorCode('a string')).toBe('scene-load');
  });
});
