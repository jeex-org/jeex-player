# Design: editing modes draw on demand

## Context

See proposal.md - Why. The runtime's frame loop (`src/render/render-runtime.ts`) runs the frame hooks, asks `RenderDemand.shouldDraw(camera, mode)` (`src/render/render-demand.ts`), draws when it says so and the first-picture gate is open (and, in `plan2d`, when the keep-warm heartbeat is due), commits the shown camera, then runs the post-render hooks on every tick. Today `shouldDraw` returns `true` for every mode outside `walk` and `tour`, so the editing modes draw on every tick.

The stage (`src/app/viewer-stage.ts`) registers one post-render hook that runs `CheckpointOverlay.flush()` (deferred trajectory tube rebuild) and then `CameraPreview.render()`, which syncs the inset card's visibility, mode and pose and draws the inset scissored into the same canvas. Both run after the main draw.

Most visible-change sources already call `runtime.demand.invalidate()` or report through the frame hooks: edits and rebuilds, model and texture arrival, the light bake, doors and the furniture ripple, cutaways, the selection tint and aura, the floor ring and the light temperature. The checkpoint overlay and the asset move previews and legality mask do not: they reach the screen only because every frame draws, or through an incidental sun-shadow change.

## Goals / Non-Goals

**Goals:** a resting `orbit` or `plan3d` view makes zero display draws; every visible change in those modes still reaches the screen on the next tick; the inset never draws over a stale or missing main picture.

**Non-Goals:** changing `plan2d`'s heartbeat; changing the editor aura's fade-out or the host selection tint's fade; letting a selected view rest while its aura animates; a product-side invalidation-reason log; autorotate; any change to the walk and tour behaviour, the first-picture gate, captures or the shadow cache.

## Decisions

### 1. One gate, more modes

`ON_DEMAND_MODES` becomes `walk`, `tour`, `orbit`, `plan3d`. Nothing else in `RenderDemand` changes: the same snapshot comparison, the same `POSE_TOLERANCE`, commit only after a successful draw. `plan2d` stays out of the set, so it keeps returning `true` and is limited by the existing `renderEnabled` heartbeat (`KEEP_WARM_MS`). The module comment is rewritten to name the modes and the `plan2d` exception.

Alternative: a rig-reported "moved" flag. Rejected: the snapshot already covers the rig, the plan cameras, `flyTo` and keyboard pan.

### 2. Explicit request points in the overlays

`CheckpointOverlay` gets a change callback in its deps (`onChange: () => void`, wired by the stage to `runtime.demand.invalidate()`), called from every method that changes what it draws: `setEnabled`, `setMode` where visibility changes, `setActive`, `changed`, `hover` when the hovered handle changes, `setInvalid`, `ghost`, `cancelPlacing`, `revert`, `settle`, marker and trajectory rebuilds, `remove`, `setScene`. A callback, not a consumable flag, because the overlay has no frame hook of its own and the stage already owns the demand.

`asset-move-wiring.ts` calls `invalidate()` on every preview pose it applies (move, nudge, mirror), on revert and on commit; `AssetSurfaceOverlay` show and removal invalidate through the same wiring, so a mask-only change draws without a shadow change.

### 3. Frame-end ordering in the stage

The deferred trajectory rebuild moves out of the post-render hook into a frame hook registered last (after the director and overlay updates), so the rebuilt geometry is in the scene before `shouldDraw`. A rebuild invalidates through decision 2.

`CameraPreview.render()` splits into:

- `sync()`: visibility, `data-mode`, pose and the inset box. It runs every tick (as a frame hook) and compares the new state (visible, mode, checkpoint pose, card box in CSS pixels, canvas size) with the last one drawn; any difference calls the demand callback. Closing (visible → hidden) invalidates as well, so the main picture is redrawn without the old inset.
- `drawInset()`: the GL draw, called by the post-render hook only when the main display-draw counter (`demand.counters().draws`) changed since the hook last ran. A clock comparison (`lastDrawnAt === now`) is not used: under a frozen clock every skipped tick after a draw would match it and redraw the inset. It counts its draws for the debug surface.

Card drag, resize and relocation already change the card box; the box comparison in `sync()` turns them into a request without touching the pointer handlers. A `ResizeObserver` is not added: the comparison reads two bounding boxes per tick only while the card is visible, which is what `render()` already does.

### 4. Debug counters

`__viewerDebug.renderDemand()` and its type `DemandCounters` retain `ticks` and `draws` and add `insetDraws`, in the runtime counters, the debug host type, the no-stage default and their tests alike, so tests can count the inset. No other debug or product surface is added.

### 4a. Pixel-ratio changes refit both canvases

A pixel-ratio-only change (same CSS box) does not refit today: the runtime's CSS-box fallback reuses the cached ratio, and the pixel-ratio media query only calls `resize()`, so the drawing buffer can keep its old size; the plan canvas observes only its CSS box and has no pixel-ratio wake-up. With continuous drawing this hid behind the next box change; with on-demand drawing it would leave a blurry or oversized picture. The runtime refreshes its fallback ratio before `resize()` on the media-query change (and `resize()` invalidates), and the plan canvas listens to the same kind of re-armed pixel-ratio query and refits and repaints its drawing. The `plan2d` heartbeat is untouched.

### 5. Test-side skipped-draw verifier

A helper in `tests/component/` freezes animation time (the test stubs the page's frame clock, so no time-driven uniform moves between the two pictures), reads the canvas through the compositor screenshot, forces one frame through the same path (`demand.invalidate()`, one tick, main draw plus inset), screenshots again and compares. A difference means a visible change was not requested. It runs after each inventory scenario has returned to rest. It is not shipped. Because the frame clock is frozen, a dedicated case checks that skipped ticks after the forced frame make zero inset draws (decision 3).

### 6. Real clicks

With the editing modes resting, the mounted viewer no longer saturates the main thread on software rendering, so one test in `tests/component/settings-panel.test.ts` goes back to `userEvent.click()` on the settings trigger with the controls pinned open.

## Risks / Trade-offs

- [A visible-change source not in the inventory leaves a stale picture] → the skipped-draw verifier runs over every scenario; any later source must call `invalidate()` (the module comment says so).
- [Inset drawn without a main frame, or over a stale one] → the inset draws only on ticks with a main draw; every inset change requests one.
- [Card box comparison misses a layout move caused by a host] → the box is read every tick while visible, so any host layout change that moves the card is caught.
- [Trajectory rebuild moved into a frame hook runs before a later hook changes the overlay] → registered last among frame hooks; a change after it invalidates and is drawn on the next tick.
- [Heavier per-tick cost from the inset `sync()` comparison] → two bounding-box reads while visible, the same as today's `render()`.

## Migration Plan

No data or API migration. Rollback is reverting the mode set to `walk` and `tour`; the request points and ordering are harmless under continuous drawing.

## Test tier

`tests/component/render-on-demand.test.ts` and `tests/component/baked-surface-walk.test.ts` run in a serial step after the parallel component tier (`scripts/run-component-tests.ts`, `SERIAL_GPU_FILES`): one worker, coverage off, same browser and GPU. Exact kept-vs-forced frame comparison is a single-tenant GPU check; under concurrent GPU rendering the first kept draw differs by ±1–8 levels on thin edges.
