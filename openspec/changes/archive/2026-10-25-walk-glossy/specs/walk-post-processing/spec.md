# Spec Delta

## MODIFIED Requirements

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
