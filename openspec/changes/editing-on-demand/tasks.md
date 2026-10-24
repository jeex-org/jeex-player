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

- [ ] 5.1 Unit tests in a new `src/ui/camera-preview.test.ts`: `sync()` requests a draw on open, close, mode change, checkpoint pose change and card box change, and not when nothing changed; the inset draws only on a tick with a main draw and counts its draws; verify they fail first.
- [ ] 5.2 Split `CameraPreview.render()` into `sync()` and `drawInset()`; move the trajectory rebuild (`overlay.flush()`) and `sync()` into a frame hook registered last in `src/app/viewer-stage.ts`; the post-render hook draws the inset only when the tick drew; add `insetDraws` to `__viewerDebug.renderDemand()` (`src/app/debug-parts.ts`, `src/app/viewer-debug.ts` and its test); verify 5.1 and `src/app/viewer-debug.test.ts` pass.

## 6. Browser proof

- [ ] 6.1 Test-side skipped-draw verifier helper in `tests/component/` (freeze animation time, screenshot, force one frame through the main plus inset path, screenshot, compare); verify it reports a difference on a deliberately unrequested change in a scratch run and none on a rested scene.
- [ ] 6.2 In `tests/component/render-on-demand.test.ts` replace «editing modes keep drawing every tick; plan2d keeps only its heartbeat» with: resting `orbit` and `plan3d` (ticks grow, draws zero over 60 ticks and a two-second window); `plan2d` heartbeat (draws fewer than ticks); inertia after a drag rests; selection draws every tick, clearing draws once and rests; verify on software rendering and on the GPU.
- [ ] 6.3 Per-source scenarios in `orbit`, each drawing and returning to rest, followed by the verifier: edit, late model, late texture, light bake arrival, door motion, light temperature, checkpoint drag and cancel, hover, invalid tint, ghost, trajectory final frame, preview open, card move and resize, preview close, asset move, nudge, mirror, revert, mask show and removal, hidden edit then reveal, resize, pixel-ratio change, context restore, still and panorama with pending demand; inset draws counted in the preview scenarios; verify all pass on software rendering and on the GPU.
- [ ] 6.4 Bring back one real `userEvent.click()` on a mounted viewer in `tests/component/settings-panel.test.ts` (controls pinned open) and assert the panel opens; verify it passes on software rendering and on the GPU.
- [ ] 6.5 Measure display draws per second of a resting `orbit` view after the change, as in 1.1; verify zero on both and record the "after" values in the delivery report.

## 7. Integration

- [ ] 7.1 Run the chrome and canvas e2e baselines without re-shooting; verify every baseline passes unchanged (on any difference, stop and report before re-shooting).
- [ ] 7.2 Run `scripts/check.sh fast`; verify it is green.

## Workflow follow-up

- The full gate runs once at the end of the branch, through the machine's gate queue, after the review of record.
- Archive the change after the review requirements are satisfied, so the landing carries the updated main specs.
