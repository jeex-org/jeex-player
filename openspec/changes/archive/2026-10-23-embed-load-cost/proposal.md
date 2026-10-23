# Proposal

## Why

A page that pastes `<jeex-viewer>` pays for the whole player at load, wherever the player sits: about 440 kB gzip of JavaScript, a throwaway WebGL context, a second context for the renderer, and a long task of procedural noise textures before the first frame. On site pages that embed the player, Lighthouse mobile measured a total blocking time of 4.0-4.4 s and a performance score of 49-52, against 91 for the same page without it, even when the player was below the fold.

## What Changes

1. `<jeex-viewer>` builds only its box at `connectedCallback` and starts the viewer when the element nears the viewport (a fixed margin of 100 px above and below) or on the first pointer press or focus inside it; a browser without `IntersectionObserver` starts at once. The viewer's code is imported only at the start, so the element bundle's eager download is the element itself and its option reader.
2. From the connect on, `viewer` and `tour` are a handle whether or not the viewer has started. Before the start it queues commands and replays them once the viewer has booted, answers queries as a viewer before its first scene does, rejects captures and exports with `not-ready`, carries subscriptions over, and its `ready` settles with the started viewer's (or rejects `disposed` when the element leaves the document first).
3. A failed import of the viewer's code raises `jeex-error` with the existing `internal` code and puts the element in `:state(error)`.
4. The WebGL support probe takes its context on the viewer's own canvas and keeps it for the renderer: one context per viewer. A browser with only WebGL 1 now gets the "no WebGL" card.
5. The shared procedural noise tiles are drawn in short slices while the scene document loads, and the build finds them cached; the pixels of a booted viewer do not change.
6. `mountViewer` and the iframe page start at once, as before. No attribute, option or event is added.

## Capabilities

### New Capabilities

- `embed-element-start`: when the custom element starts its viewer, what it downloads and shows before that, and how its handle behaves before the start.
- `viewer-boot-cost`: how a viewer's boot spends the main thread and WebGL contexts: one context per viewer, and the procedural noise tiles off the build's long task.

### Modified Capabilities

None.

## Impact

1. Code: `src/embed/` (the element split into attributes, controller and adapter; a lazy runtime module; the start policy; the pre-start handle), `src/render/webgl-probe.ts` (the probe, moved out of `render-runtime.ts`), `src/app/viewer-app.ts` and `src/app/viewer-boot.ts` (the probe on the viewer's canvas, the tile prewarm during the document load), `src/materials/` (noise tiles as named specs, the sliced prewarm).
2. Build: the element entry's eager graph drops from 5 files, about 428 KiB gzip, to 3 files, about 38 KiB gzip; the viewer moves behind a `lazy-` chunk. A new budget holds the element's eager graph and fails if it reaches three.js.
3. Behaviour a host can observe: a below-the-fold element fires `jeex-ready` only after it was scrolled near; a `display: none` element never starts until shown; an attribute changed before the start is read at the start instead of being reported as read-once. The IIFE bundle still carries the whole viewer (it cannot split code) but starts it the same deferred way.
4. Documentation: README sections on the element and its loading.
