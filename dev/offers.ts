/**
 * The custom element with an `offers` library: a bare scene that places two
 * objects of the offers fixture, the extra library beside it, both by URL.
 * `?offers=` replaces the library URL, and `?offers=none` mounts the bundled
 * bank alone; `?src=` replaces the scene.
 *
 * It is a dev page (`npm run dev`, `/dev/offers.html`) and the page the
 * `asset-replace` e2e spec drives; never part of the production bundle.
 */

import { defineJeexViewer } from '../src/embed/element.js';

const params = new URL(window.location.href).searchParams;
const element = document.querySelector<HTMLElement>('#viewer');
if (!element) throw new Error('offers: no #viewer element');

const offers = params.get('offers') ?? '/tests/fixtures/offers/library.json';
element.setAttribute('src', params.get('src') ?? '/tests/fixtures/offers/scene.json');
if (offers !== 'none') element.setAttribute('offers', offers);
// The attributes first: the upgrade is what mounts, and it reads them once.
defineJeexViewer();
