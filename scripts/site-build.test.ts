import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CATALOGUE_REGISTRIES } from '../src/assets/catalogue-registries.js';
import { apartmentScene } from '../src/demo/scene-data.js';
import { parseSceneDocument } from '../src/scene/scene-parse.js';
import { validateScene } from '../src/scene/scene-validator.js';
import { SCHEMA_HOST, writeSchemas } from './schema-gen.ts';
import {
  DEMO_SCENE_PATH,
  DEMO_THEME_PATH,
  SITE_ORIGIN,
  type SchemaWriter,
  buildSite,
  demoSceneJson,
  isPublished,
  publishSchemas,
  schemaSitePath,
  siteCommit,
  stamp,
} from './site-build.ts';

/** A stand-in for schema-gen: one schema per name, its `$id` under the site. */
function fakeSchemas(names: readonly string[], version = '1.2.3'): SchemaWriter {
  return (dir) => {
    mkdirSync(dir, { recursive: true });
    for (const name of names) {
      const body = { $id: `${SITE_ORIGIN}/schema/${name}/${version}.json`, title: name };
      writeFileSync(join(dir, `${name}.schema.json`), `${JSON.stringify(body)}\n`);
    }
  };
}

describe('siteCommit', () => {
  test('reads SITE_COMMIT and shortens it to seven characters', () => {
    expect(siteCommit({ SITE_COMMIT: '642e6f8' })).toBe('642e6f8');
    expect(siteCommit({ SITE_COMMIT: '642e6f8a1b2c3d4e5f60718293a4b5c6d7e8f901' })).toBe('642e6f8');
  });

  test('answers null when it is unset or empty', () => {
    expect(siteCommit({})).toBeNull();
    expect(siteCommit({ SITE_COMMIT: '  ' })).toBeNull();
  });

  test('refuses a value that is not a lower-case hex sha', () => {
    for (const bad of ['642E6F8', '642e6f', 'main', '20261009-064258-642e6f8']) {
      expect(() => siteCommit({ SITE_COMMIT: bad })).toThrow(/SITE_COMMIT is not a lower-case hex commit sha/);
    }
  });
});

describe('stamp', () => {
  const page = '<footer><span data-viewer-sha>viewer {{VIEWER_SHA}}</span> &copy; 2026</footer>';

  test('replaces every placeholder and keeps the element', () => {
    const twice = `${page}<p data-viewer-sha><a href="c/{{VIEWER_SHA}}">{{VIEWER_SHA}}</a></p>`;
    const out = stamp(twice, '642e6f8');
    expect(out).toContain('<span data-viewer-sha>viewer 642e6f8</span>');
    expect(out).toContain('<a href="c/642e6f8">642e6f8</a>');
    expect(out).not.toContain('{{VIEWER_SHA}}');
  });

  test('without a sha drops every element that carries the attribute', () => {
    const out = stamp(`${page}<p class="x" data-viewer-sha>built from <a href="c/{{VIEWER_SHA}}">{{VIEWER_SHA}}</a></p><p>kept</p>`, null);
    expect(out).toBe('<footer> &copy; 2026</footer><p>kept</p>');
  });

  test('refuses a placeholder outside a stamped element when there is no sha', () => {
    expect(() => stamp('<p>{{VIEWER_SHA}}</p>', null)).toThrow(/outside an element carrying data-viewer-sha/);
  });
});

describe('buildSite', () => {
  let root = '';
  afterEach(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function write(path: string, body: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }

  function tree(withEmbed: boolean): { repo: string; out: string } {
    root = mkdtempSync(join(tmpdir(), 'site-build-'));
    const repo = join(root, 'checkout');
    write(join(repo, 'site', 'index.html'), '<p data-viewer-sha>viewer {{VIEWER_SHA}}</p>');
    write(join(repo, 'site', 'assets', 'site.css'), 'body{}');
    write(join(repo, 'site', 'README.md'), '# notes');
    write(join(repo, 'site', 'assets', 'poster.md'), '# poster notes');
    write(join(repo, 'site', 'llms.txt'), '# JEEX Player');
    write(join(repo, 'site', 'install.md'), '# Install');
    write(join(repo, 'dist', 'index.html'), 'demo index');
    write(join(repo, 'dist', 'assets', 'app.js'), 'js');
    if (withEmbed) write(join(repo, 'dist', 'embed.html'), '<head></head>embed');
    return { repo, out: join(repo, 'site-out') };
  }

  test('copies the site to the root and the demo build under demo/, stamped', () => {
    const { repo, out } = tree(true);
    write(join(out, 'stale.txt'), 'left over');
    buildSite(repo, out, fakeSchemas(['scene', 'viewer-options']), '642e6f8');
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toBe('<p data-viewer-sha>viewer 642e6f8</p>');
    expect(readFileSync(join(out, 'assets', 'site.css'), 'utf8')).toBe('body{}');
    expect(readFileSync(join(out, 'demo', 'index.html'), 'utf8')).toBe('demo index');
    expect(readFileSync(join(out, 'demo', 'embed.html'), 'utf8')).toBe(
      `<head><link rel="stylesheet" href="../${DEMO_THEME_PATH}" /></head>embed`,
    );
    expect(readFileSync(join(out, 'demo', 'assets', 'app.js'), 'utf8')).toBe('js');
    expect(readFileSync(join(out, 'llms.txt'), 'utf8')).toBe('# JEEX Player');
    expect(readFileSync(join(out, 'install.md'), 'utf8')).toBe('# Install');
    expect(existsSync(join(out, 'README.md'))).toBe(false);
    expect(existsSync(join(out, 'assets', 'poster.md'))).toBe(false);
    expect(JSON.parse(readFileSync(join(out, DEMO_SCENE_PATH), 'utf8'))).toEqual(JSON.parse(demoSceneJson()));
    expect(existsSync(join(out, 'stale.txt'))).toBe(false);
    expect(JSON.parse(readFileSync(join(out, 'schema', 'scene.schema.json'), 'utf8')).title).toBe('scene');
    expect(JSON.parse(readFileSync(join(out, 'schema', 'scene', '1.2.3.json'), 'utf8')).title).toBe('scene');
    expect(JSON.parse(readFileSync(join(out, 'schema', 'viewer-options', '1.2.3.json'), 'utf8')).title).toBe('viewer-options');
  });

  test("links the site's warm theme into the demo frame only; the package's own pages stay neutral", () => {
    const { repo, out } = tree(false);
    write(join(repo, 'dist', 'embed.html'), '<html><head><title>e</title></head><body>embed</body></html>');
    buildSite(repo, out, fakeSchemas(['scene']), null);
    const frame = readFileSync(join(out, 'demo', 'embed.html'), 'utf8');
    expect(frame).toContain(`<link rel="stylesheet" href="../${DEMO_THEME_PATH}" /></head>`);
    expect(readFileSync(join(out, 'demo', 'index.html'), 'utf8')).toBe('demo index');
    // The package build itself is never touched.
    expect(readFileSync(join(repo, 'dist', 'embed.html'), 'utf8')).not.toContain(DEMO_THEME_PATH);
  });

  test('the site theme keeps the warm look: the former backdrop pair and accent, on the viewer root, unlayered', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'site', DEMO_THEME_PATH), 'utf8');
    expect(css).toContain('.jeex-viewer');
    expect(css).not.toContain('@layer');
    expect(css).toMatch(/--jeex-backdrop:\s*#c6b8a3/);
    expect(css).toMatch(/--jeex-backdrop-top:\s*#dcd3c2/);
    expect(css).toMatch(/--jeex-accent:/);
  });

  test('fails with a clear message when the demo build is missing', () => {
    const { repo, out } = tree(false);
    expect(() => buildSite(repo, out, fakeSchemas(['scene']), null)).toThrow(/dist\/embed\.html is missing: run `bun run build` first/);
  });
});

describe('isPublished', () => {
  const site = '/r/site';

  test('publishes pages, assets, llms.txt and install.md', () => {
    for (const name of ['index.html', 'assets/site.css', 'llms.txt', 'install.md']) {
      expect(isPublished(site, join(site, name))).toBe(true);
    }
  });

  test('keeps the folder notes and the poster record out', () => {
    expect(isPublished(site, join(site, 'README.md'))).toBe(false);
    expect(isPublished(site, join(site, 'assets', 'poster.md'))).toBe(false);
    expect(isPublished(site, join(site, 'notes.md'))).toBe(false);
  });
});

describe('demoSceneJson', () => {
  test('is the demo apartment, unchanged by the trip through JSON', () => {
    expect(JSON.parse(demoSceneJson())).toEqual(JSON.parse(JSON.stringify(apartmentScene)));
    expect(JSON.parse(demoSceneJson())).toEqual(apartmentScene as unknown as Record<string, unknown>);
  });

  test("passes the viewer's own schema and validator, as a fetched document would", () => {
    const fetched: unknown = JSON.parse(demoSceneJson());
    const parsed = parseSceneDocument(fetched);
    expect(validateScene(parsed, CATALOGUE_REGISTRIES)).toBe(parsed);
  });
});

describe('schemaSitePath', () => {
  test('maps a schema $id under the site to the path that serves it', () => {
    expect(schemaSitePath('https://player.jeex.org/schema/scene/2.1.0.json')).toBe('schema/scene/2.1.0.json');
    expect(schemaSitePath('https://player.jeex.org/schema/viewer-options/0.1.0-rc.1.json')).toBe('schema/viewer-options/0.1.0-rc.1.json');
  });

  test('refuses an $id the site could not serve', () => {
    for (const id of [
      'https://example.com/schema/scene/1.0.0.json',
      'https://player.jeex.org/demo/scene/1.0.0.json',
      'https://player.jeex.org/schema/scene/1.0.0',
      'https://player.jeex.org/schema/../index.json',
      'https://player.jeex.org/schema/scene/../../x.json',
    ]) {
      expect(() => schemaSitePath(id)).toThrow(/is not a \.json file under/);
    }
  });
});

describe('publishSchemas', () => {
  let out = '';
  afterEach(() => {
    if (out !== '') rmSync(out, { recursive: true, force: true });
    out = '';
  });

  test('fails when the writer produced no schema', () => {
    out = mkdtempSync(join(tmpdir(), 'site-schemas-'));
    expect(() => publishSchemas(out, (dir) => mkdirSync(dir, { recursive: true }))).toThrow(/wrote no \*\.schema\.json/);
  });

  test.each([
    ['no $id', {}],
    ['a numeric $id', { $id: 7 }],
    ['an empty $id', { $id: '' }],
  ])('fails on a schema file with %s', (_name, body) => {
    out = mkdtempSync(join(tmpdir(), 'site-schemas-'));
    const write = (dir: string): void => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'scene.schema.json'), JSON.stringify(body));
    };
    expect(() => publishSchemas(out, write)).toThrow('site-build: scene.schema.json has no $id');
  });

  test("schema-gen's host is the site's schema folder", () => {
    expect(SCHEMA_HOST).toBe(`${SITE_ORIGIN}/schema`);
  });

  test('serves the real generated schemas at the URL each $id names', () => {
    out = mkdtempSync(join(tmpdir(), 'site-schemas-'));
    const paths = publishSchemas(out, (dir) => void writeSchemas(dir, '9.9.9'));
    expect(paths).toEqual(['schema/scene/9.9.9.json', 'schema/telemetry/1.0.0.json', 'schema/viewer-options/9.9.9.json']);
    for (const path of paths) {
      const schema = JSON.parse(readFileSync(join(out, path), 'utf8')) as { $id: string };
      expect(`${SITE_ORIGIN}/${path}`).toBe(schema.$id);
    }
  });
});
