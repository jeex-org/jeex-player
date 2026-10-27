/**
 * Writes the demo apartment (`src/demo/scene-data.ts`) as a plain scene
 * document, `dist-lib/demo-scene.json`, published as
 * `jeex-viewer/demo-scene.json`.
 *
 * A tool that needs a real apartment to work on — a light bake, a fixture of
 * its own tests — reads the same flat the player's demo draws, as DATA: the
 * module itself stays out of the library graph (`purity.test.ts`, «nothing
 * under src/demo/ is reachable from the entry»), and a JSON file needs neither
 * the player's sources nor its build to read.
 *
 * Usage: `bun run scripts/demo-scene-gen.ts --out <dir>` (the end of `build:lib`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apartmentScene } from '../src/demo/scene-data.ts';

/** The published file name; `package.json#exports['./demo-scene.json']` points at it. */
export const DEMO_SCENE_FILE = 'demo-scene.json';

/** The demo apartment as the document text, two-space indented, with a final newline. */
export function demoSceneText(): string {
  return `${JSON.stringify(apartmentScene, null, 2)}\n`;
}

/** Writes the document into `dir`; the path written. */
export function writeDemoScene(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, DEMO_SCENE_FILE);
  writeFileSync(file, demoSceneText());
  return file;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? args[outIndex + 1] : undefined;
  if (!outDir) {
    console.error('demo-scene-gen: usage: bun scripts/demo-scene-gen.ts --out <dir>');
    process.exit(1);
  }
  console.log(`demo-scene-gen: wrote ${writeDemoScene(outDir)}`);
}
