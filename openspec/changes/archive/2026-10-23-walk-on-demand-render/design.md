# Design

## Context

See proposal.md. `render-runtime.ts` is at 690 of 700 lines and `viewer-app.ts` at its 500-line limit: new logic lives in a new module and in the existing wiring files.

## Decisions

1. **`src/render/render-demand.ts`** (pure): `invalidate()`, `shouldDraw(camera, mode)`, `commit(camera)`; holds the last displayed camera snapshot (camera identity, world matrix, projection matrix, layers mask) and the dirty flag. World-matrix comparison with a documented tolerance (damping tails); projection exact. Active only for `walk` and `tour`.
2. **Runtime**: in `frame`, after the hooks, update the camera's world matrix, ask `shouldDraw`; draw and `commit` only after a successful display draw (a throwing draw keeps the demand). The keep-warm heartbeat applies only when rendering is disabled and never in walk or tour. A capture never commits.
3. **Dirty wiring** (each calls the runtime's internal `invalidate`): `SceneModel.onRevision` and scene-mount rebuilds; shell visibility and layer changes (dollhouse state, `CameraDirector.setMode`, `engageTour`); selection highlight set, clear (it restores materials at once) and recolour; the door and furniture moved readings in `viewer-frame.ts` (reuse the existing drain, including final frames); each `onSwapped` body of a model upgrade; library surfaces after maps are attached; selection highlight while its fade changes and the selection glow while an aura exists; floor-ring position or visibility changes; sun-shadow redraw requests; walk chain attach and detach; the room lighting on look change, completion, failure fallback and refresh completion; resize, pixel ratio, `visibilitychange` to visible, context restore; the restart after `captureFrames`; a canvas reattached after the detached-canvas pause.
4. **Telemetry**: frame-interval sampling resets after a skipped draw; room dwell accumulates on hook time; first-draw readiness unchanged.
5. **Post-render hooks**: none may draw to the screen in walk or tour on a skipped tick (the drawing buffer is not preserved, so it would replace the picture with a cleared one); today the only drawing hook, the checkpoint inset preview, shows in authoring modes only (`PREVIEW_MODES`).
6. **Debug surface**: cumulative display-draw and tick counters (two-file change).

## Risks / Trade-offs

1. [A missed dirty source shows a stale picture] → one browser test per change family; the counters make a miss visible.
2. [Presentation behaviour verified by specification, not yet empirically on Safari] → the browser suite compares compositor screenshots across idle ticks on Chromium; Safari is checked on a device in the quality-tier step.
3. [Editing modes still draw every frame] → out of scope by decision.
