/**
 * The behaviour of `<jeex-viewer>`: read the attributes, give the element its
 * box, wait for the start, mount, subscribe, re-emit, dispose. It takes its
 * DOM through an `ElementHost` it is handed, so every rule here is testable
 * without a browser; `element.ts` is the adapter that supplies the host.
 *
 * Liveness invariant: after the start only `src`, `view` and `ratio` do
 * anything — they map onto `loadScene`, `setMode` and the box. Every other
 * option is read once, when the viewer is built, so changing its attribute
 * later is reported as the no-op it is instead of pretending to have applied.
 *
 * Batching invariant: the platform fires `attributeChangedCallback` once per
 * attribute, synchronously, so `view` and `src` set together in one script
 * would apply as two separate re-renders. Changes are collected and flushed in
 * ONE microtask.
 */

import { OPTION_SCHEMA, resolveViewerOptions, type DeepPartial, type ViewerOptions } from '../app/viewer-options.js';
import type { TourControls, TourProgress, TourState } from '../camera/tour-controls.js';
import type { ViewerHandle } from '../app/viewer-handle.js';
import { createLogger, type Logger, type LogSink } from '../shared/logger.js';
import { ViewerLibError } from '../shared/errors.js';
import { NO_SCENE_SOURCE, type SceneRepository } from '../scene/scene-repository.js';
import type { ViewerSelectionTarget } from '../app/selection.js';
import { resolveLocaleTag } from '../ui/messages.js';
import { parseRatio } from './ratio.js';
import { isLightTemperature } from '../lighting/colour-temperature.js';
import { ORIGINAL_TEMPERATURE } from '../app/option-raw.js';
import { PendingViewer } from './pending-viewer.js';
import type { ElementRuntime } from './element-runtime.js';
import {
  DEFAULT_TAG,
  READONLY_ATTRIBUTE,
  RATIO_ATTRIBUTE,
  SHADOW_ATTRIBUTE,
  SHADOW_NONE,
  SRC_ATTRIBUTE,
  TEMPERATURE_ATTRIBUTE,
  LOADING_ATTRIBUTE,
  effectOf,
  loadingPolicy,
  optionsFromAttributes,
  type ElementState,
} from './element-attributes.js';

/**
 * The scene source an element with no `src` mounts against.
 *
 * It exists so that "you did not name a scene" travels the same road as every
 * other failure — the error card, the `error` event, a disposable handle —
 * rather than out of `connectedCallback` as an exception nothing can catch.
 * `resolveSceneSource` would throw synchronously in the `ViewerApp`
 * constructor; a repository that rejects fails inside `init()`, where the shell
 * already exists.
 */
const MISSING_SCENE: SceneRepository = {
  load: () => Promise.reject(new ViewerLibError('no-scene-source', NO_SCENE_SOURCE)),
};

/** A sink that drops everything: the handle's early answers re-read the options, the mount reports them. */
const SILENT: LogSink = () => undefined;

/** Every element event starts with this; `ready` becomes `jeex-ready`. */
const EVENT_PREFIX = 'jeex-';

/**
 * The element's side of the contract, as little of the DOM as the controller
 * needs. A test supplies a plain object; the custom element supplies itself.
 */
export type ElementHost = {
  /** One attribute of the element, `null` when it is absent. */
  attribute(name: string): string | null;
  /**
   * The box the viewer will be built in; `shadow` says which tree it lives in.
   * Made at the connect, empty until the start.
   */
  mountPoint(shadow: boolean): HTMLElement;
  /** Fires one `CustomEvent` off the element, bubbling and composed. */
  emit(type: string, detail: unknown): void;
  /**
   * Puts the element in exactly one custom state, for `:state()`.
   *
   * Absent where `ElementInternals.states` is not supported (or where the host
   * is a plain test object): the element degrades to no states at all rather
   * than to a reflected attribute a page could forge.
   */
  setState?: ((state: ElementState) => void) | undefined;
  /**
   * Sets the element's OWN `lang`, for a host that named none: `lang`
   * inherits down the flat tree into a shadow root the same way it does into
   * light DOM, so this is what keeps the SHADOW HOST — not only
   * `viewer-shell.ts`'s root deep inside it — announcing the right language
   * to anything that inspects the element rather than its content.
   */
  setLang?: ((locale: string) => void) | undefined;
  /**
   * Gives the element its default box at this `ratio` attribute value
   * (`hostBoxCss`). Absent on a test object and a no-op in light DOM, where
   * there is no `:host` to style and the host page sizes the element itself.
   */
  setBox?: ((ratio: string | null) => void) | undefined;
  /**
   * Calls `start` once, when the viewer is wanted (`watchStart`), and answers
   * the cancel. Absent on a test object: the viewer is wanted at once.
   */
  whenWanted?: ((start: () => void) => () => void) | undefined;
};

/** Where the controller gets its runtime: the object itself (a test), or a loader. */
type RuntimeSource = ElementRuntime | (() => Promise<ElementRuntime>);

/**
 * A loader that imports the runtime once and shares the promise between every
 * element on the page; a failed import is not remembered, so a later start (a
 * reconnect) tries again.
 */
export function createRuntimeLoader(importer: () => Promise<ElementRuntime>): () => Promise<ElementRuntime> {
  let shared: Promise<ElementRuntime> | null = null;
  return () => {
    if (shared === null) {
      const attempt = importer();
      shared = attempt;
      attempt.catch(() => {
        if (shared === attempt) shared = null;
      });
    }
    return shared;
  };
}

/**
 * The element's runtime module: the `import()` is what keeps the viewer out of
 * the element bundle's eager download.
 */
const loadRuntime = createRuntimeLoader(() => import('./element-runtime.js').then((module) => module.elementRuntime));

export class ViewerElementController {
  private readonly host: ElementHost;
  private runtime: RuntimeSource;
  /** What `viewer` answers: one per connection, from the connect on. */
  private facade: PendingViewer | null = null;
  /** The running viewer, once started. */
  private handle: ViewerHandle | null = null;
  /** Cancels the wait for the start; a disconnected element must not start later. */
  private cancelStart: (() => void) | null = null;
  /** Whether the viewer is built in a shadow root; read once, at the connect. */
  private shadow = true;
  /** Every subscription taken out on the handle, undone on disconnect. */
  private subscriptions: Array<() => void> = [];
  /** The host page's sink, when it set one; the console otherwise. */
  onLog: LogSink | null = null;
  /** Attribute names changed since the last flush; one entry per name. */
  private readonly pending = new Set<string>();
  /** True while a microtask flush is already scheduled. */
  private flushing = false;

  constructor(host: ElementHost, runtime: RuntimeSource = loadRuntime) {
    this.host = host;
    this.runtime = runtime;
  }

  get viewer(): ViewerHandle | null {
    return this.facade;
  }
  get tour(): TourControls | null {
    return this.facade?.tour ?? null;
  }

  /** `<jeex-viewer>.setSelection(...)`: a no-op before the element is connected, queued before the start. */
  setSelection(target: ViewerSelectionTarget | null): void {
    this.facade?.setSelection(target);
  }

  /**
   * Gives the element its box and waits for the start, once.
   * `connectedCallback` fires again every time the element is moved in the
   * DOM — and, in an upgrade, after `attributeChangedCallback` has already run
   * for the attributes present — so a second call while connected is ignored.
   */
  connect(): void {
    if (this.facade) return;
    this.setState('loading');
    this.shadow = this.host.attribute(SHADOW_ATTRIBUTE) !== SHADOW_NONE;
    const container = this.host.mountPoint(this.shadow);
    if (this.shadow) this.applyBox();
    const facade = new PendingViewer({
      options: () => resolveViewerOptions({ ...this.readOptions(SILENT), onLog: SILENT }),
      container: () => container,
      report: (error) => this.log().error('queued-call-failed', `<${DEFAULT_TAG}>: a call queued before the start failed`, error),
    });
    this.facade = facade;
    this.container = container;
    let begun = false;
    const start = (): void => {
      begun = true;
      this.start(facade);
    };
    const eager = loadingPolicy(this.host.attribute(LOADING_ATTRIBUTE)) === 'eager';
    const cancel = this.host.whenWanted && !eager ? this.host.whenWanted(start) : (start(), null);
    // A wait that started at once (no `IntersectionObserver`) has nothing left to cancel.
    if (!begun) this.cancelStart = cancel;
  }

  /** The box of this connection, made at the connect. */
  private container: HTMLElement | null = null;

  /** Loads the runtime (once per page) and builds the viewer, unless the connection it was for has ended. */
  private start(facade: PendingViewer): void {
    this.cancelStart = null;
    if (this.facade !== facade || facade.disposed) return;
    const runtime = this.runtime;
    if (typeof runtime !== 'function') {
      this.build(runtime, facade);
      return;
    }
    runtime().then(
      (loaded) => {
        this.runtime = loaded;
        this.build(loaded, facade);
      },
      (error: unknown) => this.failToLoad(facade, error),
    );
  }

  /** The runtime could not be imported: no viewer, so the element says so itself. */
  private failToLoad(facade: PendingViewer, cause: unknown): void {
    if (this.facade !== facade) return;
    const error = new ViewerLibError('internal', `<${DEFAULT_TAG}>: the viewer module could not be loaded`, { cause });
    this.log().error('runtime-load-failed', error.message, cause);
    this.setState('error');
    this.host.emit(`${EVENT_PREFIX}error`, { code: error.code, message: error.message });
    facade.fail(error);
  }

  /** Builds the viewer into its box and hands it to the waiting handle. */
  private build(runtime: ElementRuntime, facade: PendingViewer): void {
    const container = this.container;
    if (this.facade !== facade || facade.disposed || container === null) return;
    const handle = runtime.mount(container, this.readOptions());
    // BEFORE `this.handle` is assigned — `setLang` sets the
    // element's own `lang` PROPERTY, which is reflected onto the `lang`
    // ATTRIBUTE and would otherwise reach `attributeChanged('lang')` as if
    // the HOST had changed a frozen attribute after the mount, logging a
    // spurious `attribute-read-once` warning for a change this library made
    // to itself. `attributeChanged` no-ops while `this.handle` is still
    // null, which is what keeps this call from being its own false alarm.
    // Only where the host named no `lang` of its own: rewriting an
    // attribute the host set on its own markup is not this library's to do.
    this.host.setLang?.(handle.getLocale());
    this.handle = handle;
    // First, so the handle's own listeners run before the element re-emits an event (`PendingViewer.attach`).
    facade.attach(handle);
    this.subscriptions = [
      handle.on('ready', (info) => {
        this.setState('ready');
        this.host.emit(`${EVENT_PREFIX}ready`, info);
      }),
      handle.on('error', (error) => {
        this.setState('error');
        this.host.emit(`${EVENT_PREFIX}error`, error);
      }),
      handle.on('scene', (info) => this.host.emit(`${EVENT_PREFIX}scene`, info)),
      handle.on('mode', (mode) => this.host.emit(`${EVENT_PREFIX}mode`, mode)),
      handle.on('select', (selection) => this.host.emit(`${EVENT_PREFIX}select`, selection)),
      // The custom element is the SECOND FORM of the ES module, not a
      // frame boundary, so it forwards every handle event — the iframe
      // protocol deliberately does not carry `edit`.
      handle.on('edit', (edit) => this.host.emit(`${EVENT_PREFIX}edit`, edit)),
      handle.tour.on('progress', (progress: TourProgress) => this.host.emit(`${EVENT_PREFIX}tour-progress`, progress)),
      handle.tour.on('state', (state: TourState) => this.host.emit(`${EVENT_PREFIX}tour-state`, { state })),
      handle.tour.on('ended', () => this.host.emit(`${EVENT_PREFIX}tour-ended`, {})),
      handle.on('lightTemperature', (change) => this.host.emit(`${EVENT_PREFIX}light-temperature`, change)),
    ];
  }

  /**
   * The element was reparented with `moveBefore()`, not removed and re-added.
   *
   * The platform calls this INSTEAD of `disconnectedCallback` +
   * `connectedCallback`, so the running viewer — its WebGL context, its scene,
   * its tour position — survives a host moving `<jeex-viewer>` into a dialog.
   * Tearing down and rebuilding here would be the very flash the API exists to
   * remove (Baseline limited availability, no Safari, where the plain
   * disconnect/reconnect path still runs).
   *
   * It has a body only so the intent is written down: keeping the viewer IS the
   * behaviour, and a future edit that adds teardown here has to argue with this
   * comment.
   */
  move(): void {
    if (this.facade) return;
    // A move that arrives before the connect (an element upgraded and moved in
    // the same task) still has to give the element its box and its wait.
    this.connect();
  }

  /** Frees the renderer and every subscription, or cancels the start; safe to call more than once. */
  disconnect(): void {
    this.cancelStart?.();
    this.cancelStart = null;
    this.facade?.close();
    this.facade = null;
    this.container = null;
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
    this.pending.clear();
    this.flushing = false;
    this.handle?.dispose();
    this.handle = null;
  }

  /**
   * Records one attribute change and schedules the flush.
   *
   * Before the start there is nothing to apply but the box: the start reads
   * every attribute at once, so the changes made until then are already in hand.
   *
   * The platform fires this callback once per attribute, synchronously, so a
   * host setting `view` and `src` in the same script would otherwise get two
   * re-renders and two `loadScene` calls. Collected in a `Set` — one entry per
   * NAME, so setting the same attribute twice in a task applies once — and
   * flushed in one microtask, which is still before the next paint.
   */
  attributeChanged(attribute: string): void {
    // Before the start only the box is live; the viewer reads the rest at the start.
    if (!this.handle) {
      if (this.facade && this.shadow && effectOf(attribute) === 'box') this.applyBox();
      // `loading` turned eager on an element still waiting: start it now.
      if (this.cancelStart && effectOf(attribute) === 'start' && loadingPolicy(this.host.attribute(LOADING_ATTRIBUTE)) === 'eager') {
        const facade = this.facade;
        this.cancelStart();
        if (facade) this.start(facade);
      }
      return;
    }
    this.pending.add(attribute);
    if (this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => this.flush());
  }

  /**
   * Applies every attribute that changed in this task, once.
   *
   * `src` last: a scene swap is the expensive one, and a `view` set alongside
   * it should be in place before the new document mounts rather than after.
   */
  private flush(): void {
    this.flushing = false;
    const changed = [...this.pending];
    this.pending.clear();
    if (!this.handle) return;
    const order = (attribute: string): number => (effectOf(attribute) === 'scene' ? 1 : 0);
    for (const attribute of changed.sort((left, right) => order(left) - order(right))) this.apply(attribute);
  }

  /** Applies one attribute change to the running viewer. */
  private apply(attribute: string): void {
    const handle = this.handle;
    if (!handle) return;
    const effect = effectOf(attribute);
    // Judged on its own: a bad value keeps the current temperature, not the resolver's default.
    if (effect === 'temperature') {
      this.applyTemperature(handle);
      return;
    }
    const options = resolveViewerOptions(this.readOptions());
    switch (effect) {
      case 'scene': {
        const url = options.scene.url;
        if (url === undefined) {
          this.log().warn('src-removed', `<${DEFAULT_TAG}>: ${SRC_ATTRIBUTE} was removed; the scene on screen stays`);
          return;
        }
        // The failure is already reported as a `jeex-error` event and on the
        // viewer's own error card; this keeps it from also being an unhandled
        // rejection in the host page's console.
        handle.loadScene({ url }).catch((error: unknown) => {
          this.log().error('load-scene-failed', `<${DEFAULT_TAG}>: loadScene failed`, error);
        });
        return;
      }
      case 'mode':
        handle.setMode(options.view.mode);
        return;
      case 'box':
        // CSS only: the running viewer just follows its box.
        this.applyBox();
        break;
      case 'start':
        // Once started, when to start no longer means anything.
        break;
      case 'frozen':
        this.log().warn(
          'attribute-read-once',
          `<${DEFAULT_TAG}>: ${attribute} is read once, when the element is connected; changing it now has no effect`,
          { attribute },
        );
    }
  }

  /**
   * `light-temperature` on a running viewer: a whole step of kelvin, or
   * `original` / no attribute for «Original». Anything else warns once and
   * keeps the temperature on screen. Before the start the mount reads it.
   */
  private applyTemperature(handle: ViewerHandle): void {
    const raw = this.host.attribute(TEMPERATURE_ATTRIBUTE);
    if (raw === null || raw === ORIGINAL_TEMPERATURE) {
      handle.setLightTemperature(null);
      return;
    }
    const value = Number(raw);
    if (raw.trim() !== '' && isLightTemperature(value)) {
      handle.setLightTemperature(value);
      return;
    }
    this.log().warn('option-invalid', `<${DEFAULT_TAG}>: ${TEMPERATURE_ATTRIBUTE}="${raw}" is not a temperature; keeping the current one`, {
      attribute: TEMPERATURE_ATTRIBUTE,
      value: raw,
    });
  }

  /** This element's sink: the host's `onLog` when it set one, else the console. */
  private log(): Logger {
    return createLogger(this.onLog ?? undefined);
  }

  /**
   * Applies the `ratio` attribute to the default box, and says so when the
   * value is not a ratio: the box then stays at `DEFAULT_RATIO`.
   */
  private applyBox(): void {
    const ratio = this.host.attribute(RATIO_ATTRIBUTE);
    if (ratio !== null && parseRatio(ratio) === null) {
      this.log().warn('ratio-invalid', `<${DEFAULT_TAG}>: ratio="${ratio}" is not a ratio like 16:9, 4:3 or 1; using 16:9`, { ratio });
    }
    this.host.setBox?.(ratio);
  }

  /** Moves the element into one custom state, where the host supports them. */
  private setState(state: ElementState): void {
    this.host.setState?.(state);
  }

  /**
   * The options this element mounts with.
   *
   * Two things happen here that the shared attribute reader cannot do, because
   * both are about the ELEMENT rather than about the option schema:
   *
   * - `lang` is a BCP-47 tag in HTML (`ru-RU`, `en-GB`, `sr`), and the
   *   catalogue is keyed by a canonical language(-script) tag. It is resolved
   *   here — region dropped, `sr` taken to `sr-Latn` — and a tag no catalogue
   *   answers (`sr-Cyrl`, `zh-Hant`) is dropped with a warning so the default
   *   stands rather than the resolver complaining about a value HTML
   *   considers perfectly good.
   * - a missing `src` becomes `MISSING_SCENE`, so `connectedCallback` never
   *   throws and the refusal reaches the host as an `error` event and a card.
   * - a missing `readonly` means READ-ONLY. The element is the form
   *   a site owner pastes for visitors, and a visitor must not get the finish
   *   and variant panels; editing is an explicit `readonly="0"`. The option's
   *   own default (`false`) is untouched: `mountViewer` is the authoring API
   *   and keeps it.
   */
  private readOptions(sink: LogSink | undefined = this.onLog ?? undefined): DeepPartial<ViewerOptions> {
    const options: DeepPartial<ViewerOptions> = optionsFromAttributes((name) => this.host.attribute(name), sink);
    if (this.onLog !== null) options.onLog = this.onLog;
    const lang = this.host.attribute(OPTION_SCHEMA['locale'].attr);
    if (lang !== null) {
      const resolved = resolveLocaleTag(lang);
      if (resolved === undefined) {
        delete options.locale;
        createLogger(sink).warn('locale-unknown', `<${DEFAULT_TAG}>: no catalogue for lang="${lang}"; falling back to the default`, {
          lang,
        });
      } else options.locale = resolved;
    }
    if (this.host.attribute(READONLY_ATTRIBUTE) === null) options.readonly = true;
    if (options.scene?.url === undefined) options.scene = { repository: MISSING_SCENE };
    return options;
  }
}
