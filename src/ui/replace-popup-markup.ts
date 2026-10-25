/**
 * The "Replace with another…" popup as shell data (`viewer-shell.ts` builds it
 * with the rest of the shell, beside the panel): a viewer-local modal over the
 * whole viewer, driven by `replace-popup.ts`, not a native modal dialog, for
 * the reason `selection-panel.ts` gives. A module of its own because the shell
 * template is long enough on its own; it imports nothing, and the shell
 * type-checks these nodes where it spreads them in.
 */

export const REPLACE_POPUP_NODES = [
  {
    name: 'replace-popup',
    tag: 'div',
    attrs: { class: 'replace-popup is-hidden', 'data-open': 'false' },
    children: [
      {
        tag: 'div',
        attrs: { class: 'replace-popup-card', role: 'dialog', 'aria-modal': 'true' },
        children: [
          {
            tag: 'div',
            attrs: { class: 'replace-popup-head' },
            children: [
              { name: 'replace-popup-title', tag: 'div', attrs: { class: 'replace-popup-title' }, text: 'Replace with' },
              {
                name: 'replace-popup-close',
                tag: 'button',
                attrs: {
                  class: 'finish-close',
                  type: 'button',
                  'aria-label': 'Close the list',
                  'data-i18n-attr': 'aria-label:replacePopup.close',
                },
                text: '×',
              },
            ],
          },
          { name: 'replace-popup-list', tag: 'div', attrs: { class: 'replace-popup-list' } },
          {
            name: 'replace-popup-empty',
            tag: 'p',
            attrs: { class: 'replace-popup-empty is-hidden', 'data-i18n': 'replacePopup.empty' },
            text: 'Nothing else fits where this object stands.',
          },
        ],
      },
    ],
  },
] as const;
