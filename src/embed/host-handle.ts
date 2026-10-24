/**
 * The types of the host's handle on an embedded viewer (`host.ts`
 * `embedViewer`): what it answers and what it takes, every one of them
 * structural, so the helper still imports no viewer code (its 4 KB budget,
 * `scripts/budget-check.ts`).
 */

import type {
  CaptureStillRequest,
  CapturePanoramaRequest,
  EmbedEventMap,
  EventName,
  Locale,
  SceneData,
  TourProgress,
  TourSpeed,
  ViewerMode,
  Provenance,
  ViewerState,
  ViewerSelectionTarget,
} from './protocol.js';

/**
 * Structurally identical to `ExportGlbOptions` (`app/export-gltf.ts`), and
 * DELIBERATELY not imported from it, for the same reason as `EmbedLogEntry`:
 * `host.ts` may import no viewer code, or a page that embeds by iframe would
 * download the viewer it was avoiding. The two shapes are checked against
 * each other by `host.test.ts`.
 */
export type EmbedExportGlbOptions = {
  includeFurniture?: boolean;
  state?: 'current' | 'default';
  embedDocument?: boolean;
};

/** Structurally identical to `ExportUsdzOptions` (`app/export-usdz.ts`), for the same reason as `EmbedExportGlbOptions`. */
export type EmbedExportUsdzOptions = {
  includeFurniture?: boolean;
};

/**
 * One artefact as it crosses the frame boundary: the PNG bytes and the
 * provenance sidecar, both structured-cloned. A host turns the bytes into
 * whatever it needs (`new Blob([png], { type: 'image/png' })`, an upload, a
 * `File`) — the helper does not decide that for it.
 */
export type EmbedCapture = { png: ArrayBuffer; provenance: Provenance };

/** What the frame reports when its first scene is on screen. */
export type EmbedReady = EmbedEventMap['ready'];

/** Where the scene comes from, as a host may name it across a frame boundary. */
export type EmbedSceneSource = { url: string } | { document: unknown };

/**
 * The host's handle on an embedded viewer. Every call is a round trip, so
 * everything returns a promise — including the ones the in-page `ViewerHandle`
 * answers synchronously.
 */
export type JeexEmbed = {
  readonly iframe: HTMLIFrameElement;
  /** The id this frame answers to; generated when the host named none. */
  readonly viewerId: string;
  /** Resolves when the frame's first scene is on screen. */
  ready: Promise<EmbedReady>;
  play(): Promise<void>;
  pause(): Promise<void>;
  toggle(): Promise<void>;
  stop(): Promise<void>;
  seek(fraction: number): Promise<void>;
  seekDistance(metres: number): Promise<void>;
  seekTime(seconds: number): Promise<void>;
  /** The tour's speed setting; `progress` events carry it back. */
  setTourSpeed(speed: TourSpeed): Promise<void>;
  /** The tour's position, or `null` while the scene carries no clip. */
  progress(): Promise<TourProgress | null>;
  loadScene(source: EmbedSceneSource): Promise<void>;
  setMode(mode: ViewerMode): Promise<void>;
  getMode(): Promise<ViewerMode>;
  focusRoom(roomId: string): Promise<boolean>;
  /**
   * Mode, tour position, furniture, locale, scene and revision in ONE round
   * trip. Across a frame boundary the alternative is six messages whose answers
   * can disagree about the moment they describe.
   */
  getState(): Promise<ViewerState>;
  /**
   * A deep copy of the frame's committed document, or `null` before its first
   * scene is built. Answered before `ready`, like `dispose` — a host may ask
   * what is on screen before there is anything.
   */
  getScene(): Promise<SceneData | null>;
  setFurnitureVisible(visible: boolean): Promise<void>;
  setLocale(locale: Locale): Promise<void>;
  /** The colour temperature of the artificial light, kelvin from 2700 to 6500 in steps of 100, or `null` for «Original»; `lightTemperature` events carry changes back. */
  setLightTemperature(temperature: number | null): Promise<void>;
  /** Highlights one wall, opening, room or asset in the frame, or clears it with `null`. */
  setSelection(target: ViewerSelectionTarget | null): Promise<void>;
  /** Re-measures the frame's container, for a host whose own layout just changed. */
  resize(): Promise<void>;
  /**
   * One still of the frame's scene, with its provenance. Rejects `not-ready`
   * until the frame's first scene is on screen — the queue in front of every
   * command already waits for that.
   */
  captureStill(request: CaptureStillRequest): Promise<EmbedCapture>;
  /** One equirectangular 360 of one room, with its provenance. */
  capturePanorama(request: CapturePanoramaRequest): Promise<EmbedCapture>;
  /**
   * The staged picture and the unaltered original of the same shot, which is
   * what disclosure rules for virtually staged photos ask for. Two `captureStill`
   * round trips, composed here rather than in the frame.
   */
  capturePair(request: Omit<CaptureStillRequest, 'state'>): Promise<{ current: EmbedCapture; default: EmbedCapture }>;
  /**
   * The committed document as a GLB, with the element metadata table riding
   * along as `EXT_structural_metadata` / `EXT_mesh_features`
   * (`app/export-gltf.ts`). Crosses the frame boundary as an `ArrayBuffer` —
   * wrap it in a `Blob` (`type: 'model/gltf-binary'`) to hand it to a
   * download link or `URL.createObjectURL`. Rejects with `not-ready` before
   * the frame's first scene.
   */
  exportGlb(options?: EmbedExportGlbOptions): Promise<ArrayBuffer>;
  /**
   * The committed document as a USDZ, for iOS Quick Look (`app/export-usdz.ts`).
   * Crosses the frame boundary as an `ArrayBuffer`, the same shape `exportGlb`
   * uses. Rejects with `not-ready` before the frame's first scene.
   */
  exportUsdz(options?: EmbedExportUsdzOptions): Promise<ArrayBuffer>;
  /** Subscribes to one frame event; returns the unsubscribe, like `TourControls`. */
  on<K extends EventName>(event: K, callback: (payload: EmbedEventMap[K]) => void): () => void;
  /** Tells the frame to tear down, then removes it and stops listening. */
  dispose(): void;
};
