/**
 * Architecture policy: cycles, orphans and the layer order of the source tree.
 *
 * A module may import its own layer or a LOWER one, never a higher one.
 * Type-only imports count: a type that only exists higher up is the same
 * coupling as a value, and `verbatimModuleSyntax` makes it visible in the
 * source anyway.
 *
 * The rules below are generated from `LAYERS` so the order lives in exactly
 * one place. Everything that is not in `LAYERS` (`demo/`, `fixtures/`, the two
 * page entries at the root of `src/`) is unranked: it is composition, not a
 * layer, and the two rules at the bottom say what may reach it.
 *
 * `bun run check:arch`.
 */

/**
 * Lowest first. `scene/types` is a layer of its own inside `scene/`: it is the
 * scene SCHEMA, which the plan solver and everything above it may read, while
 * `scene/`'s behaviour (the model, the ops, the validator) sits far higher.
 *
 * `layout/issue` is the same split inside `layout/`: `layout-issue.ts` is the
 * VOCABULARY of a layout issue (the rule names, the issue record, the linter's
 * signature), which `scene/scene-model.ts` reports for a batch
 * (`ApplyBatch.lint`), while the linter that produces one reads the object bank
 * and stays in `layout`, three layers above `scene`. The function itself is
 * injected, never imported — the same move registries make.
 *
 * `telemetry` sits right below `app`: it builds, judges and sends the
 * anonymous usage reports, and must never know the viewer's own events —
 * `app/telemetry-wiring.ts` projects those into plain calls.
 *
 * `lighting` is the lighting standard, published on its own as
 * `jeex-viewer/lighting`: it reaches nothing of the viewer, not even
 * `shared/`, so it sits at the very bottom, and `render` (which binds it to
 * the player's renderer) is far above it.
 */
const LAYERS = [
  'lighting',
  'shared',
  'scene/types',
  'plan',
  'layout/issue',
  'navigation',
  'scene',
  'materials',
  'assets',
  'layout',
  'geometry',
  'render',
  'edit',
  'camera',
  'doors',
  'ui',
  'telemetry',
  'app',
  'embed',
];

/**
 * Upward imports allowed as explicit exceptions to the layer policy. It is
 * empty, and it stays empty: the policy is enforced with no exceptions.
 *
 * Each key would be the module that reaches up; the value the set of layers
 * it may reach, and nothing else. Message keys travel as data, pure geometry
 * lives in the lowest layer that needs it (`plan/door-swing.ts`), and
 * registries are injected rather than imported, so no lower layer has a
 * reason to reach up.
 */
const KNOWN_VIOLATIONS = {};

/**
 * `^src/plan/` for a directory layer, and the two halves of `scene/` spelled
 * apart: `scene/types.ts` is its own layer near the bottom, so the `scene`
 * layer itself is everything under `scene/` EXCEPT that file.
 *
 * `scene/types.schema.ts` is the SAME layer as `scene/types.ts`: it is the
 * document schema's zod twin, and it sits next to the types because
 * `embed/ops.ts` — the `jeex-viewer/ops` entry an editor host reads it
 * through — publishes the two together. `scene/types.finishes.ts` is the
 * same layer too: the painted faces and finish values split out of
 * `scene/types.ts`, which re-exports them; so is `scene/types.site.ts`.
 */
function layerPath(layer) {
  if (layer === 'scene/types') return '^src/scene/types(\\.schema|\\.finishes|\\.site)?\\.ts$';
  if (layer === 'scene') return '^src/scene/(?!types(\\.schema|\\.finishes|\\.site)?\\.ts$)';
  if (layer === 'layout/issue') return '^src/layout/layout-issue\\.ts$';
  if (layer === 'layout') return '^src/layout/(?!layout-issue\\.ts$)';
  return `^src/${layer}/`;
}

/** Which layer a `KNOWN_VIOLATIONS` key belongs to. */
function layerOf(modulePath) {
  if (modulePath.startsWith('scene/types')) return 'scene/types';
  if (modulePath === 'layout/layout-issue.ts') return 'layout/issue';
  return modulePath.split('/')[0];
}

const escaped = (modulePath) => `^src/${modulePath.replace(/\./g, '\\.')}$`;

/** Modules of `layer` that carry an exception, whatever it is for. */
const exceptionsIn = (layer) =>
  Object.keys(KNOWN_VIOLATIONS).filter((modulePath) => layerOf(modulePath) === layer);

const forbidden = [
  {
    name: 'no-circular',
    severity: 'error',
    comment: 'A cycle between modules is a design error, not a style one: neither end can be read, tested or replaced alone.',
    from: {},
    to: { circular: true },
  },
  {
    name: 'no-orphans',
    severity: 'warn',
    comment: 'A module nothing imports and that imports nothing is either dead (knip says so) or an entry point that should be declared as one.',
    from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$', '\\.(json|md)$'] },
    to: {},
  },
];

// One rule per layer: nothing above it, tests excluded (a test may reach for a
// fixture or the demo apartment at any level — that is what a fixture is for).
for (let index = 0; index < LAYERS.length; index += 1) {
  const layer = LAYERS[index];
  const above = LAYERS.slice(index + 1);
  if (above.length === 0) continue;
  const exceptions = exceptionsIn(layer);
  forbidden.push({
    name: `layer-${layer.replace('/', '-')}`,
    severity: 'error',
    comment: `${layer} may import its own layer or a lower one, never ${above.join('/')}.`,
    from: {
      path: layerPath(layer),
      pathNot: ['\\.test\\.ts$', ...exceptions.map(escaped)],
    },
    to: { path: above.map(layerPath) },
  });
}

// And one rule per exception, so a module on the list is held to everything it
// was NOT excused from.
for (const [modulePath, allowed] of Object.entries(KNOWN_VIOLATIONS)) {
  const layer = layerOf(modulePath);
  const above = LAYERS.slice(LAYERS.indexOf(layer) + 1).filter((other) => !allowed.includes(other));
  if (above.length === 0) continue;
  forbidden.push({
    name: `layer-${layer.replace('/', '-')}`,
    severity: 'error',
    comment: `${modulePath} is on the dated known-violations list for ${allowed.join('/') || 'nothing'}; it may still not import ${above.join('/')}.`,
    from: { path: escaped(modulePath) },
    to: { path: above.map(layerPath) },
  });
}

forbidden.push(
  {
    name: 'embed-is-a-leaf',
    severity: 'error',
    comment: 'Only `main-embed.ts`, the iframe page entry, may reach into `src/embed`; everything else is a consumer of the published package.',
    from: { path: '^src/', pathNot: ['^src/embed/', '^src/main-embed\\.ts$', '\\.test\\.ts$'] },
    to: { path: '^src/embed/' },
  },
  {
    name: 'embed-carries-no-demo',
    severity: 'error',
    comment: 'The demo apartment is the sample data of this repository, not of the published library: nothing an embedding page loads may reach it.',
    from: { path: '^src/embed/', pathNot: ['\\.test\\.ts$'] },
    to: { path: '^src/demo/' },
  },
  {
    name: 'zod-only-in-schema-modules',
    severity: 'error',
    comment:
      'Zod is a BOUNDARY tool: it lives in the sibling `*.schema.ts` of the seam it guards and nowhere else. ' +
      'A module that imports it directly is either validating its own internals or about to carry 4.4 KB into a bundle that cannot pay for it (`embed/host.ts`, 4 KB gzip).',
    from: { path: '^src/', pathNot: ['\\.schema\\.ts$', '\\.test\\.ts$'] },
    to: { path: '^node_modules/zod(/|$)' },
  },
  {
    name: 'zod-mini-only-in-src',
    severity: 'error',
    comment:
      'Only the `zod/mini` subpath ships: the full method API is 22.9 KB gzip against 4.4 KB for mini, and no library entry has that to spend. ' +
      'The full `zod` is for `scripts/`, `dev/` and tests, which ship nothing.',
    from: { path: '^src/', pathNot: ['\\.test\\.ts$'] },
    to: { path: '^node_modules/zod(/|$)', pathNot: '^node_modules/zod/mini/' },
  },
);

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden,
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    // dependency-cruiser 18.2 refuses `typescript@>=7` — the compiler API it
    // needs is the one TS 7.0 does not publish yet (7.1 does). `@swc/core`
    // parses the same TypeScript and keeps `import type` in the AST, which is
    // exactly what this policy has to see, so it is the parser here.
    // Revisit when dependency-cruiser supports TS 7.
    parser: 'swc',
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)dist(-lib)?/' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'types'] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
