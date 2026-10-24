# Proposal: editing modes draw on demand

## Why

The editing modes (`orbit`, labelled «360», and `plan3d`) draw a full frame on every animation frame even when nothing moves. A resting editing view keeps the GPU and the main thread busy (on software rendering about 2.5 frames per second at roughly 430 ms of main-thread work each), wastes battery and makes real pointer clicks in browser tests time out. Walk and tour already rest; the editing modes should rest the same way without losing any visible change.

## What Changes

- The display-draw gate that walk and tour use extends to `orbit` and `plan3d`: frame hooks keep running every animation frame, and a display draw happens only when the camera differs from the last displayed picture or something visible changed. Camera inertia ends by the existing pose tolerance; no velocity thresholds, no autorotate.
- Visible changes that reach the screen today only because every frame draws now request a draw: checkpoint markers, gizmos, hover, invalid tint, placement ghost, drags, rebuilds and revert; asset move, nudge and mirror previews, their revert, and the placement legality mask.
- The stage reorders its frame end: the checkpoint trajectory's deferred rebuild runs before the draw decision, and the camera-preview inset draws only right after a main frame; opening, closing, dragging, resizing and relocating the inset request a draw, and closing it redraws the main picture.
- `plan2d` keeps its keep-warm heartbeat (stated in the spec as the one mode that does not rest, with its reason). A selected object's animated aura keeps the view drawing while it is shown, by design.
- The first-picture gate, hidden mounts, resume, resize redraws, the sun-shadow cache and captures keep their behaviour. A pixel-ratio-only change now refits the drawing buffer and the plan canvas (today it can keep the old buffer size, hidden by continuous drawing).
- Tests: the component test that pinned «editing modes keep drawing every tick» is replaced by idle and per-source redraw proofs on the GPU and on software rendering, with a test-side skipped-draw verifier; one settings-panel test returns to a real pointer click on a mounted viewer.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `walk-post-processing`: the requirement «Active only in walk and tour» stops stating that editing modes draw every animation frame; it points to the on-demand schedule instead.
- `render-loop`: adds the on-demand drawing of the editing modes, what makes them redraw, the camera-preview inset under on-demand drawing, and the `plan2d` heartbeat as the stated exception.

## Impact

- Code: `src/render/render-demand.ts` (mode set), `src/app/viewer-stage.ts` (frame-end ordering), `src/ui/camera-preview.ts` (sync split from draw), `src/camera/checkpoint-overlay.ts` and `src/app/asset-move-wiring.ts` (request points), with the asset surface overlay show and remove; `src/render/render-runtime.ts` and `src/ui/plan-modes.ts` (pixel-ratio refit); `src/app/debug-parts.ts` and `src/app/viewer-debug.ts` (`insetDraws`).
- Tests: `tests/component/render-on-demand.test.ts`, `tests/component/settings-panel.test.ts`, unit tests next to the changed modules, a test-only skipped-draw verifier helper.
- Public API: unchanged. `__viewerDebug.renderDemand()` retains `ticks` and `draws` and adds `insetDraws`. Chrome and canvas e2e baselines must stay unchanged.
- Hosts: a resting editing view stops drawing; nothing a host reads (`getState()`, events, captures) changes.
