# Design

## Context

Floor questions were answered in three places: `footprintFor` in the bank module (walk), `findCatalogueEntry` (plan fixture category), and the layout linter's two catalogues (`shippedFacts`, `projectLayoutCatalogue`). Only the last one knew a project library, and it skipped `layout.footprint` and the height rule. Layers (`.dependency-cruiser.cjs`): `assets` sits below `layout`, `edit`, `camera`, `ui` and `app`, so the shared source lives in `assets/` and is injected upwards as a function.

## Goals / Non-Goals

**Goals:** one facts source per document; the walk rule written once and applied to both banks; the source wired to every floor consumer; the degraded notice clear of host boxes and the hint card.

**Non-Goals:** obstacles on scripted tour legs (they fly authored legs by design); redrawing the plan on furniture-only edits; the free-space probe's answer for rugs; bank asset geometry.

## Decisions

1. `assets/asset-facts.ts`: `AssetFacts` (archetype, anchor, category, wallSnap, clearance, variant dims, yaw, layout, mirror, surfaces at the variant's size), `AssetFactsSource`, `shippedAssetFacts`, `projectAssetFacts(library, base = shippedAssetFacts)`. Resolution: `asset ?? type` (as the render path resolves), then the variant id; the variant is `placement.variant ?? the id's variant ?? defaultVariant`. Project defaults: `wallSnap: false`, clearance 0.6 m, no yaw.
2. `asset-footprint.ts`: `factsFootprint(facts)` applies the walk rule; `footprintOf(placement, source)` and `obstaclesFor(scene, source)` default to the shipped bank so callers without a document keep working. Only an UNKNOWN placement reaches the legacy per-type table. `footprintFor` is removed from the bank module (it would form an import cycle with the facts module) and its tests move to `asset-facts.test.ts`.
3. `plan-fixtures.ts`: category and anchor from the source.
4. `layout-lint.ts`: `layoutCatalogueOf(source)` maps facts to `LayoutFacts` with the footprint from `footprintOf(placement, source)`; `shippedFacts` and `projectLayoutCatalogue(library)` are that adapter over the two sources (public signature kept, `category` optional).
5. Lifetime: `LoadedProjectContext` carries `facts` built once per load; `SceneMount.mount()` stores it with its saved arguments, so `remount()` after a lost context keeps it; `mount.assetFacts()` is read late by the camera stack (controller, director), checkpoints, plan modes, the drag tool and the debug surface. The walk rig's spawn uses the controller's obstacle list instead of recomputing it.
6. Drag: `dragCatalogue(bodyFacts, catalogue)` asks the document's layout catalogue first, then the facts the built body carries.
7. Notice: HostSlots takes an optional `{ notice, hint, triggers, signal }`. One ResizeObserver watches the built bottom boxes, the notice, the hint card, the `triggers` (the tour bar, whose appearance moves the hint without resizing it) and the root. On a callback it reads every rect, takes each candidate that is rendered (non-zero size) and overlaps the notice horizontally, computes `max(root.bottom - candidate.top + 8 - base, 0)` where `base` is the notice's computed bottom inset without lift, and writes `--jeex-notice-lift` on the root only when it changed. The stylesheet adds the property to the notice's bottom inset; the fixed 64 px and 62 px lifts are removed, the corner step-aside stays. The observer disconnects on the viewer's abort signal.

## Risks / Trade-offs

1. Project lint results change (rugs, plants): intended, noted in the proposal.
2. Measurement runs after layout, so the notice can sit one frame low after a host box grows: acceptable, it is a status card.
3. A hint card that moves for a reason other than its own size, the tour bar or the root size would not be followed. No such path exists today; not guarded further.
