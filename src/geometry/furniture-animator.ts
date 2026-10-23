/**
 * Every movement a furniture group makes that is not the camera's doing: the
 * staggered show/hide ripple of the furniture toggle and the pop-out / pop-in
 * swap of a variant replacement.
 *
 * Invariant: the animator owns the `position.y` and `scale` of a registered
 * group for the length of an animation and always returns it to the base pose
 * it was registered with, so a swap and a toggle can never leave an object
 * half-scaled. It never touches materials, so the selection aura
 * (`GLOW_GROUP_NAME`) is unaffected.
 *
 * Clock invariant: the animator owns NO timer. Every animation, swaps
 * included, advances in `update()`, which the composition root calls once per
 * frame from a `RenderRuntime` hook. That is what makes a swap cancellable:
 * `attach` (a rebuild) and `dispose` settle every job in flight instead of
 * leaving a `requestAnimationFrame` chain mutating a detached group.
 */

import * as THREE from 'three';
import { easeOutBack } from '../shared/easing.js';

/** Pop-out / pop-in of a variant swap, milliseconds. */
const SWAP_DURATION_MS = 320;
/** Fraction of the swap spent removing the old group. */
const SWAP_OUT_SHARE = 0.3;
/** How far an item dips below its base while it is small, metres. */
const SWAP_DIP_M = 0.16;
const TOGGLE_DIP_M = 0.22;
/** Hop height at the peak of a pop-in, metres. */
const HOP_M = 0.08;

type BasePose = { baseY: number; baseScale: number; progress: number };

type ToggleItem = {
  group: THREE.Group;
  baseY: number;
  baseScale: number;
  from: number;
  to: number;
  delay: number;
  duration: number;
};

type Toggle = { start: number; hide: boolean; items: ToggleItem[] };

/** One variant replacement in flight. */
type SwapJob = {
  oldGroup: THREE.Group;
  newGroup: THREE.Group;
  baseScale: number;
  baseY: number;
  oldBaseScale: number;
  oldBaseY: number;
  start: number;
  /** True once the outgoing group has left the scene graph. */
  removed: boolean;
  onDone: () => void;
};

export class FurnitureAnimator {
  private readonly items = new Map<THREE.Group, BasePose>();
  private toggle: Toggle | null = null;
  private group: THREE.Group | null = null;
  private readonly swaps: SwapJob[] = [];
  /** Groups whose pose an animation wrote since the last `takeMoved`. */
  private readonly touched = new Set<THREE.Group>();

  /** Whether a show/hide ripple or a swap is still in flight, delays included. */
  get busy(): boolean {
    return this.toggle !== null || this.swaps.length > 0;
  }

  /**
   * The groups an animation moved, scaled, removed or settled since the last
   * call, final frames included; the sun's cached shadow follows them
   * (`render/sun-shadow.ts`).
   */
  takeMoved(): THREE.Group[] {
    const groups = [...this.touched];
    this.touched.clear();
    return groups;
  }

  /** Adopts every direct child group of the furniture container at its current pose. */
  attach(container: THREE.Group | null): void {
    // A rebuild replaces the whole furniture group: any swap still running
    // would animate objects that are no longer in the scene.
    this.settleSwaps();
    // The settled groups belong to the root being replaced: nobody downstream may measure them.
    this.touched.clear();
    this.items.clear();
    this.toggle = null;
    this.group = container;
    if (!container) return;
    for (const child of container.children) {
      if (child instanceof THREE.Group) this.register(child);
    }
  }

  /** Remembers a group's resting pose; a replacement re-registers under the same key. */
  register(group: THREE.Group): void {
    this.items.set(group, { baseY: group.position.y, baseScale: group.scale.x, progress: 1 });
  }

  /**
   * Moves a group that keeps its body (a committed move, turn or mirror):
   * a swap still running on it settles first, so it cannot write its old
   * height back afterwards, then `move` stands the group anew and its new
   * resting pose is remembered with the show/hide progress it had. A
   * show/hide ripple still running on it takes the new pose too, or it would
   * end the ripple at the old height and scale. `false` when `move` declined;
   * nothing is remembered then.
   */
  moved(group: THREE.Group, move: () => boolean): boolean {
    this.settleSwapsOf(group);
    if (!move()) return false;
    const baseY = group.position.y;
    const baseScale = group.scale.x;
    const progress = this.items.get(group)?.progress ?? 1;
    this.items.set(group, { baseY, baseScale, progress });
    for (const item of this.toggle?.items ?? []) {
      if (item.group !== group) continue;
      item.baseY = baseY;
      item.baseScale = baseScale;
    }
    return true;
  }

  /** A group leaving for good (its placement was removed): a swap still running on it ends first. */
  removed(group: THREE.Group): void {
    this.settleSwapsOf(group);
    this.forget(group);
  }

  forget(group: THREE.Group): void {
    this.items.delete(group);
  }

  /**
   * Shows or hides all furniture with a staggered ripple. A random scatter
   * across the plan looks more organic than an ordered sweep; hiding runs
   * roughly twice as fast as showing.
   */
  setVisible(visible: boolean): void {
    const container = this.group;
    if (!container) return;
    if (visible) container.visible = true;
    const hide = !visible;
    const duration = hide ? 190 : 240;
    const staggerWindow = hide ? 450 : 760;
    const items: ToggleItem[] = [];
    for (const [group, base] of this.items) {
      items.push({
        group,
        baseY: base.baseY,
        baseScale: base.baseScale,
        from: base.progress,
        to: visible ? 1 : 0,
        delay: Math.random() * staggerWindow,
        duration,
      });
    }
    this.toggle = { start: performance.now(), hide, items };
  }

  /**
   * Advances every animation in flight; call once per frame.
   *
   * `now` is injectable so a unit test can drive the clock; production passes
   * the frame timestamp from `RenderRuntime`.
   */
  update(now: number = performance.now()): void {
    this.updateSwaps(now);
    this.updateToggle(now);
  }

  /** Settles every swap in flight at its resting pose and forgets it. */
  dispose(): void {
    this.settleSwaps();
    this.items.clear();
    this.touched.clear();
    this.toggle = null;
    this.group = null;
  }

  private updateToggle(now: number): void {
    const anim = this.toggle;
    const container = this.group;
    if (!anim || !container) return;
    let finished = true;
    for (const item of anim.items) {
      const t = (now - anim.start - item.delay) / item.duration;
      if (t < 1) finished = false;
      const clamped = Math.min(1, Math.max(0, t));
      const eased = easeOutBack(clamped);
      const progress = item.from + (item.to - item.from) * (anim.hide ? clamped * clamped * clamped : eased);
      const base = this.items.get(item.group);
      if (base) base.progress = progress;
      const shown = Math.max(0.001, progress);
      const scale = item.baseScale * shown;
      // Pop-in: the item hops slightly above its spot and settles back down.
      const hop = anim.hide ? 0 : Math.sin(clamped * Math.PI) * HOP_M * clamped;
      const y = item.baseY - TOGGLE_DIP_M * (1 - Math.min(1, Math.max(0, eased))) + hop;
      // Only a pose that changed is news: an item waiting out its delay is not.
      if (item.group.scale.x === scale && item.group.position.y === y) continue;
      item.group.scale.setScalar(scale);
      item.group.position.y = y;
      this.touched.add(item.group);
    }
    if (finished) {
      if (anim.hide) {
        container.visible = false;
        // Hiding the container changes what casts even where no pose did.
        for (const item of anim.items) this.touched.add(item.group);
      }
      this.toggle = null;
    }
  }

  /**
   * Swaps one furniture group for another: the old one shrinks into the floor,
   * the new one pops back out with an overshoot. `onDone` fires once the new
   * group is at rest, which is when the selection aura may be re-attached.
   *
   * The new group's pose is read back rather than recomputed: the loader has
   * already mounted and turned it (ceiling fixtures ride the ceiling, legacy
   * types carry a facing compensation).
   */
  swap(oldGroup: THREE.Group, newGroup: THREE.Group, baseScale: number, onDone: () => void, now: number = performance.now()): void {
    // A second swap of the same object supersedes the first: settle it so the
    // outgoing group leaves the scene graph exactly once.
    this.settleSwapsOf(oldGroup);
    this.settleSwapsOf(newGroup);
    const baseY = newGroup.position.y;
    newGroup.scale.setScalar(0.001);
    this.forget(oldGroup);
    this.items.set(newGroup, { baseY, baseScale, progress: 1 });
    this.swaps.push({
      oldGroup,
      newGroup,
      baseScale,
      baseY,
      oldBaseScale: oldGroup.scale.x || baseScale,
      oldBaseY: oldGroup.position.y,
      start: now,
      removed: false,
      onDone,
    });
  }

  private updateSwaps(now: number): void {
    for (let index = this.swaps.length - 1; index >= 0; index -= 1) {
      const job = this.swaps[index]!;
      const t = (now - job.start) / SWAP_DURATION_MS;
      this.touched.add(job.oldGroup).add(job.newGroup);
      if (t < SWAP_OUT_SHARE) {
        const k = Math.min(1, t / SWAP_OUT_SHARE);
        job.oldGroup.scale.setScalar(Math.max(0.001, job.oldBaseScale) * (1 - k));
        job.oldGroup.position.y = job.oldBaseY - SWAP_DIP_M * k;
        continue;
      }
      if (!job.removed) {
        job.oldGroup.removeFromParent();
        job.removed = true;
      }
      const k = Math.min(1, (t - SWAP_OUT_SHARE) / (1 - SWAP_OUT_SHARE));
      const eased = easeOutBack(k);
      job.newGroup.scale.setScalar(Math.max(0.001, job.baseScale * Math.max(0.001, eased)));
      job.newGroup.position.y = job.baseY - SWAP_DIP_M * (1 - Math.min(1, Math.max(0, eased))) + Math.sin(k * Math.PI) * HOP_M * k;
      if (t < 1) continue;
      this.swaps.splice(index, 1);
      job.newGroup.scale.setScalar(job.baseScale);
      job.newGroup.position.y = job.baseY;
      job.onDone();
    }
  }

  /** Ends every swap immediately at its resting pose. */
  private settleSwaps(): void {
    while (this.swaps.length > 0) this.settle(this.swaps.pop()!);
  }

  /** Ends the swaps that involve `group`, whichever side of them it is on. */
  private settleSwapsOf(group: THREE.Group): void {
    for (let index = this.swaps.length - 1; index >= 0; index -= 1) {
      const job = this.swaps[index]!;
      if (job.oldGroup !== group && job.newGroup !== group) continue;
      this.swaps.splice(index, 1);
      this.settle(job);
    }
  }

  private settle(job: SwapJob): void {
    this.touched.add(job.oldGroup).add(job.newGroup);
    if (!job.removed) {
      job.oldGroup.removeFromParent();
      job.removed = true;
    }
    job.newGroup.scale.setScalar(job.baseScale);
    job.newGroup.position.y = job.baseY;
    job.onDone();
  }
}
