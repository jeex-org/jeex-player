## MODIFIED Requirements

### Requirement: Active only in walk and tour

The player SHALL render through the post-processing chain while the camera mode is `walk` or `tour`, in every shell state those modes use, and SHALL render straight to the screen in every other mode. In walk and tour, a display draw (requirement «Redraw on demand in walk and tour») renders the beauty pass once and the occlusion input once; editing modes keep their schedule (every animation frame, and the existing low-rate heartbeat while rendering is disabled in `plan2d`).

#### Scenario: Editing modes unchanged
- **WHEN** the camera mode is `plan2d`, `plan3d` or `orbit`
- **THEN** frames render directly to the default framebuffer on the same schedule as before, and no post-processing pass runs

#### Scenario: Walk uses the chain
- **WHEN** the viewer makes a display draw in `walk` after the chain has loaded
- **THEN** that draw renders the beauty pass once and its occlusion input once, and the chain writes the screen

#### Scenario: Tour from the overview
- **WHEN** a tour starts in its overview (dollhouse) shell
- **THEN** the chain is active from the first display draw after it has loaded

### Requirement: Mirrors under the chain

A mirror SHALL capture its reflection exactly once per display draw, in that draw's beauty pass (the live view's scene and camera into the screen or into the chain), whether or not the chain is active; other passes (transmission, occlusion input, checkpoint inset previews, swatches) SHALL NOT trigger a capture.

#### Scenario: Mirror in walk
- **WHEN** a mirror is in view in `walk` with the chain active and the view is redrawn
- **THEN** it shows the room, captures once per display draw, and its brightness matches the direct path within 2 %

#### Scenario: Inset preview
- **WHEN** a checkpoint inset preview renders to the screen while a mirror is in the scene
- **THEN** the preview triggers no mirror capture

## ADDED Requirements

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
