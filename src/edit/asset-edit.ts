/**
 * What the asset move tool hands its host: an edit to commit, or the reason
 * a gesture was refused, and the state the debug surface reports. Types only,
 * apart from the tool so the public event map (`app/viewer-events.ts`) and the
 * eager debug surface read them without the tool's code, which loads lazily.
 */

import type { LayoutIssue } from '../layout/layout-issue.js';
import type { SceneOp } from '../scene/types.js';
import type { DragPose } from '../layout/asset-legality.js';
import type { MaskSurface } from '../layout/asset-mask.js';

/** What the tool hands the host to commit. */
export type AssetEdit = {
  readonly assetId: string;
  /**
   * `move_object` (position and room) and `rotate_object` when the yaw
   * changed, for the dragged object and then for each carried one.
   */
  readonly ops: readonly SceneOp[];
  /**
   * The revision the move started from. It counts from the `revision` the
   * host loaded the document with, so a host passes the document's stored
   * revision to `loadScene` (or the scene source); without one the viewer
   * counts from 0.
   */
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

/** The tool's state as `__viewerDebug.assetMove()` reports it. */
export type AssetMoveState = {
  readonly phase: 'idle' | 'pressed' | 'dragging' | 'nudging';
  readonly assetId: string | null;
  readonly surface: MaskSurface | null;
  /** The pose drawn: the settled one, else the pointer's. */
  readonly pose: DragPose | null;
  /** Whether a release would commit (a settled pose exists); `null` when nothing moves. */
  readonly legal: boolean | null;
  /** Cells of the legality field on screen. */
  readonly maskCells: number;
  /** An emitted edit the host may still refuse (`revertAssetEdit`). */
  readonly pending: string | null;
};

/** `__viewerDebug.assetMove()`: the switch, whether the tool is built, and its state. */
export type AssetMoveDebug = { readonly enabled: boolean; readonly loaded: boolean; readonly state: AssetMoveState | null };
