# Brainstorm

## Problem

In walk and tour every animation frame redraws the picture through the post-processing chain and the room lighting, even when nothing moved. A still camera costs the same as a moving one: battery, heat and dropped frames on phones; on a software rasterizer (about 670 ms per frame direct, 820 ms with the chain, measured) input queues behind frames.

## Related work

The walk and tour chain and the room lighting landed just before; quality tiers come later. Editing modes are not changed here.

## Doubts

Browser behaviour without a draw; completeness of the change sources; camera detection with damping; the existing keep-warm heartbeat; the frame clock tests and telemetry rely on; editing modes; a public surface; how to test.

## Approaches considered

1. **Skip the display draw when nothing changed, keep the animation frame and hooks (author, chosen with the partner).** Hooks keep running (input, damping, animations, bake work); only the final display draw is gated.
2. **Stop the animation loop when idle (author).** Every polling hook and animation would need a restart path. Rejected for this step.
3. **Blit the chain's last output every frame (author).** Still a full-screen draw per frame; does not solve invalidation. Rejected.

Partner findings verified in the code and the WebGL specification (not yet by an empirical browser pass): the renderer does not preserve the drawing buffer, yet a tick without draw calls presents nothing new, so the compositor keeps showing the last frame; resize and context restore need a fresh frame, and so does resuming from a hidden tab. There is no single choke point for picture changes: committed edits pass `SceneModel.onRevision`, rebuilds pass the scene mount, door and furniture animators already report moved items to the frame wiring, model upgrades report each swapped body, but late texture attachment in library surfaces, the selection fade and glow, the floor ring, sun-shadow changes and the room lighting's look changes notify nothing today.

## Decision

1. **Scope**: walk and tour only. Editing modes keep drawing every frame: the checkpoint inset preview draws into the same canvas after the main draw, and the checkpoint overlay rebuilds geometry after it.
2. **Gate**: a new pure module decides per tick, after the hooks and after updating the camera's world matrix: draw when the frame is dirty or the camera (identity, world matrix within a small tolerance, projection, layers) differs from the LAST DISPLAYED snapshot; the snapshot and the dirty flag are committed only after a successful display draw. The keep-warm heartbeat of the render-disabled modes stays as it is and does not apply in walk and tour.
3. **Dirty sources** (internal `invalidate()`; nothing public): scene revisions and rebuilds; door and furniture animator moves (the readings the frame wiring already takes, including the final frame); each swapped model body; a library surface after its maps are attached; selection fade while it changes and the selection glow while an aura exists; floor-ring position or visibility changes; sun-shadow redraws; the walk chain attaching or detaching; the room lighting entering or leaving its look, completing, failing or finishing a refresh; resize, pixel ratio, visibility resume and context restore; the restart after a frame capture.
4. **Captures** keep their own render paths and never clear pending dirtiness.
5. **Clock and telemetry**: the animation frame clock is unchanged (tests wait on it); the time of the last display draw tracks display draws only; frame-interval telemetry resets across skipped draws so idle gaps are not slow frames; room dwell counts on hook time.
6. **Proof**: display-draw and tick counters on the debug surface; tests show counters flat across idle ticks and one draw per kind of change; first movement after a long idle measured.

## Rejected

1. Stopping the loop: too many restart paths now.
2. Blitting the last frame: costs a draw per frame.
3. Editing modes now: the inset preview and overlay redraws need their own design.
4. A public `invalidate()` or continuous-render option: no host-visible surface needs it.

## Process

One round with the partner (read-only), given three approaches and seven doubts; it chose 1, verified the presentation behaviour against the WebGL specification and three's sources, and mapped every change source in the code.
