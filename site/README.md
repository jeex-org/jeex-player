# site/: the player's website

The player's own website: hand-written static pages, `index.html` (the product page) and `integration.html` (the route to a first embed), with one stylesheet and one script in `assets/`. No framework, no dependencies, no build step for the pages themselves.

Every fact on the pages comes from the player's `README.md`, `package.json`, `CHANGELOG.md` or `vite.css-target.ts`. The pages are English only and carry nothing commercial.

## Build

```bash
bun run build:site
```

runs `bun run build` (the demo, `dist/`) and then `scripts/site-build.ts`, which writes `site-out/` (git-ignored):

```
site-out/
  index.html, integration.html, assets/   these pages
  llms.txt, install.md                    the llmstxt.org index and the instruction it links to
  demo/                                   the demo build (dist/)
  demo/demo-apartment.json                the demo apartment (src/demo/scene-data.ts) as a scene document
  schema/*.schema.json                    the JSON Schemas (scripts/schema-gen.ts), as in dist-lib/schema/
  schema/<name>/<version>.json            the same schemas at the URL their $id names
```

Every snippet on the site loads `demo/demo-apartment.json`. Markdown in this folder documents the site and is not published, except `install.md`, the step-by-step instruction for an AI agent that `llms.txt` links to. Both are hand-written from the README.

A server that hosts the site should send `demo/demo-apartment.json` with `Access-Control-Allow-Origin: *` (and `schema/` too, for editors that fetch a document's `$schema`), so that pages on other origins can load it, and serve `llms.txt` and `install.md` as `text/plain` or `text/markdown`.

Elements carrying `data-viewer-sha` show the player commit a deployed build was made from; `{{VIEWER_SHA}}` is their placeholder. The commit comes from `SITE_COMMIT` (`SITE_COMMIT=<sha> bun run build:site`); a build without it leaves those elements out.

## Local preview

Serve `site-out/` with any static file server, for example:

```bash
python3 -m http.server 8000 --bind 127.0.0.1 -d site-out
```

and open <http://127.0.0.1:8000/>. The port is arbitrary. `http.server` sends no CORS header, so checking the demo scene from another origin needs a server that adds one.

## Poster

`assets/poster.webp` and `assets/og.png` are renders of the demo apartment made by `scripts/site-poster.ts`; `assets/poster.md` records the settings, the commands and the date. Re-render them when the demo scene or its start view changes.
