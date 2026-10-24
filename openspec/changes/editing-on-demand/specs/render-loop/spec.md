# Spec Delta: render-loop

## ADDED Requirements

### Requirement: Editing modes draw on demand

In `orbit` and `plan3d` every animation frame SHALL still run the frame hooks, but a display draw SHALL happen only when the camera (identity, pose, projection, layers, mode) differs from the last displayed picture beyond the same tolerance walk and tour use, or something visible changed since it; demand SHALL accumulate across ticks and SHALL clear only after a successful display draw. Camera inertia SHALL draw until its motion falls below that tolerance.

#### Scenario: Resting orbit
- **WHEN** the camera rests in `orbit` after the scene has settled, with no selection, no animation and no pending change
- **THEN** ticks keep advancing while display draws stay at zero over 60 ticks and over a two-second window, on the GPU and on software rendering, and the screen keeps the last picture

#### Scenario: Resting top view
- **WHEN** the camera rests in `plan3d` under the same conditions
- **THEN** ticks keep advancing while display draws stay at zero over 60 ticks

#### Scenario: Inertia after a drag
- **WHEN** an orbit drag is released and the camera eases to its target
- **THEN** every tick of the easing that moves the camera beyond the tolerance draws, and the view rests afterwards

#### Scenario: Slow movement accumulates
- **WHEN** the camera drifts by less than the per-tick tolerance on every tick in `orbit`
- **THEN** a display draw happens once the drift since the last displayed picture exceeds the tolerance

#### Scenario: Failed draw keeps demand
- **WHEN** a display draw throws in `orbit`
- **THEN** the demand stays pending and the next tick draws again

### Requirement: Scene changes redraw the editing modes

In `orbit` and `plan3d` a display draw SHALL follow every visible change of the scene: edits, finishes, variants and rebuilds; loaded models and textures; a light bake arriving or dropping; furniture and door animation up to the final frame; cutaways and shell state; selection set, cleared, recoloured or fading; the light temperature.

#### Scenario: Late model or texture
- **WHEN** a model body or a surface texture arrives after the view has rested
- **THEN** the next tick draws it

#### Scenario: Edit while hidden
- **WHEN** the scene is edited while the viewer is hidden and the viewer is then shown
- **THEN** the first tick after it is shown draws the edited scene

#### Scenario: Door motion
- **WHEN** a door opens in `orbit`
- **THEN** every tick of the motion draws, the final pose is drawn, and the view rests afterwards

### Requirement: Authoring overlays redraw the editing modes

In `orbit` and `plan3d` a display draw SHALL follow every visible change of the authoring overlays: checkpoint markers, gizmos, hover, invalid tint, placement ghost, drags, trajectory rebuilds and revert; asset move, nudge and mirror previews and their revert; the placement legality mask shown or removed.

#### Scenario: Checkpoint drag and cancel
- **WHEN** a checkpoint is dragged in `orbit` and the drag is then cancelled
- **THEN** every tick that moves the marker draws, the reverted marker is drawn, and the view rests afterwards

#### Scenario: Trajectory final frame
- **WHEN** a checkpoint edit changes the tour trajectory
- **THEN** the drawn picture shows the rebuilt trajectory, not the one before the edit

#### Scenario: Hover and invalid tint
- **WHEN** the pointer hovers a checkpoint handle, or a checkpoint is marked invalid, while the camera rests
- **THEN** the next tick draws the change

#### Scenario: Asset move preview and mask
- **WHEN** an asset is moved, nudged or mirrored in preview, the preview is reverted, or the legality mask is shown or removed, while the camera rests
- **THEN** the next tick draws each change, and the view rests afterwards

### Requirement: A selection aura keeps drawing

While an editor selection aura is on screen in `orbit` or `plan3d`, including its fade-out after the selection is cleared, the view SHALL draw on every tick, because the aura animates; after the aura's final removal is drawn the view SHALL rest. A host-set selection tint without an aura SHALL draw through its finite fade and then rest.

#### Scenario: Editor aura through its fade-out
- **WHEN** an object is selected in the editor in `orbit`, and later the selection is cleared at an unchanged pose
- **THEN** every tick draws while the aura is shown and while it fades out, the picture without the aura is drawn, and the view rests afterwards

#### Scenario: Host selection tint
- **WHEN** the host sets a selection at an unchanged pose in `orbit`
- **THEN** ticks draw through the tint's fade, and the view rests once the fade ends

### Requirement: The camera-preview inset under on-demand drawing

The camera-preview inset SHALL be drawn only right after a main display draw and never on a tick without one. Opening, closing, dragging, resizing or relocating the inset, and any change of the checkpoint it shows, SHALL cause a main display draw followed by the inset; closing SHALL leave a main picture without the old inset.

#### Scenario: Open and rest
- **WHEN** the preview inset opens in `orbit` and nothing else changes
- **THEN** one main draw and one inset draw follow, and then both rest

#### Scenario: Move or resize the card
- **WHEN** the inset card is dragged, resized or relocated
- **THEN** each change draws the main picture and the inset at the new place

#### Scenario: Close
- **WHEN** the inset closes while the camera rests
- **THEN** the next tick draws the main picture without the inset, and the view rests afterwards

### Requirement: The flat plan keeps its heartbeat

In `plan2d` the scene behind the opaque plan drawing SHALL keep being drawn at the existing low-rate keep-warm heartbeat, so that returning to a 3D mode shows its first picture without a stall; `plan2d` is the one mode that does not rest.

#### Scenario: Flat plan
- **WHEN** the viewer rests in `plan2d`
- **THEN** display draws happen only at the heartbeat rate, fewer than the ticks

### Requirement: Lifecycle under on-demand editing

In `orbit` and `plan3d` a display draw SHALL follow a resize, a pixel-ratio change (the plan canvas included), returning to a visible tab, a reattached or revealed canvas, and a GPU context restore. The first display draw SHALL still wait for shader compilation, and a viewer mounted hidden SHALL still announce readiness without drawing and draw when revealed. Captures SHALL render on their own paths and SHALL NOT clear pending demand.

#### Scenario: Resize
- **WHEN** the canvas is resized while the camera rests in `orbit`
- **THEN** one display draw follows the fit, and the view rests afterwards

#### Scenario: Pixel ratio only
- **WHEN** only the device pixel ratio changes at a fixed CSS size, in `orbit` or in `plan2d`
- **THEN** the drawing buffer and the plan canvas are refitted to the new ratio, one display draw follows in `orbit`, and `plan2d` keeps its heartbeat

#### Scenario: Hidden mount
- **WHEN** a viewer is mounted hidden in `orbit` and later revealed
- **THEN** it announces readiness without a display draw while hidden, draws on reveal, and rests afterwards

#### Scenario: Context restore
- **WHEN** the GPU context is lost and restored in `orbit`
- **THEN** the view draws again after compilation and rests afterwards

#### Scenario: Still with pending demand
- **WHEN** a still or a panorama is captured in `orbit` while one non-animating redraw is pending and no display tick runs during the capture
- **THEN** the capture succeeds without a display draw, and the pending redraw happens on the next display tick
