# Tasks

## 1. Mirror gate first

- [ ] 1.1 Write `src/shared/scene-pass.ts` (per-renderer beauty-pass scope with `finally` restore) test-first; verify its unit test.
- [ ] 1.2 Change `mainPassOnly` to capture only when the scope's target, scene and camera match; set the scope around the runtime's direct render; update its long comment; verify `mirror-capture.test.ts` covers no scope, matching scope, a null-target inset preview, transmission and AO-input targets.

## 2. Contract, eligibility, controller (pure, TDD)

- [ ] 2.1 Write `src/render/post-processor.ts` (contract only) and the eligibility function (walk/tour by mode) test-first; verify unit tests, including the tour starting in the dollhouse shell.
- [ ] 2.2 Write `src/app/walk-post-controller.ts` test-first with a fake loader: lazy load on first eligible frame, direct rendering while pending, attach only if eligible/not disposed/same context generation, one error on load failure, detach in editing modes, dispose, rebuild after restore; verify its unit test.
- [ ] 2.3 Add the runtime seam `setPostProcessor` and wire the controller from the stage; verify `render-runtime.test.ts` and that the three big files stay under their limits.

## 3. The chain

- [ ] 3.0 Write the AO visibility classifier test-first (layer 0 vs only-custom layers, material arrays, transparent, transmissive, invisible, colorWrite false, restore on throw); verify its unit test.
- [ ] 3.1 Write `src/render/walk-post.ts`: RenderPass → GTAO (with the classifier) → SMAA → OutputPass, half-float targets without MSAA, half-resolution AO on every resize, scene-pass scope around the beauty pass, SMAA decode await (decode failure = load failure), `renderTo` for captures, pass-by-pass dispose (GTAO blend material included); unit-test the tuning object.
- [ ] 3.2 Browser test (heavy queue, `JEEX_BROWSER_GPU=nvidia`, new file added to `COMPONENT_FILE_COST_S`): editing modes render with a null target and no pass; walk renders through the chain; corner/open-floor AO ratio; SMAA edge error against a supersampled reference; open floor colour within 2 %; glass and pick proxies cause no occlusion; mirror captures once per frame, shows the room and matches the direct path's brightness within 2 %; an inset preview triggers no capture; resize sizes; dispose calls `dispose` on every pass, target and material of the chain (spied) and `info.memory` returns to its value before walk; context restore rebuilds; disposal or context loss while loading and a stale completion attach nothing and dispose what they built, a chain whose SMAA decode fails disposes everything it had allocated, and a later entry retries. With the chain active, the sun-shadow redraw count stays settled across a camera walk, a preset swap, a wall edit and a furniture toggle redraws once each, and shadow-only casters stay invisible in the processed live view, in a mirror reflection under the chain and in a processed still; a capture through the chain leaves the live rig's shadow cache untouched (redraw count unchanged by the capture).

## 4. Captures

- [ ] 4.1 Route stills and video frames captured in walk/tour through `renderTo` of the same chain (awaiting load, direct on failure), the transform applied once; panoramas unchanged; verify `capture-commands` unit tests and browser tests: a walk still shows darkened corners, two identical stills are byte-equal, the next live frame is unchanged, a two-frame video clip in walk is repeatable, a panorama uses the direct path (same code path, asserted by the pass spy).

## 5. Build and budgets

- [ ] 5.1 Confirm the ES and demo builds emit `walk-post` as a lazy chunk and the IIFE inlines it; add the lazy chunk to the per-lazy-file budget and a boot-graph test that the ES boot does not include it; raise the IIFE budget by the measured size within 700 KB; verify `build:lib`, `check:budget:lib` and the demo budget. Report the measured IIFE size.
- [ ] 5.1a Any new `__viewerDebug` member or published export added for these tests is a two-file change with its surface test; verify those tests.
- [ ] 5.2 README (rendering section: what walk/tour add, IIFE note) and CHANGELOG; verify docs tests.

## 6. Shots

- [ ] 6.1 Before/after shots of the demo apartment in walk (living room corner with sofa feet, kitchen, a mirror, a window wall) and one tour frame, 1600×900, saved outside the repository.

## 7. Integration

- [ ] 7.1 Fast tier green, then the full gate once through the machine's gate queue on the final tree; on red re-run only the failed files.
