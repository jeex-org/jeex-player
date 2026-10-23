/**
 * Every shape below is READONLY, properties and arrays alike. The scene
 * document is committed state: `SceneModel` deep-freezes what it hands out and
 * a write to it throws, so the type says the same thing the runtime does. A
 * module that needs to EDIT a scene asks for `Draft<SceneData>`
 * (`shared/committed.ts`), which is the exact inverse and can only be obtained
 * from `draftOf` — a private deep copy nothing else holds.
 *
 * This module imports nothing of its own (code-ranker ADP): every other
 * module in the data/geometry layer imports FROM here, so an import back
 * into any of them — even type-only — closes a cycle. `SceneOp` (the op
 * vocabulary) and `InteriorPreset` (built from it) live here for exactly
 * that reason: both are scene DATA shapes, and `SceneData.interiors` needs
 * `InteriorPreset` precisely typed without this file importing anything
 * back. `scene-ops.ts` (the pure appliers over that vocabulary) re-exports
 * them unchanged, so its existing importers see no difference.
 *
 * `types.schema.ts` is this file's runtime TWIN: the same document as a
 * `zod/mini` schema, reading `UUID_V7_PATTERN`, `isUuidV7` and `isFaceKey`
 * from here rather than restating them. The two are held together by a
 * compile-time agreement check, which lives in `types.schema.test.ts` and NOT
 * here: an edge from this file back into the schema — type-only included —
 * would close a cycle `check:arch` refuses, and would break the rule the
 * paragraph above states. The types stay hand-written for the same reason as
 * ever: a published `.d.ts` built from `z.infer` would carry `zod`'s own
 * types into the package (`check:pkg`).
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

/** Which side of its wall a face is on: `'L'` is the left of `a -> b`. */
export type WallSide = 'L' | 'R';

/** True for the opening kinds that reach the floor and can be walked through. */
export function isDoorLike(type: OpeningType): boolean {
  return type === 'door' || type === 'passage';
}

// ------------------------------------------------------------ identifiers --
//
// Every entity id in a document is a UUID version 7, lowercase canonical. The
// viewer only CHECKS ids: it never mints one. Whoever creates an entity — the
// scene author, an editor host, a host command — brings its id along, and the
// validator keeps proving that it is one.
//
// Names are not ids: a room's `name`, a catalogue entry's `slug` and the
// vocabulary words (`set_material` aliases, furniture `type` words, slot names)
// stay words, and nothing keys on them.

/** Lowercase canonical UUID v7: version nibble `7`, variant bits `10`. */
export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True when `value` is an id this schema accepts anywhere: a lowercase canonical UUID v7. */
export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7_PATTERN.test(value);
}

// -------------------------------------------------------------- face keys --

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
export type FaceFinish = FaceKey & { readonly finish: string };

/** The face of `wallId` on `side`, owned by `room`, or the facade's for `null`. */
export function faceKey(room: string | null, wallId: string, side: WallSide): FaceKey {
  return room === null ? { wallId, side } : { room, wallId, side };
}

/** True when both keys name the same face. */
export function sameFace(a: FaceKey, b: FaceKey): boolean {
  return a.wallId === b.wallId && a.side === b.side && a.room === b.room;
}

/** True for a structurally valid face key: UUID wall and room, side `L` or `R`, nothing else. */
export function isFaceKey(value: unknown): value is FaceKey {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(record)) if (key !== 'room' && key !== 'wallId' && key !== 'side') return false;
  if (!isUuidV7(record['wallId']) || (record['side'] !== 'L' && record['side'] !== 'R')) return false;
  return !('room' in record) || isUuidV7(record['room']);
}

/** The private join `FaceMap` keys by; a UUID never contains `/`, so it is unambiguous. */
function faceMapKey(face: FaceKey): string {
  return `${face.room ?? ''}/${face.wallId}/${face.side}`;
}

/**
 * A map over faces. The one place a face becomes a string, and the string
 * never leaves: every read and write takes a `FaceKey`, and iteration hands
 * the keys back as the structures they were stored with.
 */
export class FaceMap<V> {
  private readonly entries_ = new Map<string, { readonly face: FaceKey; readonly value: V }>();

  get size(): number {
    return this.entries_.size;
  }

  get(face: FaceKey): V | undefined {
    return this.entries_.get(faceMapKey(face))?.value;
  }

  has(face: FaceKey): boolean {
    return this.entries_.has(faceMapKey(face));
  }

  set(face: FaceKey, value: V): this {
    this.entries_.set(faceMapKey(face), { face, value });
    return this;
  }

  delete(face: FaceKey): boolean {
    return this.entries_.delete(faceMapKey(face));
  }

  clear(): void {
    this.entries_.clear();
  }

  *keys(): IterableIterator<FaceKey> {
    for (const entry of this.entries_.values()) yield entry.face;
  }

  *values(): IterableIterator<V> {
    for (const entry of this.entries_.values()) yield entry.value;
  }

  *entries(): IterableIterator<[FaceKey, V]> {
    for (const entry of this.entries_.values()) yield [entry.face, entry.value];
  }

  [Symbol.iterator](): IterableIterator<[FaceKey, V]> {
    return this.entries();
  }
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

export type MaterialDefinition = {
  readonly id: string;
  readonly name: string;
  /** Wire-format field name: American spelling, as in `scene.json`. */
  readonly color: string;
  readonly roughness: number;
  readonly metalness?: number;
};

/**
 * Furniture reference on a placement.
 *
 * The dashed words are the furniture types the object bank aliases onto an
 * archetype (vocabulary, not ids); an object-bank archetype or variant UUID is
 * equally valid, which is why the union stays open. `asset` is the fully qualified form when a
 * placement needs to name a library too.
 */
export type DemoAssetType =
  | (string & {})
  | 'sofa'
  | 'armchair'
  | 'bed'
  | 'nightstand'
  | 'wardrobe'
  | 'dresser'
  | 'desk'
  | 'table'
  | 'chair'
  | 'stool'
  | 'side-table'
  | 'table-lamp'
  | 'tv-unit'
  | 'bookshelf'
  | 'plant'
  | 'lamp'
  | 'rug'
  | 'art'
  | 'mirror'
  | 'counter'
  | 'stove'
  | 'upper-cabinet'
  | 'hood'
  | 'fridge'
  | 'island'
  | 'pendant'
  | 'ceiling-light'
  | 'bathtub'
  | 'toilet'
  | 'vanity'
  | 'shoe-cabinet'
  | 'coat-rack'
  | 'console'
  | 'door-mat';

/**
 * The three mirror axes, in the object's own frame: `x` left↔right, `y`
 * up↔down, `z` front↔back. Vocabulary words, not ids.
 */
export type MirrorAxis = 'x' | 'y' | 'z';

/** A placement's mirroring: the axes it is reflected on. `false` is never written; an absent axis is not mirrored. */
export type Mirror = { readonly x?: true; readonly y?: true; readonly z?: true };

/**
 * Which axes an asset ALLOWS to be mirrored: a catalogue fact, never a
 * scene field. An absent fact allows none.
 */
export type MirrorFacts = { readonly x: boolean; readonly y: boolean; readonly z: boolean };

export type DemoAsset = {
  readonly id: string;
  /**
   * What to place: a furniture type word (`'sofa'`, mapped onto an archetype
   * by the catalogue) or an object-bank archetype / variant UUID.
   */
  readonly type: DemoAssetType;
  /** Catalogue reference: a bare archetype or variant UUID (schema 2.2), never `library:asset`. */
  readonly asset?: string | undefined;
  /** UUID of the library `asset` belongs to; absent: the scene's `assetLibrary`, then the built-in bank. */
  readonly library?: string | undefined;
  /** Catalogue variant UUID: the concrete variant of the archetype to place. */
  readonly variant?: string;
  /** Room the object belongs to, mirroring the `place_object` operation parameter. */
  readonly room?: string;
  readonly position: Vec3;
  readonly rotationY?: number;
  /** Uniform scale, positive from schema 2.1 on: a reflection is `mirror`, never a negative scale. */
  readonly scale?: number;
  /** Mirroring in the object's own frame, about its body bounds centre; absent or empty = none. */
  readonly mirror?: Mirror;
  /** Per-slot finish overrides, `slot name -> finish UUID`. */
  readonly finishes?: Readonly<Record<string, string>>;
  /** Single-material shortcut (a finish UUID); applied to the archetype's primary slot. */
  readonly material?: string;
  /** Optional furniture footprint half-extents (metres, before rotation) for walk collision. */
  readonly collision?: { readonly hx: number; readonly hz: number };
};

/** Gaze cue: while the tour camera passes path waypoint `at`, look at `target`. */
export type TourGazeKey = {
  readonly at: number;
  readonly target: Vec3;
};

/** Speed zone: from path waypoint `at` onwards, move at `speed` m/s (blended over ~2 m). */
export type TourSpeedZone = {
  readonly at: number;
  readonly speed: number;
};

/**
 * One tour checkpoint: a camera the author placed in the scene, and one stop of
 * the tour. The ORDER of the list is the tour order — the trajectory through
 * the positions is derived, never authored (`tour-route.ts`), and it is the
 * same filleted path the tour player rides.
 *
 * The look direction is angles, not a target point: height, yaw and pitch are
 * exactly the handles the placement gizmo drags, and a target would make the
 * gizmo re-derive them on every frame. `position.y` IS the height — there is
 * no separate field, so a marker and its document agree by construction.
 */
export type TourCheckpoint = {
  readonly id: string;
  /** Plan position (x, z); `y` is the camera height above the floor, metres. */
  readonly position: Vec3;
  /** Horizontal look direction, radians; `0` looks along +Z, positive turns toward +X. */
  readonly yaw: number;
  /** Vertical tilt of the look direction, radians; positive looks up. */
  readonly pitch: number;
  /**
   * What the author calls this shot («Living room entrance»), trimmed, at most
   * `TOUR_CHECKPOINT_NAME_MAX` characters; absent reads as untitled.
   */
  readonly name?: string;
};

/** Longest `TourCheckpoint.name`, characters — the room name's own ceiling. */
export const TOUR_CHECKPOINT_NAME_MAX = 60;

/**
 * Steepest tilt a checkpoint's view direction may carry, radians (±50°): a
 * tour that stares at the floor or the ceiling reads as a broken shot. The op
 * clamps to this, the validator refuses a document beyond it — the same
 * two-sided arrangement as `WALL_LIMITS`.
 */
export const TOUR_PITCH_LIMIT_RAD = (50 / 180) * Math.PI;
/** Lowest camera height a checkpoint may take, metres: above the skirting, never in the floor. */
export const TOUR_CHECKPOINT_HEIGHT_MIN_M = 0.3;
/**
 * Clearance a checkpoint's height keeps under the document's `ceilingHeight`,
 * metres — the top of the clamp, so a marker never rides the ceiling.
 */
export const TOUR_CHECKPOINT_HEIGHT_MARGIN_M = 0.2;

/**
 * Painted state of the shell, so a repainted scene can be exported and reloaded.
 *
 * Resolution order for a wall face: its entry in `faces` -> the owner's entry
 * (`rooms[roomId].walls`, or `facade`) -> `DEFAULT_WALL_FINISH`. A room floor
 * falls back to `Room.floorMaterial`. Every finish is a catalogue UUID, and a
 * face appears in `faces` at most once.
 */
export type SceneFinishes = {
  readonly rooms?: Readonly<Record<string, RoomFinishes>>;
  readonly faces?: readonly FaceFinish[];
  readonly facade?: string;
};

/** Painted floor and wall finish of one room; both optional, both catalogue UUIDs. */
export type RoomFinishes = { readonly floor?: string; readonly walls?: string };

// -------------------------------------------------------- topology remap --
//
// The contract a future wall operation (split, merge, move a node) answers
// with, so the paint can follow the geometry (after OpenGeometry
// `editor/types.rs` `TopologyRemap`, read for its description).
//
// It is declared HERE, with no producer yet, on purpose: the day the first
// wall operation lands, the question "what happened to the finishes" must
// already have one answer (`finish-remap.ts`) instead of one per operation.
//
// DECISION of the first producer, `split_wall`: a split emits ONE entry per
// PAINTED face of the old wall — an entry of `SceneFinishes.faces` whose
// `wallId` names it. Owner and side are preserved (the halves run the same
// direction `a -> b` on the same line, so the same rooms own the same sides);
// only the wall segment changes. Both heirs inherit the ancestor's finish
// (`finish-remap.ts`'s `split` policy), so a wall painted differently on its
// two sides stays differently painted — the sides never mix, each side's face
// carries its own finish to both of its halves. `primary` names the face of the
// LONGER half (`ids[0]` on a tie) and is carried because the type requires it
// and the future `merge_wall` reads it; the paint itself does not need it. An
// unpainted face gets no entry at all: it has no finish to carry, and which
// room owns which side is the SOLVER's answer on the committed candidate, not
// the draft's. `created` stays empty — both halves have an ancestor.

/** What one plan edit did to a paintable face. */
export type TopologyRemapStatus = 'unchanged' | 'split' | 'merged' | 'deleted';

/** The fate of one face across an edit. */
export type TopologyRemapEntry = {
  readonly from: FaceKey;
  /** The faces that replace it; empty when the face is gone. */
  readonly to: readonly FaceKey[];
  /**
   * The heir among `to` for a `split`, or — for a `merged` group, where
   * several entries share one `to` — the ANCESTOR whose finish the
   * survivor keeps. Required for both; meaningless for the other two.
   */
  readonly primary?: FaceKey;
  readonly status: TopologyRemapStatus;
};

/**
 * How one plan edit moved the paintable faces. `created` are faces with no
 * ancestor at all — a new wall's two sides — and they inherit nothing.
 */
export type TopologyRemap = { readonly faces: readonly TopologyRemapEntry[]; readonly created: readonly FaceKey[] };

// ------------------------------------------------------------ op vocabulary --
//
// The scene operation vocabulary: type declarations only — the pure appliers
// behind them live in `scene-ops.ts`, which re-exports every type below
// unchanged.

/** The `set_material` target words: every floor, every room's walls, the facade. */
export type SetMaterialAlias = 'floors' | 'walls' | 'facade';

/**
 * Paints a surface. `target` is one of the aliases `floors` / `walls` /
 * `facade`, a room UUID, or a `FaceKey`; `scope` only matters for a face
 * target, where `'face'` (the default) paints that face alone and `'room'`
 * hands the face's owner — a room or the facade — the finish instead.
 *
 * A room target is routed by the finish itself: a floor finish paints the
 * floor, a wall finish paints the room's walls. Floor and wall catalogue ids
 * are disjoint, so the routing is total and unambiguous.
 */
export type SetMaterialOp = {
  readonly op: 'set_material';
  readonly target: SetMaterialAlias | (string & {}) | FaceKey;
  readonly material: string;
  readonly scope?: 'room' | 'face';
};

export type ReplaceAssetVariantOp = { readonly op: 'replace_asset_variant'; readonly assetId: string; readonly variant: string };
export type ReplaceOpeningVariantOp = { readonly op: 'replace_opening_variant'; readonly openingId: string; readonly variant: string };
export type SetCeilingOp = { readonly op: 'set_ceiling'; readonly height: number };

/** Absolute values win over deltas when both are given for the same field. */
export type SetOpeningOp = {
  readonly op: 'set_opening';
  readonly openingId: string;
  /**
   * Wall to move the opening onto. A move needs an absolute
   * `center`: the parameter is measured along ONE wall's centreline, so a
   * delta against the wall the opening is leaving means nothing on the wall it
   * is joining.
   */
  readonly wallId?: string;
  readonly center?: number;
  readonly width?: number;
  readonly sill?: number;
  readonly head?: number;
  readonly dcenter?: number;
  readonly dwidth?: number;
  readonly dsill?: number;
  readonly dhead?: number;
};

export type AddOpeningOp = {
  readonly op: 'add_opening';
  readonly wallId: string;
  readonly type: OpeningType;
  readonly center: number;
  readonly width: number;
  readonly sill?: number;
  readonly head?: number;
  /** The new opening's UUID, minted by the caller. */
  readonly id: string;
  readonly entrance?: boolean;
  readonly variant?: string;
};

export type RemoveOpeningOp = { readonly op: 'remove_opening'; readonly openingId: string };

/** Which camera `set_camera` addresses: the presentation shot, the walk-mode spawn, or one room's own. */
export type SetCameraTarget = 'presentation' | 'walkSpawn' | { readonly room: string };

/**
 * Sets or clears one of the scene's cameras. `pose` is required
 * unless `remove` is `true`; `remove` only makes sense for `walkSpawn` and a
 * room target — `presentationCamera` is mandatory and refuses removal.
 */
export type SetCameraOp = {
  readonly op: 'set_camera';
  readonly target: SetCameraTarget;
  readonly pose?: CameraPose;
  readonly remove?: true;
};

/** Replaces the walk-mode navigation waypoints wholesale. */
export type SetNavigationOp = { readonly op: 'set_navigation'; readonly points: readonly Vec3[] };

/**
 * Updates the named parts of the autotour run; an omitted field keeps the
 * scene's current value. `path`, when given, replaces the whole route.
 */
export type SetAutotourOp = {
  readonly op: 'set_autotour';
  readonly path?: readonly Vec3[];
  readonly gaze?: readonly TourGazeKey[];
  readonly zones?: readonly TourSpeedZone[];
  readonly speed?: number;
};

/**
 * Replaces the tour checkpoints wholesale — the whole ordered list, the way
 * `set_autotour` replaces the path. Wholesale is what keeps a journal replay
 * deterministic (no "insert at index" to disagree about) and is all the
 * placement UI needs: a drag, a reorder and an add each answer with the list
 * they mean, and an EMPTY list is how the op says "no checkpoints" — the tour
 * then falls back to the authored `autotour` (`tour-route.ts`).
 */
export type SetTourCheckpointsOp = {
  readonly op: 'set_tour_checkpoints';
  readonly checkpoints: readonly TourCheckpoint[];
  /** Tour cruise speed, m/s; omitted keeps the scene's current one. */
  readonly speed?: number;
};

// ------------------------------------------------------------------ rooms --
//
// A room is an ANCHOR, not an outline: the face of the wall graph containing
// the anchor is the room (`Room.anchor` above). So these three operations only
// ever say where the anchor is and what the room is called — whether the
// anchor actually lands inside a free face is the solver's answer, and
// `SceneModel.apply` asks it before the batch commits.

export type AddRoomOp = {
  readonly op: 'add_room';
  /** The new room's UUID, minted by the caller. */
  readonly id: string;
  readonly name: string;
  readonly anchor: Vec2;
  /** Floor finish the room starts with; the registries' default when omitted. */
  readonly floorMaterial?: string;
  readonly kind?: RoomKind;
  readonly accent?: string;
};

/** Changes a room's properties; every field is optional and at least one is required. */
export type SetRoomOp = {
  readonly op: 'set_room';
  readonly roomId: string;
  readonly name?: string;
  readonly kind?: RoomKind;
  readonly anchor?: Vec2;
  readonly accent?: string;
};

export type RemoveRoomOp = { readonly op: 'remove_room'; readonly roomId: string };

// -------------------------------------------------------------- furniture --

export type PlaceObjectOp = {
  readonly op: 'place_object';
  /** The new placement's UUID, minted by the caller. */
  readonly id: string;
  /** Catalogue reference: a bare archetype or variant UUID, as `DemoAsset.asset`. */
  readonly asset: string;
  /** UUID of the library `asset` belongs to, written as given; absent as for `DemoAsset.library`. */
  readonly library?: string;
  readonly variant?: string;
  readonly room?: string;
  readonly position: Vec3;
  readonly rotationY?: number;
  readonly finishes?: Readonly<Record<string, string>>;
};

/** `position` and `dposition` are mutually exclusive; `room: null` unbinds the placement. */
export type MoveObjectOp = {
  readonly op: 'move_object';
  readonly assetId: string;
  readonly position?: Vec3;
  readonly dposition?: Vec3;
  readonly room?: string | null;
};

/** `rotationY` and `drotation` are mutually exclusive; both normalise into (−π, π]. */
export type RotateObjectOp = {
  readonly op: 'rotate_object';
  readonly assetId: string;
  readonly rotationY?: number;
  readonly drotation?: number;
};

/** What a placement WEARS, as opposed to where it stands (`move_object`, `rotate_object`). */
export type SetObjectOp = {
  readonly op: 'set_object';
  readonly assetId: string;
  readonly finishes?: Readonly<Record<string, string>>;
  readonly material?: string;
  readonly scale?: number;
};

export type RemoveObjectOp = { readonly op: 'remove_object'; readonly assetId: string };

/**
 * Sets a placement's WHOLE mirror state (absolute, like `rotate_object` with
 * `rotationY`, so an undo is the previous state); `{}` clears it. Refused with
 * `mirror_not_allowed` when the asset's facts do not allow a set axis, or are unknown.
 */
export type MirrorObjectOp = { readonly op: 'mirror_object'; readonly assetId: string; readonly mirror: Mirror };
// The SHELL operations. The plan is a GRAPH — nodes carry the
// coordinates, walls only reference them — so there is no "move a wall by
// (dx, dz)": a wall moves because its nodes did, and a node shared by three
// walls moves all three.
/** Adds a node (UUID minted by the caller); one with no wall on it is legal only inside a batch. */
export type AddNodeOp = { readonly op: 'add_node'; readonly id: string; readonly p: Vec2 };
/** Moves a node, every wall on it following. `p` and `dp` are mutually exclusive. */
export type MoveNodeOp = { readonly op: 'move_node'; readonly nodeId: string; readonly p?: Vec2; readonly dp?: Vec2 };
/** Removes a node. Refused while any wall still references it. */
export type RemoveNodeOp = { readonly op: 'remove_node'; readonly nodeId: string };
/** Joins two nodes. `thickness` is clamped into `WALL_LIMITS`; a duplicate edge is refused. */
export type AddWallOp = {
  readonly op: 'add_wall';
  /** The new wall's UUID, minted by the caller. */
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly thickness: number;
  readonly role?: WallRole;
  readonly arc?: WallArc;
};
/** Edits a wall in place. `arc: null` straightens it; at least one field must be given. */
export type SetWallOp = {
  readonly op: 'set_wall';
  readonly wallId: string;
  readonly thickness?: number;
  readonly role?: WallRole;
  readonly arc?: WallArc | null;
};
/** Removes a wall with its openings and the finishes painted on its faces. */
export type RemoveWallOp = { readonly op: 'remove_wall'; readonly wallId: string };
/**
 * Cuts one straight wall into two collinear halves at a new node. The CALLER
 * mints every id — the node and both halves — because a revision journal
 * replays this operation and must get the same ids every time, exactly as
 * `add_wall` and `add_node`.
 */
export type SplitWallOp = {
  readonly op: 'split_wall';
  readonly wallId: string;
  /** Metres from node `a` along the centreline. */
  readonly at: number;
  /** The new node the cut creates, on the centreline at `at`. */
  readonly nodeId: string;
  /** Ids of the halves: `[a -> new node, new node -> b]`. */
  readonly ids: readonly [string, string];
};

export type SceneOp =
  | SetMaterialOp
  | ReplaceAssetVariantOp
  | ReplaceOpeningVariantOp
  | SetCeilingOp
  | SetOpeningOp
  | AddOpeningOp
  | RemoveOpeningOp
  | SetCameraOp
  | SetNavigationOp
  | SetAutotourOp
  | SetTourCheckpointsOp
  | AddRoomOp
  | SetRoomOp
  | RemoveRoomOp
  | PlaceObjectOp
  | MoveObjectOp
  | RotateObjectOp
  | SetObjectOp
  | RemoveObjectOp
  | MirrorObjectOp
  | AddNodeOp
  | MoveNodeOp
  | RemoveNodeOp
  | AddWallOp
  | SetWallOp
  | RemoveWallOp
  | SplitWallOp;

/**
 * A complete interior look offered by the viewer's preset selector: floor and
 * wall finishes plus furniture, door and window variants, chosen together and
 * applied as ONE atomic batch.
 *
 * `ops` is an ordinary `SceneOp[]`, so a preset can express nothing an
 * operation cannot, and the validator can prove it applies by dry-running it.
 * `swatch` is only the two-tone preview the panel draws — `[floor, wall]`
 * finish ids — never the source of truth for what `ops` paint.
 */
export type InteriorPreset = {
  readonly id: string;
  /** Display label. Scene-authored copy, not a `messages.ts` key. */
  readonly name: string;
  /** Two finish ids the panel composes the preview swatch from: `[floor, wall]`. */
  readonly swatch: readonly [string, string];
  /** The whole look, applied as one batch. */
  readonly ops: readonly SceneOp[];
};

/**
 * The document versions this build reads. 2.0 made every entity id a UUID v7;
 * 2.1 added `DemoAsset.mirror` and made `scale` positive (a negative scale is
 * refused with «use mirror»). 2.2 split a placement's catalogue reference into
 * fields — `asset` is a bare UUID and `library` names its library — so the
 * composite `library:asset` string of 2.0 and 2.1 is gone. That changes what
 * an existing field means, so an older document is refused, never
 * reinterpreted, and its producer converts it. 2.3 adds the optional `site`;
 * 2.2 stays readable and may not carry it.
 */
export type SchemaVersion = '2.2' | '2.3';

/** The versions a reader accepts, oldest first; the last is what a writer writes (a document is never re-versioned by an op). */
export const SCHEMA_VERSIONS = ['2.2', '2.3'] as const satisfies readonly SchemaVersion[];

/** The sun presets a `site` may name (schema 2.3). */
export type SiteSun = 'morning' | 'noon' | 'evening';

/** Where the plan faces (schema 2.3): `northDeg` is true north's world azimuth, degrees clockwise from +Z towards +X; absent 0. `sun` absent is `noon`. */
export type SceneSite = { readonly northDeg?: number; readonly sun?: SiteSun };

/**
 * The only length unit this schema speaks. Explicit on the document, so an
 * importer can REFUSE feet instead of guessing; omitted
 * means `'m'`.
 */
export type LengthUnit = 'm';

/**
 * The building storey this document describes. `elevation` is metres above
 * project zero; omitting the field means a single unnamed storey at 0. It
 * exists so an IFC or IFCX export has an `IfcBuildingStorey` to hang the
 * spatial tree on without inventing one.
 */
export type Storey = { readonly name?: string; readonly elevation?: number };

export type SceneData = {
  readonly schemaVersion: SchemaVersion;
  /** Length unit of every coordinate in this document; omitted means `'m'`. */
  readonly units?: LengthUnit;
  /** Storey this plan sits on; omitted means one unnamed storey at elevation 0. */
  readonly storey?: Storey;
  readonly id: string;
  readonly name: string;
  readonly ceilingHeight: number;
  readonly nodes: readonly PlanNode[];
  readonly walls: readonly Wall[];
  readonly rooms: readonly Room[];
  /**
   * Scene-local material overrides: ids this scene defines on top of the
   * shared catalogues. Optional — `material-catalogue.resolveFinish` searches
   * `finish-catalogue.ts` and `asset-finish-catalogue.ts` first, so a scene
   * only lists what neither of them already knows.
   */
  readonly materials?: readonly MaterialDefinition[];
  /** UUID of the library of a placement that names no `library`; absent: the built-in bank. */
  readonly assetLibrary?: string;
  readonly assets: readonly DemoAsset[];
  readonly presentationCamera: CameraPose;
  readonly roomCameras: Readonly<Record<string, CameraPose>>;
  readonly navigation: { readonly points: readonly Vec3[] };
  /** Painted overrides on top of the catalogue defaults; written by `set_material`. */
  readonly finishes?: SceneFinishes;
  /**
   * Complete interior looks the viewer's preset selector offers. Optional: a
   * scene without them hides the selector entirely. The first entry is the
   * look the scene ships, so "back to default" is always one click away.
   */
  readonly interiors?: readonly InteriorPreset[];
  /** Where walk mode drops the camera when it starts outside the plan. */
  readonly walkSpawn?: CameraPose;
  /** Orientation and sun preset (schema 2.3); absent: the sun keeps its legacy direction. */
  readonly site?: SceneSite;
  /**
   * One continuous camera run: dollhouse overview arc → dive to the entrance →
   * eye-level walkthrough through doorways → rise back to the overview.
   */
  readonly autotour: {
    readonly speed?: number;
    readonly path: readonly Vec3[];
    readonly gaze: readonly TourGazeKey[];
    readonly zones?: readonly TourSpeedZone[];
  };
  /**
   * The tour's checkpoints, in tour order — the cameras the author placed, the
   * trajectory through which the tour rides (`tour-route.ts`). Optional:
   * absent, or shorter than two entries, means the
   * authored `autotour` above stays the route. `set_tour_checkpoints` writes it.
   */
  readonly tourCheckpoints?: readonly TourCheckpoint[];
};

/** Where a camera stands and what it looks at; the shape of every authored pose. */
export type CameraPose = { readonly position: Vec3; readonly target: Vec3 };

// ------------------------------------------ optional fields with defaults --
//
// An optional field with a default is read through EXACTLY ONE projection.
// Every scattered `?? DEFAULT_X` is a place two modules can disagree about
// what the document meant: `scale ?? 1` once sat in five modules and `shape`
// was decided at each consumer, while `sill`/`head` — the one
// pair that already had a projection (`plan-openings.effectiveOpening`) — had
// never drifted. These are the rest of that pattern, and they live next to the
// schema so the plan layer can read them too.
//
// `Wall.role` has no projection ON PURPOSE: nothing reads it. It is a hint for
// the UI and the validator, the validator checks its membership and no
// consumer ever asks what an omitted role means, so a projection would be an
// export with no importer.

/** Head shape an opening that names none is asking for. */
export const DEFAULT_OPENING_SHAPE: OpeningShape = 'flat';
/** Kind a room that names none is asking for. */
export const DEFAULT_ROOM_KIND: RoomKind = 'room';
/** Uniform scale a placement that names none is asking for. */
export const DEFAULT_ASSET_SCALE = 1;
/** Yaw a placement that names none is asking for, radians. */
export const DEFAULT_ASSET_ROTATION_Y = 0;

/**
 * Head shape of an opening, defaulted.
 *
 * The ONE reader of `Opening.shape`: `plan-openings` resolves it into the face
 * opening every renderer then reads, so a consumer comparing the raw field
 * against `'arch'` would silently answer "flat" for a shape nobody has taught
 * it yet.
 */
export function effectiveOpeningShape(opening: Opening): OpeningShape {
  return opening.shape ?? DEFAULT_OPENING_SHAPE;
}

/** A room with every optional field resolved. */
export type EffectiveRoom = Omit<Room, 'kind'> & { readonly kind: RoomKind };

/** The ONE reader of `Room.kind`: a loggia gets no ceiling, a room does. */
export function effectiveRoom(room: Room): EffectiveRoom {
  return { ...room, kind: room.kind ?? DEFAULT_ROOM_KIND };
}

/** A placement with the two fields that have a document default resolved. */
export type EffectiveAsset = Omit<DemoAsset, 'scale' | 'rotationY'> & {
  readonly scale: number;
  readonly rotationY: number;
};

/**
 * The ONE reader of `DemoAsset.scale` and `DemoAsset.rotationY`.
 *
 * `scale` is positive in every document the validator accepts (schema 2.1:
 * a reflection is `mirror`); a footprint still reads it through
 * `footprintScaleOf`, which is what a body built off an unvalidated draft needs.
 *
 * What this does NOT resolve is the catalogue: `variant`, `asset` and
 * `finishes` mean nothing without the object bank, and the bank lives four
 * layers up. `asset-resolver.ts` owns that half, and it starts from here.
 */
export function effectiveAsset(asset: DemoAsset): EffectiveAsset {
  return {
    ...asset,
    scale: asset.scale ?? DEFAULT_ASSET_SCALE,
    rotationY: asset.rotationY ?? DEFAULT_ASSET_ROTATION_Y,
  };
}

/**
 * Scale a placement's FOOTPRINT is measured with: the magnitude.
 *
 * The magnitude, so an unvalidated draft with a negative scale (refused by the
 * validator since schema 2.1: «use mirror») still measures a real extent. The
 * collision box (`navigation.footprintOf`) and the layout linter both read it.
 */
export function footprintScaleOf(asset: DemoAsset): number {
  return Math.abs(effectiveAsset(asset).scale);
}

/**
 * What the viewer is showing. `plan2d` is the flat architectural drawing
 * (`plan-drawing.ts` painted onto `#plan-canvas`), `plan3d` the real scene from
 * straight above through an orthographic camera; both are display-only — no
 * input, no picking. `orbit` (labelled "360"), `walk` and `tour` are the three
 * camera modes and are unchanged.
 */
export type ViewerMode = 'plan2d' | 'plan3d' | 'orbit' | 'walk' | 'tour';

/** The two display-only modes: the rig is frozen and the pointer does nothing. */
export function isPlanMode(mode: ViewerMode): boolean {
  return mode === 'plan2d' || mode === 'plan3d';
}

// -------------------------------------------------- completeness report --
//
// `scene/completeness.ts` needs a report shape, and it is declared down here
// with the types rather than up in `scene/` for two reasons that outlived the
// layer rule that first produced it: `checkCompleteness` imports the three
// names from this module, and `embed/ops.ts` re-exports them, because an
// importer outside this repository builds its own `ImportReport`/`ReportEntry`
// to the SAME shape and the two must not drift apart (the shared shape is a
// package boundary).

/** How serious one completeness finding is. */
export type SceneReportSeverity = 'info' | 'warning' | 'error';

/** One finding `checkCompleteness` raised, in the shape an import report uses. */
export type SceneReportEntry = {
  /** kebab-case, stable across versions, e.g. `'room-no-door'`. */
  readonly code: string;
  readonly severity: SceneReportSeverity;
  /** One sentence, English, numbers included (no separate formatting step). */
  readonly message: string;
  readonly entity?: { readonly kind: string; readonly id: string };
  /** JSON path in the scene document. */
  readonly path?: string;
  /** The numeric/boolean/string payload behind `message`. */
  readonly detail?: Readonly<Record<string, number | string | boolean | null>>;
};

/** `checkCompleteness`'s whole log, plus a running count by severity. */
export type SceneReport = {
  readonly entries: readonly SceneReportEntry[];
  readonly counts: Readonly<Record<SceneReportSeverity, number>>;
};
