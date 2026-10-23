# Design

## Context

See proposal.md (Why). The element used to mount in `connectedCallback`, statically importing the composition root (`mountViewerAs`), so the element entry's static graph was the whole viewer and three.js. `ViewerApp.init()` probed WebGL on a throwaway canvas, then the renderer made a second context; the procedural textures were painted synchronously inside `mountDocument`, and their noise tiles (fbm over 256-512 px) were most of that work.

## Goals / Non-Goals

Goals: the deferral, the handle before the start, one context per viewer, the noise tiles off the build's long task, the eager-graph budget (specs `embed-element-start`, `viewer-boot-cost`).

Non-goals: the first frame's shader compile, the lighting and post-processing modules, a poster image, the delivery host's compression, painters beyond their noise tiles, the IIFE's single-file download.

## Decisions

1. **Three element modules plus a lazy runtime.** `element-attributes.ts` (names, option reading, the default box), `element-controller.ts` (behaviour, DOM through `ElementHost`), `element.ts` (the `HTMLElement` adapter and the public types). The controller reaches the viewer only through `import('./element-runtime.js')`, a module that wraps `mountViewerAs` and adopts the component sheet into the shadow root. The import promise is shared by every element on the page and forgotten when it fails, so a reconnect retries. Alternative: one module with an `import()` inside: rejected, the file exceeded the repository's size limit and mixed the adapter with the behaviour.
2. **The option reader stays in the shell.** It is 34 KB of the 39 KB gzip eager total, and it lets the pre-start handle answer `options`, `getMode` and `getLocale` from the one resolver instead of an approximation. Alternative: a literal attribute list with a drift test and approximated pre-start answers, about 5 KB eager: a follow-up if the 34 KB matter.
3. **A stand-in handle (`PendingViewer`) that implements `ViewerHandle`.** Subscriptions carry over at the attach so the boot's own `scene` and `ready` reach them; queries go to the running viewer from its first `scene` event; commands queue until its first `ready` EVENT and are replayed inside it, ahead of the element's own `jeex-ready` (the stand-in subscribes first). Not at the attach, because a real handle drops a `setMode` or `setSelection` that arrives before its camera stack exists and the opening view would overwrite a mode; not on the `ready` promise, because a host's `jeex-ready` listener runs before it settles. A failed boot replays nothing, so a queued `loadScene` cannot build a scene without a stage; the queue waits for a Retry that reaches `ready`. `slots.get` and `element` cannot be honoured before the viewer exists: documented exceptions. Alternative: `viewer` null until the start: rejected, it breaks `el.viewer.ready` right after `append`.
4. **One shared `IntersectionObserver`, margin `100px 0px`, plus `pointerdown` and `focusin`.** A small margin because a phone boot takes a second or more after the start whatever the margin, and a wide one would start the measured below-the-fold players at load. The interaction triggers matter for host content in a light-DOM element. Constants, not options: no new attribute.
5. **The probe on the viewer's canvas.** `hasWebGL(canvas)` asks the viewer's own canvas for `webgl2` with `RENDERER_CONTEXT_ATTRIBUTES` (three r186 always requests `alpha: true`; `antialias` and `powerPreference` come from the default renderer) and keeps the context; three's `getContext` then returns it. A component test compares the probed renderer's context attributes with a fresh canvas's, which fails if the default renderer's arguments change without the constant. The probe lives in `webgl-probe.ts`, out of `render-runtime.ts`, which keeps only the removal of the old probe.
6. **Noise tiles as named specs, prewarmed during the document load.** `noise-tiles.ts` holds each tile's key, size and field; painters call `noiseTile(spec)`. `prewarmNoiseTiles` fills an `ImageData` in steps of 8 rows, yields when an 8 ms slice is spent (`scheduler.yield`, else a `MessageChannel` message, not `setTimeout`, which clamps nested calls), puts the tile in the cache only when complete, and returns when its signal aborts. `loadWithNoiseTiles` runs it beside `documents.boot()` and both are awaited before the build. The set is the closed list of finish-independent tiles (`COMMON_NOISE_TILES`, the per-seed weave slubs excluded). Alternative: per-kind declarations and enumerating the document's finishes: more code for a subset whose only failure is a tile drawn on demand.
7. **An eager-graph budget.** `budget-check.ts` walks the static imports from `jeex-viewer-element.js`, sums their gzip size against the measured size plus 1 KB, and fails by name on a `jeex-viewer-three.*` chunk.

## Risks / Trade-offs

1. [A hidden element (`display: none`) never starts, so it never fires `jeex-ready`] → documented; a host rule that hides the element until `:state(ready)` would never show it.
2. [Inside a cross-origin frame the observer ignores its margin] → the viewer starts when its box itself becomes visible; documented.
3. [The prewarm draws tiles a scene may not need: up to about 6 MB of canvas while a viewer lives] → bounded, freed with the last viewer (the prewarm holds the cache until its viewer is disposed); drawn while the main thread waits for the document.
4. [The probe's context exists before three adds its `webglcontextlost` listener, for the length of the document fetch] → a GPU reset in that window is not heard; very unlikely, not handled (no speculative robustness).
5. [A first viewer whose boot fails before the build keeps its probed context until garbage collection] → one of about sixteen context slots, until the canvas is collected; not handled.
6. [The IIFE bundle cannot split code] → it starts deferred but still downloads and parses the whole viewer; hosts that care about load cost use the ES element.

8. **`init()` one microtask after `mountViewer` returns.** A failure `init()` reports before its first await (no WebGL 2) used to be emitted inside `mountViewer`, before any caller could subscribe; the element's controller and a host's `error` listener now hear it. A dispose in that microtask rejects `ready` as `disposed`.
9. **The prewarm holds the texture cache.** The tiles enter the shared cache before the renderer retains it, so `loadWithNoiseTiles` retains it too and releases on the viewer's dispose.

## Migration Plan

None: no option, attribute or event changes. A host that read `viewer` and expected a live scene right after `append` gets a handle that queues until the start, which is the behaviour a slow boot already had.
