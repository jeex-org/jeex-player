# Tasks

Tests come first in every group: write the failing test, see it fail for the stated reason, then make it pass. Browser tests run only through the machine's heavy-work queue, affected files only.

## 1. Measure the baseline

- [ ] 1.1 Measure display draws per second of a resting `orbit` view on the current code, on software rendering and on the GPU, with `__viewerDebug.renderDemand()` over a two-second window after `ready` and settling (selection cleared); verify the numbers are recorded in the delivery report as the "before" values.

## 2. The gate covers orbit and plan3d

- [ ] 2.1 Unit tests in `src/render/render-demand.test.ts`: `orbit` and `plan3d` rest at an unchanged camera, draw on invalidate, on pose beyond the tolerance, on accumulated slow drift, on camera identity, projection, layers and mode changes, and keep demand after a failed draw; `plan2d` and an undefined mode still return `true`; verify they fail on the current code and pass after 2.2.
- [ ] 2.2 Add `orbit` and `plan3d` to the on-demand modes in `src/render/render-demand.ts` and rewrite its module comment (modes, the `plan2d` heartbeat exception, every visible change must request a draw); verify 2.1 passes and `src/render/render-runtime*.test.ts` stays green.

## 3. Checkpoint overlay requests draws

- [ ] 3.1 Unit tests for `src/camera/checkpoint-overlay.ts`: each of enable, mode-driven visibility, active, changed, hover change, invalid tint, ghost, cancel placing, revert, settle, rebuild, remove and scene change calls the change callback; an unchanged hover does not; verify they fail first.
- [ ] 3.2 Add the change callback to the overlay's deps and call it from those methods; wire it in `src/app/viewer-stage.ts` to `runtime.demand.invalidate()`; verify 3.1 passes.

## 4. Asset move previews and mask request draws

- [ ] 4.1 Unit tests in a new `src/app/asset-move-wiring.test.ts` (and `src/edit/asset-surface-overlay.test.ts` where the show and remove live): move, nudge and mirror preview poses, revert, commit, mask shown and mask removed each request a draw, a mask-only change included; verify they fail first.
- [ ] 4.2 Add the explicit `invalidate()` calls; verify 4.1 passes.

## 5. Stage ordering and the camera-preview inset

- [ ] 5.1 Unit tests in a new `src/ui/camera-preview.test.ts`: `sync()` requests a draw on open, close, mode change, checkpoint pose (aiming) change and card box change (drag, resize, host-driven relocation), and not when nothing changed; the inset draws only when the main draw counter changed since the last post-render hook, never on a skipped tick under a frozen clock, and counts its draws; verify they fail first.
- [ ] 5.2 Split `CameraPreview.render()` into `sync()` and `drawInset()`; move the trajectory rebuild (`overlay.flush()`) and `sync()` into a frame hook registered last in `src/app/viewer-stage.ts`; the post-render hook draws the inset only when `demand.counters().draws` changed; `DemandCounters` retains `ticks` and `draws` and adds `insetDraws` everywhere it appears (`src/render/render-demand.ts`, `src/app/debug-parts.ts`, `src/app/viewer-debug.ts` with its no-stage default, `src/app/viewer-debug.test.ts`); verify 5.1 and `src/app/viewer-debug.test.ts` pass.

## 6. Pixel-ratio refit

- [ ] 6.1 Unit tests: in `src/render/render-runtime*.test.ts` a pixel-ratio media-query change at a fixed CSS box refreshes the fallback ratio, resizes the drawing buffer to the new ratio and invalidates; in `src/ui/plan-modes*.test.ts` the same change refits and repaints the plan canvas at the new ratio; verify they fail first.
- [ ] 6.2 Refresh the runtime's fallback ratio before `resize()` on the media-query change; give `PlanModes` a re-armed pixel-ratio query that refits its canvas; the `plan2d` heartbeat is unchanged; verify 6.1 passes.

## 7. Browser proof

Every scenario in 7.2–7.5 runs on software rendering and on the GPU, requires a visible picture change where the source is visible, and then rest (draws flat over 60 ticks), followed by the skipped-draw verifier.

- [ ] 7.1 Test-side skipped-draw verifier helper in `tests/component/` (freeze animation time, screenshot, force one frame through the main plus inset path, screenshot, compare), plus a frozen-clock case proving skipped ticks after the forced frame make zero inset draws; verify it reports a difference on a deliberately unrequested change in a scratch run and none on a rested scene.
- [ ] 7.2 In `tests/component/render-on-demand.test.ts` replace «editing modes keep drawing every tick; plan2d keeps only its heartbeat» with: resting `orbit` and `plan3d` (ticks grow, draws zero over 60 ticks and a two-second window); `plan2d` heartbeat (draws fewer than ticks); inertia after a drag rests; the editor aura draws every tick while shown and through its fade-out after clearing, then the picture without it is drawn and the view rests; separately, a host-set selection tint draws through its finite fade and rests; verify all pass.
- [ ] 7.3 Scene sources in `orbit`: an edit; a finish change; a variant change; a shell rebuild; a late model; a late texture; a light bake arriving and a light bake removed; a door motion and a furniture animation, each with its final frame drawn; a cutaway and a shell-state change; a selection recolour; the light temperature; verify each draws, shows the change and rests.
- [ ] 7.4 Authoring sources in `orbit`: checkpoint overlay enabled, disabled and a checkpoint removed; checkpoint drag and cancel; hover; invalid tint; placement ghost; trajectory final frame; preview open, aiming at another checkpoint, card drag and resize, host-driven card relocation, preview cancel and close (inset draws counted); asset move, nudge, mirror, revert, legality mask shown and removed (a mask-only change included); verify each draws, shows the change and rests.
- [ ] 7.5 Lifecycle in `orbit`: initially hidden mount announces readiness without a display draw, draws on reveal and rests; an edit while hidden draws on reveal; tab hidden then visible resumes with one draw; resize; pixel-ratio-only change at a fixed CSS size (and in `plan2d`, the plan canvas refits and the heartbeat continues); context restore; verify each draws once and rests.
- [ ] 7.6 Captures isolate pending demand, for a still and for a panorama: queue one non-animating invalidation, hold display ticks during the capture by test-local interception, verify the capture succeeds with no display commit, then release one tick and require the pending redraw; the existing capture assertions are not reused as proof; verify both pass.
- [ ] 7.7 Bring back one real `userEvent.click()` on a mounted viewer in `tests/component/settings-panel.test.ts` (controls pinned open) and assert the panel opens; verify it passes on software rendering and on the GPU.
- [ ] 7.8 Measure display draws per second of a resting `orbit` view after the change, as in 1.1; verify zero on both and record the "after" values in the delivery report.

## 8. Integration

- [ ] 8.1 Run the chrome and canvas e2e baselines without re-shooting; verify every baseline passes unchanged (on any difference, stop and report before re-shooting).
- [ ] 8.2 Run `scripts/check.sh fast`; verify it is green.

## Workflow follow-up

- The full gate runs once at the end of the branch, through the machine's gate queue, after the review of record.
- Archive the change after the review requirements are satisfied, so the landing carries the updated main specs.
