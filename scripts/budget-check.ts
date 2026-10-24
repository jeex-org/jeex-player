/**
 * Bundle budget gate.
 *
 * Measures the gzip size of the built JavaScript and fails the build when it
 * exceeds the limit. Source maps are ignored: they are emitted as
 * `sourcemap: 'hidden'` and never shipped to a browser.
 *
 * The rule: the 700 KB budget is for what a VIEWER download pays
 * to look at a tour. Import/export is authoring, and lives in its own entry
 * points and chunks — those are loaded by an ACTION, not by opening the page,
 * so they get their own, much smaller, per-file budget instead of being
 * folded into the sum a visitor pays. Both vite configs mark every
 * dynamic-import chunk with the `lazy-` prefix (`LAZY_CHUNK_PREFIX`) so this
 * gate can tell the two apart by name alone, with no build metadata to thread
 * through.
 *
 * Two modes for the BOOT files, because the two builds are two different
 * questions:
 *
 * - `total` (the demo, `dist/assets`): everything a page downloads together
 *   is one bundle, so the SUM of the boot files is what a visitor pays.
 * - `per-file` (the library, `dist-lib`): the boot files are ALTERNATIVES — a
 *   host loads the ES bundle or the IIFE one, an iframe host loads only the
 *   tiny helper, an editor host that wants the operation vocabulary loads only that
 *   entry, an application that only lights its own scenes loads only the
 *   lighting entry — so summing them would double-count the same code and hide the
 *   budget that actually bites (the 4 KB host helper, the 64.1 KB ops entry).
 *
 * LAZY files are always judged per file, in EITHER mode: a lazy chunk is
 * loaded on its own, never summed with the others, so there is only one
 * sensible question to ask of it.
 *
 * Usage: `bun run scripts/budget-check.ts [dist-dir] [--per-file]` — run it
 * after the build it measures, which `scripts/check.sh` does for both.
 */

import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Hard limit for the shipped JavaScript, gzip bytes (700 KB incl. Three.js). */
export const BUDGET_FAIL_BYTES = 700 * 1024;
/** Soft limit: past this the bundle is worth a look before it becomes a problem. */
export const BUDGET_WARN_BYTES = 350 * 1024;
/**
 * Hard limit for the iframe HOST helper, gzip bytes. It carries no
 * Three.js and no viewer code at all — a page that embeds by iframe must not
 * pay for the viewer twice — so its budget is three orders of magnitude
 * smaller than the viewer's, and it is the number that catches an accidental
 * import back into `src/`.
 */
export const HOST_BUDGET_FAIL_BYTES = 4 * 1024;
/**
 * Hard limit for the `jeex-viewer/ops` entry, gzip bytes. It re-exports the
 * pure scene-operation vocabulary an editor host applies server-side — `applyOp`,
 * `SceneModel`, the validator, the shipped registries, the plan solver, the
 * layout lint and the interior-preset helpers, plus the `zod/mini` op and
 * scene schemas — a good deal of the scene model, but still no `three` and no
 * DOM.
 *
 * The gate is set from a measured size of `jeex-viewer-ops.js` (81,035 gzip
 * bytes, 79.1 KB, from `measureBundle('dist-lib')` right after
 * `bun run build:lib`) plus 1 KB. Most of the entry is the scene model and its
 * `zod/mini` schemas; the bundled bank's fixed UUID v7 literals (random hex
 * that gzip cannot fold) are a large share. The last raise, from 79,666
 * bytes, is the sun orientation's `site` field (80,286 bytes with it) and
 * the `set_site` operation (about 0.7 KB: its op schema, applier and preset
 * rule), which a host judges and applies server-side. The raise before it,
 * from 75,170 bytes, was the library materials (the manifest's `library`
 * member, about 1.9 KB; the scene's finish values and the explicit
 * `set_material` with its version gate, about 2.2 KB). A future
 * export that crosses it is meant to be noticed here, not discovered at
 * `npm pack` time; the fix is to re-measure and update this comment, never to
 * raise the number from memory.
 */
export const OPS_BUDGET_FAIL_BYTES = 81_035 + 1024;

/**
 * Hard limit for the `jeex-viewer/lighting` entry, gzip bytes. It carries the
 * lighting standard and nothing of the viewer: no three.js (the consumer
 * passes its own in) and no DOM, so it is the environment recipe, the rig
 * code and the `zod/mini` schema of the rig options — the last of which is
 * most of the bytes.
 *
 * The gate is the last measured size of `jeex-viewer-lighting.js` (12,085
 * gzip bytes, 11.8 KB, from `measureBundle('dist-lib')` right after
 * `bun run build:lib`, once the entry gained the colour temperature; 11,743
 * after the sun direction, the shadow frustum fit and the controllable
 * apartment rig, 9,750 before) plus 1 KB. A
 * three.js that slipped into the entry would be two orders of magnitude over
 * it; `scripts/lighting-entry-check.ts` is the gate that says so by name.
 */
export const LIGHTING_BUDGET_FAIL_BYTES = 12_085 + 1024;

/**
 * The custom-element entry (`vite.lib.config.ts`) and the hard limit for it
 * PLUS every file it imports statically, gzip bytes: what a page that pastes
 * `<jeex-viewer>` downloads before any player is near the viewport. The viewer
 * itself is behind the element's start (`src/embed/element-runtime.ts`, a
 * dynamic import), and this is the number that catches it being pulled back
 * into the element's static graph.
 *
 * The gate is the measured size (41,360 gzip bytes: the entry, the element's
 * own chunk and the option reader it shares with the other entries, from
 * `measureBundle('dist-lib')` right after `bun run build:lib`, once the light
 * temperature joined the options: its rows, the settings strings of the seven
 * catalogues the option reader carries, the live attribute and the pending
 * handle's setter; 39,297 before) plus 1 KB.
 */
export const ELEMENT_ENTRY = 'jeex-viewer-element.js';
export const ELEMENT_BOOT_FAIL_BYTES = 41_360 + 1024;
/** A three.js chunk's name (`jeex-viewer-three.core-<hash>.js`); none may be in the element's static graph. */
const THREE_CHUNK = /^jeex-viewer-three\./;

/** File-name prefix of the host helper's bundles (`vite.lib.config.ts`). */
const HOST_BUNDLE_PREFIX = 'jeex-viewer-host';
/**
 * File-name prefix of the ops entry's bundle (`vite.lib.config.ts`). It is
 * NOT the only `dist-lib` file starting `jeex-viewer-op`: the `es` build also
 * emits `jeex-viewer-opening-frame-<hash>.js`, an unrelated opening-geometry
 * chunk. The two diverge at the fifth character (`...-op` + `s` vs `...-op` +
 * `ening-frame`), so this `startsWith` cannot claim that chunk by accident.
 */
const OPS_BUNDLE_PREFIX = 'jeex-viewer-ops';
/**
 * File-name prefix of the lighting entry's bundle (`vite.lib.config.ts`),
 * up to and including the dot: the `es` build also emits shared chunks named
 * after a lighting MODULE (`jeex-viewer-lighting-context-<hash>.js`,
 * `jeex-viewer-lighting-standard-<hash>.js`), which are viewer code and must
 * fall through to the viewer's own budget.
 */
const LIGHTING_BUNDLE_PREFIX = 'jeex-viewer-lighting.';

/**
 * File-name prefix both vite configs give every dynamic-import chunk
 * (`vite.config.ts`, `vite.lib.config.ts`). A lazy chunk is never loaded by
 * opening the page: it waits for an action (an export, an editing tool) or for
 * the first entry into a mode that needs it (the walk and tour chain).
 */
export const LAZY_CHUNK_PREFIX = 'lazy-';
/** Hard limit for a lazy chunk that names no override in `LAZY_LIMITS`, gzip bytes. */
export const LAZY_CHUNK_FAIL_BYTES = 256 * 1024;
/**
 * Per-lazy-chunk overrides, keyed by file-name prefix (matched against the
 * full file name, same as `limitFor`).
 *
 * `lazy-jeex-viewer-walk-post`: the walk and tour post-processing chain
 * (`src/render/walk-post.ts`: three's composer, GTAO, SMAA with its two
 * embedded lookup images, the output pass), loaded on the first entry into
 * walk or tour rather than at boot, and the walk room lighting with three's
 * light-probe grid (`src/render/walk-lighting/`), with the light temperature's
 * room re-capture and the walk sun scale.
 * The limit is the last measured size of the ES build's chunk (63,734 gzip
 * bytes, from `measureBundle('dist-lib')` right after `bun run build:lib`; the
 * demo build's is 61,505; 62,682 before the light temperature, 50,773 before
 * the room lighting) plus 1 KB, so a
 * second effect added to the chain is noticed here. The IIFE build cannot split
 * code and carries the chain inline, inside the 700 KB boot budget.
 */
export const LAZY_LIMITS: Readonly<Record<string, number>> = {
  'lazy-jeex-viewer-walk-post': 63_734 + 1024,
  // three's KTX2 loader with its container parser and Zstd decoder
  // (`src/materials/ktx2.ts`), loaded by the first KTX2 asset: 25,052 gzip
  // bytes in the ES build (24,175 in the demo build) from `measureBundle`
  // after the builds, plus 1 KB.
  'lazy-jeex-viewer-KTX2Loader': 25_052 + 1024,
  // The Basis transcoder's JS wrapper (`scripts/basis-transcoder-plugin.ts`),
  // three's file byte for byte: 15,259 gzip bytes, plus 1 KB.
  'lazy-jeex-viewer-basis-transcoder-': 15_259 + 1024,
};

/**
 * Per-file limits of the `.wasm` files, keyed like `LAZY_LIMITS`. A `.wasm`
 * file is never imported by a script, so it is always lazy.
 *
 * `lazy-jeex-viewer-basis-transcoder-`: the Basis transcoder's wasm, three's
 * file byte for byte, fetched by the first KTX2 asset: 248,951 gzip bytes
 * (three 0.186.1) plus 1 KB. A three upgrade that grows it is noticed here.
 */
export const LAZY_WASM_LIMITS: Readonly<Record<string, number>> = { 'lazy-jeex-viewer-basis-transcoder-': 248_951 + 1024 };

/** How the sizes are judged: as one download, or as alternatives. */
export type BudgetMode = 'total' | 'per-file';

/** The hard limit that applies to one built BOOT file, addressed by its name. */
export function limitFor(name: string): number {
  if (name.startsWith(HOST_BUNDLE_PREFIX)) return HOST_BUDGET_FAIL_BYTES;
  if (name.startsWith(OPS_BUNDLE_PREFIX)) return OPS_BUDGET_FAIL_BYTES;
  if (name.startsWith(LIGHTING_BUNDLE_PREFIX)) return LIGHTING_BUDGET_FAIL_BYTES;
  return BUDGET_FAIL_BYTES;
}

/** The hard limit that applies to one built LAZY file, addressed by its name. */
function lazyLimitFor(name: string): number {
  for (const [prefix, bytes] of Object.entries(name.endsWith('.wasm') ? LAZY_WASM_LIMITS : LAZY_LIMITS)) {
    if (name.startsWith(prefix)) return bytes;
  }
  return LAZY_CHUNK_FAIL_BYTES;
}

/** Whether `name` is a lazy (dynamic-import) chunk rather than a boot file; every `.wasm` file is. */
function isLazyChunk(name: string): boolean {
  return name.startsWith(LAZY_CHUNK_PREFIX) || name.endsWith('.wasm');
}

export type BundleEntry = {
  name: string;
  bytes: number;
  gzipBytes: number;
  /** Sibling files this one imports STATICALLY (`import … from "./x.js"`, `import "./x.js"`), never `import("./x.js")`. */
  imports: string[];
};

/** A static `import`/`export … from` of a sibling file; a dynamic `import(` never matches (the `(`). */
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g;

/** The sibling files `source` imports statically. */
export function staticImports(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(STATIC_IMPORT)) found.add(match[1]!);
  return [...found];
}

/**
 * Which files are lazy: every `lazy-` chunk, and every file that only lazy
 * files import. The bundler hoists a module
 * two dynamic entries share into a common chunk that is no dynamic entry of
 * its own and carries no prefix; it is still never loaded by opening the page.
 * Boot is what the entries (imported by nothing) reach statically.
 */
export function lazyFiles(entries: readonly BundleEntry[]): Set<string> {
  const boot = new Set<string>();
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const imported = new Set(entries.flatMap((entry) => entry.imports));
  const queue = entries.filter((entry) => !isLazyChunk(entry.name) && !imported.has(entry.name)).map((entry) => entry.name);
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (boot.has(name)) continue;
    boot.add(name);
    for (const next of byName.get(name)?.imports ?? []) if (byName.has(next) && !boot.has(next)) queue.push(next);
  }
  return new Set(entries.filter((entry) => !boot.has(entry.name)).map((entry) => entry.name));
}

/** `start` and every file it reaches through static imports, `start` first. */
export function staticClosure(entries: readonly BundleEntry[], start: string): BundleEntry[] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const seen = new Map<string, BundleEntry>();
  const queue = [start];
  while (queue.length > 0) {
    const entry = byName.get(queue.shift()!);
    if (entry === undefined || seen.has(entry.name)) continue;
    seen.set(entry.name, entry);
    queue.push(...entry.imports);
  }
  return [...seen.values()];
}

/** The element entry's static graph against its budget, and against three.js; nothing when the build has no element entry. */
function elementBootFailures(entries: readonly BundleEntry[]): string[] {
  const closure = staticClosure(entries, ELEMENT_ENTRY);
  if (closure.length === 0) return [];
  const failures: string[] = [];
  const gzip = closure.reduce((sum, entry) => sum + entry.gzipBytes, 0);
  if (gzip > ELEMENT_BOOT_FAIL_BYTES) {
    failures.push(
      `${ELEMENT_ENTRY} loads ${formatBytes(gzip)} gzip before its start, over its ${formatBytes(ELEMENT_BOOT_FAIL_BYTES)} budget`,
    );
  }
  for (const entry of closure) {
    if (THREE_CHUNK.test(entry.name)) failures.push(`${ELEMENT_ENTRY} imports three.js (${entry.name}) before its start`);
  }
  return failures;
}

export type BudgetReport = {
  boot: { files: string[]; gzip: number };
  lazy: { files: string[]; gzip: number };
  /** One message per file (or, for boot in `total` mode, per bundle) over its hard limit. */
  failures: string[];
  /** One message per bundle over its soft limit but still under the hard one. */
  warnings: string[];
};

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Gzip sizes of every `.js` and `.wasm` file directly under `dir`, largest first. */
export function measureBundle(dir: string): BundleEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw new Error(`No build output at ${dir}; run \`npm run build\` first`);
  }
  const entries: BundleEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.js') && !name.endsWith('.wasm')) continue;
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    const source = readFileSync(path);
    entries.push({
      name,
      bytes: source.byteLength,
      gzipBytes: gzipSync(source).byteLength,
      imports: name.endsWith('.wasm') ? [] : staticImports(source.toString('utf8')),
    });
  }
  return entries.sort((left, right) => right.gzipBytes - left.gzipBytes);
}

/**
 * Measures `dir` and classifies every file as boot or lazy: lazy files are
 * always held to their own per-file limit; boot files are summed (`'total'`)
 * or held to their own per-file limit (`'per-file'`), per the mode doc above.
 */
export function checkBudget(dir: string, mode: BudgetMode = 'total'): BudgetReport {
  const entries = measureBundle(dir);
  if (entries.length === 0) throw new Error(`No .js files in ${dir}; run \`npm run build\` first`);

  const lazy = lazyFiles(entries);
  const bootEntries = entries.filter((entry) => !lazy.has(entry.name));
  const lazyEntries = entries.filter((entry) => lazy.has(entry.name));

  const failures: string[] = [];
  const warnings: string[] = [];

  // A `lazy-` name the page loads on open would hide boot weight under a lazy budget.
  for (const entry of bootEntries) {
    for (const name of entry.imports) {
      if (isLazyChunk(name)) failures.push(`${entry.name} is loaded on open and imports ${name}, which is named lazy`);
    }
  }

  for (const entry of lazyEntries) {
    const limit = lazyLimitFor(entry.name);
    if (entry.gzipBytes > limit) {
      failures.push(`${entry.name} is ${formatBytes(entry.gzipBytes)} gzip, over its ${formatBytes(limit)} lazy-chunk budget`);
    }
  }

  const bootGzip = bootEntries.reduce((sum, entry) => sum + entry.gzipBytes, 0);
  failures.push(...elementBootFailures(entries));

  if (mode === 'total') {
    if (bootGzip > BUDGET_FAIL_BYTES) {
      failures.push(`boot bundle is ${formatBytes(bootGzip)} gzip, over its ${formatBytes(BUDGET_FAIL_BYTES)} budget`);
    } else if (bootGzip > BUDGET_WARN_BYTES) {
      warnings.push(`boot bundle is ${formatBytes(bootGzip)} gzip, over the ${formatBytes(BUDGET_WARN_BYTES)} soft limit`);
    }
  } else {
    for (const entry of bootEntries) {
      const limit = limitFor(entry.name);
      if (entry.gzipBytes > limit) {
        failures.push(`${entry.name} is ${formatBytes(entry.gzipBytes)} gzip, over its ${formatBytes(limit)} budget`);
      } else if (limit === BUDGET_FAIL_BYTES && entry.gzipBytes > BUDGET_WARN_BYTES) {
        warnings.push(`${entry.name} is ${formatBytes(entry.gzipBytes)} gzip, over the ${formatBytes(BUDGET_WARN_BYTES)} soft limit`);
      }
    }
  }

  return {
    boot: { files: bootEntries.map((entry) => entry.name), gzip: bootGzip },
    lazy: { files: lazyEntries.map((entry) => entry.name), gzip: lazyEntries.reduce((sum, entry) => sum + entry.gzipBytes, 0) },
    failures,
    warnings,
  };
}

// Run as a script, not when imported by a test.
if (import.meta.main) {
  const args = process.argv.slice(2);
  const mode: BudgetMode = args.includes('--per-file') ? 'per-file' : 'total';
  const dir = args.find((arg) => !arg.startsWith('--')) ?? 'dist/assets';
  const report = checkBudget(dir, mode);

  console.log(`boot: ${formatBytes(report.boot.gzip)} gzip across ${report.boot.files.length} file(s) (${mode})`);
  for (const name of report.boot.files) console.log(`    ${name}`);
  console.log(`lazy: ${formatBytes(report.lazy.gzip)} gzip across ${report.lazy.files.length} file(s)`);
  for (const name of report.lazy.files) console.log(`    ${name}`);

  for (const warning of report.warnings) console.warn(`Budget check warning: ${warning}`);

  if (report.failures.length > 0) {
    for (const failure of report.failures) console.error(`Budget check FAILED: ${failure}`);
    process.exit(1);
  }

  console.log(`Budget check OK: ${dir}`);
}
