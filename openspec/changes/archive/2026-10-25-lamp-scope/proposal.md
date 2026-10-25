# Proposal

## Why

In walk and tour a lamp lights only by its direct term: the room light-probe grids are baked with the whole furniture group hidden, so no lamp light nested in furniture (a fact light or a built-in bank bulb) ever reaches them, and a lamp-lit room gets no bounce. Meanwhile a shadowless point light reaches through walls up to its cutoff, so a lamp lights the walls, floor and furniture of the room next door. Both are fixed together, and the walk calibration is measured again, because each moves the readings it was tuned on.

## What Changes

- The grid bake no longer hides the furniture group: furniture meshes leave the grid capture for the slice while the lights under them stay in the scene, so every lamp's light reaches the room grids (first pass) and travels one bounce through doorways (second pass). Shades stay out of the diffuse grid; reflection probes keep seeing furniture, with the emissive cap as today.
- Every lamp in the scene (every artificial point light, from a lamp fact or from a built-in bank builder) gets one source room in walk and tour, from its emitter's world position against the room polygons; a lamp in no room lights nothing there.
- In walk and tour, and in the grid and reflection captures they make, a lamp's direct diffuse and specular light SHALL reach only surfaces of its own room; a neighbouring room sees its lamp-lit surfaces through an opening, by reflection and grid bounce only. Every box of one room is the same room, so a split open-plan room shows no seam. The editing modes are unchanged.
- The room gate adds no program per room or per state: crossing rooms, moving the camera, or re-assigning a lamp compiles nothing.
- A change that affects a lamp (move, removal, variant swap, the light temperature) re-bakes the whole walk lighting, grids then probes; other furniture edits keep re-capturing only the probes they affect.
- The README's lamp limits change: lamps feed the walk grids and stop at the room boundary in walk and tour; the concave-room limit is stated unless the tasks find and fix a supported case.
- The walk calibration is measured again (daylight-only and lamps-on, each after a fresh bake) against frozen targets; only the white balance source may be recalibrated, toward its existing warm-white band.
- Not changed: lamp units and intensities, lamp colours and cutoffs, `collectLampLights()`, the lightmap policy for baked surfaces, exposure, ambient floor, sun factor, emissive cap, gloss thresholds, poses and roughness, light shadows.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `walk-room-lighting`: lamps feed the room grids; each lamp has one source room; a lamp's direct light stays in its room in walk, tour and their captures; lamp-affecting changes re-bake everything.
- `baked-surface`: the per-render light order resolution also gives each drawn point light its source room, and changing a lamp's room compiles nothing once warmed up.
- `player-lamp-lights`: the README's known costs and limits no longer say lamps skip the walk grid and cross walls; they state what remains (editing modes, concave rooms).

## Impact

- Code: the grid bake's exclusions (layer exclusion of furniture meshes), a new pure lamp-room assignment module, a runtime lamp inventory over the scene, the light order adapter (source room per drawn point light), the walk shader transform (room index per box, receiver room, per-light gate, a scope switch; version bump), the walk lighting module (room assignment on load, lamp signature, restart on lamp change, temperature relight as a restart), the walk rig (scope on from entry to exit, through the warm-up), README.
- Tests: unit tests for the room assignment, the layer exclusion and its restore, the lamp signature, the patch text and the light order; component tests in walk for lamp bounce, the closed-wall gate, the doorway, the split room, bank lamps, shared materials across rooms, camera independence, program count, restart on lamp edits and temperature, and the editing restore; the calibration suites re-measured on a hardware renderer.
- Pictures: walk and tour change where lamps are lit (more bounce in lamp-lit rooms, no lamp light on the far side of walls); editing-mode pictures and chrome baselines do not change.
- Performance: one traversal of the scene's lights per render and camera (already paid when baked surfaces are present), a per-light compare in the fragment shader, the same light count; bake time, warmed display cost, draw count and program count are measured and reported. A lamp edit in walk now costs a full re-bake.
- No API, option, schema or lighting standard change; no new dependency.
