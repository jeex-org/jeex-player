# Independent review

## Reviewer

Sol, an independent second agent that did not write the artifacts; static review of brainstorm, proposal, specs, design and tasks against the code. One round.

## Sol round

Verdict: go with changes. The gate extension, the trajectory flush before the draw decision, the preview sync/draw split, the unchanged `plan2d` heartbeat, the real-click test and the spec placement (`render-loop` added, `walk-post-processing` modified) were judged sound. Six findings, all accepted.

## Findings

1. design, tasks: a pixel-ratio-only change does not refit today (the runtime's CSS-box fallback reuses the cached ratio; the plan canvas has no pixel-ratio wake-up), so "lifecycle unchanged" was not true under on-demand drawing. Verdict: fixed. Design decision 4a, task group 6 (runtime fallback-ratio refresh, plan-canvas refit, unit tests at a fixed CSS size), spec scenario «Pixel ratio only», browser case in 7.5; heartbeat kept.
2. design: the inset guard `lastDrawnAt === now` conflicts with the verifier's frozen clock (skipped ticks after a forced draw would redraw the inset). Verdict: fixed. The inset draws only when the main draw counter changed (decision 3, task 5.1/5.2); a frozen-clock case with zero inset draws on skipped ticks (decision 5, task 7.1); the verifier stays in test helpers.
3. specs, tasks: the selection wording conflated the editor aura (keeps fading after clearing) with the host selection tint (finite fade). Verdict: fixed. The aura requirement now draws through the fade-out and final removal, then rests; a separate host-tint scenario; task 7.2 tests both.
4. tasks: capture tests reusing the current assertions could pass even if a capture consumed the demand. Verdict: fixed. Task 7.6: one non-animating invalidation, display ticks held during the capture, no display commit by the capture, then one released tick must draw; still and panorama. Spec scenario «Still with pending demand» tightened.
5. tasks: the browser inventory was narrower than the stated proof. Verdict: fixed. Tasks 7.3–7.5 enumerate finishes, variants, shell rebuilds, the final frame of furniture animation, cutaways and shell state, bake removal, selection recolour, overlay enable, disable and removal, preview aiming and cancel, host-driven card relocation, initially hidden mount and reveal, and tab resume; each with a visible change and rest, on software rendering and the GPU. Spec scenario «Hidden mount» added.
6. proposal, design: the debug shape statements contradicted each other. Verdict: fixed. Everywhere: `renderDemand()` retains `ticks` and `draws` and adds `insetDraws` (proposal Impact, design decision 4, task 5.2).

## Verdict

Ready for implementation: yes
