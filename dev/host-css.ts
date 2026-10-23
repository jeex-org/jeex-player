/**
 * A viewer mounted with `mountViewer` into the light DOM of a page whose own
 * stylesheet is aggressive and unlayered (`#host-hostile` in `host-css.html`):
 * a universal reset, body typography, and element rules for buttons, inputs,
 * links, icons and images, the way agency and CMS themes ship them.
 *
 * `tests/e2e/host-css.spec.ts` measures and photographs the chrome with that
 * sheet enabled and disabled on the same page; the chrome must not change.
 *
 * It is a dev page, never part of the production bundle.
 */

import { mountViewer } from '../src/app/viewer-api.js';
import { LocalFixtureRepository } from '../src/demo/fixture-repository.js';

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('host-css: no #stage container');

const handle = mountViewer(stage, {
  // Development pages never send telemetry; `/dev/telemetry.html` is the one that tests it.
  analytics: 'off',
  scene: { repository: new LocalFixtureRepository() },
  // A steady bar: the spec compares two states of one page, and an idle
  // collapse between them would be a difference the host's CSS did not cause.
  chrome: { autoHide: false },
});
window.jeexViewer = handle;
