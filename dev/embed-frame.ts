/**
 * The iframe helper's `autoHeight`, the script fallback for the
 * browsers without responsive iframes. The stage has a width and no height;
 * the frame takes the height `embed.html` reports in its `size` event, the
 * width at `ratio=4:3`. Asserted by `tests/e2e/embed-frame.spec.ts`.
 *
 * It is a dev page (`npm run dev`, `/dev/embed-frame.html`), never part of
 * the production bundle.
 */

import { embedViewer } from '../src/embed/host.js';

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('embed-frame: no #stage container');

const embed = embedViewer(stage, {
  src: '/embed.html',
  viewerId: 'dev-auto',
  autoHeight: true,
  ratio: '4:3',
  tour: 'off',
  analytics: 'off',
});
const sizes: Array<{ width: number; height: number }> = [];
embed.on('size', (size) => sizes.push(size));

declare global {
  interface Window {
    jeexFrame?: { sizes: Array<{ width: number; height: number }> };
  }
}
window.jeexFrame = { sizes };
