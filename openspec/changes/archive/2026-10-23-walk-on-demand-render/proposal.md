# Proposal

## Why

Walk and tour redraw an identical picture on every frame when the camera is still, through the post-processing chain and the room lighting. That costs battery and heat on phones and makes input queue behind frames on slow renderers.

## What Changes

- In walk and tour the player draws a new picture only when something visible can have changed: the camera moved, the scene or a model changed, an animation is running, textures arrived, the lighting changed, the canvas resized or was restored. Otherwise the last picture stays on screen.
- Editing modes keep drawing every frame as now.
- The debug surface reports display draws and ticks, for tests.
- Nothing changes in the public API.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `walk-post-processing`: walk and tour redraw on demand.

## Impact

A new render-demand module, the frame wiring and the controllers that already observe changes (scene mount, animators, library surfaces, selection, floor ring, sun shadow, walk chain, room lighting, captures), telemetry sampling, the debug surface, tests.
