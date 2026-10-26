/**
 * The viewer's own markup: one HTML template, built inside whatever container
 * the host passes, and addressed by `data-jeex` names instead of page ids.
 *
 * Invariant: NOTHING here — and nothing downstream of `ViewerRoots` — reaches
 * for `document.getElementById`. Two viewers on one page would then be invalid
 * HTML and every lookup would answer with the first one's node. Every element
 * is found with `root.querySelector('[data-jeex="…"]')`, so a lookup can only
 * ever return a node of THIS instance, and the same code works inside a shadow
 * root (the custom element).
 *
 * Missing-node invariant: `byName` throws `MissingShellNodeError`. The template
 * is a constant in this file, so a name that is not in it is a bug in the
 * viewer, never a case a caller should paper over with a fallback.
 *
 * The stylesheet is delivered by `ensureViewerStyles(root)`: one constructed
 * `CSSStyleSheet` per process, so N instances cost one sheet, not N `<style>` tags.
 *
 * Trusted Types invariant: this module assigns no string to `innerHTML`, and
 * neither does anything else in `src/`. The shell is DATA (`VIEWER_SHELL_TREE`)
 * built with `createElement` / `setAttribute` / `textContent` / `append`, so it
 * mounts unchanged under `require-trusted-types-for 'script'` and needs no
 * policy of its own — which matters, because a host's `trusted-types` directive
 * may restrict which policy names may be created at all.
 */

import { ViewerLibError } from '../shared/errors.js';
import { EN } from '../shared/messages.js';
import type { ViewerMode } from '../scene/types.js';
import { applyDomMessages, LIVE_MODE_LABEL, type Messages } from './messages.js';
import { MODE_LABELS } from './mode-labels.js';
import viewerCss from './styles/viewer.css?inline';
import { PLAN_CANVAS_NAME } from './plan-modes.js';
import { MINIMAP_NAME } from './minimap.js';
import { SCROLL_HINT_NAME } from './scroll-hint.js';
import { CAMERA_PREVIEW_NAME } from './camera-preview.js';
import { DOOR_HUD_NAME } from '../doors/door-hud.js';
import { TOUR_CHROME_NODES } from './tour-bar-markup.js';
import { REPLACE_POPUP_NODES } from './replace-popup-markup.js';

/** Class of the shell root; the whole component stylesheet is scoped to it. */
export const VIEWER_ROOT_CLASS = 'jeex-viewer';

/** Attribute every addressable node of the shell carries. */
export const SHELL_ATTRIBUTE = 'data-jeex';

/**
 * The ten custom properties a host may set to restyle the chrome, and the ONLY
 * ones this library promises; everything else in `styles/viewer.css` derives
 * from them. The sheet declares each default ON the viewer's own root
 * (`.jeex-viewer`), so only an UNLAYERED rule on that root itself wins — a rule
 * on `<jeex-viewer>`, a container or `body` is shadowed; inside the custom
 * element add a sheet to its shadow root or set the properties on the root.
 * README, "Theming", has the worked examples.
 */
export const THEME_PROPERTIES = [
  '--jeex-accent',
  '--jeex-surface',
  '--jeex-surface-text',
  '--jeex-radius',
  '--jeex-font',
  '--jeex-minimap-size',
  '--jeex-chrome-opacity',
  '--jeex-focus',
  /** `light` | `dark` | `light dark`: which half of every `light-dark()` colour resolves. */
  '--jeex-color-scheme',
  /** Corner inset of the corner slots, before `env(safe-area-inset-*)` raises it. */
  '--jeex-slot-inset',
  /** The 3D backdrop at the horizon, and the background before the first frame (`refreshTheme()` after a live change). */
  '--jeex-backdrop',
  /** The 3D backdrop at the zenith; a little lighter than the horizon by default. */
  '--jeex-backdrop-top',
  /** Text and icons on the accent. */
  '--jeex-on-accent',
  /** The loading and error cards. */
  '--jeex-state-surface',
] as const;

/**
 * The shadow parts a host may reach with `::part()`. Also the only ones
 * promised: a node with no `part` here is internal.
 *
 *     jeex-viewer::part(control-bar) { backdrop-filter: none; }
 */
export const SHELL_PARTS = ['canvas', 'control-bar', 'mode-bar', 'tour-bar', 'minimap', 'panel', 'hint'] as const;

/**
 * The `dataset` property `SHELL_ATTRIBUTE` appears as.
 *
 * It is named because a node's NAME is now one of its data attributes: code
 * that clears a node's `dataset` (the selection panel clears the identity of
 * what it was editing) must keep this one, or the node loses the only handle
 * anything has on it.
 */
export const SHELL_DATA_KEY = 'jeex';

/** CSS selector of a shell root, for code that has to walk up to one. */
export const VIEWER_ROOT_SELECTOR = `[${SHELL_ATTRIBUTE}="viewer"]`;

/**
 * Names of the overlays their own modules create (each exports its constant),
 * composed downward as the surface `scripts/browser-check.ts` asserts on.
 */
export const OVERLAY_NAMES = {
  planCanvas: PLAN_CANVAS_NAME,
  minimap: MINIMAP_NAME,
  doorHud: DOOR_HUD_NAME,
  scrollHint: SCROLL_HINT_NAME,
  cameraPreview: CAMERA_PREVIEW_NAME,
} as const;

/**
 * Every addressable node of the template, in document order. These are the
 * former `index.html` ids, unchanged in spelling — `scripts/browser-check.ts`
 * looks them up by name, so renaming one is a contract change.
 */
export const SHELL_NAMES = [
  'viewer',
  'scene-canvas',
  'loading-state',
  'loading-progress',
  'loading-label',
  'error-state',
  'error-title',
  'error-message',
  'retry-button',
  'viewer-ui',
  'control-bar',
  'brand-lockup',
  'brand-context',
  'mode-switcher',
  'furniture-button',
  'interiors-button',
  'reset-button',
  'fullscreen-button',
  'tour-status',
  'tour-status-label',
  'tour-status-progress',
  'tour-bar',
  'tour-play',
  'tour-track',
  'tour-speed',
  'finish-panel',
  'finish-title',
  'finish-close',
  'finish-swatches',
  'finish-scope',
  'finish-scope-label',
  'finish-scope-wall',
  'finish-all',
  'finish-other',
  'replace-popup',
  'replace-popup-title',
  'replace-popup-close',
  'replace-popup-list',
  'replace-popup-empty',
  'hint-card',
  'hint-toggle',
  'hint-text',
  'degraded-notice',
  'reveal-controls',
  'fullscreen-float',
  'live-region',
] as const;

export type ShellName = (typeof SHELL_NAMES)[number];

/** A name the template does not carry: a bug in the viewer, not a caller's case. */
export class MissingShellNodeError extends ViewerLibError {
  declare readonly code: 'internal';
  readonly shellName: string;

  constructor(shellName: string) {
    super('internal', `viewer shell: no node named "${shellName}"`, { detail: { shellName } });
    this.name = 'MissingShellNodeError';
    this.shellName = shellName;
  }
}

/** The element references the rest of the viewer works through. */
export type ViewerRoots = {
  /** The shell root inside the host's container; every lookup is scoped to it. */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The box the renderer, the overlays and the anchored panel measure against. */
  viewport: HTMLElement;
  byName: <T extends HTMLElement = HTMLElement>(name: ShellName) => T;
};

/**
 * A node of the shell, as data.
 *
 * The shell is data, not an HTML string parsed into a `<template>`. Under a
 * `require-trusted-types-for 'script'` policy (Baseline newly available since
 * 2026-02-24, so TT-enforcing hosts are not exotic) such a string
 * assignment throws a `TypeError`, and the way out that needs NO coordination
 * with the host is not to have a string at all — which
 * also lets the names, classes and translation markers be checked without a
 * parser. `svg` switches the namespace for a node and everything under it,
 * because an icon built with `createElement` renders nothing at all.
 */
export type ShellNode = {
  /** The `data-jeex` name, for the nodes anything looks up. */
  name?: ShellName;
  tag: string;
  /** Builds this node and its subtree in the SVG namespace. */
  svg?: true;
  attrs?: Readonly<Record<string, string>>;
  /** The node's text; a node has text or children, never both. */
  text?: string;
  children?: readonly ShellNode[];
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The four-corners glyph both fullscreen buttons (toolbar and floating) draw. */
const FULLSCREEN_ICON = 'M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4';

/** An icon: one `<svg>` with one `<path>`, in the 24-unit grid the CSS sizes. */
function icon(path: string, viewBox = '0 0 24 24'): ShellNode {
  return {
    tag: 'svg',
    svg: true,
    attrs: { viewBox, 'aria-hidden': 'true' },
    children: [{ tag: 'path', attrs: { d: path } }],
  };
}

/** One mode button of the switcher; `active` is the 360 default. */
function modeButton(mode: ViewerMode, active = false): ShellNode {
  return {
    tag: 'button',
    attrs: {
      class: active ? 'mode-button is-active' : 'mode-button',
      'data-mode': mode,
      type: 'button',
      'aria-pressed': String(active),
      // The visible name is `MODE_LABELS` in every locale and has
      // no `data-i18n`; only the description below follows the locale.
      title: EN[LIVE_MODE_LABEL[mode]],
      'data-i18n-attr': `title:${LIVE_MODE_LABEL[mode]}`,
    },
    text: MODE_LABELS[mode],
  };
}

/**
 * The shell, as a tree.
 *
 * It is the former `index.html` markup with `id="x"` replaced by `name: 'x'`
 * and the brand context left EMPTY: the line says which apartment is on
 * screen, and that is `scene.name` at document time, never a literal baked into
 * the viewer.
 *
 * `tabindex="0"` on the root is what makes the keyboard per instance: the
 * camera's key listeners live on this element, and a `pointerdown` on the
 * canvas focuses it (`camera-input.ts`).
 *
 * Every English string here is the STATIC DEFAULT of its `data-i18n` key, so
 * the markup reads correctly even if nothing translates it; `applyDomMessages`
 * refills it for the instance's locale while the tree is still off-page.
 */
export const VIEWER_SHELL_TREE: ShellNode = {
  name: 'viewer',
  tag: 'div',
  attrs: {
    class: VIEWER_ROOT_CLASS,
    tabindex: '0',
    'aria-label': 'JEEX apartment viewer',
    'data-i18n-attr': 'aria-label:viewer.label',
  },
  children: [
    {
      name: 'scene-canvas',
      tag: 'canvas',
      attrs: {
        class: 'scene-canvas',
        part: 'canvas',
        'aria-label': 'Interactive 3D apartment scene',
        'data-i18n-attr': 'aria-label:canvas.label',
        // camera-input.ts MOVE_KEYS, the modifiers and the walk zoom keys (ARIA grammar).
        'aria-keyshortcuts': 'w a s d ArrowUp ArrowDown ArrowLeft ArrowRight Shift Space Plus -',
        // aria-description, not aria-describedby (needs an id; this shell
        // carries none) -- rationale and source in ViewerChrome.setCanvasDescription.
      },
    },
    {
      name: 'loading-state',
      tag: 'section',
      attrs: { class: 'loading-state', 'aria-live': 'polite' },
      children: [
        { tag: 'div', attrs: { class: 'loading-mark' }, children: [{ tag: 'span' }, { tag: 'span' }, { tag: 'span' }] },
        { tag: 'p', attrs: { class: 'eyebrow', 'data-i18n': 'loading.eyebrow' }, text: 'JEEX / LIVE SPACE' },
        { tag: 'h1', attrs: { 'data-i18n': 'loading.title' }, text: 'Preparing the apartment' },
        { tag: 'div', attrs: { class: 'loading-track' }, children: [{ name: 'loading-progress', tag: 'div' }] },
        {
          name: 'loading-label',
          tag: 'p',
          attrs: { class: 'loading-label', 'data-i18n': 'loading.default' },
          text: 'Loading scene geometry',
        },
      ],
    },
    {
      name: 'error-state',
      tag: 'section',
      attrs: { class: 'state-card is-hidden', 'aria-live': 'assertive' },
      children: [
        { tag: 'p', attrs: { class: 'eyebrow', 'data-i18n': 'error.eyebrow' }, text: 'VIEWER UNAVAILABLE' },
        { name: 'error-title', tag: 'h1', attrs: { 'data-i18n': 'error.title' }, text: 'The scene could not be loaded' },
        { name: 'error-message', tag: 'p', attrs: { 'data-i18n': 'error.body' }, text: 'Try loading the demo again.' },
        {
          name: 'retry-button',
          tag: 'button',
          attrs: { class: 'button button-primary', type: 'button', 'data-i18n': 'error.retry' },
          text: 'Try again',
        },
      ],
    },
    {
      name: 'viewer-ui',
      tag: 'div',
      attrs: { class: 'viewer-ui is-hidden' },
      children: [
        {
          name: 'control-bar',
          tag: 'div',
          attrs: {
            class: 'control-bar',
            part: 'control-bar',
            role: 'group',
            'aria-label': 'Viewer controls',
            'data-i18n-attr': 'aria-label:controls.label',
            'data-collapsed': 'false',
          },
          children: [
            {
              name: 'brand-lockup',
              tag: 'div',
              attrs: { class: 'brand-lockup' },
              children: [
                { tag: 'span', attrs: { class: 'brand-dot' } },
                { tag: 'span', attrs: { class: 'brand-name' }, text: 'JEEX' },
                { tag: 'span', attrs: { class: 'brand-divider' } },
                { name: 'brand-context', tag: 'span', attrs: { class: 'brand-context' } },
              ],
            },
            {
              // Not a `<nav>`: five mode buttons are a plain GROUP, each its
              // own tab stop -- not a page-level navigation landmark, and
              // nesting one inside the control bar's own group read as invalid
              // ARIA composition on top of that.
              name: 'mode-switcher',
              tag: 'div',
              attrs: {
                class: 'mode-switcher',
                part: 'mode-bar',
                role: 'group',
                'aria-label': 'Viewing mode',
                'data-i18n-attr': 'aria-label:mode.label',
              },
              children: [modeButton('plan2d'), modeButton('plan3d'), modeButton('orbit', true), modeButton('walk'), modeButton('tour')],
            },
            {
              tag: 'div',
              attrs: { class: 'control-actions' },
              children: [
                {
                  name: 'furniture-button',
                  tag: 'button',
                  attrs: {
                    class: 'icon-button',
                    type: 'button',
                    'aria-label': 'Hide furniture',
                    'aria-pressed': 'false',
                    title: 'Furniture',
                    'data-i18n-attr': 'aria-label:furniture.hide,title:furniture.label',
                  },
                  children: [icon('M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M3 13a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5H3zM3 18v2m18-2v2')],
                },
                {
                  name: 'interiors-button',
                  tag: 'button',
                  attrs: {
                    class: 'icon-button is-hidden',
                    type: 'button',
                    'aria-label': 'Interior styles',
                    title: 'Interior styles',
                    'data-i18n-attr': 'aria-label:interiors.label,title:interiors.label',
                  },
                  children: [
                    icon(
                      'M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2H19a2 2 0 0 0 2-2 9 9 0 0 0-9-9.6M7.5 13.5h.01M9.5 8.5h.01M14.5 7.5h.01',
                    ),
                  ],
                },
                {
                  name: 'reset-button',
                  tag: 'button',
                  attrs: {
                    class: 'icon-button',
                    type: 'button',
                    'aria-label': 'Reset camera',
                    title: 'Reset camera',
                    'data-i18n-attr': 'aria-label:camera.reset,title:camera.reset',
                  },
                  children: [icon('M4 12a8 8 0 1 0 2.34-5.66L4 8.68M4 4v4.68h4.68')],
                },
                {
                  name: 'fullscreen-button',
                  tag: 'button',
                  attrs: {
                    class: 'icon-button',
                    type: 'button',
                    'aria-label': 'Enter fullscreen',
                    title: 'Fullscreen',
                    'data-i18n-attr': 'aria-label:fullscreen.enter,title:fullscreen.label',
                  },
                  children: [icon(FULLSCREEN_ICON)],
                },
              ],
            },
          ],
        },
        ...TOUR_CHROME_NODES,
        {
          name: 'finish-panel',
          tag: 'div',
          attrs: {
            class: 'finish-panel is-hidden',
            part: 'panel',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Surface finish',
            'data-i18n-attr': 'aria-label:panel.label',
            'data-open': 'false',
          },
          children: [
            {
              tag: 'div',
              attrs: { class: 'finish-head' },
              children: [
                { name: 'finish-title', tag: 'span', attrs: { class: 'finish-title' }, text: 'Floor finish' },
                {
                  name: 'finish-close',
                  tag: 'button',
                  attrs: { class: 'finish-close', type: 'button', 'aria-label': 'Close', 'data-i18n-attr': 'aria-label:panel.close' },
                  text: '×',
                },
              ],
            },
            { name: 'finish-swatches', tag: 'div', attrs: { class: 'finish-swatches' } },
            {
              name: 'finish-scope',
              tag: 'label',
              attrs: { class: 'finish-scope is-hidden' },
              children: [
                { name: 'finish-scope-wall', tag: 'input', attrs: { type: 'checkbox' } },
                {
                  name: 'finish-scope-label',
                  tag: 'span',
                  attrs: { 'data-i18n': 'panel.scopeOnlyThisWall' },
                  text: 'Only this wall (corner to corner)',
                },
              ],
            },
            {
              name: 'finish-all',
              tag: 'button',
              attrs: { class: 'finish-all is-hidden', type: 'button', 'data-i18n': 'panel.applyAllFloors' },
              text: 'Apply to all floors',
            },
            // A second footer action in a row of its own, under the first:
            // nothing that was in the panel moves when it is shown.
            {
              name: 'finish-other',
              tag: 'button',
              attrs: { class: 'finish-other is-hidden', type: 'button', 'data-i18n': 'panel.replaceWithAnother' },
              text: 'Replace with another…',
            },
          ],
        },
        ...REPLACE_POPUP_NODES,
        {
          name: 'hint-card',
          tag: 'div',
          attrs: { class: 'hint-card', part: 'hint' },
          children: [
            { tag: 'span', attrs: { class: 'hint-icon', 'aria-hidden': 'true' }, text: '✦' },
            {
              // Shown only in a narrow viewer, where the text waits behind it (`hint-toggle.ts`).
              name: 'hint-toggle',
              tag: 'button',
              attrs: {
                class: 'hint-toggle',
                type: 'button',
                'aria-expanded': 'false',
                'aria-label': 'Viewer controls',
                'data-i18n-attr': 'aria-label:controls.label',
              },
              children: [{ tag: 'span', attrs: { 'aria-hidden': 'true' }, text: '✦' }],
            },
            {
              name: 'hint-text',
              tag: 'span',
              attrs: { class: 'hint-text', 'aria-live': 'polite', 'data-i18n': 'hint.orbit' },
              text: 'Drag to orbit · Space or right button + drag to pan · Scroll to zoom · Double-click to focus',
            },
          ],
        },
        {
          name: 'degraded-notice',
          tag: 'div',
          attrs: { class: 'degraded-notice is-hidden', role: 'status' },
          children: [
            { tag: 'span', attrs: { class: 'notice-dot' } },
            {
              tag: 'span',
              // `title` backs up the `max-inline-size` wrap (`styles/viewer.css`)
              // with the full sentence on hover, `furniture.hide`'s pairing.
              attrs: { 'data-i18n': 'notice.degraded', 'data-i18n-attr': 'title:notice.degraded' },
              text: 'Some demo assets are shown as placeholders',
            },
          ],
        },
        {
          name: 'reveal-controls',
          tag: 'button',
          attrs: {
            class: 'reveal-controls',
            type: 'button',
            'aria-label': 'Show viewer controls',
            'aria-hidden': 'true',
            tabindex: '-1',
            'data-i18n-attr': 'aria-label:controls.show',
          },
          children: [{ tag: 'span' }, { tag: 'span' }, { tag: 'span' }],
        },
        {
          // The standalone fullscreen button (`options.fullscreenButton`):
          // hidden until the chrome says otherwise, so no embed that never
          // asked for it ever sees it flash.
          name: 'fullscreen-float',
          tag: 'button',
          attrs: {
            class: 'icon-button fullscreen-float',
            type: 'button',
            hidden: '',
            'aria-label': 'Enter fullscreen',
            title: 'Fullscreen',
            'data-i18n-attr': 'aria-label:fullscreen.enter,title:fullscreen.label',
          },
          children: [icon(FULLSCREEN_ICON)],
        },
        {
          // Mode and room changes, for a screen reader.
          // Never touched by `chrome.controls` — an accessibility baseline
          // is not a chrome option a host can switch off.
          name: 'live-region',
          tag: 'div',
          attrs: { class: 'visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' },
        },
      ],
    },
  ],
};

/**
 * Builds one node and everything under it.
 *
 * `createElement` / `setAttribute` / `textContent` / `append` and nothing else:
 * none of them is a Trusted Types sink, so the shell is built under any host
 * policy without registering one of its own — and a host's `trusted-types`
 * directive may restrict which policy names exist at all, so having none is
 * the only way that cannot be taken away.
 */
export function buildShellNode(document: Document, node: ShellNode, inSvg = false): Element {
  const svg = inSvg || node.svg === true;
  const element = svg ? document.createElementNS(SVG_NS, node.tag) : document.createElement(node.tag);
  if (node.name) element.setAttribute(SHELL_ATTRIBUTE, node.name);
  for (const [key, value] of Object.entries(node.attrs ?? {})) element.setAttribute(key, value);
  if (node.text !== undefined) element.textContent = node.text;
  for (const child of node.children ?? []) element.append(buildShellNode(document, child, svg));
  return element;
}

/**
 * Builds the shell inside `container`, translates it, and returns the element
 * references. Two calls on two containers produce two independent trees that
 * share nothing but the stylesheet.
 */
export function createViewerShell(container: HTMLElement, messages: Messages): ViewerRoots {
  ensureViewerStyles(styleRootOf(container));
  const root = buildShellNode(container.ownerDocument, VIEWER_SHELL_TREE) as HTMLElement;
  // Translated BEFORE it is in the page: `applyDomMessages` over the whole
  // document would rewrite a host page's own `data-i18n` nodes.
  applyDomMessages(root, messages);
  // The shell's own LANGUAGE, not just its copy — a screen
  // reader otherwise reads Russian chrome with an English voice. `lang`
  // inherits down the flat tree, so this is enough for the whole subtree
  // (`setLocale` keeps it current; see `viewer-context.ts`).
  root.lang = messages.locale;
  container.append(root);

  const byName = <T extends HTMLElement = HTMLElement>(name: ShellName): T => {
    if (name === 'viewer') return root as unknown as T;
    const element = root.querySelector<T>(`[${SHELL_ATTRIBUTE}="${name}"]`);
    if (!element) throw new MissingShellNodeError(name);
    return element;
  };

  return { root, canvas: byName<HTMLCanvasElement>('scene-canvas'), viewport: root, byName };
}

/**
 * The document or shadow root `container` lives in — where a sheet is adopted.
 *
 * The shadow test is duck-typed (`'host' in root`) rather than
 * `instanceof ShadowRoot`: the constructor is a DOM global, and this module is
 * imported by unit tests that have no DOM at all.
 */
export function styleRootOf(container: Node): Document | ShadowRoot {
  const root = container.getRootNode();
  return isShadowRoot(root) ? root : (container.ownerDocument ?? (root as Document));
}

function isShadowRoot(node: Node): node is ShadowRoot {
  return 'host' in node;
}

/**
 * How many live viewers each root's copy of the sheet is serving.
 *
 * A COUNT, not a flag: two viewers in one document share one adopted sheet, and
 * the first one to be disposed must not take the styling off the second. The
 * sheet is disowned when the count reaches zero — which is what makes
 * `dispose()` leave the host document exactly as it found it, `adoptedStyleSheets`
 * included.
 */
const STYLED_ROOTS = new WeakMap<Document | ShadowRoot, number>();
/** One constructed sheet per process, shared by every root that adopts it. */
let sharedSheet: CSSStyleSheet | null = null;

/**
 * Delivers the component stylesheet to one document or shadow root, once, and
 * records one more holder of it.
 *
 * `adoptedStyleSheets` with a single constructed sheet is what keeps N mounted
 * viewers at one stylesheet instead of N `<style>` tags, and it is the only
 * delivery that works inside a shadow root. It is also the only one that runs
 * under `style-src 'self'`: a `<style>` element written from script needs
 * `'unsafe-inline'` from the HOST's policy, which is not a thing a component
 * may ask for. Baseline widely available since 2023-03-27, so there is no
 * fallback — a root that refuses a constructed sheet gets no styles and says so
 * rather than quietly demanding a weaker CSP.
 */
export function ensureViewerStyles(root: Document | ShadowRoot): void {
  const holders = STYLED_ROOTS.get(root) ?? 0;
  STYLED_ROOTS.set(root, holders + 1);
  if (holders > 0) return;
  if (!supportsAdoptedStyleSheets(root)) return;
  sharedSheet ??= newSheet(viewerCss);
  if (sharedSheet) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sharedSheet];
}

/**
 * Gives one holder's claim on `root`'s sheet back, and takes the sheet away
 * when the last one goes.
 */
export function releaseViewerStyles(root: Document | ShadowRoot): void {
  const holders = STYLED_ROOTS.get(root) ?? 0;
  if (holders === 0) return;
  if (holders > 1) {
    STYLED_ROOTS.set(root, holders - 1);
    return;
  }
  STYLED_ROOTS.delete(root);
  if (sharedSheet && Array.isArray(root.adoptedStyleSheets)) {
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((sheet) => sheet !== sharedSheet);
  }
}

function supportsAdoptedStyleSheets(root: Document | ShadowRoot): boolean {
  return typeof CSSStyleSheet === 'function' && Array.isArray(root.adoptedStyleSheets);
}

function newSheet(css: string): CSSStyleSheet | null {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet;
  } catch {
    // Constructable sheets exist but this document refused one. There is
    // nothing else to try that a strict `style-src` would allow.
    return null;
  }
}
