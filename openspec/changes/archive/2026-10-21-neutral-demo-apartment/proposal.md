# Proposal

## Why

The demo apartment that ships with the player and is published by the player site was not an invented, market-neutral plan. Demos and examples of this project must be, so the scene is replaced by an invented apartment that keeps every feature the demo is there to show.

## What Changes

- **BREAKING (demo data only):** the bundled demo scene is a new, invented two-bedroom apartment with a study: a new wall graph, a new room programme (nine rooms, one loggia, a WC, a kitchen island, two bedrooms with beds) and a new furniture layout. Every demo entity id (scene, nodes, walls, openings, rooms, placements, interior presets) is a new UUID v7; a host that adopts the new document and addressed demo entities by id must read them from it; a retained copy of the old demo JSON needs no change. Catalogue, variant and finish ids are unchanged. The library build is not affected: the demo is not part of it.
- The scene is named `Two-bedroom demo apartment`; its comments describe the invented plan on its own terms.
- The demo still exercises: a curved facade wall with a window along the arc, facade / bearing / partition thicknesses, an entrance door flagged in the data, ten doors with authored hinge and swing, windows in every room but the hall and the WC, a loggia reached from two rooms, four interior presets, a room camera and a navigation point per room, a walk spawn, and an autotour with gaze keys and speed zones through every room but the WC.
- The first interior preset is renamed from "Nordic oak" to "Oak and sand".
- Tests that used the demo are re-pinned to values derived from the new plan; tests whose purpose needs one exact arrangement are re-authored against the new arrangement with their precondition stated. The e2e screenshot baselines and the site's poster and social image are re-rendered from the new scene.
- README, site notes, code comments and browser probes that described the old flat or its counts are updated; the change log records the replacement.

## Capabilities

### New Capabilities
- `demo-apartment`: the bundled demo scene: what it contains, the guarantees it meets (valid, lint-clean furniture under every preset, walkable tour), and that it is invented content with its own ids.

### Modified Capabilities

## Impact

- Code: `src/demo/` (scene, furniture, interiors, ids), the tests and fixtures that read the demo (`src/**/*.test.ts`, `src/fixtures/tour-six-cameras.ts`, `tests/component/*`, `tests/e2e/*` and their Linux baselines), the browser probes under `scripts/browser-check/`.
- Site: `site-out/demo/demo-apartment.json` changes on the next site build; `site/assets/poster.webp`, `site/assets/og.png` and `site/assets/poster.md` are re-rendered.
- Docs: `README.md`, `CHANGELOG.md`, comments in `src/demo/fixture-repository.ts` and `src/purity.test.ts`.
- No API, schema, dependency or library bundle change. Projects that vendor a copy of the demo JSON keep working on their copy until they re-vendor.
