/**
 * What the asset move tool hands its host: an edit to commit, or the reason
 * a gesture was refused. Types only, apart from the tool so the public event
 * map (`app/viewer-events.ts`) reads them without the tool's code.
 */

import type { LayoutIssue } from '../layout/layout-issue.js';
import type { SceneOp } from '../scene/types.js';

/** What the tool hands the host to commit. */
export type AssetEdit = {
  readonly assetId: string;
  /**
   * `move_object` (position and room) and `rotate_object` when the yaw
   * changed, for the dragged object and then for each carried one.
   */
  readonly ops: readonly SceneOp[];
  /** The revision the move started from. */
  readonly baseRev: number;
  readonly summary: string;
  /**
   * What the person did: `move` (a pointer drag, or a key burst with an arrow
   * in it — a turn during it included), `turn` (Q/E at rest or `turnAsset`,
   * even when the turn had to settle the object a little), `mirror`
   * (`mirrorAsset`). For a host that answers the gestures differently, e.g.
   * an editor host that confirms a move with an Undo toast and a turn or a
   * mirror with nothing but the object itself.
   */
  readonly gesture: 'move' | 'turn' | 'mirror';
  /** The objects standing on the dragged host's top that moved with it; absent when none did. */
  readonly carried?: readonly string[];
};

/** Why a release or a turn was refused: the hard issues of the pose it asked for. */
export type AssetEditRefused = { readonly assetId: string; readonly issues: readonly LayoutIssue[] };
