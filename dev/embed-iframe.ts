/**
 * Executable acceptance test of the IFRAME form: a host page that holds the
 * helper and nothing else, driving `embed.html` over `postMessage`.
 *
 * What this page exists to prove (`scripts/browser-check/embed.ts` asserts it):
 *
 * - `await embed.ready` resolves when the frame's first scene is on screen,
 *   and the commands issued before that were QUEUED, not lost;
 * - a round trip really carries a value back: `progress()` answers with the
 *   frame's own `TourProgress`;
 * - the frame answers only the origin it was given and only this protocol —
 *   a message posted at another target origin never arrives, and one with a
 *   foreign `channel` is dropped;
 * - `dispose()` tells the frame, then takes the iframe out of the page.
 *
 * The frame is pointed at `/embed.html` on this same dev origin, which is what
 * makes the `?host=` round trip observable at all; in production the two are
 * different origins and nothing else changes.
 *
 * It is a dev page (`npm run dev`, `/dev/embed-iframe.html`), never part of
 * the production bundle.
 */

import { embedViewer, type JeexEmbed } from '../src/embed/host.js';

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('embed-iframe: no #stage container');

const seen: string[] = [];
const log = document.querySelector<HTMLElement>('#events');
const note = (event: string): void => {
  seen.push(event);
  if (log) log.textContent = seen.slice(-8).join(' · ');
};

const embed = embedViewer(stage, {
  src: '/embed.html',
  viewerId: 'dev-frame',
  // Development pages never send telemetry; `/dev/telemetry.html?form=iframe` is the one that tests it.
  analytics: 'off',
  // The viewer's own options, in their QUERY spelling: the helper forwards
  // them verbatim and the FRAME validates them (`viewer-options.ts`).
  view: 'tour',
  tour: 'paused',
  lang: 'en',
  // This page exercises the whole chrome, so it opts into editing; a frame is
  // read-only for visitors unless its URL says `readonly=0`.
  readonly: '0',
});

for (const event of ['ready', 'error', 'scene', 'mode', 'state', 'ended', 'disposed'] as const) {
  embed.on(event, () => note(event));
}
// Progress fires every frame while the tour runs; counting it would drown the
// log, so it is noted once.
let sawProgress = false;
embed.on('progress', () => {
  if (!sawProgress) {
    sawProgress = true;
    note('progress');
  }
});

document.querySelector<HTMLElement>('#play')?.addEventListener('click', () => {
  void embed.play();
});
document.querySelector<HTMLElement>('#pause')?.addEventListener('click', () => {
  void embed.pause();
});
document.querySelector<HTMLElement>('#walk')?.addEventListener('click', () => {
  void embed.setMode('walk');
});
document.querySelector<HTMLElement>('#dispose')?.addEventListener('click', () => {
  embed.dispose();
});
document.querySelector<HTMLElement>('#progress')?.addEventListener('click', () => {
  void embed.progress().then((progress) => {
    if (log) log.textContent = JSON.stringify(progress);
  });
});

window.jeexEmbed = { embed, events: seen, ready: false };
void embed.ready.then(() => {
  window.jeexEmbed!.ready = true;
});

declare global {
  interface Window {
    /** The host handle and what the page has heard, for the browser check. */
    jeexEmbed?: { embed: JeexEmbed; events: string[]; ready: boolean };
  }
}
