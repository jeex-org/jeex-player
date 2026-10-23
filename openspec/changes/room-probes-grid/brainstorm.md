# Brainstorm

## Problem

In walk and tour, glossy floors, cabinets and metals reflect only the lighting standard's neutral studio environment, and indirect light comes from a hemisphere light, a shadowless fill and that environment's diffuse term, none of which is occluded by walls. Rooms look evenly lit; a windowless bathroom is as bright as the living room. Goal: one box-projected reflection probe per room and one light-probe grid per room in walk and tour only, with the light that is not occluded switched off there, and editing modes untouched.

## Related work

1. The walk and tour post-processing chain (lazy chunk, controller with a context generation) is the home for this work; it lands just before.
2. A parallel change owns the ceiling material and room finishes in the shell builder and the material library; this change must not clone or swap materials, and must not edit the shell builder's material code.
3. Lamp lights (a later step) will feed the grid; procedural lamps of the built-in bank already add point lights that reach through walls (noted for that step).

## Doubts

1. Grid selection by object origin while shell meshes carry world-space vertices and zero origins.
2. Bake with or without the hemisphere, mirrors, ceilings; bake time; what is shown during it.
3. Capture feedback.
4. A box-projection patch in r186 and per-material uniforms.
5. Blending across doorways.
6. Calibration and double counting.
7. Refresh after edits, preset change, context restore.
8. Memory and time on phones.
9. Stills, video and panoramas.
10. Tests.

## Approaches considered

1. **Per-room material clones with `envMap` swaps and a per-material box patch (author).** Partner showed: any `envMap` change forces a program change; floors and furniture share materials; clones break the material identity the shell painter relies on (it disposes and replaces materials) so an edit made in walk would be undone on exit; collides with the parallel material-library work. Rejected.
2. **One probe atlas chosen per fragment (partner).** One `onBeforeCompile` patch with a constant program-cache key replaces the environment-map lighting chunk: environment diffuse multiplied by `(1 − walkLighting)`, specular from a box-projected lookup into one shared atlas of all room probes, the room chosen per fragment from uniform arrays of room boxes and probe positions (lookup point pushed 5 cm along the normal so wall faces pick their own room), a second slice blended within 0.4 m of a shared box face. Uniform objects shared by all materials; material identity untouched. At 128 px a probe's PMREM output has exactly the studio environment's cube-UV layout, so three's sampling is reused with a remapped offset.
3. **Grid binding by rebasing shell mesh origins (partner).** three r186 picks a grid by the object's world origin (`WebGLRenderer` `findLightProbeGrid`), no binding API; an object outside every box recompiles every frame and inherits stale coefficients, so a catch-all grid listed last is mandatory. Walls are one mesh per room face, floors, ceilings and skirtings per room: translating each geometry so the mesh origin sits at its centroid plus 0.2 m along the inward normal lands it in its room's box; world-space vertices stay identical (raycasting, export, sun-shadow bounds and selection glow apply `matrixWorld`).
4. **Grid only, no room probes (author).** Diffuse right, reflections still the studio. Rejected.
5. **One apartment probe (author).** Leaks the living room into the bathroom; spec anti-goal.

Engine facts verified by the partner in r186: probes sit on the grid box surface (index 0 at `min`), so volumes are inset 0.12 m; the bake cube camera is private (exclusions by toggling `visible` around each synchronous bake call); a ranged bake writes into the live atlas and other grids in the scene light the capture, so bakes go into grids not yet in the scene and are added together in one frame; the environment's diffuse adds on top of the grid's irradiance; grid count and hemisphere count are in the program key (entering and leaving walk recompiles once, hidden by `compileAsync` before the swap frame); captures into targets are linear.

## Decision

Approaches 2 and 3, as follows.

1. **Room volumes** (pure): from the solved plan, rooms split into rectilinear boxes; grid boxes inset 0.12 m; full boxes for projection; probe at the point farthest from the room's edges at 1.5 m, moved off furniture; a catch-all box (apartment bounds + 2 m) last.
2. **Origin rebase** as a separate post-build pass over the shell's meshes (walls, floors, ceilings, skirtings, joints, door frames by the side their leaf opens into), applied in every mode so programs do not change by mode; the shell builder's own code is not edited. A test pins world-space vertices unchanged.
3. **Grid bake** in the walk chunk (revised in round 2: grids in the scene, hidden): furniture, mirrors and transmissive meshes hidden around each call; pass 0 direct, pass 1 bounce; `cubemapSize` 8, two layers in height, about 1 m spacing; under 8 ms of bake per frame; during the bake hemisphere, fill and environment diffuse are zero and the sky contributes through the background intensity.
4. **Room probes** after the grids are live: one shared 128 px HalfFloat cube target, PMREM, copied into one atlas (two columns beyond 8 rooms, under a 4096 limit); captured with the patch disabled (studio environment, no feedback), mirrors hidden, chain off; one room per frame.
5. **Rig in walk/tour**: hemisphere and fill to intensity 0 (not removed, so programs stay), environment diffuse off through the patch; a small floor of ambient light so a room with no window and no lamp is not black; a walk exposure factor in the chain's output; none of these touch the lighting standard. Everything restored on leaving.
6. **Show** the direct look until both bakes are done, then one swap frame after `compileAsync`.
7. **Refresh**: edits in walk debounced 1 s and re-bake only the rooms whose boxes changed; sun preset change and context restore re-bake all.
8. **Captures**: stills, video and panoramas of the live state get grids and probes through the scene; captures of other states (fresh offscreen scenes) do not, and look like editing modes; accepted for this step.
9. **Memory at 128 px**: about 1.5 MB per room probe (12 MB for 8 rooms) plus small grids; 256 px rejected for phones.

## Round 2 (after the independent review)

The review found two engine claims false: a grid baked outside the scene gets no bounce, because the bounce comes from the scene sampling the grid's own bounce target; and program pre-compilation never pushes grids, so warmed programs lack the grid define. Revised with the partner: grids live in the scene hidden and become visible only inside bake calls and at the swap; probe captures with grids visible warm the programs. For objects with floor or wall-side origins the partner found a cleaner selection mechanism than rebasing: a `Box3` subclass whose `containsPoint` answers from a separate selection box while the shader keeps reading the inset sampling box. The exterior gets an analytic hemisphere grid instead of a baked catch-all; exposure goes through the renderer's tone-mapping exposure; the walk patch has separate diffuse and specular switches.

## Rejected

1. Material clones and `envMap` swaps: program changes, broken material identity, conflicts with the material work.
2. Rebasing furniture and fixture geometry: shared between placements; replaced by the selection box.
2a. Baking grids outside the scene: no bounce.
2b. A baked catch-all over the apartment: probes inside walls darken facades.
3. Removing the hemisphere and fill from the rig: changes the program key and the lighting standard's rig.
4. Baking into live grids: half-filled rows and order-dependent light.
5. 256 px probes: about 50 MB for 8 rooms.
6. Progressive reveal during the bake: flicker.

## Open questions

None for the owner. The calibration numbers (ambient floor, walk exposure) are set by measurement in the implementation and recorded with the tests.

## Process

Sol unavailable until 14:39, Opus rounds: two rounds (the second after the independent review) with an independent Opus agent, read-only, given the problem, three approaches and ten doubts. The partner verified the engine facts above in the installed three r186, rejected the author's per-material approach with evidence from the code, and proposed the atlas, the rebase, the out-of-scene bake and the rig switching.
