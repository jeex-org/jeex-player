/**
 * Assembly of the player site (`player.jeex.org`).
 *
 * Runs after `bun run build` (`bun run build:site` does both) and writes one
 * output tree, `site-out/`: the hand-written pages of `site/` at its root and
 * the complete demo build `dist/` under `demo/`, never flattened over the
 * site's own `index.html`. Markdown under `site/` documents the folder and is
 * not published, except the agent instruction `install.md`
 * (`PUBLISHED_MARKDOWN`); `llms.txt` is copied like any other file.
 *
 * Beside the demo build it writes `demo/demo-apartment.json`: the viewer's own
 * demo apartment (`src/demo/scene-data.ts`) as a scene document, the URL every
 * snippet on the site loads so a reader can try the player before they have a
 * scene of their own. The production CORS header for it comes from the server.
 *
 * Under `schema/` it publishes the JSON Schemas `scripts/schema-gen.ts`
 * generates: `schema/<name>.schema.json` (the layout of `dist-lib/schema/`)
 * and a copy at the path each schema's `$id` names
 * (`https://player.jeex.org/schema/scene/<version>.json` is served from
 * `schema/scene/<version>.json`), so the `$id` and a document's `$schema`
 * resolve. Generation is local: no network.
 *
 * The pages carry the viewer commit they were built from, taken from the
 * `SITE_COMMIT` environment variable (`siteCommit`): a 7- to 40-character
 * lower-case hex sha, shortened to seven. Without it (a local build) there is
 * none, and `stamp` drops every element that would have shown it instead of
 * failing the build.
 *
 * `node:fs` and `node:child_process` only: the site has no build dependencies
 * of its own.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { apartmentScene } from '../src/demo/scene-data.js';

/** Where the demo apartment's scene document lands, relative to the output root. */
export const DEMO_SCENE_PATH = 'demo/demo-apartment.json';

/**
 * The site's own theme for the viewer in its demo frame, relative to the site
 * root. The package's defaults are a neutral graphite; the player site keeps
 * its warm look by setting the theme properties itself, in the one page that
 * frame loads, and nowhere in the package build.
 */
export const DEMO_THEME_PATH = 'assets/demo-theme.css';

/** The origin the site is served from; every published schema's `$id` lives under it. */
export const SITE_ORIGIN = 'https://player.jeex.org';

/** Where the generated schemas land, relative to the output root. */
export const SCHEMA_DIR = 'schema';

/** Writes the generated `<name>.schema.json` files into the directory it is given. */
export type SchemaWriter = (dir: string) => void;

/**
 * The Markdown files the site serves, relative to `site/`. Every other `.md`
 * there (`README.md`, `assets/poster.md`) documents the folder and stays out,
 * so a new note never ships by accident.
 */
const PUBLISHED_MARKDOWN = new Set(['install.md']);

/** The placeholder a page writes where the viewer's short sha goes. */
const SHA_PLACEHOLDER = '{{VIEWER_SHA}}';

/** What `SITE_COMMIT` may hold: a short or full lower-case hex commit sha. */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/;

/**
 * An element carrying `data-viewer-sha`, through its closing tag. Stamped
 * elements are leaf-like by convention (a `span`, a `p` with inline children):
 * the lazy body stops at the first closing tag of the same name, so the
 * element must not nest another of its own kind.
 */
const STAMPED_ELEMENT = /<([a-z][a-z0-9-]*)\b[^>]*\sdata-viewer-sha\b[^>]*>[\s\S]*?<\/\1>/g;

/**
 * The short sha the pages are stamped with: `SITE_COMMIT` cut to seven
 * characters, or `null` when it is unset or empty. A value that is not a hex
 * sha is an error, never a silently missing stamp.
 */
export function siteCommit(environment: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const raw = (environment['SITE_COMMIT'] ?? '').trim();
  if (raw === '') return null;
  if (!COMMIT_SHA.test(raw)) throw new Error(`site-build: SITE_COMMIT is not a lower-case hex commit sha: ${JSON.stringify(raw)}`);
  return raw.slice(0, 7);
}

/**
 * `html` with every `{{VIEWER_SHA}}` replaced by `sha`; with `sha === null`,
 * every element carrying `data-viewer-sha` removed. A placeholder left outside
 * such an element would publish the raw braces, so that is an error.
 */
export function stamp(html: string, sha: string | null): string {
  if (sha !== null) return html.replaceAll(SHA_PLACEHOLDER, sha);
  const stripped = html.replaceAll(STAMPED_ELEMENT, '');
  if (stripped.includes(SHA_PLACEHOLDER)) {
    throw new Error(`site-build: ${SHA_PLACEHOLDER} found outside an element carrying data-viewer-sha`);
  }
  return stripped;
}

/** Whether `source` (a path under `site`) is copied to the output: everything but unlisted Markdown. */
export function isPublished(site: string, source: string): boolean {
  if (!source.endsWith('.md')) return true;
  return PUBLISHED_MARKDOWN.has(relative(site, source).split(sep).join('/'));
}

/** The demo apartment as a scene document, the text `DEMO_SCENE_PATH` holds. */
export function demoSceneJson(): string {
  return `${JSON.stringify(apartmentScene, null, 2)}\n`;
}

/**
 * The path under the output root that serves the schema `id`
 * (`https://player.jeex.org/schema/scene/1.0.0.json` → `schema/scene/1.0.0.json`).
 * An `$id` on another host, outside `schema/`, or not a `.json` file is an
 * error: the site could not serve it.
 */
export function schemaSitePath(id: string): string {
  const prefix = `${SITE_ORIGIN}/${SCHEMA_DIR}/`;
  const rest = id.startsWith(prefix) ? id.slice(prefix.length) : '';
  if (!/^[a-z0-9-]+(\/[A-Za-z0-9.+-]+)*\.json$/.test(rest) || rest.split('/').includes('..')) {
    throw new Error(`site-build: schema $id ${JSON.stringify(id)} is not a .json file under ${prefix}`);
  }
  return `${SCHEMA_DIR}/${rest}`;
}

/** Runs `scripts/schema-gen.ts --out <dir>` in the checkout `root`, as `build:lib` does. */
export function schemaGenIn(root: string): SchemaWriter {
  return (dir) => {
    const run = spawnSync(process.execPath, ['run', 'scripts/schema-gen.ts', '--out', dir], { cwd: root, stdio: 'inherit' });
    if (run.status !== 0) throw new Error(`site-build: schema-gen failed (exit ${run.status ?? run.signal ?? 'unknown'})`);
  };
}

/** A generated JSON Schema file, as far as publishing it reads it: its `$id`. */
const schemaFileSchema = z.object({ $id: z.string().min(1) });

/**
 * Writes the schemas into `out/schema/` with `write`, then copies each one to
 * the path its `$id` names. Returns those paths, relative to `out`.
 */
export function publishSchemas(out: string, write: SchemaWriter): readonly string[] {
  const dir = join(out, SCHEMA_DIR);
  write(dir);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.schema.json'))
    .sort();
  if (files.length === 0) throw new Error(`site-build: schema-gen wrote no *.schema.json into ${dir}`);
  return files.map((name) => {
    const text = readFileSync(join(dir, name), 'utf8');
    const schema = schemaFileSchema.safeParse(JSON.parse(text));
    if (!schema.success) throw new Error(`site-build: ${name} has no $id`);
    const path = schemaSitePath(schema.data.$id);
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), text);
    return path;
  });
}

/** Links the site's theme into the copied demo frame page (`DEMO_THEME_PATH`), just before `</head>`. */
function linkDemoTheme(page: string): void {
  const html = readFileSync(page, 'utf8');
  if (!html.includes('</head>')) throw new Error(`site-build: ${page} has no </head> to link the demo theme into`);
  writeFileSync(page, html.replace('</head>', `<link rel="stylesheet" href="../${DEMO_THEME_PATH}" /></head>`));
}

/** Every `.html` file under `dir`, recursively, as absolute paths. */
function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.html'))
    .map((name) => join(dir, name));
}

/**
 * Writes the site of the checkout `root` into `out`: `root/site/**` (minus the
 * folder notes, `isPublished`) at the top, `root/dist/**` under `out/demo/`
 * with the demo scene beside it, every page of the site stamped with `sha`
 * (`siteCommit()` by default), and the schemas under `out/schema/`
 * (`publishSchemas`).
 * `out` is emptied first.
 */
export function buildSite(
  root: string,
  out: string,
  writeSchemas: SchemaWriter = schemaGenIn(root),
  sha: string | null = siteCommit(),
): void {
  const site = join(root, 'site');
  const dist = join(root, 'dist');
  if (!existsSync(join(site, 'index.html'))) throw new Error(`site-build: ${join(site, 'index.html')} is missing`);
  if (!existsSync(join(dist, 'embed.html'))) {
    throw new Error(`site-build: dist/embed.html is missing: run \`bun run build\` first (looked in ${dist})`);
  }

  rmSync(out, { recursive: true, force: true });
  cpSync(site, out, { recursive: true, filter: (source) => isPublished(site, source) });
  for (const page of htmlFiles(out)) writeFileSync(page, stamp(readFileSync(page, 'utf8'), sha));
  cpSync(dist, join(out, 'demo'), { recursive: true });
  linkDemoTheme(join(out, 'demo', 'embed.html'));
  writeFileSync(join(out, DEMO_SCENE_PATH), demoSceneJson());
  publishSchemas(out, writeSchemas);
}

if (import.meta.main) {
  const root = process.cwd();
  const out = join(root, 'site-out');
  const sha = siteCommit();
  buildSite(root, out, schemaGenIn(root), sha);
  console.log(`site-build: wrote ${out} (${sha === null ? 'no SITE_COMMIT, stamp left out' : `viewer ${sha}`})`);
}
