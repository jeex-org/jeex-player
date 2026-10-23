# Tasks

## 1. One WebGL context per viewer

- [x] 1.1 `hasWebGL(canvas)` takes a WebGL 2 context on the viewer's own canvas with `RENDERER_CONTEXT_ATTRIBUTES`, keeps it and memoises the answer; `ViewerApp.init()` passes `roots.canvas`; the probe lives in `src/render/webgl-probe.ts`, moved out of `render-runtime.ts`. Verify: `bun test src/render/webgl-probe.test.ts` (one request, on the first canvas, with those attributes, no `loseContext`).
- [x] 1.2 Component test on a real context: the default renderer on the probed canvas runs on the probe's context with the attributes it gets on a fresh canvas. Verify: `tests/component/webgl-probe.test.ts` passes.

## 2. The element's deferred start

- [x] 2.1 Split the element into `element-attributes.ts`, `element-controller.ts` and `element.ts`, with the viewer behind `element-runtime.ts` reached by a shared, retryable `import()`. Verify: `bash scripts/check.sh fast` (size check, arch, dead code) and the library build list a `lazy-jeex-viewer-element-runtime-*` chunk.
- [x] 2.2 `watchStart`: one shared `IntersectionObserver` (`100px 0px`), `pointerdown` and `focusin`, start at once without `IntersectionObserver`, cancel on disconnect. Verify: the component tests «a below-the-fold element keeps its box ...» and «a press on a below-the-fold element starts it».
- [x] 2.3 `PendingViewer`: queue until the first boot settles, pre-start answers, `not-ready` rejections, carried subscriptions, one `ready` per connection, `disposed` on an early disconnect, no start from a call. Verify: `bun test src/embed/element.test.ts` («the start», «the runtime import») and the component test «commands given before the start are applied once it runs».
- [x] 2.4 A failed runtime import: `jeex-error` with `internal`, `:state(error)`, a log entry, `ready` rejects. Verify: the bun test «a runtime that cannot be loaded ...».
- [x] 2.5 The element-entry budget in `budget-check.ts` (static graph, measured plus 1 KB, no three.js). Verify: `bun test scripts/budget-check.test.ts` and `bun run check:budget:lib`.
- [x] 2.6 E2E of the built element below the fold: no runtime chunk, no three.js, no context before the scroll; one context and no extra layout shift after it. Verify: `JEEX_E2E_BUILT=1 bunx playwright test --project=built tests/built/embed-below-fold.spec.ts`.
- [x] 2.7 Existing tests that create an element below the page's own player scroll it into view (`tests/e2e/embed-element.spec.ts`, the compound chrome test). Verify: the chromium e2e project passes with no baseline change.
- [x] 2.8 README («Paste into any site», «Custom element», the error table), `site/install.md` step 6 and CHANGELOG describe the deferred start, the handle before it and the WebGL 2 threshold. Verify: `bash scripts/no-docs-refs.sh` and a read of the three sections.

## 3. Noise tiles off the build's long task

- [x] 3.1 Noise tiles as named specs (`noise-tiles.ts`), `noiseTile(spec)` and the shared row loop `fillNoiseRows`; painters unchanged otherwise. Verify: `bun test src/materials`.
- [x] 3.2 `prewarmNoiseTiles` (8-row steps, 8 ms slices, `scheduler.yield` else `MessageChannel`, complete tiles only, abort) and `loadWithNoiseTiles` beside `documents.boot()`. Verify: `tests/component/texture-prewarm.test.ts` (same pixels as on demand, yields, abort, painter reuses the cache).
- [x] 3.3 No visual change. Verify: the chromium e2e project passes with every canvas and chrome baseline unchanged (`git status` shows no screenshot file touched).

## 4. Integration

- [x] 4.1 `bash scripts/check.sh fast`, `bun run check:budget` and `bun run check:budget:lib` are green; eager and lazy sizes recorded before and after.
- [x] 4.2 The component tier passes (`bun run test:component` through the heavy-run queue).
- [x] 4.3 Lighthouse mobile, median of 3, on the bare-embed page and a below-the-fold page, before and after.

## Workflow follow-up

- The repository's full gate, the review of record and the security review run before the delivery commit.
- Archive the change after those checks, then validate all specs.
