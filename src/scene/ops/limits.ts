/**
 * The numeric limits the operation vocabulary clamps or refuses against, named
 * once.
 *
 * They live apart from the appliers because the SAME number is read by more
 * than one of them — a wall thickness by `add_wall` and `set_wall`, a tour
 * speed by `set_autotour` and the player — and because a limit written into
 * the middle of a function is a number nobody can find when the rule changes.
 * Every entry names the rule it encodes.
 *
 * Where the document schema already declares a limit (`scene/types.WALL_LIMITS`)
 * this module READS it rather than repeating it: an op that clamped to one
 * number while the validator refused at another would produce a batch that
 * applies and then fails to commit.
 *
 * Pure module: no `three`, no DOM.
 */

import { WALL_LIMITS } from '../types.js';

/** Ceiling height of `set_ceiling`, metres. */
export const MIN_CEILING_HEIGHT = 2.2;
export const MAX_CEILING_HEIGHT = 4.5;

/**
 * Shortest wall `move_node` may leave behind, metres.
 *
 * A RE-EXPORT of the document schema's own minimum, not a second number: an
 * earlier 0.3 m here, while `validateScene` refused anything below
 * `WALL_LIMITS.minCentrelineLength` (0.5 m), meant a wall between the two
 * applied and then lost its whole batch at commit. The minimum wall length
 * after a shift equals the schema's `WALL_LIMITS.minCentrelineLength`, this
 * module only re-exports it, and the name is kept so the appliers read a
 * limit, not a schema field.
 */
export const MIN_WALL_LENGTH = WALL_LIMITS.minCentrelineLength;

/**
 * Shortest half `split_wall` may cut off a wall, metres.
 *
 * A smaller `MIN_HALF = 0.1` m cannot stand: a half below
 * `WALL_LIMITS.minCentrelineLength` (0.5 m) is refused by `validateScene` at
 * commit, so a split at 0.3 m would apply and then lose its whole batch —
 * the same disagreement `MIN_WALL_LENGTH` above records for `move_node`,
 * resolved the same way: the operative floor is the schema's own minimum, and
 * the name stays so the applier reads a limit, not a schema field.
 */
export const MIN_SPLIT_HALF = WALL_LIMITS.minCentrelineLength;

/** `thickness` clamp of `add_wall` and `set_wall`, metres — the schema's own range. */
export const WALL_THICKNESS: readonly [number, number] = [WALL_LIMITS.minThickness, WALL_LIMITS.maxThickness];

/** Longest room name `add_room` and `set_room` accept, characters. */
export const ROOM_NAME_MAX = 60;

/** `scale` clamp of `set_object`, as a multiple of the archetype size. */
export const OBJECT_SCALE: readonly [number, number] = [0.5, 2];

/** `speed` clamp of `set_autotour`, metres per second. */
export const TOUR_SPEED: readonly [number, number] = [0.3, 3];

/**
 * The tour checkpoint's own limits, RE-EXPORTS of the document schema's
 * constants (`types.ts`, beside `TourCheckpoint`) rather than second numbers:
 * the op clamps to them, the validator refuses beyond them, and the placement
 * gizmo reads the same two ends (`camera/checkpoint-overlay.ts`).
 */
export { TOUR_PITCH_LIMIT_RAD, TOUR_CHECKPOINT_HEIGHT_MIN_M, TOUR_CHECKPOINT_HEIGHT_MARGIN_M, TOUR_CHECKPOINT_NAME_MAX } from '../types.js';
