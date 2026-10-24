# walk-post-processing Specification

## Purpose
What the player draws in walk and tour: a post-processing chain of ambient occlusion, antialiasing, the walk white balance and the display transform, when it is active and how it loads, and how mirrors and captures behave under it. Editing modes render straight to the screen.

## Requirements

### Requirement: Active only in walk and tour

The player SHALL render through the post-processing chain while the camera mode is `walk` or `tour`, in every shell state those modes use, and SHALL render straight to the screen in every other mode. In walk and tour, a display draw (requirement «Redraw on demand in walk and tour») renders the beauty pass once and the occlusion input once; editing modes draw on their own schedule (capability `render-loop`: on demand in `orbit` and `plan3d`, the low-rate heartbeat in `plan2d`).

#### Scenario: Editing modes unchanged
- **WHEN** the camera mode is `plan2d`, `plan3d` or `orbit`
- **THEN** every display draw renders directly to the default framebuffer as before, and no post-processing pass runs

#### Scenario: Walk uses the chain
- **WHEN** the viewer makes a display draw in `walk` after the chain has loaded
- **THEN** that draw renders the beauty pass once and its occlusion input once, and the chain writes the screen

#### Scenario: Tour from the overview
- **WHEN** a tour starts in its overview (dollhouse) shell
- **THEN** the chain is active from the first display draw after it has loaded

### Requirement: Chain contents

The chain SHALL apply, in order, ground-truth ambient occlusion (world-space radius 0.3 m, at the drawing-buffer resolution, denoised without crossing depth breaks), SMAA and the lighting standard's display transform preceded by the walk white balance (capability `walk-white-balance`) in the same pass, rendering the scene in linear half-float colour without multisampling and tone mapping it exactly once.

#### Scenario: Corner darkening
- **WHEN** a walk view shows a floor-to-wall corner and an open patch of the same floor
- **THEN** with the chain the corner reads darker relative to the open patch than without it

#### Scenario: Smoother edges
- **WHEN** a walk view shows a high-contrast diagonal edge
- **THEN** with the chain the edge's error against a supersampled reference is lower than without it

#### Scenario: Open floor unchanged in tone
- **WHEN** an open floor patch away from geometry is compared with and without the chain, with the white balance at identity
- **THEN** its displayed colour differs by no more than 2 % per channel

#### Scenario: White balance adds no pass
- **WHEN** the chain is built
- **THEN** its last pass applies the white balance and the display transform, and the white balance adds no pass and no render target

### Requirement: What occludes

Ambient occlusion SHALL be computed only from geometry drawn in the beauty pass with an opaque material: transparent, transmissive and invisible-material surfaces (window glass, pick proxies), objects only on custom layers (overlays, shadow-only casters) and helpers SHALL NOT occlude; every visibility the filter changes SHALL be restored after the occlusion input, also when it throws.

#### Scenario: Glass casts no occlusion
- **WHEN** the camera looks at a window
- **THEN** the sill and floor beyond the pane show no occlusion from the pane itself

#### Scenario: Pick proxies
- **WHEN** a doorway's invisible pick proxies are in view
- **THEN** no occlusion appears around them

### Requirement: Loading

On the first entry to `walk` or `tour` the chain SHALL be loaded on demand (a separate chunk in the ES and demo builds; included in the IIFE build). Until it is ready the view SHALL render directly. It SHALL be attached only if the viewer is still in `walk` or `tour`, not disposed, and on the same GPU context. A failure to load SHALL leave the view rendering directly and report the error through the viewer's error channel.

#### Scenario: Leave before loaded
- **WHEN** the viewer enters `walk` and returns to `orbit` before the chain has loaded
- **THEN** the chain is not attached and `orbit` renders directly

#### Scenario: Load failure
- **WHEN** the chain fails to load
- **THEN** `walk` keeps rendering directly and one error is reported

#### Scenario: Boot unchanged
- **WHEN** the ES or demo build is loaded and the viewer never enters `walk` or `tour`
- **THEN** the chain's code is not downloaded

### Requirement: Mirrors under the chain

A mirror SHALL capture its reflection exactly once per display draw, in that draw's beauty pass (the live view's scene and camera into the screen or into the chain), whether or not the chain is active; other passes (transmission, occlusion input, checkpoint inset previews, swatches) SHALL NOT trigger a capture.

#### Scenario: Mirror in walk
- **WHEN** a mirror is in view in `walk` with the chain active and the view is redrawn
- **THEN** it shows the room, captures once per display draw, and, with the white balance at identity, its brightness matches the direct path within 2 %

#### Scenario: Inset preview
- **WHEN** a checkpoint inset preview renders to the screen while a mirror is in the scene
- **THEN** the preview triggers no mirror capture

### Requirement: Captures in walk and tour

Stills and video frames captured while the camera mode is `walk` or `tour` SHALL go through the same chain instance at the capture's resolution, waiting for it to load; if it fails to load they SHALL use the direct path. Panoramas SHALL keep their direct path; when the chain is available, their display pass SHALL apply the same white balance as the chain. The next live frame SHALL be unchanged by a capture.

#### Scenario: Still matches the screen
- **WHEN** a still is captured in `walk` with the chain active
- **THEN** its corners are darkened like the live view's

#### Scenario: Repeatable
- **WHEN** the same still is captured twice in `walk` without any scene change
- **THEN** the two images are identical

#### Scenario: Live view after a capture
- **WHEN** a capture finishes in `walk`
- **THEN** the next live frame has the live size and matches a frame rendered without the capture

#### Scenario: Panorama
- **WHEN** a panorama is captured in `walk`
- **THEN** it is produced without the chain, its cube faces are rendered unbalanced, and its display pass applies the chain's white balance

### Requirement: Resources and resize

The chain SHALL follow the renderer's size and pixel ratio, keep its occlusion buffer at the drawing-buffer size, be rebuilt after a GPU context restore and release every GPU resource it owns when the viewer is disposed.

#### Scenario: Resize
- **WHEN** the viewer is resized in `walk`
- **THEN** the chain's targets match the new drawing-buffer size and so does the occlusion buffer

#### Scenario: Dispose
- **WHEN** the viewer is disposed after using `walk`
- **THEN** no render target, texture or material of the chain remains allocated

#### Scenario: Context restore
- **WHEN** the GPU context is lost and restored in `walk`
- **THEN** the chain is rebuilt and active again

### Requirement: Redraw on demand in walk and tour

In `walk` and `tour` (including the tour's overview) every animation frame SHALL still run the frame hooks with the existing capped delta, but a display draw SHALL happen only when the camera (identity, pose, projection, layers) differs from the last displayed picture, or something visible changed since it; demand SHALL accumulate across ticks and SHALL clear only after a successful display draw.

#### Scenario: Still camera
- **WHEN** the camera rests in walk after the lighting is live, with no animation, no selection aura and no pending change
- **THEN** ticks keep advancing while display draws stay flat for 60 ticks, and the screen keeps the last picture

#### Scenario: Slow movement accumulates
- **WHEN** the camera drifts by less than the per-tick tolerance on every tick
- **THEN** a display draw happens once the drift since the last displayed picture exceeds the tolerance

#### Scenario: Camera identity, projection or layers
- **WHEN** the live camera object, its projection or its layers change at an unchanged pose
- **THEN** the next tick draws

#### Scenario: Failed draw keeps demand
- **WHEN** a display draw throws
- **THEN** the demand stays pending and the next tick draws again

### Requirement: What makes walk and tour redraw

A display draw SHALL follow every visible change of the scene in walk and tour: edits and rebuilds; shell visibility or layers (the tour's overview included); door and furniture animation frames up to the final one; a model upgraded to its loaded body; a texture attached to a surface; selection set, cleared or recoloured, its fade while it changes and its glow while an aura exists; floor-ring changes; sun-shadow changes.

#### Scenario: Animation draws throughout
- **WHEN** a door opens in walk
- **THEN** every tick of the motion draws, the final pose is drawn, and the view rests afterwards

#### Scenario: Clearing a settled selection
- **WHEN** a settled selection is cleared at an unchanged camera pose
- **THEN** the next tick draws the unselected picture

#### Scenario: Shell switch at an unchanged pose
- **WHEN** the tour switches its shell state while the camera has not moved
- **THEN** the next tick draws the new shell

#### Scenario: Late texture
- **WHEN** a surface's texture is attached after the view has rested
- **THEN** the next tick draws it

### Requirement: Lighting and lifecycle changes redraw walk and tour

A display draw SHALL follow, in walk and tour: the post-processing chain attaching or detaching; the room lighting changing its look, completing, failing or finishing a refresh; size or pixel-ratio changes; returning to a visible tab or a reattached canvas; a GPU context restore.

#### Scenario: Lighting refresh
- **WHEN** a room lighting refresh finishes while the camera rests
- **THEN** the next tick draws the refreshed lighting

#### Scenario: Lifecycle
- **WHEN** the canvas is resized, its pixel ratio changes, the tab becomes visible again, the canvas is reattached, or the GPU context is restored
- **THEN** the next tick draws a complete picture

### Requirement: Clock and telemetry under on-demand drawing

The frame clock tests and animations rely on SHALL keep ticking on every animation frame; the time of the last display draw SHALL advance only on display draws; frame-interval telemetry SHALL not count the gap across skipped draws as a slow frame; room dwell SHALL accumulate while the view rests and SHALL NOT count time the tab was hidden.

#### Scenario: Idle gap is not a slow frame
- **WHEN** the view rests for five seconds in walk and the camera then moves
- **THEN** no frame-interval sample of five seconds is recorded

#### Scenario: Dwell while resting
- **WHEN** the visitor stands still in one room for ten seconds with the tab visible
- **THEN** dwell for that room grows by about ten seconds

### Requirement: Captures under on-demand drawing

Still, panorama and video captures SHALL render on their own paths regardless of pending demand, SHALL NOT clear pending demand, and video capture SHALL restore the live pose and size and cause one display draw afterwards before the view rests again; a failed capture SHALL leave the live view as before.

#### Scenario: Still with pending demand
- **WHEN** a still is captured in walk while a redraw is pending
- **THEN** the capture succeeds and the pending redraw still happens on the next tick

#### Scenario: Video restores
- **WHEN** a video clip is captured in tour
- **THEN** its frames are deterministic as before, and after it the live pose and size are restored with at least one display draw, after which the view rests if nothing else changes
