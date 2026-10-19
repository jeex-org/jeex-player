/**
 * Mirroring a placement: the axis vocabulary, the one canonical form of a
 * mirror state, what an asset's facts allow, and `frontOf` — the ONE reader of
 * the `z` axis, because a `z` mirror turns the object's front round and every
 * rule that asks where the front is must get the same answer.
 *
 * Footprints do not read the mirror: they are symmetric about the body centre,
 * which is the point the mirror is applied about.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Mirror, MirrorAxis, MirrorFacts, Vec2 } from './types.js';

/** The axes, in the order every list of them is written. */
export const MIRROR_AXES = ['x', 'y', 'z'] as const satisfies readonly MirrorAxis[];

/** Whether a value names a mirror axis. */
export function isMirrorAxis(value: unknown): value is MirrorAxis {
  return value === 'x' || value === 'y' || value === 'z';
}

/**
 * Whether a value is a well-formed mirror state: an object whose keys are
 * axes and whose values are `true` (`{}` is none). The one shape check the
 * document validator and `mirror_object` share; the zod twin says the same.
 */
export function isMirrorState(value: unknown): value is Mirror {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(([axis, flag]) => isMirrorAxis(axis) && flag === true)
  );
}

/** The axes a mirror state reflects, in `MIRROR_AXES` order. */
export function mirroredAxes(mirror: Mirror | undefined): MirrorAxis[] {
  return MIRROR_AXES.filter((axis) => mirror?.[axis] === true);
}

/** The canonical mirror state for a set of axes: `{}` for none, never a `false` key. */
export function mirrorOf(axes: Iterable<MirrorAxis>): Mirror {
  const set = new Set(axes);
  const out: { x?: true; y?: true; z?: true } = {};
  for (const axis of MIRROR_AXES) if (set.has(axis)) out[axis] = true;
  return out;
}

/** The state with `axis` flipped. */
export function toggleMirror(mirror: Mirror | undefined, axis: MirrorAxis): Mirror {
  const axes = new Set(mirroredAxes(mirror));
  if (axes.has(axis)) axes.delete(axis);
  else axes.add(axis);
  return mirrorOf(axes);
}

/** Whether two states reflect the same axes (absent and `{}` are equal). */
export function sameMirror(a: Mirror | undefined, b: Mirror | undefined): boolean {
  return MIRROR_AXES.every((axis) => (a?.[axis] === true) === (b?.[axis] === true));
}

/** The axes an asset's facts allow; none when the facts are absent. */
export function allowedMirrorAxes(facts: MirrorFacts | undefined): MirrorAxis[] {
  return MIRROR_AXES.filter((axis) => facts?.[axis] === true);
}

/** The axes a state sets that the facts do not allow; empty when the state is acceptable. */
export function disallowedMirrorAxes(mirror: Mirror | undefined, facts: MirrorFacts | undefined): MirrorAxis[] {
  return mirroredAxes(mirror).filter((axis) => facts?.[axis] !== true);
}

/**
 * The yaw the object's front looks along: `facing` (the placement's yaw plus
 * the builder's legacy compensation), turned half round by a `z` mirror.
 */
export function frontYaw(facing: number, mirror: Mirror | undefined): number {
  return mirror?.z === true ? facing + Math.PI : facing;
}

/**
 * The object's front as a plan direction. The scene contract is «front faces
 * −Z at rotationY = 0», so a yaw `θ` faces `(−sin θ, −cos θ)`; a `z` mirror
 * faces the other way (this moves the clearance in front, `wall-facing` and
 * the wall snap's back).
 */
export function frontOf(facing: number, mirror: Mirror | undefined): Vec2 {
  const yaw = frontYaw(facing, mirror);
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** A side of an object in its own frame (`kneeSpace.sides`). */
export type ObjectSide = 'front' | 'back' | 'left' | 'right';

/**
 * Where an authored side of the object lies once it is mirrored: an `x`
 * mirror swaps left and right, a `z` mirror swaps front and back, a
 * `y` mirror moves no side.
 */
export function mirroredSide(side: ObjectSide, mirror: Mirror | undefined): ObjectSide {
  if (mirror?.x === true && (side === 'left' || side === 'right')) return side === 'left' ? 'right' : 'left';
  if (mirror?.z === true && (side === 'front' || side === 'back')) return side === 'front' ? 'back' : 'front';
  return side;
}
