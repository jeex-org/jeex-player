# Tasks

Every re-pinned value is derived from the authored plan (dimensions, door centres, wall lengths), never by calling the function under test; a test whose purpose needs one exact arrangement states that precondition in the test, or moves to a small invented fixture when the new flat cannot express it.

## 1. Plan, ids, navigation and tour

Groups 1 and 2 are one coordinated delivery: the demo modules import each other, so the scene, its furniture and its presets switch to the new ids together, and a check of group 1 that loads the furnished scene is final only once 2.1 and 2.2 have landed.

- [x] 1.1 Replace `src/demo/demo-ids.ts` with fresh UUID v7 literals for the scene, nodes, walls, openings, rooms, placements and presets (keys by position for nodes and walls, by role for rooms and placements); verify a grep finds none of the old demo UUIDs in the tree and `bun test src/scene/types.schema.test.ts` is green.
- [x] 1.2 Draw the plan in `src/demo/scene-data.ts` (13.20 × 9.20 m envelope, 0.24 m bearing spine, curved bay on the living room's south facade, one loggia opened from the living room and the bedroom, exactly ten doors with hinge and swing, eight windows, nine rooms) with a header that describes the invented plan; re-pin the plan part of `src/demo/scene-data.test.ts` (room programme, loggia, spine faces, inner bay radius 2.05, thickness scheme, door count and the two loggia doors, windowless hall and WC) and verify it is green.
- [x] 1.3 Author the room cameras, walk spawn, navigation points and the autotour (gaze keys, speed zones) through door centres; extend `scene-data.test.ts` so no camera, navigation point or the spawn stands inside a furniture footprint, and verify the tour-leg, standing-place, gaze/zone and visited-rooms tests are green.
- [x] 1.4 Re-pin the navigation and tour tests (`src/navigation/room-graph.test.ts`, `src/scene/tour-route.test.ts`, `src/camera/tour-player.test.ts` with its smoothed-run furniture clearance kept, `src/camera/tour-motion.test.ts`, `src/camera/tour-controls.test.ts`) and re-author `src/fixtures/tour-six-cameras.ts` (and any other checkpoint fixture that follows the demo) on the new plan; verify each file is green.
- [x] 1.5 Re-author the shell-op examples on the new walls, openings, rooms and nodes (`src/scene/scene-ops.test.ts` vocabulary snapshot, `src/scene/ops/shell.test.ts` split cases with hand-computed lengths and legal split positions), and update `src/embed/protocol.schema.test.ts`, `src/scene/completeness.test.ts` (windowless rooms from the new opening schedule) and the stale demo comment in `src/plan/plan-joints.test.ts` (describe its fixture on its own terms); verify each file is green.
- [x] 1.6 Update the component tests and browser probes that address the plan, cameras, tour or mini-map (`tests/component/tour-cameras.test.ts` and others that name demo rooms or coordinates; `scripts/browser-check/minimap.ts`, `handle.ts`, `view.ts`, `selection.ts`, `slots.ts`, `page-code.ts`, including the facade-picker pixel probe); verify with filtered `scripts/run-component-tests.ts` runs for the changed files.

## 2. Furniture and interior presets

- [x] 2.1 Lay out the furniture in `src/demo/demo-furniture.ts` (kitchen island, double bed with two nightstands in both bedrooms, at least three placements per room) with per-room notes on why pieces stand where they do; verify the layout part of `scene-data.test.ts` (0 errors / 0 warnings, resting door leaves clear) and `src/demo/asset-facing.test.ts` with its case-good floor re-pinned to the new count.
- [x] 2.2 Rewrite the preset tables in `src/demo/demo-interiors.ts` for the new rooms, placements and openings (column 0 = the shipped look) and rename the first preset to "Oak and sand"; add a test in `scene-data.test.ts` that every preset keeps each placement's position, rotation, scale, resolved footprint and height; verify `scene-data.test.ts`, `src/scene/interior-presets.test.ts` and `src/ui/panel-requests.test.ts` are green.
- [x] 2.3 Re-author the placement and edit cases (`src/layout/free-space.test.ts`, `src/layout/asset-pose.test.ts`, `src/layout/asset-mask.test.ts`, `src/layout/asset-legality.test.ts`, `src/edit/asset-move-tool.test.ts`, `src/edit/mirror-edit.test.ts`) with their preconditions stated on the new arrangement or moved to a small invented fixture; verify each file is green, then `bun test src scripts` and both type checks are green.
- [x] 2.4 Update the component tests and browser probes that move or dress furniture (`tests/component/asset-move.test.ts`, `asset-mirror.test.ts`, and others that name demo placements; `scripts/browser-check/editing.ts`, `finishes.ts`, `presets.ts`); verify with filtered component runs and `npm run test:browser` against its own dev server.

## 3. Publishing, images and documentation

- [x] 3.1 Check that schema, public API and catalogue ids are untouched (`git diff origin/main` shows no change under `src/scene/types*`, `src/assets/catalogue-ids.ts`, `src/materials/finish-ids.ts`, `src/embed/index.ts`, and no id alias table), and once, outside the repository, that the previous demo JSON still validates on the new tree.
- [x] 3.2 Re-capture the e2e Linux screenshot baselines of the specs that render the demo, open every new image and confirm it shows the new apartment correctly (silhouette, single loggia, bay, labels, framing), then rerun those specs without update mode; verify they pass.
- [x] 3.3 Rebuild, re-render `site/assets/poster.webp` and `site/assets/og.png` with `scripts/site-poster.ts`, open both and update `site/assets/poster.md`; read `site/index.html`, `site/integration.html`, `site/install.md` and `site/llms.txt` and change whatever no longer describes the demo correctly (record which needed changes); verify `bun test scripts/site-build.test.ts` and the site build.
- [x] 3.4 Update `README.md` (stale wall and object counts), the demo comments in `src/demo/fixture-repository.ts` and `src/purity.test.ts`, and add a `CHANGELOG.md` entry that the demo apartment was replaced and its entity ids changed; verify with a grep for the previous scene name and the removed id keys, and with `bash scripts/no-docs-refs.sh`.

## 4. Integration

- [x] 4.1 Run the full quality gate (`scripts/check.sh`) on the final tree; on red, re-run only the failed files and fix them.
