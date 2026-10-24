/**
 * The demo flat with or without an offline light bake (see
 * `light-bake-hook.html`), through the player's internal page switches:
 *
 * - `?bake=<folder URL>` sets `__JEEX_DEBUG_LIGHT_BAKE__` to that folder's
 *   `sidecar.json` and `shell.glb`; without it the flat is live.
 * - `?view=walk|orbit,px,py,pz,tx,ty,tz` sets `__JEEX_DEBUG_CAMERA__`; the default
 *   is a walk view across the living room.
 *
 * The readout shows the bake's state (`__viewerDebug.lightBake()`); a capture
 * waits for `data-bake` on `<body>` to read `applied`, `refused` or `off`.
 */

import { InlineSceneRepository, mountViewer } from '../src/app/viewer-api.js';
import { apartmentScene } from '../src/demo/scene-data.js';

const DEFAULT_VIEW = 'walk,4.8,1.6,8.6,1.2,1.2,6.2';

const query = new URLSearchParams(location.search);
const bake = query.get('bake');
const [mode, ...numbers] = (query.get('view') ?? DEFAULT_VIEW).split(',');
const page = globalThis as { __JEEX_DEBUG_LIGHT_BAKE__?: unknown; __JEEX_DEBUG_CAMERA__?: unknown };
if (bake !== null) {
  const folder = bake.endsWith('/') ? bake : `${bake}/`;
  page.__JEEX_DEBUG_LIGHT_BAKE__ = { sidecar: `${folder}sidecar.json`, shell: `${folder}shell.glb` };
}
const pose = numbers.map(Number);
page.__JEEX_DEBUG_CAMERA__ = { mode, position: pose.slice(0, 3), target: pose.slice(3, 6) };

const readout = document.querySelector<HTMLElement>('#readout')!;
const handle = mountViewer(document.querySelector<HTMLElement>('#stage')!, {
  scene: { repository: new InlineSceneRepository(apartmentScene) },
  tour: { mode: 'off' },
  chrome: { autoHide: false },
  debug: true,
});

const show = (): void => {
  const state = window.__viewerDebug?.lightBake() ?? { state: 'off' };
  readout.textContent = `${bake === null ? 'live' : 'baked'} · ${JSON.stringify(state)}`;
  document.body.dataset['bake'] = state.state;
  if (state.state === 'waiting' || state.state === 'loading') requestAnimationFrame(show);
};
handle.on('ready', show);

import.meta.hot?.dispose(() => handle.dispose());
