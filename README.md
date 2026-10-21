# JEEX Player

Interactive 3D apartment player built on Three.js. It renders a parametric scene document (walls, openings, rooms, furniture, finishes) and offers five view modes (2D plan, 3D top view, 360 orbit, walk, guided tour), interactive doors, a mini-map with click-to-travel, finish and furniture editing, and interior presets.

The package and the element are named `jeex-viewer` (`<jeex-viewer>`, `import … from 'jeex-viewer'`); the source lives at [github.com/jeex-org/jeex-player](https://github.com/jeex-org/jeex-player). It is not published to a package registry: build it from source ([Install and build](#install-and-build)) and serve the `dist-lib/` directory yourself.

This document is the integration reference.

## Contents

- [Install and build](#install-and-build)
- [Paste into any site](#paste-into-any-site)
  - [Responsive iframes](#responsive-iframes)
- [Integration paths](#integration-paths)
  - [1. ES module component](#1-es-module-component)
  - [2. Custom element](#2-custom-element)
  - [3. iframe with postMessage](#3-iframe-with-postmessage)
- [Options](#options)
- [Scene sources](#scene-sources)
- [Viewer handle API](#viewer-handle-api)
  - [Moving assets in an editor](#moving-assets-in-an-editor)
  - [Host slots (`handle.slots`)](#host-slots-handleslots)
- [Events](#events)
- [Errors](#errors)
- [Logging](#logging)
- [Sizing and styling](#sizing-and-styling)
- [Theming](#theming)
- [Languages](#languages)
- [Controls](#controls)
- [Accessibility](#accessibility)
- [Content Security Policy](#content-security-policy)
- [iframe permissions and origin](#iframe-permissions-and-origin)
- [Scene document](#scene-document)
- [Project format](#project-format)
- [Scene operations entry (`jeex-viewer/ops`)](#scene-operations-entry-jeex-viewerops)
- [Development](#development)

## Install and build

Requirements for building: Node 22.12+ and Bun (the pinned version is in `.bun-version`). `three` and `zod` (the `zod/mini` schemas the player checks scenes, manifests and messages with) are bundled into the library output, so a page that loads the built files needs nothing else. The package declares `zod` and `@types/three` as dependencies for its type declarations, which reference both.

```bash
bun install
npm run build:lib        # dist-lib/: jeex-viewer.js (ES), jeex-viewer.iife.js, jeex-viewer-element.js,
                         #           jeex-viewer-host.js, jeex-viewer-host.iife.js, jeex-viewer.css, *.d.ts,
                         #           embed.html + jeex-viewer-frame.js (the public frame page),
                         #           plus the hashed shared chunks the ES entries import
npm run build            # dist/: the demo page (index.html + embed.html)
```

Package entry points:

| Import | Contents |
|---|---|
| `jeex-viewer` | `mountViewer`, `defineJeexViewer`, scene repositories, types |
| `jeex-viewer/element` | registers `<jeex-viewer>` on import |
| `jeex-viewer/host` | `embedViewer` for iframe hosts (no Three.js, under 4 KB gzip); `jeex-viewer-host.iife.js` exposes it as the global `JeexViewerHost` |
| `jeex-viewer/style.css` | the component stylesheet, for hosts that want to override it |

Styles are injected automatically by every integration path. The CSS file exists for overrides only.

## Paste into any site

Serve the whole `dist-lib/` directory from one origin (the ES entries import hashed sibling chunks, so a single file is not enough; every URL inside it is relative). Below, `https://viewer.example/embed/v1/` stands for that directory and `scene` for a scene or project JSON URL with `access-control-allow-origin`. Each form is plain HTML: no inline script, no stylesheet, nothing a CMS block has to allow beyond the tag itself.

1. Custom element, ES module (modern browsers, the lightest download):

   ```html
   <script type="module" src="https://viewer.example/embed/v1/jeex-viewer-element.js"></script>
   <jeex-viewer src="https://viewer.example/p/flat-a/project.json" lang="en"></jeex-viewer>
   ```

2. Custom element, classic script (for a CMS that strips `type="module"`): `jeex-viewer.iife.js` registers `<jeex-viewer>` on load, as well as publishing the global `JeexViewer`.

   ```html
   <script src="https://viewer.example/embed/v1/jeex-viewer.iife.js" defer></script>
   <jeex-viewer src="https://viewer.example/p/flat-a/project.json" lang="en"></jeex-viewer>
   ```

   Registration is idempotent: a page that loads both bundles gets one `<jeex-viewer>`, the first one defined.

3. iframe (any page that allows an iframe; the viewer runs on its own origin):

   ```html
   <iframe src="https://viewer.example/embed/v1/embed.html?scene=https%3A%2F%2Fviewer.example%2Fp%2Fflat-a%2Fproject.json&lang=en"
     title="Apartment tour" loading="lazy" allow="fullscreen"
     style="display:block;width:100%;aspect-ratio:16/9;border:0"></iframe>
   ```

What a pasted form does on its own:

- **It has a box.** A bare `<jeex-viewer>` is `display: block`, the full width of its parent and 16:9 of that width (a `:host` rule in its shadow root). `ratio="4:3"`, `ratio="1"` or `ratio="2.39:1"` changes the default, live. Any `width`, `height`, `aspect-ratio` or `display` the page sets on the element wins, because a `:host` rule loses to every rule of the embedding page; a page that sets a height gets exactly that height. With `shadow="none"` there is no `:host`, and the page sizes the element itself. The iframe's box is its inline `aspect-ratio`; `embed.html` fills whatever box its frame has.
- **It is read-only.** A visitor gets no finish, variant or interior panels: `<jeex-viewer>` and `embed.html` default `readonly` to `true`. Editing is an explicit opt-in, `readonly="0"` on the element or `readonly=0` in the frame's URL. `mountViewer` is the authoring API and keeps the option's own default, `false`.
- **It carries the producer's mark when the project says so.** A manifest with `mark: { href }` (set by whoever produced the bake) gets a small «Made with JEEX» link in the top-left corner of the viewport. It comes from the published data, not from an option: `readonly`, `unbranded`, `overlay`, `chrome` and every other attribute or query parameter leave it on screen. It carries no `part`, so `::part()` cannot style it; a host that reaches into the open shadow root with its own CSS or script, or restyles links with unlayered rules in the light DOM of `shadow="none"` (the viewer's sheet lives in `@layer component`), can still hide or restyle it, which is the accepted residual risk.
- **It ships no scene.** `dist-lib/embed.html` without `?scene=` shows the `no-scene-source` card (the demo build's `embed.html` falls back to the demo apartment).

### Responsive iframes

Chrome 154 added responsive iframes behind a flag (the runtime feature `ResponsiveIframes`, `--enable-features=ResponsiveIframes`; Firefox and Safari have none): the embedding page writes `frame-sizing: content-height` on the iframe and the framed document opts in. `embed.html` opts in for every origin (`<meta name="responsive-embedded-sizing" content="allow-origins=*">`, the content is public by design), gives its document an intrinsic height (the `#jeex-size` box: the frame's width at `?ratio=`, 16:9 by default, while the viewer itself fills the frame) and calls `window.requestResize()` whenever that box changes, but only while it is framed: the browser refuses the call with a `NotAllowedError` from a top-level document, so `embed.html` opened on its own never makes it, and a frame whose container refuses it (an `<object>` or `<embed>` instead of an `<iframe>`) logs `resize-request-refused` once and keeps reporting its `size` event.

Measured 2026-10-19 in Chrome for Testing 156.0.8078.4 (headless shell) against the built `dist-lib/embed.html` on a second origin, host width 800 then 400 px:

| iframe style | 800 px wide | after the host narrows to 400 px |
|---|---|---|
| `frame-sizing: content-height` | 450 (16:9), 600 with `ratio=4:3` | stays 450 / 600: the frame does not follow a width change, even after an explicit `requestResize()` |
| `aspect-ratio: 16/9` | 450 | 225 |
| `aspect-ratio: 16/9; frame-sizing: content-height` | 450 | 225: an inline `aspect-ratio` (also `auto 4/3`) wins over `frame-sizing` |
| `height: 300px; frame-sizing: content-height` | 300 | 300: an explicit height wins too; `max-height` clamps |

Two more findings: `CSS.supports('frame-sizing', 'content-height')` (and so `@supports`) answers `true` in that build even with the runtime feature off; and with the feature off a frame is sized to its content only when its document calls `requestResize()` (a test document that never called it stayed at the 150 px default, one that did got 450). `embed.html` calls it on load, so it was sized either way, but the progressive-enhancement pattern from the [Chrome 154 announcement](https://developer.chrome.com/blog/responsive-iframes) (`height: auto` inside `@supports`) can collapse a frame whose page does not.

Hence the snippet above: an inline `aspect-ratio` is the size in every browser and follows the host's width, and it gives the same height `frame-sizing` would, because the frame page's content height IS its width at the ratio. A page that wants content sizing anyway (for example under a `max-height`) may write `frame-sizing: content-height` instead of the `aspect-ratio`, in Chrome with the feature on.

The script fallback for every browser is the iframe helper's `autoHeight`: `embedViewer(container, { src, scene, ratio: '4:3', autoHeight: true })` starts the frame at its `ratio` (16:9 by default) and then gives it the height `embed.html` reports in its `size` event (`{ width, height }`, raised whenever the content box changes).

## Integration paths

All three paths use the same option names, the same handle API and the same events.

### 1. ES module component

```ts
import { mountViewer } from 'jeex-viewer';

const viewer = mountViewer(document.getElementById('apartment')!, {
  scene: { url: '/scenes/flat-a.json' },
  view: { mode: 'walk', minimap: true },
  tour: { mode: 'paused', progressBar: false },
});

await viewer.ready;
viewer.tour.play();
```

Without a bundler, load the IIFE build. It exposes the same module as the global `JeexViewer`:

```html
<div id="apartment" style="height: 480px"></div>
<script src="/vendor/jeex-viewer.iife.js"></script>
<script>
  const viewer = JeexViewer.mountViewer(document.getElementById('apartment'), {
    scene: { url: '/scenes/flat-a.json' },
  });
</script>
```

The container must have a height. The viewer fills it (`position: relative; width: 100%; height: 100%`) and never takes the page over.

### 2. Custom element

```html
<script type="module" src="/vendor/jeex-viewer-element.js"></script>

<jeex-viewer
  src="/scenes/flat-a.json"
  view="tour"
  tour="paused"
  tour-bar="0"
  minimap="1"
  lang="en"
  style="display:block; height: 70vh">
</jeex-viewer>

<script type="module">
  const el = document.querySelector('jeex-viewer');
  el.addEventListener('jeex-ready', () => el.tour.seek(0.25));
</script>
```

Attribute names are the third column of the [options table](#options). A boolean attribute without a value (`<jeex-viewer minimap>`) means `true`. The viewer mounts in `connectedCallback`. It never throws out of it: an element with no `src` shows the viewer's error card and fires `jeex-error` with code `no-scene-source`. After the element is connected, only `src` (loads a new scene), `view` (switches mode) and `ratio` (resizes the default box) are live; changing any other attribute is reported through the [log sink](#logging) and has no effect until the element is re-created. Without a `style` the element is a block at its parent's width and 16:9 of it (`ratio` changes the ratio); the `display: block` and the height in the snippet override that default box. The element is read-only unless it says `readonly="0"` ([Paste into any site](#paste-into-any-site)).

The element renders into an open shadow root by default. Add `shadow="none"` to render into light DOM (for hosts that restyle the chrome). Programmatic registration: `import { defineJeexViewer } from 'jeex-viewer'; defineJeexViewer('my-viewer')`.

Properties: `el.viewer` (the [handle](#viewer-handle-api) or `null` before mount), `el.tour`, `el.onLog` (set before connecting; see [Logging](#logging)).

State and typing:

- `element.matches(':state(loading)')`, `:state(ready)`, `:state(error)` track the mount (`ElementInternals.states`), so CSS can react: `jeex-viewer:state(ready) .my-overlay { opacity: 1 }`.
- All seven `jeex-*` events are declared on `HTMLElementEventMap`, and the tag on `HTMLElementTagNameMap`: `element.addEventListener('jeex-ready', (event) => event.detail.sceneId)` and `document.createElement('jeex-viewer')` need no cast.
- Moving the element with `Element.moveBefore()` keeps the running viewer (`connectedMoveCallback`): no flash, no re-initialised scene.

### 3. iframe with postMessage

Host the built demo (`dist/`) on its own origin. `embed.html` mounts the viewer from the query string and installs the message bridge. On the host page load the small helper and let it create the frame:

```html
<div id="apartment" style="height: 480px"></div>
<script type="module">
  import { embedViewer } from '/vendor/jeex-viewer-host.js';

  const viewer = embedViewer(document.getElementById('apartment'), {
    src: 'https://viewer.example.com/embed.html',
    scene: '/scenes/flat-a.json',      // resolved against the viewer origin
    view: 'walk',
    minimap: '0',
  });

  await viewer.ready;
  viewer.on('progress', (p) => console.log(p.fraction));
  await viewer.play();
</script>
```

`dist-lib/embed.html` is the same page for production: no demo apartment, read-only unless `readonly=0`, sized by `ratio`. Pass `autoHeight: true` to size the frame to its content instead of filling the container ([Responsive iframes](#responsive-iframes)).

The helper appends `?host=<your origin>` plus the options in query spelling, verifies `event.source` and `event.origin` on every message, queues commands until `ready`, and rejects a command that gets no reply within 5 seconds. The frame side answers only the origin it was given and ignores everything else.

The iframe is created with `allow="fullscreen"`, `sandbox="allow-scripts allow-same-origin"`, `referrerpolicy="no-referrer"`, `loading="lazy"` and a `title` — see [iframe permissions and origin](#iframe-permissions-and-origin) for the `title` and `sandbox` options and for why the default sandbox is what it is.

`?host=` is validated by the frame: it is honoured only when it is exactly an `http:`/`https:` origin (`new URL(raw).origin === raw`). `*`, `null`, a trailing slash and anything else install no bridge at all, and the frame says so in its console. `embed.html` also strips `debug` from the query — an embedded viewer has no authoring capability, whatever the URL says.

Wire protocol (`channel: "jeex-embed"`, `version: 1`), for hosts that do not use the helper:

```ts
// host → frame
{ channel: 'jeex-embed', version: 1, viewerId, kind: 'command', id, method, params }
// frame → host
{ channel: 'jeex-embed', version: 1, viewerId, kind: 'reply', id, ok, result?, error? }
{ channel: 'jeex-embed', version: 1, viewerId, kind: 'event', event, payload }
```

Methods: `play`, `pause`, `toggle`, `stop`, `seek {fraction}`, `seekDistance {metres}`, `seekTime {seconds}`, `setTourSpeed {speed}`, `progress`, `loadScene {url} | {document}`, `setMode {mode}`, `getMode`, `getState`, `getScene`, `focusRoom {roomId}`, `setFurnitureVisible {visible}`, `setLocale {locale}`, `resize`, `captureStill {width, height, …}`, `capturePanorama {width, roomId, …}`, `exportGlb {includeFurniture?, state?, embedDocument?}`, `exportUsdz {includeFurniture?}`, `dispose`. `getScene` is answered even before the frame's `ready`, like `dispose`; `exportGlb`/`exportUsdz` need a scene and are not. Both exports' results cross the boundary as an `ArrayBuffer`, not a `Blob` — wrap it yourself (`new Blob([buffer], { type: 'model/gltf-binary' })` or `'model/vnd.usdz+zip'`) for a download link or `URL.createObjectURL`. The spelling `playTour`, `pauseTour` and `destroy` from the original contract is accepted as an alias. Events: `ready`, `error`, `scene`, `mode`, `progress`, `state`, `ended`, `size` (`{ width, height }` of the frame page's content box, from `embed.html` only), `disposed`. Error codes are the viewer's ([Errors](#errors)) plus `unknown-method` and `timeout`; a message that fails the envelope or origin check is ignored rather than answered. An inline `loadScene {document}` over the 8 MB cap (`MAX_SCENE_BYTES`, measured in bytes) is answered `bad-params` by the frame itself — the helper checks on the host side too, but the frame does not take a hand-written host's word for it. The helper's `dispose()` emits `disposed` to its own subscribers and then stops listening. Timeouts: a command waits at most 20 s for the frame to become ready (`QUEUE_TIMEOUT_MS`) and 5 s for its reply once posted (`REPLY_TIMEOUT_MS`). The helper's `on` is typed over `EmbedEventMap`, so `viewer.on('progress', (p) => p.fraction)` needs no cast.

## Options

Every option has one name in each of the three spellings. Unknown keys are ignored. An invalid value falls back to the default and is reported once through the [log sink](#logging) with code `option-invalid` and the key. Boolean values accept `0`, `1`, `false`, `true`. Two options exist only in the object spelling: `scene` (a source object, see [scene sources](#scene-sources)) and `onLog` (a function, see [Logging](#logging)). Three ROWS below have no object spelling at all — `chrome`, `overlay` and `unbranded` are query/attribute-only sugar that expands into the other rows (see "Compound attributes" underneath the table); an object caller sets the expanded fields directly, or spreads the exported `OVERLAY_PRESETS['kiosk' | 'embed' | 'unbranded' | 'none']`.

| Option (object) | Query (`embed.html?…`) | Attribute (`<jeex-viewer>`) | Default | Values / meaning |
|---|---|---|---|---|
| `view.mode` | `view` | `view` | `orbit` | `plan2d`, `plan3d`, `orbit` (360), `walk`, `tour`. The tour engages at start only in `tour`. |
| `view.minimap` | `minimap` | `minimap` | `true` | Mini-map card in walk and tour. |
| `plan.labels` | `planLabels` | `plan-labels` | `true` | Room names and areas on the 2D plan drawing. |
| `plan.dimensions` | `planDimensions` | `plan-dimensions` | `true` | Facade dimension lines on the 2D plan drawing. |
| `plan.camera` | `planCamera` | `plan-camera` | `true` | Camera marker (position and view wedge) on the 2D plan drawing. A host that shows the marker on its own mini-map only sets `plan.camera: false`. |
| `tour.mode` | `tour` | `tour` | `play` | `play`, `paused`, `off`. What an engaged tour does at start. |
| `tour.start` | `tourStart` | `tour-start` | `0` | Fraction `0..1` of the route. |
| `tour.progressBar` | `tourBar` | `tour-bar` | `true` | Progress bar with play and scrub. |
| `tour.pauseOnInput` | `tourInput` | `tour-input` | `true` | `false` keeps the tour engaged under pointer and keys (scroll-driven hosts). |
| `doors.interactive` | `doors` | `doors` | `true` | Hover button on door leaves; closed doors block walking. |
| `doors.autoOpen` | `doorsAuto` | `doors-auto` | `true` | Doors open on approach and close behind the walker. |
| `interiors.selector` | `presets` | `presets` | `true` | Interior preset button. Shown only when the scene carries `interiors`. |
| `chrome.brand` | `brand` | `brand` | `true` | Brand block in the control bar; its context line is `scene.name`. |
| `chrome.controls` | `controls` | `controls` | `true` | `false` hides the control bar; playback stays scriptable. |
| `chrome.status` | `chromeStatus` | `chrome-status` | `true` | The tour-status pill ("Now touring" / paused / …). |
| `chrome.modeSwitcher` | `chromeModeSwitcher` | `chrome-mode-switcher` | `true` | The mode switcher (`2D` `3D` `360` `Walk` `Tour`). |
| `chrome.hint` | `chromeHint` | `chrome-hint` | `true` | The hint card. Its own flag, independent of `controls` — show one without the other either way. |
| `chrome.autoHide` | `chromeAutoHide` | `chrome-auto-hide` | `true` | Whether the control bar collapses to its reveal pill after 4.2 s of idle. `false` pins it open: no idle timer is armed, the bar never collapses and never goes `inert`. For a host that frames the viewer in its own UI and wants a steady bar; the compound `chrome` attribute and the overlay presets leave it alone, because it says how the bar BEHAVES, not what is on screen. |
| `fullscreenButton.show` | `fullscreenButton` | `fullscreen-button` | `false` | In JS, `fullscreenButton: true` (or `false`) is shorthand for `fullscreenButton: { show: true }` with the default offsets. A standalone fullscreen button floating at the viewer's top-right corner, independent of `chrome.controls`, `chrome.autoHide` and the reveal pill — the one obvious way into fullscreen on a site that shows no control bar. It hides while the viewer is fullscreen (however fullscreen was entered) and comes back on exit. While fullscreen, the control bar is on screen even with `chrome.controls: false`: it opens expanded, then follows `chrome.autoHide`; on exit the chrome returns to exactly what the options say (`options.chrome` itself is never rewritten). Where the browser offers no Fullscreen API (iPhone Safari, a frame without `allow="fullscreen"`), a press shows the `hint.fullscreenUnavailable` hint, like the toolbar button. |
| `fullscreenButton.right` | `fullscreenButtonRight` | `fullscreen-button-right` | `32` | Distance of the floating button from the viewer's right edge, CSS pixels, `>= 0`. Physical right in every writing direction. |
| `fullscreenButton.top` | `fullscreenButtonTop` | `fullscreen-button-top` | `32` | Distance of the floating button from the viewer's top edge, CSS pixels, `>= 0`. |
| `readonly` | `readonly` | `readonly` | `false` (`true` on `<jeex-viewer>` and `embed.html`) | Look, do not change. The control bar loses the brand lockup and the Interior styles button (Reset camera stays: it is a viewing action); no click opens a finish, furniture-variant or door-variant panel (the built-in UI runs as if `edits` were `off`). Kept: the mode switcher, Reset camera, the furniture toggle, the toolbar fullscreen button, door open/close, every camera gesture. The handle keeps every command — read-only governs the built-in UI, never the host page's script. |
| *(no object form)* | `chrome` | `chrome` | `true` (no-op) | Compound, `all: unset`: `chrome=0`/`false` sets every `chrome.*` VISIBILITY row above to `false` before the individual ones apply (`chrome.autoHide` is behaviour, not visibility, and is never touched); `chrome=1`/`true` is a no-op. |
| `interaction` | `interaction` | `interaction` | `full` | `full`, `none`, `passive`. `none` sets `pointer-events: none` on the canvas and never attaches pointer/wheel/key input at all (a scroll-driven background behind the host's own content); `passive` still drives the camera but the wheel listener is `{ passive: true }` and never calls `preventDefault`, so a host page scrolls under the viewer on the same gesture that zooms it. |
| `select` | `select` | `select` | `false` | Raises the [`select` event](#events) on a click in `plan2d`, `plan3d` and `orbit` (never in `walk`/`tour`), and enables `setSelection`. Off by default: a published tour attaches no pointer listener of its own. |
| `slots` | `slots` | `slots` | `[]` | Named boxes for the HOST's own chrome inside the viewport, comma-separated: `?slots=bottom-center,selection-anchor`. Eight names: `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`, `modal-root`, `selection-anchor`. Empty by default — not one node is built. One unknown name refuses the whole list with `option-invalid`, and the attribute needs a VALUE: `<jeex-viewer slots>` reads as `true`, which is not a slot name. See [Host slots](#host-slots-handleslots). |
| `edits` | `edits` | `edits` | `local` | What the viewer's own finish/variant/interior panel does with an edit made in it. `local`: commits into its own scene, as it always did. `emit`: the panel still opens, nothing is committed, and the [`edit` event](#events) carries the batch out — the host applies it and hands back a document, so the two copies cannot drift apart. `off`: a click opens no panel at all and only [`select`](#events) is left. |
| *(no object form)* | `overlay` | `overlay` | `none` | `none`, `kiosk`, `embed`, `unbranded`. A preset over several other options, resolved BEFORE the compound `chrome` and the individual attributes (all three still override it — see "Compound attributes"): `kiosk` = every `chrome.*` visibility row off + `interaction: none` (no chrome, no input, background/kiosk use); `embed` = `chrome.controls`/`chrome.brand` off + `tour.progressBar: true` + `tour.pauseOnInput: false` (hide the chrome, keep the scrub bar); `unbranded` = `chrome.brand`/`chrome.status`/`chrome.modeSwitcher`/`chrome.hint` off, `chrome.controls` kept, `tour.mode: paused`, `view.minimap: true`, `interaction: full` — see "Portal / MLS embedding" below. |
| *(no object form)* | `unbranded` | `unbranded` | `false` | Flag alias for `overlay=unbranded` (`?unbranded=1` ≡ `?overlay=unbranded`, `<jeex-viewer unbranded>` ≡ `<jeex-viewer overlay="unbranded">`). An explicit `overlay=` always wins over it, in either order. Only `true` does anything — `unbranded=0` is a no-op, not a request for `none`. |
| `locale` | `lang` | `lang` | `en` | `en`, `de`, `fr`, `it`, `es`, `sr-Latn`, `ru`, or any code added with `registerLocale` (see [Languages](#languages)). BCP-47 tags are accepted: the region is dropped (`de-AT` → `de`), a script subtag is honoured (`sr-Latn`), and a bare `sr` resolves to `sr-Latn`. |
| `motion` | `motion` | `motion` | `auto` | `auto`, `full`, `reduced`. `auto` follows `prefers-reduced-motion`; `reduced` opens an engaged tour paused (unless `tour.mode` was set) and makes scripted travel instant; `full` forces full motion. See [Accessibility](#accessibility). |
| `debug` | `debug` | `debug` | dev build: `true`, otherwise `false` | Installs the authoring calls (`applyOps`, `exportScene`, `loadScene`) on `window.__viewerDebug`. |
| `scene.url` | `scene` | `src` | none | Scene document URL. See [scene sources](#scene-sources). |

**Compound attributes.** `chrome`, `overlay` and `unbranded` are query/attribute-only sugar, applied in this order — `overlay` (or, when it is absent, `unbranded`), then `chrome`, then every individual attribute — so a preset never has the last word: `<jeex-viewer overlay="kiosk" chrome-status="true">` shows the status pill even though `kiosk` turns it off, and `<jeex-viewer chrome="false" chrome-status="true">` hides everything but the status pill. `<jeex-viewer unbranded overlay="kiosk">` (or the query-string equivalent, in either order) resolves to plain `kiosk`: an explicit `overlay=` is read first and, when present, decides everything on its own, so `unbranded` never even gets a look. None of the three names works in the plain options object passed to `mountViewer` — `chrome` already names the nested `{ brand, controls, … }` object there, and `overlay`/`unbranded` have nothing to expand into without going through `optionsFromDataset`/`optionsFromQuery` first.

**Portal / MLS embedding.** `?unbranded=1` (or `overlay=unbranded`) is the strictest common denominator of common real-estate portal rules (Idealista's are the strictest: no logo, no autoplay, no third-party branding, controls allowed) — no brand lockup, no tour-status pill, no mode switcher, no hint card; the control bar, the mini-map and full pointer interaction stay, and an engaged tour starts paused on its route rather than autoplaying before the visitor has touched anything. This is the link to hand a portal or an MLS feed for its "virtual tour" field (RESO `VirtualTourURLUnbranded`): point it at the agency's own hosted tour page with `?unbranded=1` appended, rather than at the bare page a visitor would see on the agency's own site. At narrow widths (`[data-overlay="unbranded"]`, a container-query breakpoint, not a viewport one) the control bar collapses to a single compact row with every touch target still at least 24×24 CSS px.

## Scene sources

`options.scene` accepts one of:

| Field | Type | Use |
|---|---|---|
| `url` | `string` | fetched with `fetch(url)`, **without credentials** (see below); non-2xx rejects with the status. Either a scene document or a baked `project.json` — see [Project format](#project-format) |
| `document` | `unknown` | a scene object the host already holds |
| `library` | `{ manifest: unknown; baseUrl: string }` | optional, beside `document`: the project manifest a host already holds, so the viewer need not fetch it back ([Project format](#project-format)) |
| `repository` | `SceneRepository` | your own loader: `{ load(ref?: string): Promise<unknown> }` |

A `url` is fetched with limits that are part of the contract: a 15-second timeout (replaceable by passing your own `signal` in the repository's `RequestInit`), `redirect: 'error'` (not replaceable), a `Content-Type` that must include `application/json`, and an 8 MB cap read off the response stream. Every failure names the status and the URL. The fetch is made from the VIEWER's origin **without the viewer's cookies** (`credentials: 'omit'`): the scene URL is chosen by whoever embeds the viewer, and an embedder must not be able to turn the viewer's origin into a credentialed read-proxy for session-authorised resources. This holds for every request a `url` makes, the first one included (for a bare scene it is the only one). A cross-origin scene therefore needs CORS from wherever it is served; a host that loads a trusted, cookie-guarded scene from the viewer's own origin and wants it sent with credentials passes its own repository instead of a `url`: `scene: { repository: new FetchSceneRepository(url, { credentials: 'same-origin' }) }`. The request carries `Accept: application/json; jeex-viewer=<version>`, so a server can log or branch on the viewer's version without a second round trip; the value is CORS-safelisted on purpose, so this never triggers a preflight `OPTIONS` on its own.

Precedence: `repository` over `document` over `url`. Every source goes through the same validator; an invalid document rejects `ready` (first load) or `loadScene` (later loads) with `code: 'scene-invalid'` and a message that names the failing rule. `mountViewer` without any source throws `viewer: no scene source`. The bundled demo apartment lives in `src/demo/fixture-repository.ts`, is used only by the demo pages and is not part of the library bundle.

Overlapping `loadScene` calls race by START order, not completion order: a slow call that started first is discarded the moment a later call starts, even if the slow one's document is perfectly valid and finishes loading after the newer call has already won. A discarded call never fires `scene` or `ready` and never fires `error` either — losing a race is not a failure of that call's source or document — and its promise simply resolves once its (unused) document has finished loading. `dispose()` while a call is in flight discards it the same way.

A `loadScene` whose document is the one on screen, edited — the same scene `id`, drawn with the same library (`library.baseUrl` and manifest) — is applied as one revision of it rather than built from scratch: a moved, turned or mirrored placement keeps its meshes and its loaded model and is stood anew, a placement with another variant or finish is built alone, an added or removed one comes or goes alone, and every other placement is left untouched. A change to walls, rooms, openings or finishes rebuilds the shell as a plan-level operation does. `scene` and `ready` fire as for any `loadScene`, and the `rev` they carry keeps counting. This is the road for a host that keeps the document itself and answers every edit it committed with the whole next document.

## Viewer handle API

`mountViewer(container, options)` returns synchronously. Everything below is safe to call immediately; tour commands issued before the scene is ready are replayed once it is.

```ts
type ViewerHandle = {
  element: HTMLElement;               // the viewer root inside your container
  options: Readonly<ViewerOptions>;   // as resolved, defaults filled in
  tour: TourControls;
  capture: CaptureCommands;           // stills, panoramas and the "as is" pair
  slots: ViewerSlots;                 // the host's own boxes; see Host slots
  ready: Promise<void>;               // first frame of the first scene
  loadScene(source: { url: string } | { document: unknown } | { repository: SceneRepository }): Promise<void>;
  setMode(mode: 'plan2d' | 'plan3d' | 'orbit' | 'walk' | 'tour'): void; // 'orbit' also resets the camera, like Reset camera
  getMode(): ViewerMode;
  focusRoom(roomId: string): boolean;   // room UUID; false for anything else
  setFurnitureVisible(visible: boolean): void;
  getFurnitureVisible(): boolean;
  setLocale(locale: Locale): void;    // any of the seven shipped tags, an alias like 'sr', or a registered code
  setSelection(target: { kind: 'wall' | 'opening' | 'room' | 'furniture'; id: string } | null): void;  // highlight by UUID; null clears
  describeSelection(target: ViewerSelection): SelectionDescription | null;  // what the built-in panel would offer, as data
  getLocale(): Locale;
  getState(): ViewerState;            // one synchronous read of everything below
  getScene(): SceneData | null;       // deep copy of the committed document; null before the first scene
  project(): ProjectInfo | null;      // the validated baked manifest and its folder; null for a bare scene
  exportGlb(options?: ExportGlbOptions): Promise<Blob>;  // element metadata table riding along; not-ready before the first scene
  exportUsdz(options?: ExportUsdzOptions): Promise<Blob>;  // for iOS Quick Look; not-ready before the first scene
  resize(): void;                     // normally not needed: the viewer observes its container
  addCheckpoint(request: { id: string }): boolean;             // camera tool: a new tour camera from the view, under the host's UUID
  startCheckpointPlacement(request: { id: string }): boolean;  // camera tool: click-to-place the camera `id`
  on(event, callback): () => void;    // see Events
  dispose(): void;                    // idempotent; frees the WebGL context
  [Symbol.dispose]?: () => void;      // `using viewer = mountViewer(…)` on engines that have it
};

type ViewerState = {
  mode: ViewerMode;
  tour: TourProgress | null;          // null until the scene is ready
  furnitureVisible: boolean;
  locale: Locale;
  sceneId: string | null;
  rev: number;                        // bumps on every committed scene change
};

type TourControls = {
  play(): void; pause(): void; toggle(): void; stop(): void;
  seek(fraction: number): void;        // 0..1 of the authored route
  seekDistance(metres: number): void;  // absolute distance along the route
  seekTime(seconds: number): void;     // point on the speed profile (1x seconds)
  setSpeed(speed: 0.5 | 1 | 2): void;  // the speed setting; never stored in the document
  progress(): TourProgress | null;     // null until the scene is ready
  on('progress' | 'state' | 'ended', callback): () => void;
};

type TourProgress = { state: 'ready' | 'playing' | 'paused' | 'ended'; fraction: number; distance: number; length: number; elapsed: number; duration: number; speed: 0.5 | 1 | 2 };
```

The speed setting scales the clock, not the clip: `elapsed`, `duration` and `seekTime` stay 1x seconds whatever the setting, a change eases in over half a second, and the viewer's `tourSpeed` event (`{ speed }`) announces it. The tour bar's speed button cycles 1x → 2x → 0.5x. `capture.frames({ speed })` steps `speed / fps` 1x seconds per frame and produces `round((to - from) / speed × fps) + 1` frames. On a run through tour cameras these seconds are the run as it plays: `duration` includes the half-second ease-in from camera 1 and the ease-out into the last camera, and a recording starts and ends at a standstill like the live run.

Distance along the authored route is canonical: `fraction = distance / length`. A scroll-driven host calls `tour.seek(scrollFraction)` on every scroll event; the camera moves while the clip stays paused. `dev/scroll-tour.html` is a complete example.

`getState()` returns the six values in one call, so they cannot disagree; across an iframe (`embed.getState()`) it is one round trip instead of six. `ready` rejects with a `ViewerLibError` of code `disposed` when the viewer is disposed before its first frame.

`getScene()` is a deep, mutable copy of the committed document, or `null` before the first scene is built; hand it straight back through `loadScene({ document })` to reload it. Across an iframe, `embed.getScene(): Promise<SceneData | null>` is answered even before the frame's `ready` — a host may ask what is on screen before there is anything. `window.__viewerDebug.exportScene()` (development / `?debug=1`) is kept as an alias.

`describeSelection(target)` answers with everything the viewer's OWN selection panel would show for a selection — as data, for a host that draws its own card. It takes the [`select` event](#events)'s payload verbatim and returns `null` when there is nothing to offer: a click that landed on nothing, a room, wall or opening the document does not carry, an unknown id, or a call before the first scene is built. It opens nothing and commits nothing, so the answer is the same in every [`edits`](#options) mode — `edits: 'off'`, where the built-in panel never appears at all, included.

```ts
type SelectionDescription = {
  kind: 'furniture' | 'finish' | 'opening';
  title: string;                       // already translated: "Floor finish · Kitchen"
  subject: { id: string; label: string };   // the room, face, placement or opening being edited
  current: string | null;              // the option to mark chosen: a finish is the document's own, a variant defaults to the standard one
  options: Array<{
    id: string;
    label: string;                     // a separate caption; never drawn into the picture
    preview: string;                   // a ready image URL, never empty: the content's own address, else a `data:` URL
    access?: 'free' | 'pro' | 'exclusive';   // the access level the content declares for this option; absent for the shipped bank
    allowed?: boolean;                 // whether the host's own workspace may take it, as the host wrote it; absent means "nobody said"
    op: SceneOp;                       // exactly what the built-in panel would dispatch for this swatch
  }>;
  scope?: {                            // finishes only; a variant panel has no narrow/broad pair
    label: string;                     // "Apply to all floors" / "Apply to all walls"
    ops: { one: SceneOp; all: SceneOp };  // the finish in force, applied narrowly or broadly
  };
  mirror?: {                           // furniture only: the mirror buttons a host card may draw
    allowed: ('x' | 'y' | 'z')[];      // axes the asset's catalogue facts allow; [] when it allows none
    current: ('x' | 'y' | 'z')[];      // axes the placement is mirrored on now
  };
};
```

Mirroring is a handle command next to the move tool: `handle.mirrorAsset(assetId, axis)` toggles one axis (`x` left↔right, `y` up↔down, `z` front↔back, in the object's own frame), judges the mirrored object where it stands like a move (settling it within 0.25 m when it must) and emits `assetEdit` with a `mirror_object` op (plus a `move_object` for the settle) or `assetEditRefused`. It returns `false` with no event when the asset's facts do not allow the axis, the asset is unknown, the move tool is not armed (or its chunk not loaded yet) in `orbit`/`plan3d`, or a drag is running. The viewer commits nothing; the host does, as for a move, and `revertAssetEdit()` puts the previous mirror back.

`current` is what the built-in panel puts its active ring on, defaulting included: for a finish it is the document's own answer and `null` when the surface names none, while a furniture or opening variant falls back to the archetype's standard one — so `current === null` for those two means "nothing on offer", never "the document is silent".

A swatch click is `handle`-free: apply `option.op` yourself, through your own document (`edits: 'emit'`/`'off'`) or through `jeex-viewer/ops`. `preview` has three sources and takes the first that answers: the address the CONTENT declares — a variant's `preview` in the loaded project's manifest, which may be an absolute `http(s)` URL such as a catalogue service's public preview, resolved against the manifest folder when it is a relative path; then the viewer's own render, made on demand at the moment of the call (furniture variants with the viewer's renderer, finishes and openings as canvas swatches); then the variant's palette as an SVG data URL when nothing can be drawn (no WebGL, a lost context). So it is never empty and never carries text. A picture served from another origin can fail — the viewer's own panel replaces a failed one with the flat palette chip, and a host card should do the same (`onerror`).

`access` and `allowed` are the content's words, carried and never judged: the viewer puts no badge on a swatch, refuses no click and asks no question — a `pro` option is listed like any other, with its own `op`. What such an option does on click is the host's decision, and a host that ignores both fields gets the same behaviour as for any other option. They are present only where the loaded project's manifest names them; the viewer's own bundled catalogue is silent about both. `title` and `label` follow [`setLocale`](#languages). It is a HANDLE capability: with the [custom element](#2-custom-element) reach it through `document.querySelector('jeex-viewer').viewer?.describeSelection(...)`. The [iframe protocol](#3-iframe-with-postmessage) does not carry it — `METHOD_LIST` and `PROTOCOL_VERSION` are unchanged — because a description holds rendered images, and a host across a frame boundary draws its own chrome around the frame rather than inside it.

`project()` answers with the baked manifest the viewer validated and the absolute URL of the folder it came from, or `null` when the scene was a bare document. It is per instance — two viewers on one page keep their catalogues, their finishes and their manifests to themselves. See [Project format](#project-format).

`exportGlb(options?)` returns a GLB `Blob` (`type: 'model/gltf-binary'`) of the committed document, with an element metadata table riding along: `extensionsUsed` names `EXT_structural_metadata` (one property table, one row per wall, wall face, room, opening and furniture placement, keyed by the same deterministic GUIDs as an eventual IFC export) and `EXT_mesh_features` (a constant feature id on every mesh a row names, pointing back into that table); `extras.jeex` carries `{ schemaVersion, sceneId, rev }` and, unless `embedDocument: false`, the full `SceneData` document. Re-exporting the same document is byte-for-byte identical. `GLTFExporter` is downloaded only on the first call. Rejects with a `not-ready` error before the first scene.

```ts
type ExportGlbOptions = {
  includeFurniture?: boolean;          // default true
  state?: 'current' | 'default';       // painted finishes, or the catalogue's own look; default 'current'
  embedDocument?: boolean;             // default true
};
```

Across an iframe, `embed.exportGlb(options?): Promise<ArrayBuffer>` — the same GLB bytes, as an `ArrayBuffer` rather than a `Blob` (the shape that crosses a `postMessage` boundary without a `Blob` constructor on either side); wrap it yourself when you need one: `new Blob([buffer], { type: 'model/gltf-binary' })`.

`exportUsdz(options?)` returns a USDZ `Blob` (`type: 'model/vnd.usdz+zip'`, a ZIP archive containing a `model.usda` USD-ASCII file and any textures), ready for iOS Quick Look — a native app hands one to `UIActivityViewController`/`QLPreviewController`, a web page links it with `rel="ar"`. `USDZExporter` is downloaded only on the first call.

```ts
type ExportUsdzOptions = {
  includeFurniture?: boolean;          // default true
};
```

Across an iframe, `embed.exportUsdz(options?): Promise<ArrayBuffer>`, the same shape as `exportGlb`'s.

### Moving assets in an editor

An editor host arms the asset move tool on the handle (ES module only; the iframe protocol does not carry it). A published tour never arms it.

```ts
setAssetMoveTool(enabled: boolean): void;   // the first arming loads the tool as its own chunk
armAssetMove(): void;                       // the next press on the canvas moves the selected object there
revertAssetEdit(): void;                    // the host refused the last assetEdit: the start poses come back
turnAsset(assetId: string, steps: number): boolean;  // steps × 15°, positive counter-clockwise from above (as Q)
mirrorAsset(assetId: string, axis: 'x' | 'y' | 'z'): boolean;  // toggles one mirror axis the asset's facts allow (above)
```

With the tool armed in `orbit` or `plan3d`, a press on the furniture `setSelection` highlighted and a drag past 4 px moves it on its anchor surface (floor, wall, ceiling). Every pose is snapped (a wall-snap archetype's back onto a wall within 0.15 m; a table lamp onto the top under it), judged by the layout rules and settled to the nearest legal pose within 0.25 m; the object is drawn where a release would put it, green, or in red under the pointer when nothing in reach is legal. A release commits exactly the drawn pose or refuses. While it drags, its surfaces show where THIS object, at its current yaw, may stand: a green cell lies under the footprint of a legal pose, a red one under none; host tops are part of the field for objects that may stand on them. Q/E turn 15° (judged like a move, refused when nothing fits), arrows nudge 5 cm (Shift 50 cm), Escape cancels. `turnAsset` answers `false` without an event when the tool is not armed (or not loaded yet) in a mode it serves, a drag is running, the id is unknown, or the object hangs on a wall. Every edit is an absolute pose computed from what is on screen: a turn, a mirror or a move made before the host answered the previous edit builds on that edit's result (two quick `turnAsset(id, 1)` are 30°), so a host commits the edits in the order it received them; `revertAssetEdit()` puts back the state before the first edit still waiting, and any new document answers them all.

Events:

| Handle event | Payload |
|---|---|
| `assetEdit` | `{ assetId, ops, baseRev, summary, gesture, carried? }`: `move_object` (position and `room`) and `rotate_object` when the yaw changed, for the moved object and then for every object standing on its top (`carried` lists those ids; absent when none). `gesture` is what the person did: `move` (a pointer drag, or a key burst with an arrow in it), `turn` (Q/E at rest or `turnAsset`, even when the turn settled the object a little) or `mirror` (`mirrorAsset`). The new poses stay on screen until the host answers with a document or `revertAssetEdit()` |
| `assetEditRefused` | `{ assetId, issues }`: the hard layout issues of the pose a release or a turn asked for; nothing moved |
| `assetMoveState` | `{ phase: 'idle' \| 'dragging' \| 'nudging' }` on each edge of a drag or a key burst, never per frame |

What may combine with what is a catalogue fact of the asset, never a scene field: `onSurface: true` (may stand on a top), `top: { y }` (holds what stands on it, `y` above its base), `kneeSpace: { height, sides, depth? }` (a seat may go under it from those sides, `front` being the side it faces), `tuck: { depth, height }` (a seat that goes under a knee space by up to `depth`). All are optional, an absent one means "not allowed", and a baked project's `ProjectObject` accepts the same fields. A mirror moves the sides with the object (`x` swaps `left` and `right`, `z` swaps `front` and `back`), and mirroring a host leaves what stands on it in place.

## Capture: stills, panoramas and provenance

```ts
type CaptureCommands = {
  still(request: {
    width: number; height: number;
    state?: 'current' | 'default';                             // 'default' = the flat before any painting
    camera?: CameraPose | { roomId: string } | 'presentation' | 'live';
    fov?: number; caption?: boolean;
  }): Promise<{ blob: Blob; provenance: Provenance }>;
  panorama(request: { width: number; roomId: string; state?: 'current' | 'default'; caption?: boolean }):
    Promise<{ blob: Blob; provenance: Provenance }>;           // equirectangular, height = width / 2
  pair(request): Promise<{ current: …; default: … }>;          // the staged shot and the unaltered original
};

type Provenance = {
  generator: 'jeex-viewer'; version: string; sceneId: string; rev: number; schemaVersion: '2.2';
  state: 'current' | 'default'; kind: 'still' | 'panorama' | 'plan' | 'frame';
  createdAt: string;                  // ISO 8601
  disclosure: 'rendered-3d';          // a JEEX artefact is a rendering, never a photograph
  camera?: CameraPose; roomId?: string;
};
```

Every capture renders BESIDE the live view — its own render target, its own camera — so the tour on screen never moves and the canvas is never resized. `state: 'default'` builds the same document offscreen with `finishes` and every asset finish override removed, lit by the same rig, and disposes it again; `pair` is both states of one shot, which is what the AI-disclosure rules (California AB 723, CRMLS 11.5.2) ask for when a listing image has been altered.

Every artefact carries `provenance`, and by default the disclosure sentence is also burnt into the bottom of the picture — «Rendered from a 3D model, not a photograph» (`Визуализация 3D-модели, не фотография` in Russian). Turn it off per request with `caption: false`, or for the whole mount with `capture: { disclosure: { caption: false } }` (`?captureCaption=0`, `data-capture-caption="0"`); `capture.disclosure.text` replaces the sentence. The sidecar's `disclosure` is a constant and no option changes it.

A capture before the first frame rejects with a `ViewerLibError` of code `not-ready`. Across an iframe the same two commands are `embed.captureStill(request)` and `embed.capturePanorama(request)`, each answering `{ png: ArrayBuffer; provenance }` in one structured clone; `embed.capturePair(request)` composes the pair host-side.

### Host slots (`handle.slots`)

The viewer owns the BOX, the host owns the CONTENT. `options.slots` names which boxes are built; the viewer positions them inside the viewport and never reads, empties or re-parents what you put in them.

```ts
type ViewerSlots = {
  get(name: SlotName): HTMLElement;              // throws MissingSlotError for a slot options.slots did not name
  anchorTo(target: AnchorTarget | null): void;   // what 'selection-anchor' follows; null parks it
  anchorPoint(): AnchorPoint | null;             // { x, y, visible } in viewport pixels, or null while parked
};
```

```ts
import { mountViewer } from 'jeex-viewer';

const viewer = mountViewer(container, { slots: ['bottom-center', 'selection-anchor'] });
// A box is there immediately, before the first scene: they are built with the SHELL.
viewer.slots.get('bottom-center').append(myToolbar);

viewer.on('select', (selection) => {
  if (selection.kind === 'none') return viewer.slots.anchorTo(null);
  viewer.slots.get('selection-anchor').replaceChildren(myCardFor(selection));
  // A point, or the same { kind, id } setSelection takes.
  viewer.slots.anchorTo({ kind: selection.kind, id: selection.id! });
});
```

Six of the eight names are corners and edges, inset by `--jeex-slot-inset` (and by `env(safe-area-inset-*)` where that is larger). `modal-root` covers the viewport one layer higher. `selection-anchor` follows a scene point: once a frame the viewer projects it and writes `--jeex-anchor-x`, `--jeex-anchor-y` (unitless pixels — the stylesheet multiplies by `1px`) and `data-visible` on that box. There is deliberately no anchor EVENT: a 60 Hz event across your boundary would say what the stylesheet already applies, and `anchorPoint()` reads the numbers back when you need them.

The boxes sit on layers 8 and 9 — above the viewer's own panels, mini-map and door HUD, below its loading and error cards. Your chrome can cover the viewer's panels; it can never cover the message that a scene failed to load. A box is transparent to the pointer and only its children take input, so a drag through the empty part of a bar still turns the camera. Keys typed into an `input`, `textarea`, `select`, `[contenteditable]` or anything inside a box never reach the camera.

**Three traps.**

1. The viewer root is `overflow: clip` with `contain: layout paint style`, so a popup rendered INSIDE a box is clipped by the viewer's rectangle. Nothing can escape it from within.
2. Libraries like shadcn/Base UI portal their popups to `document.body`, which is why trap 1 rarely bites in practice — but a portalled popup is outside the viewer, so the keyboard guard is not involved in it either, and its keys were never the viewer's to take.
3. `position: fixed` inside a box is positioned against the VIEWER, not the window: `contain` makes the root a containing block.

**Slots are not in the iframe protocol.** `METHOD_LIST` and `PROTOCOL_VERSION` are unchanged. Slots are a capability of the ES module and of the custom element, where your code and the viewer share a document; an iframe host draws its chrome around the frame instead.

## Events

Handle (`viewer.on(...)`) and custom element (`addEventListener(...)`, `detail` carries the payload, events bubble and are composed):

| Handle event | Element event | Payload |
|---|---|---|
| `ready` | `jeex-ready` | `{ options, sceneId }` after the first FRAME of that scene has been drawn — on the first mount and on every `loadScene`, so a host may screenshot on it |
| `error` | `jeex-error` | A `ViewerLibError` (`{ code, message, path?, detail?, cause? }`); codes in [Errors](#errors). The iframe bridge sends `{ code, message }` only |
| `scene` | `jeex-scene` | `{ sceneId, rev }` after every committed change |
| `mode` | `jeex-mode` | `ViewerMode` |
| `select` | `jeex-select` | `ViewerSelection` (`{ kind, id?, wallId?, roomId?, face?, point?, mode }`, `face` the clicked wall face as `{ room?, wallId, side }`, ids UUIDs) after a click in `plan2d`/`plan3d`/`orbit`. Only with [`select`](#options) on; `kind: 'none'` means the click landed on nothing |
| `edit` | `jeex-edit` | `{ ops: SceneOp[], baseRev: number }` — only with [`edits: 'emit'`](#options). The viewer committed NOTHING and is waiting for the host's `loadScene`; `baseRev` is the revision the batch was computed against. Does not cross the iframe boundary |
| `tour.on('progress')` | `jeex-tour-progress` | `TourProgress` |
| `tour.on('state')` | `jeex-tour-state` | `{ state }` |
| `tour.on('ended')` | `jeex-tour-ended` | `{}` |

A subscriber that throws is skipped and reported through the [log sink](#logging) with code `listener-failed`; the other subscribers still run.

## Errors

Every failure the library raises is a `ViewerLibError`. It carries a `code` to branch on and, when the failure is about a scene document, the JSON `path` of the field that caused it and a `detail` object with the numbers.

```ts
import { isViewerLibError, type ViewerErrorCode } from 'jeex-viewer';

viewer.on('error', (error) => {
  switch (error.code) {
    case 'no-scene-source':  return showPlaceholder();
    case 'scene-load':       return report(error.detail);        // { status, url }
    case 'scene-invalid':    return highlight(error.path);       // e.g. walls[3].openings[1].head
    case 'context-lost':     return;                             // the viewer restores itself
    case 'webgl-unavailable': return showStaticImage();
  }
});
```

| Code | Meaning |
|---|---|
| `webgl-unavailable` | No WebGL context could be created; the fallback card is shown |
| `no-scene-source` | Neither `scene`, `src` nor a repository was given |
| `scene-load` | The document could not be fetched (`detail: { status, url }`, timeout, redirect, size cap, content type) |
| `model-external-resource` | A GLB named a resource the viewer will not fetch — outside the model's folder, or under a scheme it does not speak; the refused URI is in `detail.url`, never in the message. Raised by the model source; inside a mounted viewer the placement keeps its procedural body (`modelState: 'failed'`), as for any model that fails to load |
| `scene-invalid` | The validator refused the document; a `SceneValidationError` adds `rule`, a stable kebab-case id that survives a reworded message |
| `project-invalid` | The document says `format: 'jeex-project'` and is not a valid baked manifest; `path` names the first bad field and `detail.issues` carries the list |
| `bad-params` | An API call with an argument outside its domain |
| `not-ready` | A call that needs a scene before the first one loaded |
| `disposed` | The viewer was disposed before it finished (`ready` rejects with it) |
| `context-lost` | The WebGL context was lost; the viewer re-mounts the scene on the same canvas when it is restored and fires `ready` again |
| `internal` | An invariant failed inside the viewer; please report it |

`isViewerLibError(value)` narrows an unknown catch value. The iframe host helper raises `EmbedError` with the same `code` union plus `unknown-method` and `timeout`.

## Logging

The viewer writes nothing to your console unless you let it. Pass `onLog` and you get structure instead of sentences:

```ts
mountViewer(container, {
  scene: { url: '/scenes/flat-a.json' },
  onLog: ({ level, code, message, detail }) => telemetry.record(level, code, { message, ...detail }),
});
```

`level` is `warn` or `error`; `code` is a stable id (`option-invalid`, `walkspawn-derived`, `listener-failed`, `locale-unknown`, …) to filter on. Without `onLog` the viewer falls back to the console, prefixed `[jeex-viewer]`. `<jeex-viewer>` takes the same sink as a property (`element.onLog = …`, before you connect it); `embedViewer({ onLog })` covers the iframe handle.

## Sizing and styling

- The viewer fills its container. Give the container a height; `100%` of an unsized parent is zero.
- The component stylesheet is scoped to the `.jeex-viewer` root. It does not touch `html`, `body`, `:root` or global element selectors. Layout breakpoints are container queries, so a narrow embed gets the compact chrome regardless of window size.
- Several viewers on one page are independent: keyboard input goes to the viewer that has focus (click the canvas), each has its own locale, and disposing one does not affect another. Procedural textures are content-addressed and shared between instances through a reference-counted cache; the last viewer to dispose frees them.
- Fullscreen uses the Fullscreen API on the viewer root. Inside an iframe it needs `allow="fullscreen"` on the frame; without it the button reports "fullscreen unavailable".
- `window.__viewerDebug`, `window.__appReady` and `window.__viewerReadyAt` are set by the first mounted viewer only (used by the browser checks). The demo page also sets `window.jeexViewer`.

## Theming

The chrome is themed with custom properties. Set them on the VIEWER'S OWN ROOT — the element with class `jeex-viewer` — with an unlayered rule of your own:

```css
.jeex-viewer {
  --jeex-accent: #e0b04a;
  --jeex-surface: rgb(20 20 24 / 0.82);
  --jeex-surface-text: #f4f1ea;
  --jeex-radius: 10px;
  --jeex-font: 'Inter', system-ui, sans-serif;
  --jeex-minimap-size: 220px;
  --jeex-chrome-opacity: 0.9;
  --jeex-focus: #e0b04a;
  --jeex-color-scheme: light;
  --jeex-slot-inset: 24px;
}
```

**Not on an ancestor.** The sheet declares each property's default ON that root, and a declaration is exactly what an inherited value cannot beat — a rule on `<jeex-viewer>`, on your container or on `body` is shadowed and does nothing. An UNLAYERED rule on the root itself wins, because the sheet's own rules live in `@layer component`. (Checked: `body { --jeex-accent }` has no effect, `.jeex-viewer { --jeex-accent }` takes effect.) Inside the custom element the root lives in a shadow root, where a page rule cannot reach it: add a sheet to that shadow root, or set the properties on the root element directly.

Those ten are the contract (`THEME_PROPERTIES` in the package); everything else in the sheet derives from them.

`--jeex-color-scheme` (`light`, `dark` or `light dark`) decides which half of every `light-dark()` colour in the sheet resolves — one line and the whole chrome follows, with no `::part` and no `!important`. Because that `color-scheme` is a `var()` and not a literal, `light-dark()` must reach the browser **unpolyfilled**: a bundler that down-levels it (Lightning CSS does, below its `light-dark()` baseline) rewrites every such colour into two companion `var()`s it then never defines, and the whole chrome silently loses its backgrounds and inherits the host page's text colour. The package's own builds pin the CSS baseline for that reason (`vite.css-target.ts`) and `scripts/css-contract-check.ts` fails the build that breaks it; a host that re-processes `jeex-viewer/style.css` needs the same floor (Chrome/Edge 123, Firefox 120, Safari 17.5). `--jeex-slot-inset` (18px) is how far a corner [slot](#host-slots-handleslots) sits from the viewport edge, before `env(safe-area-inset-*)` raises it on a notched screen. For anything a property cannot express, the shell exposes seven shadow parts (`SHELL_PARTS`): `canvas`, `control-bar`, `mode-bar`, `tour-bar`, `minimap`, `panel`, `hint`:

```css
jeex-viewer::part(control-bar) { backdrop-filter: none; }
```

The stylesheet is in `@layer reset, component`, so an unlayered rule of yours wins without `!important` and without counting selectors.

## Languages

Seven catalogues ship: `en`, `de`, `fr`, `it`, `es`, `sr-Latn` (Serbian, Latin script) and `ru`.
Every one answers every key in its own language. The German, French, Italian and Spanish catalogues
were machine-translated from the English source and have not had a native speaker's review yet;
corrections are welcome. `locales()` lists what the build and your own registrations add up to.

**Tags.** A tag is read as BCP-47: the region is dropped (`<jeex-viewer lang="de-AT">` selects `de`),
a script subtag is honoured (`sr-Latn`, `sr-latn`, `SR-LATN` are one locale), and a bare `sr` resolves
to `sr-Latn`, because JEEX's Serbian is Latin script and CLDR would otherwise read the bare tag as
Cyrillic. `sr-Cyrl` is refused rather than answered in Latin: no catalogue, so the viewer warns
(`locale-unknown`) and stays on the default. `getLocale()` and the shell's `lang` always report the
canonical tag, so `setLocale('sr')` is followed by `getLocale() === 'sr-Latn'`.

Add your own before you mount:

```ts
import { registerLocale, MESSAGE_KEYS } from 'jeex-viewer';

registerLocale('nl', { /* every key of MESSAGE_KEYS */ });
```

The catalogue must be complete: the parameter is typed `Record<MessageKey, string>`, so the compiler
refuses a partial one, because you are adding a language for people who do not read the one it would
fall back to. A code with a script subtag is kept whole (`registerLocale('sr-Cyrl', …)` adds exactly
that tag and stops the refusal above); a region in it is dropped.

## Controls

«360» is the dollhouse (`orbit`), «Walk» a person at eye height (`walk`). Every gesture moves the picture the way the hand moves: drag the floor towards you and you go forward, drag it right and you step left.

| Input | 360 | Walk |
|---|---|---|
| Left drag | rotate | look around |
| Right drag, Shift + drag, **Space held + drag** | pan (the point under the pointer stays under it) | move: vertical = forward/back, horizontal = strafe, with collisions |
| Wheel, trackpad two-finger scroll, pinch | zoom | short steps forward/back along the view, with collisions |
| Trackpad sideways swipe | pan | strafe |
| Click | select what is under the pointer | walk to the floor point (a floor ring under the pointer shows where); a click on a door opens it |
| Double-click | fly in on the floor point | (two clicks in one place: walk there faster) |
| `W` `A` `S` `D` / arrows | pan the model | walk; `Shift` runs |
| `+` / `-` | — | narrow / widen the field of view (reset by a mode switch) |
| Touch | one finger rotates, two fingers pan, pinch zooms | one finger looks, a tap walks, two fingers move, pinch steps forward/back |

The cursor is a grab hand over the scene, a closed hand while dragging and a four-way arrow while Space or Shift is held.

**Embedded in a scrolling page.** The wheel and Space belong to the page until the viewer is engaged — a click or tap in the scene, focus anywhere inside the viewer, or fullscreen. Before that, a plain wheel over the viewer scrolls the page and a short «Ctrl + scroll to zoom» plate (⌘ on Apple platforms) says how to zoom; Ctrl/⌘ + wheel and a trackpad pinch act at once. A page scrolls when `<html>`, `<body>` (the `html, body { height: 100%; overflow-x: hidden }` theme pattern makes `<body>` the scroller) or any scrolling box around the viewer has more content than room. A viewer that fills a page that cannot scroll (the standalone page, an editor) is engaged from the start; a viewer inside an iframe cannot see the host's scroll and waits for the click. Space is taken only while the viewer's own root has focus, never from a focused button inside it, and `interaction: 'passive'` never takes Space or stops the page scrolling. There is no pointer lock.

Under `prefers-reduced-motion` (or `motion: 'reduced'`) a click on the floor and a wheel step land at once instead of gliding; a drag moves exactly as far as the hand, with no inertia, in every mode.

## Accessibility

The viewer is operable with a keyboard and a screen reader on every integration path, and it respects the reader's motion preference.

- **Keyboard.** The canvas is focusable. In walk mode `W` `A` `S` `D` or the arrow keys move, `Shift` runs, `+`/`-` zoom the view; in 360 the same keys pan the model; `Space` held with a drag moves in both (see [Controls](#controls)). The canvas declares this in `aria-keyshortcuts` and in its description. Every control in the chrome is its own tab stop and shows a visible focus ring (`:focus-visible`, colour from `--jeex-focus`).
- **Finish and interior panel.** A dialog (`role="dialog"`, `aria-modal`): focus moves to its first control on open, Tab stays inside it, Escape or a press outside closes it and focus returns to the control that opened it. The viewer does not use the native `<dialog>.showModal()` because that would make the whole host page inert.
- **Screen readers.** The canvas carries a description built from the scene name and the room list, rebuilt on every `loadScene`. A hidden polite live region announces mode changes and the room the camera arrives in, at most once per second. The shell root carries `lang` and updates it on `setLocale`; `<jeex-viewer>` reflects the resolved locale onto its own `lang` when the host set none.
- **Reduced motion.** The `motion` option (row in the [options table](#options)) defaults to `auto`: under `prefers-reduced-motion: reduce` an engaged tour opens paused unless the host set `tour.mode` explicitly, and `focusRoom`, a minimap click and `flyTo` land in one frame instead of animating. `motion: 'reduced'` forces that behaviour; `motion: 'full'` forces full motion. `tour.seek()` keeps working in every mode: scroll-driven scrubbing is manual control, not animation.
- **Targets and contrast.** Every interactive target is at least 24×24 CSS px (WCAG 2.2). The five reference pages pass axe (`wcag2a`, `wcag2aa`, `wcag22aa`) with zero critical or serious violations; the e2e suite keeps that number at zero.
- **iframe.** `embedViewer` sets a `title` on the frame (default `"JEEX apartment viewer"`); pass `title` in the host page's language.

## Content Security Policy

The viewer runs under a strict policy with no `unsafe-inline` of any kind:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'
```

- **`style-src 'self'`** is enough because the component stylesheet is delivered as a constructed `CSSStyleSheet` through `adoptedStyleSheets` — never a `<style>` element and never a `style` attribute (Baseline widely available since 2023-03-27). Dynamic values are written with `element.style.setProperty`, which no CSP directive governs.
- **`img-src data:`** is required: finish and furniture swatches are rendered by the viewer and shown as `data:` PNG URLs.
- **`connect-src`** must cover wherever `scene.url` is fetched from. A scene on another origin also needs CORS from that origin.
- **Trusted Types** (`require-trusted-types-for 'script'`) needs nothing from the host: the viewer builds every node with `createElement`/`append`/`textContent` and assigns no string to `innerHTML` anywhere, so it needs no policy of its own and cannot fall foul of a host's `trusted-types` allowlist. `src/html-sinks.test.ts` holds every production module to that (no `innerHTML`/`outerHTML`/`srcdoc` assignment, `insertAdjacentHTML`, `eval`, string timers or script elements; its allowlist is empty), and the e2e `trusted-types.spec.ts` mounts two viewers under an enforcing page.
- The viewer bundles three.js and loads no script at runtime, so `script-src 'self'` is enough for the ES-module and custom-element paths. The iframe path additionally needs `frame-src` for the viewer's origin.

## iframe permissions and origin

`embedViewer` sets, in this order of what a host is likely to want to change:

| Attribute | Default | Why |
|---|---|---|
| `title` | `"JEEX apartment viewer"` | Every iframe needs an accessible name (WCAG 4.1.2). The helper never loads the viewer's message catalogue, so its default is English — pass `title` in the host page's language. |
| `sandbox` | `allow-scripts allow-same-origin` | See below. Pass `sandbox` to override; `sandbox: ''` is the strictest the browser has. |
| `allow` | `fullscreen` | Without it the viewer's fullscreen button reports that fullscreen is unavailable. `allow` defaults to `self`, so a cross-origin frame gets nothing the host does not grant. |
| `referrerpolicy` | `no-referrer` | The viewer needs no referrer and the host's URL is the host's business. |
| `loading` | `lazy` | A viewer below the fold costs the host nothing until it is scrolled to. |

**Why `allow-same-origin` stays.** Combined with `allow-scripts` it is a no-op sandbox for a frame served from the host's own origin — but removing it gives the frame an **opaque** origin, whose `event.origin` serialises as `"null"`. Both sides of the protocol compare `event.origin` against an exact string and neither may accept `"null"`, so an opaque frame could not answer the host at all and every command would time out.

**The isolation that does work is an origin.** Serve `embed.html` from an origin of its own (`viewer.example.com`, not a path on the host). Then `allow-scripts allow-same-origin` sandboxes nothing away that matters, because the frame's "same origin" is the viewer's, not the host's: it cannot read the host's cookies, storage or DOM. Scene URLs are fetched **from the viewer's origin without credentials** (`credentials: 'omit'`), which is one more reason for that origin to be its own — and the helper logs a `same-origin-frame` warning through `onLog` when `src` resolves to the host page's own origin, because that is the one misconfiguration the sandbox cannot help with.

### Who may frame a hosted `embed.html`

`?host=` names where the frame sends its replies and whose commands it accepts; it does not decide who may frame the page, and nothing inside the page can. Whoever writes the frame URL chooses `?host=`, so any site can frame a publicly hosted `embed.html` naming itself and drive a full session (`getScene`, `captureStill`, `exportGlb`) over whatever that frame loads. A check of `document.referrer` or `location.ancestorOrigins` in the page is not a boundary: the framer controls the referrer (`referrerpolicy="no-referrer"` removes it), `ancestorOrigins` is absent in Firefox, and a script check runs only after the page has already been loaded into the hostile frame.

The control is the HTTP response header of `embed.html` itself, set by whoever deploys it:

```
Content-Security-Policy: frame-ancestors https://agency-one.example https://agency-two.example
```

- List the publisher origins allowed to embed this instance; `'self'` adds the viewer's own origin. A deployment that serves only one publisher lists one origin.
- It must be a response header: `frame-ancestors` in a `<meta>` tag is ignored by every browser.
- It applies to `embed.html` (and any other page that installs the bridge), not to the scripts or the scene files.
- The ES-module and `<jeex-viewer>` paths run in the host's own page and have no frame to protect; the header is for the iframe path only.

The repository ships no server, so the header is a deployment fact, not a runtime option.

## Scene document

Schema `2.2`, and only 2.2: a `2.0` or `2.1` document is refused, never converted (2.1 added a placement's `mirror` and made `scale` positive; 2.2 split a placement's catalogue reference into the fields `asset` and `library`, so the earlier `library:asset` string means nothing to this build and its producer rewrites it). The full shape is the published JSON Schema (`dist-lib/schema/scene.schema.json`, written by `bun run build:lib`, imported as `jeex-viewer/schema/scene.json`, see below); the rules it cannot express are listed under it. Minimal shape:

```ts
type SceneData = {
  schemaVersion: '2.2';
  id: string;                          // every id in the document is a UUID v7
  name: string;                        // shown as the brand context line
  ceilingHeight: number;               // metres
  nodes: { id: string; p: { x: number; z: number } }[];          // wall centreline graph
  walls: { id: string; a: string; b: string; thickness: number;  // node ids
           arc?: { radius: number; ccw: boolean }; role?: 'facade' | 'partition';
           openings?: { id: string; type: 'door' | 'window' | 'passage'; center: number; width: number;
                        sill?: number; head?: number; entrance?: boolean; hinge?: 'a' | 'b'; swing?: 'in' | 'out' }[] }[];
  rooms: { id: string; name: string; anchor: { x: number; z: number }; floorMaterial: string; kind?: 'loggia' }[];
  assetLibrary?: string;               // library UUID a placement without `library` belongs to; absent = the built-in bank
  assets: DemoAsset[];                 // furniture placements: { id, type, asset?, library?, variant?, room?, position, rotationY?, scale?, mirror? }
  presentationCamera: { position: Vec3; target: Vec3 };
  roomCameras: Record<string, { position: Vec3; target: Vec3 }>;   // keyed by room UUID
  navigation: { points: Vec3[] };
  walkSpawn?: { position: Vec3; target: Vec3 };
  autotour: { speed?: number; path: Vec3[]; gaze: TourGazeKey[]; zones?: TourSpeedZone[] };
  finishes?: {                         // painted state; what the viewer exports
    rooms?: Record<string, { floor?: string; walls?: string }>;   // keyed by room UUID
    faces?: { room?: string; wallId: string; side: 'L' | 'R'; finish: string }[];   // `room` omitted on the facade
    facade?: string;
  };
  tourCheckpoints?: { id: string; position: Vec3; yaw: number; pitch: number; name?: string }[];
  interiors?: InteriorPreset[];        // preset selector appears only when present
  materials?: MaterialDefinition[];    // local overrides of the built-in catalogue
};
```

Rules the validator enforces:

- Units are metres and radians; the plan is the X–Z plane, Y up.
- Room polygons are derived from the wall graph; a room is a name plus an `anchor` point strictly inside it.
- Every entity id — the scene, nodes, walls, openings, rooms, placements, tour checkpoints, interior presets and scene-local materials — is a lowercase canonical UUID v7 (`UUID_V7_PATTERN`: version nibble `7`, variant `10xx`) and is unique across all kinds. Every reference carries the UUID: wall nodes, room keys, a placement's `room`, catalogue finishes and variants. Names are fields (`name`), never ids.
- The viewer validates ids and never mints one: whoever creates an entity — the author, an editor host, a host command — brings its UUID.
- A placement's catalogue reference is two fields, never one string: `asset` is the bare archetype or variant UUID, `library` the UUID of the library that holds it. A placement without `library` belongs to the document's `assetLibrary`, and when that is absent too, to the player's built-in bank, which a document never names (a placement from the built-in bank carries no `library`). `asset`, `library` and `assetLibrary` are UUID v7: a `library:asset` string is refused as `asset-reference-invalid`, a `library` that is not a UUID as `asset-library-invalid` (`scene-asset-library-invalid` for `assetLibrary`), a library the registries do not declare as `asset-unknown-library` (`scene-unknown-asset-library` for `assetLibrary`), and a `library` on a placement that names no `asset` as `asset-library-without-asset`. The library chooses which bank answers FIRST, not a closed namespace: the named library's own objects are looked up, and an id it does not hold falls back through the layers the registries were built with (a project's bank, then the built-in bank, `registriesFromLibrary(project, CATALOGUE_REGISTRIES)`), the same order the renderer reads; a library nobody declared is still refused. `type` stays the furniture type word or archetype UUID it always was, and is what a placement without `asset` resolves.
- A placement's `scale` is positive; a reflection is `mirror: { x?: true, y?: true, z?: true }` (schema 2.1), never a negative scale, which is refused with «use mirror». Which axes an asset may be mirrored on is a catalogue fact (`CatalogueObject.mirror`), judged by `mirror_object`, not by the document validator.
- A wall face is not an entity: it is addressed by the structured key `{ room?, wallId, side }` everywhere (`finishes.faces`, a `set_material` target, the `select` event, exports).
- Words stay words: `set_material` aliases (`floors`, `walls`, `facade`), furniture `type` words (`'sofa'`), slot names, kinds. The built-in bank's own library id (`starter:interior-v1`) is code vocabulary and never appears in a document.
- `Opening.center` is measured along the wall centreline from node `a`. Omitted `sill`/`head` mean the defaults for the kind (window 0.9 / 2.2, door 0 / 2.1); `head` must stay 0.05 m under the ceiling.
- Finish UUIDs resolve through the built-in catalogue; `materials` only adds or overrides.
- An interior preset dresses what exists: it may not carry an operation that creates an entity (`add_node`, `add_wall`, `split_wall`, `add_room`, `add_opening`, `place_object`).

The demo document `src/demo/scene-data.ts` (38 walls, 68 objects) exercises every feature and is the reference for authoring.

A JSON Schema (draft 2020-12) is generated from this same `SceneData` type — no second, hand-written source of truth — and published alongside the package, next to one for the viewer options (`bun run build:lib` writes both to `dist-lib/schema/`):

```ts
import schema from 'jeex-viewer/schema/scene.json';                  // dist-lib/schema/scene.schema.json
import optionsSchema from 'jeex-viewer/schema/viewer-options.json';  // dist-lib/schema/viewer-options.schema.json
```

A scene document may carry a top-level `"$schema"` key (e.g. `"https://player.jeex.org/schema/scene/<version>.json"`) for an editor's autocomplete and inline validation; the viewer's own validator ignores it without a warning — it is the one unknown top-level field a document is allowed to carry. The schema catches shape mistakes early; the rules above and `validateScene` still own everything the schema cannot express (unique ids, plan topology, catalogue references).

## Project format

A **baked project** is a folder whose root is a `project.json`. It carries the scene document, the object library it places, the finishes those objects and rooms wear and the rights the bake was produced under — everything the viewer draws comes out of that one folder, and not one request leaves it. The same folder works from a CDN, from a client's own domain and from an unpacked download on any static host. This is format version `jeex-project` 2 (every id a UUID v7); a manifest with any other `formatVersion` is refused.

```
project.json                       the manifest: scene, library, materials, rights
scene.json                         the scene document (schema 2.2)
obj/<versionId>.glb                one file per placed variant version
tex/<material>_<map>.ktx2          pbr materials only
prev/<id>.webp                     variant and finish previews
poster.webp                        a still for cards and OpenGraph
video/<preset>.mp4                 optional
```

Every path inside the manifest is relative to the manifest's folder and stays inside it: no `..` segment, no leading `/`, no URL scheme, no query and no fragment. The one exception is `preview` — on an object, on a variant and on a material — which may ALSO be an absolute `http(s)` URL: a preview is a picture served publicly (for example a catalogue service's unsigned, immutable `https://cdn.example.com/previews/<asset>/<variant>/<version>.webp`), and a live library handed over by an editor host names that address rather than a file in a folder it has not baked. The exception widens a PICTURE and not a download: everything the viewer fetches — the scene, the GLBs, the textures — is still relative and still inside the folder, and a `preview` that is neither a path inside the folder nor an `http(s)` URL is refused. Every object in the manifest is strict — an unknown key is a refusal, so a field a later format version means something by cannot be silently ignored by this one.

```ts
type BakedProjectManifest = {
  format: 'jeex-project';
  formatVersion: 2;
  projectId: string;                 // UUID v7, stable across bakes
  bakeId: string;                    // UUID v7, a new one per bake
  bakedAt: string;                   // ISO-8601
  title?: string;
  scene: string;                     // relative path of the scene document
  library: ProjectLibraryManifest;   // the bake's own object bank and materials
  media?: ProjectMedia[];            // renders and videos; the viewer lists them and plays none
  rights: ProjectRights;
  generator: { name: string; version: string };
  mark?: { href: string };           // the producer's mark the viewer must show (http(s) link)
};

type ProjectLibraryManifest = {
  manifestVersion: '1.0';
  id: string;                        // equals `projectId`; the scene's `assetLibrary` (or a placement's `library`)
  name?: string;
  publisher: string;                 // UUID v7 of the publishing workspace
  license: string;                   // SPDX id or a URL
  objects: ProjectObject[];          // `model` required, no `builder`
  materials: ProjectMaterial[];
};

type ProjectObject = {                // `CatalogueObject` with `model` required and no `builder`
  id: string;                        // UUID v7, like every variant and material id below
  name: string; category: string; dims: [number, number, number];
  anchor: 'floor' | 'wall' | 'ceiling'; wallSnap: boolean; clearance: number; tags: string[];
  model: string;                     // relative; the archetype's GLB
  lods?: string[]; materialSlots?: Record<string, string>; options?: AssetOptions;
  preview?: string;                  // relative path OR an absolute http(s) URL
  slots: SlotName[]; defaultFinishes: Partial<Record<SlotName, string>>; primarySlot: SlotName;
  // SlotName: an open identifier /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, not only the shipped FinishSlot names;
  // slot names are words, the finishes they name are material UUIDs.
  // A variant with a GLB whose archetype `defaultFinishes` and own `finishes` name no finish is BAKED:
  // its GLB renders with the materials it shipped and placement `finishes` are ignored for it.
  variants: ProjectVariant[]; defaultVariant: string; layout?: AssetLayout;
};

type ProjectVariant = {               // the unit of geometry and of the Replace picker
  id: string; name: string; version: string; tags?: string[];
  dims?: [number, number, number]; finishes?: Partial<Record<SlotName, string>>; options?: AssetOptions;
  pricing: AssetPricing;             // see below; validated and passed through, never acted on
  model?: string;                    // relative; `obj/<versionId>.glb`
  preview?: string;                  // relative path OR an absolute http(s) URL — what the picker shows
  access?: 'free' | 'pro' | 'exclusive';   // carried to `SelectionOption.access`; the viewer judges nothing
  allowed?: boolean;                 // carried to `SelectionOption.allowed`; the host writes it, the host decides
};

type AssetPricing = {
  model: 'free' | 'subscription' | 'premium';
  tier?: 'standard' | 'pro';
  buyout?: { amount: number; currency: string };
};

type ProjectMaterial = {
  id: string; name: string; tags?: string[]; apply: FinishApply[]; preview?: string;
} & (
  | { pbr: { albedo: string; normal?: string; roughness: number; metalness?: number; tile: [number, number] } }
  | { generator: FinishGenerator; tile?: number }   // one of eleven named parametric textures
);

type ProjectRights = {
  workspaceId: string;               // UUID v7
  perpetual: true;                   // documentation, not a switch
  assets: { assetId: string; variantId: string; version: string; access: 'free' | 'pro' | 'exclusive' }[];
};

// Every id above — projectId, bakeId, library.publisher, rights.workspaceId, objects, variants, materials,
// rights asset and variant ids — is checked by the same strict UUID v7 rule as a scene id; any other UUID
// version (a v4 included) is refused.
```

Pricing and access are metadata supplied by whoever produced the bake. The player checks their shape (an unknown key or value is a `project-invalid` refusal like any other), copies a variant's `pricing.model` onto its placed object's `userData.pricing`, carries `access` and `allowed` into [`describeSelection`](#viewer-handle-api) and hands the whole manifest, `rights` included, to the host through `project()`. It shows no price, badge or lock and refuses no variant because of them.

A material is either `pbr` (KTX2 maps inside the folder) or `generator` — a named parametric texture the viewer draws itself: `planks`, `chevron`, `terrazzo`, `tiles`, `plaster`, `stripes`, `wood_grain`, `fabric_weave`, `painted_plaster`, `plank_floor`, `tile_grid`. A generator this build does not know gives a flat material in the entry's own `tone` and a warning, never a refusal.

### Loading a project

`scene.url` takes either form: the viewer reads the document, and a `format: 'jeex-project'` field is what makes it a manifest rather than a scene. A bare scene keeps exactly the path it had before the format existed — the shipped catalogue, the shipped finishes, procedural bodies.

```ts
mountViewer(container, { scene: { url: 'https://cdn.example.com/w1/p1/7/project.json' } });  // a bake
mountViewer(container, { scene: { url: '/scenes/flat-a.json' } });                      // a bare scene
```

A host that already holds both — an editor with the document open in memory — passes the manifest beside it instead of making the viewer fetch it back:

```ts
mountViewer(container, {
  scene: {
    document: sceneDocument,
    library: { manifest, baseUrl: 'https://cdn.example.com/w1/p1/7/' },   // trailing slash: it is the folder
  },
});
```

The manifest goes through the same validator on both routes. A manifest that fails it rejects the mount with `code: 'project-invalid'`, `path` naming the first bad field and `detail.issues` listing the rest; nothing is half-read and no file named by a bad manifest is fetched.

`ready` still means "the first frame is drawn", and a baked object has no procedural body — so that frame carries a translucent stand-in sized from the object's `dims` (`userData.degraded === 'pending-model'`), and the GLBs replace them as they arrive, nearest to the presentation camera first, at most four in flight.

A placement that names an archetype of the loaded project takes its Replace list from the project's OWN library, with the shipped catalogue behind it: an archetype that exists only in the project's library gets a picker at all, a scene that still names bundled ids keeps the one it always had, and on an id collision the project's entry wins — it is the one whose GLB is actually loaded. The built-in panel and `describeSelection` read the same merged bank, so a host card and the viewer's own panel can never list two different sets.

`handle.project()` hands the validated manifest to the host for its own chrome — a listing card, a downloads menu, a rights notice:

```ts
type ProjectInfo = { manifest: BakedProjectManifest; baseUrl: string };
handle.project(): ProjectInfo | null;   // null for a bare scene
```

### Limits

Part of the contract, enforced while reading (`src/shared/limits.ts`):

| What | Limit |
|---|---|
| `project.json` | 1 MB |
| `scene.json` | 8 MB (`MAX_SCENE_BYTES`, shared with a bare scene) |
| one GLB | 16 MB |
| one project in total | 96 MB, after which the loader stops and reports `project-budget` |
| models in flight | 4 |

The manifest and the scene are fetched with `redirect: 'error'` and a `Content-Type` that must include `application/json`; the project's own files (the scene and the GLBs) go out with `credentials: 'omit'`, so a cross-origin bake needs CORS and never carries the viewer's cookies. The very first request, which cannot yet know it is reading a manifest, omits them too.

A GLB is also judged INSIDE the container: every `images[].uri` and `buffers[].uri` it names must resolve to an http(s) URL inside the model's own folder (a `data:` URI is fine — nothing is fetched). A container that names a texture or buffer anywhere else — another origin, the site root, a `file:` or `blob:` scheme — is refused with code `model-external-resource`, so a hostile model cannot turn the frame into a fetcher of arbitrary URLs.

Before any of that, the container's own structure is checked against glTF 2.0: the `glTF` magic and version 2, a header length equal to the bytes received, chunks that fit, exactly one JSON chunk and it first, a BIN chunk only in second place (chunks of other types after those are ignored, as the specification requires). A container that fails is refused as `scene-load` with `detail.reason` naming the defect (`glb-header`, `glb-magic`, `glb-version`, `glb-length`, `glb-chunk`, `glb-json-first`, `glb-chunk-order`, `glb-json`; `glb-parse` when the structure is sound but the loader cannot build the document). Like every model failure, inside a mounted viewer it leaves the placement's procedural body (`modelState: 'failed'`).

### Log codes

None of these is a failure; all four arrive through `onLog` (see [Logging](#logging)):

| Code | Meaning |
|---|---|
| `asset-defect` | A GLB out of the bake breaks a convention — bounding box off `dims` by more than 2 %, an unbound material slot, a pivot off the floor, a camera or a light inside the model. It is drawn anyway |
| `project-budget` | The 96 MB total was reached; the remaining models are not downloaded |
| `pbr-textures-deferred` | A `pbr` material was accepted and drawn flat (its `roughness` and `metalness`, the neutral fallback colour): KTX2 texture loading is not in this version |
| `unknown-generator:<kind>` | A material named a parametric texture this build does not have; it is drawn flat in the entry's own `tone` |

## Scene operations entry (`jeex-viewer/ops`)

`jeex-viewer/ops` (`dist-lib/jeex-viewer-ops.js`, ≤ 72.6 KB gzip — its own budget, kept out of the 700 KB viewer boot sum: editing a document is an authoring action, not part of opening a tour) is the entry for a caller that edits a scene document WITHOUT mounting a viewer — for example a server-side editor process applying a batch of operations to a document it stores. It carries no `three` and no DOM:

```ts
import { CATALOGUE_REGISTRIES, SceneModel, isApplyOk, lintLayout, parseSceneDocument, parseSceneOps } from 'jeex-viewer/ops';

const model = new SceneModel(parseSceneDocument(stored), CATALOGUE_REGISTRIES, { lint: lintLayout });
const result = model.apply({ baseRev: model.rev, ops: parseSceneOps(fromTheWire), lint: 'strict' });
if (!isApplyOk(result)) console.error(result.error, result.message, result.issues);
```

The full export list:

- **Op vocabulary** — `applyOp`, `OpError`, `floorFinishOf`, `roomWallFinishOf`, `facadeFinishOf`, `faceFinishOf`, `TOUCHED_SHELL`, `TOUCHED_FACADE`, `isTouchedAsset` (types: `OpOutcome`, `TouchedEntity` — what an op touched, as `{ kind, … }` with faces as `FaceKey` — `SceneOp`, `InteriorPreset`, plus every member of the union by its own name — `SetRoomOp`, `PlaceObjectOp`, … — so an editor panel can be typed to one operation). The twenty-seven operations:

| Operation | What it does |
|---|---|
| `add_node` | Adds node `id` to the wall centreline graph at `p`. |
| `move_node` | Moves a node (`p` absolute or `dp` delta). Adjoining walls follow; their openings keep their share of the wall; a wall that would end up shorter than `WALL_LIMITS.minCentrelineLength` refuses. |
| `remove_node` | Removes a node no wall is attached to. |
| `add_wall` | Adds wall `id` between two existing, distinct nodes; `thickness` clamps into `WALL_THICKNESS`; a duplicate `a–b` edge refuses. |
| `set_wall` | Changes a wall's `thickness`, `role` or `arc` (`arc: null` straightens it); refuses when it names no field. |
| `remove_wall` | Removes a wall with its openings and its face finishes, all in `touched`; refuses the wall carrying the entrance door. |
| `split_wall` | Cuts a straight wall in two at `at` metres from node `a`, with the caller's `nodeId` for the new node and `ids` for the two halves; painted faces follow both halves (the result's `remap`). |
| `set_ceiling` | Sets the ceiling height and re-clamps every opening under it. |
| `add_opening` | Cuts door, window or passage `id` into a wall; the geometry is clamped onto the wall and refused when it would overlap an opening already there. |
| `set_opening` | Moves or resizes an opening (absolute or delta), and with `wallId` moves it to another wall — which takes an absolute `center` and runs the whole `add_opening` fit check. |
| `remove_opening` | Removes an opening; refuses the entrance door. |
| `replace_opening_variant` | Swaps an opening's variant, which has to be built for its family (`registries.openingVariantsOf` lists them). |
| `add_room` | Adds room `id` at an anchor inside a free face of the graph; starts on `registries.defaultFloorFinish` when given no `floorMaterial`. |
| `set_room` | Changes a room's `name`, `kind`, `anchor` or `accent`; a name is non-empty and at most `ROOM_NAME_MAX` characters. |
| `remove_room` | Removes a room, unbinds its furniture, drops its camera and its finishes, all in `touched`. |
| `set_material` | Paints a finish onto one room (its UUID), one face (`{ room?, wallId, side }`), every floor, every wall or the facade (the words `floors`, `walls`, `facade`). |
| `place_object` | Puts catalogue object `id` down — `asset` is a bare archetype or variant UUID, the optional `library` the UUID of its library (absent: the document's `assetLibrary`, then the built-in bank), written into the placement as given — with an optional variant, room, yaw and finishes; a floor-standing object's `y` is pinned to 0. |
| `move_object` | Moves a placement (`position` or `dposition`) and binds or unbinds it from a room (`room: null`). |
| `rotate_object` | Turns a placement (`rotationY` or `drotation`), normalised into (−π, π]. |
| `set_object` | Sets a placement's `scale` (clamped into `OBJECT_SCALE`), its `material` and its slot `finishes`. |
| `remove_object` | Removes a placement. |
| `mirror_object` | Sets a placement's whole mirror state (`mirror: { x?: true, y?: true, z?: true }`, absolute; `{}` clears it), applied about the body bounds centre. Refused with `detail.reason: 'mirror_not_allowed'` when the asset's catalogue facts do not allow a set axis, or are unknown. |
| `replace_asset_variant` | Swaps a placement's variant for one the registries offer for it. |
| `set_camera` | Sets the presentation camera, the walk spawn or one room's camera; `remove: true` clears the spawn or a room's (never the presentation one). |
| `set_navigation` | Replaces the walk-mode waypoints wholesale. |
| `set_autotour` | Updates the tour's `path`, `gaze`, `zones` and `speed` (clamped into `TOUR_SPEED`); every `at` has to index the effective path. |
| `set_tour_checkpoints` | Replaces the tour cameras wholesale, in tour order (each `{ id, position, yaw, pitch, name? }`, ids from the caller); an empty list falls back to the authored `autotour`. |

The creating operations (`add_node`, `add_wall`, `add_room`, `add_opening`, `place_object`, and `split_wall` with its `nodeId` and two `ids`) take the new entity's UUID v7 from the caller — the viewer mints none, so a replayed journal is byte-identical. A missing or malformed id refuses with `OpError` `detail.reason: 'invalid_id'`, an id the document already carries with `'duplicate_id'`.

Every operation is atomic inside its batch: `applyOp` mutates a draft and answers with a one-line English summary and the entities it touched (`TouchedEntity`), and `SceneModel.apply` throws the whole batch away when any one of them refuses or when the candidate document does not validate.
- **Typed parsing** — `parseSceneOps(input)` and `parseSceneDocument(input)` judge an unknown value against the `zod/mini` schemas and return **the value they were handed**, typed with the hand-written types. A consumer compiling with `exactOptionalPropertyTypes: true` gets `x?: T` optionals and needs no cast; a refusal is a `ViewerLibError('scene-invalid')` whose `path` names the first bad field and whose `detail.issues` carries the list.
- **The revision model** — `SceneModel`, `isApplyOk` (types: `ApplyBatch`, `ApplyOk`, `ApplyFailure`, `ApplyResult`, `AppliedOp`, `LintMode`, `RevisionListener`, `SceneModelOptions`). A batch may ask for the furniture layout to be reviewed before it commits: `lint: 'report'` returns `issues` on the result, `lint: 'strict'` refuses a candidate carrying a hard issue with `error: 'layout_failed'` and leaves the revision alone. The linter is injected — `new SceneModel(document, registries, { lint: lintLayout })` — so a viewer that never lints does not carry it.
- **Validation** — `validateScene`.
- **The registries interface and the shipped catalogues** — types `SceneRegistries`, `CatalogueArchetype`, `CataloguePlacement`, `CatalogueVariantRef`, `LibraryCatalogue`, `LibraryFinish`, `ProjectLibrary`, `AssetRef`, `AssetRefFields`, `OpeningVariantFamily`, `OpeningVariantOption`; the function `assetRefOf(fields, defaultLibrary)`, the one rule a reference is read by (`{ library: fields.library ?? defaultLibrary, assetId: fields.asset ?? fields.type }`, nothing parsed out of a string); the value `CATALOGUE_REGISTRIES`, ready to hand a `SceneModel` without wiring the catalogues by hand, and `registriesFromLibrary(library, base?)`, which builds registries from an object-bank manifest (its objects, their variants, and its materials as finishes). Registries declare every library they can resolve, so a document whose `assetLibrary` names a project's own bank validates against it: `registriesFromLibrary(projectLibrary, CATALOGUE_REGISTRIES)` accepts both. They also answer the two questions an editor asks before it edits: `registries.openingVariantsOf(type, { entrance? })` lists what a variant `<select>` may offer (id and label, no canvas), and `registries.defaultFloorFinish` says what `add_room` writes when the user names no floor — the oak floor's UUID for the shipped bank, a project library's own first floor material otherwise.
- **Scene document types** — `SceneData`, `Vec2`, `Vec3`, `DemoAsset`, `Wall`, `Room`, `Opening`, `PlanNode`, `WallArc`, `WallRole`, `RoomKind`, `OpeningType`, `OpeningShape`, `OpeningHinge`, `OpeningSwing`, `MaterialDefinition`, `CameraPose`, `TourGazeKey`, `TourSpeedZone`, `SchemaVersion`, `LengthUnit`.
- **The plan solver** — `solvePlan` (type `SolvedPlan`).
- **Layout linting** — `lintLayout`, `countIssues`, `describeIssues` (types `LayoutIssue`, `LayoutRule`, `LayoutIssueCounts`, `LayoutLinter`).
- **Interior presets** — `applyPresetBatch`, `findPreset`, `standardPreset`, `presetCoverage`, `presetBatchOps` (types `PresetModel`, `PresetCoverage`).
- **The `zod/mini` shape check** — `sceneSchema`, `sceneOpSchema`, `isSceneShape`, `sceneShapeIssues`, so a caller can shape-check a document before handing it to `validateScene`.
- **The closed sets** — `OPENING_TYPES`, `ROOM_KINDS`, `WALL_ROLES`.
- **Identifiers** — `UUID_V7_PATTERN` and `isUuidV7` (the validator's own check; the entry exports no generator), `faceKey`, `sameFace`, `isFaceKey` (types `FaceKey`, `FaceFinish`, `SetMaterialAlias`, `TopologyRemap`, `TopologyRemapEntry`, and `NewIdRefusal`: the `OpError.detail.reason` a creating op refuses an id with, `invalid_id` or `duplicate_id`), and `CATALOGUE_ID_BY_SLUG` (types `CatalogueIdBySlug`, `CatalogueSlugTable`), the shipped catalogue's readable slug → UUID table.

A name not on this list is not public, whatever module it lives in — the same façade rule every other library entry follows (`src/embed/ops.test.ts` pins the export surface, sorted, against exactly this list). Nothing above renders anything or touches a document: `src/purity.test.ts` and `.dependency-cruiser.cjs` hold `embed/ops.ts` to the same "no `three`, no DOM" invariant as the rest of the pure layer.

## Development

```bash
npm run dev                # demo page on http://localhost:3700/
npm run dev:scroll         # scroll-driven embed example
npm run dev:gallery        # furniture catalogue gallery
bun run test               # unit tests (pure modules, no DOM): bun test src scripts
npm run test:component     # Vitest 5 browser mode in Chromium: shadow root, WebGL, DOM components (tests/component)
npm run test:e2e           # Playwright: whole pages, iframe host, screenshots, axe ratchets (tests/e2e)
bun run check [fast|standard|full]   # the quality gate (scripts/check.sh); full is the default
npm run test:browser       # scripted smoke check of a running dev server (VIEWER_URL), driven by the agent-browser CLI
```

The gate has three nested tiers:

- `fast`: the static steps (both type checks, oxlint, oxfmt, source hygiene, module size, dependency-cruiser layers, knip, the schema check, console and listener policies) plus the unit tests selected by the change. No browser, no build.
- `standard`: everything in `fast` with the whole unit run and its coverage floors, the Vitest browser level with its coverage floors, the demo build and its bundle budget.
- `full`: everything in `standard` plus the Playwright e2e suite, the library build and its per-file budgets, `publint`/`attw`, the site build, `bun audit` and `code-ranker` when it is installed.

Requirements: Node ≥ 22.12 (`.node-version` pins the version used in development), Bun (`.bun-version`), `bunx playwright install chromium` once. CI runs the full tier's steps except `code-ranker` and the screenshot comparisons, which run only locally: `.github/workflows/ci.yml` runs every step that needs no browser on each push and pull request, and the browser levels (component and e2e tests) run in the local gate (`bash scripts/check.sh`) and on demand in the hand-started `.github/workflows/browser.yml`.

Dev pages under `dev/` also include `embed-two.html` (two independent viewers), `embed-element.html` (custom element), `embed-iframe.html` (iframe host) and `embed-tt.html` (a Trusted Types host), all covered by the e2e suite.

Contributing: see `CONTRIBUTING.md`. Security reports: see `SECURITY.md`.
