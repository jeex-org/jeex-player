/**
 * `<jeex-viewer>`: the viewer as a tag, with the same options and the same
 * events as `mountViewer` — spelled as attributes and `CustomEvent`s.
 *
 * The module is split in two on purpose. `ViewerElementController` is the
 * BEHAVIOUR — read the attributes, mount, subscribe, re-emit, dispose — and it
 * takes its DOM through an `ElementHost` it is handed, so every rule below is
 * testable without a browser. `defineJeexViewer` is the ADAPTER: it declares
 * the `HTMLElement` subclass that supplies that host and registers it.
 *
 * The subclass is declared INSIDE `defineJeexViewer` rather than at module
 * level because `class extends HTMLElement` evaluates the base class at
 * definition time, and this module is imported by the library entry
 * (`embed/index.ts`) and by unit tests, neither of which has a DOM. A page
 * that calls `defineJeexViewer` has one by definition.
 *
 * Attribute invariant: the attributes are `OPTION_SCHEMA`'s own `attr`
 * spellings, read through the one adapter (`optionsFromRecord`) and validated
 * by the one validator (`resolveViewerOptions`). The element adds exactly one
 * name of its own, `shadow`, because that is a decision about the ELEMENT and
 * not about the viewer inside it.
 *
 * Liveness invariant: after the mount only `src` and `view` do anything —
 * they map onto `loadScene` and `setMode`, the two handle calls that exist for
 * changing a running viewer. Every other option is read once, when the viewer
 * is built, so changing its attribute later is reported as the no-op it is
 * instead of pretending to have applied.
 *
 * No-throw invariant: `connectedCallback` never throws. A synchronous throw
 * out of the platform's own callback (such as `mountViewer`'s `no scene
 * source`) reaches nothing a host can catch: the browser logs it and the page
 * carries on with an empty tag. So an element with no `src` mounts against a
 * repository that refuses, and the failure takes
 * the ORDINARY path: the viewer's own error card, a `jeex-error` event coded
 * `no-scene-source`, and a handle the host can dispose.
 *
 * Batching invariant: the platform fires `attributeChangedCallback` once per
 * attribute, synchronously, so `view` and `src` set together in one script
 * would apply as two separate re-renders. Changes are collected and flushed in
 * ONE microtask.
 */

import { mountViewerAs } from '../app/viewer-api.js';
import { ensureViewerStyles } from '../ui/viewer-shell.js';
import {
  COMPOUND_SCHEMA,
  OPTION_SCHEMA,
  optionsFromRecord,
  resolveViewerOptions,
  type DeepPartial,
  type ViewerOptions,
} from '../app/viewer-options.js';
import type { TourControls, TourProgress, TourState } from '../camera/tour-controls.js';
import type { ViewerHandle } from '../app/viewer-handle.js';
import { createLogger, type Logger, type LogSink } from '../shared/logger.js';
import { ViewerLibError } from '../shared/errors.js';
import { NO_SCENE_SOURCE, type SceneRepository } from '../scene/scene-repository.js';
import type { ViewerEditRequest, ViewerError, ViewerReadyInfo, ViewerSceneInfo } from '../app/viewer-events.js';
import type { ViewerMode } from '../scene/types.js';
import type { ViewerSelection, ViewerSelectionTarget } from '../app/selection.js';
import { resolveLocaleTag } from '../ui/messages.js';
import { DEFAULT_RATIO, cssAspectRatio, parseRatio } from './ratio.js';

/** The tag `defineJeexViewer` registers when it is given no other. */
export const DEFAULT_TAG = 'jeex-viewer';

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

/** Every element event starts with this; `ready` becomes `jeex-ready`. */
const EVENT_PREFIX = 'jeex-';

/**
 * The element's own attribute: `none` mounts into the light DOM, anything else
 * (including the absent attribute) into an open shadow root. It is not an
 * option because it decides where the viewer is BUILT, before there are any
 * options to resolve.
 */
export const SHADOW_ATTRIBUTE = 'shadow';
/** Value of `shadow` that keeps the viewer in the host's own tree. */
export const SHADOW_NONE = 'none';

/**
 * The element's second attribute of its own: the aspect ratio of its
 * DEFAULT box, `16:9` when absent (`embed/ratio.ts`). Like `shadow` it is about
 * the element, not the viewer inside it, so it is no option. It is live: the
 * box is CSS, and changing it costs no re-mount.
 */
export const RATIO_ATTRIBUTE = 'ratio';

/** The attribute that swaps the scene, and the one that switches the mode. */
const SRC_ATTRIBUTE = OPTION_SCHEMA['scene.url'].attr;
const VIEW_ATTRIBUTE = OPTION_SCHEMA['view.mode'].attr;
const READONLY_ATTRIBUTE = OPTION_SCHEMA['readonly'].attr;

/**
 * The element's default box, as the `:host` rule of its shadow root.
 *
 * A bare `<jeex-viewer src=…>` pasted into a CMS has no `display` and no
 * height of its own, which would render 0 px tall, so the default box is a
 * block at the host's width and `ratio` of it. A `:host` rule loses to every rule of the embedding page
 * and to an inline `style` (CSS Scoping, the outer context wins), so a host's
 * own `height`, `width`, `aspect-ratio` or `display` always takes over; a host
 * that sets both a width and a height gets exactly that box, because
 * `aspect-ratio` only fills in a dimension that is `auto`.
 *
 * Applied as a constructed sheet, not a `<style>`: no CSP directive governs
 * `adoptedStyleSheets` (README, "Content Security Policy").
 */
export function hostBoxCss(ratio: string | null): string {
  const parsed = ratio === null ? DEFAULT_RATIO : (parseRatio(ratio) ?? DEFAULT_RATIO);
  return `:host{display:block;position:relative;box-sizing:border-box;inline-size:100%;aspect-ratio:${cssAspectRatio(parsed)}}`;
}

/**
 * Box of the shadow-DOM mount point, as declarations rather than a `style`
 * string. The component stylesheet is scoped to `.jeex-viewer`, which is the
 * viewer's own root INSIDE this box, so there is no rule in it that could size
 * the box itself.
 *
 * Applied with `setProperty`: `style.cssText` and a `style` attribute both need
 * `style-src-attr 'unsafe-inline'` from the HOST's policy, and the CSSOM path
 * needs nothing (README, "Content Security Policy").
 */
export const MOUNT_BOX_STYLE: ReadonlyArray<readonly [string, string]> = [
  ['display', 'block'],
  ['position', 'relative'],
  ['inline-size', '100%'],
  ['block-size', '100%'],
];

/**
 * What the element watches: every option's attribute spelling, the compound
 * attributes (`COMPOUND_SCHEMA`, e.g. `chrome`), plus `shadow`.
 * `observedAttributes` is read once when the class is defined, so this is the
 * complete list — an attribute missing from it never reaches
 * `attributeChangedCallback` at all.
 */
export const OBSERVED_ATTRIBUTES: readonly string[] = [
  ...Object.values(OPTION_SCHEMA).map((spec) => spec.attr),
  ...Object.values(COMPOUND_SCHEMA).map((spec) => spec.attr),
  SHADOW_ATTRIBUTE,
  RATIO_ATTRIBUTE,
];

/**
 * `tour-start` → `tourStart`: the key `optionsFromRecord(read, 'attr')` asks
 * its reader for. It camel-cases the schema's `attr` the way `dataset` does,
 * and this is the inverse, so the reader can go back to the attribute name.
 * Covers `COMPOUND_SCHEMA` too (`chrome` → `chrome`), so the compound
 * pre-pass inside `optionsFromRecord` can read it off a real element the same
 * way it reads any other row.
 */
const ATTRIBUTE_OF_KEY: ReadonlyMap<string, string> = new Map(
  [...Object.values(OPTION_SCHEMA), ...Object.values(COMPOUND_SCHEMA)].map((spec) => [
    spec.attr.replaceAll(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
    spec.attr,
  ]),
);

/**
 * Reads the options off an element's attributes.
 *
 * The one thing it adds to `optionsFromRecord` is HTML's own convention for a
 * boolean attribute: `<jeex-viewer minimap>` has the value `''`, which means
 * "present", and `asFlag` only knows `0`/`1`/`false`/`true`. Everything else
 * — the spellings, the conversions, the complaint about a bad value — is the
 * schema's job and stays there. `log` is the element's own sink, so an
 * unrecognised compound value (`chrome="maybe"`) is reported through the
 * HOST's `onLog` rather than the console.
 */
export function optionsFromAttributes(read: (attribute: string) => string | null, log?: LogSink): DeepPartial<ViewerOptions> {
  return optionsFromRecord(
    (key) => {
      const attribute = ATTRIBUTE_OF_KEY.get(key);
      if (attribute === undefined) return undefined;
      const raw = read(attribute);
      if (raw === null) return undefined;
      return raw === '' ? 'true' : raw;
    },
    'attr',
    log,
  );
}

/**
 * The custom states a host may style with `jeex-viewer:state(...)`.
 *
 * `ElementInternals.states` rather than a reflected attribute: a host writing
 * `jeex-viewer:state(ready) { opacity: 1 }` gets no attribute-change round trip
 * and no way to fake the state from the outside (Baseline newly available,
 * Safari 17.4, so every write is behind a support check).
 */
const ELEMENT_STATES = ['loading', 'ready', 'error'] as const;
type ElementState = (typeof ELEMENT_STATES)[number];

/** What one attribute change does to a viewer that is already running. */
type AttributeEffect = 'scene' | 'mode' | 'box' | 'frozen';

/** Which of the four an attribute has; `frozen` is "read once, at mount". */
export function effectOf(attribute: string): AttributeEffect {
  if (attribute === SRC_ATTRIBUTE) return 'scene';
  if (attribute === VIEW_ATTRIBUTE) return 'mode';
  if (attribute === RATIO_ATTRIBUTE) return 'box';
  return 'frozen';
}

/**
 * The element's side of the contract, as little of the DOM as the controller
 * needs. A test supplies a plain object; the custom element supplies itself.
 */
type ElementHost = {
  /** One attribute of the element, `null` when it is absent. */
  attribute(name: string): string | null;
  /** The box to build the viewer in; `shadow` says which tree it lives in. */
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
};

/** How the controller builds a viewer; the seam a test replaces. */
type ElementMount = (container: HTMLElement, options: DeepPartial<ViewerOptions>) => ViewerHandle;

/** The public property surface of `<jeex-viewer>`, for a host that holds one. */
export type JeexViewerElement = HTMLElement & {
  /** The handle, or `null` before the element is connected. */
  readonly viewer: ViewerHandle | null;
  /** The tour controls of the mounted viewer, or `null` before the mount. */
  readonly tour: TourControls | null;
  /**
   * Where this element's warnings go. A PROPERTY rather than an attribute,
   * because an attribute is a string and this is a function; set it before the
   * element is connected for it to cover the mount too.
   */
  onLog: LogSink | null;
  /** Highlights one wall, opening, room or asset; `null` clears it. */
  setSelection(target: ViewerSelectionTarget | null): void;
};

export class ViewerElementController {
  private readonly host: ElementHost;
  private readonly mount: ElementMount;
  private handle: ViewerHandle | null = null;
  /** Every subscription taken out on the handle, undone on disconnect. */
  private subscriptions: Array<() => void> = [];
  /** The host page's sink, when it set one; the console otherwise. */
  onLog: LogSink | null = null;
  /** Attribute names changed since the last flush; one entry per name. */
  private readonly pending = new Set<string>();
  /** True while a microtask flush is already scheduled. */
  private flushing = false;

  constructor(host: ElementHost, mount: ElementMount = (container, options) => mountViewerAs({ embed: 'element' }, container, options)) {
    this.host = host;
    this.mount = mount;
  }

  get viewer(): ViewerHandle | null {
    return this.handle;
  }
  get tour(): TourControls | null {
    return this.handle?.tour ?? null;
  }

  /** `<jeex-viewer>.setSelection(...)`: a no-op before the element is connected. */
  setSelection(target: ViewerSelectionTarget | null): void {
    this.handle?.setSelection(target);
  }

  /**
   * Builds the viewer, once. `connectedCallback` fires again every time the
   * element is moved in the DOM — and, in an upgrade, after
   * `attributeChangedCallback` has already run for the attributes present —
   * so a second call while one is mounted is ignored rather than doubling it.
   */
  connect(): void {
    if (this.handle) return;
    this.setState('loading');
    const shadow = this.host.attribute(SHADOW_ATTRIBUTE) !== SHADOW_NONE;
    const mountPoint = this.host.mountPoint(shadow);
    if (shadow) this.applyBox();
    const handle = this.mount(mountPoint, this.readOptions());
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
    if (this.handle) return;
    // A move that arrives before anything was mounted (an element upgraded and
    // moved in the same task) still has to build the viewer.
    this.connect();
  }

  /** Frees the renderer and every subscription; safe to call more than once. */
  disconnect(): void {
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
   * Before the mount there is nothing to apply: `connect` reads every attribute
   * at once, so the changes an upgrade replays are already in hand.
   *
   * The platform fires this callback once per attribute, synchronously, so a
   * host setting `view` and `src` in the same script would otherwise get two
   * re-renders and two `loadScene` calls. Collected in a `Set` — one entry per
   * NAME, so setting the same attribute twice in a task applies once — and
   * flushed in one microtask, which is still before the next paint.
   */
  attributeChanged(attribute: string): void {
    if (!this.handle) return;
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
    const options = resolveViewerOptions(this.readOptions());
    switch (effectOf(attribute)) {
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
      case 'frozen':
        this.log().warn(
          'attribute-read-once',
          `<${DEFAULT_TAG}>: ${attribute} is read once, when the element is connected; changing it now has no effect`,
          { attribute },
        );
    }
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
  private readOptions(): DeepPartial<ViewerOptions> {
    const options: DeepPartial<ViewerOptions> = optionsFromAttributes((name) => this.host.attribute(name), this.onLog ?? undefined);
    if (this.onLog !== null) options.onLog = this.onLog;
    const lang = this.host.attribute(OPTION_SCHEMA['locale'].attr);
    if (lang !== null) {
      const resolved = resolveLocaleTag(lang);
      if (resolved === undefined) {
        delete options.locale;
        this.log().warn('locale-unknown', `<${DEFAULT_TAG}>: no catalogue for lang="${lang}"; falling back to the default`, { lang });
      } else options.locale = resolved;
    }
    if (this.host.attribute(READONLY_ATTRIBUTE) === null) options.readonly = true;
    if (options.scene?.url === undefined) options.scene = { repository: MISSING_SCENE };
    return options;
  }
}

/**
 * The element's public event map: what a `jeex-*` event carries.
 *
 * Merged into `HTMLElementEventMap` below, which is what types
 * `element.addEventListener('jeex-ready', …)`. `HTMLElementTagNameMap` alone
 * types `querySelector`/`createElement` and does NOT type events — both merges
 * are needed.
 */
type JeexViewerEventMap = {
  'jeex-ready': CustomEvent<ViewerReadyInfo>;
  'jeex-error': CustomEvent<ViewerError>;
  'jeex-scene': CustomEvent<ViewerSceneInfo>;
  'jeex-mode': CustomEvent<ViewerMode>;
  'jeex-select': CustomEvent<ViewerSelection>;
  'jeex-edit': CustomEvent<ViewerEditRequest>;
  'jeex-tour-progress': CustomEvent<TourProgress>;
  'jeex-tour-state': CustomEvent<{ state: TourState }>;
  'jeex-tour-ended': CustomEvent<Record<string, never>>;
};

declare global {
  interface HTMLElementTagNameMap {
    'jeex-viewer': JeexViewerElement;
  }
  interface HTMLElementEventMap extends JeexViewerEventMap {}
}

/**
 * Registers `<jeex-viewer>` (or the tag given). Idempotent: a page that loads
 * the element bundle twice, or calls this next to it, gets one registration
 * rather than the `NotSupportedError` a second `define` would throw.
 */
export function defineJeexViewer(tag: string = DEFAULT_TAG): void {
  if (customElements.get(tag)) return;
  customElements.define(
    tag,
    class extends HTMLElement {
      static readonly observedAttributes = [...OBSERVED_ATTRIBUTES];

      /**
       * The element's own internals, for `states`.
       *
       * `attachInternals()` is Baseline widely (Safari 16.4) but `states` is
       * only newly (Safari 17.4), so both are behind a check: an engine without
       * either gets an element that simply has no custom states, never one that
       * throws in its constructor.
       */
      readonly #internals: ElementInternals | null = typeof this.attachInternals === 'function' ? this.attachInternals() : null;

      readonly #controller: ViewerElementController = new ViewerElementController({
        attribute: (name) => this.getAttribute(name),
        mountPoint: (shadow): HTMLElement => {
          if (!shadow) return this;
          const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
          ensureViewerStyles(root);
          const box = this.ownerDocument.createElement('div');
          for (const [property, value] of MOUNT_BOX_STYLE) box.style.setProperty(property, value);
          root.replaceChildren(box);
          return box;
        },
        emit: (type, detail) => {
          // `composed` is what lets the event out of the shadow root; without it
          // a host listening on `document` would never see one.
          this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
        },
        setState: (state) => {
          const states = this.#internals?.states;
          if (!states) return;
          // Exactly one at a time: `loading` gives way to `ready` or `error`,
          // and a Retry that boots again goes back to `loading`.
          for (const name of ELEMENT_STATES) states.delete(name);
          states.add(state);
        },
        setLang: (locale) => {
          if (this.hasAttribute('lang')) return;
          this.lang = locale;
        },
        setBox: (ratio) => {
          const root = this.shadowRoot;
          if (!root || typeof CSSStyleSheet !== 'function' || !Array.isArray(root.adoptedStyleSheets)) return;
          if (this.#box === null) {
            this.#box = new CSSStyleSheet();
            root.adoptedStyleSheets = [this.#box, ...root.adoptedStyleSheets];
          }
          this.#box.replaceSync(hostBoxCss(ratio));
        },
      });

      /** This element's own `:host` sheet (`hostBoxCss`), made on the first mount. */
      #box: CSSStyleSheet | null = null;

      connectedCallback(): void {
        this.#controller.connect();
      }
      disconnectedCallback(): void {
        this.#controller.disconnect();
      }
      /**
       * `Element.moveBefore()` reparented this element rather than removing and
       * re-adding it: the platform calls THIS instead of the disconnect /
       * connect pair, and the running viewer keeps its WebGL context.
       */
      connectedMoveCallback(): void {
        this.#controller.move();
      }
      attributeChangedCallback(name: string): void {
        this.#controller.attributeChanged(name);
      }

      get viewer(): ViewerHandle | null {
        return this.#controller.viewer;
      }
      get tour(): TourControls | null {
        return this.#controller.tour;
      }
      get onLog(): LogSink | null {
        return this.#controller.onLog;
      }
      set onLog(sink: LogSink | null) {
        this.#controller.onLog = sink;
      }
      setSelection(target: ViewerSelectionTarget | null): void {
        this.#controller.setSelection(target);
      }
    },
  );
}
