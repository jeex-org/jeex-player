/**
 * Mount options: every viewer behaviour switch as a prop an embedding page
 * sets, before it is a button anyone can press.
 *
 * Invariant: `ViewerOptions` is the contract, `OPTION_SCHEMA` is the single
 * table describing every option (its kind, default, and the query/dataset
 * spelling it answers to), and `resolveViewerOptions` is the ONLY validator.
 * The query and dataset adapters are both two-line wrappers over
 * `optionsFromRecord`, which is syntactic — it reads a string and puts it
 * where the option lives, garbage included — so an invalid value is reported
 * once, in one place, with one message, whatever door it came in through.
 * Unknown keys are dropped rather than merged, so a typo in a host page
 * cannot smuggle state into the viewer.
 *
 * Pure module: no `three`, no DOM (a `DOMStringMap` is read as a plain record).
 */

import type { ViewerMode } from '../scene/types.js';
import type { HdriOption } from '../lighting/hdri-entry.js';
// TYPE only, and it must be: `ui/host-slots.ts` touches the DOM. The runtime
// copy of `SLOT_NAMES` this table validates against lives in `option-sets.ts`.
import type { SlotName } from '../ui/host-slots.js';
import { SLOT_VALUES, closedSet } from './option-sets.js';
import type { Locale } from '../ui/messages.js';
import type { SceneSource } from '../scene/scene-repository.js';
import type { OffersSource } from '../assets/offers.js';
import { createLogger, type Logger, type LogSink } from '../shared/logger.js';
import { resolveBySpec, resolveHdri, warnInvalid, withOptionSink, type OptionSpec } from './option-resolvers.js';
import { blankRecord, containerFor, descend, split, toDatasetKey, type SectionShorthands } from './option-paths.js';
import { asFlag, convertRaw } from './option-raw.js';

export type TourStartMode = 'play' | 'paused' | 'off';

export type ViewerOptions = {
  /** What the viewer opens in, and whether the mini-map is offered at all. */
  view: {
    /**
     * Initial mode. Default `'orbit'` (the 360 view on the presentation
     * camera). `'tour'` is what engages the tour at start — `tour.mode` then
     * says whether that engaged tour plays, waits, or stays off.
     */
    mode: ViewerMode;
    /** Mini-map in walk and tour. Default `true`. */
    minimap: boolean;
  };
  tour: {
    /**
     * How an ENGAGED tour starts. It only engages at start when
     * `view.mode === 'tour'`; with any other view mode the tour waits for the
     * Tour button and then behaves as this says.
     *
     * `'play'` (default): playing when the scene is ready.
     * `'paused'`: camera on the route at `start`, not moving.
     * `'off'`: presentation camera, tour only via the button or the API.
     */
    mode: TourStartMode;
    /** Initial position as a fraction of the route, used by `play` and `paused`. */
    start: number;
    /** Show the progress bar and its play/pause control. */
    progressBar: boolean;
    /**
     * Pointer, wheel or key input on the canvas pauses the tour and hands the
     * camera to the user. `false` ignores input while the tour is engaged,
     * which is what a scroll-driven embed wants.
     */
    pauseOnInput: boolean;
  };
  doors: {
    /**
     * Doors can be opened and shut from the viewer (hover affordance in orbit
     * and walk, auto-open on the tour route). `false` leaves every door open
     * and shows no affordance: no hover raycast, no HUD, nothing blocking a
     * walk.
     */
    interactive: boolean;
    /**
     * A door that is shut opens as the walker (or the tour) comes within
     * `DOOR_AUTO_OPEN_M` and shuts again once they are past
     * `DOOR_AUTO_CLOSE_M`, so a closed door is a door to walk through rather
     * than a puzzle. Default `true`.
     *
     * `false` is the pre-automation behaviour: a shut door blocks the walk
     * until it is opened by hand, and the tour opens the doors on its route
     * for good.
     */
    autoOpen: boolean;
  };
  interiors: {
    /**
     * Offer the interior-preset selector in the control bar. A scene that ships
     * no `interiors` never shows it, whatever this says.
     */
    selector: boolean;
  };
  /** Which parts of the viewer's own chrome are on screen at all. */
  chrome: {
    /** The brand lockup in the control bar; its context line is `scene.name`. */
    brand: boolean;
    /**
     * The control bar. `false` hides it and leaves the scene bare — what a
     * scroll-driven or kiosk embed wants. Playback and every command stay
     * scriptable through the handle: the chrome is a view of the options,
     * never the only way to reach them. The `reveal-controls`
     * pill that `wake()` offers after auto-hide FOLLOWS this flag: it cannot
     * appear while `controls` is off.
     */
    controls: boolean;
    /** The tour-status pill (`.tour-status`, "Now touring" / paused / …). Default `true`. */
    status: boolean;
    /** The mode switcher (`2D · 3D · 360 · Walk · Tour`). Default `true`. */
    modeSwitcher: boolean;
    /**
     * The hint card. Decoupled from `controls`: a host can show a hint
     * with the control bar hidden (an embed's own affordance) or the other way
     * round. Default `true`.
     */
    hint: boolean;
    /** Whether the control bar collapses to its reveal pill after an idle pause. `false` pins it open: no idle timer is armed, the bar never collapses and never goes `inert`, which is what a host that frames the viewer in its own UI needs (an editor host). Default `true`, so every embed that says nothing behaves exactly as before. */
    autoHide: boolean;
  };
  /**
   * The standalone fullscreen button, off by default: a floating icon
   * button `right`/`top` CSS px (`>= 0`, default 32) from the root's top-right corner, independent of
   * `chrome.controls`/`autoHide`, hidden while the viewer is fullscreen.
   */
  fullscreenButton: { show: boolean; right: number; top: number };
  /**
   * Read-only: no brand or Interior styles in the bar (Reset camera stays), and the built-in UI runs as
   * `edits: 'off'` (`edits-wiring.ts`). The handle keeps every command. Default `false`.
   */
  readonly: boolean;
  /**
   * What a rendered artefact carries with it.
   * The `Provenance` sidecar is unconditional — a JEEX artefact is a rendering
   * and never a photograph — so this decides only whether the sentence is also
   * burnt into the pixels, and which sentence that is.
   */
  capture: { disclosure: { caption: boolean; text?: string | undefined } };
  /** What `plan2d` draws beyond its always-on walls/openings/doors: room labels, facade dimensions, the camera marker. All default `true`. */
  plan: {
    labels: boolean;
    dimensions: boolean;
    camera: boolean;
  };
  /** Language of every string the viewer writes. Default `'en'`. */
  locale: Locale;
  /**
   * How the viewer treats a motion-sensitive visitor.
   *
   * `'auto'` (default) reads `prefers-reduced-motion` from the ENVIRONMENT the
   * caller resolved it from (`resolveViewerOptions`'s second argument) — this
   * module touches no media query itself, so it stays testable in Bun.
   * `'reduced'` forces the downgrade regardless of the media query; `'full'`
   * forces full motion even when the media query says reduce, for a host that
   * knows better than the visitor's OS setting. Reduced motion downgrades an
   * unspecified `tour.mode: 'play'` to `'paused'` and makes scripted camera
   * travel (`focusRoom`, a minimap click, `flyTo`) instant.
   */
  motion: 'auto' | 'full' | 'reduced';
  /**
   * How the canvas answers pointer input.
   *
   * `'full'` (default): the canvas catches every pointer gesture, as today.
   * `'none'`: the canvas gets `pointer-events: none` and `CameraInput` is not
   * even attached — a host running the viewer as a scroll-driven background
   * behind its own content. `'passive'`: `CameraInput` still attaches, but
   * every listener is `{ passive: true }` and never calls `preventDefault`,
   * so a host overlay with float panels keeps scrolling under it.
   */
  interaction: 'full' | 'none' | 'passive';
  /**
   * Whether a click on the scene raises the `select` event (`app/selection.ts`).
   * Default `false`: a published tour behaves exactly as it did before this
   * option existed — no pointer listener is attached at all. An EDITOR host
   * turns it on and subscribes; the viewer itself never changes what is
   * selected, it only reports.
   */
  select: boolean;
  /**
   * Boxes for the HOST's own chrome inside the viewport (`ui/host-slots.ts`).
   * Empty by default: nobody asked, so nothing is built. The
   * viewer positions a box and never reads what the host put in it. One name
   * outside `SLOT_NAMES` refuses the whole list: a box nothing lays out is
   * worse than no box.
   */
  slots: readonly SlotName[];
  /**
   * What the viewer's OWN panel does with an edit made in it.
   *
   * `'local'` (default): commits into its own `SceneModel`, as it always did,
   * so a published tour behaves exactly as before this option existed.
   * `'emit'`: the panel opens and nothing is committed — the `edit` event goes
   * out and the viewer waits for the host's document, so the two copies of it
   * cannot drift apart. `'off'`: a click opens no panel; only `select` is left.
   */
  edits: 'local' | 'emit' | 'off';
  /**
   * Installs the AUTHORING half of `window.__viewerDebug` (`applyOps`,
   * `exportScene`, `loadScene`, `layoutIssues`). It is an option rather than a
   * read of `location.search`, because in an embed that query string belongs
   * to the HOST page and says nothing about what the viewer should expose.
   * Defaults to a development build.
   */
  debug: boolean;
  /**
   * Where the first scene comes from (`scene-repository.ts`), and the extra
   * library "Replace with another…" offers (`assets/offers.ts`). Only their
   * `url` is in `OPTION_SCHEMA`: the other fields carry live objects, which
   * survive neither a query string nor an HTML attribute, so they are copied
   * through verbatim.
   */
  scene: SceneSource;
  offers?: OffersSource | undefined;
  /**
   * Where the viewer's warnings and errors go; absent, the console, prefixed
   * `[jeex-viewer]` (`shared/logger.ts`). A HOST OBJECT like `scene.document`:
   * not in `OPTION_SCHEMA`, no query or attribute spelling, copied verbatim.
   */
  onLog?: LogSink | undefined;
  /**
   * Turns a library material's logical texture path (`tex/<versionId>/<role>.<px>.webp` or `.ktx2`)
   * into the URL to fetch, for a host that serves its maps itself (signed or
   * `blob:` URLs); called lazily, once per size loaded, and answering an
   * absolute `http(s)` or `blob:` URL, else that surface stays flat. Absent:
   * paths resolve against the manifest folder. A HOST OBJECT like `onLog`, and
   * not part of the published viewer options JSON Schema.
   */
  resolveTexture?: ((path: string) => string | Promise<string>) | undefined;
  /**
   * Anonymous player telemetry (`TELEMETRY.md`). It FAILS CLOSED: only an
   * absent `mode` or exactly `'on'` sends; `'off'` and every other value
   * (`false`, `null`, `'OFF'`, `'none'`, an empty attribute) send nothing at
   * all. Global Privacy Control does the same whatever this says.
   * `analytics: 'off'` is shorthand for `{ mode: 'off' }`. `endpoint`
   * replaces where the sends go: an `https:` URL, or `http:` on this machine;
   * any other value turns sending off (it resolves to `''`). Default `on`, to
   * the default endpoint.
   */
  analytics: { mode: 'on' | 'off'; endpoint?: string | undefined };
  /**
   * The viewer's settings button: off by default, so visitors see none. `side`
   * is the control bar's inline edge it attaches to, by the bar's writing
   * direction: `'end'` (the default, next to «Interior style») or `'start'`.
   * Read once at mount; a side alone shows no button.
   */
  settings: { show: boolean; side: 'start' | 'end' };
  lighting: {
    /**
     * Colour temperature of the interior's artificial light (the lamps and the
     * walk's ambient floor), kelvin in steps of 100, or `null` for «Original»
     * (the default: every light keeps its own colour). Daylight never changes.
     * @minimum 2700
     * @maximum 6500
     * @multipleOf 100
     */
    temperature: number | null;
    /** A sky per sun preset for walk and tour (`HdriEntry`, README «Sky in walk and tour»); an object at mount only. */
    hdri: HdriOption;
  };
};

/**
 * Every leaf optional, recursively; what a host may pass to `mountViewer`.
 *
 * Three things are NOT recursed into, because `T[K] extends object` is true of
 * all of them and descending would turn each into something a host cannot pass:
 *
 * - a FUNCTION (`onLog`) — `DeepPartial<(e) => void>` is `{}`, which accepts
 *   any object at all and rejects nothing;
 * - an ARRAY — a partial array is a sparse one, and no option here is a list a
 *   host would want to patch element by element;
 * - `SceneSource` — its `document` is the host's own scene, opaque by design,
 *   and its `repository` is a live loader.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends SceneSource
    ? SceneSource
    : T[K] extends (...args: never[]) => unknown
      ? T[K]
      : T[K] extends readonly unknown[]
        ? T[K]
        : T[K] extends object
          ? DeepPartial<T[K]>
          : T[K];
};

/** What `mountViewer` takes: `DeepPartial<ViewerOptions>`, plus `fullscreenButton: true | false` for `{ show }` and `analytics: 'on' | 'off'` for `{ mode }`. */
export type ViewerOptionsInput = Omit<DeepPartial<ViewerOptions>, 'fullscreenButton' | 'analytics'> & {
  fullscreenButton?: DeepPartial<ViewerOptions['fullscreenButton']> | boolean;
  analytics?: DeepPartial<ViewerOptions['analytics']> | ViewerOptions['analytics']['mode'];
};
/** `ViewerOptionsInput`'s boolean sections and the field each sets; `satisfies` keeps the field a real one. */
const SECTION_SHORTHANDS = { fullscreenButton: 'show', analytics: 'mode' } as const satisfies SectionShorthands & {
  [K in keyof ViewerOptions]?: keyof ViewerOptions[K];
};

export const DEFAULT_VIEWER_OPTIONS: ViewerOptions = {
  view: { mode: 'orbit', minimap: true },
  tour: { mode: 'play', start: 0, progressBar: true, pauseOnInput: true },
  doors: { interactive: true, autoOpen: true },
  interiors: { selector: true },
  chrome: { brand: true, controls: true, status: true, modeSwitcher: true, hint: true, autoHide: true },
  fullscreenButton: { show: false, right: 32, top: 32 },
  readonly: false,
  capture: { disclosure: { caption: true } },
  plan: { labels: true, dimensions: true, camera: true },
  locale: 'en',
  motion: 'auto',
  interaction: 'full',
  select: false,
  slots: [],
  edits: 'local',
  // Vite replaces this statically: `true` under `npm run dev`, `false` in a
  // production build, and `undefined` under bun, where there is no `import.meta.env`.
  debug: (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true,
  // No default apartment: `resolveSceneSource` throws on an empty source, and
  // the demo page is the one that passes the fixture (`main.ts`).
  scene: {},
  analytics: { mode: 'on' },
  settings: { show: false, side: 'end' },
  lighting: { temperature: null, hdri: {} },
};

/**
 * Option paths whose value is a HOST OBJECT (a scene document, a repository, a library the host holds): never validated, spelled
 * in a query string or written in an attribute, but copied through verbatim; the loaders decide whether what arrived is usable.
 */
const OFFERS_HOST = ['offers.library', 'offers.baseUrl'];
const OPAQUE_PATHS: readonly string[] = ['scene.document', 'scene.repository', 'scene.library', ...OFFERS_HOST, 'onLog', 'resolveTexture'];

// Each closed set is proved complete against its union (`closedSet`, `option-sets.ts`).
const TOUR_MODES = closedSet<TourStartMode>()(['play', 'paused', 'off']);
/** In mode-bar order, which is also the documented order of `?view=`. */
const VIEW_MODES = closedSet<ViewerMode>()(['plan2d', 'plan3d', 'orbit', 'walk', 'tour']);
const MOTION_MODES = closedSet<ViewerOptions['motion']>()(['auto', 'full', 'reduced']);
const INTERACTION_MODES = closedSet<ViewerOptions['interaction']>()(['full', 'none', 'passive']);
const EDITS_MODES = closedSet<ViewerOptions['edits']>()(['local', 'emit', 'off']);
const SETTINGS_SIDES = closedSet<ViewerOptions['settings']['side']>()(['start', 'end']);
const ANALYTICS_MODES = closedSet<ViewerOptions['analytics']['mode']>()(['on', 'off']);

/** Every dotted (or top-level) path `OPTION_SCHEMA` declares a row for. */
export type OptionPath =
  | 'view.mode'
  | 'view.minimap'
  | 'tour.mode'
  | 'tour.start'
  | 'tour.progressBar'
  | 'tour.pauseOnInput'
  | 'doors.interactive'
  | 'doors.autoOpen'
  | 'interiors.selector'
  | 'chrome.brand'
  | 'chrome.controls'
  | 'chrome.status'
  | 'chrome.modeSwitcher'
  | 'chrome.hint'
  | 'chrome.autoHide'
  | 'fullscreenButton.show'
  | 'fullscreenButton.right'
  | 'fullscreenButton.top'
  | 'readonly'
  | 'capture.disclosure.caption'
  | 'capture.disclosure.text'
  | 'plan.labels'
  | 'plan.dimensions'
  | 'plan.camera'
  | 'locale'
  | 'motion'
  | 'interaction'
  | 'select'
  | 'slots'
  | 'edits'
  | 'debug'
  | 'scene.url'
  | 'offers.url'
  | 'analytics.mode'
  | 'analytics.endpoint'
  | 'settings.show'
  | 'settings.side'
  | 'lighting.temperature';

/**
 * The single source of every mount option: what it is, its default, and how
 * the query string and the dataset spell it. `resolveViewerOptions` folds
 * this table to validate; `optionsFromRecord` folds it to read raw strings
 * off either adapter. Adding an option means adding one row here — nothing
 * else hand-writes a per-field parser.
 *
 * `as const satisfies Record<OptionPath, OptionSpec>`:
 * `satisfies` keeps the LITERAL key union and each row's literal `values`
 * array rather than widening to `Readonly<Record<string, OptionSpec>>`, which
 * is what let `embed/frame-bridge.ts` read `OPTION_SCHEMA['view.mode'].values`
 * without the `!` and the `as readonly ViewerMode[]` cast the widened form
 * would force.
 */
export const OPTION_SCHEMA = {
  'view.mode': { kind: 'enum', values: VIEW_MODES, default: DEFAULT_VIEWER_OPTIONS.view.mode, query: 'view', attr: 'view' },
  'view.minimap': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.view.minimap, query: 'minimap', attr: 'minimap' },
  'tour.mode': { kind: 'enum', values: TOUR_MODES, default: DEFAULT_VIEWER_OPTIONS.tour.mode, query: 'tour', attr: 'tour' },
  'tour.start': { kind: 'fraction', default: DEFAULT_VIEWER_OPTIONS.tour.start, query: 'tourStart', attr: 'tour-start' },
  'tour.progressBar': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.tour.progressBar, query: 'tourBar', attr: 'tour-bar' },
  'tour.pauseOnInput': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.tour.pauseOnInput, query: 'tourInput', attr: 'tour-input' },
  'doors.interactive': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.doors.interactive, query: 'doors', attr: 'doors' },
  'doors.autoOpen': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.doors.autoOpen, query: 'doorsAuto', attr: 'doors-auto' },
  'interiors.selector': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.interiors.selector, query: 'presets', attr: 'presets' },
  'chrome.brand': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.chrome.brand, query: 'brand', attr: 'brand' },
  'chrome.controls': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.chrome.controls, query: 'controls', attr: 'controls' },
  'chrome.status': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.chrome.status, query: 'chromeStatus', attr: 'chrome-status' },
  'chrome.modeSwitcher': {
    kind: 'flag',
    default: DEFAULT_VIEWER_OPTIONS.chrome.modeSwitcher,
    query: 'chromeModeSwitcher',
    attr: 'chrome-mode-switcher',
  },
  'chrome.hint': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.chrome.hint, query: 'chromeHint', attr: 'chrome-hint' },
  'chrome.autoHide': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.chrome.autoHide, query: 'chromeAutoHide', attr: 'chrome-auto-hide' },
  'fullscreenButton.show': {
    kind: 'flag',
    default: DEFAULT_VIEWER_OPTIONS.fullscreenButton.show,
    query: 'fullscreenButton',
    attr: 'fullscreen-button',
  },
  'fullscreenButton.right': {
    kind: 'pixels',
    default: DEFAULT_VIEWER_OPTIONS.fullscreenButton.right,
    query: 'fullscreenButtonRight',
    attr: 'fullscreen-button-right',
  },
  'fullscreenButton.top': {
    kind: 'pixels',
    default: DEFAULT_VIEWER_OPTIONS.fullscreenButton.top,
    query: 'fullscreenButtonTop',
    attr: 'fullscreen-button-top',
  },
  readonly: { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.readonly, query: 'readonly', attr: 'readonly' },
  'capture.disclosure.caption': {
    kind: 'flag',
    default: DEFAULT_VIEWER_OPTIONS.capture.disclosure.caption,
    query: 'captureCaption',
    attr: 'capture-caption',
  },
  'capture.disclosure.text': { kind: 'string', default: undefined, query: 'captureCaptionText', attr: 'capture-caption-text' },
  'plan.labels': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.plan.labels, query: 'planLabels', attr: 'plan-labels' },
  'plan.dimensions': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.plan.dimensions, query: 'planDimensions', attr: 'plan-dimensions' },
  'plan.camera': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.plan.camera, query: 'planCamera', attr: 'plan-camera' },
  locale: { kind: 'locale', default: DEFAULT_VIEWER_OPTIONS.locale, query: 'lang', attr: 'lang' },
  motion: { kind: 'enum', values: MOTION_MODES, default: DEFAULT_VIEWER_OPTIONS.motion, query: 'motion', attr: 'motion' },
  interaction: {
    kind: 'enum',
    values: INTERACTION_MODES,
    default: DEFAULT_VIEWER_OPTIONS.interaction,
    query: 'interaction',
    attr: 'interaction',
  },
  select: { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.select, query: 'select', attr: 'select' },
  slots: { kind: 'list', values: SLOT_VALUES, default: DEFAULT_VIEWER_OPTIONS.slots, query: 'slots', attr: 'slots' },
  edits: { kind: 'enum', values: EDITS_MODES, default: DEFAULT_VIEWER_OPTIONS.edits, query: 'edits', attr: 'edits' },
  debug: { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.debug, query: 'debug', attr: 'debug' },
  'scene.url': { kind: 'string', default: undefined, query: 'scene', attr: 'src' },
  'offers.url': { kind: 'string', default: undefined, query: 'offers', attr: 'offers' },
  'analytics.mode': { kind: 'switch', values: ANALYTICS_MODES, default: 'on', query: 'analytics', attr: 'analytics' },
  'analytics.endpoint': { kind: 'endpoint', default: undefined, query: 'analyticsEndpoint', attr: 'analytics-endpoint' },
  'settings.show': { kind: 'flag', default: DEFAULT_VIEWER_OPTIONS.settings.show, query: 'settings', attr: 'settings' },
  'settings.side': {
    kind: 'enum',
    values: SETTINGS_SIDES,
    default: DEFAULT_VIEWER_OPTIONS.settings.side,
    query: 'settingsSide',
    attr: 'settings-side',
  },
  'lighting.temperature': { kind: 'temperature', default: null, query: 'lightTemperature', attr: 'light-temperature' },
} as const satisfies Record<OptionPath, OptionSpec>;

/** `overlay="kiosk"`/`"embed"`/`"unbranded"`: sugar over other options, not itself a `ViewerOptions` field. */
export type Overlay = (typeof OVERLAY_MODES)[number];
const OVERLAY_MODES = ['none', 'kiosk', 'embed', 'unbranded'] as const;

/** The compound `chrome`/`overlay`/`unbranded` attributes; none is a `ViewerOptions` field, so all three live here, not as an `OPTION_SCHEMA` row. `unbranded` aliases `overlay=unbranded` (MLS-feed spelling, README); an explicit `overlay=` always wins — `applyOverlayPreset`. */
export const COMPOUND_SCHEMA = {
  chrome: { kind: 'flag', default: true, query: 'chrome', attr: 'chrome' },
  overlay: { kind: 'enum', values: OVERLAY_MODES, default: 'none', query: 'overlay', attr: 'overlay' },
  unbranded: { kind: 'flag', default: false, query: 'unbranded', attr: 'unbranded' },
} as const satisfies Record<'chrome' | 'overlay' | 'unbranded', OptionSpec>;

/** One preset per `Overlay`, merged onto the result before the compound `chrome` and the individual attributes (order: overlay -> chrome -> individual). `kiosk` also zeroes `chrome.hint`. `unbranded` is the strictest portal rule set (Idealista): brand/status/switcher/hint off, controls and minimap kept, tour paused at its start rather than playing before input, full pointer interaction. */
export const OVERLAY_PRESETS = {
  none: {},
  kiosk: {
    chrome: { controls: false, brand: false, status: false, modeSwitcher: false, hint: false },
    interaction: 'none',
  },
  embed: {
    chrome: { controls: false, brand: false },
    tour: { progressBar: true, pauseOnInput: false },
  },
  unbranded: {
    chrome: { brand: false, status: false, modeSwitcher: false, hint: false, controls: true },
    tour: { mode: 'paused', progressBar: true, pauseOnInput: true },
    view: { minimap: true },
    interaction: 'full',
  },
} as const satisfies Record<Overlay, DeepPartial<ViewerOptions>>;

/** Every `OPTION_SCHEMA` path under a dotted prefix, so a new row there needs no edit here. */
function pathsUnder(prefix: string): string[] {
  return Object.keys(OPTION_SCHEMA).filter((path) => path.startsWith(prefix));
}

/** The one `chrome.*` row the compound attribute must not zero. `satisfies OptionPath` is the point: `pathsUnder` hands back plain strings, so without it a typo here — or a rename of the schema row — would compile, quietly drop the exclusion and revert the contract below. */
const CHROME_BEHAVIOUR_PATH = 'chrome.autoHide' satisfies OptionPath;
/** The compound `chrome` attribute zeroes the chrome's VISIBILITY rows only. `chrome.autoHide` is deliberately not one of them: `chrome` says what is on screen, and `chrome="false" controls="true"` must give back exactly the bar the default gives, idle behaviour included. */
const CHROME_FLAG_PATHS = pathsUnder('chrome.').filter((path) => path !== CHROME_BEHAVIOUR_PATH);

/**
 * `chrome="false"`/`chrome=0` zeroes every path in `CHROME_FLAG_PATHS` before
 * the per-field loop runs, so `chrome-status="true"` alongside it still
 * wins. Reported through the LOGGER GIVEN — not the module `sink` — because
 * parsing runs before a host's `onLog` is known to `resolveViewerOptions`.
 */
function applyChromeCompound(
  result: Record<string, unknown>,
  read: (key: string) => string | undefined,
  keyOf: 'query' | 'attr',
  log: Logger,
): void {
  const spec = COMPOUND_SCHEMA.chrome;
  const raw = read(keyOf === 'query' ? spec.query : toDatasetKey(spec.attr));
  if (raw === undefined) return;
  const value = asFlag(raw);
  if (typeof value !== 'boolean') {
    warnInvalid(log, 'chrome', raw, spec.default);
    return;
  }
  if (value) return; // `chrome="true"` (or `1`) is a no-op.
  const chrome = (result['chrome'] ??= {}) as Record<string, unknown>;
  for (const path of CHROME_FLAG_PATHS) chrome[split(path).field] = false;
}

/** Merges one section-shaped partial — a row of `OVERLAY_PRESETS` — onto `result`, one level deep. */
function mergeSections(result: Record<string, unknown>, partial: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(partial)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign((result[key] ??= {}) as Record<string, unknown>, value);
    } else {
      result[key] = value;
    }
  }
}

/** `overlay="kiosk"`/`"embed"`/`"unbranded"` merges its `OVERLAY_PRESETS` row before `chrome` and the per-field loop. An explicit `overlay=` is decided on its own, valid or not, without ever looking at `unbranded` — so it wins in either order (`?unbranded=1&overlay=kiosk` and the reverse both resolve to plain `kiosk`). With no `overlay=` given, only `unbranded=true` does anything; `unbranded=0` is a no-op, not a request for `'none'`. */
function applyOverlayPreset(
  result: Record<string, unknown>,
  read: (key: string) => string | undefined,
  keyOf: 'query' | 'attr',
  log: Logger,
): void {
  const overlaySpec = COMPOUND_SCHEMA.overlay;
  const rawOverlay = read(keyOf === 'query' ? overlaySpec.query : toDatasetKey(overlaySpec.attr));
  if (rawOverlay !== undefined) {
    if (!(overlaySpec.values as readonly string[]).includes(rawOverlay)) {
      warnInvalid(log, 'overlay', rawOverlay, overlaySpec.default);
      return;
    }
    mergeSections(result, OVERLAY_PRESETS[rawOverlay as Overlay]);
    return;
  }
  const unbrandedSpec = COMPOUND_SCHEMA.unbranded;
  const rawUnbranded = read(keyOf === 'query' ? unbrandedSpec.query : toDatasetKey(unbrandedSpec.attr));
  if (rawUnbranded === undefined) return;
  const unbranded = asFlag(rawUnbranded);
  if (typeof unbranded !== 'boolean') {
    warnInvalid(log, 'unbranded', rawUnbranded, unbrandedSpec.default);
    return;
  }
  if (unbranded) mergeSections(result, OVERLAY_PRESETS.unbranded);
}

/**
 * What `resolveViewerOptions` reads about the environment it is running in,
 * rather than reaching for it itself: the media query result,
 * resolved by the CALLER from `matchMedia('(prefers-reduced-motion:
 * reduce)').matches`. Pure and testable in Bun — a boolean in, never a DOM
 * global read from inside this module.
 */
export type ViewerOptionsEnv = { reducedMotion?: boolean };

/**
 * Deep-merges a partial over the defaults, folding `OPTION_SCHEMA`. Unknown
 * keys are ignored and every invalid value falls back to its default with an
 * `onLog` warning, so a host page that misspells an option gets a working
 * viewer and a readable complaint instead of a blank canvas.
 */
export function resolveViewerOptions(partial?: ViewerOptionsInput, env: ViewerOptionsEnv = {}): ViewerOptions {
  const source = (partial ?? {}) as Record<string, unknown>;
  // Sections are read once each and cached; `Object.hasOwn` at both levels
  // (never a plain property read) so a `__proto__` key parsed out of JSON
  // can never stand in for a real section or field.
  const sections = Object.create(null) as Record<string, Record<string, unknown> | undefined>;
  const sectionOf = (name: string): Record<string, unknown> | undefined => {
    if (!(name in sections)) sections[name] = descend(source, name, SECTION_SHORTHANDS);
    return sections[name];
  };
  const given = (path: string): unknown => {
    const { section, field } = split(path);
    if (section === null) return Object.hasOwn(source, field) ? source[field] : undefined;
    const parent = sectionOf(section);
    return parent && Object.hasOwn(parent, field) ? parent[field] : undefined;
  };

  // The host's sink, in place before the first option is read, so a warning
  // about `locale` reaches the same place as one about `onLog`'s neighbours.
  const log = Object.hasOwn(source, 'onLog') ? (source['onLog'] as LogSink) : undefined;
  return withOptionSink(log, () => applyReducedMotion(foldOptions(given), given, env.reducedMotion === true));
}

/**
 * Reduced motion downgrades an UNSPECIFIED `tour.mode: 'play'` to `'paused'`.
 * Applied AFTER the generic fold: it depends on both the
 * resolved `motion` option and on whether the HOST set `tour.mode` itself,
 * and the fold has already forgotten the difference between "given" and
 * "defaulted" by the time it returns one value per path.
 */
function applyReducedMotion(options: ViewerOptions, given: (path: string) => unknown, reducedMotion: boolean): ViewerOptions {
  const reduced = options.motion === 'reduced' || (options.motion === 'auto' && reducedMotion);
  if (!reduced || options.tour.mode !== 'play' || given('tour.mode') !== undefined) return options;
  return { ...options, tour: { ...options.tour, mode: 'paused' } };
}

/** The fold itself; `resolveViewerOptions` owns the sink around it. */
function foldOptions(given: (path: string) => unknown): ViewerOptions {
  const result = Object.create(null) as Record<string, unknown>;
  for (const [path, spec] of Object.entries(OPTION_SCHEMA)) {
    const { section, field } = split(path);
    const resolved = resolveBySpec(path, given(path), spec);
    if (section === null) result[field] = resolved;
    else containerFor(result, section, blankRecord)[field] = resolved;
  }
  containerFor(result, 'lighting', blankRecord)['hdri'] = resolveHdri(given('lighting.hdri'));
  // The host objects, copied through: there is nothing here to validate, and
  // dropping them would take the scene with them.
  for (const path of OPAQUE_PATHS) {
    const value = given(path);
    if (value === undefined) continue;
    const { section, field } = split(path);
    if (section === null) result[field] = value;
    else containerFor(result, section, blankRecord)[field] = value;
  }
  return result as unknown as ViewerOptions;
}

/**
 * The one adapter both `optionsFromQuery` and `optionsFromDataset` are two
 * lines over: folds `OPTION_SCHEMA`, reads each option's raw string through
 * `read`, and places every present one (garbage included) at its path in a
 * `DeepPartial<ViewerOptions>`. A section key appears only when at least one
 * of its fields was present, so an untouched section is not merged in at all.
 *
 * `log` is the sink an unrecognised COMPOUND value (`chrome="maybe"`,
 * `overlay="maybe"`) is reported through — optional because most callers have
 * none to give yet (see `applyChromeCompound`, `applyOverlayPreset`); the
 * ordinary per-field garbage below is left for `resolveViewerOptions`'s single
 * validator, as before.
 *
 * Pre-pass order — overlay, then chrome, then the per-field loop — is what
 * lets `overlay="kiosk" chrome-status="true"` still turn the status pill back
 * on, and `overlay="embed" chrome="false"` still zero every `chrome.*` field
 * embed's own preset left alone.
 */
export function optionsFromRecord(
  read: (key: string) => string | undefined,
  keyOf: 'query' | 'attr',
  log?: LogSink,
): DeepPartial<ViewerOptions> {
  const logger = createLogger(log);
  const result: Record<string, unknown> = {};
  applyOverlayPreset(result, read, keyOf, logger);
  applyChromeCompound(result, read, keyOf, logger);
  for (const [path, spec] of Object.entries(OPTION_SCHEMA)) {
    const key = keyOf === 'query' ? spec.query : toDatasetKey(spec.attr);
    const raw = read(key);
    if (raw === undefined) continue;
    const { section, field } = split(path);
    const value = convertRaw(spec.kind, raw);
    if (section === null) result[field] = value;
    else containerFor(result, section, () => ({}))[field] = value;
  }
  return result;
}

/** Every `OPTION_SCHEMA` row's `?<query>=` spelling (demo, dev, iframe embed), e.g. `?view=walk&tourStart=0.25&chrome=0`. */
export function optionsFromQuery(search: string, log?: LogSink): DeepPartial<ViewerOptions> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return optionsFromRecord((key) => params.get(key) ?? undefined, 'query', log);
}

/** Every `OPTION_SCHEMA` row's `data-<attr>` spelling (embedding), e.g. `data-view`, `data-tour-start`, `data-chrome`. */
export function optionsFromDataset(dataset: DOMStringMap, log?: LogSink): DeepPartial<ViewerOptions> {
  return optionsFromRecord((key) => dataset[key], 'attr', log);
}
