/**
 * The layout issue codes: one stable code per sentence the linter writes, the
 * typed params each code carries, and the English renderer.
 *
 * A host that shows the linter's issues in another language cannot translate
 * a finished sentence; it translates a code and fills in its params. So every
 * rule builds its issue through `layoutIssue` (`layout-issue.ts`), which takes
 * a code and its params and fills `message` from `renderLayoutIssue`: a rule
 * cannot write a sentence that disagrees with its code, and the English is
 * one table here, not a template inline in each rule.
 *
 * The params hold values, never words:
 * - ids are the entity ids of the document (placements, openings, walls,
 *   rooms), as the issue's `ids` lists them;
 * - a wall face is `{ wall, side }`, the wall id and its `WallSide`;
 * - an archetype is the catalogue's archetype id, an anchor the catalogue's
 *   anchor value;
 * - lengths are metres and angles degrees, UNROUNDED: the renderer rounds
 *   them exactly as the sentence always has (two decimals, three for a
 *   wall-hung gap, one for an angle), and the rule's own limits (`maxGap`,
 *   `min`, `max`, `furthest`, `depth` of a wardrobe front) are printed as
 *   the numbers they are.
 *
 * The codes are public (`jeex-viewer/ops`): adding one is a minor change,
 * renaming or removing one is a breaking change. The list is the source of
 * the `LayoutIssueCode` union, and the renderer's table is typed over it, so
 * a code without params or without a sentence does not compile.
 *
 * Pure module: no `three`, no DOM.
 */

import type { WallSide } from '../scene/types.js';

/** Every layout issue code, in rule report order (`LAYOUT_RULE_IDS`). */
export const LAYOUT_ISSUE_CODES = [
  'object_inside_wall',
  'objects_overlap',
  'mounted_objects_overlap',
  'door_clear_zone_blocked',
  'door_leaf_hits_wall',
  'door_leaf_hits_object',
  'wall_hung_off_face',
  'wall_hung_past_face_end',
  'wall_hung_across_opening',
  'wall_hung_centre_height',
  'wall_hung_bottom_height',
  'door_no_free_floor',
  'doors_not_connected',
  'main_zone_unreachable',
  'window_blocked',
  'raised_without_support',
  'floor_object_outside_rooms',
  'floor_object_crosses_room',
  'ceiling_object_outside_rooms',
  'ceiling_object_without_ceiling',
  'ceiling_object_out_of_band',
  'object_taller_than_ceiling',
  'wall_object_out_of_height',
  'wall_object_turned',
  'case_good_off_wall',
  'wall_cabinet_outside_base_run',
  'hood_off_hob_centre',
  'sofa_tv_distance',
  'floor_lamp_inside_seat',
  'chair_tuck_distance',
  'chair_not_facing_table',
  'bed_head_off_wall',
  'double_bed_nightstands',
  'nightstands_out_of_line',
  'wardrobe_front_blocked',
  'coat_rack_in_door_swing',
  'mirror_off_host_centre',
  'entrance_axis_blocked',
] as const;

export type LayoutIssueCode = (typeof LAYOUT_ISSUE_CODES)[number];

/** A wall face an issue names: the wall's id and the side of it the room is on. */
export type LayoutIssueFace = { wall: string; side: WallSide };

/**
 * The params of each code. Ids are entity ids, lengths metres, angles
 * degrees, all unrounded; the module header says how the English rounds them.
 */
export type LayoutIssueParams = {
  /** Rule 1: `placement` reaches `depth` into the body of `wall`. */
  object_inside_wall: { placement: string; wall: string; depth: number };
  /** Rule 2: two floor objects overlap by `depth`. */
  objects_overlap: { placement: string; other: string; depth: number };
  /** Rule 2: two wall-mounted, or two ceiling-mounted, objects overlap by `depth`. */
  mounted_objects_overlap: { placement: string; other: string; depth: number; anchor: 'wall' | 'ceiling' };
  /** Rule 3: `placement` stands in the clear zone of door `opening` on the side of `room`. */
  door_clear_zone_blocked: { placement: string; opening: string; room: string };
  /** Rule 4: the leaf of door `opening` sweeps through `wall`. */
  door_leaf_hits_wall: { opening: string; wall: string };
  /** Rule 4: the leaf of door `opening` sweeps through `placement`. */
  door_leaf_hits_object: { opening: string; placement: string };
  /** Rule 5: the back of `placement` is `gap` off `face` (negative: sunk into it); `maxGap` is the most allowed. */
  wall_hung_off_face: { placement: string; face: LayoutIssueFace; gap: number; maxGap: number };
  /** Rule 5: `placement` spans `from`..`to` along `face`, which is `length` long. */
  wall_hung_past_face_end: { placement: string; face: LayoutIssueFace; from: number; to: number; length: number };
  /** Rule 5: `placement` hangs across `opening`. */
  wall_hung_across_opening: { placement: string; opening: string };
  /** Rule 5: `placement` is centred at `height`; its `archetype` belongs `low`..`high`. */
  wall_hung_centre_height: { placement: string; archetype: string; height: number; low: number; high: number };
  /** Rule 5: the bottom of `placement` is at `bottom`; its `archetype` belongs `low`..`high`. */
  wall_hung_bottom_height: { placement: string; archetype: string; bottom: number; low: number; high: number };
  /** Rule 6: door `opening` has no `width` of free floor in front of it inside `room`. */
  door_no_free_floor: { opening: string; room: string; width: number };
  /** Rule 6: no path `width` wide joins door `from` to door `to` across `room`. */
  doors_not_connected: { from: string; to: string; room: string; width: number };
  /** Rule 6: the main zone of `room` is not reachable on a path `width` wide from door `opening`. */
  main_zone_unreachable: { room: string; opening: string; width: number };
  /** Rule 7: `placement`, `height` tall, blocks window `opening`. */
  window_blocked: { placement: string; opening: string; height: number };
  /** Rule 7a: `placement` stands `height` above the floor on no top that may hold it. */
  raised_without_support: { placement: string; height: number };
  /** Rule 7a: `placement` stands outside every room. */
  floor_object_outside_rooms: { placement: string };
  /** Rule 7a: the footprint of `placement` crosses the outline of `room`. */
  floor_object_crosses_room: { placement: string; room: string };
  /** Rule 7b: `placement` hangs outside every room. */
  ceiling_object_outside_rooms: { placement: string };
  /** Rule 7b: `placement` hangs in `room`, which has no ceiling. */
  ceiling_object_without_ceiling: { placement: string; room: string };
  /** Rule 7b: `placement` spans `low`..`high`; it must hang between `lowest` and the `ceiling`. */
  ceiling_object_out_of_band: { placement: string; low: number; high: number; lowest: number; ceiling: number };
  /** Rule 7c: `placement`, `height` tall, does not fit under the `ceiling`. */
  object_taller_than_ceiling: { placement: string; height: number; ceiling: number };
  /** Rule 7c: wall-mounted `placement` spans `low`..`high`, outside 0..`ceiling`. */
  wall_object_out_of_height: { placement: string; low: number; high: number; ceiling: number };
  /** Rule 7d: wall-mounted `placement` is turned `degrees` away from `face`. */
  wall_object_turned: { placement: string; face: LayoutIssueFace; degrees: number };
  /** Rule 8: case good `placement` stands `distance` off the nearest wall face. */
  case_good_off_wall: { placement: string; distance: number };
  /** Rule 9: wall cabinet `placement`, spanning `from`..`to` on `face`, is not inside the base run. */
  wall_cabinet_outside_base_run: { placement: string; face: LayoutIssueFace; from: number; to: number };
  /** Rule 9: hood `placement` sits `sideways` off the centre of `hob` along the wall, `total` in all. */
  hood_off_hob_centre: { placement: string; hob: string; sideways: number; total: number };
  /** Rule 10: sofa `placement` is `distance` from `tv`; keep `min`..`max`. */
  sofa_tv_distance: { placement: string; tv: string; distance: number; min: number; max: number };
  /** Rule 10: floor lamp `placement` stands inside `seat`. */
  floor_lamp_inside_seat: { placement: string; seat: string };
  /** Rule 11: chair `placement` sits `gap` from `table`; tuck it to `deepest`..`furthest`. */
  chair_tuck_distance: { placement: string; table: string; gap: number; deepest: number; furthest: number };
  /** Rule 11: chair `placement` does not face `table`. */
  chair_not_facing_table: { placement: string; table: string };
  /** Rule 12: the head of double bed `placement` stands `distance` off the wall. */
  bed_head_off_wall: { placement: string; distance: number };
  /** Rule 12: double bed `placement` has `count` nightstands, not one on each side. */
  double_bed_nightstands: { placement: string; count: number };
  /** Rule 12: the nightstands of double bed `placement` are `spread` out of line with its head. */
  nightstands_out_of_line: { placement: string; spread: number };
  /** Rule 12: `placement` stands in the `depth` the doors of `wardrobe` need. */
  wardrobe_front_blocked: { placement: string; wardrobe: string; depth: number };
  /** Rule 14: coat rack `placement` stands `distance` from the swing of door `opening`. */
  coat_rack_in_door_swing: { placement: string; opening: string; distance: number };
  /** Rule 14: mirror `placement` is `offset` off the centre of `host`. */
  mirror_off_host_centre: { placement: string; host: string; offset: number };
  /** Rule 14: `placement` stands on the axis from entrance door `opening` into `room`. */
  entrance_axis_blocked: { placement: string; opening: string; room: string };
};

/** One issue's code with its params: `issue.code === 'x'` narrows `issue.params`. */
export type LayoutIssueDetail = { [C in LayoutIssueCode]: { code: C; params: LayoutIssueParams[C] } }[LayoutIssueCode];

/**
 * Rule 6's three sentences, with the corridor width already printed. Kept in
 * this shape because `scene/issue-heirs.ts` tells the three apart by their
 * words (`circulationSentenceOf`), and its tests write them through these.
 */
export const circulationSentence = {
  noFloor: (opening: string, width: string, room: string): string =>
    `${opening} has no ${width} m of free floor in front of it inside ${room}`,
  noPath: (from: string, to: string, width: string, room: string): string => `no ${width} m path from ${from} to ${to} across ${room}`,
  mainZone: (room: string, opening: string, width = '0.80'): string =>
    `the main zone of ${room} is not reachable on a ${width} m path from ${opening}`,
} as const;

/** Metres to two decimals, as every sentence prints a measured length. */
const m = (value: number): string => value.toFixed(2);

const face = ({ wall, side }: LayoutIssueFace): string => `side ${side} of wall ${wall}`;

const TEMPLATES: { readonly [C in LayoutIssueCode]: (params: LayoutIssueParams[C]) => string } = {
  object_inside_wall: (p) => `${p.placement} is ${m(p.depth)} m inside wall ${p.wall}`,
  objects_overlap: (p) => `${p.placement} and ${p.other} overlap by ${m(p.depth)} m`,
  mounted_objects_overlap: (p) => `${p.placement} and ${p.other} overlap by ${m(p.depth)} m on the ${p.anchor}`,
  door_clear_zone_blocked: (p) => `${p.placement} stands in the clear zone of ${p.opening} (${p.room} side)`,
  door_leaf_hits_wall: (p) => `the leaf of ${p.opening} sweeps through wall ${p.wall}`,
  door_leaf_hits_object: (p) => `the leaf of ${p.opening} sweeps through ${p.placement}`,
  wall_hung_off_face: (p) => `${p.placement} hangs ${p.gap.toFixed(3)} m off ${face(p.face)} (allowed 0..${p.maxGap})`,
  wall_hung_past_face_end: (p) => `${p.placement} runs off the end of ${face(p.face)} (${m(p.from)}..${m(p.to)} of ${m(p.length)} m)`,
  wall_hung_across_opening: (p) => `${p.placement} hangs across opening ${p.opening}`,
  wall_hung_centre_height: (p) => `${p.placement} hangs at ${m(p.height)} m; ${p.archetype} centres belong in ${m(p.low)}..${m(p.high)} m`,
  wall_hung_bottom_height: (p) =>
    `${p.placement} has its bottom at ${m(p.bottom)} m; ${p.archetype} belongs in ${m(p.low)}..${m(p.high)} m`,
  door_no_free_floor: (p) => circulationSentence.noFloor(p.opening, m(p.width), p.room),
  doors_not_connected: (p) => circulationSentence.noPath(p.from, p.to, m(p.width), p.room),
  main_zone_unreachable: (p) => circulationSentence.mainZone(p.room, p.opening, m(p.width)),
  window_blocked: (p) => `${p.placement} is ${m(p.height)} m tall and blocks window ${p.opening}`,
  raised_without_support: (p) => `${p.placement} stands ${m(p.height)} m above the floor on no top that may hold it`,
  floor_object_outside_rooms: (p) => `${p.placement} stands outside every room`,
  floor_object_crosses_room: (p) => `${p.placement} does not fit inside room ${p.room}: its footprint crosses the room's outline`,
  ceiling_object_outside_rooms: (p) => `${p.placement} hangs outside every room`,
  ceiling_object_without_ceiling: (p) => `${p.placement} hangs in ${p.room}, which has no ceiling`,
  ceiling_object_out_of_band: (p) =>
    `${p.placement} spans ${m(p.low)}..${m(p.high)} m; it must hang between ${m(p.lowest)} m and the ${m(p.ceiling)} m ceiling`,
  object_taller_than_ceiling: (p) => `${p.placement} is ${m(p.height)} m tall and does not fit under the ${m(p.ceiling)} m ceiling`,
  wall_object_out_of_height: (p) => `${p.placement} spans ${m(p.low)}..${m(p.high)} m, outside the wall's 0..${m(p.ceiling)} m`,
  wall_object_turned: (p) => `${p.placement} is turned ${p.degrees.toFixed(1)}° away from ${face(p.face)}`,
  case_good_off_wall: (p) => `${p.placement} stands ${m(p.distance)} m off the nearest wall face; case goods belong against a wall`,
  wall_cabinet_outside_base_run: (p) => `${p.placement} (${m(p.from)}..${m(p.to)} on ${face(p.face)}) is not inside the base run`,
  hood_off_hob_centre: (p) => `${p.placement} sits ${m(p.sideways)} m off the centre of ${p.hob} (total ${m(p.total)} m)`,
  sofa_tv_distance: (p) => `${p.placement} is ${m(p.distance)} m from ${p.tv}; keep ${p.min}..${p.max} m`,
  floor_lamp_inside_seat: (p) => `${p.placement} stands inside ${p.seat}; a floor lamp belongs beside the arm`,
  chair_tuck_distance: (p) => `${p.placement} sits ${m(p.gap)} m from ${p.table}; tuck it to ${m(p.deepest)}..${p.furthest} m`,
  chair_not_facing_table: (p) => `${p.placement} does not face ${p.table}`,
  bed_head_off_wall: (p) => `the head of ${p.placement} stands ${m(p.distance)} m off the wall`,
  double_bed_nightstands: (p) => `${p.placement} has ${p.count} nightstand(s); a double bed takes one on each side`,
  nightstands_out_of_line: (p) => `the nightstands of ${p.placement} are ${m(p.spread)} m out of line with the bed head`,
  wardrobe_front_blocked: (p) => `${p.placement} stands in the ${p.depth} m the doors of ${p.wardrobe} need`,
  coat_rack_in_door_swing: (p) => `${p.placement} stands ${m(p.distance)} m from the swing of ${p.opening}`,
  mirror_off_host_centre: (p) => `${p.placement} is ${m(p.offset)} m off the centre of ${p.host}`,
  entrance_axis_blocked: (p) => `${p.placement} stands on the axis from ${p.opening} into ${p.room}`,
};

/** The English sentence of an issue, from its code and params: what `LayoutIssue.message` holds. */
export function renderLayoutIssue<C extends LayoutIssueCode>(code: C, params: LayoutIssueParams[C]): string {
  return (TEMPLATES[code] as (params: LayoutIssueParams[C]) => string)(params);
}
