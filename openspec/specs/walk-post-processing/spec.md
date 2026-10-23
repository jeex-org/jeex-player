# walk-post-processing Specification

## Purpose
What the player draws in walk and tour: a post-processing chain of ambient occlusion, antialiasing and the display transform, when it is active and how it loads, and how mirrors and captures behave under it. Editing modes render straight to the screen.

## Requirements

### Requirement: Active only in walk and tour

The player SHALL render through the post-processing chain while the camera mode is `walk` or `tour`, in every shell state those modes use, and SHALL render straight to the screen in every other mode.

#### Scenario: Editing modes unchanged
- **WHEN** the camera mode is `plan2d`, `plan3d` or `orbit`
- **THEN** every frame renders the scene directly to the default framebuffer and no post-processing pass runs

#### Scenario: Walk uses the chain
- **WHEN** the viewer enters `walk` and the chain has loaded
- **THEN** each frame renders the scene's beauty pass once and its occlusion input once, and the chain writes the screen

#### Scenario: Tour from the overview
- **WHEN** a tour starts in its overview (dollhouse) shell
- **THEN** the chain is active from the first tour frame after it has loaded

### Requirement: Chain contents

The chain SHALL apply, in order, ground-truth ambient occlusion (world-space radius 0.3 m, at the drawing-buffer resolution, denoised without crossing depth breaks), SMAA and the lighting standard's display transform, rendering the scene in linear half-float colour without multisampling and tone mapping it exactly once.

#### Scenario: Corner darkening
- **WHEN** a walk view shows a floor-to-wall corner and an open patch of the same floor
- **THEN** with the chain the corner reads darker relative to the open patch than without it

#### Scenario: Smoother edges
- **WHEN** a walk view shows a high-contrast diagonal edge
- **THEN** with the chain the edge's error against a supersampled reference is lower than without it

#### Scenario: Open floor unchanged in tone
- **WHEN** an open floor patch away from geometry is compared with and without the chain
- **THEN** its displayed colour differs by no more than 2 % per channel

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

A mirror SHALL capture its reflection exactly once per frame, in the frame's beauty pass (the live view's scene and camera into the screen or into the chain), whether or not the chain is active; other passes (transmission, occlusion input, checkpoint inset previews, swatches) SHALL NOT trigger a capture.

#### Scenario: Mirror in walk
- **WHEN** a mirror is in view in `walk` with the chain active
- **THEN** it shows the room, captures once per frame, and its brightness matches the direct path within 2 %

#### Scenario: Inset preview
- **WHEN** a checkpoint inset preview renders to the screen while a mirror is in the scene
- **THEN** the preview triggers no mirror capture

### Requirement: Captures in walk and tour

Stills and video frames captured while the camera mode is `walk` or `tour` SHALL go through the same chain instance at the capture's resolution, waiting for it to load; if it fails to load they SHALL use the direct path. Panoramas SHALL keep their direct path. The next live frame SHALL be unchanged by a capture.

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
- **THEN** it is produced as before, without the chain

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
