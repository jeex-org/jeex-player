/**
 * What a lost and a restored WebGL context MEAN for the application.
 *
 * `RenderRuntime` hears the two canvas events, stops and resumes its loop and
 * reports; this is the other half — the card the user sees, the public `error`
 * code, and the rebuild. It is a policy, not wiring, and it is separate from the
 * composition root because it is the one part of a viewer's lifecycle that runs
 * on nobody's call: the browser decides when.
 *
 * Recovery invariant: the instance is NOT disposed in between. The restore
 * needs the shell, the options and the committed document to still be there, so
 * a lost context raises a card over a live viewer and nothing is released. Every
 * GPU resource went with the context, though, so the restore re-mounts the
 * committed `SceneModel` from scratch, with everything it was mounted with
 * (`SceneMount.remount`) — which is also what re-seeds the stage, the doors
 * and the debug API (`SceneMount.mount` → `onDocument`).
 */

import type { Messages } from '../ui/messages.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { SceneMount } from './scene-mount.js';
import type { ViewerError } from './viewer-events.js';

/** The part of `ViewerUI` the error card is raised through; the reveal waits for the first picture (`announceReady`). */
type RecoveryUI = {
  showError: (title: string, message: string, retry: boolean, keepCanvas?: boolean) => void;
};

type ContextRecoveryDeps = {
  /** Read lazily: the composition root wires this before `SceneMount` exists. */
  ui: () => RecoveryUI;
  mount: () => SceneMount;
  messages: () => Messages;
  emitError: (error: ViewerError) => void;
  /** `ready` for the re-mounted document, after the first frame that shows it. */
  announceReady: (model: SceneModel) => void;
  /** Re-seeds the mini-map, which is written from a frame hook and has none yet. */
  syncMinimap: () => void;
  /** True once the viewer has been released; a restore then has nothing to do. */
  released: () => boolean;
};

/** The two callbacks `RenderRuntime` reports the context through. */
export function contextRecovery(deps: ContextRecoveryDeps): { onLost: () => void; onRestored: () => void } {
  return {
    onLost: () => {
      const ui = deps.ui();
      const messages = deps.messages();
      const message = messages.t('error.contextLostBody');
      // `keepCanvas`: the context is expected back on this very canvas, and the
      // flat stand-in would replace it with a 2D one the renderer cannot draw
      // to (`webgl-fallback.ts`).
      ui.showError(messages.t('error.contextLostTitle'), message, true, true);
      deps.emitError({ code: 'context-lost', message });
    },
    onRestored: () => {
      const mount = deps.mount();
      const model = mount.model;
      if (deps.released() || !model) return;
      // With the document's own options, variants and library key: a bare
      // `mount(model)` here once dropped a project's resolver, materials and
      // catalogue and drew it from the shipped bank.
      mount.remount();
      deps.syncMinimap();
      deps.announceReady(model);
    },
  };
}
