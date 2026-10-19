/**
 * The tour's chrome as shell data (`viewer-shell.ts` builds it with the rest
 * of the shell): the status pill, and the bar with its play button, scrub
 * track and speed button, all driven by `tour-bar.ts`. A module of its own
 * because the shell template is long enough on its own; it imports nothing,
 * and the shell type-checks these nodes where it spreads them in.
 */

export const TOUR_CHROME_NODES = [
  {
    name: 'tour-status',
    tag: 'div',
    attrs: { class: 'tour-status is-hidden', 'aria-live': 'polite', 'data-state': 'ready' },
    children: [
      { tag: 'span', attrs: { class: 'tour-status-dot' } },
      { name: 'tour-status-label', tag: 'span', attrs: { 'data-i18n': 'tour.ready' }, text: 'Tour ready' },
      { name: 'tour-status-progress', tag: 'span', attrs: { class: 'tour-status-progress' }, text: '00:00' },
    ],
  },
  {
    name: 'tour-bar',
    tag: 'div',
    attrs: {
      class: 'tour-bar',
      part: 'tour-bar',
      'data-visible': 'false',
      'data-state': 'ready',
      role: 'group',
      'aria-label': 'Tour playback',
      'data-i18n-attr': 'aria-label:tour.bar.label',
    },
    children: [
      {
        name: 'tour-play',
        tag: 'button',
        attrs: {
          class: 'tour-bar-play',
          type: 'button',
          'aria-label': 'Play tour',
          'data-i18n-attr': 'aria-label:tour.bar.play',
        },
        children: [
          {
            tag: 'svg',
            svg: true,
            attrs: { viewBox: '0 0 12 12', 'aria-hidden': 'true' },
            children: [
              { tag: 'path', attrs: { class: 'icon-play', d: 'M3 1.6 10 6l-7 4.4z' } },
              { tag: 'path', attrs: { class: 'icon-pause', d: 'M2.6 1.8h2.4v8.4H2.6zM7 1.8h2.4v8.4H7z' } },
            ],
          },
        ],
      },
      {
        name: 'tour-track',
        tag: 'div',
        attrs: {
          class: 'tour-bar-track',
          role: 'slider',
          'aria-valuemin': '0',
          'aria-valuemax': '1',
          'aria-valuenow': '0',
          'aria-label': 'Tour position',
          tabindex: '0',
          'data-i18n-attr': 'aria-label:tour.bar.track',
        },
        children: [
          { tag: 'div', attrs: { class: 'tour-bar-fill' } },
          { tag: 'div', attrs: { class: 'tour-bar-knob' } },
        ],
      },
      {
        // The speed setting: the label is the factor itself,
        // the accessible name says what it is (`tour-bar.ts` sets both).
        name: 'tour-speed',
        tag: 'button',
        attrs: { class: 'tour-bar-speed', type: 'button', 'aria-label': 'Tour speed 1x', 'data-speed': '1' },
        text: '1x',
      },
    ],
  },
] as const;
