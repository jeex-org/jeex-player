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
  index.md, integration.md, ...           the Markdown twin of every page, generated
  llms.txt, install.md                    the llmstxt.org index and the instruction it links to
  robots.txt                              crawler rules and the content signal
  demo/                                   the demo build (dist/)
  demo/demo-apartment.json                the demo apartment (src/demo/scene-data.ts) as a scene document
  schema/*.schema.json                    the JSON Schemas (scripts/schema-gen.ts), as in dist-lib/schema/
  schema/<name>/<version>.json            the same schemas at the URL their $id names
```

Every snippet on the site loads `demo/demo-apartment.json`. Markdown in this folder documents the site and is not published, except `install.md`, the step-by-step instruction for an AI agent that `llms.txt` links to. Both are hand-written from the README.

For AI agents and AI search, each page also has a Markdown twin beside it (`integration.html` → `integration.md`, `index.html` → `index.md`), which `scripts/site-markdown.ts` renders from the page's `<main>` at build time, and the page announces it with `<link rel="alternate" type="text/markdown">`. The twins are never edited by hand: change the page. The converter knows only the elements the pages use and fails the build on anything else, so a new kind of element is added to it with a test. `llms.txt` links the pages through their twins. `robots.txt` admits the OpenAI crawlers by name and carries `Content-Signal: search=yes, ai-input=yes, ai-train=yes` for everyone. The home page's JSON-LD (`WebSite`, `SoftwareSourceCode`) says only what the page shows, and a test holds every value of it to the visible text.

A server that hosts the site should send `demo/demo-apartment.json` with `Access-Control-Allow-Origin: *` (and `schema/` too, for editors that fetch a document's `$schema`), so that pages on other origins can load it, and serve `llms.txt` as `text/plain` or `text/markdown` and every `.md` file as `text/markdown; charset=utf-8`.

Elements carrying `data-viewer-sha` show the player commit a deployed build was made from; `{{VIEWER_SHA}}` is their placeholder. The commit comes from `SITE_COMMIT` (`SITE_COMMIT=<sha> bun run build:site`); a build without it leaves those elements out.

## Local preview

Serve `site-out/` with any static file server, for example:

```bash
python3 -m http.server 8000 --bind 127.0.0.1 -d site-out
```

and open <http://127.0.0.1:8000/>. The port is arbitrary. `http.server` sends no CORS header, so checking the demo scene from another origin needs a server that adds one.

## Poster

`assets/poster.webp` and `assets/og.png` are renders of the demo apartment made by `scripts/site-poster.ts`; `assets/poster.md` records the settings, the commands and the date. Re-render them when the demo scene or its start view changes.
