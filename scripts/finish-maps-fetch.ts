/**
 * Refreshes `finish-maps/`, the maps of the bundled room finishes, from the
 * library versions a mapping pins, and regenerates the player's table of them
 * (`src/materials/builtin-library-data.ts`).
 *
 * Authoring time only: the viewer, the builds and the tests never reach a
 * store. Usage:
 *
 *   STORE_DEV_KEY=<key> bun run scripts/finish-maps-fetch.ts --map <mapping.json> --store <origin> [--update]
 *
 * For every bound finish of the mapping it asks the store's map endpoint
 * (`GET /store/v1/material-versions/<version>/maps/<role>?px=<px>`, a
 * signed URL) for each shipped role at 256, 512 and 768 px, downloads the
 * bytes and checks them: a WebP container, the size asked for, the per-file
 * cap, and the same bytes as any file the current index already records under
 * that path (a path names a pinned version, so its bytes never change). A
 * finish whose entry differs from the current index (another pinned version,
 * tint or rotation, or a bound or kept finish turned into an alias) is
 * refused unless `--update` is given; the change is printed either way. An
 * alias row (a retired finish that reads as another one) fetches nothing; its
 * target must be another row that is bound or kept. Roles follow
 * the store's manifest projection: the colour map of the colour mode, the
 * normal map unless its strength is 0, and the ARM pack.
 *
 * Everything is written to a staging folder first and swapped in whole. The
 * key is read from the environment and sent only to the store.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { LibraryFacts, LibraryMaterial } from '../src/materials/finish-types.js';
import type { BuiltinRecords } from '../src/materials/builtin-library-data.js';
import { MAX_TEXTURE_FILE_BYTES } from '../src/shared/limits.js';
import {
  MAPPING_ROW_MODES,
  SHIPPED_ROLES,
  SHIPPED_SIZES,
  finishMappingRowSchema,
  finishMappingSchema,
  finishMapsIndexSchema,
  type FinishMappingRow,
  type FinishMapsCeiling,
  type FinishMapsEntry,
  type FinishMapsIndex,
  type FinishMapsVersion,
} from './finish-maps-index.schema.js';

/** The repository root (`import.meta.dirname`, which Bun and the Node that loads the build configs both have). */
const ROOT = resolve(import.meta.dirname, '..');

/** The shipped folder, at the repository root. */
export const FINISH_MAPS_DIR = join(ROOT, 'finish-maps');

/** The generated table the viewer reads. */
export const TABLE_FILE = join(ROOT, 'src', 'materials', 'builtin-library-data.ts');

type Role = (typeof SHIPPED_ROLES)[number];
type Size = (typeof SHIPPED_SIZES)[number];

/** What the store's map endpoint answers. */
export type SignedMap = { url: string; width: number; height: number; codec: string; colourSpace: string };

/** The two calls the script makes. */
export type StoreClient = {
  mapUrl(versionId: string, role: Role, px: number): Promise<SignedMap>;
  download(url: string): Promise<Uint8Array>;
};

/** A store client over `fetch`, with the key as a bearer token on the store's own requests only. */
export function httpStore(origin: string, key: string): StoreClient {
  return {
    async mapUrl(versionId, role, px) {
      const response = await fetch(`${origin}/store/v1/material-versions/${versionId}/maps/${role}?px=${px}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!response.ok) throw new Error(`store answered ${response.status} for ${versionId} ${role} ${px}`);
      return (await response.json()) as SignedMap;
    },
    async download(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`download answered ${response.status} for a ${new URL(url).pathname} map`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** True for a RIFF/WEBP container. */
function isWebp(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1');
  return bytes.length >= 12 && text.decode(bytes.subarray(0, 4)) === 'RIFF' && text.decode(bytes.subarray(8, 12)) === 'WEBP';
}

/** The roles a version ships, in the store's projection order. */
function rolesOf(facts: { colourMode: string; normalStrength?: number | undefined; maps: readonly string[] }): Role[] {
  const colour: Role = facts.colourMode === 'tintable' ? 'albedoTint' : 'albedo';
  const normal = facts.maps.includes('normal') && facts.normalStrength !== 0;
  return [colour, ...(normal ? (['normal'] as const) : []), 'arm'].filter((role) => facts.maps.includes(role)) as Role[];
}

/**
 * The pixel shape the store renders a map of `tileM` at size `px`: `px` on
 * the tile's longer side, the other side in the tile's proportion (a power
 * of two, which `checkRows` has already made sure of).
 */
function mapShape(tileM: readonly [number, number] | null, px: number): [number, number] {
  if (tileM === null || tileM[0] === tileM[1]) return [px, px];
  return tileM[0] > tileM[1] ? [px, Math.round((px * tileM[1]) / tileM[0])] : [Math.round((px * tileM[0]) / tileM[1]), px];
}

/** Every recorded file of `index` by path, with its hash. */
function recordedHashes(index: FinishMapsIndex | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const version of index?.versions ?? []) {
    for (const [, map] of listedMaps(version)) for (const file of Object.values(map.files)) out.set(file.path, file.sha256);
  }
  return out;
}

/** Every entry of `index`, the ceiling default included, by finish id. */
function entriesById(index: FinishMapsIndex | null): Map<string, FinishMapsEntry> {
  const out = new Map<string, FinishMapsEntry>();
  for (const entry of [...(index?.finishes ?? []), ...(index === null ? [] : [index.defaults.ceiling])]) out.set(entry.finish, entry);
  return out;
}

/**
 * What changed between an entry of the previous index and the same finish's
 * new entry, one line per change: a pinned version (or variant), a tint, a
 * rotation, or the kind of entry itself (bound, kept, alias, or another alias
 * target). Empty when nothing did.
 */
function entryChanges(was: FinishMapsEntry, now: FinishMapsEntry): string[] {
  const state = (entry: FinishMapsEntry): string =>
    'kept' in entry ? 'kept' : 'alias' in entry ? `alias ${entry.alias}` : `bound ${entry.version}`;
  if ('version' in was && 'version' in now) {
    const lines: string[] = [];
    if (was.version !== now.version || was.variant !== now.variant) lines.push(`${now.slug}: ${was.version} -> ${now.version}`);
    if (was.colour !== now.colour) lines.push(`${now.slug}: tint ${was.colour ?? 'none'} -> ${now.colour ?? 'none'}`);
    if ((was.rotation ?? 0) !== (now.rotation ?? 0)) lines.push(`${now.slug}: rotation ${was.rotation ?? 0} -> ${now.rotation ?? 0}`);
    return lines;
  }
  return state(was) === state(now) ? [] : [`${now.slug}: ${state(was)} -> ${state(now)}`];
}

/**
 * The cross-row rules of a mapping, judged before anything is fetched: every
 * row names exactly one mode, every finish id appears once, an alias names
 * another row that is bound or kept (never itself, never an alias, never a
 * pending row), and the ceiling default is bound or kept.
 */
function checkRows(rows: readonly FinishMappingRow[], ceiling: FinishMappingRow): void {
  for (const row of [...rows, ceiling]) {
    const modes = MAPPING_ROW_MODES.filter((mode) => mode in row);
    if (modes.length !== 1) throw new Error(`the mapping row ${row.slug} names ${modes.length} modes (${modes.join(', ')}), not one`);
  }
  const byId = new Map<string, FinishMappingRow>();
  for (const row of rows) {
    if (byId.has(row.finish)) throw new Error(`the mapping lists ${row.finish} more than once`);
    byId.set(row.finish, row);
  }
  for (const row of rows) {
    if (!('alias' in row)) continue;
    const { alias } = row as AliasRow;
    const target = byId.get(alias);
    if (target === undefined || target === row) throw new Error(`${row.slug}: the alias target ${alias} is not another row`);
    if ('alias' in target || 'pending' in target) throw new Error(`${row.slug}: the alias target ${target.slug} is not bound or kept`);
  }
  if ('alias' in ceiling || 'pending' in ceiling) throw new Error('the ceiling default must be bound or kept');
  for (const row of [...rows, ceiling]) {
    const tileM = 'material' in row ? (row as BoundRow).facts.tileM : null;
    if (tileM !== null && !isPowerOfTwoRatio(tileM))
      throw new Error(`${row.slug}: the tile ${tileM[0]} by ${tileM[1]} m is not in a power-of-two ratio, which the player cannot draw`);
  }
}

/** Whether the longer side of `tileM` is the shorter one times a power of two (1, 2, 4 ...), the shapes the player draws. */
function isPowerOfTwoRatio(tileM: readonly [number, number]): boolean {
  const ratio = Math.max(...tileM) / Math.min(...tileM);
  const whole = Math.round(ratio);
  return Math.abs(ratio - whole) < 1e-9 && (whole & (whole - 1)) === 0;
}

type BoundRow = Extract<FinishMappingRow, { material: string }>;
type AliasRow = Extract<FinishMappingRow, { alias: string }>;

function entryOf(row: FinishMappingRow): FinishMapsEntry {
  if ('material' in row) {
    const bound = row as BoundRow;
    return {
      finish: bound.finish,
      slug: bound.slug,
      ...(bound.name !== undefined && { name: bound.name }),
      variant: bound.material,
      version: bound.facts.version,
      ...(bound.colour !== undefined && { colour: bound.colour }),
      ...(bound.rotation !== undefined && { rotation: bound.rotation }),
    };
  }
  if ('alias' in row) return { finish: row.finish, slug: row.slug, alias: (row as AliasRow).alias };
  return { finish: row.finish, slug: row.slug, kept: true, why: 'keep' in row ? 'keep' : 'pending' };
}

/** The ceiling default's entry: `checkRows` has refused an alias there. */
function ceilingOf(row: FinishMappingRow): FinishMapsCeiling {
  const entry = entryOf(row);
  if ('alias' in entry) throw new Error('the ceiling default must be bound or kept');
  return entry;
}

/**
 * The new index and the bytes of every file it lists, from `mapping` and the
 * store, judged against the `previous` index.
 */
export async function buildIndex(
  mapping: unknown,
  store: StoreClient,
  previous: FinishMapsIndex | null,
  update: boolean,
): Promise<{ index: FinishMapsIndex; files: Map<string, Uint8Array> }> {
  const parsed = finishMappingSchema.safeParse(mapping);
  if (!parsed.success) throw new Error(`the mapping does not read: ${parsed.error.message}`);
  const ceilingRow = parsed.data.playerDefaults.find((row) => row.surface === 'ceiling');
  if (ceilingRow === undefined) throw new Error('the mapping names no ceiling default');
  const rows = parsed.data.rows;
  const ceiling = finishMappingRowSchema.parse(ceilingRow);
  checkRows(rows, ceiling);
  const recorded = recordedHashes(previous);
  const before = entriesById(previous);
  const changes: string[] = [];
  for (const row of [...rows, ceiling]) {
    const was = before.get(row.finish);
    if (was !== undefined) changes.push(...entryChanges(was, entryOf(row)));
  }
  const kept = new Set([...rows, ceiling].map((row) => row.finish));
  for (const [finish, was] of before) if (!kept.has(finish)) changes.push(`${was.slug}: removed`);
  const factsSeen = new Map<string, string>();
  const versions = new Map<string, FinishMapsVersion>();
  const files = new Map<string, Uint8Array>();
  for (const row of [...rows, ceiling]) {
    if (!('material' in row)) continue;
    const bound = row as BoundRow;
    const { facts } = bound;
    const factsJson = JSON.stringify(facts);
    const seen = factsSeen.get(facts.version);
    if (seen !== undefined && seen !== factsJson)
      throw new Error(`${bound.slug}: version ${facts.version} is given different facts by two rows`);
    factsSeen.set(facts.version, factsJson);
    if (versions.has(facts.version)) continue;
    const maps: FinishMapsVersion['maps'] = {};
    for (const role of facts.tileM === null ? [] : rolesOf(facts)) {
      const listed = {} as Record<Size, { path: string; bytes: number; sha256: string }>;
      for (const size of SHIPPED_SIZES) {
        const px = Number(size);
        const signed = await store.mapUrl(facts.version, role, px);
        const [width, height] = mapShape(facts.tileM, px);
        if (signed.width !== width || signed.height !== height) {
          throw new Error(`${facts.name} ${role}: the store rendered ${signed.width}x${signed.height}, not ${width}x${height}`);
        }
        const bytes = await store.download(signed.url);
        const path = `tex/${facts.version}/${role}.${size}.webp`;
        if (!isWebp(bytes)) throw new Error(`${path} is not a WebP file`);
        if (bytes.length > MAX_TEXTURE_FILE_BYTES) throw new Error(`${path} is ${bytes.length} bytes, over MAX_TEXTURE_FILE_BYTES`);
        const hash = sha256(bytes);
        const known = recorded.get(path);
        if (known !== undefined && known !== hash) throw new Error(`${path}: different bytes under a recorded path`);
        files.set(path, bytes);
        listed[size] = { path, bytes: bytes.length, sha256: hash };
      }
      maps[role] = {
        colourSpace: role === 'albedo' || role === 'albedoTint' ? 'srgb' : 'linear',
        ...(role === 'normal' && { convention: 'opengl' as const }),
        files: listed,
      };
    }
    versions.set(facts.version, {
      version: facts.version,
      variant: bound.material,
      name: facts.name,
      kind: facts.tileM === null ? 'parameters' : 'scan',
      facts: {
        tileM: facts.tileM,
        grain: facts.grain,
        suitability: facts.suitability,
        ...(facts.normalStrength !== undefined && facts.normalStrength > 0 && { normalStrength: facts.normalStrength }),
        colourMode: facts.colourMode,
        ...(facts.tint !== undefined && { tint: facts.tint }),
        averageColour: facts.averageColour,
        pbr: facts.pbr,
      },
      maps,
      source: facts.source,
    });
  }
  if (changes.length > 0) {
    if (!update) throw new Error(`finish entries changed (re-run with --update to accept):\n  ${changes.join('\n  ')}`);
    console.log(`finish-maps: accepted finish entry changes:\n  ${changes.join('\n  ')}`);
  }
  const index: FinishMapsIndex = {
    format: 1,
    finishes: rows.map((row) => entryOf(row)),
    defaults: { ceiling: ceilingOf(ceiling) },
    versions: [...versions.values()],
  };
  return { index: finishMapsIndexSchema.parse(index), files };
}

/**
 * A version's facts as the player's type. The schema has judged them; a
 * parsed JSON value never holds an `undefined` member, which is the one
 * difference `exactOptionalPropertyTypes` sees between the two types.
 */
function factsOf(version: FinishMapsVersion): LibraryFacts {
  return version.facts as LibraryFacts;
}

/** The maps a version lists, role by role, skipping the absent roles. */
export function listedMaps(
  version: FinishMapsVersion,
): [string, NonNullable<FinishMapsVersion['maps'][keyof FinishMapsVersion['maps']]>][] {
  return Object.entries(version.maps).flatMap(([role, map]) => (map === undefined ? [] : [[role, map] as [string, typeof map]]));
}

/** One version of the index as the library material the viewer draws. */
export function libraryMaterialOf(version: FinishMapsVersion): LibraryMaterial {
  const maps: { [role: string]: LibraryMaterial['maps'][keyof LibraryMaterial['maps']] } = {};
  for (const [role, map] of listedMaps(version)) {
    maps[role] = {
      colourSpace: map.colourSpace,
      ...(map.convention !== undefined && { convention: map.convention }),
      files: Object.fromEntries(Object.entries(map.files).map(([size, file]) => [size, file.path])),
    };
  }
  return { versionId: version.version, kind: version.kind, facts: factsOf(version), maps };
}

/** The compact records the viewer's table holds: facts once per version, paths derived at run time. */
export function tableRecords(index: FinishMapsIndex): BuiltinRecords {
  const order = index.versions.map((version) => version.version);
  const binding = (entry: FinishMapsEntry) =>
    'version' in entry
      ? {
          finish: entry.finish,
          version: order.indexOf(entry.version),
          ...(entry.colour !== undefined && { colour: entry.colour }),
          rotation: entry.rotation ?? 0,
        }
      : null;
  return {
    versions: index.versions.map((version) => ({
      versionId: version.version,
      kind: version.kind,
      facts: factsOf(version),
      roles: listedMaps(version).map(([role]) => role) as BuiltinRecords['versions'][number]['roles'],
      sizes: [...SHIPPED_SIZES],
    })),
    finishes: index.finishes.flatMap((entry) => {
      const record = binding(entry);
      return record === null ? [] : [record];
    }),
    ceiling: binding(index.defaults.ceiling),
  };
}

/** The generated table module (formatted afterwards by the repository's formatter). */
export function renderTable(index: FinishMapsIndex): string {
  return `/**
 * The bundled room finishes as library materials: GENERATED by
 * \`scripts/finish-maps-fetch.ts\` from \`finish-maps/index.json\`; do not edit by
 * hand. Facts once per pinned library version; map paths are derived from the
 * version id, the role and the size (\`builtin-library.ts\`). The ids are
 * opaque UUIDs given by the library.
 *
 * Pure data: no imports of values, no \`three\`, no DOM.
 */

import type { LibraryFacts, LibraryMapRole, LibraryMapSize } from './finish-types.js';

/** One pinned library version. */
export type BuiltinVersionRecord = {
  readonly versionId: string;
  readonly kind: 'scan' | 'parameters';
  readonly facts: LibraryFacts;
  readonly roles: readonly LibraryMapRole[];
  readonly sizes: readonly LibraryMapSize[];
};

/** One bundled finish bound to a version (an index into \`versions\`), with its tint and rotation. */
export type BuiltinFinishRecord = {
  readonly finish: string;
  readonly version: number;
  readonly colour?: string;
  readonly rotation: number;
};

export type BuiltinRecords = {
  readonly versions: readonly BuiltinVersionRecord[];
  readonly finishes: readonly BuiltinFinishRecord[];
  /** The ceiling every room wears when it names none; \`null\` while it keeps its flat paint. */
  readonly ceiling: BuiltinFinishRecord | null;
};

export const BUILTIN_RECORDS: BuiltinRecords = ${JSON.stringify(tableRecords(index), null, 2)};
`;
}

/** `SOURCES.md`: one row per scan. */
export function renderSources(index: FinishMapsIndex): string {
  const rows = index.versions
    .filter((version) => version.kind === 'scan')
    .map(
      (version) =>
        `| ${version.name} | ${version.source.provider} | ${version.source.sourcePage} | ${version.source.licence} | \`${version.version}\` |`,
    );
  return [
    '# Sources of the bundled finish maps',
    '',
    'The maps under `tex/` are scanned textures released under CC0 1.0 (public domain dedication) by their providers, re-encoded as WebP at 256, 512 and 768 px by the JEEX material library; tintable materials ship a luminance-normalised colour map. No attribution is required; the list is kept for provenance. The player code is licensed separately (see `LICENSE` and `NOTICE` at the repository root).',
    '',
    '| Material | Provider | Source | Licence | Library version |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

/** Writes the folder through a staging copy, then the table. */
export function writeFolder(dir: string, tableFile: string, index: FinishMapsIndex, files: ReadonlyMap<string, Uint8Array>): void {
  const staging = `${dir}.staging`;
  rmSync(staging, { recursive: true, force: true });
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(staging, path)), { recursive: true });
    writeFileSync(join(staging, path), bytes);
  }
  writeFileSync(join(staging, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  writeFileSync(join(staging, 'SOURCES.md'), renderSources(index));
  const old = `${dir}.old`;
  rmSync(old, { recursive: true, force: true });
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(staging, dir);
  rmSync(old, { recursive: true, force: true });
  writeFileSync(tableFile, renderTable(index));
}

function argument(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

async function main(args: readonly string[]): Promise<void> {
  const mapFile = argument(args, '--map');
  const origin = argument(args, '--store');
  const key = process.env['STORE_DEV_KEY'];
  if (mapFile === undefined || origin === undefined)
    throw new Error('usage: finish-maps-fetch.ts --map <mapping.json> --store <origin> [--update]');
  if (key === undefined || key === '') throw new Error('STORE_DEV_KEY is not set');
  const previousFile = join(FINISH_MAPS_DIR, 'index.json');
  const previous = existsSync(previousFile) ? finishMapsIndexSchema.parse(JSON.parse(readFileSync(previousFile, 'utf8'))) : null;
  const mapping: unknown = JSON.parse(readFileSync(mapFile, 'utf8'));
  const { index, files } = await buildIndex(mapping, httpStore(origin, key), previous, args.includes('--update'));
  writeFolder(FINISH_MAPS_DIR, TABLE_FILE, index, files);
  spawnSync('bunx', ['oxfmt', TABLE_FILE], { stdio: 'inherit' });
  const total = [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  console.log(`finish-maps: ${index.versions.length} versions, ${files.size} files, ${total} bytes`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
