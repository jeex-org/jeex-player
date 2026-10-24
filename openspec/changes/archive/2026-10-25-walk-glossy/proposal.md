# Proposal

## Why

In walk and tour a polished floor in the demo living room looks as matte as a satin one and shows no window, because the room's reflection probe is placed against the floor lamp's glowing shade, which fills the probe's upward view; the probe placement only tests plan footprints and never moves after a furniture edit. The same room's ceiling reads peach at the walk start, because the walk picture has no camera white balance under a warm lamp mixed with daylight.

## What Changes

- The room's reflection probe point keeps a 0.5 m clearance in 3D from every furniture box (a low sofa no longer blocks a point above it; a lamp shade or a tall shelf does); when no point in the room qualifies, the point with the largest clearance from furniture and walls is used. Deterministic.
- After a furniture edit in walk the probe points are recomputed from the current furniture; every room whose probe point moved, and the edited room, is re-captured at its new point, and reflections in that room are projected from the new point.
- The walk and tour picture gets a fixed, partial camera white balance: one 3×3 matrix applied once to the final image in the existing output pass, before tone mapping and display encoding, luminance-preserving, calibrated on the neutral surfaces of the demo apartment's walk start and keeping some warmth. Captures that go through the chain (stills, video) carry it, and so does a panorama's display pass in walk and tour; probe, grid and lightmap captures, a panorama's cube faces and the editing modes never do.
- Gloss is judged by specular contrast and a visible window reflection, not by mean specular brightness.
- Not changed: lamp lumens, lamp emission shape, shadows, probe count and resolution, the capture background, the lighting standard's values and version, the walk material transform.

## Capabilities

### New Capabilities

- `walk-white-balance`: the walk and tour camera white balance: what it is applied to, where in the output, how it is calibrated and what it must preserve.

### Modified Capabilities

- `walk-room-lighting`: the reflection probe's placement (3D clearance from furniture, fallback) and its refresh after furniture edits in walk.
- `walk-post-processing`: the chain's contents name the white balance inside the display transform; the open-floor and mirror comparisons against the direct path are taken with the white balance at identity; a panorama's display pass in walk and tour applies the chain's white balance.

## Impact

- Code: the room volumes module (probe placement, furniture boxes with height bounds), the walk lighting wiring (furniture height bounds), the walk lighting module and the room probes (placement refresh, probe positions in the box uniforms), the walk lighting tuning (clearance), the walk post chain's output pass (the matrix) and its tuning, the post-processor contract (the matrix, read-only), the panorama display pass and the panorama command, a new pure white-balance module.
- Tests: room volumes unit tests, walk lighting component tests (placement refresh, gloss contrast, window reflection, ceiling colour), walk post component tests (white balance in the output, identity comparison).
- Pictures: walk and tour screenshots change colour by the white balance; chrome and canvas e2e baselines of the editing modes do not change.
- Performance: no extra GPU pass, target, texture or capture; placement adds bounded CPU work at load and after edits. Phones unaffected.
- No API, schema, option or lighting standard change; no new dependency.
