/**
 * The post-build gate of the `jeex-viewer/lighting` entry: what the BUILD
 * emitted, not what the source says.
 *
 * The lighting standard promises a consumer two things the source alone cannot
 * prove once a bundler has been at it:
 *
 * 1. NO ENGINE AND NO DOM. `dist-lib/jeex-viewer-lighting.js` and every chunk
 *    it imports carry no three.js (no import of `three`, none of its code) and
 *    never name `document` or `window`: the consumer's own three.js and
 *    renderer are the only ones in play. `src/purity.test.ts` holds the same
 *    line over the source graph; this holds it over the artefact, where a
 *    shared chunk split off another entry could otherwise smuggle either in.
 * 2. THE DECLARATIONS SERVE A CONSUMER. A consumer file (`CONSUMER_SOURCE`)
 *    that imports `jeex-viewer/lighting` BY PACKAGE NAME, the way a host
 *    would, is typechecked against the emitted declarations through the
 *    package's own `exports` map. It is written into a scratch folder inside
 *    `dist-lib` (so the package's self-reference resolves) and removed again.
 *
 * 3. THE BUNDLED ENGINE IS THE CALIBRATED ONE. Every copy of three.js the
 *    other entries bundle (found by the revision three registers itself under,
 *    `detail: { revision: "…" }`) is `LIGHTING_STANDARD.engineRevision`, so the
 *    player never ships an engine its own lighting context refuses (a
 *    `dist-lib` built from a stale install once carried r185 beside an r186
 *    standard).
 *
 * It runs at the end of `build:lib`, like `css-contract-check.ts`, so a build
 * that emits a broken entry fails the build that emitted it.
 *
 * Usage: `bun run scripts/lighting-entry-check.ts [dist-lib-dir]`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { staticImports } from './budget-check.ts';
import { LIGHTING_STANDARD } from '../src/lighting/lighting-standard.ts';

/** The entry file the `lighting` pass of `vite.lib.config.ts` writes. */
export const LIGHTING_ENTRY = 'jeex-viewer-lighting.js';

/** One defect of the emitted entry, as a sentence. */
export type EntryDefect = { readonly file: string; readonly problem: string };

/** Signs of three.js in emitted code: an import of it, or a piece of its own source. */
const THREE_SIGNS: readonly { readonly pattern: RegExp; readonly name: string }[] = [
  { pattern: /\bfrom\s*["']three(?:\/[^"']*)?["']|\bimport\s*\(\s*["']three/, name: 'an import of three' },
  { pattern: /\bconst\s+REVISION\s*=/, name: "three's REVISION constant" },
  { pattern: /Three\.js Authors/, name: "three's licence banner" },
  { pattern: /\bclass\s+WebGLRenderer\b|\bclass\s+PMREMGenerator\b|\bclass\s+Object3D\b/, name: 'a three.js class' },
];

/** DOM roots the entry must not name. */
const DOM_ROOTS = /\b(document|window)\b/;

/** The revision three.js registers itself under, as its bundled code spells it. */
const BUNDLED_REVISION = /\bdetail:\s*\{\s*revision:\s*["'`](\d+)["'`]/g;

/** One bundled copy of three.js: each checks `window.__THREE__` for a second instance. */
const BUNDLED_COPY = /__THREE__\s*\?/g;

/** Every three.js revision bundled in `source`. Pure: the unit test feeds it text. */
export function bundledRevisions(source: string): string[] {
  return [...source.matchAll(BUNDLED_REVISION)].map((match) => match[1]!);
}

/**
 * The defects of the bundled engine across `files` (name → source): a revision
 * other than `expected`, a file that carries more copies of three.js (each
 * checks `__THREE__`) than revisions that can be read, or no bundled three.js
 * at all.
 */
export function engineDefects(files: ReadonlyMap<string, string>, expected: string): EntryDefect[] {
  const defects: EntryDefect[] = [];
  let found = 0;
  for (const [file, source] of files) {
    const revisions = bundledRevisions(source);
    if (revisions.length < [...source.matchAll(BUNDLED_COPY)].length)
      defects.push({ file, problem: 'bundles three.js whose revision cannot be read' });
    for (const revision of revisions) {
      found += 1;
      if (revision !== expected)
        defects.push({ file, problem: `bundles three.js revision ${revision}, the lighting standard requires ${expected}` });
    }
  }
  if (found === 0) defects.push({ file: '(dist-lib)', problem: 'bundles no three.js the revision can be read from' });
  return defects;
}

/** Code with comments and string literals blanked, so prose and messages are not references. */
export function codeOnly(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replaceAll(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replaceAll(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replaceAll(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** The defects of one emitted file. Pure: the unit test feeds it text. */
export function defectsOf(file: string, source: string): EntryDefect[] {
  const defects: EntryDefect[] = [];
  for (const sign of THREE_SIGNS) {
    if (sign.pattern.test(source)) defects.push({ file, problem: `carries three.js: ${sign.name}` });
  }
  const dom = DOM_ROOTS.exec(codeOnly(source));
  if (dom) defects.push({ file, problem: `names the DOM global \`${dom[1]!}\`` });
  return defects;
}

/** The entry and every sibling file it imports statically or dynamically, in `dir`. */
export function entryGraph(dir: string, entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const source = readFileSync(join(dir, name), 'utf8');
    const dynamic = [...source.matchAll(/\bimport\s*\(\s*["']\.\/([^"']+\.js)["']\s*\)/g)].map((match) => match[1]!);
    for (const next of [...staticImports(source), ...dynamic]) if (!seen.has(next)) queue.push(next);
  }
  return [...seen];
}

/**
 * The consumer fixture: a host's own file, importing the entry by package name
 * and using every exported value and type with its own three.js.
 */
export const CONSUMER_SOURCE = `import * as THREE from 'three';
import {
  createLightingContext,
  LIGHTING_ERROR_CODES,
  LIGHTING_STANDARD,
  LIGHTING_STANDARD_VERSION,
  LightingError,
  type ApartmentRigOptions,
  type LightingContext,
  type LightingErrorCode,
  type LightingRig,
  type LightingThree,
} from 'jeex-viewer/lighting';

export function light(canvas: HTMLCanvasElement): { context: LightingContext; rigs: LightingRig[]; key: string } {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const engine: LightingThree = THREE;
  const context = createLightingContext(engine, renderer);
  const options: ApartmentRigOptions = { shadowMapSize: 1024 };
  const scene = new THREE.Scene();
  const apartment = context.createApartmentRig(options);
  apartment.attach(scene);
  const reference = context.createReferenceRig();
  const revision: string = LIGHTING_STANDARD.engineRevision;
  const intensity: number = LIGHTING_STANDARD.apartment.sun.intensity;
  const codes: readonly LightingErrorCode[] = LIGHTING_ERROR_CODES;
  try {
    reference.attach(scene);
  } catch (error) {
    if (error instanceof LightingError && codes.includes(error.code)) reference.dispose();
  }
  return { context, rigs: [apartment, reference], key: \`v\${LIGHTING_STANDARD_VERSION}-\${revision}-\${intensity}\` };
}
`;

/** The consumer's compiler settings: a strict host project resolving packages by their \`exports\`. */
export const CONSUMER_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'preserve',
    moduleResolution: 'bundler',
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    exactOptionalPropertyTypes: true,
    lib: ['ES2022', 'DOM'],
    types: [],
  },
  files: ['consumer.ts'],
};

/** Typechecks the consumer fixture against the declarations in `dir`; the compiler's output on failure. */
function typecheckConsumer(dir: string): string | null {
  const scratch = join(dir, '.lighting-consumer');
  mkdirSync(scratch, { recursive: true });
  try {
    writeFileSync(join(scratch, 'consumer.ts'), CONSUMER_SOURCE);
    writeFileSync(join(scratch, 'tsconfig.json'), JSON.stringify(CONSUMER_TSCONFIG, null, 2));
    const run = Bun.spawnSync([resolve('node_modules/.bin/tsc'), '-p', join(scratch, 'tsconfig.json')], { stdout: 'pipe', stderr: 'pipe' });
    if (run.exitCode === 0) return null;
    return `${run.stdout.toString()}${run.stderr.toString()}`.trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Run as a script, not when imported by a test.
if (import.meta.main) {
  const dir = process.argv[2] ?? 'dist-lib';
  if (!existsSync(join(dir, LIGHTING_ENTRY))) {
    console.error(`Lighting entry check FAILED: no ${LIGHTING_ENTRY} in ${dir}; run \`bun run build:lib\` first`);
    process.exit(1);
  }
  const files = entryGraph(dir, LIGHTING_ENTRY);
  const defects = files.flatMap((file) => defectsOf(file, readFileSync(join(dir, file), 'utf8')));
  for (const defect of defects) console.error(`Lighting entry check FAILED: ${defect.file} ${defect.problem}`);
  const bundles = new Map(
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.js') && !files.includes(file))
      .map((file) => [file, readFileSync(join(dir, file), 'utf8')] as const),
  );
  const engine = engineDefects(bundles, LIGHTING_STANDARD.engineRevision);
  for (const defect of engine) console.error(`Lighting entry check FAILED: ${defect.file} ${defect.problem}`);
  defects.push(...engine);
  const compiler = typecheckConsumer(dir);
  if (compiler !== null)
    console.error(`Lighting entry check FAILED: the consumer fixture does not typecheck against the declarations:\n${compiler}`);
  if (defects.length > 0 || compiler !== null) process.exit(1);
  console.log(
    `Lighting entry check OK: ${files.join(', ')} carry no three.js and no DOM; the bundled three.js is revision ${LIGHTING_STANDARD.engineRevision}; the consumer fixture typechecks`,
  );
}
