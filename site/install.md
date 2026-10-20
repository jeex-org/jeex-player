# Install the JEEX Player on a website

This is the instruction an AI agent follows to put the JEEX Player (open source, Apache-2.0; the player's repository is jeex-player; the package and the element are named jeex-viewer) on a person's website. Work through the steps in order. Every fact here comes from the player's README; the README sections linked at each step hold the full reference.

## Before you start: the limits

- **From source only.** The README documents no registry package and no hosted copy of the files. You build the player from source and the website serves its own copy. Do not run `npm install jeex-viewer` and do not link scripts from another site.
- **The scene is the person's own.** The player does not create scenes: it validates, renders and plays a scene document or a baked project folder. The person makes their own apartment's scene. The demo scene `https://player.jeex.org/demo/demo-apartment.json` is the player's own demo apartment, there for trying the player out; use it to prove the embed works, then tell the person it is not their property and ask them for their scene's URL.
- **Ask before you publish.** Building and copying files into the site's source tree is local work. Deploying the site, or uploading files to a server, is the person's decision.

## Step 1. Build from source

Requirements: Node 22.12 or newer and Bun (README: [Install and build](https://github.com/jeex-org/jeex-player/blob/main/README.md#install-and-build)). In a directory outside the website's source tree:

```bash
git clone https://github.com/jeex-org/jeex-player
cd jeex-player
bun install --frozen-lockfile
bun run build:lib
```

The build writes `dist-lib/`: `jeex-viewer.js` (ES module), `jeex-viewer.iife.js` (classic script), `jeex-viewer-element.js` (registers `<jeex-viewer>`), `jeex-viewer-host.js` and `jeex-viewer-host.iife.js` (the iframe helper), `jeex-viewer.css`, the type declarations, `embed.html` with `jeex-viewer-frame.js` (the public frame page), `schema/` and the hashed shared chunks the ES entries import. It ends with a check of the shipped stylesheet; a failed check fails the build.

## Step 2. Copy the whole `dist-lib/` to the site

Copy the complete `dist-lib/` directory into the website so that it is served from the site's own origin, for example at `/jeex-viewer/`. Copy all of it, never a single file: the ES entries import hashed sibling chunks, and every URL inside the directory is relative (README: [Paste into any site](https://github.com/jeex-org/jeex-player/blob/main/README.md#paste-into-any-site)).

In the rest of this file, `/jeex-viewer/` stands for wherever you put it. Use the path you chose.

## Step 3. Choose an embed path

All three paths take the same option names and raise the same events. Pick one; for a CMS, prefer the first two, which are plain HTML.

### Custom element, ES module

Modern browsers, the lightest download. Plain HTML: no inline script, no stylesheet, nothing a CMS block has to allow beyond the tags.

```html
<!-- /jeex-viewer/ is the site's copy of dist-lib/ -->
<script type="module" src="/jeex-viewer/jeex-viewer-element.js"></script>
<!-- the demo apartment, for trying the player; the person's own scene goes here -->
<jeex-viewer src="https://player.jeex.org/demo/demo-apartment.json" lang="en"></jeex-viewer>
```

### Custom element, classic script

For a CMS that strips `type="module"`: `jeex-viewer.iife.js` registers the same `<jeex-viewer>` on load. Registration is idempotent, so a page that loads both bundles gets one element.

```html
<script src="/jeex-viewer/jeex-viewer.iife.js" defer></script>
<jeex-viewer src="https://player.jeex.org/demo/demo-apartment.json" lang="en"></jeex-viewer>
```

### ES module, `mountViewer`

For a page that has its own script and wants the handle API. The container must have a height; the viewer fills it.

```html
<div id="apartment" style="height: 480px"></div>
<script type="module">
  // /jeex-viewer/ is the site's copy of dist-lib/
  import { mountViewer } from '/jeex-viewer/jeex-viewer.js';

  const viewer = mountViewer(document.getElementById('apartment'), {
    // the demo apartment, for trying the player; the person's own scene goes here
    scene: { url: 'https://player.jeex.org/demo/demo-apartment.json' },
    readonly: true,
  });
  await viewer.ready;
</script>
```

`mountViewer` is the authoring API: unlike the element and the frame it is not read-only by default, so pass `readonly: true` for a page visitors see (README: [Options](https://github.com/jeex-org/jeex-player/blob/main/README.md#options)).

### iframe

For a page that allows an iframe but no script of yours. `dist-lib/embed.html` ships no scene and takes one in `?scene=` (URL-encoded).

```html
<iframe src="/jeex-viewer/embed.html?scene=https%3A%2F%2Fplayer.jeex.org%2Fdemo%2Fdemo-apartment.json&lang=en"
  title="Apartment tour" loading="lazy" allow="fullscreen"
  style="display:block;width:100%;aspect-ratio:16/9;border:0"></iframe>
```

Keep `allow="fullscreen"` (without it the viewer's fullscreen button reports that fullscreen is unavailable) and a `title` in the page's language. For isolation, the README recommends serving `embed.html` from an origin of its own rather than a path on the host; then write that origin in place of `/jeex-viewer/`. To drive the frame from the page (play, seek, modes, events), let the helper `embedViewer` from `jeex-viewer-host.js` create it (README: [iframe with postMessage](https://github.com/jeex-org/jeex-player/blob/main/README.md#3-iframe-with-postmessage)).

## Step 4. Supply a scene

Replace the demo URL with the person's own scene once they give it to you. The player loads a scene document (schema 2.2; older documents are refused) or a baked project folder whose root is a `project.json` (README: [Scene sources](https://github.com/jeex-org/jeex-player/blob/main/README.md#scene-sources), [Scene document](https://github.com/jeex-org/jeex-player/blob/main/README.md#scene-document), [Project format](https://github.com/jeex-org/jeex-player/blob/main/README.md#project-format)). The URL must hold to these rules:

- It is fetched **without credentials**. A scene on another origin than the page needs CORS (`Access-Control-Allow-Origin`) from that origin.
- The response `Content-Type` includes `application/json`.
- No redirect (`redirect: 'error'`), an answer within 15 seconds, at most 8 MB for a scene (a `project.json` at most 1 MB).
- Every id in the document is a UUID v7; the viewer validates ids and never mints one.

A JSON Schema generated from the same type is in `dist-lib/schema/scene.schema.json`. A document the validator refuses fails with the code `scene-invalid` and a message that names the failing rule. Do not invent or hand-write a scene for the person.

## Step 5. Size it, and handle CSP

Size (README: [Paste into any site](https://github.com/jeex-org/jeex-player/blob/main/README.md#paste-into-any-site), [Sizing and styling](https://github.com/jeex-org/jeex-player/blob/main/README.md#sizing-and-styling)):

- A bare `<jeex-viewer>` is a block at its parent's full width and 16:9 of it. `ratio="4:3"` (or `1`, `2.39:1`) changes the default; any `width`, `height` or `aspect-ratio` the page sets on the element wins.
- The iframe's box is its inline `aspect-ratio`; `embed.html` fills whatever box its frame has.
- With `mountViewer` the container needs a height: `100%` of an unsized parent is zero.

Content Security Policy (README: [Content Security Policy](https://github.com/jeex-org/jeex-player/blob/main/README.md#content-security-policy)). The viewer runs under a strict policy with no `unsafe-inline`:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'
```

- `connect-src` must also cover wherever the scene is fetched from (for the demo: `https://player.jeex.org`).
- `img-src data:` is required: the viewer renders swatches as `data:` URLs.
- The iframe path needs `frame-src` for the origin that serves `embed.html`; that origin should send `Content-Security-Policy: frame-ancestors <the sites allowed to frame it>` as a response header (README: [iframe permissions and origin](https://github.com/jeex-org/jeex-player/blob/main/README.md#iframe-permissions-and-origin)).

Under such a policy an inline `<script>` and a `style` attribute are blocked: put the `mountViewer` script in a file the site serves, and move the snippets' `style` attributes (the container's height, the iframe's box) into the site's stylesheet. The custom element paths need neither.

If the site has a CSP, add only what is missing; do not loosen it with `unsafe-inline`.

## Step 6. Verify the result

Open the page in a browser and check:

1. The apartment is drawn in the player's box, the control bar shows its mode switcher, and switching between the views works.
2. The browser console shows no error from the player, and the network panel shows the scene JSON answered `200` with `application/json`, and every file under `/jeex-viewer/` answered `200` (a `404` on a hashed chunk means `dist-lib/` was not copied whole).
3. For the custom element, the element reaches its ready state: `document.querySelector('jeex-viewer').matches(':state(ready)')` is `true`, or the element fired `jeex-ready`. A `jeex-error` event carries a `code`: `no-scene-source` (no `src`, or no `?scene=` on `embed.html`), `scene-load` (fetch failed: check CORS, the `Content-Type`, the size and redirects; the error names the status and the URL), `scene-invalid` (the document broke a rule; the message names it), `webgl-unavailable` (no WebGL in that browser) (README: [Events](https://github.com/jeex-org/jeex-player/blob/main/README.md#events), [Errors](https://github.com/jeex-org/jeex-player/blob/main/README.md#errors)).
4. The page has no new CSP violation reports in the console.
5. At a phone width the player still fits its column and the page does not scroll sideways.

When it works with the demo apartment, tell the person that the demo is only for trying the player, and swap in their own scene's URL (Step 4) before the page goes live.
