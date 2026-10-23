/**
 * Two source-hygiene gates over `src/**\/*.ts`, in one script because they ask
 * one question — is this file written the way the standards say — and neither
 * is worth its own pass over the tree.
 *
 * 1. SPELLING. British in identifiers and prose; American only where an API
 *    forces it. A census of the tree found `centre` 449 vs `center` 224, `colour` 53 vs
 *    `color` 127, `catalogue` 175 vs `catalog` 10, `metres` 245 vs `meters` 7
 *    — and the worst of it was INSIDE one data structure:
 *    `export type WallCenterline` on one line and `centrelineOf` on another,
 *    with ten consumers writing both spellings.
 *
 * 2. HEADERS. Every non-test module starts with a `/**` block stating its
 *    responsibility and its main invariant (the coding standards). A census
 *    found 18 files without one — the whole `assets/` and
 *    `materials/` layer, which is the layer the refactor had touched least.
 *
 * The allowlists are the interesting half of the spelling gate. Every entry is
 * a name the viewer does not get to choose — a three.js or DOM API, a GLSL
 * uniform, a CSS property, or a `scene.json` wire-format field — and every
 * entry carries the reason, because an allowlist without reasons becomes the
 * place a genuine misspelling goes to hide. `PENDING_FILES` is the one dated
 * list: files a pending change rewrites, which that change empties.
 *
 * The HEADER gate has no allowlist of any kind.
 *
 * Usage: `bun run scripts/spelling-check.ts [src-dir]`, from `check.sh`.
 * Exit 1 on any hit, with the file, the line and what to write instead.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** One American form the gate refuses, and what to write instead. */
export type SpellingRule = { readonly pattern: RegExp; readonly write: string };

/**
 * The forms the gate refuses.
 *
 * `center` is the interesting one: the BARE word is a `scene.json`
 * field name (`Opening.center`, with `SetOpeningOp.dcenter` beside it), so it
 * is forced everywhere and is deliberately NOT a hit — which is exactly why
 * it is recorded as a documented wart. Anything LONGER is ours to
 * spell, so the pattern asks for a letter on one side or the other:
 * `centerline`, `centers`, `WallCenterline`. The genuine API names that also
 * carry a letter (`getCenter`, `vCenterLocal`) are in `FORCED_NAMES`.
 *
 * `catalog(?!ue)` rather than `\bcatalog\b` so that `CatalogEntry` is caught
 * while `catalogue` — 175 of them in the tree — does not match itself.
 * `meters?` catches singular and plural both.
 */
export const SPELLING_RULES: readonly SpellingRule[] = [
  { pattern: /[A-Za-z]center|center[A-Za-z]/i, write: 'centre' },
  { pattern: /catalog(?!ue)/i, write: 'catalogue' },
  { pattern: /\bmeters?\b/i, write: 'metres' },
  { pattern: /\bcolor/i, write: 'colour' },
];

/** A name the viewer does not choose, and why it is American. */
export type ForcedName = { readonly name: string; readonly reason: string };

/**
 * Names the gate ignores, each with the API that forces it.
 *
 * Matched as SUBSTRINGS of the line, so a hit is excused only when the line it
 * sits on genuinely contains the forced name. `centre`-spelled code on the
 * same line as `getCenter` is therefore not accidentally excused — there is
 * nothing to excuse, because the gate only ever fires on the American form.
 */
export const FORCED_NAMES: readonly ForcedName[] = [
  // ---- three.js
  { name: 'getCenter', reason: 'three.js: Box3.getCenter, Sphere.getCenter' },
  { name: 'colorSpace', reason: 'three.js: Texture/WebGLRenderer.colorSpace' },
  { name: 'SRGBColorSpace', reason: 'three.js: THREE.SRGBColorSpace' },
  { name: 'NoColorSpace', reason: 'three.js: THREE.NoColorSpace' },
  { name: 'LinearSRGBColorSpace', reason: 'three.js: THREE.LinearSRGBColorSpace' },
  { name: 'ColorManagement', reason: 'three.js: THREE.ColorManagement' },
  { name: 'outputColorSpace', reason: 'three.js: WebGLRenderer.outputColorSpace' },
  { name: 'THREE.Color', reason: 'three.js: THREE.Color' },
  { name: "'color'", reason: 'three.js: the BufferGeometry attribute `vertexColors` reads by name' },
  { name: 'sheenColor', reason: 'three.js: MeshPhysicalMaterial.sheenColor' },
  { name: 'specularColor', reason: 'three.js: MeshPhysicalMaterial.specularColor' },
  { name: 'attenuationColor', reason: 'three.js: MeshPhysicalMaterial.attenuationColor' },
  { name: 'colorWrite', reason: 'three.js: Material.colorWrite' },
  { name: '.color', reason: 'three.js: Material.color, Light.color — set by property name' },
  { name: 'color:', reason: 'three.js material options and the scene.json wire format both spell it `color`' },
  { name: 'color?', reason: 'scene.json 1.1: MaterialDefinition.color, and the manifest `pbr.color`' },
  // ---- DOM / Canvas 2D / CSS
  { name: 'addColorStop', reason: 'DOM: CanvasGradient.addColorStop' },
  { name: 'backgroundColor', reason: 'DOM: CSSStyleDeclaration.backgroundColor' },
  { name: 'borderColor', reason: 'DOM: CSSStyleDeclaration.borderColor' },
  { name: 'color-scheme', reason: 'CSS: the `color-scheme` property' },
  { name: 'accent-color', reason: 'CSS: the `accent-color` property' },
  // ---- GLSL uniforms and varyings (the shading language is American)
  { name: 'uColor', reason: 'GLSL uniform naming, selection-glow-shader.ts' },
  { name: 'vCenter', reason: 'GLSL varying naming, selection-glow-shader.ts' },
  { name: 'aCenter', reason: 'GLSL attribute naming, selection-glow-shader.ts' },
  { name: 'uSolidCenter', reason: 'GLSL uniform naming, selection-glow-shader.ts' },
  { name: 'boxCenter', reason: 'GLSL local naming, selection-glow-shader.ts' },
  // ---- `scene.json` wire format: renaming these breaks documents
  //
  // The BARE word `center` needs no entry — it is not a hit at all, see
  // `SPELLING_RULES`. `dcenter` does, because it carries a letter.
  { name: 'dcenter', reason: 'scene operation wire format: SetOpeningOp.dcenter (documented wart)' },
];

/** A whole file the spelling gate does not read, and why. */
export type ForcedFile = { readonly file: string; readonly reason: string };

/**
 * Files whose CONTENT is not TypeScript prose, permanently.
 *
 * A per-line allowlist cannot express "this file is a shader": the American
 * spelling is the shading language's own, it appears on almost every line, and
 * excusing the names one by one would say nothing about why.
 */
export const FORCED_FILES: readonly ForcedFile[] = [
  {
    file: 'geometry/selection-glow-shader.ts',
    reason: 'GLSL source in a template literal; the shading language is American by convention (`vec3 color`, `colorspace_fragment`)',
  },
];

/**
 * Files still to be converted, dated, with the change that will do it.
 *
 * The same shape as `.dependency-cruiser.cjs`'s `KNOWN_VIOLATIONS` and for the
 * same reason: a policy that lands across two changes needs a list that
 * SHRINKS, not a gate with a silent hole.
 *
 * The list is empty: the naming policy is enforced over the whole tree with no
 * exceptions.
 */
export const PENDING_FILES: readonly ForcedFile[] = [];

export type SpellingHit = { readonly file: string; readonly line: number; readonly text: string; readonly write: string };
export type HeaderMiss = { readonly file: string };
export type HygieneReport = { readonly spelling: SpellingHit[]; readonly headers: HeaderMiss[] };

/** True when the line is excused by a forced API name. */
export function isForced(line: string): boolean {
  return FORCED_NAMES.some((forced) => line.includes(forced.name));
}

/** Every American form on one line that no forced name excuses. */
export function spellingHitsIn(text: string): Array<{ line: number; text: string; write: string }> {
  const hits: Array<{ line: number; text: string; write: string }> = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (isForced(line)) continue;
    for (const rule of SPELLING_RULES) {
      if (rule.pattern.test(line)) {
        hits.push({ line: index + 1, text: line.trim(), write: rule.write });
        break;
      }
    }
  }
  return hits;
}

/**
 * True when the file starts with a JSDoc block.
 *
 * Leading blank lines are allowed and nothing else is: a license header, an
 * import or a `//` comment above it all mean the block is not the first thing
 * a reader meets.
 */
export function hasHeader(text: string): boolean {
  return text.trimStart().startsWith('/**');
}

/** Every `.ts` under `dir`, recursively, in a stable order. */
function sources(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
    } else if (name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

/** True for a file the header gate does not apply to. */
function isTestOrDeclaration(path: string): boolean {
  return path.endsWith('.test.ts') || path.endsWith('.d.ts');
}

/** True when the whole file is excused, permanently or until the change that converts it lands. */
export function isExcusedFile(file: string): boolean {
  return [...FORCED_FILES, ...PENDING_FILES].some((entry) => entry.file === file);
}

export function checkHygiene(dir: string): HygieneReport {
  const spelling: SpellingHit[] = [];
  const headers: HeaderMiss[] = [];
  for (const path of sources(dir)) {
    const file = relative(dir, path);
    const text = readFileSync(path, 'utf8');
    if (!isExcusedFile(file)) {
      for (const hit of spellingHitsIn(text)) spelling.push({ file, line: hit.line, text: hit.text, write: hit.write });
    }
    // The HEADER gate has no exceptions: it applies to every non-test module.
    if (!isTestOrDeclaration(path) && !hasHeader(text)) headers.push({ file });
  }
  return { spelling, headers };
}

// Run as a script, not when imported by a test.
if (import.meta.main) {
  const dir = process.argv[2] ?? 'src';
  const report = checkHygiene(dir);

  for (const hit of report.spelling) {
    console.error(`  ${hit.file}:${hit.line}  write "${hit.write}"\n    ${hit.text}`);
  }
  for (const miss of report.headers) {
    console.error(`  ${miss.file}  has no /** header stating its responsibility and its invariant`);
  }

  if (report.spelling.length > 0 || report.headers.length > 0) {
    console.error(
      `Source hygiene FAILED over ${dir}: ${report.spelling.length} American spelling(s), ${report.headers.length} missing header(s).\n` +
        'An API name the viewer does not choose belongs in FORCED_NAMES with its reason, never in the source unexplained.',
    );
    process.exit(1);
  }
  console.log(`Source hygiene OK over ${dir}: British spelling, and every non-test module starts with a /** header`);
}
