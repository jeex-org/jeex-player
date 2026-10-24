/**
 * The authoring script that refreshes `finish-maps/` from pinned library
 * versions, against a stub store: what it fetches, what it checks, what it
 * refuses, and what it writes.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildIndex, renderSources, renderTable, writeFolder, type StoreClient } from './finish-maps-fetch.js';
import { finishMapsIndexSchema, type FinishMapsIndex } from './finish-maps-index.schema.js';

const OAK = '01a12fdf-158e-7748-adfe-d397dde469ba';
const SAND = '01a12fdf-1597-7e0c-8b3e-f091fb6af634';
const STRIPES = '01a12fdf-159c-78e6-97c2-8b635635ce85';
const TERRAZZO = '01a12fdf-1593-72d2-a5f9-a56d9c522980';
const CEILING = '01a12fdf-15aa-7d0e-97e3-bb2102d2e0bb';
const PLANK_VARIANT = '01a16d1f-9f8e-70d4-9a46-57fd0246c272';
const PLANK_VERSION = '01a16d1f-9f8e-70d4-9a46-57febe3c2191';
const PLASTER_VARIANT = '01a1689e-3512-757a-8276-36198fb4d666';
const PLASTER_VERSION = '01a1689e-c2d9-7246-a313-fcd4f0df5a93';
const NEWER_VERSION = '01a1689e-c2d9-7246-a313-fcd4f0df5a94';

const source = (name: string) => ({
  provider: 'ambientcg',
  sourceName: name,
  sourcePage: `https://ambientcg.com/a/${name}`,
  licence: 'CC0-1.0',
});

const plankFacts = {
  version: PLANK_VERSION,
  name: 'Wood Floor 056',
  tileM: [3.2, 3.2],
  grain: 'along_u',
  suitability: 'plank_floor',
  normalStrength: 1,
  colourMode: 'natural',
  averageColour: '#83654c',
  pbr: {},
  maps: ['albedo', 'normal', 'arm'],
  source: source('WoodFloor056'),
};

const plasterFacts = (version = PLASTER_VERSION) => ({
  version,
  name: 'Beige Wall 001',
  tileM: [3, 3],
  grain: 'none',
  suitability: 'continuous',
  normalStrength: 1,
  colourMode: 'tintable',
  tint: { recipe: 'luma-mid@1', suggestedColours: [{ name: 'natural', hex: '#9a8d7a' }] },
  averageColour: '#808080',
  pbr: {},
  maps: ['albedoTint', 'normal', 'arm'],
  source: source('BeigeWall001'),
});

function mapping(plasterVersion = PLASTER_VERSION): unknown {
  return {
    version: 1,
    rows: [
      { finish: OAK, slug: 'oak', material: PLANK_VARIANT, reason: 'r', facts: plankFacts },
      { finish: SAND, slug: 'sand', material: PLASTER_VARIANT, colour: '#b0a294', reason: 'r', facts: plasterFacts(plasterVersion) },
      { finish: STRIPES, slug: 'stripes_cream', keep: true },
      { finish: TERRAZZO, slug: 'terrazzo', pending: { needsDerive: true }, colour: '#a7b5a6' },
    ],
    playerDefaults: [
      {
        surface: 'ceiling',
        finish: CEILING,
        slug: 'plaster_white',
        material: PLASTER_VARIANT,
        colour: '#eee9df',
        reason: 'r',
        facts: plasterFacts(plasterVersion),
      },
    ],
  };
}

/** A WebP header, the declared size, then `fill` repeated: distinct bytes per role and size. */
function webp(fill: string): Uint8Array {
  const body = new TextEncoder().encode(`RIFF\0\0\0\0WEBPVP8 ${fill}`);
  return body;
}

type Call = { url: string; auth: string | null };

/** A store answering every role at every size, recording what was asked. */
function stubStore(overrides: { body?: (role: string, px: number) => Uint8Array; width?: (px: number) => number } = {}) {
  const calls: Call[] = [];
  const client: StoreClient = {
    async mapUrl(versionId, role, px) {
      calls.push({ url: `map:${versionId}/${role}/${px}`, auth: null });
      const width = overrides.width?.(px) ?? px;
      return {
        url: `https://signed.example/${versionId}/${role}/${px}?sig=x`,
        width,
        height: width,
        codec: 'webp',
        colourSpace: role.startsWith('albedo') ? 'srgb' : 'linear',
      };
    },
    async download(url) {
      calls.push({ url, auth: null });
      const match = /\/([0-9a-f-]{36})\/(\w+)\/(\d+)\?/.exec(url)!;
      return overrides.body?.(match[2]!, Number(match[3])) ?? webp(`${match[1]}-${match[2]}-${match[3]}`);
    },
  };
  return { client, calls };
}

const temp: string[] = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'finish-maps-'));
  temp.push(dir);
  return dir;
}

describe('buildIndex', () => {
  test('binds bound rows, keeps kept and pending rows, and fetches every role at 256, 512 and 768 once per version', async () => {
    const { client, calls } = stubStore();
    const { index, files } = await buildIndex(mapping(), client, null, false);
    expect(finishMapsIndexSchema.safeParse(index).success).toBe(true);
    expect(index.finishes).toEqual([
      { finish: OAK, slug: 'oak', variant: PLANK_VARIANT, version: PLANK_VERSION },
      { finish: SAND, slug: 'sand', variant: PLASTER_VARIANT, version: PLASTER_VERSION, colour: '#b0a294' },
      { finish: STRIPES, slug: 'stripes_cream', kept: true, why: 'keep' },
      { finish: TERRAZZO, slug: 'terrazzo', kept: true, why: 'pending' },
    ]);
    expect(index.defaults.ceiling).toEqual({
      finish: CEILING,
      slug: 'plaster_white',
      variant: PLASTER_VARIANT,
      version: PLASTER_VERSION,
      colour: '#eee9df',
    });
    expect(index.versions.map((version) => version.version)).toEqual([PLANK_VERSION, PLASTER_VERSION]);
    // Two versions × three roles × three sizes, each asked for once.
    expect(calls.filter((call) => call.url.startsWith('map:'))).toHaveLength(18);
    expect(files.size).toBe(18);
    const tint = index.versions[1]!;
    expect(Object.keys(tint.maps)).toEqual(['albedoTint', 'normal', 'arm']);
    expect(tint.maps.albedoTint?.colourSpace).toBe('srgb');
    expect(tint.maps.normal?.convention).toBe('opengl');
    expect(tint.maps.arm?.files['768'].path).toBe(`tex/${PLASTER_VERSION}/arm.768.webp`);
    expect(tint.maps.arm?.files['768'].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('drops a role the store projection never ships beside ARM, and normal when its strength is 0', async () => {
    const { client } = stubStore();
    const facts = { ...plankFacts, normalStrength: 0, maps: ['albedo', 'normal', 'roughness', 'ao', 'arm'] };
    const doc = mapping() as { rows: { facts?: unknown }[] };
    doc.rows[0]!.facts = facts;
    const { index } = await buildIndex(doc, client, null, false);
    expect(Object.keys(index.versions[0]!.maps)).toEqual(['albedo', 'arm']);
    expect(index.versions[0]!.facts.normalStrength).toBeUndefined();
  });

  test('refuses a body that is not WebP', async () => {
    const { client } = stubStore({ body: () => new TextEncoder().encode('<html>expired</html>') });
    await expect(buildIndex(mapping(), client, null, false)).rejects.toThrow(/not a WebP/);
  });

  test('refuses a rendition whose size is not the one asked for', async () => {
    const { client } = stubStore({ width: (px) => (px === 768 ? 1024 : px) });
    await expect(buildIndex(mapping(), client, null, false)).rejects.toThrow(/768/);
  });

  test('refuses different bytes under a path the previous index recorded', async () => {
    const first = await buildIndex(mapping(), stubStore().client, null, false);
    const { client } = stubStore({ body: (role, px) => webp(`changed-${role}-${px}`) });
    await expect(buildIndex(mapping(), client, first.index, false)).rejects.toThrow(/different bytes/);
  });

  test('a new version for a finish needs the update flag', async () => {
    const first = await buildIndex(mapping(), stubStore().client, null, false);
    await expect(buildIndex(mapping(NEWER_VERSION), stubStore().client, first.index, false)).rejects.toThrow(
      new RegExp(`${PLASTER_VERSION} -> ${NEWER_VERSION}`),
    );
    const updated = await buildIndex(mapping(NEWER_VERSION), stubStore().client, first.index, true);
    expect(updated.index.finishes[1]).toMatchObject({ version: NEWER_VERSION });
  });

  test('refuses a bound row without facts and a mapping it cannot read', async () => {
    const doc = mapping() as { rows: { facts?: unknown }[] };
    delete doc.rows[0]!.facts;
    await expect(buildIndex(doc, stubStore().client, null, false)).rejects.toThrow(/mapping/);
  });
});

describe('writeFolder', () => {
  test('writes the files, the index, the sources and the table, and drops folders of versions no longer listed', async () => {
    const dir = tempDir();
    const tableFile = join(dir, 'table.ts');
    mkdirSync(join(dir, 'maps', 'tex', '01a1689e-0000-7000-8000-000000000000'), { recursive: true });
    writeFileSync(join(dir, 'maps', 'tex', '01a1689e-0000-7000-8000-000000000000', 'arm.256.webp'), 'stale');
    const built = await buildIndex(mapping(), stubStore().client, null, false);
    writeFolder(join(dir, 'maps'), tableFile, built.index, built.files);
    expect(readdirSync(join(dir, 'maps', 'tex')).sort()).toEqual([PLANK_VERSION, PLASTER_VERSION].sort());
    const written = JSON.parse(readFileSync(join(dir, 'maps', 'index.json'), 'utf8')) as FinishMapsIndex;
    expect(written).toEqual(built.index);
    expect(readFileSync(join(dir, 'maps', 'SOURCES.md'), 'utf8')).toBe(renderSources(built.index));
    expect(readFileSync(tableFile, 'utf8')).toBe(renderTable(built.index));
    expect(existsSync(join(dir, 'maps.staging'))).toBe(false);
  });
});

describe('renderSources', () => {
  test('one row per scan with provider, page and licence, and the CC0 note', async () => {
    const { index } = await buildIndex(mapping(), stubStore().client, null, false);
    const text = renderSources(index);
    expect(text).toContain('https://ambientcg.com/a/WoodFloor056');
    expect(text).toContain('CC0-1.0');
    expect(text.match(/^\| [^-]/gm)?.length).toBe(3);
  });
});
