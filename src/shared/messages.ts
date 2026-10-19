/**
 * The message VOCABULARY: every key the catalogue can be asked for, the
 * canonical English text behind each one, and the shape a bound catalogue
 * answers through.
 *
 * Pure data plus a pure role interface — no locale-switching engine, no DOM,
 * no `ViewerMode`/`TourState` from a higher layer — so `camera/` and
 * `doors/`, which raise a hint by KEY without knowing a locale
 * (`camera-director.hint`, `camera/walk-doors.ts`, `doors/door-hud.ts`), can
 * depend on this without reaching into `ui/`. The engine
 * that turns a key into words for one locale — the Russian catalogue,
 * `registerLocale`, `createMessages`, `applyDomMessages`, and the two labels
 * that need a `ViewerMode`/`TourState` from a higher layer — stays in
 * `ui/messages.ts`, which re-exports every symbol here under its old public
 * name, so nothing importing `../ui/messages.js` has to change.
 *
 * `messages.ts` did not move here WHOLESALE: `TOUR_STATE_LABEL` needs
 * `TourState` (`camera/tour-player.ts`) and `MODE_HINT` needs `ViewerMode`
 * (`scene/types.ts`), both layers ABOVE `shared`, so the whole file moving
 * down would only trade the upward edge from `camera`/`doors` for a new,
 * worse one from `shared`. Only the part with no such dependency moves.
 */

/**
 * A language the viewer can answer in.
 *
 * A STRING rather than a closed union, because `registerLocale` lets a host add
 * one this build never heard of and the type has to admit it. `isLocale` is the
 * narrowing, and it asks the registry — not a literal list — so a host locale
 * is as real as a shipped one.
 */
export type Locale = string;

/**
 * The English catalogue: the canonical text, and — through `MessageKey` —
 * the complete set of keys every other catalogue is checked against.
 */
export const EN = {
  'hint.orbit': 'Drag to orbit · Space or right button + drag to pan · Scroll to zoom · Double-click to focus',
  'hint.walk': 'Drag to look · Click the floor to go there · Scroll to step forward/back · Space or right button + drag to move',
  'hint.scrollZoom': 'Use Ctrl + scroll to zoom',
  'hint.scrollZoomApple': 'Use ⌘ + scroll to zoom',
  'mark.madeWith': 'Made with JEEX',
  'hint.walkCameras': 'Walk freely, or press PageDown and PageUp to step between cameras',
  'walkCameras.label': 'Tour cameras',
  'walkCameras.previous': 'Previous camera',
  'walkCameras.next': 'Next camera',
  'walkCameras.position': 'Camera {n} of {count}',
  'cameraPreview.dragToAim': 'Drag to aim',
  'hint.tour': 'Autotour: one continuous run through the apartment · Click the scene to take control',
  'hint.room': '{name} · drag to orbit · double-click to focus',
  'hint.tourPaused': 'Tour paused · you are in control now',
  'hint.selected': '{name} · click anywhere else to deselect',
  'hint.fullscreenUnavailable': 'Fullscreen is not available in this browser',
  'hint.faceApplied': 'Wall finish applied to this wall only',
  'hint.facadeApplied': 'Facade finish applied',
  'hint.allFloorsApplied': 'Floor finish applied to every room',
  'hint.allWallsApplied': 'Wall finish applied to every room',
  'hint.allWallsAppliedFacadeKept': 'Wall finish applied to every room · facade unchanged',
  'hint.furnitureShown': 'Furniture shown',
  'hint.furnitureHidden': 'Clean apartment · furniture hidden',
  'hint.changeRefused': 'Change refused: {message}',
  'hint.planChanged': 'Plan changed · rebuilding the geometry',
  'hint.noClearPath': 'No clear path there · walk around first',
  'hint.travelling': 'Walking to {name} · click the scene to take over',
  'hint.arrivedInstantly': 'Jumped to {name}',
  'hint.alreadyHere': 'You are in {name}',
  'hint.routeClosed': 'That route is closed · try a doorway',
  'hint.doorClosed': 'The door is closed · hover it to open',
  'hint.plan2d': 'Floor plan · walls, doors and windows to scale',
  'hint.plan3d': 'Top view · the apartment from straight above',

  'tour.ready': 'Tour ready',
  'tour.playing': 'Tour in progress',
  'tour.paused': 'Tour paused',
  'tour.ended': 'Tour complete',
  'tour.button.pause': 'Pause',
  'tour.bar.label': 'Tour playback',
  'tour.bar.play': 'Play tour',
  'tour.bar.pause': 'Pause tour',
  'tour.bar.track': 'Tour position',
  'tour.bar.speed': 'Tour speed {speed}',

  'furniture.hide': 'Hide furniture',
  'furniture.show': 'Show furniture',
  'furniture.stateShown': 'Furniture: shown',
  'furniture.stateHidden': 'Furniture: hidden',
  'furniture.label': 'Furniture',
  'fullscreen.enter': 'Enter fullscreen',
  'fullscreen.exit': 'Exit fullscreen',
  'fullscreen.label': 'Fullscreen',
  'camera.reset': 'Reset camera',
  'controls.show': 'Show viewer controls',
  'controls.label': 'Viewer controls',
  'mode.label': 'Viewing mode',
  'minimap.label': 'Floor plan · click a room to walk there',
  'cameraPreview.label': 'What the selected tour camera sees',
  'cameraPreview.title': 'Camera view',
  'cameraPreview.lookThrough': 'Look through',
  'hint.checkpointPlacing': 'Placing a camera — click the floor (drag to aim) · Esc to cancel',
  'hint.assetMove': 'Drag to move, Q/E to turn, Esc to cancel',
  'hint.lookThrough': 'Looking through the camera — drag to look · WASD to move · Q/E for height · Enter to keep · Esc to cancel',
  'lookThrough.label': 'Looking through camera {n}',
  'lookThrough.done': 'Done',
  'lookThrough.cancel': 'Cancel',

  // The hidden live region's OWN copy — terser than the
  // mode hint, which stays mouse/keyboard-instruction text for the visible
  // hint card. `live.mode.*` is what a mode CHANGE announces, whichever
  // triggered it (a button, `setMode`, a room focus, the tour engaging).
  'live.mode.plan2d': 'Floor plan mode',
  'live.mode.plan3d': 'Top view mode',
  'live.mode.orbit': '360 view mode',
  'live.mode.walk': 'Walk mode',
  'live.mode.tour': 'Tour mode',
  'canvas.description': '{name}: {rooms}. {keys}',
  'canvas.keys':
    'Keys: W, A, S, D or the arrow keys to walk (to pan in 360); hold Shift to run; hold Space and drag to move; + and - zoom the view while walking.',

  'panel.floorFinish': 'Floor finish · {name}',
  'panel.wallFinish': 'Wall finish · {name}',
  'panel.replace': 'Replace · {name}',
  'panel.label': 'Surface finish',
  'panel.close': 'Close',
  'panel.scopeOnlyThisWall': 'Only this wall (corner to corner)',
  'panel.applyAllFloors': 'Apply to all floors',
  'panel.applyAllRoomWalls': 'Apply to all room walls',
  'panel.applyAllWalls': 'Apply to all walls',
  'panel.standardVariant': 'Standard variant',
  'panel.ownerFacade': 'Facade',
  'panel.ownerExterior': 'Exterior',

  'door.close': 'Close this door',
  'door.open': 'Open this door',

  'interiors.label': 'Interior styles',
  'interiors.applied': '{name} applied to the whole apartment',
  'panel.interiors': 'Interior style',

  'opening.window': 'Window',
  'opening.door': 'Door',
  'opening.entranceDoor': 'Entrance door',
  'opening.passage': 'Passage',
  'opening.generic': 'Opening',

  'loading.eyebrow': 'JEEX / LIVE SPACE',
  'loading.title': 'Preparing the apartment',
  'loading.default': 'Loading scene geometry',
  'loading.support': 'Checking rendering support',
  'loading.scene': 'Loading the apartment',
  'loading.geometry': 'Building apartment geometry',
  'loading.furniture': 'Arranging furniture and lights',
  'loading.ready': 'Ready',

  'error.eyebrow': 'VIEWER UNAVAILABLE',
  'error.title': 'The scene could not be loaded',
  'error.body': 'Try loading the demo again.',
  'error.retry': 'Try again',
  'error.noWebglTitle': 'Interactive 3D is unavailable',
  'error.noWebglBody': 'This browser does not expose WebGL. Showing a presentation preview instead.',
  'error.unknown': 'Unknown scene error',
  'error.notReady': 'The viewer is not ready yet',
  'error.contextLostTitle': 'The 3D view was interrupted',
  'error.contextLostBody': 'The browser released the graphics context. The apartment comes back by itself; use Try again if it does not.',

  'capture.disclosure': 'Rendered from a 3D model, not a photograph',

  'notice.degraded': 'Some demo assets are shown as placeholders',
  'viewer.label': 'JEEX apartment viewer',
  'canvas.label': 'Interactive 3D apartment scene',
  'canvas.fallbackLabel': 'Presentation preview of the apartment scene',
} as const;

export type MessageKey = keyof typeof EN;

/**
 * Every key a catalogue has to carry, in catalogue order.
 *
 * Derived from `EN` rather than written out, so it cannot drift: a key added to
 * the English catalogue is in this list on the same line, and
 * `registerLocale`'s `Record<MessageKey, string>` refuses a host catalogue
 * missing it.
 */
export const MESSAGE_KEYS = Object.keys(EN) as readonly MessageKey[];

/**
 * One viewer instance's copy of the catalogue.
 *
 * The locale is a FIELD, not a module variable: two viewers on one page each
 * hold their own `Messages` and answer in their own language at the same time.
 * Every module that writes a user-visible string takes one of these.
 */
export type Messages = {
  readonly locale: Locale;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
};

/** True when `key` exists in the catalogue; guards attributes read from the DOM. */
export function isMessageKey(key: string): key is MessageKey {
  return key in EN;
}

/**
 * The script a BARE language tag means in this product.
 *
 * CLDR expands `sr` to `sr-Cyrl-RS`, and the viewer ships no Cyrillic
 * catalogue. Answering a bare `sr` in Cyrillic is impossible; answering it in
 * Latin under the tag CLDR reads as Cyrillic is a decision, not a default — so
 * it is written down here, checked by a test, and stated in the README.
 *
 * Only BARE tags are redirected. A tag that names its script explicitly is
 * taken at its word: `sr-Cyrl` has no catalogue and is refused, never quietly
 * answered from the Latin one.
 */
export const DEFAULT_SCRIPT: Readonly<Record<string, string>> = { sr: 'sr-Latn' };

/**
 * A BCP-47 tag reduced to the shape a catalogue is keyed by: the language
 * lower-cased, plus the script subtag when the tag carries one, in its
 * canonical case — `SR-LATN` → `sr-Latn`, `ru-RU` → `ru`, `zh-Hant-TW` →
 * `zh-Hant`.
 *
 * Region and variants are dropped because no catalogue is regional: a viewer
 * does not say different words in Vienna and in Berlin. The script is the
 * four-letter subtag the grammar reserves for it, which is what tells
 * `sr-Latn` (script) from `QAB-XX` (region, two letters, dropped).
 *
 * Pure grammar, no registry: `ui/messages.ts`'s `resolveLocaleTag` is the one
 * that asks what this build can actually answer.
 */
export function canonicalLocaleTag(tag: string): string {
  const parts = tag
    .trim()
    .split('-')
    .filter((part) => part.length > 0);
  const language = (parts[0] ?? '').toLowerCase();
  if (language === '') return '';
  const script = parts.slice(1).find((part) => /^[A-Za-z]{4}$/.test(part));
  if (script === undefined) return language;
  return `${language}-${script[0]!.toUpperCase()}${script.slice(1).toLowerCase()}`;
}
