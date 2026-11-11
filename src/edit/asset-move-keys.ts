/**
 * The keyboard half of the asset move tool (`asset-move-tool.ts`): the arrow
 * nudges, the Q/E turns, and the key burst they make together.
 *
 * Arrows move the selected object `NUDGE_M` (Shift: `NUDGE_FAR_M`) in the
 * view's own directions: forward and right on the floor, or up, down and
 * along its face for a wall object. Q/E turn it `TURN_STEP_DEG` about its
 * pivot, during a drag (the request's yaw) or at rest (judged at once, refused
 * with the object as it was). A burst of keys is ONE edit: the tool's idle
 * commit ends it through `finishNudge`.
 *
 * Invariant: this module keeps no drag state of its own. It reads and writes
 * the tool's running drag through the narrow view below and judges every pose
 * through the tool's own `propose`/`apply`, so a key and a pointer move are
 * the same gesture to everything downstream.
 */

import { proposePose, type PoseRequest, type Proposal } from '../layout/asset-pose.js';
import { wallAlong, type DragContext, type DragPose } from '../layout/asset-legality.js';
import type { MaskSurface } from '../layout/asset-mask.js';
import type { WallFace } from '../plan/plan-solver.js';
import type { AssetEditRefused } from './asset-edit.js';
import { wrapAngle } from './drag-kit.js';

/** Arrow nudge, metres; Shift nudges `NUDGE_FAR_M`. */
const NUDGE_M = 0.05;
const NUDGE_FAR_M = 0.5;
/** One Q/E turn, degrees; Shift does not change it. */
export const TURN_STEP_DEG = 15;
export const TURN_STEP_RAD = (TURN_STEP_DEG / 180) * Math.PI;

/** Q turns left (counter-clockwise from above), E right. */
const TURN_KEYS: Readonly<Record<string, number>> = { q: 1, e: -1 };

/** What the keys read and write of a running drag. */
export type KeyDrag = {
  readonly assetId: string;
  readonly drag: DragContext;
  readonly surface: MaskSurface;
  /** What the keys ask for; a nudge or a turn replaces it. */
  request: PoseRequest;
  /** An arrow key moved it (a key burst that is a move, not only a turn). */
  nudged: boolean;
};

/** What the keys need of the tool: its host's reads and sinks, and its own drag primitives. */
export type AssetMoveKeysView<D extends KeyDrag> = {
  active(): boolean;
  selected(): string | null;
  /** The view's yaw on the floor: «forward» for an arrow. */
  viewYaw(): number;
  onRefused(refusal: AssetEditRefused): void;
  onMoving(moving: boolean): void;
  /** The pointer drag running now, and the key burst. */
  moving(): D | null;
  nudging(): D | null;
  setNudging(drag: D | null): void;
  /** Escape: the running move goes back. */
  cancel(): boolean;
  /** One more key of the burst: its idle commit starts over. */
  touchBurst(): void;
  /** A drag of `assetId` from where it stands, `null` when it cannot move. */
  prepare(assetId: string): D | null;
  /** The pose on screen. */
  pose(drag: D): DragPose;
  propose(drag: D, request: PoseRequest): void;
  apply(drag: D, proposal: Proposal): void;
  /** A wall object's height, kept where it fits under the ceiling. */
  clampHeight(drag: D, y: number): number;
  /** A drag or a burst ended: commit or refuse. */
  release(drag: D): void;
};

export class AssetMoveKeys<D extends KeyDrag> {
  private readonly view: AssetMoveKeysView<D>;

  constructor(view: AssetMoveKeysView<D>) {
    this.view = view;
  }

  /** One key press; `true` when the tool used it. */
  key(key: string, shiftKey: boolean): boolean {
    const { view } = this;
    const name = key.toLowerCase();
    if (name === 'escape') return view.cancel();
    if (!view.active()) return false;
    const turn = TURN_KEYS[name] ?? 0;
    const step = shiftKey ? NUDGE_FAR_M : NUDGE_M;
    const arrows: Record<string, [number, number]> = {
      arrowup: [step, 0],
      arrowdown: [-step, 0],
      arrowleft: [0, -step],
      arrowright: [0, step],
    };
    const arrow = arrows[name];
    if (turn === 0 && !arrow) return false;
    const moving = view.moving();
    if (moving) {
      if (turn !== 0) this.turnDrag(moving, turn);
      return true;
    }
    const drag = view.nudging() ?? this.startNudge();
    if (!drag) return false;
    if (arrow) this.nudge(drag, arrow[0], arrow[1]);
    else this.turnAtRest(drag, turn);
    view.touchBurst();
    return true;
  }

  /** The proposal for the object turned `steps` from where it stands now, at rest; `null` for a wall object. */
  turned(drag: D, steps: number): Proposal | null {
    if (drag.surface === 'wall') return null;
    const pose = this.view.pose(drag);
    const rotationY = wrapAngle(pose.rotationY + steps * TURN_STEP_RAD);
    // The turn is the person's yaw: no wall snap turns it back.
    return proposePose(drag.drag, {
      kind: 'plan',
      point: { x: pose.position.x, z: pose.position.z },
      rotationY,
      y: pose.position.y,
      snap: false,
    });
  }

  /** The burst went idle: it ends as one edit or one refusal. */
  finishNudge(): void {
    const drag = this.view.nudging();
    this.view.setNudging(null);
    if (drag) this.view.release(drag);
  }

  /** Q/E during a drag: the request's yaw turns, the pointer pose and the field follow. */
  private turnDrag(drag: D, steps: number): void {
    if (drag.request.kind === 'face') return;
    this.view.propose(drag, { ...drag.request, rotationY: wrapAngle(drag.request.rotationY + steps * TURN_STEP_RAD), snap: false });
  }

  /** Q/E at rest: turned and settled, or refused with the object as it was. */
  private turnAtRest(drag: D, steps: number): void {
    const proposal = this.turned(drag, steps);
    if (!proposal) return;
    if (!proposal.settled) {
      this.view.onRefused({ assetId: drag.assetId, issues: proposal.judgement.issues });
      return;
    }
    const pose = proposal.settled.pose;
    drag.request = {
      kind: 'plan',
      point: { x: pose.position.x, z: pose.position.z },
      rotationY: pose.rotationY,
      y: pose.position.y,
      snap: false,
    };
    this.view.apply(drag, proposal);
  }

  private nudge(drag: D, forward: number, right: number): void {
    const { view } = this;
    drag.nudged = true;
    const request = drag.request;
    if (request.kind === 'face') {
      // Up and down lift the object; left and right slide it along its face.
      if (forward !== 0) {
        view.propose(drag, { ...request, y: view.clampHeight(drag, request.y + forward) });
        return;
      }
      // «Right» on screen is along the face when the viewer looks at it; the face's own direction decides the sign.
      const along = this.alongSign(request.face);
      // Kept where the object can stand (its width on the face), so a nudge
      // back from a corner moves at once instead of unwinding presses past it.
      view.propose(drag, { ...request, t: wallAlong(drag.drag, request.face, request.t + along * right) });
      return;
    }
    const yaw = view.viewYaw();
    const ahead = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const side = { x: -ahead.z, z: ahead.x };
    const point = { x: request.point.x + ahead.x * forward + side.x * right, z: request.point.z + ahead.z * forward + side.z * right };
    view.propose(drag, { ...request, point, snap: true });
  }

  /** `+1` when the face runs to the viewer's right, `-1` when to the left. */
  private alongSign(face: WallFace): number {
    const a = face.polyline[0];
    const b = face.polyline.at(-1);
    if (!a || !b) return 1;
    const yaw = this.view.viewYaw();
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    return (b.x - a.x) * right.x + (b.z - a.z) * right.z >= 0 ? 1 : -1;
  }

  private startNudge(): D | null {
    const selected = this.view.selected();
    if (selected === null) return null;
    const drag = this.view.prepare(selected);
    if (!drag) return null;
    this.view.setNudging(drag);
    this.view.onMoving(true);
    return drag;
  }
}
