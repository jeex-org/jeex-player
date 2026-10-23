/**
 * What `<jeex-viewer>` reads off its own tag: the attribute names it watches,
 * how they become options, which of them stay live after the start, and the
 * default box the element gives itself before there is any viewer in it.
 *
 * Attribute invariant: the attributes are `OPTION_SCHEMA`'s own `attr`
 * spellings, read through the one adapter (`optionsFromRecord`) and validated
 * by the one validator (`resolveViewerOptions`). The element adds exactly two
 * names of its own, `shadow` and `ratio`, because those are decisions about the
 * ELEMENT and not about the viewer inside it.
 */

import { COMPOUND_SCHEMA, OPTION_SCHEMA, optionsFromRecord, type DeepPartial, type ViewerOptions } from '../app/viewer-options.js';
import type { LogSink } from '../shared/logger.js';
import { DEFAULT_RATIO, cssAspectRatio, parseRatio } from './ratio.js';

/** The tag `defineJeexViewer` registers when it is given no other. */
export const DEFAULT_TAG = 'jeex-viewer';

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

/**
 * The element's third attribute of its own, spelled like `<img loading>` and
 * `<iframe loading>`: when the viewer starts. `lazy`, the default, starts it
 * near the viewport or on an interaction (`element-start.ts`); `eager` starts it
 * at the connect, for a host that loads the element when it wants the player.
 * Like `shadow` and `ratio` it is about the element, so it is no option and has
 * no query or `data-` spelling.
 */
export const LOADING_ATTRIBUTE = 'loading';

/** When the element starts its viewer. */
export type LoadingPolicy = 'lazy' | 'eager';

/** The policy a `loading` value names: `eager` (any case) is eager, anything else — absent, empty, unknown — lazy, as for `<img>`. */
export function loadingPolicy(value: string | null): LoadingPolicy {
  return value?.toLowerCase() === 'eager' ? 'eager' : 'lazy';
}

/** The attribute that swaps the scene, and the one that switches the mode. */
export const SRC_ATTRIBUTE = OPTION_SCHEMA['scene.url'].attr;
export const VIEW_ATTRIBUTE = OPTION_SCHEMA['view.mode'].attr;
export const READONLY_ATTRIBUTE = OPTION_SCHEMA['readonly'].attr;

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
  LOADING_ATTRIBUTE,
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
export const ELEMENT_STATES = ['loading', 'ready', 'error'] as const;
export type ElementState = (typeof ELEMENT_STATES)[number];

/** What one attribute change does to a viewer that is already running. */
type AttributeEffect = 'scene' | 'mode' | 'box' | 'start' | 'frozen';

/** Which effect an attribute has; `frozen` is "read once, at mount", `start` matters only until the start. */
export function effectOf(attribute: string): AttributeEffect {
  if (attribute === SRC_ATTRIBUTE) return 'scene';
  if (attribute === VIEW_ATTRIBUTE) return 'mode';
  if (attribute === RATIO_ATTRIBUTE) return 'box';
  if (attribute === LOADING_ATTRIBUTE) return 'start';
  return 'frozen';
}
