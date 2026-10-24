# Brainstorm

## Problem

Walk and tour already draw on demand: frame hooks tick every animation frame, but the display draw happens only when the camera moved or something visible changed. The editing modes (`orbit`, labelled «360», and `plan3d`) still draw every frame. A resting orbit view therefore keeps the GPU and the main thread busy (on software rendering about 2.5 frames per second at roughly 430 ms of main-thread work each), which wastes power and makes real pointer clicks in browser tests time out. The editing modes should rest like walk and tour, without losing any visible change.

## Related work

- Walk and tour on-demand drawing (`render/render-demand.ts`, capability `walk-post-processing`, requirements «Redraw on demand in walk and tour» and the three that follow). This change extends the same gate; it does not build a second one.
- First-picture gate (capability `first-frame`): the first display draw waits for asynchronous shader compilation; kept as is.
- Render loop parking (capability `render-loop`): a detached or hidden canvas parks the loop; kept as is.
- No open branch or change in flight touches the draw gate, the stage's post-render hook, the camera preview or the checkpoint overlay.

## Doubts

1. Does the orbit rig need velocity thresholds to know when inertia ends, or does the existing camera snapshot comparison suffice?
2. Is there an autorotate or other self-driven camera motion in the editing modes?
3. Which visible changes in the editing modes reach the screen today only because every frame draws?
4. The camera-preview inset and the trajectory rebuild run after the main draw: what happens to them when the main draw is skipped?
5. Does `plan2d` belong to the change, given its 500 ms keep-warm heartbeat?
6. The selection aura animates through a shader time uniform: can a view with a selection ever rest?
7. Captures, resize, pixel-ratio changes, context restore and hidden mounts: do they still produce a correct picture when the display draw is gated?

## Approaches considered

1. **Extend the existing gate to `orbit` and `plan3d`** (author and partner agreed). The gate compares the camera's identity, world matrix (tolerance `1e-4`), projection, layers and mode against the last displayed picture; demand accumulates and clears only after a successful draw. The orbit rig's exponential approach ends in a tail below the tolerance, so inertia is detected without velocity thresholds; slow drift still adds up and draws. Cost: add the request points that are missing today. Risk: a missed request point leaves a stale picture; mitigated by the inventory and a test-side verifier.
2. **Draw while the rig reports motion** (author). Make `OrbitRig.update()` return whether it moved and draw on that. Rejected: duplicates what the snapshot comparison already gives, and every other camera path (plan cameras, `flyTo`, keyboard pan) would need the same signal.
3. **Throttle the editing modes to a low fixed rate** (author). Rejected: still wastes work at rest, adds latency to interaction, and does not make the view idle.

Partner findings that shaped the decision: there is no autorotate and no OrbitControls; the plan cameras have no damping; the checkpoint overlay (markers, gizmos, hover, invalid tint, placement ghost, drags, revert) and the asset move previews and legality mask reach the screen today only through continuous drawing or indirect sun-shadow changes; the trajectory rebuild and the camera-preview inset run after the main draw, so gating the main draw alone strands an updated trajectory and keeps the inset drawing every tick on its own; the minimap and the plan drawing are separate 2D canvases and need no WebGL request.

## Decision

Approach 1:

1. The draw gate covers `walk`, `tour`, `orbit` and `plan3d`. Frame hooks keep ticking every animation frame; only the display draw is gated. Inertia is detected by the existing camera snapshot comparison. No autorotate exists and none is added.
2. `plan2d` keeps its 500 ms keep-warm heartbeat behind the opaque plan drawing, for the measured return latency to the 3D view; it is the one mode that does not rest, and the spec says so with the reason.
3. A selected object's aura keeps drawing while it is shown, by design (its shader animates). A view with a selection does not rest; idle tests clear the selection.
4. The missing request points are added: every checkpoint overlay change (enable, active, changed, hover, invalid tint, ghost, rebuild, revert) and the asset move, nudge and mirror previews, their revert, and the legality mask shown or removed request a draw explicitly. Every other source in the inventory already requests one and stays as is.
5. Ordering in the stage: the overlay's deferred geometry rebuild runs before the draw decision; the camera-preview inset's visibility, layout and pose sync is split from its GL draw; a change of the inset requests a main frame, and the inset draws only right after a main frame. Opening, closing, dragging, resizing and relocating the card request a draw; closing redraws the main frame to erase the old inset.
6. Lifecycle is kept: the initial dirty state, the first-draw compile gate and the hidden-mount path that announces readiness without drawing; a draw on reveal; resume requests a draw; resize and pixel-ratio-only changes (the plan canvas included) draw once after the fit; the sun-shadow cache refit, mark-dirty, settle and its redraw callback are untouched; captures render to their own targets and never consume display demand.
7. Proof in the browser component tests: after settling, ticks increase while display draws stay zero over 60 ticks and over a wall-clock window, on the GPU and on software rendering; each inventory source causes a visible draw and returns to rest; checkpoint drag and cancel, the trajectory's final frame, preview open, close and layout, mask removal, late textures and models, hidden edits, resize and pixel ratio, context restore and captures are covered; inset draws are counted. A test-side skipped-draw verifier (freeze time, compare the retained picture with a forced frame through the same main-plus-inset path) runs over the inventory scenarios. It lives in test helpers only.
8. With the editing modes resting, one settings-panel test goes back to a real Playwright pointer click on a mounted viewer (controls pinned open), on software rendering too.

## Rejected

- Velocity thresholds on the rig: the snapshot comparison already ends the tail and catches slow drift.
- Autorotate support: no such feature exists; adding one is out of scope.
- Changing the `plan2d` heartbeat: its return-latency reason was measured; revisiting it is a separate change.
- Ending the selection aura's animation to let a selected view rest: the animation is the intended look.
- A product-side invalidation-reason log and verifier: the verifier is a test helper; shipping debug machinery to every viewer adds weight without a user.
- Using the still capture as the verifier's reference: it uses another camera and output path and omits the inset.

## Process

Partner: an independent second agent read the code read-only and produced the inventory of visible-change sources, the ordering finding in the stage and the proof plan. One round; the decisions above were then settled with the change's owner. No disagreement was left open.
