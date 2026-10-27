/**
 * The post-build gate of the `jeex-viewer/schema` and `jeex-viewer/lightmap`
 * entries: what the BUILD emitted, not what the source says.
 *
 * Both entries serve a tool, not a page (a catalogue service, a light bake),
 * and both leave their heavy dependencies to that tool, so the tool's own
 * schemas and scene objects are the ones in play:
 *
 * 1. THE PEERS STAY PEERS. Neither entry nor any chunk it imports carries a
 *    copy of `zod`; `jeex-viewer/lightmap` imports `three` and carries none of
 *    its code. The signs are proved on the same artefact: they must fire on
 *    `jeex-viewer-ops.js` (which bundles Zod) and on the three.js core chunk. `jeex-viewer/schema` imports no package but Zod, so no three.js
 *    at all; that it names no DOM global is held over its SOURCE graph by
 *    `purity.test.ts` (the emitted validator's nested template literals defeat
 *    a text scan: «this document is 2.2» reads as code to `codeOnly`).
 * 2. THE ENTRIES RUN. Each is imported from `dist-lib` as a tool would load it,
 *    with its peers resolved from `node_modules`: the published demo scene
 *    (`demo-scene.json`) validates through `jeex-viewer/schema`, and its bake
 *    lights come out of `jeex-viewer/lightmap` under the published recipe.
 * 3. THE DECLARATIONS SERVE A CONSUMER. A consumer file that imports both
 *    entries BY PACKAGE NAME, with every name a catalogue service and a bake
 *    pipeline use today, is typechecked against the emitted declarations
 *    through the package's own `exports` map (scratch folder inside `dist-lib`,
 *    removed again).
 *
 * It runs at the end of `build:lib`, after `demo-scene-gen.ts`.
 *
 * Usage: `bun run scripts/package-entry-check.ts [dist-lib-dir]`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { entryGraph, type EntryDefect } from './lighting-entry-check.ts';
import { DEMO_SCENE_FILE } from './demo-scene-gen.ts';

/** The entry files the `schema` and `lightmap` passes of `vite.lib.config.ts` write. */
export const SCHEMA_ENTRY = 'jeex-viewer-schema.js';
export const LIGHTMAP_ENTRY = 'jeex-viewer-lightmap.js';

/**
 * Signs of a bundled peer that survive the library build, which renames
 * identifiers (`import { z as e }`, `function gn(…)`): zod 4 hands each class
 * name to its constructor factory as a STRING (`"$ZodType"`), and three.js
 * registers itself under the global `__THREE__`. Matched with comments removed,
 * strings kept.
 */
const PEER_SIGNS: readonly { readonly pattern: RegExp; readonly problem: string }[] = [
  { pattern: /["'`]\$ZodType["'`]/, problem: 'bundles zod' },
  { pattern: /\b__THREE__\b/, problem: 'bundles three.js' },
];

/** `source` without its comments; strings stay, they carry zod's sign. */
function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** The defects of one emitted file: bundled peer code. Imports of a peer are fine. Pure. */
export function bundledPeerDefects(file: string, source: string): EntryDefect[] {
  const code = withoutComments(source);
  return PEER_SIGNS.filter((sign) => sign.pattern.test(code)).map((sign) => ({ file, problem: sign.problem }));
}

/** The bare package specifiers `source` imports or re-exports. Pure. */
export function peerImports(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/\b(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']([^"'./][^"']*)["']/g)) found.add(match[1]!);
  return [...found];
}

/** The consumer fixture: a tool's own file, importing both entries by package name. */
export const CONSUMER_SOURCE = `import * as playerSchema from '@jeex-org/jeex-viewer/schema';
import {
  CATALOGUE_ID_BY_SLUG,
  CATALOGUE_REGISTRIES,
  ROOM_PURPOSES,
  parseProjectManifest,
  projectLibraryOf,
  projectManifestIssues,
  registriesFromLibrary,
  validateScene,
  type BakedProjectManifest,
  type SceneData,
  type SceneRegistries,
} from '@jeex-org/jeex-viewer/schema';
import {
  BAKE_LIGHTS_RECIPE,
  BAKE_SKY_HEMISPHERE_RECIPE,
  SHIPPED_BANK,
  SHIPPED_FINISHES,
  bakeLights,
  exportShellForBake,
  judgeShellGltf,
  shellGltfSchema,
  type BakeLights,
  type ShellExport,
} from '@jeex-org/jeex-viewer/lightmap';

export async function check(manifestJson: unknown, sceneJson: unknown, mintId: () => string): Promise<string> {
  const issues = projectManifestIssues(manifestJson);
  if (issues.length > 0) return 'refused';
  const manifest: BakedProjectManifest = parseProjectManifest(manifestJson);
  const registries: SceneRegistries = registriesFromLibrary(projectLibraryOf(manifest), CATALOGUE_REGISTRIES);
  const scene: SceneData = validateScene(sceneJson, registries, { warn: () => {}, error: () => {} });
  const limits = [playerSchema.MAX_PROJECT_TEXTURE_BYTES, playerSchema.MAX_PROJECT_TEXTURE_FILES, playerSchema.MAX_TEXTURE_FILE_BYTES];
  const lamps = [playerSchema.LAMP_MAX_LUMENS, playerSchema.LAMP_MAX_CUTOFF, playerSchema.LAMP_MAX_LIGHTS];
  const oak: string | undefined = CATALOGUE_ID_BY_SLUG.finish['oak'];
  const purposes: readonly string[] = ROOM_PURPOSES;
  const lights: BakeLights = bakeLights(scene, SHIPPED_BANK);
  const shell: ShellExport = await exportShellForBake(scene, { mintId, finishes: SHIPPED_FINISHES });
  const verdict = judgeShellGltf({});
  const schemaKnown = shellGltfSchema !== undefined;
  return [lights.recipe === BAKE_LIGHTS_RECIPE, BAKE_SKY_HEMISPHERE_RECIPE, shell.glb.byteLength, verdict.ok, schemaKnown, oak, purposes.length, ...limits, ...lamps].join(',');
}
`;

/** The consumer's compiler settings: a strict tool project resolving packages by their `exports`. */
const CONSUMER_TSCONFIG = {
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
  const scratch = join(dir, '.package-consumer');
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

/** The defects of the two entries' file graphs in `dir`. */
function artefactDefects(dir: string): EntryDefect[] {
  const defects: EntryDefect[] = [];
  for (const entry of [SCHEMA_ENTRY, LIGHTMAP_ENTRY]) {
    for (const file of entryGraph(dir, entry)) {
      const source = readFileSync(join(dir, file), 'utf8');
      defects.push(...bundledPeerDefects(file, source));
      if (entry !== SCHEMA_ENTRY) continue;
      for (const peer of peerImports(source))
        if (peer !== 'zod' && !peer.startsWith('zod/')) defects.push({ file, problem: `imports ${peer}; the entry may import Zod only` });
    }
  }
  // Teeth: the signs fire where a peer IS bundled, or the empty result above proves nothing.
  const ops = readFileSync(join(dir, 'jeex-viewer-ops.js'), 'utf8');
  if (!bundledPeerDefects('ops', ops).some((defect) => defect.problem === 'bundles zod'))
    defects.push({ file: 'jeex-viewer-ops.js', problem: 'bundles Zod, yet the zod sign does not fire: update PEER_SIGNS' });
  const core = readdirSync(dir).find((name) => /^jeex-viewer-three\.core-.*\.js$/.test(name));
  if (!core || !bundledPeerDefects(core, readFileSync(join(dir, core), 'utf8')).some((defect) => defect.problem === 'bundles three.js'))
    defects.push({
      file: core ?? '(three.js core chunk)',
      problem: 'bundles three.js, yet the three sign does not fire: update PEER_SIGNS',
    });
  const lightmapPeers = entryGraph(dir, LIGHTMAP_ENTRY).flatMap((file) => peerImports(readFileSync(join(dir, file), 'utf8')));
  if (!lightmapPeers.includes('three'))
    defects.push({ file: LIGHTMAP_ENTRY, problem: 'imports no three: the peer is not left to the consumer' });
  return defects;
}

/** Loads both built entries the way a tool would and runs one real call through each. */
async function runDefects(dir: string): Promise<EntryDefect[]> {
  const scene: unknown = JSON.parse(readFileSync(join(dir, DEMO_SCENE_FILE), 'utf8'));
  const schema = (await import(resolve(dir, SCHEMA_ENTRY))) as typeof import('../src/embed/schema.ts');
  const lightmap = (await import(resolve(dir, LIGHTMAP_ENTRY))) as typeof import('../src/embed/lightmap.ts');
  const defects: EntryDefect[] = [];
  try {
    const validated = schema.validateScene(scene, schema.CATALOGUE_REGISTRIES, { warn: () => {}, error: () => {} });
    if (lightmap.bakeLights(validated, lightmap.SHIPPED_BANK).recipe !== lightmap.BAKE_LIGHTS_RECIPE)
      defects.push({ file: LIGHTMAP_ENTRY, problem: 'bakeLights answered under another recipe' });
  } catch (error) {
    defects.push({
      file: SCHEMA_ENTRY,
      problem: `the demo scene does not run through the entries: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return defects;
}

// Run as a script, not when imported by a test.
if (import.meta.main) {
  const dir = process.argv[2] ?? 'dist-lib';
  for (const file of [SCHEMA_ENTRY, LIGHTMAP_ENTRY, DEMO_SCENE_FILE]) {
    if (!existsSync(join(dir, file))) {
      console.error(`package-entry-check: ${join(dir, file)} is missing; run the schema and lightmap passes and demo-scene-gen first`);
      process.exit(1);
    }
  }
  const defects = [...artefactDefects(dir), ...(await runDefects(dir))];
  for (const defect of defects) console.error(`package-entry-check: ${defect.file}: ${defect.problem}`);
  const consumer = typecheckConsumer(dir);
  if (consumer) console.error(`package-entry-check: the consumer fixture does not typecheck against the declarations:\n${consumer}`);
  if (defects.length > 0 || consumer) process.exit(1);
  console.log(
    'package-entry-check: jeex-viewer/schema and jeex-viewer/lightmap leave their peers to the consumer, run, and type for a consumer',
  );
}
