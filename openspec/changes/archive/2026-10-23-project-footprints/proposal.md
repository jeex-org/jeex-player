# Proposal

## Why

A baked project whose library carries its own archetype ids gets no walk obstacles and no plan fixtures, because both are read from the built-in bank alone: on the demo flat exported with store ids, nothing collides and the plan draws no bath or kitchen. The degraded-asset notice is hidden by a filled bottom-center host box and overlaps the hint card at phone width.

## What Changes

- One facts source per document answers every floor question: the project's library first, the built-in bank behind it. Walk obstacles, plan fixtures, the tour room graph, checkpoints, the plan modes, the debug surface, the layout linter, the free-space probe and the drag tool all read it.
- The walk rule is written down and applied to both banks alike: explicit `collision`; else a known floor object at least 0.15 m tall (`layout.blockingHeight` when declared, else the height in `dims`) collides with its plan size times `layout.footprint` (a fraction) when declared; a placement no bank knows keeps the legacy per-type fallback.
- The layout linter's project catalogue now applies `layout.footprint` and the height rule like the built-in bank: a project rug no longer reports wall, overlap or door-zone findings, a plant is judged by its pot. Same public signature.
- The degraded notice is lifted above the tallest filled bottom host box that it would overlap and above the hint card, plus 8 px, measured live.
- README format section: `dims` of a project object is its overall bounding box; `layout.footprint` and `layout.blockingHeight` say what of it stands on the floor.

## Capabilities

### New Capabilities

- `floor-footprints`: which placements are walk obstacles and plan fixtures, and from which bank their size and category come.
- `degraded-notice-placement`: where the degraded-asset notice sits relative to host boxes and the viewer's own bottom chrome.

### Modified Capabilities

None.

## Impact

`src/assets/` (new `asset-facts.ts`; `asset-footprint.ts`, `plan-fixtures.ts`, `asset-catalogue.ts`), `src/layout/layout-lint.ts`, `src/edit/asset-move-catalogue.ts`, `src/camera/` (controller, director, walk rig), `src/ui/plan-modes.ts`, `src/ui/host-slots.ts`, `src/ui/styles/viewer.css`, `src/app/` wiring (scene mount, project wiring, stage, checkpoints, debug, asset move), README. No new public export, option or scene-schema field. Lint results of projects change as described.
