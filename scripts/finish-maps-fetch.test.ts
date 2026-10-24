/**
 * The authoring script that refreshes `finish-maps/` from pinned library
 * versions, against a stub store: what it fetches, what it checks, what it
 * refuses, and what it writes.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildIndex, renderSources, renderTable, tableRecords, writeFolder, type StoreClient } from './finish-maps-fetch.js';
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

describe('alias rows', () => {
  const WHITE = '01a12fdf-1598-7b82-807b-83d8a5effde3';
  const ASH = '01a12fdf-1590-7754-92f4-5912a4ff24a2';

  /** The base mapping plus `extra` rows. */
  function withRows(...extra: unknown[]): { rows: unknown[]; playerDefaults: unknown[] } {
    const doc = mapping() as { rows: unknown[]; playerDefaults: unknown[] };
    doc.rows.push(...extra);
    return doc;
  }

  test('an alias row becomes an alias entry and fetches nothing of its own', async () => {
    const { client, calls } = stubStore();
    const { index, files } = await buildIndex(withRows({ finish: ASH, slug: 'ash', alias: OAK, reason: 'r' }), client, null, false);
    expect(index.finishes.at(-1)).toEqual({ finish: ASH, slug: 'ash', alias: OAK });
    expect(calls.filter((call) => call.url.startsWith('map:'))).toHaveLength(18);
    expect(files.size).toBe(18);
    expect(tableRecords(index).finishes.map((record) => record.finish)).not.toContain(ASH);
  });

  test('a bound row carries the mapping name into its entry', async () => {
    const doc = mapping() as { rows: Record<string, unknown>[] };
    doc.rows[0]!['name'] = 'Natural oak';
    const { index } = await buildIndex(doc, stubStore().client, null, false);
    expect(index.finishes[0]).toMatchObject({ finish: OAK, name: 'Natural oak' });
  });

  test('refuses, before any fetch, an alias whose target is missing, pending, an alias or itself', async () => {
    for (const rows of [
      [{ finish: ASH, slug: 'ash', alias: WHITE }],
      [{ finish: ASH, slug: 'ash', alias: TERRAZZO }],
      [{ finish: ASH, slug: 'ash', alias: ASH }],
      [
        { finish: ASH, slug: 'ash', alias: OAK },
        { finish: WHITE, slug: 'white', alias: ASH },
      ],
    ]) {
      const { client, calls } = stubStore();
      await expect(buildIndex(withRows(...rows), client, null, false)).rejects.toThrow(/alias/);
      expect(calls).toEqual([]);
    }
  });

  test('refuses a row with two modes, a duplicate finish id and an alias as the ceiling default', async () => {
    const two = withRows({ finish: ASH, slug: 'ash', alias: OAK, keep: true });
    await expect(buildIndex(two, stubStore().client, null, false)).rejects.toThrow(/mapping/);
    const twice = withRows({ finish: OAK, slug: 'oak_again', alias: SAND });
    await expect(buildIndex(twice, stubStore().client, null, false)).rejects.toThrow(/more than once/);
    const ceiling = mapping() as { playerDefaults: unknown[] };
    ceiling.playerDefaults = [{ surface: 'ceiling', finish: CEILING, slug: 'plaster_white', alias: SAND }];
    await expect(buildIndex(ceiling, stubStore().client, null, false)).rejects.toThrow(/ceiling/);
  });

  test('refuses two rows that give one version different facts', async () => {
    const shared = withRows({
      finish: WHITE,
      slug: 'white',
      material: PLASTER_VARIANT,
      colour: '#ece6da',
      reason: 'r',
      facts: { ...plasterFacts(), tileM: [2, 2] },
    });
    await expect(buildIndex(shared, stubStore().client, null, false)).rejects.toThrow(/different facts/);
  });

  test('a finish dropped from the mapping needs the update flag and is printed', async () => {
    const first = await buildIndex(mapping(), stubStore().client, null, false);
    const doc = mapping() as { rows: unknown[] };
    doc.rows.splice(2, 1);
    await expect(buildIndex(doc, stubStore().client, first.index, false)).rejects.toThrow(/stripes_cream: removed/);
    const accepted = await buildIndex(doc, stubStore().client, first.index, true);
    expect(accepted.index.finishes.map((entry) => entry.slug)).not.toContain('stripes_cream');
  });

  test('a bound or kept entry turning into an alias, and a changed tint, need the update flag and are printed', async () => {
    const first = await buildIndex(mapping(), stubStore().client, null, false);
    const doc = mapping() as { rows: Record<string, unknown>[] };
    doc.rows[2] = { finish: STRIPES, slug: 'stripes_cream', alias: SAND };
    doc.rows[0] = { finish: OAK, slug: 'oak', alias: SAND };
    doc.rows[1]!['colour'] = '#d3c6b2';
    const refused = buildIndex(doc, stubStore().client, first.index, false);
    await expect(refused).rejects.toThrow(/stripes_cream: kept -> alias/);
    await expect(buildIndex(doc, stubStore().client, first.index, false)).rejects.toThrow(/oak: bound/);
    await expect(buildIndex(doc, stubStore().client, first.index, false)).rejects.toThrow(/sand: .*#b0a294.*#d3c6b2/);
    const accepted = await buildIndex(doc, stubStore().client, first.index, true);
    expect(accepted.index.finishes[0]).toEqual({ finish: OAK, slug: 'oak', alias: SAND });
  });
});

describe('rectangular maps', () => {
  /** The plank row's facts turned into a 3.6 by 1.8 m tile. */
  function rectangular(): unknown {
    const doc = mapping() as { rows: Record<string, unknown>[] };
    doc.rows[0]!['facts'] = { ...plankFacts, tileM: [3.6, 1.8] };
    return doc;
  }

  /** A store that renders every map at `px` by `px / ratio`. */
  function storeAt(ratio: (versionId: string) => number) {
    const { client } = stubStore();
    return {
      ...client,
      async mapUrl(versionId: string, role: Parameters<StoreClient['mapUrl']>[1], px: number) {
        const signed = await client.mapUrl(versionId, role, px);
        return { ...signed, width: px, height: Math.round(px / ratio(versionId)) };
      },
    } satisfies StoreClient;
  }

  test('accepts the map of a rectangular tile at its longer side', async () => {
    const store = storeAt((version) => (version === PLANK_VERSION ? 2 : 1));
    const { index } = await buildIndex(rectangular(), store, null, false);
    expect(index.versions[0]?.facts.tileM).toEqual([3.6, 1.8]);
  });

  test('refuses, before any fetch, a tile whose sides are not in a power-of-two ratio', async () => {
    const doc = mapping() as { rows: Record<string, unknown>[] };
    doc.rows[0]!['facts'] = { ...plankFacts, tileM: [1.2, 0.9] };
    const { client, calls } = stubStore();
    await expect(buildIndex(doc, client, null, false)).rejects.toThrow(/power-of-two/);
    expect(calls).toEqual([]);
  });

  test("refuses a map whose shape is not the tile's", async () => {
    const store = storeAt(() => 1);
    await expect(buildIndex(rectangular(), store, null, false)).rejects.toThrow(/256x256, not 256x128/);
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
