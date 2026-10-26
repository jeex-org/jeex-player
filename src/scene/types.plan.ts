/**
 * The plan a scene document draws: the centreline graph's nodes and walls, the
 * openings cut into them and the rooms the walls close around, with the closed
 * vocabularies those entities name (`OpeningType`, `WallRole`, `RoomKind`,
 * `RoomPurpose`, ...) and the wall schema's numeric limits.
 *
 * Split out of `types.ts`, which re-exports every name below unchanged, so the
 * document schema stays one table a reader can hold. It belongs to the same
 * `scene/types` layer and imports nothing at all, so `types.ts` reading from
 * it closes no cycle.
 *
 * Types and constants only: no `three`, no DOM.
 */

export type Vec2 = { readonly x: number; readonly z: number };
export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

/** Node of the wall centreline graph. Walls reference nodes by id. */
export type PlanNode = { readonly id: string; readonly p: Vec2 };

/**
 * Circular wall segment. The centreline runs `a -> b` on a circle of `radius`
 * (the minor arc). `ccw` selects the side of the bulge: `true` bulges to the
 * LEFT of `a -> b`, `false` to the right. See `plan-geometry.arcFromChord`.
 */
export type WallArc = { readonly radius: number; readonly ccw: boolean };

/**
 * Kind of a wall opening. `passage` is a doorway without a leaf: it is cut and
 * validated exactly like a door (floor to head, skirting broken, walkable) but
 * the builder fills it with a frame only, so no width heuristic (such as
 * "a door wider than 1.7 m has no leaf") decides whether a door has a leaf.
 */
export type OpeningType = 'door' | 'window' | 'passage';

/** Head shape of an opening. Omitted on the document means `'flat'`. */
export type OpeningShape = 'flat' | 'arch';

/** Jamb a door leaf hangs on, named by the wall node it is nearer to. */
export type OpeningHinge = 'a' | 'b';

/** Side a door leaf swings towards: `'in'` is the wall's interior side. */
export type OpeningSwing = 'in' | 'out';

/** Structural hint on a wall. Omitted on the document means `'partition'`. */
export type WallRole = 'bearing' | 'partition' | 'facade';

/** Kind of a room. Omitted on the document means `'room'`; a loggia has no ceiling. */
export type RoomKind = 'room' | 'loggia';

/** What a room is for, from a closed vocabulary (schema 2.4): words, not locale text, independent of `kind`. */
export type RoomPurpose =
  | 'living'
  | 'kitchen'
  | 'kitchen-living'
  | 'dining'
  | 'bedroom'
  | 'kids'
  | 'study'
  | 'bathroom'
  | 'wc'
  | 'hall'
  | 'corridor'
  | 'storage'
  | 'utility'
  | 'balcony';

/** True for the opening kinds that reach the floor and can be walked through. */
export function isDoorLike(type: OpeningType): boolean {
  return type === 'door' || type === 'passage';
}

export type Opening = {
  readonly id: string;
  readonly type: OpeningType;
  /** Distance along the centreline from node `a` (arc length for arcs). */
  readonly center: number;
  readonly width: number;
  readonly sill?: number | undefined;
  readonly head?: number | undefined;
  /** Head shape; defaults to 'flat'. 'arch' is a semicircular lintel. */
  readonly shape?: OpeningShape;
  /** `OpeningVariant.id` from `opening-variants.ts`; omitted means the type's default look. */
  readonly variant?: string;
  /**
   * Jamb the door leaf is hinged on, named by the wall node it is nearer to:
   * `'a'` is the jamb at `center - width / 2`, `'b'` the one at
   * `center + width / 2`. Omitted means "let `door-swing.ts` pick the jamb
   * farther from the wall end", which is the jamb farther from the
   * perpendicular wall that meets it there.
   */
  readonly hinge?: OpeningHinge;
  /**
   * Side the leaf swings towards. `'in'` is the wall's INTERIOR side — the
   * side the solved plan gives a room to, and the left of `a -> b` when both
   * sides are rooms (`door-swing.interiorSideOf`). `'out'` is the other side.
   * Omitted means "into the room with the free run" (`door-swing.ts`).
   */
  readonly swing?: OpeningSwing | undefined;
  /**
   * Marks the front door of the apartment. Drives the entrance variant set and
   * the UI label; the entrance is authored, never guessed from opening ids.
   */
  readonly entrance?: boolean;
};

/**
 * Numeric limits of the wall schema, in metres. They were private to
 * `validate/walls.ts`; an importer has to CLAMP to them before it builds a
 * document, so they belong to the schema rather than to the gate that checks
 * it. `minCentrelineLength` is measured along the true centreline — arc length
 * for a curved wall, not the chord.
 */
export const WALL_LIMITS = {
  minThickness: 0.05,
  maxThickness: 0.6,
  minCentrelineLength: 0.5,
} as const satisfies { readonly minThickness: number; readonly maxThickness: number; readonly minCentrelineLength: number };

export type Wall = {
  readonly id: string;
  /** PlanNode.id of the start node. */
  readonly a: string;
  /** PlanNode.id of the end node. */
  readonly b: string;
  /** Full thickness, symmetric about the centreline. */
  readonly thickness: number;
  readonly arc?: WallArc;
  /** Hint for UI and validation; does not affect geometry. */
  readonly role?: WallRole;
  readonly openings?: readonly Opening[];
};

export type Room = {
  readonly id: string;
  readonly name: string;
  /** Point strictly inside the room; picks the graph face that is this room. */
  readonly anchor: Vec2;
  readonly floorMaterial: string;
  readonly accent?: string;
  /** 'loggia' rooms get no ceiling. */
  readonly kind?: RoomKind;
  /** What the room is for (`RoomPurpose`, schema 2.4); absent means not declared, independent of `kind`. */
  readonly purpose?: RoomPurpose;
  /**
   * The outline the room's SOURCE supplied, for a room the wall graph does not
   * close around (optional).
   *
   * A room normally has no outline of its own: it names an `anchor`, and the
   * face of the wall graph containing that anchor IS the room. A scan or a CAD
   * export that measured a room but left its wall ring open has no such face,
   * and the choice is between losing the room and trusting what the source
   * itself measured. A room carrying this field is the second case: it claims
   * NO graph face (the solver leaves the faces to the rooms that do have one)
   * and is solved from this polygon instead. Authored documents leave it out.
   */
  readonly polygon?: readonly Vec2[];
};
