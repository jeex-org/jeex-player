# Design

## Context

The browser levels run on demand on hosted runners: 4 vCPUs, no GPU, Chromium on SwiftShader. The editing modes redraw every frame today, so a page with a mounted viewer runs at about one frame per second there and its main thread is busy most of the time. Playwright's pointer actions and protocol calls queue behind those frames.

## Decisions

### One predicate for "screenshots are local"

`tests/e2e/snapshot-policy.ts` exports `SCREENSHOTS_IGNORED` (true when `CI` is set). `playwright.config.ts` sets `ignoreSnapshots` from it, and `screenshotOnly()` in `support.ts` calls `test.skip(SCREENSHOTS_IGNORED, reason)`. The helper is the first statement of a test body, so the test's own setup (hovers, idle waits, camera waits) never runs on CI. A `beforeEach` that boots the page still runs; those boots pass on the runner today.

Which tests are screenshot-only: those whose every other step only prepares the picture (hover, idle wait, camera wait, held frames). Tests with an assertion CI checks keep running and are listed in the guard with what they check: the plan2d drawing (`data-visible`), the Trusted Types page (errors, counts, style sheets) and the context-loss restore (the restored state before its canvas picture). The guard is a bun test that splits each spec at its `test(` calls, so it costs no browser. A test takes a screenshot when it calls `expectChromeScreenshot`, `expectCanvasScreenshot`, `expectCanvasStillRendering` or `toHaveScreenshot`; a raw `.screenshot()` compared in the test itself (the host-css spec) is not affected by `ignoreSnapshots` and stays out. The guard also fails on a marked test with no screenshot, on a helper that is not the first statement, and on a listed test that is gone or takes no screenshot.

### Keyboard path through the reveal control

The bar collapses 4.2 s after its last wake and becomes `inert`. A focus inside the viewer root wakes it with `force`, which arms no idle timer until a panel attached to the bar closes (closing calls an unforced wake, which arms the timer again). Focusing the reveal control is therefore what wakes the bar; pressing Enter on it is the user's action and is kept. The specs wait for `data-collapsed="true"` (the existing `waitForChromeIdle`), focus the reveal control and press Enter, assert `data-collapsed="false"`, then focus the settings button and assert it focused. After Escape the specs assert the focus back on the button at once, well inside the re-armed 4.2 s. Every machine now takes the same path, so the test is deterministic and covers how a keyboard user reaches a collapsed bar. The geometry check of the start-side spec runs after the wake, on the open bar.

### The sheet's resting rect

The rect is read once after the sheet opens. Left, right and bottom are fixed by the layout (insets of 10 px, the bottom edge 10 px above the viewer's) and stay literals; the top edge is the bottom minus the sheet's content height and is compared to the first reading. The test keeps asserting that the sheet lifts 8 px clear of the filled box and comes back to exactly where it was.

### The cost table

Rewritten from the per-file durations printed by workflow run 40102002308 of 2026-10-24 on main (one Vitest worker per shard, SwiftShader): 65 of 66 files, 4,931 s in all. `export-library.test.ts` was added after that run and keeps its previous value. Files that failed carry their failing time, timeouts included: that is what they cost on the runner today, and the balance must hold for the run as it is. `viewer-api.test.ts` alone costs 664 s, which no shard count can split; whether it needs splitting is decided after the editing modes draw on demand.

## Risks

1. The guard's split at `test(` is textual, and a local wrapper around a screenshot call (such as a spec's own `shot()`) is invisible to it. A test written through another wrapper would escape it; the guard also fails if it finds no screenshot test at all, so a broken split cannot pass silently.
2. Skipping on CI removes setup steps that exercised pointer hovers. Those hovers are covered by the local gate, where the screenshots compare.

3. A focus inside the bar when the idle timer collapses it makes the bar `inert` with the focus inside. That is product behaviour, noted for a later change, not touched here.

## Not in this change

The axe scan over two viewers, the plan2d heartbeat count, the motion and first-frame component tests: they wait on the editing modes drawing on demand and on the heartbeat timestamp fix, and the workflow stays red on them until then.
