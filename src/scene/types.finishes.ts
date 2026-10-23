/**
 * What a scene document paints, and with what: the face a finish stands on
 * (`FaceKey`), the finish value itself (`FinishRef`) and the painted state of
 * the shell (`SceneFinishes`), plus the colour grammar a finish value uses.
 *
 * Split out of `types.ts`, which re-exports every name below unchanged, so the
 * document schema stays one table a reader can hold. It belongs to the same
 * `scene/types` layer and imports nothing at all, so `types.ts` reading from
 * it closes no cycle.
 *
 * Types and constants only: no `three`, no DOM.
 */

// ---------------------------------------------------------------- colours --

/**
 * An sRGB colour as `#rrggbb`, either case: the one hex grammar of a finish
 * value's `colour` and of every colour a project manifest's library material
 * carries, read by the scene schema, the runtime validator and the manifest
 * schema alike.
 */
export const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** True when `value` is a `#rrggbb` colour (`HEX_COLOUR_PATTERN`). */
export function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOUR_PATTERN.test(value);
}

// -------------------------------------------------------------- face keys --

/** Which side of its wall a face is on: `'L'` is the left of `a -> b`. */
export type WallSide = 'L' | 'R';

/**
 * One paintable wall face: the side of a wall as seen from the room that owns
 * it. `room` is omitted for the facade, the outside face no room owns.
 *
 * A face is DERIVED, not an entity: it has no id of its own, only the UUIDs of
 * the things it is made of plus a side. So it travels as this structure on
 * every surface — a document's `finishes.faces`, a `set_material` target, a
 * `select` event, an export — and is compared with `sameFace`. A joined string
 * exists only as `FaceMap`'s private key, below.
 */
export type FaceKey = { readonly room?: string; readonly wallId: string; readonly side: WallSide };

/** A painted face in `SceneFinishes.faces`: the face and the finish it wears. */
export type FaceFinish = FaceKey & { readonly finish: FinishRef };

// --------------------------------------------------------------- finishes --

/**
 * A finish value with modifiers (schema 2.3): a project LIBRARY material, the
 * tint it is drawn in and how far its texture is turned.
 *
 * `colour` is `#rrggbb` (sRGB) and only a tintable material reads it;
 * `rotation` is a finite number of degrees, counter-clockwise from the
 * automatic grain orientation. At least one of the two is present: a finish
 * with neither is the bare UUID, so every finish has exactly one spelling.
 */
export type FinishObject = { readonly material: string; readonly colour?: string; readonly rotation?: number };

/**
 * The finish a room surface wears, wherever a finish stands in a document: a
 * bare finish UUID (a bundled finish or any project material), or a
 * `FinishObject`. The viewer carries the value whole and never rewrites one
 * spelling into the other.
 */
export type FinishRef = string | FinishObject;

/** The room surfaces a finish value may dress: the words `set_material` names and a material's `apply` uses. */
export type FinishSurface = 'floor' | 'wall' | 'ceiling' | 'trim' | 'facade';

/**
 * Painted state of the shell, so a repainted scene can be exported and reloaded.
 *
 * Resolution order for a wall face: its entry in `faces` -> the owner's entry
 * (`rooms[roomId].walls`, or `facade`) -> `DEFAULT_WALL_FINISH`. A room floor
 * falls back to `Room.floorMaterial`; a room ceiling and its trim to the
 * defaults the renderer draws. Every finish is a `FinishRef`, and a face
 * appears in `faces` at most once.
 */
export type SceneFinishes = {
  readonly rooms?: Readonly<Record<string, RoomFinishes>>;
  readonly faces?: readonly FaceFinish[];
  readonly facade?: FinishRef;
};

/**
 * Painted finishes of one room, every one optional. `ceiling` and `trim` (the
 * baseboards) are schema 2.3; a 2.2 document that names them is refused.
 */
export type RoomFinishes = {
  readonly floor?: FinishRef;
  readonly walls?: FinishRef;
  readonly ceiling?: FinishRef;
  readonly trim?: FinishRef;
};
