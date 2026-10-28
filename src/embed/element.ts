/**
 * `<jeex-viewer>`: the viewer as a tag, with the same options and the same
 * events as `mountViewer` — spelled as attributes and `CustomEvent`s.
 *
 * Three modules make the element. `element-attributes.ts` is what it READS:
 * the attribute names, how they become options, the default box.
 * `ViewerElementController` (`element-controller.ts`) is the BEHAVIOUR — wait
 * for the start, mount, subscribe, re-emit, dispose — and it takes its DOM
 * through an `ElementHost` it is handed, so every rule is testable without a
 * browser. `defineJeexViewer`, here, is the ADAPTER: it declares the
 * `HTMLElement` subclass that supplies that host and registers it.
 *
 * The subclass is declared INSIDE `defineJeexViewer` rather than at module
 * level because `class extends HTMLElement` evaluates the base class at
 * definition time, and this module is imported by the library entry
 * (`embed/index.ts`) and by unit tests, neither of which has a DOM. A page
 * that calls `defineJeexViewer` has one by definition.
 *
 * No-throw invariant: `connectedCallback` never throws. A synchronous throw
 * out of the platform's own callback (such as `mountViewer`'s `no scene
 * source`) reaches nothing a host can catch: the browser logs it and the page
 * carries on with an empty tag. So an element with no `src` mounts against a
 * repository that refuses, and the failure takes
 * the ORDINARY path: the viewer's own error card, a `jeex-error` event coded
 * `no-scene-source`, and a handle the host can dispose.
 *
 * Start invariant: `connectedCallback` builds only the element's box. The
 * viewer itself — its module, its WebGL context, its textures — starts when
 * the element nears the viewport or is interacted with (`element-start.ts`),
 * and its module is imported only then (`element-runtime.ts`), so a player
 * below the fold costs the page nothing but this file. From the connect on,
 * `viewer` is a handle (`pending-viewer.ts`) that queues commands until the
 * start and then forwards to the running viewer; attributes changed before
 * the start are simply read at the start.
 */

import type { TourControls, TourProgress, TourState } from '../camera/tour-controls.js';
import type { ViewerHandle } from '../app/viewer-handle.js';
import type { LogSink } from '../shared/logger.js';
import type { ViewerEditRequest, ViewerError, ViewerReadyInfo, ViewerSceneInfo } from '../app/viewer-events.js';
import type { ViewerMode } from '../scene/types.js';
import type { ViewerSelection, ViewerSelectionTarget } from '../app/selection.js';
import { watchStart } from './element-start.js';
import { ViewerElementController } from './element-controller.js';
import {
  DEFAULT_TAG,
  ELEMENT_STATES,
  LOADING_ATTRIBUTE,
  MOUNT_BOX_STYLE,
  OBSERVED_ATTRIBUTES,
  hostBoxCss,
  loadingPolicy,
  type LoadingPolicy,
} from './element-attributes.js';

export {
  DEFAULT_TAG,
  MOUNT_BOX_STYLE,
  OBSERVED_ATTRIBUTES,
  LOADING_ATTRIBUTE,
  QUALITY_ATTRIBUTE,
  RATIO_ATTRIBUTE,
  SHADOW_ATTRIBUTE,
  SHADOW_NONE,
  effectOf,
  hostBoxCss,
  loadingPolicy,
  optionsFromAttributes,
} from './element-attributes.js';
export type { LoadingPolicy } from './element-attributes.js';
export { ViewerElementController } from './element-controller.js';

/** The public property surface of `<jeex-viewer>`, for a host that holds one. */
export type JeexViewerElement = HTMLElement & {
  /**
   * The handle, from the connect on, or `null` while the element is not
   * connected. Before the viewer has started it queues commands and answers
   * queries as a viewer before its first scene does (`pending-viewer.ts`).
   */
  readonly viewer: ViewerHandle | null;
  /** The tour controls of `viewer`, or `null` while the element is not connected. */
  readonly tour: TourControls | null;
  /**
   * Where this element's warnings go. A PROPERTY rather than an attribute,
   * because an attribute is a string and this is a function; set it before the
   * element is connected for it to cover the mount too.
   */
  onLog: LogSink | null;
  /**
   * The `loading` attribute, reflected like `HTMLImageElement.loading`: reads
   * `'lazy'` or `'eager'` (anything else reads lazy), and setting it sets the
   * attribute. Setting `'eager'` on an element that has not started starts it.
   */
  loading: LoadingPolicy;
  /** Highlights one wall, opening, room or asset; `null` clears it. */
  setSelection(target: ViewerSelectionTarget | null): void;
};

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
        whenWanted: (start) => watchStart(this, start),
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
      get loading(): LoadingPolicy {
        return loadingPolicy(this.getAttribute(LOADING_ATTRIBUTE));
      }
      set loading(value: string) {
        this.setAttribute(LOADING_ATTRIBUTE, value);
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
