/**
 * The one table of what each delivery form carries: for every `ViewerHandle`
 * member whether the iframe wire has it, and for every handle event whether
 * the wire and the custom element re-emit it.
 *
 * The three forms are the ES module (`mountViewer`, which IS the handle), the
 * custom element (`<jeex-viewer>`, whose `viewer` property is the handle and
 * which re-emits events as `jeex-*` DOM events) and the iframe
 * (`embedViewer`, a projection of the handle across `postMessage`). The
 * module carries everything by definition; this table says what the other
 * two carry, and the places that build them are checked against it:
 *
 * - every row is required: the tables are `satisfies Record<keyof …>`, so a
 *   member or an event added to the handle without a row fails `tsc`, and
 *   a value member takes a `PropertyRow` where a method cannot;
 * - the wire method list (`METHOD_LIST`, `CommandMethod`) equals the methods
 *   the rows name, in both directions, checked below;
 * - the host handle (`JeexEmbed`) has one member per wire method, and no
 *   other member than the few it keeps for itself, checked below;
 * - the bridge's `perform` switches over `Command`, whose branches are proved
 *   equal to `CommandMethod` in `protocol.schema.ts`, and ends in a `never`;
 * - the bridge forwards `WIRE_EVENTS` and `TOUR_EVENTS`, the element
 *   re-emits `ELEMENT_EVENTS` and `TOUR_EVENTS`, both by looping over these
 *   lists, and the wire events equal `EmbedEventMap` (checked below).
 *
 * A row on the wire names its wire method; that method's params schema is
 * the `commandSchema` branch of the same name (`protocol.schema.ts`). The
 * schema stays there rather than being referenced from a row, because this
 * module is read by the element bundle, which carries no protocol schema.
 *
 * Editing members stay off the wire by decision: an iframe embeds a published
 * tour, and its host edits nothing.
 *
 * Pure module: types and plain data only, no `three`, no DOM.
 */

import type { ViewerHandle } from '../app/viewer-handle.js';
import type { ViewerEventMap, ViewerEventName } from '../app/viewer-events.js';
import type { CaptureCommands } from '../app/capture-commands.js';
import type { TourControls, TourProgress, TourState } from '../camera/tour-controls.js';
import type { CommandMethod, EventName, METHOD_LIST } from './protocol.js';
import type { JeexEmbed } from './host-handle.js';

/** A member the iframe host cannot call, or the wire method that calls it. */
export type MemberRow = { readonly wire: false; readonly property?: never } | { readonly wire: true; readonly method: CommandMethod };

/** A member that is a value, not a method: off the wire, and not in a form's list of methods. */
export type PropertyRow = { readonly wire: false; readonly property: true };

/** Whether an event crosses the iframe wire, and whether the element re-emits it as a DOM event. */
export type EventRow = { readonly wire: boolean; readonly element: boolean };

/**
 * Every handle member but the two that are tables of their own (`tour`,
 * `capture`): a method takes a `MemberRow`, a value must take a `PropertyRow`,
 * so a new property cannot be listed as a method.
 */
export type HandleMemberTable = {
  [K in Exclude<keyof ViewerHandle, symbol | 'tour' | 'capture'>]: ViewerHandle[K] extends (...args: never[]) => unknown
    ? MemberRow
    : PropertyRow;
};
export type TourMemberTable = Record<keyof TourControls, MemberRow>;
export type CaptureMemberTable = Record<keyof CaptureCommands, MemberRow>;
export type ViewerEventTable = Record<ViewerEventName, EventRow>;
/** The tour's own events (`handle.tour.on`). */
export type TourEventTable = Record<'progress' | 'state' | 'ended', EventRow>;

const OFF = { wire: false } as const;
const PROPERTY = { wire: false, property: true } as const;
/** The same member on the wire, under the wire method's name. */
const on = <M extends CommandMethod>(method: M): { readonly wire: true; readonly method: M } => ({ wire: true, method });

export const HANDLE_MEMBERS = {
  element: PROPERTY,
  options: PROPERTY,
  slots: PROPERTY,
  // The frame's readiness travels as the `ready` event; the host helper keeps its own promise.
  ready: PROPERTY,
  loadScene: on('loadScene'),
  setMode: on('setMode'),
  getMode: on('getMode'),
  getState: on('getState'),
  getScene: on('getScene'),
  project: OFF,
  exportGlb: on('exportGlb'),
  exportUsdz: on('exportUsdz'),
  getFurnitureVisible: OFF,
  getLocale: OFF,
  focusRoom: on('focusRoom'),
  stepCamera: on('stepCamera'),
  setFurnitureVisible: on('setFurnitureVisible'),
  setLightTemperature: on('setLightTemperature'),
  setQuality: on('setQuality'),
  refreshTheme: OFF,
  setLocale: on('setLocale'),
  setSelection: on('setSelection'),
  planView: OFF,
  setCheckpointOverlay: OFF,
  isCheckpointOverlayVisible: OFF,
  addCheckpoint: OFF,
  startCheckpointPlacement: OFF,
  cancelCheckpointPlacement: OFF,
  setCheckpointFromView: OFF,
  frameCheckpoint: OFF,
  lookThroughCheckpoint: OFF,
  endLookThrough: OFF,
  focusCheckpoint: OFF,
  revertCheckpointEdit: OFF,
  setAssetMoveTool: OFF,
  armAssetMove: OFF,
  revertAssetEdit: OFF,
  mirrorAsset: OFF,
  turnAsset: OFF,
  setPlanTool: OFF,
  revertPlanEdit: OFF,
  describeSelection: OFF,
  resize: on('resize'),
  // The events have their own table below.
  on: OFF,
  dispose: on('dispose'),
} as const satisfies HandleMemberTable;

export const TOUR_MEMBERS = {
  play: on('play'),
  pause: on('pause'),
  toggle: on('toggle'),
  stop: on('stop'),
  seek: on('seek'),
  seekDistance: on('seekDistance'),
  seekTime: on('seekTime'),
  setSpeed: on('setTourSpeed'),
  progress: on('progress'),
  on: OFF,
} as const satisfies TourMemberTable;

export const CAPTURE_MEMBERS = {
  still: on('captureStill'),
  panorama: on('capturePanorama'),
  // The host helper composes the pair from two stills (`JeexEmbed.capturePair`).
  pair: OFF,
  frames: OFF,
} as const satisfies CaptureMemberTable;

/** Wire methods with no handle member behind them. */
export const WIRE_ONLY_METHODS = {
  /** The host page's path for the frame's telemetry, sent by the helper itself. */
  context: true,
} as const satisfies Partial<Record<CommandMethod, true>>;

const BOTH = { wire: true, element: true } as const;
const ELEMENT_ONLY = { wire: false, element: true } as const;

/**
 * Every handle event. The authoring rows stay off the wire with the editing
 * members; the element re-emits them, so a host that edits through
 * `element.viewer` hears them as DOM events like every other.
 */
export const VIEWER_EVENTS = {
  ready: BOTH,
  error: BOTH,
  scene: BOTH,
  mode: BOTH,
  assets: BOTH,
  select: BOTH,
  // The batch the viewer did not commit: editing, so not across a frame.
  edit: ELEMENT_ONLY,
  // A host that draws its own tour bar follows the camera index and the speed button.
  walkCamera: BOTH,
  tourSpeed: BOTH,
  lightTemperature: BOTH,
  checkpointSelect: ELEMENT_ONLY,
  checkpointEdit: ELEMENT_ONLY,
  checkpointLookThrough: ELEMENT_ONLY,
  checkpointPlacing: ELEMENT_ONLY,
  assetEdit: ELEMENT_ONLY,
  assetEditRefused: ELEMENT_ONLY,
  assetMoveState: ELEMENT_ONLY,
  planEdit: ELEMENT_ONLY,
  planEditRefused: ELEMENT_ONLY,
  planToolState: ELEMENT_ONLY,
} as const satisfies ViewerEventTable;

/** The tour's events: on the wire under their own names, on the element as `jeex-tour-*`. */
export const TOUR_EVENTS = { progress: BOTH, state: BOTH, ended: BOTH } as const satisfies TourEventTable;

/** The handle events a table marks with `flag`. */
type Marked<T extends Record<string, EventRow>, F extends keyof EventRow> = {
  [K in keyof T]: T[K][F] extends true ? K : never;
}[keyof T];

export type WireViewerEvent = Marked<typeof VIEWER_EVENTS, 'wire'>;
export type ElementViewerEvent = Marked<typeof VIEWER_EVENTS, 'element'>;

/** The wire method each member row names. */
type MethodsOf<T> = { [K in keyof T]: T[K] extends { readonly method: infer M } ? M : never }[keyof T];
export type WireMethod =
  | MethodsOf<typeof HANDLE_MEMBERS>
  | MethodsOf<typeof TOUR_MEMBERS>
  | MethodsOf<typeof CAPTURE_MEMBERS>
  | keyof typeof WIRE_ONLY_METHODS;

function marked<T extends Record<string, EventRow>>(table: T, flag: keyof EventRow): Array<keyof T & string> {
  return Object.keys(table).filter((name) => table[name]![flag]);
}

/** The handle events the frame bridge forwards, in table order. */
export const WIRE_EVENTS = marked(VIEWER_EVENTS, 'wire') as readonly WireViewerEvent[];
/** The handle events the element re-emits, in table order. */
export const ELEMENT_EVENTS = marked(VIEWER_EVENTS, 'element') as readonly ElementViewerEvent[];

/** `jeex-` plus the event's name in kebab case: `lightTemperature` is `jeex-light-temperature`. */
type Kebab<S extends string> = S extends `${infer Head}${infer Tail}`
  ? `${Head extends Lowercase<Head> ? Head : `-${Lowercase<Head>}`}${Kebab<Tail>}`
  : S;
export type ElementEventName<K extends string> = `jeex-${Kebab<K>}`;

export function elementEventName<K extends string>(name: K): ElementEventName<K> {
  return `jeex-${name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}` as ElementEventName<K>;
}

export type TourEventName = keyof typeof TOUR_EVENTS;
/** The tour's events, in table order; every one is on the wire and on the element. */
export const TOUR_EVENT_NAMES = Object.keys(TOUR_EVENTS) as readonly TourEventName[];

/** The element's name for a tour event: `progress` is `jeex-tour-progress`. */
export function tourElementEventName(name: TourEventName): ElementEventName<`tour${Capitalize<TourEventName>}`> {
  return elementEventName(`tour${name[0]!.toUpperCase()}${name.slice(1)}` as `tour${Capitalize<TourEventName>}`);
}

/**
 * What a tour event carries once it leaves the handle, on the wire and on
 * the element alike: the state wrapped as `{ state }` (a host reads
 * `payload.state`), `ended` as `{}`, the progress as it is.
 */
export function tourEventPayload(name: TourEventName, value: unknown): unknown {
  if (name === 'state') return { state: value };
  return name === 'ended' ? {} : value;
}

/** The DOM events the element raises, each with its payload. */
export type ElementEventMap = { [K in ElementViewerEvent as ElementEventName<K>]: ViewerEventMap[K] } & {
  'jeex-tour-progress': TourProgress;
  'jeex-tour-state': { state: TourState };
  'jeex-tour-ended': Record<string, never>;
};

/** Every wire method the rows name, `context` included; equal to `METHOD_LIST`. */
export function wireMethods(): CommandMethod[] {
  const rows: MemberRow[] = [...Object.values(HANDLE_MEMBERS), ...Object.values(TOUR_MEMBERS), ...Object.values(CAPTURE_MEMBERS)];
  return [...rows.flatMap((row) => (row.wire ? [row.method] : [])), ...(Object.keys(WIRE_ONLY_METHODS) as CommandMethod[])];
}

// ------------------------------------------------------- compile-time checks

/** The wire methods equal `CommandMethod` and `METHOD_LIST`, both ways. */
type _MissingWireRow = Exclude<CommandMethod | (typeof METHOD_LIST)[number], WireMethod>;
((): _MissingWireRow extends never ? true : ['a wire method has no row', _MissingWireRow] => true)();
type _InventedWireRow = Exclude<WireMethod, (typeof METHOD_LIST)[number]>;
((): _InventedWireRow extends never ? true : ['a row names a method METHOD_LIST lacks', _InventedWireRow] => true)();

/** The members the host handle keeps for itself: they are not wire methods. */
type HostOwnMember = 'iframe' | 'viewerId' | 'ready' | 'player' | 'methods' | 'capturePair' | 'on';
/** The host handle has every wire method but the one it sends itself... */
type _MissingHostMember = Exclude<WireMethod, keyof JeexEmbed | keyof typeof WIRE_ONLY_METHODS>;
((): _MissingHostMember extends never ? true : ['JeexEmbed lacks a wire method', _MissingHostMember] => true)();
/** ...and nothing the table does not account for. */
type _InventedHostMember = Exclude<keyof JeexEmbed, WireMethod | HostOwnMember>;
((): _InventedHostMember extends never ? true : ['JeexEmbed has a member no row names', _InventedHostMember] => true)();

/** The wire events equal `EmbedEventMap`, less the two the frame page and the host raise themselves. */
type FrameOwnEvent = 'size' | 'disposed';
type WireEvent = WireViewerEvent | keyof typeof TOUR_EVENTS;
type _MissingWireEvent = Exclude<EventName, WireEvent | FrameOwnEvent>;
((): _MissingWireEvent extends never ? true : ['EmbedEventMap has an event no row puts on the wire', _MissingWireEvent] => true)();
type _InventedWireEvent = Exclude<WireEvent, EventName>;
((): _InventedWireEvent extends never ? true : ['a row puts an event on the wire EmbedEventMap lacks', _InventedWireEvent] => true)();
