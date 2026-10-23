## 1. Facts source and walk rule

- [x] 1.1 Test first: `src/assets/asset-facts.test.ts` with the bank footprint tests moved from the catalogue, a hand-made project library (fraction footprint, blocking height, variant sizes, wall piece, fallthrough, category) and the store-id demo flat fixture (`tests/fixtures/store-ids/`): 0 obstacles and 0 fixtures with the bank alone, 44 obstacles and the nine fixtures with its library. Record the red run.
- [x] 1.2 `src/assets/asset-facts.ts`; `asset-footprint.ts` (`factsFootprint`, `footprintOf(placement, source)`, `obstaclesFor(scene, source)`), `plan-fixtures.ts` (source parameter), remove `footprintFor`.
- [x] 1.3 `layout-lint.ts` adapter `layoutCatalogueOf`; `shippedFacts` and `projectLayoutCatalogue` over it; tests: a project rug has no lint box, a project plant's box is the fraction, an explicit collision wins; resolution cases (default variant, a known rug typed `chair`, the pre-scale height threshold).
- [x] 1.4 `dragCatalogue(bodyFacts, catalogue)` asks the document catalogue first; test.

## 2. Wiring

- [x] 2.1 `LoadedProjectContext.facts`; `SceneMount` stores the source in `mount()` and exposes `assetFacts()`; tests: the source is current inside `onDocument`, `remount()` keeps it, a bare scene after a project resets it.
- [x] 2.2 Camera stack (controller, director, walk spawn), checkpoints, plan modes, debug, drag read `mount.assetFacts()`.
- [x] 2.3 Walk test: a store-id sofa's centre is not reachable on foot (controller harness with the store-id flat).

## 3. Degraded notice

- [x] 3.1 Test first: component tests at 390 by 844 px measuring rects for a bottom-center host, no slots, and bottom-left plus bottom-right (8 px gap asserted), plus the desktop case keeping the default inset; live cases: a host box grows then empties, the hint hides, the tour bar shows; abort disconnects the observer.
- [x] 3.2 HostSlots measurement with ResizeObserver and `{ signal }` cleanup; stylesheet uses `--jeex-notice-lift`; fixed lifts removed; viewer context wiring.

## 4. Documentation and checks

- [x] 4.1 README format section: dims policy and the walk rule.
- [x] 4.2 Integration: `bash scripts/check.sh fast` green; component tier for the touched files through the heavy-run queue; the one full gate is run later by the orchestrator, not in this change's tasks.
