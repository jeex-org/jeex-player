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
import { applyDomMessages, type Messages } from './messages.js';
import viewerCss from './styles/viewer.css?inline';
import { PLAN_CANVAS_NAME } from './plan-modes.js';
import { MINIMAP_NAME } from './minimap.js';
import { SCROLL_HINT_NAME, TAP_HINT_NAME } from './scroll-hint.js';
import { DOOR_HUD_NAME } from '../doors/door-hud.js';
import { VIEWER_SHELL_TREE, type ShellName, type ShellNode } from './viewer-shell-tree.js';

export { SHELL_NAMES, VIEWER_ROOT_CLASS, VIEWER_SHELL_TREE, type ShellName, type ShellNode } from './viewer-shell-tree.js';

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
 * The `data-jeex` name of the camera-preview card (`camera-preview.ts`). It is
 * kept here rather than in the card's module because the card loads lazily
 * with the authoring tools, and the shell's name table is in the boot bundle.
 */
export const CAMERA_PREVIEW_NAME = 'camera-preview';

/**
 * Names of the overlays their own modules create (each exports its constant),
 * composed downward as the surface `scripts/browser-check.ts` asserts on.
 */
export const OVERLAY_NAMES = {
  planCanvas: PLAN_CANVAS_NAME,
  minimap: MINIMAP_NAME,
  doorHud: DOOR_HUD_NAME,
  scrollHint: SCROLL_HINT_NAME,
  tapHint: TAP_HINT_NAME,
  cameraPreview: CAMERA_PREVIEW_NAME,
} as const;

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

const SVG_NS = 'http://www.w3.org/2000/svg';

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
