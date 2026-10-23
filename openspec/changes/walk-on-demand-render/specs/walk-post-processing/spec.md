## ADDED Requirements

### Requirement: Redraw on demand in walk and tour

In `walk` and `tour` the player SHALL draw a new picture only when the camera's pose, projection or layers differ from the last displayed picture, or something visible has changed since it (scene, models, textures, animations, selection, lighting, size, context); otherwise it SHALL keep the last picture and still run its per-frame work. Editing modes SHALL draw every frame as before.

#### Scenario: Still camera
- **WHEN** the camera rests in walk after the lighting is live
- **THEN** no display draw happens over 60 ticks and the screen keeps the last picture

#### Scenario: Movement after idle
- **WHEN** the visitor moves after a long idle in walk
- **THEN** the next tick draws, and drawing continues until the camera rests

#### Scenario: Every change draws once
- **WHEN** in walk a door opens, a model finishes upgrading, a texture arrives, an edit is applied, the selection changes, the floor ring moves, the room lighting changes its look, or the canvas is resized
- **THEN** the picture is redrawn and then rests again

#### Scenario: Captures unaffected
- **WHEN** a still or a video frame is captured in walk while no redraw is pending
- **THEN** the capture renders as before and the live view still rests afterwards

#### Scenario: Editing modes unchanged
- **WHEN** the camera mode is `orbit`, `plan3d` or `plan2d`
- **THEN** drawing follows the same schedule as before this change
