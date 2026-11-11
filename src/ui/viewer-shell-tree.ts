/**
 * The viewer's shell as data: the one template every mount builds
 * (`VIEWER_SHELL_TREE`), the names its addressable nodes carry, and the two
 * small builders the template repeats (an icon, a mode button).
 * `viewer-shell.ts` builds it with `buildShellNode` and re-exports everything
 * here, so a reader imports the shell from one place.
 *
 * Invariant: the tree is a constant. Every `name` in it is one of
 * `SHELL_NAMES` (the type says so), every English string is the static default
 * of its `data-i18n` key, and nothing in it is an HTML string.
 */

import { EN } from '../shared/messages.js';
import type { ViewerMode } from '../scene/types.js';
import { LIVE_MODE_LABEL } from './messages.js';
import { MODE_LABELS } from './mode-labels.js';
import { TOUR_CHROME_NODES } from './tour-bar-markup.js';
import { REPLACE_POPUP_NODES } from './replace-popup-markup.js';

/** Class of the shell root; the whole component stylesheet is scoped to it. */
export const VIEWER_ROOT_CLASS = 'jeex-viewer';

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
