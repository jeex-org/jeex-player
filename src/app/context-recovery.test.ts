/**
 * What a lost and a restored WebGL context do to the application.
 *
 * The two behaviours that matter are the ones a host can observe: a loss raises
 * a card that KEEPS the canvas (the context is coming back to it) and emits
 * `error { code: 'context-lost' }`, and a restore re-mounts the committed
 * document rather than assuming any GPU resource survived.
 */

import { describe, expect, test } from 'bun:test';
import { contextRecovery } from './context-recovery.js';
import { createMessages } from '../ui/messages.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { SceneMount } from './scene-mount.js';
import type { ViewerError } from './viewer-events.js';

/** The committed document's id; any UUID, since only its presence matters. */
const SCENE_ID = '01a12ffa-e530-7a51-b282-6409e79020f5';

type Shown = { title: string; message: string; retry: boolean; keepCanvas: boolean | undefined };

function harness(options: { committed?: boolean; released?: boolean } = {}) {
  const shown: Shown[] = [];
  const errors: ViewerError[] = [];
  const calls: string[] = [];
  const model = { scene: { id: SCENE_ID } } as SceneModel;
  const mount = {
    model: (options.committed ?? true) ? model : undefined,
    remount: () => calls.push('remount'),
  } as unknown as SceneMount;
  const recovery = contextRecovery({
    ui: () => ({
      showError: (title, message, retry, keepCanvas) => shown.push({ title, message, retry, keepCanvas }),
    }),
    mount: () => mount,
    messages: () => createMessages('en'),
    emitError: (error) => errors.push(error),
    announceReady: () => calls.push('ready'),
    syncMinimap: () => calls.push('minimap'),
    released: () => options.released ?? false,
  });
  return { recovery, shown, errors, calls, model };
}

describe('a lost context', () => {
  test('raises the card, keeps the canvas and offers Retry', () => {
    const { recovery, shown } = harness();
    recovery.onLost();
    expect(shown).toHaveLength(1);
    expect(shown[0]?.retry).toBe(true);
    // The context is coming back to THIS canvas; the flat stand-in would
    // replace it with a 2D one the renderer cannot draw to.
    expect(shown[0]?.keepCanvas).toBe(true);
    expect(shown[0]?.title.length).toBeGreaterThan(0);
  });

  test('emits the public context-lost code with the card copy', () => {
    const { recovery, errors, shown } = harness();
    recovery.onLost();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('context-lost');
    expect(errors[0]?.message).toBe(shown[0]?.message ?? '');
  });

  test('releases nothing: the restore needs the shell and the document', () => {
    const { recovery, calls } = harness();
    recovery.onLost();
    expect(calls).toEqual([]);
  });
});

describe('a restored context', () => {
  test('re-mounts the committed document with its project options and announces ready, which reveals the viewer after the first picture', () => {
    const { recovery, calls } = harness();
    recovery.onRestored();
    expect(calls).toEqual(['remount', 'minimap', 'ready']);
  });

  test('does nothing once the viewer has been released', () => {
    const { recovery, calls } = harness({ released: true });
    recovery.onRestored();
    expect(calls).toEqual([]);
  });

  test('does nothing when no document was ever committed', () => {
    const { recovery, calls } = harness({ committed: false });
    recovery.onRestored();
    expect(calls).toEqual([]);
  });
});
