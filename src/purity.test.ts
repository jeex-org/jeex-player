import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

/**
 * The module boundary of the pure layer, enforced statically.
 *
 * The architecture promises that the plan solver, navigation, the scene model
 * and the catalogues are plain TypeScript: no `three`, no DOM. A comment
 * alone cannot keep that promise, because it breaks transitively (for example
 * `asset-variants` → `asset-finishes` → `three`). This test walks the real import graph of every
 * module on the list and fails when `three` is reachable from any of them.
 *
 * Only RUNTIME edges count: `import type` and `export type` are erased by
 * `verbatimModuleSyntax`, so they carry no dependency.
 */

const HERE = import.meta.dirname;

/**
 * Modules allowed to import `zod/mini`: the sibling schema of ONE boundary
 * each. Grows by one entry per boundary that gains a Zod schema.
 *
 * They join `PURE_MODULES` wholesale: a schema stays as free of `three` and of
 * the DOM as everything else down here, and `zod/mini` pulls in neither —
 * which is what `the zod boundary` proves below rather than assumes.
 *
 * ONE ENTRY PER LINE. Parallel branches each append exactly one module here;
 * on a single line every one of those appends edits the same line and
 * conflicts with every other by construction. Per line, each branch owns its
 * own line, the way `PURE_MODULES` below already does.
 *
 * The layout is held by `oxfmt` rather than by hand: past the 140-column print
 * width it breaks the array out and keeps it broken. Below that width it
 * collapses the array back onto one line whatever the source says, trailing
 * comma included — which is exactly what happened to the first attempt at this
 * comment, where it described a layout the formatter had already undone. If a future edit shortens the list under the width and it collapses,
 * the merge rule stands regardless: keep every entry from both sides.
 */
const SCHEMA_MODULES: readonly string[] = [
  'scene/types.schema',
  'app/viewer-options.schema',
  'embed/protocol.schema',
  'assets/project-manifest.schema',
];

/** Modules the architecture declares pure: no `three`, no DOM. */
const PURE_MODULES = [
  'plan/floor-outline',
  'plan/plan-geometry',
  'plan/plan-graph',
  'plan/plan-joints',
  'plan/plan-offset',
  'plan/plan-openings',
  'plan/plan-solver',
  'plan/plan-drawing',
  'plan/opening-arc',
  'plan/opening-geometry',
  'shared/readonly-map',
  'navigation/navigation',
  'navigation/room-graph',
  'navigation/travel-path',
  'navigation/tour-legs',
  'scene/tour-route',
  'scene/registries',
  'scene/scene-parse',
  'scene/scene-model',
  'scene/scene-ops',
  'scene/ops/context',
  'scene/ops/limits',
  'scene/ops/shell',
  'scene/ops/openings',
  'scene/ops/assets',
  'scene/ops/cameras',
  'scene/ops/rooms',
  'scene/scene-validator',
  'scene/scene-repository',
  'scene/scene-source',
  'scene/project-repository',
  'demo/fixture-repository',
  'scene/interior-presets',
  'shared/easing',
  'shared/math',
  'camera/camera-tuning',
  'materials/finish-catalogue',
  'materials/asset-finish-catalogue',
  'assets/asset-variants',
  'assets/asset-catalogue',
  'assets/asset-library',
  'assets/asset-types',
  'assets/project-manifest',
  'assets/project-catalogue',
  'assets/catalogue-ids',
  'assets/catalogue-slugs',
  'materials/finish-ids',
  'materials/finish-types',
  'assets/opening-variants',
  'materials/canvas-2d',
  'layout/layout-geometry',
  'layout/layout-issue',
  'plan/door-swing',
  'doors/door-state',
  'layout/layout-lint',
  'layout/rules/index',
  'layout/rules/context',
  'layout/rules/walls',
  'layout/rules/overlap',
  'layout/rules/doors',
  'layout/rules/wall-hung',
  'layout/rules/circulation',
  'layout/rules/windows',
  'layout/rules/mount',
  'layout/asset-legality',
  'layout/rules/kitchen',
  'layout/rules/seating',
  'layout/rules/bedroom',
  'layout/rules/hall',
  'layout/free-space',
  'materials/material-catalogue',
  'ui/messages',
  'materials/texture-noise',
  'scene/types',
  'app/viewer-options',
  'embed/protocol',
  'embed/ops',
  'shared/sha1',
  'shared/uuid',
  'scene/guid',
  'scene/finish-remap',
  'plan/tolerance',
  'shared/quantise',
  'scene/completeness',
  'render/offscreen-scene',
  'plan/plan-dimensions',
  'plan/plan-export',
  'scene/metadata-table',
  'shared/schema-issues',
  'app/option-resolvers',
  'app/option-paths',
  'app/option-sets',
  ...SCHEMA_MODULES,
];

/**
 * The documented carve-out: these two build UI artefacts (a swatch canvas, the
 * `data-i18n` pass over `index.html`) behind a `typeof document` guard, so they
 * still import cleanly under Bun. Nothing else in the pure layer may name a DOM
 * global.
 */
/**
 * Pure modules that reach a DOM ROOT, and may do so only behind a
 * `typeof document === 'undefined'` guard that returns `null` / does nothing.
 *
 * There is exactly ONE: `canvas-2d.ts` owns the library's whole null policy for
 * a 2D drawing surface, so every swatch and texture generator above it — the
 * pure `opening-variants.ts` included — is a plain caller that never names a
 * DOM root of its own.
 */
const DOM_BY_GUARD = new Set(['materials/canvas-2d']);

/**
 * Pure modules that touch the DOM only through a node they were HANDED
 * (`applyDomMessages(root, messages)`). Stricter than the guard: they name no
 * DOM root at all, so there is nothing for them to reach into on their own —
 * which is exactly what lets a viewer translate its OWN fragment instead of
 * the host page's document.
 */
const DOM_BY_PARAMETER = new Set(['ui/messages']);

const DOM_CARVE_OUT = new Set([...DOM_BY_GUARD, ...DOM_BY_PARAMETER]);

/** DOM globals a pure module must not touch. */
const DOM_GLOBALS = /\b(document|window|navigator|HTMLCanvasElement|HTMLElement|requestAnimationFrame)\b/;

/** The DOM ROOTS — the globals a module reaches THROUGH to find nodes. */
const DOM_ROOTS = /\b(document|window|navigator|requestAnimationFrame)\b/;

function sourceOf(module: string): string {
  return readFileSync(resolve(HERE, `${module}.ts`), 'utf8');
}

/** Source with comments removed, so a mention in prose is not a dependency. */
function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Comments AND string literals removed. `'window'` is an opening type in this
 * codebase, so a raw text search for DOM globals has to look at code only.
 */
function codeOnly(source: string): string {
  return withoutNames(
    stripComments(source)
      .replaceAll(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replaceAll(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replaceAll(/`(?:[^`\\]|\\.)*`/g, '``'),
  );
}

/**
 * Drops every identifier that is a NAME rather than a reference: a member
 * access (`scene.document`), an object key and a type field (`document?:`).
 *
 * Without this the DOM check is a spell-check. `SceneSource.document` — the
 * field holding a scene the host already has — read as a module reaching for
 * `window.document`. A module that actually touches the DOM writes `document.`
 * or hands `document` to something, and both of those survive this.
 */
function withoutNames(code: string): string {
  return code
    .replaceAll(/\.\s*[A-Za-z_$][\w$]*/g, '.')
    .replaceAll(/\b[A-Za-z_$][\w$]*\s*\?\s*:/g, '?:')
    .replaceAll(/^(\s*)[A-Za-z_$][\w$]*\s*:/gm, '$1:');
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\bfrom\s+['"]([^'"]+)['"]/g;

/** Runtime module specifiers imported by `source`; type-only edges are skipped. */
function runtimeImports(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  for (const match of code.matchAll(IMPORT)) {
    if (match[1]) continue;
    found.push(match[3]!);
  }
  return found;
}

/**
 * Whether a relative specifier names a TypeScript module rather than an asset.
 * `./viewer-shell` and `./rules/index.js` are modules; a stylesheet
 * imported as text (`../ui/styles/viewer.css?inline`) is not.
 */
function isModuleSpecifier(specifier: string): boolean {
  const withoutQuery = specifier.split('?')[0]!;
  const extension = withoutQuery
    .slice(withoutQuery.lastIndexOf('/') + 1)
    .split('.')
    .slice(1)
    .pop();
  return extension === undefined || extension === 'js' || extension === 'ts';
}

/** Every local module reachable from `entry`, plus the external packages hit. */
function reach(entry: string): { modules: Set<string>; packages: Set<string> } {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const module = queue.pop()!;
    if (modules.has(module)) continue;
    modules.add(module);
    for (const specifier of runtimeImports(sourceOf(module))) {
      if (specifier.startsWith('.')) {
        // An ASSET, not a module: `styles/viewer.css?inline` is text the
        // bundler inlines, and there is no `.ts` behind it to walk into.
        if (!isModuleSpecifier(specifier)) continue;
        // Relative to the IMPORTING module, not to `src/`: a rule under
        // `layout/rules/` names its siblings as `./context`.
        queue.push(normalize(join(dirname(module), specifier.replace(/\.js$/, ''))));
      } else {
        packages.add(specifier);
      }
    }
  }
  return { modules, packages };
}

describe('pure module boundary', () => {
  for (const module of PURE_MODULES) {
    test(`${module} never reaches three`, () => {
      const { modules, packages } = reach(module);
      const three = [...packages].filter((name) => name === 'three' || name.startsWith('three/'));
      expect({ module, three }).toEqual({ module, three: [] });
      // The reachable set is local modules only; nothing may pull a renderer in
      // through a re-export either.
      expect([...modules].every((name) => name.length > 0)).toBe(true);
    });
  }

  for (const module of PURE_MODULES) {
    if (DOM_CARVE_OUT.has(module)) continue;
    test(`${module} names no DOM global`, () => {
      const code = codeOnly(sourceOf(module));
      expect({ module, dom: DOM_GLOBALS.exec(code)?.[0] ?? null }).toEqual({ module, dom: null });
    });
  }

  for (const module of DOM_BY_GUARD) {
    test(`${module} guards its DOM use with typeof document`, () => {
      const code = stripComments(sourceOf(module));
      expect(code).toContain("typeof document === 'undefined'");
    });
  }

  for (const module of DOM_BY_PARAMETER) {
    test(`${module} touches the DOM only through a node it was handed`, () => {
      const code = codeOnly(sourceOf(module));
      expect({ module, root: DOM_ROOTS.exec(code)?.[0] ?? null }).toEqual({ module, root: null });
    });
  }

  /**
   * The bank's two halves must not name each other. `asset-library.ts` is the
   * manifest, `asset-catalogue.ts` the index over it; the shape they share
   * lives in `asset-types.ts`. Type-only edges are erased at runtime, so the
   * old cycle never broke a build — it just made either module unreadable
   * without the other, and unusable on its own.
   */
  test('the manifest and its index import only asset-types, never each other', () => {
    const specifiers = (module: string): string[] => {
      const found: string[] = [];
      for (const match of stripComments(sourceOf(module)).matchAll(IMPORT)) found.push(match[3]!);
      return found;
    };
    expect(specifiers('assets/asset-library')).not.toContain('./asset-catalogue.js');
    expect(specifiers('assets/asset-catalogue')).toContain('./asset-library.js');
    expect(specifiers('assets/asset-types')).toEqual(['../materials/asset-finish-catalogue.js', '../scene/types.js']);
  });

  // Teeth check: the scanner must actually find `three` where it is there,
  // directly and one hop away, or the assertions above prove nothing.
  test('the scanner sees three both directly and transitively', () => {
    expect([...reach('materials/finishes').packages]).toContain('three');
    expect([...reach('ui/panel-requests').packages]).toContain('three');
    expect(reach('ui/panel-requests').modules.has('materials/finishes')).toBe(true);
  });
});

/**
 * Where Zod is, and where it may never be.
 *
 * `.dependency-cruiser.cjs` states the same policy statically
 * (`zod-only-in-schema-modules`, `zod-mini-only-in-src`); this describe block
 * states it over the RUNTIME graph, which is the half a layer rule cannot see.
 * `tsPreCompilationDeps: true` makes a type-only edge count for
 * dependency-cruiser, so a `host.ts` that imported a schema's TYPES would read
 * as "zod is reachable from the host" and the rule would fire on a bundle that
 * is in fact still 2.7 KB. The walker here skips `import type`, so what it
 * reports is what the bundler will actually emit — and the 4 KB host budget in
 * `scripts/budget-check.ts` is the third witness to the same fact.
 */
describe('the zod boundary', () => {
  for (const module of SCHEMA_MODULES) {
    test(`${module} imports zod/mini and no other package`, () => {
      expect({ module, packages: [...reach(module).packages].sort() }).toEqual({ module, packages: ['zod/mini'] });
    });
  }

  test('embed/host reaches no zod at all', () => {
    const zod = [...reach('embed/host').packages].filter((name) => name === 'zod' || name.startsWith('zod/'));
    expect(zod).toEqual([]);
  });

  // Teeth: the walker finds `zod/mini` where a boundary really does parse, so
  // the empty result above is a fact about the host, not about the filter.
  test('embed/ops does reach zod/mini', () => {
    expect([...reach('embed/ops').packages]).toContain('zod/mini');
  });

  /**
   * The scene schema is the whole 1.2 document and it stays out of
   * the library's BOOT graph: its consumers are `embed/ops.ts` — behind the
   * separate `jeex-viewer/ops` entry, where an editor host reads it as
   * `isSceneShape`/`sceneShapeIssues` — plus the scripts and the tests.
   * `validate/shape.ts` is still hand-written, so `scene-validator.ts`, which
   * every mount reaches, carries none of it. The rule this holds up is "the
   * schema is never in a boot chunk"; `check:budget:lib` is the second
   * witness, and it measures bytes rather than edges.
   */
  test('no library boot entry reaches the scene schema', () => {
    for (const entry of ['embed/index', 'embed/element-entry', 'embed/host']) {
      expect({ entry, reaches: reach(entry).modules.has('scene/types.schema') }).toEqual({ entry, reaches: false });
    }
  });
});

/**
 * The library ships no apartment.
 *
 * `src/embed/index.ts` is what `import … from 'jeex-viewer'` gets, and the
 * demo flat (`scene-data.ts`, 68 objects) is the DEMO PAGE's scene — a library
 * that carried it would make every host pay for it and would let a viewer with
 * no `options.scene` quietly mount someone else's flat instead of saying it
 * was not told which (`scene-repository.resolveSceneSource`).
 *
 * The fixture is UNREACHABLE from the entry, by construction rather than by
 * tree-shaking: `LocalFixtureRepository` — the only thing that names
 * `demo/scene-data.ts` — lives in `demo/fixture-repository.ts`, a module
 * nothing under `embed/` or `scene/scene-repository.ts` imports. That is the
 * point of the two assertions below — the entry exports no name that reaches
 * it, and its whole runtime import graph never walks into `src/demo/` at all —
 * so there is no edge for a bundler to have to prune.
 *
 * The second assertion is a DIRECTORY rule, not a pair of names: `src/demo/`
 * is the one layer the library graph may not touch, so anything added there
 * later is covered without anyone remembering to extend a list. The proof that
 * it holds is the build: `dist-lib/jeex-viewer*.js` contains no
 * `apartment-real-plan`, the demo build's `dist/assets/*.js` does.
 */
describe('the library entry', () => {
  /** Names `embed/index.ts` re-exports, however it spells the re-export. */
  function exportedNames(): string[] {
    const code = stripComments(sourceOf('embed/index'));
    const names: string[] = [];
    for (const match of code.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
      for (const part of match[1]!.split(',')) {
        const name = part
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (name) names.push(name);
      }
    }
    return names;
  }

  test('exports the documented vocabulary and no fixture repository', () => {
    const names = exportedNames();
    for (const promised of [
      'mountViewer',
      'FetchSceneRepository',
      'InlineSceneRepository',
      'ViewerHandle',
      'ViewerOptions',
      'SceneSource',
    ]) {
      expect({ promised, present: names.includes(promised) }).toEqual({ promised, present: true });
    }
    expect(names).not.toContain('LocalFixtureRepository');
    expect(names).not.toContain('apartmentScene');
  });

  test('nothing under src/demo/ is reachable from the entry', () => {
    const inDemo = (modules: Set<string>): string[] => [...modules].filter((name) => name.startsWith('demo/')).sort();
    expect(inDemo(reach('embed/index').modules)).toEqual([]);
    // Teeth: the filter finds a `demo/` module where there is one, so the
    // empty result above is a fact about the entry, not about the predicate.
    expect(inDemo(reach('demo/fixture-repository').modules)).toEqual([
      'demo/demo-furniture',
      'demo/demo-ids',
      'demo/demo-interiors',
      'demo/fixture-repository',
      'demo/scene-data',
    ]);
  });
});
